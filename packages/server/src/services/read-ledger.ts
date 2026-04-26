import { randomUUID } from "node:crypto";
import { access, copyFile, readFile, rm } from "node:fs/promises";

import { ledgerEntrySchema, type LedgerEntry } from "@fenglimg/fabric-shared";

import {
  ensureParentDirectory,
  getLegacyLedgerPath,
  getLedgerPath,
  isNodeError,
  sha256,
} from "./_shared.js";
import { appendEventLedgerEvent, readEventLedger, type StoredEventLedgerEvent } from "./event-ledger.js";

export type LedgerSourceFilter = "ai" | "human";

export type StoredLedgerEntry = LedgerEntry & {
  id: string;
};

export type ReadLedgerOptions = {
  source?: LedgerSourceFilter;
  since?: number;
};

export type ResolvedLedgerPaths = {
  primaryPath: string;
  legacyPath: string;
  readPath: string;
  usingLegacy: boolean;
};

export type LedgerMigrationResult = {
  migrated: boolean;
  from: string | null;
  to: string;
};

export async function resolveLedgerPaths(projectRoot: string): Promise<ResolvedLedgerPaths> {
  const primaryPath = getLedgerPath(projectRoot);
  const legacyPath = getLegacyLedgerPath(projectRoot);
  const [primaryExists, legacyExists] = await Promise.all([
    pathExists(primaryPath),
    pathExists(legacyPath),
  ]);

  return {
    primaryPath,
    legacyPath,
    readPath: primaryExists ? primaryPath : legacyPath,
    usingLegacy: !primaryExists && legacyExists,
  };
}

export async function readLedger(
  projectRoot: string,
  options: ReadLedgerOptions = {},
): Promise<StoredLedgerEntry[]> {
  const [legacyEntries, eventEntries] = await Promise.all([
    readLegacyLedger(projectRoot),
    readLedgerFromEventLedger(projectRoot),
  ]);
  const entries = mergeLedgerEntries(legacyEntries, eventEntries);

  return entries
    .filter((entry) => options.source === undefined || entry.source === options.source)
    .filter((entry) => options.since === undefined || entry.ts >= options.since);
}

async function readLegacyLedger(projectRoot: string): Promise<StoredLedgerEntry[]> {
  const { readPath } = await resolveLedgerPaths(projectRoot);
  let raw: string;

  try {
    raw = await readFile(readPath, "utf8");
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
    .map((line, index) => parseLedgerLine(line, index))
    .filter((entry): entry is StoredLedgerEntry => entry !== null);
}

export async function appendLedgerEntry(
  projectRoot: string,
  entry: LedgerEntry,
): Promise<StoredLedgerEntry> {
  const nextEntry = createStoredLedgerEntry(entry);

  for (const affectedPath of nextEntry.affected_paths) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "edit_intent_checked",
      ts: nextEntry.ts,
      path: affectedPath,
      compliant: true,
      intent: nextEntry.intent,
      ledger_entry_id: nextEntry.id,
      ledger_source: nextEntry.source,
      commit_sha: nextEntry.source === "ai" ? nextEntry.commit_sha : undefined,
      parent_sha: nextEntry.source === "human" ? nextEntry.parent_sha : undefined,
      parent_ledger_entry_id: nextEntry.source === "human" ? nextEntry.parent_ledger_entry_id : undefined,
      diff_stat: nextEntry.source === "human" ? nextEntry.diff_stat : undefined,
      annotation: nextEntry.source === "human" ? nextEntry.annotation : undefined,
      matched_rule_context_ts: null,
      window_ms: 0,
    });
  }

  return nextEntry;
}

export function createStoredLedgerEntry(entry: LedgerEntry): StoredLedgerEntry {
  return ledgerEntrySchema.parse({
    ...entry,
    id: entry.id ?? `ledger:${randomUUID()}`,
  }) as StoredLedgerEntry;
}

export async function migrateLegacyLedger(projectRoot: string): Promise<LedgerMigrationResult> {
  const { primaryPath, legacyPath } = await resolveLedgerPaths(projectRoot);
  const [primaryExists, legacyExists] = await Promise.all([
    pathExists(primaryPath),
    pathExists(legacyPath),
  ]);

  if (!legacyExists) {
    return {
      migrated: false,
      from: null,
      to: primaryPath,
    };
  }

  if (!primaryExists) {
    await ensureParentDirectory(primaryPath);
    await copyFile(legacyPath, primaryPath);
  }

  await rm(legacyPath, { force: true });

  return {
    migrated: true,
    from: legacyPath,
    to: primaryPath,
  };
}

function parseLedgerLine(line: string, index: number): StoredLedgerEntry | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;

    if (parsed.kind === "mcp-event") {
      return null;
    }

    const result = ledgerEntrySchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }

    return {
      ...result.data,
      id: result.data.id ?? createDerivedId(index, line),
    };
  } catch {
    return null;
  }
}

async function readLedgerFromEventLedger(projectRoot: string): Promise<StoredLedgerEntry[]> {
  const events = await readEventLedger(projectRoot);
  const grouped = new Map<string, StoredLedgerEntry>();

  for (const event of events) {
    const entry = projectLedgerEvent(event);
    if (entry === null) {
      continue;
    }

    const existing = grouped.get(entry.id);
    if (existing === undefined) {
      grouped.set(entry.id, entry);
      continue;
    }

    grouped.set(entry.id, {
      ...existing,
      ts: Math.min(existing.ts, entry.ts),
      affected_paths: dedupeStrings([...existing.affected_paths, ...entry.affected_paths]),
    });
  }

  return Array.from(grouped.values());
}

function projectLedgerEvent(event: StoredEventLedgerEvent): StoredLedgerEntry | null {
  if (event.event_type !== "edit_intent_checked") {
    return null;
  }

  const base = {
    id: event.ledger_entry_id,
    ts: event.ts,
    intent: event.intent,
    affected_paths: [event.path],
  };

  if (event.ledger_source === "human") {
    return {
      ...base,
      source: "human",
      parent_sha: event.parent_sha ?? event.ledger_entry_id,
      parent_ledger_entry_id: event.parent_ledger_entry_id,
      diff_stat: event.diff_stat ?? "event-ledger",
      annotation: event.annotation,
    };
  }

  return {
    ...base,
    source: "ai",
    commit_sha: event.commit_sha,
  };
}

function mergeLedgerEntries(
  legacyEntries: StoredLedgerEntry[],
  eventEntries: StoredLedgerEntry[],
): StoredLedgerEntry[] {
  const byId = new Map<string, StoredLedgerEntry>();

  for (const entry of [...legacyEntries, ...eventEntries]) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, entry);
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.ts - right.ts);
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function createDerivedId(index: number, line: string): string {
  return `ledger:${index + 1}:${sha256(line).slice("sha256:".length)}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
