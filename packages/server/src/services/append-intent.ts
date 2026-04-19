import type { AiLedgerEntry } from "@fenglimg/fabric-shared";

import { appendEditIntentAuditEvents } from "./audit-log.js";
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

  try {
    await appendEditIntentAuditEvents(projectRoot, {
      affected_paths: entry.affected_paths,
      intent: entry.intent,
      ledger_entry_id: entry.id,
      ts,
    });
  } catch {
    // Compliance telemetry is best-effort and must not block intent recording.
  }

  return {
    success: true,
    timestamp: ts,
    entry,
  };
}
