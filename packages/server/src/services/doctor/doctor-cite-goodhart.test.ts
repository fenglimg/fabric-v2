import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectCiteGoodhart } from "./doctor-cite-goodhart.js";

// The G1/G2/G5 heuristics are threshold logic over the last 7 days of
// `assistant_turn_observed` events. Every case below sits ON the boundary
// (exactly at the threshold = must NOT fire, one past it = must fire), because
// an off-by-one in a threshold is the only way these functions can be wrong
// while still looking right.

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

type Commitment = { operators: []; skip_reason: string | null };

function turn(opts: {
  index: number;
  citeIds: string[];
  citeTags: Array<"applied" | "none">;
  commitments?: Commitment[];
  kbLineRaw?: string | null;
  ageMs?: number;
}) {
  const ts = Date.now() - (opts.ageMs ?? 60_000);
  return {
    kind: "fabric-event",
    id: `event:goodhart-${opts.index}`,
    ts,
    schema_version: 1,
    session_id: "s-goodhart",
    event_type: "assistant_turn_observed",
    turn_id: `t-${opts.index}`,
    kb_line_raw: opts.kbLineRaw ?? null,
    cite_ids: opts.citeIds,
    cite_tags: opts.citeTags,
    cite_commitments:
      opts.commitments ?? opts.citeIds.map(() => ({ operators: [], skip_reason: null })),
    timestamp: new Date(ts).toISOString(),
  };
}

function seedLedger(lines: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "goodhart-"));
  roots.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "events.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
  return root;
}

function firedPatterns(inspection: { fired: Array<{ pattern: string }> }): string[] {
  return inspection.fired.map((f) => f.pattern);
}

describe("inspectCiteGoodhart", () => {
  it("returns ok when the ledger is missing entirely", async () => {
    const root = mkdtempSync(join(tmpdir(), "goodhart-empty-"));
    roots.push(root);

    expect(await inspectCiteGoodhart(root)).toEqual({ status: "ok", fired: [] });
  });

  it("returns ok when no assistant turn falls inside the 7d window", async () => {
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    const root = seedLedger(
      Array.from({ length: 20 }, (_, i) =>
        turn({ index: i, citeIds: ["KT-DEC-0007"], citeTags: ["applied"], ageMs: eightDaysMs }),
      ),
    );

    expect(await inspectCiteGoodhart(root)).toEqual({ status: "ok", fired: [] });
  });

  describe("G1 ritual_cite — same id repeated as [applied]", () => {
    it("does not fire at exactly 5 repeats", async () => {
      const root = seedLedger(
        Array.from({ length: 5 }, (_, i) =>
          turn({ index: i, citeIds: ["KT-DEC-0007"], citeTags: ["applied"] }),
        ),
      );

      expect(firedPatterns(await inspectCiteGoodhart(root))).toEqual([]);
    });

    it("fires at 6 repeats and names the offending id and count", async () => {
      const root = seedLedger(
        Array.from({ length: 6 }, (_, i) =>
          turn({ index: i, citeIds: ["KT-DEC-0007"], citeTags: ["applied"] }),
        ),
      );

      const inspection = await inspectCiteGoodhart(root);

      expect(inspection.status).toBe("warn");
      expect(firedPatterns(inspection)).toEqual(["G1"]);
      expect(inspection.fired[0]?.detail).toBe("KT-DEC-0007 repeated as [applied] 6x in 7d");
    });

    it("counts per id, so 6 distinct ids spread across turns stay quiet", async () => {
      const root = seedLedger(
        Array.from({ length: 6 }, (_, i) =>
          turn({ index: i, citeIds: [`KT-DEC-000${i}`], citeTags: ["applied"] }),
        ),
      );

      expect(firedPatterns(await inspectCiteGoodhart(root))).toEqual([]);
    });

    it("ignores non-applied tags when counting repeats", async () => {
      const root = seedLedger(
        Array.from({ length: 8 }, (_, i) =>
          turn({ index: i, citeIds: ["KT-DEC-0007"], citeTags: ["none"] }),
        ),
      );

      expect(firedPatterns(await inspectCiteGoodhart(root))).not.toContain("G1");
    });
  });

  describe("G2 dismissal_abuse — skip_reason ratio on applied cites", () => {
    // Distinct ids per turn so G1 never fires and pollutes the assertion.
    function skipTurns(total: number, withSkip: number) {
      return Array.from({ length: total }, (_, i) =>
        turn({
          index: i,
          citeIds: [`KT-DEC-01${i}`],
          citeTags: ["applied"],
          commitments: [{ operators: [], skip_reason: i < withSkip ? "not-applicable" : null }],
        }),
      );
    }

    it("stays quiet below the 5-cite sample floor even at a 100% skip ratio", async () => {
      const root = seedLedger(skipTurns(4, 4));

      expect(firedPatterns(await inspectCiteGoodhart(root))).toEqual([]);
    });

    it("fires at the 5-cite floor once the ratio clears 60%", async () => {
      const root = seedLedger(skipTurns(5, 4));

      const inspection = await inspectCiteGoodhart(root);

      expect(firedPatterns(inspection)).toEqual(["G2"]);
      expect(inspection.fired[0]?.detail).toBe("4/5 applied cites used skip:<reason> (> 60%)");
    });

    it("does not fire at exactly 60% — the ratio is strictly greater-than", async () => {
      const root = seedLedger(skipTurns(10, 6));

      expect(firedPatterns(await inspectCiteGoodhart(root))).toEqual([]);
    });

    it("treats an empty-string skip_reason as no skip", async () => {
      const root = seedLedger(
        Array.from({ length: 6 }, (_, i) =>
          turn({
            index: i,
            citeIds: [`KT-DEC-02${i}`],
            citeTags: ["applied"],
            commitments: [{ operators: [], skip_reason: "" }],
          }),
        ),
      );

      expect(firedPatterns(await inspectCiteGoodhart(root))).toEqual([]);
    });
  });

  describe("G5 placeholder_cite — generic all-none turns", () => {
    it("does not fire at exactly 5 placeholder turns", async () => {
      const root = seedLedger(
        Array.from({ length: 5 }, (_, i) =>
          turn({ index: i, citeIds: [], citeTags: ["none"], kbLineRaw: "KB: none" }),
        ),
      );

      expect(firedPatterns(await inspectCiteGoodhart(root))).toEqual([]);
    });

    it("fires at 6 placeholder turns", async () => {
      const root = seedLedger(
        Array.from({ length: 6 }, (_, i) =>
          turn({ index: i, citeIds: [], citeTags: ["none"], kbLineRaw: "KB: none" }),
        ),
      );

      const inspection = await inspectCiteGoodhart(root);

      expect(firedPatterns(inspection)).toEqual(["G5"]);
      expect(inspection.fired[0]?.detail).toBe(
        '6 placeholder "KB: none" / "[unspecified]" cites in 7d',
      );
    });

    it("counts an [unspecified] marker anywhere in the raw line", async () => {
      const root = seedLedger(
        Array.from({ length: 6 }, (_, i) =>
          turn({
            index: i,
            citeIds: [],
            citeTags: ["none"],
            kbLineRaw: "KB: none [unspecified] — nothing recalled",
          }),
        ),
      );

      expect(firedPatterns(await inspectCiteGoodhart(root))).toEqual(["G5"]);
    });

    it("does not count a none-cite that carries a real bracketed reason", async () => {
      const root = seedLedger(
        Array.from({ length: 8 }, (_, i) =>
          turn({
            index: i,
            citeIds: [],
            citeTags: ["none"],
            kbLineRaw: "KB: none [no knowledge covers this path]",
          }),
        ),
      );

      expect(firedPatterns(await inspectCiteGoodhart(root))).toEqual([]);
    });

    it("does not count a turn that mixes none with an applied cite", async () => {
      const root = seedLedger(
        Array.from({ length: 8 }, (_, i) =>
          turn({
            index: i,
            citeIds: [`KT-DEC-03${i}`, `KT-GLD-03${i}`],
            citeTags: ["none", "applied"],
            kbLineRaw: "KB: none",
          }),
        ),
      );

      expect(firedPatterns(await inspectCiteGoodhart(root))).not.toContain("G5");
    });
  });

  it("reports every pattern that fired, not just the first", async () => {
    const root = seedLedger([
      // G1 + G2: one hot id, all applied cites carrying skip_reason.
      ...Array.from({ length: 6 }, (_, i) =>
        turn({
          index: i,
          citeIds: ["KT-DEC-0007"],
          citeTags: ["applied"],
          commitments: [{ operators: [], skip_reason: "outdated" }],
        }),
      ),
      // G5: six all-none placeholder turns.
      ...Array.from({ length: 6 }, (_, i) =>
        turn({ index: 100 + i, citeIds: [], citeTags: ["none"], kbLineRaw: "KB: none" }),
      ),
    ]);

    const inspection = await inspectCiteGoodhart(root);

    expect(inspection.status).toBe("warn");
    expect(firedPatterns(inspection).sort()).toEqual(["G1", "G2", "G5"]);
  });
});
