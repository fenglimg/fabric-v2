import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ledgerEntrySchema, type LedgerEntry } from "@fenglimg/fabric-shared";

import { LEDGER_FILE, isNodeError, sha256 } from "./_shared.js";

export type LedgerSourceFilter = "ai" | "human";

export type StoredLedgerEntry = LedgerEntry & {
  id: string;
};

export type ReadLedgerOptions = {
  source?: LedgerSourceFilter;
  since?: number;
};

export async function readLedger(
  projectRoot: string,
  options: ReadLedgerOptions = {},
): Promise<StoredLedgerEntry[]> {
  const ledgerPath = join(projectRoot, LEDGER_FILE);
  let raw: string;

  try {
    raw = await readFile(ledgerPath, "utf8");
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
    .filter((entry): entry is StoredLedgerEntry => entry !== null)
    .filter((entry) => options.source === undefined || entry.source === options.source)
    .filter((entry) => options.since === undefined || entry.ts >= options.since);
}

export async function appendLedgerEntry(
  projectRoot: string,
  entry: LedgerEntry,
): Promise<StoredLedgerEntry> {
  const ledgerPath = join(projectRoot, LEDGER_FILE);
  const nextEntry = ledgerEntrySchema.parse({
    ...entry,
    id: entry.id ?? `ledger:${randomUUID()}`,
  }) as StoredLedgerEntry;

  await appendFile(ledgerPath, `${JSON.stringify(nextEntry)}\n`, "utf8");

  return nextEntry;
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

function createDerivedId(index: number, line: string): string {
  return `ledger:${index + 1}:${sha256(line).slice("sha256:".length)}`;
}
