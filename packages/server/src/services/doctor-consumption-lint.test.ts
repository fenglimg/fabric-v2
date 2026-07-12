import { describe, expect, it } from "vitest";

import { aggregateConsumption } from "./doctor-consumption-lint.js";
import type { MetricsRow } from "./metrics.js";

// BORROW-005 re-wire: the pure consumption aggregator + the DATA-MATURITY GATE
// (the load-bearing fix). The gate prevents the "zero-consumed = rot" axis from
// false-alarming on a young corpus. The metrics-read + corpus-walk wrapper
// (inspectConsumption) is covered by the real-data dogfood (KT-PIT-0014).

const NOW = Date.parse("2026-06-29T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function row(daysAgo: number, counters: Record<string, number>): MetricsRow {
  return {
    timestamp: new Date(NOW - daysAgo * DAY).toISOString(),
    window: "1m",
    counters,
  };
}

// Build N distinct windows, each consuming one id, to satisfy the maturity gate.
function maturityWindows(count: number): MetricsRow[] {
  const rows: MetricsRow[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(row(i % 28, { [`knowledge_consumed:team:KT-DEC-${1000 + i}`]: 2 }));
  }
  return rows;
}

const corpus = ["team:KT-DEC-0001", "team:KT-DEC-0002", "team:KT-DEC-0003"];

describe("aggregateConsumption", () => {

  it("also aggregates knowledge_body_read: counters (post body_read cutover)", () => {
    const rows = [
      row(1, { "knowledge_body_read:team:KT-DEC-0001": 3, "knowledge_consumed:team:KT-DEC-0002": 1 }),
    ];
    const result = aggregateConsumption(rows, ["team:KT-DEC-0001", "team:KT-DEC-0002"], NOW);
    expect(result.totalConsumedEvents).toBe(4);
    expect(result.topConsumed.map((e) => e.stableId).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-DEC-0002",
    ]);
  });
  it("parses store-qualified ids from the knowledge_consumed: prefix", () => {
    const rows = [
      row(1, { "knowledge_consumed:team:KT-DEC-0001": 3, "knowledge_consumed:team:KT-DEC-0002": 1 }),
    ];
    const result = aggregateConsumption(rows, corpus, NOW);
    expect(result.topConsumed).toEqual([
      { stableId: "team:KT-DEC-0001", count: 3 },
      { stableId: "team:KT-DEC-0002", count: 1 },
    ]);
    expect(result.consumedEntries).toBe(2);
    expect(result.totalConsumedEvents).toBe(4);
    expect(result.consumedWindows).toBe(1);
  });

  it("ignores non-consumption counters and rows outside the window", () => {
    const rows = [
      row(1, { knowledge_context_planned: 5, "assistant_turn_observed:cc": 9 }),
      row(45, { "knowledge_consumed:team:KT-DEC-0001": 99 }), // older than 30d → excluded
    ];
    const result = aggregateConsumption(rows, corpus, NOW);
    expect(result.topConsumed).toEqual([]);
    expect(result.consumedWindows).toBe(0);
    expect(result.totalConsumedEvents).toBe(0);
  });

  it("SUPPRESSES zero-consumed on immature data but still surfaces the heatmap", () => {
    // 8 windows / 24 ids — the empirically-observed real-data shape that the
    // naive lint mislabeled ~150 healthy entries as rot. The gate must keep
    // zeroConsumed EMPTY here while still reporting the heatmap.
    const rows: MetricsRow[] = [];
    for (let i = 0; i < 8; i += 1) {
      rows.push(row(i, { [`knowledge_consumed:team:KT-PIT-${1000 + i}`]: 1 }));
    }
    const bigCorpus = Array.from({ length: 175 }, (_, i) => `team:KT-X-${i}`);
    const result = aggregateConsumption(rows, bigCorpus, NOW);
    expect(result.dataMature).toBe(false);
    expect(result.zeroConsumed).toEqual([]); // <-- the fix: no false alarm
    expect(result.topConsumed.length).toBeGreaterThan(0); // heatmap still useful
    expect(result.consumedWindows).toBe(8);
  });

  it("EMITS zero-consumed once the maturity thresholds are cleared", () => {
    // 35 windows, 70 events, plenty of corpus → mature. The 3 baseline corpus
    // ids are never consumed by maturityWindows() → they must appear as zero.
    const rows = maturityWindows(35);
    const fullCorpus = [...corpus, ...rows.flatMap((r) => Object.keys(r.counters).map((k) => k.slice("knowledge_consumed:".length)))];
    const result = aggregateConsumption(rows, fullCorpus, NOW);
    expect(result.dataMature).toBe(true);
    expect(result.zeroConsumed).toEqual(["team:KT-DEC-0001", "team:KT-DEC-0002", "team:KT-DEC-0003"]);
  });

  it("respects the minConsumedWindows / minConsumedEvents config overrides", () => {
    const rows = [
      row(1, { "knowledge_consumed:team:KT-DEC-0001": 1 }),
      row(2, { "knowledge_consumed:team:KT-DEC-0002": 1 }),
    ];
    // Lower the gate so 2 windows / 2 events is enough → zero-consumed fires.
    const result = aggregateConsumption(rows, corpus, NOW, {
      minConsumedWindows: 2,
      minConsumedEvents: 2,
      minTotalEntries: 3,
    });
    expect(result.dataMature).toBe(true);
    expect(result.zeroConsumed).toEqual(["team:KT-DEC-0003"]);
  });

  it("honors the topN cap", () => {
    const rows = [
      row(1, {
        "knowledge_consumed:team:A": 5,
        "knowledge_consumed:team:B": 4,
        "knowledge_consumed:team:C": 3,
      }),
    ];
    const result = aggregateConsumption(rows, corpus, NOW, { topN: 2 });
    expect(result.topConsumed.map((e) => e.stableId)).toEqual(["team:A", "team:B"]);
  });
});
