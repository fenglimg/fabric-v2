import { dirname, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { PathEscapeError } from "@fenglimg/fabric-shared/errors";

export { atomicWriteText, atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";

export const FABRIC_DIR = ".fabric";
export const LEDGER_FILE = ".intent-ledger.jsonl";
export const LEDGER_PATH = `${FABRIC_DIR}/${LEDGER_FILE}`;
export const LEGACY_LEDGER_PATH = LEDGER_FILE;
export const EVENT_LEDGER_FILE = "events.jsonl";
export const EVENT_LEDGER_PATH = `${FABRIC_DIR}/${EVENT_LEDGER_FILE}`;
// v2.0.0-rc.37 Wave B (Plan B counter-rollup): metrics sidecar for high-
// frequency counter events (knowledge_consumed / edit_intent_checked /
// knowledge_context_planned / knowledge_sections_fetched). One JSONL row per
// flush interval (60s default) carrying { timestamp, window, counters }.
export const METRICS_LEDGER_FILE = "metrics.jsonl";
export const METRICS_LEDGER_PATH = `${FABRIC_DIR}/${METRICS_LEDGER_FILE}`;

export function getLedgerPath(projectRoot: string): string {
  return join(projectRoot, LEDGER_PATH);
}

export function getLegacyLedgerPath(projectRoot: string): string {
  return join(projectRoot, LEGACY_LEDGER_PATH);
}

export function getEventLedgerPath(projectRoot: string): string {
  return join(projectRoot, EVENT_LEDGER_PATH);
}

export function getMetricsLedgerPath(projectRoot: string): string {
  return join(projectRoot, METRICS_LEDGER_PATH);
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
    throw new PathEscapeError(`Path escapes project root: ${file}`, {
      actionHint: "Ensure the file path is within the project root directory",
    });
  }

  return absolutePath;
}
