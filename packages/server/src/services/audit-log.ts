import { open, stat } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve } from "node:path";

import { contextCache } from "../cache.js";
import { FABRIC_DIR, isNodeError } from "./_shared.js";
import { appendEventLedgerEvent, readEventLedger, type StoredEventLedgerEvent } from "./event-ledger.js";

export const AUDIT_LOG_FILE = `${FABRIC_DIR}/audit.jsonl`;
export const DEFAULT_AUDIT_WINDOW_MS = 5 * 60 * 1000;

type AuditLogBaseEntry = {
  kind: "audit-event";
  ts: number;
  path: string;
};

export type GetRulesAuditEntry = AuditLogBaseEntry & {
  event: "get_rules";
  client_hash?: string;
};

export type EditIntentAuditEntry = AuditLogBaseEntry & {
  event: "edit_intent";
  compliant: boolean;
  intent: string;
  ledger_entry_id: string;
  matched_get_rules_ts: number | null;
  window_ms: number;
};

export type RuleSelectionAuditEntry = AuditLogBaseEntry & {
  event: "rule_selection";
  selection_token: string;
  target_paths: string[];
  required_stable_ids: string[];
  ai_selectable_stable_ids: string[];
  ai_selected_stable_ids: string[];
  final_stable_ids: string[];
  ai_selection_reasons: Record<string, string>;
  rejected_stable_ids: string[];
  ignored_stable_ids: string[];
};

export type AuditLogEntry = GetRulesAuditEntry | EditIntentAuditEntry | RuleSelectionAuditEntry;

export async function appendGetRulesAuditEvent(
  projectRoot: string,
  input: {
    path: string;
    client_hash?: string;
    ts?: number;
    required_stable_ids?: string[];
    ai_selectable_stable_ids?: string[];
    final_stable_ids?: string[];
    correlation_id?: string;
    session_id?: string;
  },
): Promise<GetRulesAuditEntry> {
  const entry: GetRulesAuditEntry = {
    kind: "audit-event",
    event: "get_rules",
    ts: input.ts ?? Date.now(),
    path: normalizeAuditPath(projectRoot, input.path),
    client_hash: input.client_hash,
  };

  await appendAuditLogEventLedgerEvents(projectRoot, [entry], {
    rule_context: {
      required_stable_ids: input.required_stable_ids,
      ai_selectable_stable_ids: input.ai_selectable_stable_ids,
      final_stable_ids: input.final_stable_ids,
    },
    correlation_id: input.correlation_id,
    session_id: input.session_id,
  });

  return entry;
}

export async function appendRuleSelectionAuditEvent(
  projectRoot: string,
  input: {
    path: string;
    selection_token: string;
    target_paths: string[];
    required_stable_ids: string[];
    ai_selectable_stable_ids: string[];
    ai_selected_stable_ids: string[];
    final_stable_ids: string[];
    ai_selection_reasons: Record<string, string>;
    rejected_stable_ids: string[];
    ignored_stable_ids: string[];
    ts?: number;
    correlation_id?: string;
    session_id?: string;
  },
): Promise<RuleSelectionAuditEntry> {
  const entry: RuleSelectionAuditEntry = {
    kind: "audit-event",
    event: "rule_selection",
    ts: input.ts ?? Date.now(),
    path: normalizeAuditPath(projectRoot, input.path),
    selection_token: input.selection_token,
    target_paths: input.target_paths.map((path) => normalizeAuditPath(projectRoot, path)),
    required_stable_ids: input.required_stable_ids,
    ai_selectable_stable_ids: input.ai_selectable_stable_ids,
    ai_selected_stable_ids: input.ai_selected_stable_ids,
    final_stable_ids: input.final_stable_ids,
    ai_selection_reasons: input.ai_selection_reasons,
    rejected_stable_ids: input.rejected_stable_ids,
    ignored_stable_ids: input.ignored_stable_ids,
  };

  await appendAuditLogEventLedgerEvents(projectRoot, [entry], {
    correlation_id: input.correlation_id,
    session_id: input.session_id,
  });

  return entry;
}

export type EditIntentComplianceResult = {
  compliant: boolean;
  matched_get_rules_ts: string | null;
  window_ms: number;
};

export async function appendEditIntentAuditEvents(
  projectRoot: string,
  input: {
    affected_paths: string[];
    intent: string;
    ledger_entry_id: string;
    ts?: number;
    window_ms?: number;
    correlation_id?: string;
    session_id?: string;
  },
): Promise<{ entries: EditIntentAuditEntry[]; compliance: EditIntentComplianceResult }> {
  const ts = input.ts ?? Date.now();
  const windowMs = input.window_ms ?? DEFAULT_AUDIT_WINDOW_MS;
  const getRulesEntries = (await readAuditLog(projectRoot, { windowMs, ts })).filter(
    isGetRulesAuditEntry,
  );
  const entries = input.affected_paths.map((affectedPath) => {
    const path = normalizeAuditPath(projectRoot, affectedPath);
    const matchedGetRules = findPrecedingGetRulesEvent(getRulesEntries, path, ts, windowMs);

    return {
      kind: "audit-event" as const,
      event: "edit_intent" as const,
      ts,
      path,
      compliant: matchedGetRules !== null,
      intent: input.intent,
      ledger_entry_id: input.ledger_entry_id,
      matched_get_rules_ts: matchedGetRules?.ts ?? null,
      window_ms: windowMs,
    };
  });

  const compliance: EditIntentComplianceResult = {
    compliant: entries.length === 0 || entries.every((e) => e.compliant),
    matched_get_rules_ts:
      entries.length > 0 && entries[0].matched_get_rules_ts !== null
        ? new Date(entries[0].matched_get_rules_ts).toISOString()
        : null,
    window_ms: windowMs,
  };

  if (entries.length === 0) {
    return { entries, compliance };
  }

  await appendAuditLogEventLedgerEvents(projectRoot, entries, {
    correlation_id: input.correlation_id,
    session_id: input.session_id,
  });

  return { entries, compliance };
}

/**
 * Read audit log entries.
 *
 * When `opts.windowMs` and `opts.ts` are provided the function uses a
 * byte-offset sliding window: it reads only the bytes that have been appended
 * since the last call, then scans backward to find entries within the given
 * time window.  For non-windowed reads (e.g. tests) it falls back to a full
 * file read.
 *
 * The byte-offset cursor is tracked in ContextCache so that consecutive calls
 * within the same process never re-read already-seen bytes.
 */
export async function readAuditLog(
  projectRoot: string,
  opts?: { windowMs: number; ts: number },
): Promise<AuditLogEntry[]> {
  const eventEntries = await readAuditLogFromEventLedger(projectRoot);

  if (opts === undefined) {
    const legacyEntries = await readAuditLogFull(projectRoot);
    return mergeAuditLogEntries(legacyEntries, eventEntries);
  }

  const legacyEntries = await readAuditLogWindowed(projectRoot, opts.ts, opts.windowMs);
  const windowedEventEntries = eventEntries.filter(
    (entry) => opts.ts - entry.ts <= opts.windowMs && entry.ts <= opts.ts,
  );

  return mergeAuditLogEntries(legacyEntries, windowedEventEntries);
}

// ---------------------------------------------------------------------------
// Full read (fallback / no window)
// ---------------------------------------------------------------------------

async function readAuditLogFull(projectRoot: string): Promise<AuditLogEntry[]> {
  const auditPath = join(projectRoot, AUDIT_LOG_FILE);
  let raw: string;

  try {
    const fileStat = await stat(auditPath);
    const handle = await open(auditPath, "r");
    try {
      const buffer = Buffer.alloc(fileStat.size);
      await handle.read(buffer, 0, fileStat.size, 0);
      raw = buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return parseAuditLogText(raw);
}

// ---------------------------------------------------------------------------
// Windowed read using byte-offset cursor from ContextCache
// ---------------------------------------------------------------------------

async function readAuditLogWindowed(
  projectRoot: string,
  ts: number,
  windowMs: number,
): Promise<AuditLogEntry[]> {
  const auditPath = join(projectRoot, AUDIT_LOG_FILE);

  let fileSize: number;
  try {
    const fileStat = await stat(auditPath);
    fileSize = fileStat.size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const cursor = contextCache.getAuditCursor(projectRoot);
  const startOffset = cursor !== undefined && cursor.offset <= fileSize ? cursor.offset : 0;
  const priorRemainder = startOffset > 0 && cursor !== undefined ? cursor.remainder : "";
  const priorWindowEntries =
    startOffset > 0 && cursor !== undefined ? (cursor.windowEntries as AuditLogEntry[]) : [];

  // File was rotated or truncated — reset cursor and re-read from start.
  const effectiveStart = cursor !== undefined && cursor.offset > fileSize ? 0 : startOffset;

  let newEntries: AuditLogEntry[] = [];

  if (fileSize > effectiveStart) {
    const length = fileSize - effectiveStart;
    let chunk: string;

    try {
      const handle = await open(auditPath, "r");
      try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, effectiveStart);
        chunk = `${priorRemainder}${buffer.toString("utf8")}`;
      } finally {
        await handle.close();
      }
    } catch (error) {
      // Byte-offset seek failed — fall back to full read and reset cursor.
      contextCache.resetAuditCursor(projectRoot);
      return (await readAuditLogFull(projectRoot)).filter((entry) => ts - entry.ts <= windowMs && entry.ts <= ts);
    }

    const lines = chunk.split(/\r?\n/);
    const remainder = chunk.endsWith("\n") ? "" : (lines.pop() ?? "");
    const windowEntries = [...priorWindowEntries, ...parseAuditLogText(lines.join("\n"))].filter(
      (entry) => ts - entry.ts <= windowMs && entry.ts <= ts,
    );

    contextCache.setAuditCursor(projectRoot, { offset: fileSize, remainder, windowEntries });
    newEntries = windowEntries;
  } else {
    // No new data; update cursor offset in case file grew between calls.
    const windowEntries = priorWindowEntries.filter((entry) => ts - entry.ts <= windowMs && entry.ts <= ts);
    contextCache.setAuditCursor(projectRoot, {
      offset: fileSize,
      remainder: cursor?.remainder ?? "",
      windowEntries,
    });
    newEntries = windowEntries;
  }

  // Build the final set: entries already seen before the cursor (not tracked
  // individually) + new entries.  We need to apply the window filter across
  // the entire visible window.  For compliance cross-reference the window is
  // 5 minutes, which is the default.  Re-read from the beginning of the
  // window boundary if the cursor had been reset.
  if (effectiveStart === 0 && cursor !== undefined && cursor.offset > fileSize) {
    // Cursor was reset because file rotated — newEntries is the full file.
    return newEntries.filter((entry) => ts - entry.ts <= windowMs && entry.ts <= ts);
  }

  // If this is the first call (no cursor) we already have the full file in
  // newEntries; otherwise we only have the tail.  In either case filter by
  // window and return.
  return newEntries;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseAuditLogText(raw: string): AuditLogEntry[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseAuditLogLine)
    .filter((entry): entry is AuditLogEntry => entry !== null);
}

export function findPrecedingGetRulesEvent(
  entries: GetRulesAuditEntry[],
  path: string,
  ts: number,
  windowMs: number,
): GetRulesAuditEntry | null {
  let matched: GetRulesAuditEntry | null = null;

  for (const entry of entries) {
    if (entry.path !== path) {
      continue;
    }

    if (entry.ts > ts) {
      continue;
    }

    if (ts - entry.ts > windowMs) {
      continue;
    }

    if (matched === null || entry.ts > matched.ts) {
      matched = entry;
    }
  }

  return matched;
}

export function normalizeAuditPath(projectRoot: string, value: string): string {
  const normalizedProjectRoot = resolve(projectRoot);
  const candidate = isAbsolute(value) ? resolve(value) : resolve(normalizedProjectRoot, value);
  const relativePath = relative(normalizedProjectRoot, candidate);

  if (
    relativePath.length > 0 &&
    relativePath !== "." &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  ) {
    return posix.normalize(relativePath.split("\\").join("/"));
  }

  return posix.normalize(value.replaceAll("\\", "/"));
}

function isGetRulesAuditEntry(entry: AuditLogEntry): entry is GetRulesAuditEntry {
  return entry.event === "get_rules";
}

async function appendAuditLogEventLedgerEvents(
  projectRoot: string,
  entries: AuditLogEntry[],
  metadata: {
    rule_context?: {
      required_stable_ids?: string[];
      ai_selectable_stable_ids?: string[];
      final_stable_ids?: string[];
    };
    correlation_id?: string;
    session_id?: string;
  } = {},
): Promise<void> {
  for (const entry of entries) {
    if (entry.event === "get_rules") {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "rule_context_planned",
        ts: entry.ts,
        target_paths: [entry.path],
        required_stable_ids: metadata.rule_context?.required_stable_ids ?? [],
        ai_selectable_stable_ids: metadata.rule_context?.ai_selectable_stable_ids ?? [],
        final_stable_ids: metadata.rule_context?.final_stable_ids ?? [],
        client_hash: entry.client_hash,
        correlation_id: metadata.correlation_id,
        session_id: metadata.session_id,
      });
      continue;
    }

    if (entry.event === "rule_selection") {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "rule_selection",
        ts: entry.ts,
        selection_token: entry.selection_token,
        target_paths: entry.target_paths,
        required_stable_ids: entry.required_stable_ids,
        ai_selectable_stable_ids: entry.ai_selectable_stable_ids,
        ai_selected_stable_ids: entry.ai_selected_stable_ids,
        final_stable_ids: entry.final_stable_ids,
        ai_selection_reasons: entry.ai_selection_reasons,
        rejected_stable_ids: entry.rejected_stable_ids,
        ignored_stable_ids: entry.ignored_stable_ids,
        correlation_id: metadata.correlation_id,
        session_id: metadata.session_id,
      });
      continue;
    }

    await appendEventLedgerEvent(projectRoot, {
      event_type: "edit_intent_checked",
      ts: entry.ts,
      path: entry.path,
      compliant: entry.compliant,
      intent: entry.intent,
      ledger_entry_id: entry.ledger_entry_id,
      ledger_source: "ai",
      matched_rule_context_ts: entry.matched_get_rules_ts,
      window_ms: entry.window_ms,
      correlation_id: metadata.correlation_id,
      session_id: metadata.session_id,
    });
  }
}

async function readAuditLogFromEventLedger(projectRoot: string): Promise<AuditLogEntry[]> {
  const { events } = await readEventLedger(projectRoot);
  return events
    .map((event) => projectAuditEvent(projectRoot, event))
    .filter((entry): entry is AuditLogEntry => entry !== null);
}

function projectAuditEvent(projectRoot: string, event: StoredEventLedgerEvent): AuditLogEntry | null {
  if (event.event_type === "rule_context_planned") {
    const [path] = event.target_paths;
    if (path === undefined) {
      return null;
    }

    return {
      kind: "audit-event",
      event: "get_rules",
      ts: event.ts,
      path: normalizeAuditPath(projectRoot, path),
      client_hash: event.client_hash,
    };
  }

  if (event.event_type === "rule_selection") {
    const [path] = event.target_paths;
    if (path === undefined) {
      return null;
    }

    return {
      kind: "audit-event",
      event: "rule_selection",
      ts: event.ts,
      path: normalizeAuditPath(projectRoot, path),
      selection_token: event.selection_token,
      target_paths: event.target_paths.map((targetPath) => normalizeAuditPath(projectRoot, targetPath)),
      required_stable_ids: event.required_stable_ids,
      ai_selectable_stable_ids: event.ai_selectable_stable_ids,
      ai_selected_stable_ids: event.ai_selected_stable_ids,
      final_stable_ids: event.final_stable_ids,
      ai_selection_reasons: event.ai_selection_reasons,
      rejected_stable_ids: event.rejected_stable_ids,
      ignored_stable_ids: event.ignored_stable_ids,
    };
  }

  if (event.event_type === "edit_intent_checked") {
    return {
      kind: "audit-event",
      event: "edit_intent",
      ts: event.ts,
      path: normalizeAuditPath(projectRoot, event.path),
      compliant: event.compliant,
      intent: event.intent,
      ledger_entry_id: event.ledger_entry_id,
      matched_get_rules_ts: event.matched_rule_context_ts,
      window_ms: event.window_ms,
    };
  }

  return null;
}

function mergeAuditLogEntries(
  legacyEntries: AuditLogEntry[],
  eventEntries: AuditLogEntry[],
): AuditLogEntry[] {
  const entries = new Map<string, AuditLogEntry>();

  for (const entry of [...legacyEntries, ...eventEntries]) {
    entries.set(getAuditEntryIdentity(entry), entry);
  }

  return Array.from(entries.values()).sort((left, right) => left.ts - right.ts);
}

function getAuditEntryIdentity(entry: AuditLogEntry): string {
  if (entry.event === "get_rules") {
    return `${entry.event}:${entry.ts}:${entry.path}:${entry.client_hash ?? ""}`;
  }

  if (entry.event === "rule_selection") {
    return `${entry.event}:${entry.ts}:${entry.selection_token}:${entry.target_paths.join("\0")}`;
  }

  return `${entry.event}:${entry.ts}:${entry.ledger_entry_id}:${entry.path}`;
}

function parseAuditLogLine(line: string): AuditLogEntry | null {
  try {
    const parsed = JSON.parse(line) as Partial<AuditLogEntry>;

    if (
      parsed.kind !== "audit-event" ||
      typeof parsed.ts !== "number" ||
      typeof parsed.path !== "string"
    ) {
      return null;
    }

    if (parsed.event === "get_rules") {
      return {
        kind: "audit-event",
        event: "get_rules",
        ts: parsed.ts,
        path: parsed.path,
        client_hash: typeof parsed.client_hash === "string" ? parsed.client_hash : undefined,
      };
    }

    if (
      parsed.event === "edit_intent" &&
      typeof parsed.compliant === "boolean" &&
      typeof parsed.intent === "string" &&
      typeof parsed.ledger_entry_id === "string" &&
      (typeof parsed.matched_get_rules_ts === "number" || parsed.matched_get_rules_ts === null) &&
      typeof parsed.window_ms === "number"
    ) {
      return {
        kind: "audit-event",
        event: "edit_intent",
        ts: parsed.ts,
        path: parsed.path,
        compliant: parsed.compliant,
        intent: parsed.intent,
        ledger_entry_id: parsed.ledger_entry_id,
        matched_get_rules_ts: parsed.matched_get_rules_ts,
        window_ms: parsed.window_ms,
      };
    }

    if (
      parsed.event === "rule_selection" &&
      typeof parsed.selection_token === "string" &&
      Array.isArray(parsed.target_paths) &&
      Array.isArray(parsed.required_stable_ids) &&
      Array.isArray(parsed.ai_selectable_stable_ids) &&
      Array.isArray(parsed.ai_selected_stable_ids) &&
      Array.isArray(parsed.final_stable_ids) &&
      isStringRecord(parsed.ai_selection_reasons) &&
      Array.isArray(parsed.rejected_stable_ids) &&
      Array.isArray(parsed.ignored_stable_ids)
    ) {
      return {
        kind: "audit-event",
        event: "rule_selection",
        ts: parsed.ts,
        path: parsed.path,
        selection_token: parsed.selection_token,
        target_paths: parsed.target_paths.filter(isString),
        required_stable_ids: parsed.required_stable_ids.filter(isString),
        ai_selectable_stable_ids: parsed.ai_selectable_stable_ids.filter(isString),
        ai_selected_stable_ids: parsed.ai_selected_stable_ids.filter(isString),
        final_stable_ids: parsed.final_stable_ids.filter(isString),
        ai_selection_reasons: parsed.ai_selection_reasons,
        rejected_stable_ids: parsed.rejected_stable_ids.filter(isString),
        ignored_stable_ids: parsed.ignored_stable_ids.filter(isString),
      };
    }

    return null;
  } catch {
    return null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}
