import type { AiLedgerEntry } from "@fenglimg/fabric-shared";

import { appendEditIntentAuditEvents, type EditIntentComplianceResult } from "./audit-log.js";
import { appendLedgerEntry, type StoredLedgerEntry } from "./read-ledger.js";

export type AppendIntentInput = {
  entry: Omit<AiLedgerEntry, "id" | "source" | "ts">;
};

export type AppendIntentResult = {
  success: true;
  timestamp: number;
  entry: StoredLedgerEntry;
  compliance?: EditIntentComplianceResult;
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

  let compliance: EditIntentComplianceResult | undefined;

  try {
    const auditResult = await appendEditIntentAuditEvents(projectRoot, {
      affected_paths: entry.affected_paths,
      intent: entry.intent,
      ledger_entry_id: entry.id,
      ts,
    });
    compliance = auditResult.compliance;
  } catch {
    // Compliance telemetry is best-effort and must not block intent recording.
  }

  return {
    success: true,
    timestamp: ts,
    entry,
    compliance,
  };
}
