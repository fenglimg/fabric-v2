import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { humanLockEntrySchema, type HumanLockEntry } from "@fenglimg/fabric-shared";

import { FABRIC_DIR, HUMAN_LOCK_FILE, assertPathWithinProjectRoot, isNodeError, sha256 } from "./_shared.js";

type HumanLockDocument = {
  path: string;
  rawObject: Record<string, unknown>;
  locked: HumanLockEntry[];
};

export type HumanLockStatus = HumanLockEntry & {
  drift: boolean;
  current_hash: string;
};

export async function readHumanLock(projectRoot: string): Promise<HumanLockStatus[]> {
  const document = await readHumanLockDocument(projectRoot);

  return await Promise.all(
    document.locked.map(async (entry) => {
      const currentHash = await hashHumanLockedContent(projectRoot, entry);

      return {
        ...entry,
        drift: currentHash !== entry.hash,
        current_hash: currentHash,
      };
    }),
  );
}

export async function readHumanLockEntry(
  projectRoot: string,
  file: string,
): Promise<HumanLockStatus | null> {
  const entries = await readHumanLock(projectRoot);

  return entries.find((entry) => entry.file === file) ?? null;
}

export async function readHumanLockDocument(projectRoot: string): Promise<HumanLockDocument> {
  const humanLockPath = join(projectRoot, FABRIC_DIR, HUMAN_LOCK_FILE);
  const raw = await readFile(humanLockPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Fabric human lock file is invalid: ${humanLockPath}`);
  }

  const rawObject = parsed as Record<string, unknown>;
  const lockedResult = humanLockEntrySchema.array().safeParse(rawObject.locked ?? []);

  if (!lockedResult.success) {
    throw new Error(`Fabric human lock file is invalid: ${humanLockPath}`);
  }

  return {
    path: humanLockPath,
    rawObject,
    locked: lockedResult.data,
  };
}

export async function hashHumanLockedContent(
  projectRoot: string,
  entry: HumanLockEntry,
): Promise<string> {
  const targetPath = assertPathWithinProjectRoot(projectRoot, entry.file);
  let content: string;

  try {
    content = await readFile(targetPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "missing";
    }

    throw error;
  }

  const lines = content.split(/\r?\n/);
  const slice = lines.slice(Math.max(entry.start_line - 1, 0), Math.max(entry.end_line, 0)).join("\n");

  return sha256(slice);
}
