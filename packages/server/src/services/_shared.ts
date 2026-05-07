import { dirname, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";

export { atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

export const FABRIC_DIR = ".fabric";
export const LEDGER_FILE = ".intent-ledger.jsonl";
export const LEDGER_PATH = `${FABRIC_DIR}/${LEDGER_FILE}`;
export const LEGACY_LEDGER_PATH = LEDGER_FILE;
export const EVENT_LEDGER_FILE = "events.jsonl";
export const EVENT_LEDGER_PATH = `${FABRIC_DIR}/${EVENT_LEDGER_FILE}`;

export function getLedgerPath(projectRoot: string): string {
  return join(projectRoot, LEDGER_PATH);
}

export function getLegacyLedgerPath(projectRoot: string): string {
  return join(projectRoot, LEGACY_LEDGER_PATH);
}

export function getEventLedgerPath(projectRoot: string): string {
  return join(projectRoot, EVENT_LEDGER_PATH);
}

export async function ensureParentDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export function assertPathWithinProjectRoot(projectRoot: string, file: string): string {
  const normalizedProjectRoot = resolve(projectRoot);
  const absolutePath = resolve(normalizedProjectRoot, file);
  const rootPrefix = normalizedProjectRoot.endsWith(sep)
    ? normalizedProjectRoot
    : `${normalizedProjectRoot}${sep}`;

  if (!absolutePath.startsWith(rootPrefix)) {
    throw new Error(`Path escapes project root: ${file}`);
  }

  return absolutePath;
}
