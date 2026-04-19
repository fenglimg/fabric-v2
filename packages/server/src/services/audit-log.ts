import { appendFile, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve } from "node:path";

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

export async function appendEditIntentAuditEvents(
  projectRoot: string,
  input: {
    affected_paths: string[];
    intent: string;
    ledger_entry_id: string;
    ts?: number;
    window_ms?: number;
  },
): Promise<EditIntentAuditEntry[]> {
  const ts = input.ts ?? Date.now();
  const windowMs = input.window_ms ?? DEFAULT_AUDIT_WINDOW_MS;
  const getRulesEntries = (await readAuditLog(projectRoot)).filter(isGetRulesAuditEntry);
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

  if (entries.length === 0) {
    return [];
  }

  await appendAuditLogEntries(projectRoot, entries);

  return entries;
}

export async function readAuditLog(projectRoot: string): Promise<AuditLogEntry[]> {
  const auditPath = join(projectRoot, AUDIT_LOG_FILE);
  let raw: string;

  try {
    raw = await readFile(auditPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

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
