import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve } from "node:path";

import { contextCache } from "../cache.js";
import { FABRIC_DIR, isNodeError } from "./_shared.js";

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

export type AuditLogEntry = GetRulesAuditEntry | EditIntentAuditEntry;

export async function appendGetRulesAuditEvent(
  projectRoot: string,
  input: {
    path: string;
    client_hash?: string;
    ts?: number;
  },
): Promise<GetRulesAuditEntry> {
  const entry: GetRulesAuditEntry = {
    kind: "audit-event",
    event: "get_rules",
    ts: input.ts ?? Date.now(),
    path: normalizeAuditPath(projectRoot, input.path),
    client_hash: input.client_hash,
  };

  await appendAuditLogEntries(projectRoot, [entry]);

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

  await appendAuditLogEntries(projectRoot, entries);

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
  if (opts === undefined) {
    return readAuditLogFull(projectRoot);
  }

  return readAuditLogWindowed(projectRoot, opts.ts, opts.windowMs);
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
      return readAuditLogFull(projectRoot);
    }

    const lines = chunk.split(/\r?\n/);
    const remainder = chunk.endsWith("\n") ? "" : (lines.pop() ?? "");

    contextCache.setAuditCursor(projectRoot, { offset: fileSize, remainder });
    newEntries = parseAuditLogText(lines.join("\n"));
  } else {
    // No new data; update cursor offset in case file grew between calls.
    contextCache.setAuditCursor(projectRoot, {
      offset: fileSize,
      remainder: cursor?.remainder ?? "",
    });
  }

  // Build the final set: entries already seen before the cursor (not tracked
  // individually) + new entries.  We need to apply the window filter across
  // the entire visible window.  For compliance cross-reference the window is
  // 5 minutes, which is the default.  Re-read from the beginning of the
  // window boundary if the cursor had been reset.
  if (effectiveStart === 0 && cursor !== undefined && cursor.offset > fileSize) {
    // Cursor was reset because file rotated — newEntries is the full file.
    return newEntries.filter((e) => ts - e.ts <= windowMs);
  }

  // If this is the first call (no cursor) we already have the full file in
  // newEntries; otherwise we only have the tail.  In either case filter by
  // window and return.
  return newEntries.filter((e) => ts - e.ts <= windowMs && e.ts <= ts);
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

async function appendAuditLogEntries(projectRoot: string, entries: AuditLogEntry[]): Promise<void> {
  const auditPath = join(projectRoot, AUDIT_LOG_FILE);
  const auditDir = join(projectRoot, FABRIC_DIR);

  await mkdir(auditDir, { recursive: true });
  await appendFile(auditPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  // Reset the audit cursor so the next windowed read picks up the appended bytes.
  contextCache.resetAuditCursor(projectRoot);
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

    return null;
  } catch {
    return null;
  }
}
