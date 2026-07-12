// Knowledge drift unconsumed inspect (W8 extract from doctor.ts).
import type { EventLedgerEvent } from "@fenglimg/fabric-shared";

import { readEventLedger } from "./event-ledger.js";

export type DriftUnconsumedInspection = {
  status: "ok" | "warn";
  driftCount: number;
  demoteCount: number;
};

export async function inspectDriftUnconsumed(projectRoot: string): Promise<DriftUnconsumedInspection> {
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const MIN_DRIFT_FOR_WARN = 5;
  const cutoffMs = Date.now() - WINDOW_MS;
  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { status: "ok", driftCount: 0, demoteCount: 0 };
  }
  let driftCount = 0;
  let demoteCount = 0;
  for (const e of events) {
    if (e.ts < cutoffMs) continue;
    if (e.event_type === "knowledge_drift_detected") driftCount += 1;
    else if (e.event_type === "knowledge_demoted") demoteCount += 1;
  }
  // rc.36 TASK-32 review-iter-1 fix: warn whenever drift events outnumber
  // demote events by the threshold. The earlier `demoteCount === 0` form
  // cleared the warning the moment a single demote landed, even if 10 drift
  // events remained unconsumed. Per-event pairing is deferred to the rc.37
  // auto-demote pipeline; this count-delta heuristic is sufficient until then.
  const unconsumed = driftCount - demoteCount;
  return {
    status: unconsumed >= MIN_DRIFT_FOR_WARN ? "warn" : "ok",
    driftCount,
    demoteCount,
  };
}
