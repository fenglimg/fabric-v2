// ---------------------------------------------------------------------------
// BORROW-005: consumption frequency inspection (advisory).
//
// Aggregates per-entry `knowledge_consumed:<qualifiedId>` counters from
// metrics.jsonl over a rolling window and surfaces two axes:
//   - top-consumed entries (usage heatmap — most frequently read)
//   - zero-consumed entries (never read in the window — potential rot)
//
// Data source: `.fabric/metrics.jsonl` rows (read via the canonical readMetrics
// reader — the same source the `fabric metrics` dashboard consumes). The per-id
// counter convention is `knowledge_consumed:<alias>:<stableId>` (store-qualified
// id), which matches StoreCanonicalEntry.qualifiedId, so zero-consumed compares
// against the qualified corpus ids directly.
//
// ⚠️ DATA-MATURITY GATE (the load-bearing fix). The naive "zero-consumed =
// rot" signal is a false-alarm generator on a young corpus: with only a handful
// of consumption windows recorded, almost every entry is "never read" — not
// because it is dead, but because consumption telemetry has barely accumulated.
// On real data this would mislabel ~150 healthy entries as rot. So the
// zero-consumed axis is GATED behind data maturity (enough consumption windows
// AND enough total consumption events); below the bar we surface only the
// top-consumed heatmap and explicitly suppress zero-consumed. The legacy
// `minTotalEntries` field gates on CORPUS size (a different axis — don't run on
// a 3-entry fresh install) and is NOT a substitute for consumption maturity.
//
// The signal is advisory (info/warn), never error, and has NO auto-fix arm —
// per KT-PIT-0016 a revived detection lint must not promise a remediation it
// will not perform. Remediation copy points at human review (fab_review), not a
// `doctor --fix` mutation.
// ---------------------------------------------------------------------------

import { readMetrics, type MetricsRow } from "./metrics.js";
import { collectStoreCanonicalEntries } from "./cross-store-recall.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsumptionLintConfig {
  /** Rolling window in days (default 30). */
  windowDays: number;
  /** How many top-consumed entries to report (default 10). */
  topN: number;
  /** Minimum CORPUS size before the lint runs at all (fresh-install guard). */
  minTotalEntries: number;
  /**
   * Data-maturity gate axis 1: minimum number of metrics windows (rows) that
   * recorded ≥1 consumption counter before zero-consumed is trustworthy.
   */
  minConsumedWindows: number;
  /**
   * Data-maturity gate axis 2: minimum total consumption events in the window
   * before zero-consumed is trustworthy.
   */
  minConsumedEvents: number;
}

export interface ConsumptionEntry {
  /** Store-qualified id (`<alias>:<stableId>`). */
  stableId: string;
  count: number;
}

export interface ConsumptionInspection {
  topConsumed: ConsumptionEntry[];
  /**
   * Corpus entries never consumed in the window. ALWAYS [] when the data is not
   * mature (dataMature === false) — the gate suppresses the noisy signal.
   */
  zeroConsumed: string[];
  /** Total corpus entries considered for the zero-consumed denominator. */
  totalEntries: number;
  /** Distinct entries with ≥1 consumption in the window. */
  consumedEntries: number;
  /** Number of metrics windows (rows) that carried ≥1 consumption counter. */
  consumedWindows: number;
  /** Sum of all consumption counts in the window. */
  totalConsumedEvents: number;
  /** True when both maturity axes clear their thresholds. */
  dataMature: boolean;
  windowDays: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_TOP_N = 10;
const DEFAULT_MIN_TOTAL_ENTRIES = 20;
// Maturity thresholds — chosen so a corpus with only a handful of recorded
// consumption windows (the empirically-observed steady state on this repo: ~8
// windows over 30 days) does NOT trip zero-consumed. Tunable via config.
const DEFAULT_MIN_CONSUMED_WINDOWS = 30;
const DEFAULT_MIN_CONSUMED_EVENTS = 50;

const CONSUMED_PREFIX = "knowledge_consumed:";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function resolveConfig(config?: Partial<ConsumptionLintConfig>): ConsumptionLintConfig {
  return {
    windowDays: config?.windowDays ?? DEFAULT_WINDOW_DAYS,
    topN: config?.topN ?? DEFAULT_TOP_N,
    minTotalEntries: config?.minTotalEntries ?? DEFAULT_MIN_TOTAL_ENTRIES,
    minConsumedWindows: config?.minConsumedWindows ?? DEFAULT_MIN_CONSUMED_WINDOWS,
    minConsumedEvents: config?.minConsumedEvents ?? DEFAULT_MIN_CONSUMED_EVENTS,
  };
}

// ---------------------------------------------------------------------------
// Pure aggregation (unit-testable with hand-built rows + id list)
// ---------------------------------------------------------------------------

/**
 * Aggregate consumption from metrics rows against the canonical corpus id list.
 * Pure — no I/O — so the windowing, prefix parsing, top-N ranking, zero-consumed
 * computation, and the maturity gate are all testable with fixtures.
 *
 * @param rows           metrics.jsonl rows (any window/order)
 * @param allQualifiedIds store-qualified ids of the canonical corpus
 * @param now            current epoch ms (injected for deterministic windowing)
 */
export function aggregateConsumption(
  rows: MetricsRow[],
  allQualifiedIds: string[],
  now: number,
  config?: Partial<ConsumptionLintConfig>,
): ConsumptionInspection {
  const cfg = resolveConfig(config);
  const cutoffMs = now - cfg.windowDays * MS_PER_DAY;

  const consumed = new Map<string, number>();
  let consumedWindows = 0;
  let totalConsumedEvents = 0;

  for (const row of rows) {
    const rowTs = Date.parse(row.timestamp);
    if (!Number.isFinite(rowTs) || rowTs < cutoffMs) continue;
    if (row.counters === null || typeof row.counters !== "object") continue;

    let windowHadConsumption = false;
    for (const [counterName, rawCount] of Object.entries(row.counters)) {
      if (!counterName.startsWith(CONSUMED_PREFIX)) continue;
      const count = typeof rawCount === "number" ? rawCount : 0;
      if (count <= 0) continue;
      const id = counterName.slice(CONSUMED_PREFIX.length);
      if (id.length === 0) continue;
      consumed.set(id, (consumed.get(id) ?? 0) + count);
      totalConsumedEvents += count;
      windowHadConsumption = true;
    }
    if (windowHadConsumption) consumedWindows += 1;
  }

  const topConsumed = [...consumed.entries()]
    .map(([stableId, count]) => ({ stableId, count }))
    .sort((a, b) => b.count - a.count || a.stableId.localeCompare(b.stableId))
    .slice(0, cfg.topN);

  const dataMature =
    consumedWindows >= cfg.minConsumedWindows &&
    totalConsumedEvents >= cfg.minConsumedEvents &&
    allQualifiedIds.length >= cfg.minTotalEntries;

  // Zero-consumed is only trustworthy on mature data — otherwise suppress it.
  const zeroConsumed = dataMature
    ? allQualifiedIds.filter((id) => !consumed.has(id)).sort((a, b) => a.localeCompare(b))
    : [];

  return {
    topConsumed,
    zeroConsumed,
    totalEntries: allQualifiedIds.length,
    consumedEntries: consumed.size,
    consumedWindows,
    totalConsumedEvents,
    dataMature,
    windowDays: cfg.windowDays,
  };
}

// ---------------------------------------------------------------------------
// Inspection (metrics read + corpus walk + pure aggregation)
// ---------------------------------------------------------------------------

/**
 * Read metrics.jsonl + the canonical corpus and aggregate consumption. Never
 * throws — readMetrics returns [] on a missing ledger and collectStoreCanonical
 * Entries returns [] when no store is in the read-set.
 *
 * `now` is injectable for deterministic tests.
 */
export async function inspectConsumption(
  projectRoot: string,
  config?: Partial<ConsumptionLintConfig>,
  now: number = Date.now(),
): Promise<ConsumptionInspection> {
  const rows = await readMetrics(projectRoot);
  const entries = await collectStoreCanonicalEntries(projectRoot);
  const allQualifiedIds = entries.map((entry) => entry.qualifiedId);
  return aggregateConsumption(rows, allQualifiedIds, now, config);
}
