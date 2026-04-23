import { randomUUID } from "node:crypto";
import { access, appendFile, copyFile, readFile, rm } from "node:fs/promises";

import { ledgerEntrySchema, type LedgerEntry } from "@fenglimg/fabric-shared";

import {
  ensureParentDirectory,
  getLegacyLedgerPath,
  getLedgerPath,
  isNodeError,
  sha256,
} from "./_shared.js";

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
    .filter((entry): entry is StoredLedgerEntry => entry !== null)
    .filter((entry) => options.source === undefined || entry.source === options.source)
    .filter((entry) => options.since === undefined || entry.ts >= options.since);
}

export async function appendLedgerEntry(
  projectRoot: string,
  entry: LedgerEntry,
): Promise<StoredLedgerEntry> {
  const ledgerPath = getLedgerPath(projectRoot);
  const nextEntry = ledgerEntrySchema.parse({
    ...entry,
    id: entry.id ?? `ledger:${randomUUID()}`,
  }) as StoredLedgerEntry;

  await ensureParentDirectory(ledgerPath);
  await appendFile(ledgerPath, `${JSON.stringify(nextEntry)}\n`, "utf8");

  return nextEntry;
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
