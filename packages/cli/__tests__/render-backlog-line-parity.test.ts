/**
 * F-001 (GRL-STOPHOOK-AIONLY-20260709 review): parity oracle for
 * renderBacklogAgeLine literal output.
 *
 * Why: G4/G5 tests inline the human line's literal ("backlog: N high-value,
 * oldest Xd" / "backlog: 0 high-value") into their vi.doMock stubs. If the
 * real implementation in packages/server/src/services/doctor-health.ts ever
 * changes format (e.g. "high-value" → "high-val"), those tests remain green
 * but production output silently breaks. This test locks stub ↔ real byte
 * parity, so any format drift trips a red bar upstream.
 *
 * C-008 (doctor backlog metric is human-visible observability): this line is
 * the ONLY human surface after nudge_mode=silent, so byte-parity matters for
 * the 4-week rollback baseline (C-011).
 */

import { describe, expect, it } from "vitest";
import { renderBacklogAgeLine } from "@fenglimg/fabric-server";

// Byte-identical to the stub used in doctor-backlog-metric.test.ts /
// doctor-metrics-jsonl.test.ts. If this stub ever drifts from the real
// renderBacklogAgeLine, the parity assertions below will fail.
const stub = (m: { count: number; oldest_days: number | null }) =>
  m.count === 0
    ? "  backlog: 0 high-value"
    : `  backlog: ${m.count} high-value, oldest ${m.oldest_days}d`;

describe("F-001 render-backlog-line stub ↔ real parity oracle", () => {
  it("count>0 stub byte-parity with real impl", () => {
    const m = {
      count: 2,
      oldest_days: 3,
      median_age_days: 2,
      ages_days: [1, 3],
    };
    expect(stub(m)).toBe(renderBacklogAgeLine(m));
  });

  it("count=0 stub byte-parity with real impl (no age suffix)", () => {
    const m = {
      count: 0,
      oldest_days: null,
      median_age_days: 0,
      ages_days: [],
    };
    expect(stub(m)).toBe(renderBacklogAgeLine(m));
  });

  it("count=1 boundary parity", () => {
    const m = {
      count: 1,
      oldest_days: 5,
      median_age_days: 5,
      ages_days: [5],
    };
    expect(stub(m)).toBe(renderBacklogAgeLine(m));
  });

  it("large count parity", () => {
    const m = {
      count: 99,
      oldest_days: 42,
      median_age_days: 20,
      ages_days: Array(99).fill(20),
    };
    expect(stub(m)).toBe(renderBacklogAgeLine(m));
  });
});
