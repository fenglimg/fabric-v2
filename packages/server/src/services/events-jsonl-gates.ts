// v2.0.0-rc.37 Wave B (B5): hard-gate inspections for events.jsonl /
// metrics.jsonl health. The B1 spike enumerated five gates (G7-G11) to
// prevent the rc.36 bloat pattern from re-emerging post-GA:
//
//   G7  events_jsonl_size       — warn when main ledger > 10 MB
//   G8  metric_event_in_jsonl   — warn when a counter-managed event_type
//                                  leaks into the audit ledger
//   G9  metrics_jsonl_flushed   — warn when metrics.jsonl hasn't been
//                                  appended to in > 10 minutes (timer dead)
//   G10 rotation_overdue        — warn when events.jsonl was last modified
//                                  > 90 days ago without rotation (stale)
//   G11 metric_event_added      — structural invariant: every name in
//                                  METRIC_COUNTER_NAMES is NOT in the
//                                  eventLedgerEventSchema discriminator
//
// G11 is verified at test time (unit test in this file's sibling), not at
// runtime — it's a code-time contract. G7-G10 are surfaced through the
// doctor's events_jsonl_health composite check (doctor.ts).

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";

import { getEventLedgerPath, getMetricsLedgerPath, isNodeError } from "./_shared.js";
import { readEventLedger } from "./event-ledger.js";
import { LEDGER_DUAL_WRITE_METRIC_NAMES, METRIC_COUNTER_NAMES } from "./metrics.js";

const EVENTS_JSONL_SIZE_WARN_BYTES = 10 * 1024 * 1024; // G7 default 10 MB
const METRICS_STALE_WARN_MS = 10 * 60 * 1000; // G9 default 10 min
const ROTATION_OVERDUE_WARN_MS = 90 * 24 * 60 * 60 * 1000; // G10 default 90d

// G8 leak scan: only PURE counters must never appear in the audit ledger. Every
// dual-write name (see LEDGER_DUAL_WRITE_METRIC_NAMES) is intentionally appended
// to events.jsonl because a doctor lint consumes its structured per-id/per-path
// payload — same load-bearing-audit class as assistant_turn_observed (team
// KT-DEC-0021). Flagging them is a false positive that fires on every fab_recall
// / edit, so they are subtracted from the leak set. This currently empties the
// set (all 4 counter names are dual-write-consumed → G8 dormant) but the gate
// still fires for any future pure counter NOT in the allowlist.
const LEDGER_DUAL_WRITE_VALUES = new Set<string>(Object.values(LEDGER_DUAL_WRITE_METRIC_NAMES));
const METRIC_COUNTER_VALUES = new Set<string>(
  Object.values(METRIC_COUNTER_NAMES).filter((name) => !LEDGER_DUAL_WRITE_VALUES.has(name)),
);

export type EventsJsonlGatesReport = {
  /** G7: events.jsonl actual size in bytes (0 when missing). */
  ledgerSizeBytes: number;
  /** G7: warn flag when > threshold. */
  ledgerSizeWarn: boolean;
  /** G8: metric-managed event_types leaked into the audit ledger. */
  metricLeakCount: number;
  metricLeakSamples: string[];
  /** G9: metrics.jsonl staleness — ms since last mtime; null when file missing. */
  metricsStalenessMs: number | null;
  metricsStaleWarn: boolean;
  /** G10: events.jsonl staleness — ms since last mtime; null when file missing. */
  ledgerStalenessMs: number | null;
  rotationOverdueWarn: boolean;
};

export async function inspectEventsJsonlGates(
  projectRoot: string,
  options: { now?: Date } = {},
): Promise<EventsJsonlGatesReport> {
  const now = options.now ?? new Date();
  const eventsPath = getEventLedgerPath(projectRoot);
  const metricsPath = getMetricsLedgerPath(projectRoot);

  // G7 + G10: stat events.jsonl
  let ledgerSizeBytes = 0;
  let ledgerStalenessMs: number | null = null;
  try {
    const stat = await fs.stat(eventsPath);
    ledgerSizeBytes = stat.size;
    ledgerStalenessMs = Math.max(0, now.getTime() - stat.mtimeMs);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
  }

  // G9: stat metrics.jsonl
  let metricsStalenessMs: number | null = null;
  if (existsSync(metricsPath)) {
    try {
      const stat = await fs.stat(metricsPath);
      metricsStalenessMs = Math.max(0, now.getTime() - stat.mtimeMs);
    } catch {
      // ignore
    }
  }

  // G8: scan ledger for metric-managed event_types
  let metricLeakCount = 0;
  const seen = new Set<string>();
  const metricLeakSamples: string[] = [];
  if (ledgerSizeBytes > 0) {
    try {
      const { events } = await readEventLedger(projectRoot);
      for (const event of events) {
        const eventType = (event as { event_type?: unknown }).event_type;
        if (typeof eventType !== "string") continue;
        if (METRIC_COUNTER_VALUES.has(eventType)) {
          metricLeakCount += 1;
          if (!seen.has(eventType) && metricLeakSamples.length < 5) {
            seen.add(eventType);
            metricLeakSamples.push(eventType);
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  return {
    ledgerSizeBytes,
    ledgerSizeWarn: ledgerSizeBytes > EVENTS_JSONL_SIZE_WARN_BYTES,
    metricLeakCount,
    metricLeakSamples,
    metricsStalenessMs,
    // G9 only fires when metrics.jsonl EXISTS AND is stale. Missing is fine
    // (server may have just started; no flush fired yet).
    metricsStaleWarn:
      metricsStalenessMs !== null && metricsStalenessMs > METRICS_STALE_WARN_MS,
    ledgerStalenessMs,
    rotationOverdueWarn:
      ledgerStalenessMs !== null && ledgerStalenessMs > ROTATION_OVERDUE_WARN_MS,
  };
}

/** Exposed thresholds — tests + future config overrides reference these. */
export const EVENTS_JSONL_GATE_THRESHOLDS = {
  EVENTS_JSONL_SIZE_WARN_BYTES,
  METRICS_STALE_WARN_MS,
  ROTATION_OVERDUE_WARN_MS,
} as const;
