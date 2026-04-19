import type { HumanLedgerEntry } from "@fenglimg/fabric-shared";

import { appendLedgerEntry, readLedger, type StoredLedgerEntry } from "./read-ledger.js";

export type AnnotateIntentInput = {
  ledger_entry_id: string;
  annotation: string;
};

export type AnnotateIntentResult = {
  created: boolean;
  entry: StoredLedgerEntry;
};

export async function annotateIntent(
  projectRoot: string,
  input: AnnotateIntentInput,
): Promise<AnnotateIntentResult> {
  const entries = await readLedger(projectRoot);
  const parentEntry = entries.find((entry) => entry.id === input.ledger_entry_id);

  if (parentEntry === undefined) {
    throw new Error(`Cannot find ledger entry: ${input.ledger_entry_id}`);
  }

  const lastEntry = entries[entries.length - 1];
  if (
    lastEntry?.source === "human" &&
    lastEntry.parent_ledger_entry_id === input.ledger_entry_id &&
    lastEntry.annotation === input.annotation
  ) {
    return {
      created: false,
      entry: lastEntry,
    };
  }

  const entry = await appendLedgerEntry(projectRoot, createAnnotationEntry(parentEntry, input));

  return {
    created: true,
    entry,
  };
}

function createAnnotationEntry(
  parentEntry: StoredLedgerEntry,
  input: AnnotateIntentInput,
): HumanLedgerEntry {
  return {
    ts: Date.now(),
    source: "human",
    parent_sha: input.ledger_entry_id,
    parent_ledger_entry_id: input.ledger_entry_id,
    intent: input.annotation,
    annotation: input.annotation,
    affected_paths: parentEntry.affected_paths,
    diff_stat: "annotation",
  };
}
