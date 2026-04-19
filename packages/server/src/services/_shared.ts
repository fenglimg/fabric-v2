import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";

export const FABRIC_DIR = ".fabric";
export const HUMAN_LOCK_FILE = "human-lock.json";
export const LEDGER_FILE = ".intent-ledger.jsonl";

export async function atomicWriteText(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;

  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
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
