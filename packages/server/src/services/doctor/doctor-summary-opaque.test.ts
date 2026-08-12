/**
 * Tests for `inspectKnowledgeSummaryOpaque` + `createKnowledgeSummaryOpaqueCheck`
 * — the rc.35 TASK-05 (P0-10.a) lint that surfaces the werewolf-eval failure
 * mode where description.summary == stable_id so narrow hints render as
 * "<id> · <id>" and AI clients skip the fetch.
 *
 * Cases:
 *   (a) skipped     — meta absent / invalid           → ok+skipped
 *   (b) ok          — 0 opaque                        → ok
 *   (c) ok          — 1/5 opaque (20%) under 30%      → ok (boundary below)
 *   (d) warn        — 3/5 opaque (60%) over 30%       → warn
 *   (e) check shape — warn produces sample (≤5) + remediation pointer
 */

import { describe, expect, it } from "vitest";

import { createTranslator } from "@fenglimg/fabric-shared";

import {
  createKnowledgeSummaryOpaqueCheck,
  inspectKnowledgeSummaryOpaque,
} from "./doctor.js";

type NodeStub = {
  file: string;
  scope_glob: string;
  hash: string;
  stable_id?: string;
  description?: { summary?: string };
};

function makeMeta(nodes: Record<string, NodeStub>): Parameters<typeof inspectKnowledgeSummaryOpaque>[0] {
  return {
    present: true,
    valid: true,
    meta: {
      revision: "test",
      nodes,
    },
    revision: "test",
    computedRevision: null,
    ruleCount: Object.keys(nodes).length,
    missingContentRefs: [],
    invalidContentRefs: [],
    stale: false,
    changed: false,
  } as unknown as Parameters<typeof inspectKnowledgeSummaryOpaque>[0];
}

describe("inspectKnowledgeSummaryOpaque", () => {
  it("(a) skipped when meta absent", () => {
    const inspection = inspectKnowledgeSummaryOpaque({
      present: false,
      valid: false,
      meta: null,
      revision: null,
      computedRevision: null,
      ruleCount: 0,
      missingContentRefs: [],
      invalidContentRefs: [],
      stale: true,
      changed: false,
    } as unknown as Parameters<typeof inspectKnowledgeSummaryOpaque>[0]);
    expect(inspection.status).toBe("skipped");
    expect(inspection.opaqueCount).toBe(0);
  });

  it("(b) ok with zero opaque entries", () => {
    const meta = makeMeta({
      n1: { file: "a.md", scope_glob: "*", hash: "h", stable_id: "KT-DEC-0001", description: { summary: "Alpha decision" } },
      n2: { file: "b.md", scope_glob: "*", hash: "h", stable_id: "KT-PIT-0001", description: { summary: "Beta pitfall" } },
    });
    const inspection = inspectKnowledgeSummaryOpaque(meta);
    expect(inspection.status).toBe("ok");
    expect(inspection.opaqueCount).toBe(0);
    expect(inspection.totalWithDescription).toBe(2);
  });

  it("(c) ok at 20% opacity (below 30% threshold)", () => {
    const nodes: Record<string, NodeStub> = {};
    for (let i = 0; i < 5; i++) {
      const sid = `KT-MOD-${String(i).padStart(4, "0")}`;
      const summary = i === 0 ? sid : `Distinct summary ${i}`;
      nodes[sid] = { file: `${sid}.md`, scope_glob: "*", hash: "h", stable_id: sid, description: { summary } };
    }
    const inspection = inspectKnowledgeSummaryOpaque(makeMeta(nodes));
    expect(inspection.status).toBe("ok");
    expect(inspection.opaqueCount).toBe(1);
    expect(inspection.totalWithDescription).toBe(5);
    expect(inspection.ratio).toBe(0.2);
  });

  it("(d) warn at 60% opacity (>30% threshold)", () => {
    const nodes: Record<string, NodeStub> = {};
    for (let i = 0; i < 5; i++) {
      const sid = `KT-PIT-${String(i).padStart(4, "0")}`;
      const summary = i < 3 ? sid : `Real summary ${i}`;
      nodes[sid] = { file: `${sid}.md`, scope_glob: "*", hash: "h", stable_id: sid, description: { summary } };
    }
    const inspection = inspectKnowledgeSummaryOpaque(makeMeta(nodes));
    expect(inspection.status).toBe("warn");
    expect(inspection.opaqueCount).toBe(3);
    expect(inspection.ratio).toBe(0.6);
    expect(inspection.opaqueSample).toHaveLength(3);
  });

  it("(d) trims whitespace before comparing summary to stable_id", () => {
    const nodes: Record<string, NodeStub> = {
      a: { file: "a.md", scope_glob: "*", hash: "h", stable_id: "KT-DEC-0001", description: { summary: "  KT-DEC-0001  " } },
      b: { file: "b.md", scope_glob: "*", hash: "h", stable_id: "KT-DEC-0002", description: { summary: "Distinct" } },
    };
    const inspection = inspectKnowledgeSummaryOpaque(makeMeta(nodes));
    expect(inspection.opaqueCount).toBe(1);
  });

  it("(d) ignores nodes without stable_id or without description", () => {
    const nodes: Record<string, NodeStub> = {
      a: { file: "a.md", scope_glob: "*", hash: "h" }, // no stable_id, no description
      b: { file: "b.md", scope_glob: "*", hash: "h", stable_id: "KT-MOD-0001", description: { summary: "KT-MOD-0001" } },
    };
    const inspection = inspectKnowledgeSummaryOpaque(makeMeta(nodes));
    expect(inspection.totalWithDescription).toBe(1);
    expect(inspection.opaqueCount).toBe(1);
  });

  // v2.2 全砍 F10: store knowledge (team + personal) folded into the scan so the
  // personal layer the dogfood flagged is no longer missed.
  it("(F10) folds store summaries — personal store empty-shells counted as opaque", () => {
    const meta = makeMeta({
      n1: { file: "a.md", scope_glob: "*", hash: "h", stable_id: "KT-DEC-0001", description: { summary: "Real project summary" } },
    });
    const inspection = inspectKnowledgeSummaryOpaque(meta, [
      // opaque: summary equals the bare local id (qualified id is alias-prefixed)
      { stableId: "personal:KP-DEC-0001", summary: "KP-DEC-0001", layer: "personal" },
      // opaque: empty summary
      { stableId: "personal:KP-PIT-0002", summary: "", layer: "personal" },
      // not opaque: a real team-store summary
      { stableId: "team:KT-GLD-0009", summary: "A genuine guideline summary", layer: "team" },
    ]);
    // 1 project meta entry (clean) + 3 store entries (2 opaque) = 4 total, 2 opaque.
    expect(inspection.totalWithDescription).toBe(4);
    expect(inspection.opaqueCount).toBe(2);
    expect(inspection.opaqueSample).toContain("personal:KP-DEC-0001");
    expect(inspection.opaqueSample).toContain("personal:KP-PIT-0002");
  });
});

describe("createKnowledgeSummaryOpaqueCheck", () => {
  const t = createTranslator("en");

  it("(e) warn → warning kind, code, sample inline, remediation hints fabric-review + TASK-06 fallback", () => {
    const check = createKnowledgeSummaryOpaqueCheck(t, {
      status: "warn",
      totalWithDescription: 5,
      opaqueCount: 3,
      ratio: 0.6,
      threshold: 0.30,
      opaqueSample: ["KT-PIT-0001", "KT-PIT-0002", "KT-PIT-0003"],
    });
    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
    expect(check.code).toBe("knowledge_summary_opaque");
    expect(check.message).toContain("3");
    expect(check.message).toContain("5");
    expect(check.message).toContain("KT-PIT-0001");
    expect(check.actionHint).toContain("fabric-review");
  });

  it("(e) ok → no code, no actionHint", () => {
    const check = createKnowledgeSummaryOpaqueCheck(t, {
      status: "ok",
      totalWithDescription: 5,
      opaqueCount: 1,
      ratio: 0.2,
      threshold: 0.30,
      opaqueSample: [],
    });
    expect(check.status).toBe("ok");
  });
});
