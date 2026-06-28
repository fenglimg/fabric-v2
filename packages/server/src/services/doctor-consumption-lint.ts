// ---------------------------------------------------------------------------
// BORROW-005: consumption frequency doctor lint.
//
// Reads metrics.jsonl for the last 30 days, aggregates knowledge_consumed
// counters per stable_id, and surfaces:
//   - top-consumed entries (most frequently read — usage heatmap)
//   - zero-consumed entries (never read in the window — potential rot)
//
// The signal is advisory (info/warning), never error — consumption counts
// are only one axis of an entry's value; a broad-scope guideline may be
// legitimately consumed rarely yet structurally critical.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { Translator } from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsumptionLintConfig {
  /** Window in days (default 30). */
  windowDays: number;
  /** How many top-consumed entries to report (default 10). */
  topN: number;
  /** Minimum total entry count to avoid spurious warnings on a fresh install. */
  minTotalEntries: number;
}

export interface ConsumptionEntry {
  stableId: string;
  count: number;
}

export interface ConsumptionInspection {
  topConsumed: ConsumptionEntry[];
  zeroConsumed: string[];
  totalEntries: number;
  windowDays: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_TOP_N = 10;
const DEFAULT_MIN_TOTAL_ENTRIES = 20;

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

/**
 * Parse metrics.jsonl rows and aggregate `knowledge_consumed` counters
 * by stable_id within the window. Returns the inspection result.
 *
 * Stable_ids are extracted from the counter names by stripping the
 * `knowledge_consumed` prefix — entries in metrics.jsonl use the
 * per-stable_id convention `<prefix>:<stable_id>` (set by the server
 * when it bumps the counter).
 */
export function inspectConsumption(
  projectRoot: string,
  config?: Partial<ConsumptionLintConfig>,
): ConsumptionInspection {
  const cfg: ConsumptionLintConfig = {
    windowDays: config?.windowDays ?? DEFAULT_WINDOW_DAYS,
    topN: config?.topN ?? DEFAULT_TOP_N,
    minTotalEntries: config?.minTotalEntries ?? DEFAULT_MIN_TOTAL_ENTRIES,
  };
  const metricsPath = join(projectRoot, ".fabric", "metrics.jsonl");

  // Read and parse metrics rows within the window.
  const cutoffMs = Date.now() - cfg.windowDays * 24 * 60 * 60 * 1000;
  const consumed = new Map<string, number>();
  const consumedPrefix = "knowledge_consumed:";

  try {
    const raw = readFileSync(metricsPath, "utf8");
    const lines = raw.split(/\r?\n/u).filter(Boolean);
    for (const line of lines) {
      let row: { timestamp?: string; counters?: Record<string, number> };
      try {
        row = JSON.parse(line);
      } catch {
        continue; // skip unparseable rows
      }
      if (!row.timestamp || !row.counters) continue;
      const rowTs = Date.parse(row.timestamp);
      if (!Number.isFinite(rowTs) || rowTs < cutoffMs) continue;

      for (const [counterName, count] of Object.entries(row.counters)) {
        if (!counterName.startsWith(consumedPrefix)) continue;
        if (typeof count !== "number" || count <= 0) continue;
        const stableId = counterName.slice(consumedPrefix.length);
        if (stableId.length === 0) continue;
        consumed.set(stableId, (consumed.get(stableId) ?? 0) + count);
      }
    }
  } catch {
    // metrics.jsonl absent or unreadable — report empty.
    return {
      topConsumed: [],
      zeroConsumed: [],
      totalEntries: 0,
      windowDays: cfg.windowDays,
    };
  }

  // Sort by count descending for top-consumed.
  const sorted = [...consumed.entries()]
    .map(([stableId, count]) => ({ stableId, count }))
    .sort((a, b) => b.count - a.count);

  const topConsumed = sorted.slice(0, cfg.topN);
  const totalEntries = consumed.size;

  // Zero-consumed: entries present in the store corpus but with zero
  // consumption count in the window. The caller must supply the full
  // canonical entry list via `allStableIds`; here we maintain backward
  // compat: without it we cannot distinguish "never consumed" from
  // "no data yet", so we return an empty list.
  const zeroConsumed: string[] = [];

  return { topConsumed, zeroConsumed, totalEntries, windowDays: cfg.windowDays };
}

/**
 * Augment the zero-consumed list with an external list of all known stable_ids.
 * Call this from the doctor runner after `inspectConsumption` when the canonical
 * entry list is available (e.g. from the store read-set).
 */
export function computeZeroConsumed(
  allStableIds: string[],
  consumedMap: Map<string, number>,
): string[] {
  const zero: string[] = [];
  for (const id of allStableIds) {
    if (!consumedMap.has(id)) {
      zero.push(id);
    }
  }
  return zero;
}

// ---------------------------------------------------------------------------
// Doctor check factory
// ---------------------------------------------------------------------------

export function createConsumptionCheck(
  t: Translator,
  inspection: ConsumptionInspection,
): DoctorCheck {
  if (inspection.totalEntries === 0) {
    return {
      name: t("doctor.check.knowledge_consumption.name"),
      status: "ok",
      message: t("doctor.check.knowledge_consumption.ok.no_data"),
    };
  }

  const lines: string[] = [];
  if (inspection.topConsumed.length > 0) {
    const topLines = inspection.topConsumed
      .map((e) => `${e.stableId} (${e.count}x)`)
      .join(", ");
    lines.push(
      t("doctor.check.knowledge_consumption.message.top", {
        top: topLines,
      }),
    );
  }

  if (inspection.zeroConsumed.length > 0) {
    const zeroSample = inspection.zeroConsumed.slice(0, 10).join(", ");
    const more = inspection.zeroConsumed.length > 10
      ? t("doctor.check.knowledge_consumption.message.zero_more", {
          count: String(inspection.zeroConsumed.length - 10),
        })
      : "";
    lines.push(
      t("doctor.check.knowledge_consumption.message.zero", {
        zero: zeroSample,
        more,
      }),
    );
  }

  const message = lines.length > 0 ? lines.join(" | ") : t("doctor.check.knowledge_consumption.ok.clean");
  const status = inspection.zeroConsumed.length > 0 ? "warn" : "ok";
  const kind = status === "warn" ? "warning" as const : undefined;

  return {
    name: t("doctor.check.knowledge_consumption.name"),
    status,
    kind,
    code: status === "warn" ? "knowledge_consumption_zero" : undefined,
    message,
    actionHint: status === "warn"
      ? t("doctor.check.knowledge_consumption.remediation")
      : undefined,
  };
}
