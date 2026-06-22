import { describe, expect, it } from "vitest";

import {
  citeContractMetricsSchema,
  citeCoverageReportSchema,
  citeLayerTypeBreakdownSchema,
  FabExtractKnowledgeInputSchema,
  FabExtractKnowledgeInputShape,
  FabExtractKnowledgeOutputSchema,
  FabReviewInputSchema,
  FabReviewOutputSchema,
  KnowledgeTypeSchema,
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

// Minimal valid plan-context output used to roundtrip a candidate index item
// with/without tags.
// v2.0.0-rc.38 UX-1/UX-3: per-path description_index collapsed into top-level
// `candidates`, preflight_diagnostics lifted out of the removed `shared`
// wrapper, and the index item is now just { stable_id, description } — tags now
// live on `description` (their only home after the top-level mirror removal).
function buildPlanContextOutput(extraDescriptionFields: Record<string, unknown>) {
  return {
    revision_hash: "rev",
    stale: false,
    selection_token: "selection:rev:test:fixture",
    entries: [],
    candidates: [
      {
        stable_id: "ui-batch-rendering",
        description: { ...validDescription, ...extraDescriptionFields },
      },
    ],
    preflight_diagnostics: [],
  };
}

describe("RuleDescriptionIndexItem (api-contracts) — tags surface", () => {
  it("accepts a candidate item without tags (legacy)", () => {
    const parsed = planContextOutputSchema.parse(buildPlanContextOutput({}));
    const item = parsed.candidates[0]!;
    expect(item.description.tags).toBeUndefined();
  });

  it("accepts a candidate item with tags array (rc.2)", () => {
    const parsed = planContextOutputSchema.parse(
      buildPlanContextOutput({ tags: ["typescript", "ui"] }),
    );
    const item = parsed.candidates[0]!;
    expect(item.description.tags).toEqual(["typescript", "ui"]);
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

  // v2.2 C1 (W1): author-facing scope is `audience` + `paths` only. Relevance
  // (narrow|broad) is DERIVED downstream from `paths` presence — the schema
  // surface no longer carries layer / semantic_scope / relevance_scope.
  it("C1: accepts a paths array (derives narrow downstream)", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-rel"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "rel-narrow",
      audience: "team",
      paths: ["src/**"],
      ...requiredExtras,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paths).toEqual(["src/**"]);
      expect(result.data.audience).toBe("team");
    }
  });

  it("C1: accepts an empty paths array (derives broad downstream)", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-rel"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "rel-broad",
      paths: [],
      ...requiredExtras,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paths).toEqual([]);
    }
  });

  it("C1: omitting audience + paths stays valid (engine defaults downstream)", () => {
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
      expect(result.data.audience).toBeUndefined();
      expect(result.data.paths).toBeUndefined();
    }
  });

  it("C1: rejects an audience that is not a valid scope coordinate", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-rel"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "rel-bad-audience",
      audience: "Has Spaces!",
      ...requiredExtras,
    });
    expect(result.success).toBe(false);
  });

  it("C1: rejects paths with non-string items", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      source_sessions: ["sess-rel"],
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "rel-bad-paths",
      paths: ["src/**", 42],
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
  "cite-coverage.contract.type.decisions",
  "cite-coverage.contract.type.pitfalls",
  "cite-coverage.contract.type.models",
  "cite-coverage.contract.type.guidelines",
  "cite-coverage.contract.type.processes",
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

// v2.0.0-rc.37 NEW-28: full-locale parity gate. Catches any new i18n key
// added to one locale but not the other before the bundle ships. Previously
// only the cite-coverage.* prefix had a parity test (rc.24 TASK-09); rc.37
// generalises to the entire keyspace because earlier waves (rc.26 i18n
// migration, rc.31 archive lints, rc.37 NEW-5/22/23/25/31/32 doctor checks)
// keep widening surface area faster than per-feature parity tests can keep up.
describe("Full i18n locale parity (rc.37 NEW-28)", () => {
  it("zh-CN and en expose identical key sets", () => {
    const zhKeys = Object.keys(zhCNMessages).sort();
    const enKeys = Object.keys(enMessages).sort();
    const onlyInZh = zhKeys.filter((k) => !(k in enMessages));
    const onlyInEn = enKeys.filter((k) => !(k in zhCNMessages));
    expect(onlyInZh, `keys only in zh-CN: ${onlyInZh.slice(0, 5).join(", ")}`).toEqual([]);
    expect(onlyInEn, `keys only in en: ${onlyInEn.slice(0, 5).join(", ")}`).toEqual([]);
  });

  it("no locale value is empty or whitespace-only", () => {
    for (const [key, value] of Object.entries(zhCNMessages)) {
      expect(value.trim().length, `zh-CN.${key} empty`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(enMessages)) {
      expect(value.trim().length, `en.${key} empty`).toBeGreaterThan(0);
    }
  });
});

// v2.0.0-rc.37 NEW-8: doctor remediation safety guardrail. The rc.32 GA audit
// flagged remediation copy that nudged users toward destructive recovery
// ("delete the event ledger", "rm -rf .fabric"). This test permanently bars
// any doctor remediation/actionHint string from recommending deletion of the
// event ledger, the .fabric root, or canonical knowledge entries. Deleting a
// REGENERABLE derived cache (.fabric/.cache/*) is explicitly allowed — it's the
// documented recovery for a corrupt index and loses no source-of-truth data.
describe("doctor remediation destructive-guidance guard (rc.37 NEW-8)", () => {
  // Patterns that destroy source-of-truth state. `.fabric/.cache/` deletions
  // are carved out (regenerable). Matches both English + 中文 verbs.
  const DESTRUCTIVE = [
    /\b(rm|delete|remove|删除?|清空)\b[^.\n]*\bevents\.jsonl/i, // ledger deletion
    /\brm\s+-rf?\s+[^\n]*\.fabric(?!\/\.cache)/i, // rm -rf .fabric (non-cache)
    /\b(delete|删除?|清空)\b[^.\n]*\.fabric\/(?!\.cache)(?:knowledge|events)/i, // wipe knowledge/events tree
    /\b(rm|delete|删除?)\b[^.\n]*\.fabric\/knowledge\/[^\n]*\.md/i, // delete a canonical entry file
  ];
  const isRemediationKey = (k: string): boolean =>
    /^doctor\.check\..*\.remediation/.test(k) || k.endsWith(".actionHint");

  for (const [localeName, messages] of [
    ["zh-CN", zhCNMessages],
    ["en", enMessages],
  ] as const) {
    it(`${localeName}: no remediation recommends destroying source-of-truth state`, () => {
      const offenders: string[] = [];
      for (const [key, value] of Object.entries(messages)) {
        if (!isRemediationKey(key)) continue;
        for (const pat of DESTRUCTIVE) {
          if (pat.test(value)) {
            offenders.push(`${key}: ${value.slice(0, 80)}`);
            break;
          }
        }
      }
      expect(offenders, `destructive remediation copy:\n${offenders.join("\n")}`).toEqual([]);
    });
  }
});

// rc.29 BUG-C1 — knowledge_type vocabulary has been unified to PLURAL across
// the codebase (schema, frontmatter, MCP I/O, FS layout, agents-meta, i18n).
// The previous singular ↔ plural bridge collapses to identity; this test now
// guards that the canonical enum AND the MCP-facing FabExtractKnowledge.type
// share the same plural 5-tuple — any divergence is drift.
const KNOWLEDGE_TYPE_CANONICAL_PLURAL: ReadonlyArray<string> = [
  "models",
  "decisions",
  "guidelines",
  "pitfalls",
  "processes",
];

describe("knowledge_type canonical plural invariant (rc.29 BUG-C1)", () => {
  it("KnowledgeTypeSchema equals canonical plural 5-tuple", () => {
    const expected = [...KNOWLEDGE_TYPE_CANONICAL_PLURAL].sort();
    expect([...KnowledgeTypeSchema.options].sort()).toEqual(expected);
  });

  it("FabExtractKnowledgeInputSchema.type equals canonical plural 5-tuple (MCP surface)", () => {
    const expected = [...KNOWLEDGE_TYPE_CANONICAL_PLURAL].sort();
    const typeField = FabExtractKnowledgeInputShape.type;
    expect([...typeField.options].sort()).toEqual(expected);
  });

  it("canonical and MCP-surface enums have matching cardinality", () => {
    const canonicalField = KnowledgeTypeSchema;
    const mcpField = FabExtractKnowledgeInputShape.type;
    expect(canonicalField.options.length).toBe(KNOWLEDGE_TYPE_CANONICAL_PLURAL.length);
    expect(mcpField.options.length).toBe(KNOWLEDGE_TYPE_CANONICAL_PLURAL.length);
  });
});
