import { describe, expect, it } from "vitest";

import {
  FabExtractKnowledgeInputSchema,
  FabExtractKnowledgeOutputSchema,
  FabReviewInputSchema,
  FabReviewOutputSchema,
  planContextInputSchema,
  planContextOutputSchema,
  knowledgeSectionsOutputSchema,
} from "../src/schemas/api-contracts";

// Minimal valid description payload used by description_index roundtrip tests.
const validDescription = {
  summary: "UI batch rendering rules",
  intent_clues: ["dc"],
  tech_stack: ["Cocos"],
  impact: ["perf"],
  must_read_if: "when",
};

// Minimal valid plan-context output used to roundtrip an index item with/without tags.
// v2.0-rc.5 A3 (TASK-007): `selection_token` is optional (omitted in
// degenerate mode); `shared.required_stable_ids`/`shared.ai_selectable_stable_ids`
// removed; per-entry selection ceremony fields gone.
function buildPlanContextOutput(extraIndexFields: Record<string, unknown>) {
  return {
    revision_hash: "rev",
    stale: false,
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

describe("FabExtractKnowledgeInputSchema", () => {
  it("accepts a fully populated valid payload", () => {
    const parsed = FabExtractKnowledgeInputSchema.parse({
      source_session: "sess-001",
      recent_paths: ["packages/shared/src/index.ts"],
      user_messages_summary: "user wants to capture an oauth decision",
      type: "decisions",
      slug: "oauth-strategy",
    });
    expect(parsed.type).toBe("decisions");
    expect(parsed.slug).toBe("oauth-strategy");
  });

  it("rejects payload missing source_session", () => {
    const result = FabExtractKnowledgeInputSchema.safeParse({
      recent_paths: [],
      user_messages_summary: "x",
      type: "decisions",
      slug: "x",
    });
    expect(result.success).toBe(false);
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
