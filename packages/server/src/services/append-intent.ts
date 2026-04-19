import type { AiLedgerEntry } from "@fenglimg/fabric-shared";

import { appendLedgerEntry, type StoredLedgerEntry } from "./read-ledger.js";

export type AppendIntentInput = {
  entry: Omit<AiLedgerEntry, "id" | "source" | "ts">;
};

export type AppendIntentResult = {
  success: true;
  timestamp: number;
  entry: StoredLedgerEntry;
};

export async function appendIntent(
  projectRoot: string,
  input: AppendIntentInput,
): Promise<AppendIntentResult> {
  const ts = Date.now();
  const entry = await appendLedgerEntry(projectRoot, {
    ...input.entry,
    ts,
    source: "ai",
  });

  return {
    success: true,
    timestamp: ts,
    entry,
  };
}
