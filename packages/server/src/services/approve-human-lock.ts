import type { HumanLedgerEntry } from "@fenglimg/fabric-shared";

import { assertPathWithinProjectRoot, atomicWriteText } from "./_shared.js";
import { appendLedgerEntry, type StoredLedgerEntry } from "./read-ledger.js";
import {
  hashHumanLockedContent,
  readHumanLockDocument,
  type HumanLockStatus,
} from "./read-human-lock.js";

export type ApproveHumanLockInput = {
  file: string;
  start_line: number;
  end_line: number;
  new_hash: string;
};

export type ApproveHumanLockResult = {
  updated: boolean;
  entry: HumanLockStatus;
  ledger_entry?: StoredLedgerEntry;
};

export async function approveHumanLock(
  projectRoot: string,
  input: ApproveHumanLockInput,
): Promise<ApproveHumanLockResult> {
  assertPathWithinProjectRoot(projectRoot, input.file);
  const document = await readHumanLockDocument(projectRoot);
  const index = document.locked.findIndex(
    (entry) =>
      entry.file === input.file &&
      entry.start_line === input.start_line &&
      entry.end_line === input.end_line,
  );

  if (index === -1) {
    throw new Error(`Cannot find human lock entry: ${input.file}:${input.start_line}-${input.end_line}`);
  }

  const currentEntry = document.locked[index];
  if (currentEntry === undefined) {
    throw new Error(`Cannot find human lock entry: ${input.file}:${input.start_line}-${input.end_line}`);
  }

  const nextEntry = {
    ...currentEntry,
    hash: input.new_hash,
  };

  if (currentEntry.hash === input.new_hash) {
    const currentHash = await hashHumanLockedContent(projectRoot, nextEntry);

    return {
      updated: false,
      entry: {
        ...nextEntry,
        drift: currentHash !== nextEntry.hash,
        current_hash: currentHash,
      },
    };
  }

  const nextLocked = document.locked.slice();
  nextLocked[index] = nextEntry;
  const nextRawObject = {
    ...document.rawObject,
    locked: nextLocked,
  };

  await atomicWriteText(document.path, `${JSON.stringify(nextRawObject, null, 2)}\n`);
  const currentHash = await hashHumanLockedContent(projectRoot, nextEntry);

  const ledgerEntry = await appendLedgerEntry(projectRoot, createApproveLedgerEntry(input));

  return {
    updated: true,
    entry: {
      ...nextEntry,
      drift: currentHash !== nextEntry.hash,
      current_hash: currentHash,
    },
    ledger_entry: ledgerEntry,
  };
}

function createApproveLedgerEntry(input: ApproveHumanLockInput): HumanLedgerEntry {
  return {
    ts: Date.now(),
    source: "human",
    parent_sha: "human-lock:approve",
    intent: `approve human lock ${input.file}:${input.start_line}-${input.end_line}`,
    affected_paths: [input.file, ".fabric/human-lock.json"],
    diff_stat: `updated approved hash to ${input.new_hash}`,
  };
}
