import { describe, expect, it } from "vitest";

import {
  citeContractMetricsSchema,
  citeCoverageReportSchema,
  citeLayerTypeBreakdownSchema,
  FabExtractKnowledgeInputSchema,
  FabExtractKnowledgeOutputSchema,
  FabReviewInputSchema,
  FabReviewOutputSchema,
  planContextInputSchema,
  planContextOutputSchema,
  knowledgeSectionsInputSchema,
  knowledgeSectionsOutputSchema,
} from "../src/schemas/api-contracts";
import { zhCNMessages } from "../src/i18n/locales/zh-CN";
import { enMessages } from "../src/i18n/locales/en";

// Minimal valid description payload used by description_index roundtrip tests.
const validDescription = {
  summary: "UI batch rendering rules",
  intent_clues: ["dc"],
  tech_stack: ["Cocos"],
  impact: ["perf"],
  must_read_if: "when",
};

// Minimal valid plan-context output used to roundtrip an index item with/without tags.
// v2.0-rc.7 T9: `selection_token` is required on every response (degenerate
// single-stage mode removed — see docs/decisions/rc5-a3-superseded.md).
// `shared.required_stable_ids`/`shared.ai_selectable_stable_ids` were removed
// in rc.5 A3; per-entry selection ceremony fields gone.
function buildPlanContextOutput(extraIndexFields: Record<string, unknown>) {
  return {
    revision_hash: "rev",
    stale: false,
    selection_token: "selection:rev:test:fixture",
    entries: [],
    shared: {
      description_index: [
        {
          stable_id: "ui-batch-rendering",
          level: "L1" as const,
          required: false,
          selectable: true,
          description: validDescription,
          ...extraIndexFields,
        },
      ],
      preflight_diagnostics: [],
    },
  };
}

describe("RuleDescriptionIndexItem (api-contracts) — tags surface", () => {
  it("accepts an index item without tags (legacy)", () => {
    const parsed = planContextOutputSchema.parse(buildPlanContextOutput({}));
    const item = parsed.shared.description_index[0]!;
    expect(item.tags).toBeUndefined();
  });

  it("accepts an index item with tags array (rc.2)", () => {
    const parsed = planContextOutputSchema.parse(
      buildPlanContextOutput({ tags: ["typescript", "ui"] }),
    );
    const item = parsed.shared.description_index[0]!;
    expect(item.tags).toEqual(["typescript", "ui"]);
  });
});

describe("PlanContextInput — layer_filter", () => {
  it("accepts layer_filter='team'", () => {
    const parsed = planContextInputSchema.parse({
      paths: ["src/a.ts"],
      layer_filter: "team",
    });
    expect(parsed.layer_filter).toBe("team");
  });

  it("accepts layer_filter='personal'", () => {
    const parsed = planContextInputSchema.parse({
      paths: ["src/a.ts"],
      layer_filter: "personal",
    });
    expect(parsed.layer_filter).toBe("personal");
  });

  it("accepts layer_filter='both'", () => {
    const parsed = planContextInputSchema.parse({
      paths: ["src/a.ts"],
      layer_filter: "both",
    });
    expect(parsed.layer_filter).toBe("both");
  });

  it("parses cleanly when layer_filter is missing (regression: default routed via fabric-config)", () => {
    const parsed = planContextInputSchema.parse({ paths: ["src/a.ts"] });
    expect(parsed.layer_filter).toBeUndefined();
  });

  it("rejects an unknown layer_filter value", () => {
    const result = planContextInputSchema.safeParse({
      paths: ["src/a.ts"],
      layer_filter: "global",
    });
    expect(result.success).toBe(false);
  });
});

describe("GetRuleSectionsResult — redirect_to", () => {
  it("accepts redirect_to populated post-layer-flip", () => {
    const parsed = knowledgeSectionsOutputSchema.parse({
      revision_hash: "r",
      precedence: ["L2", "L1", "L0"],
      selected_stable_ids: [],
      rules: [],
      diagnostics: [],
      redirect_to: { stable_id: "KT-DEC-0099" },
    });
    expect(parsed.redirect_to?.stable_id).toBe("KT-DEC-0099");
  });

  it("parses cleanly when redirect_to is absent (regression)", () => {
    const parsed = knowledgeSectionsOutputSchema.parse({
      revision_hash: "r",
      precedence: ["L2", "L1", "L0"],
      selected_stable_ids: [],
      rules: [],
      diagnostics: [],
    });
    expect(parsed.redirect_to).toBeUndefined();
  });
});

// v2.0.0-rc.23 TASK-013 (F8b): the `sections` enum input parameter was
// retired alongside the A-set heading discipline. The schema now expects
// only `selection_token` + `ai_selected_stable_ids` + `ai_selection_reasons`.
describe("knowledgeSectionsInputSchema — rc.23 F8b shape", () => {
  it("accepts a payload without a `sections` field", () => {
    const parsed = knowledgeSectionsInputSchema.parse({
      selection_token: "selection:rev:abc",
      ai_selected_stable_ids: ["ui-batch-rendering"],
      ai_selection_reasons: { "ui-batch-rendering": "UI touch" },
    });
    expect(parsed.selection_token).toBe("selection:rev:abc");
    expect(parsed.ai_selected_stable_ids).toEqual(["ui-batch-rendering"]);
  });

  it("strips an unknown legacy `sections` key (back-compat: rejected silently by z.object)", () => {
    // zod default object behavior strips unknown keys; the test pins that
    // a pre-rc.23 caller passing the retired field still parses (parsed
    // object has no `sections` property).
    const parsed = knowledgeSectionsInputSchema.parse({
      selection_token: "selection:rev:abc",
      ai_selected_stable_ids: [],
      ai_selection_reasons: {},
      sections: ["MISSION_STATEMENT"],
    } as Record<string, unknown>);
    expect((parsed as Record<string, unknown>).sections).toBeUndefined();
  });
});

describe("knowledgeSectionsOutputSchema — rc.23 F8b body shape", () => {
  it("accepts rules[].body as a string and rejects legacy sections record", () => {
    const parsed = knowledgeSectionsOutputSchema.parse({
      revision_hash: "r",
      precedence: ["L2", "L1", "L0"],
      selected_stable_ids: ["ui-batch-rendering"],
      rules: [
        {
          stable_id: "ui-batch-rendering",
          level: "L1",
          path: ".fabric/knowledge/guidelines/ui.md",
          body: "# UI\n\n## Summary\n\nKeep frames stable.\n",
        },
      ],
      diagnostics: [],
    });
    expect(parsed.rules[0]!.body).toContain("Keep frames stable");
  });

  it("rejects a rule entry missing the body field", () => {
    const result = knowledgeSectionsOutputSchema.safeParse({
      revision_hash: "r",
      precedence: ["L2", "L1", "L0"],
      selected_stable_ids: ["x"],
      rules: [
        {
          stable_id: "x",
          level: "L1",
          path: "x.md",
        },
      ],
      diagnostics: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("FabExtractKnowledgeInputSchema", () => {
  // v2.0.0-rc.7 T6: proposed_reason + session_context are now required.
  // v2.0.0-rc.7 T5: source_sessions[] array form + single-string back-compat shim.
  const requiredExtras = {
    proposed_reason: "diagnostic-then-fix" as const,
    session_context:
      "Session goal: validate oauth strategy contract. Turning point: chose PKCE flow over implicit.",
  };

  it("accepts a fully populated valid payload (T5 array form + T6 reason+context)", () => {
    const parsed = FabExtractKnowledgeInputSchema.parse({
      source_sessions: ["sess-001"],
      recent_paths: ["packages/shared/src/index.ts"],
      user_messages_summary: "user wants to capture an oauth decision",
      type: "decisions",
      slug: "oauth-strategy",
      ...requiredExtras,
    });
    expect(parsed.type).toBe("decisions");
    expect(parsed.slug).toBe("oauth-strategy");
    expect(parsed.source_sessions).toEqual(["sess-001"]);
    expect(parsed.proposed_reason).toBe("diagnostic-then-fix");
  });

  // rc.23 TASK-003 (F5): the pre-T5 single-string `source_session` alias was
  // removed. Callers must use `source_sessions: string[]` directly; the schema
  // no longer accepts the singular form via a back-compat shim.
  it("rc.23: rejects legacy single source_session string (no back-compat shim)", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_session: "sess-legacy",
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "x",
      ...requiredExtras,
    });
    // The unknown `source_session` key is stripped by the default object
    // contract; superRefine then fails because `source_sessions` is absent.
    expect(result.success).toBe(false);
  });

  it("rejects payload missing source_sessions", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "x",
      ...requiredExtras,
    });
    expect(result.success).toBe(false);
  });

  it("T6: rejects payload missing proposed_reason", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-x"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "x",
      session_context: requiredExtras.session_context,
    });
    expect(result.success).toBe(false);
  });

  it("T6: rejects payload missing session_context", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-x"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "x",
      proposed_reason: "diagnostic-then-fix",
    });
    expect(result.success).toBe(false);
  });

  it("T6: rejects unknown proposed_reason enum value", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-x"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "x",
      proposed_reason: "made-up-reason",
      session_context: requiredExtras.session_context,
    });
    expect(result.success).toBe(false);
  });

  // v2.0.0-rc.8 A1: relevance_scope / relevance_paths surface coverage.
  it("A1: accepts narrow + relevance_paths array", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-rel"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "rel-narrow",
      relevance_scope: "narrow",
      relevance_paths: ["src/**"],
      ...requiredExtras,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relevance_scope).toBe("narrow");
      expect(result.data.relevance_paths).toEqual(["src/**"]);
    }
  });

  it("A1: accepts broad + empty paths array", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-rel"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "rel-broad",
      relevance_scope: "broad",
      relevance_paths: [],
      ...requiredExtras,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relevance_scope).toBe("broad");
      expect(result.data.relevance_paths).toEqual([]);
    }
  });

  it("A1: omitting relevance fields stays valid (defaults applied downstream)", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-rel"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "rel-omit",
      ...requiredExtras,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relevance_scope).toBeUndefined();
      expect(result.data.relevance_paths).toBeUndefined();
    }
  });

  it("A1: rejects unknown relevance_scope enum value", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-rel"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "rel-bad-scope",
      relevance_scope: "global",
      ...requiredExtras,
    });
    expect(result.success).toBe(false);
  });

  it("A1: rejects relevance_paths with non-string items", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-rel"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "rel-bad-paths",
      relevance_paths: ["src/**", 42],
      ...requiredExtras,
    });
    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // v2.0.0-rc.23 TASK-006 (a-C1): four optional structured triage fields
  // -------------------------------------------------------------------------

  it("C1: accepts payload that omits all four new triage fields (backward compat)", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-c1-omit"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "c1-omit",
      ...requiredExtras,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent_clues).toBeUndefined();
      expect(result.data.tech_stack).toBeUndefined();
      expect(result.data.impact).toBeUndefined();
      expect(result.data.must_read_if).toBeUndefined();
    }
  });

  it("C1: accepts payload that fills all four triage fields", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-c1-fill"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "c1-fill",
      intent_clues: ["when editing batch UI code", "NOT for one-off scripts"],
      tech_stack: ["typescript", "cocos-creator"],
      impact: ["O(n²) re-render on every frame"],
      must_read_if: "touching anything under packages/cli/src/commands/hooks.ts",
      ...requiredExtras,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent_clues).toEqual([
        "when editing batch UI code",
        "NOT for one-off scripts",
      ]);
      expect(result.data.tech_stack).toEqual(["typescript", "cocos-creator"]);
      expect(result.data.impact).toEqual(["O(n²) re-render on every frame"]);
      expect(result.data.must_read_if).toBe(
        "touching anything under packages/cli/src/commands/hooks.ts",
      );
    }
  });

  it("C1: accepts payload that fills a subset of the four triage fields", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-c1-subset"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "c1-subset",
      tech_stack: ["typescript"],
      must_read_if: "auditing cite-policy logs",
      ...requiredExtras,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent_clues).toBeUndefined();
      expect(result.data.tech_stack).toEqual(["typescript"]);
      expect(result.data.impact).toBeUndefined();
      expect(result.data.must_read_if).toBe("auditing cite-policy logs");
    }
  });

  it("C1: rejects intent_clues / tech_stack / impact with non-string items", () => {
    for (const bad of [
      { intent_clues: ["ok", 42] as unknown },
      { tech_stack: ["ts", false] as unknown },
      { impact: [null, "ok"] as unknown },
    ]) {
      const result = FabExtractKnowledgeInputSchema.safeParse({
        source_sessions: ["sess-c1-bad"],
        recent_paths: [],
        user_messages_summary: "x",
        type: "decisions",
        slug: "c1-bad",
        ...requiredExtras,
        ...bad,
      });
      expect(result.success).toBe(false);
    }
  });

  it("C1: rejects must_read_if when not a string", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-c1-bad-must"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "c1-bad-must",
      must_read_if: ["not", "a", "string"],
      ...requiredExtras,
    });
    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // v2.0.0-rc.23 TASK-014 (F8c): onboard_slot S5 enum
  // -------------------------------------------------------------------------

  it("F8c: accepts each of the five locked S5 slot values", () => {
    const slots = [
      "tech-stack-decision",
      "architecture-pattern",
      "code-style-tone",
      "build-system-idiom",
      "domain-vocabulary",
    ] as const;
    for (const slot of slots) {
      const result = FabExtractKnowledgeInputSchema.safeParse({
        source_sessions: ["sess-onboard-good"],
        recent_paths: [],
        user_messages_summary: "x",
        type: "decisions",
        slug: `onboard-${slot}`,
        onboard_slot: slot,
        ...requiredExtras,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.onboard_slot).toBe(slot);
      }
    }
  });

  it("F8c: rejects an unknown slot value (anti-drift guard for the locked S5)", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-onboard-bad"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "onboard-bad",
      onboard_slot: "release-process", // not in S5
      ...requiredExtras,
    });
    expect(result.success).toBe(false);
  });

  it("F8c: omitting onboard_slot stays valid (steady-state non-onboard call)", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-onboard-omit"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "no-onboard",
      ...requiredExtras,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.onboard_slot).toBeUndefined();
    }
  });
});

describe("FabExtractKnowledgeOutputSchema", () => {
  it("accepts a valid output payload", () => {
    const parsed = FabExtractKnowledgeOutputSchema.parse({
      pending_path: ".fabric/knowledge/pending/foo.md",
      idempotency_key: "k-abc",
    });
    expect(parsed.pending_path).toContain("pending");
  });
});

describe("FabReviewInputSchema (discriminated union)", () => {
  it("accepts action='list'", () => {
    const parsed = FabReviewInputSchema.parse({
      action: "list",
      filters: { type: "decisions", layer: "team" },
    });
    expect(parsed.action).toBe("list");
  });

  it("accepts action='approve'", () => {
    const parsed = FabReviewInputSchema.parse({
      action: "approve",
      pending_paths: [".fabric/knowledge/pending/a.md"],
    });
    expect(parsed.action).toBe("approve");
  });

  it("accepts action='reject'", () => {
    const parsed = FabReviewInputSchema.parse({
      action: "reject",
      pending_paths: [".fabric/knowledge/pending/a.md"],
      reason: "duplicate of KT-DEC-0001",
    });
    expect(parsed.action).toBe("reject");
  });

  it("accepts action='modify' with layer-flip change", () => {
    const parsed = FabReviewInputSchema.parse({
      action: "modify",
      pending_path: ".fabric/knowledge/pending/a.md",
      changes: { layer: "personal", tags: ["typescript"] },
    });
    expect(parsed.action).toBe("modify");
    if (parsed.action === "modify") {
      expect(parsed.changes.layer).toBe("personal");
    }
  });

  it("accepts action='search'", () => {
    const parsed = FabReviewInputSchema.parse({
      action: "search",
      query: "oauth",
      filters: { tags: ["security"] },
    });
    expect(parsed.action).toBe("search");
  });

  it("accepts action='defer'", () => {
    const parsed = FabReviewInputSchema.parse({
      action: "defer",
      pending_paths: [".fabric/knowledge/pending/a.md"],
      until: "2026-06-01T00:00:00Z",
      reason: "needs more context",
    });
    expect(parsed.action).toBe("defer");
  });

  it("rejects an unknown action", () => {
    const result = FabReviewInputSchema.safeParse({ action: "purge" });
    expect(result.success).toBe(false);
  });

  it("supports exhaustive switch narrowing (TS sanity)", () => {
    const inputs = [
      { action: "list" as const },
      { action: "approve" as const, pending_paths: ["x"] },
      { action: "reject" as const, pending_paths: ["x"], reason: "r" },
      {
        action: "modify" as const,
        pending_path: "x",
        changes: { tags: ["t"] },
      },
      { action: "search" as const, query: "q" },
      { action: "defer" as const, pending_paths: ["x"] },
    ];
    const labels = inputs.map((raw) => {
      const parsed = FabReviewInputSchema.parse(raw);
      switch (parsed.action) {
        case "list":
          return "list";
        case "approve":
          return `approve:${parsed.pending_paths.length}`;
        case "reject":
          return `reject:${parsed.reason}`;
        case "modify":
          return `modify:${parsed.pending_path}`;
        case "search":
          return `search:${parsed.query}`;
        case "defer":
          return `defer:${parsed.pending_paths.length}`;
      }
    });
    expect(labels).toEqual([
      "list",
      "approve:1",
      "reject:r",
      "modify:x",
      "search:q",
      "defer:1",
    ]);
  });
});

describe("FabReviewOutputSchema", () => {
  it("accepts list result", () => {
    const parsed = FabReviewOutputSchema.parse({
      action: "list",
      items: [
        {
          pending_path: "a",
          type: "decisions",
          layer: "team",
          maturity: "draft",
        },
      ],
    });
    expect(parsed.action).toBe("list");
  });

  it("accepts approve result", () => {
    const parsed = FabReviewOutputSchema.parse({
      action: "approve",
      approved: [{ pending_path: "a", stable_id: "KT-DEC-0001" }],
    });
    expect(parsed.action).toBe("approve");
  });

  it("accepts reject result", () => {
    const parsed = FabReviewOutputSchema.parse({
      action: "reject",
      rejected: ["a"],
    });
    expect(parsed.action).toBe("reject");
  });

  it("accepts modify result with layer-flip stable_id rename", () => {
    const parsed = FabReviewOutputSchema.parse({
      action: "modify",
      pending_path: "a",
      prior_stable_id: "KT-DEC-0001",
      new_stable_id: "KP-DEC-0007",
    });
    expect(parsed.action).toBe("modify");
  });

  it("accepts search result", () => {
    const parsed = FabReviewOutputSchema.parse({
      action: "search",
      items: [],
    });
    expect(parsed.action).toBe("search");
  });

  it("accepts defer result", () => {
    const parsed = FabReviewOutputSchema.parse({
      action: "defer",
      deferred: ["a"],
    });
    expect(parsed.action).toBe("defer");
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.24 TASK-09: CiteCoverageReport schema + i18n parity coverage.
// ---------------------------------------------------------------------------

// Canonical i18n key set added by TASK-09. The renderer in TASK-10 will look
// up every entry exactly through these keys, so both locales must export the
// full set and the renderer-tests must reference this same canonical list.
const CITE_COVERAGE_TASK09_KEYS = [
  "cite-coverage.contract.header",
  "cite-coverage.contract.decisions_cited",
  "cite-coverage.contract.pitfalls_cited",
  "cite-coverage.contract.with",
  "cite-coverage.contract.missing",
  "cite-coverage.contract.hard_violated",
  "cite-coverage.contract.cite_id_unresolved",
  "cite-coverage.contract.skip_count",
  "cite-coverage.contract.status.ok",
  "cite-coverage.contract.status.skipped_bootstrap_drift",
  "cite-coverage.contract.status.awaiting_marker",
  "cite-coverage.contract.type.decision",
  "cite-coverage.contract.type.pitfall",
  "cite-coverage.contract.type.model",
  "cite-coverage.contract.type.guideline",
  "cite-coverage.contract.type.process",
  "cite-coverage.contract.type.unresolved",
  "cite-coverage.layer.team",
  "cite-coverage.layer.personal",
  "cite-coverage.layer.team_review",
  "cite-coverage.layer.personal_fyi",
  "cite-coverage.skip.sequencing",
  "cite-coverage.skip.conditional",
  "cite-coverage.skip.semantic",
  "cite-coverage.skip.aesthetic",
  "cite-coverage.skip.architectural",
  "cite-coverage.skip.other",
] as const;

describe("CiteCoverageReport (rc.24 TASK-09 contract metrics schema)", () => {
  it("roundtrips a report with full contract_metrics (status='ok')", () => {
    const input = {
      status: "ok" as const,
      marker_ts: 1_700_000_000_000,
      marker_emitted_now: false,
      since_ts: 1_700_000_000_000,
      client_filter: "all" as const,
      layer_filter: "all" as const,
      metrics: {
        edits_touched: 12,
        qualifying_cites: 8,
        recalled_unverified: 1,
        expected_but_missed: 0,
        total_turns: 24,
      },
      dismissed_reason_histogram: { "scope-mismatch": 2, outdated: 1 },
      none_reason_histogram: { "no-relevant": 3, "not-applicable": 1 },
      contract_metrics_status: "ok" as const,
      contract_metrics: {
        decisions_cited: 4,
        pitfalls_cited: 2,
        contract_with: 5,
        contract_missing: 1,
        hard_violated: 1,
        cite_id_unresolved: 0,
        skip_count: { sequencing: 1, conditional: 2 },
      },
      per_layer_type: {
        team: { decision: 3, pitfall: 2, model: 1, guideline: 0, process: 0, unresolved: 0 },
        personal: { decision: 1, pitfall: 0, model: 0, guideline: 0, process: 0, unresolved: 0 },
      },
      contract_marker_ts: 1_700_000_000_000,
      generated_at: "2026-05-19T00:00:00.000Z",
    };
    const parsed = citeCoverageReportSchema.parse(input);
    // Deep-equal roundtrip: nothing dropped, nothing rewritten.
    expect(parsed).toEqual(input);
    expect(parsed.contract_metrics?.decisions_cited).toBe(4);
    expect(parsed.per_layer_type?.team.decision).toBe(3);
    expect(parsed.contract_metrics_status).toBe("ok");
  });

  it("accepts a report without contract_metrics (rc.20 backwards-compat shape)", () => {
    const parsed = citeCoverageReportSchema.parse({
      status: "ok",
      marker_ts: 0,
      marker_emitted_now: true,
      since_ts: 0,
      client_filter: "cc",
      metrics: {
        edits_touched: 0,
        qualifying_cites: 0,
        recalled_unverified: 0,
        expected_but_missed: 0,
        total_turns: 0,
      },
      generated_at: "2026-05-19T00:00:00.000Z",
    });
    // All TASK-08 additive fields stay optional → undefined on legacy payloads.
    expect(parsed.contract_metrics).toBeUndefined();
    expect(parsed.contract_metrics_status).toBeUndefined();
    expect(parsed.per_layer_type).toBeUndefined();
    expect(parsed.layer_filter).toBeUndefined();
    expect(parsed.contract_marker_ts).toBeUndefined();
  });

  it("roundtrips per_layer_type cross-tab with all six singular type keys", () => {
    const breakdown = {
      team: { decision: 2, pitfall: 1, model: 3, guideline: 0, process: 1, unresolved: 1 },
      personal: { decision: 0, pitfall: 0, model: 0, guideline: 0, process: 0, unresolved: 4 },
    };
    const parsed = citeLayerTypeBreakdownSchema.parse(breakdown);
    expect(parsed).toEqual(breakdown);
    expect(parsed.team.unresolved).toBe(1);
    expect(parsed.personal.unresolved).toBe(4);
  });

  it("rejects an invalid contract_metrics_status enum value", () => {
    const result = citeCoverageReportSchema.safeParse({
      status: "ok",
      marker_ts: 0,
      marker_emitted_now: false,
      since_ts: 0,
      client_filter: "all",
      metrics: {
        edits_touched: 0,
        qualifying_cites: 0,
        recalled_unverified: 0,
        expected_but_missed: 0,
        total_turns: 0,
      },
      contract_metrics_status: "bogus_value",
      generated_at: "2026-05-19T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "contract_metrics_status"),
      ).toBe(true);
    }
  });

  it("accepts each of the three contract_metrics_status enum values", () => {
    const baseline = {
      status: "ok" as const,
      marker_ts: 0,
      marker_emitted_now: false,
      since_ts: 0,
      client_filter: "all" as const,
      metrics: {
        edits_touched: 0,
        qualifying_cites: 0,
        recalled_unverified: 0,
        expected_but_missed: 0,
        total_turns: 0,
      },
      generated_at: "2026-05-19T00:00:00.000Z",
    };
    for (const status of ["ok", "skipped:bootstrap_drift", "awaiting_marker"] as const) {
      const parsed = citeCoverageReportSchema.parse({
        ...baseline,
        contract_metrics_status: status,
      });
      expect(parsed.contract_metrics_status).toBe(status);
    }
  });

  it("rejects an invalid layer_filter enum value", () => {
    const result = citeCoverageReportSchema.safeParse({
      status: "ok",
      marker_ts: 0,
      marker_emitted_now: false,
      since_ts: 0,
      client_filter: "all",
      layer_filter: "both", // <-- invalid: only "team" | "personal" | "all"
      metrics: {
        edits_touched: 0,
        qualifying_cites: 0,
        recalled_unverified: 0,
        expected_but_missed: 0,
        total_turns: 0,
      },
      generated_at: "2026-05-19T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("preserves the open-keyed skip_count vocabulary (operator-author extensible)", () => {
    const parsed = citeContractMetricsSchema.parse({
      decisions_cited: 0,
      pitfalls_cited: 0,
      contract_with: 0,
      contract_missing: 0,
      hard_violated: 0,
      cite_id_unresolved: 0,
      // Arbitrary keys — schema must not gatekeeper the enum (B1 grill-me lock).
      skip_count: { sequencing: 1, "tribal-knowledge": 2, "custom-reason-not-in-bootstrap": 5 },
    });
    expect(parsed.skip_count["tribal-knowledge"]).toBe(2);
    expect(parsed.skip_count["custom-reason-not-in-bootstrap"]).toBe(5);
  });
});

describe("CiteCoverageReport i18n key parity (rc.24 TASK-09)", () => {
  it("zh-CN exports every canonical TASK-09 cite-coverage key", () => {
    for (const key of CITE_COVERAGE_TASK09_KEYS) {
      expect(zhCNMessages[key], `zh-CN missing ${key}`).toBeDefined();
      expect(zhCNMessages[key]!.length).toBeGreaterThan(0);
    }
  });

  it("en exports every canonical TASK-09 cite-coverage key", () => {
    for (const key of CITE_COVERAGE_TASK09_KEYS) {
      expect(enMessages[key], `en missing ${key}`).toBeDefined();
      expect(enMessages[key]!.length).toBeGreaterThan(0);
    }
  });

  it("zh-CN and en cite-coverage.* key sets are identical (no cross-locale drift)", () => {
    const zhCiteKeys = Object.keys(zhCNMessages)
      .filter((k) => k.startsWith("cite-coverage."))
      .sort();
    const enCiteKeys = Object.keys(enMessages)
      .filter((k) => k.startsWith("cite-coverage."))
      .sort();
    expect(zhCiteKeys).toEqual(enCiteKeys);
    // Canonical superset check: every TASK-09 key is present in both.
    for (const key of CITE_COVERAGE_TASK09_KEYS) {
      expect(zhCiteKeys, `zh missing ${key}`).toContain(key);
      expect(enCiteKeys, `en missing ${key}`).toContain(key);
    }
  });
});
