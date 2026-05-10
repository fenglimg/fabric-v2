import { describe, expect, it } from "vitest";

import {
  agentsMetaNodeSchema,
  agentsMetaSchema,
  allocateKnowledgeId,
  defaultAgentsMetaCounters,
  isKnowledgeStableId,
  ruleDescriptionIndexItemSchema,
  ruleDescriptionSchema,
  deriveAgentsMetaIdentitySource,
  deriveAgentsMetaStableId,
  withDerivedAgentsMetaNodeDefaults,
} from "../src/schemas/agents-meta";

describe("ruleDescriptionSchema", () => {
  it("accepts structured matching metadata without an identity field", () => {
    const parsed = ruleDescriptionSchema.parse({
      summary: "UI batch rendering rules",
      intent_clues: ["优化 drawcall", "Label 闪烁"],
      tech_stack: ["Cocos", "UI"],
      impact: ["Performance"],
      must_read_if: "修改多个 UI 节点的层级或混合模式时",
      entities: ["cc.Label", "SpriteAtlas"],
    });

    expect(parsed).toEqual({
      summary: "UI batch rendering rules",
      intent_clues: ["优化 drawcall", "Label 闪烁"],
      tech_stack: ["Cocos", "UI"],
      impact: ["Performance"],
      must_read_if: "修改多个 UI 节点的层级或混合模式时",
      entities: ["cc.Label", "SpriteAtlas"],
    });
    expect("id" in parsed).toBe(false);
  });

  it("accepts v2.0 knowledge id alongside summary so frontmatter ids round-trip", () => {
    // v2.0 (TASK-002/004): RuleDescription carries an optional knowledge id
    // (KP-/KT-{TYPE}-{NNNN}) declared in YAML frontmatter. The id is
    // path-decoupled and travels with the file content; here we just verify
    // the schema accepts it. Identity itself is still anchored by the
    // sibling `stable_id` on the meta node — Description.id only mirrors it.
    const parsed = ruleDescriptionSchema.parse({
      id: "KT-DEC-0042",
      summary: "UI batch rendering rules",
      intent_clues: ["优化 drawcall"],
      tech_stack: ["Cocos", "UI"],
      impact: ["Performance"],
      must_read_if: "修改多个 UI 节点的层级或混合模式时",
    });
    expect(parsed.id).toBe("KT-DEC-0042");
  });
});

describe("ruleDescriptionIndexItemSchema", () => {
  it("uses stable_id as identity and keeps description neutral", () => {
    const parsed = ruleDescriptionIndexItemSchema.parse({
      stable_id: "ui-batch-rendering",
      level: "L1",
      required: false,
      selectable: true,
      description: {
        summary: "UI batch rendering rules",
        intent_clues: ["优化 drawcall"],
        tech_stack: ["Cocos", "UI"],
        impact: ["Performance"],
        must_read_if: "修改多个 UI 节点的层级或混合模式时",
      },
    });

    expect(parsed.stable_id).toBe("ui-batch-rendering");
    expect(parsed.description).not.toHaveProperty("id");
    expect(parsed).not.toHaveProperty("score");
    expect(parsed).not.toHaveProperty("confidence");
    expect(parsed).not.toHaveProperty("match_reasons");
  });
});

describe("agentsMetaNodeSchema", () => {
  it("accepts registry-first nodes with content_ref, explicit level, and structured description", () => {
    const parsed = agentsMetaNodeSchema.parse({
      stable_id: "ui-batch-rendering",
      file: ".fabric/knowledge/guidelines/ui-batch-rendering.md",
      content_ref: ".fabric/knowledge/guidelines/ui-batch-rendering.md",
      scope_glob: "assets/scripts/ui/**",
      deps: [],
      priority: "medium",
      level: "L1",
      layer: "L1",
      topology_type: "domain",
      hash: "sha256:test",
      description: {
        summary: "UI batch rendering rules",
        intent_clues: ["优化 drawcall"],
        tech_stack: ["Cocos", "UI"],
        impact: ["Performance"],
        must_read_if: "修改多个 UI 节点的层级或混合模式时",
      },
    });

    expect(parsed.stable_id).toBe("ui-batch-rendering");
    expect(parsed.content_ref).toBe(".fabric/knowledge/guidelines/ui-batch-rendering.md");
    expect(parsed.level).toBe("L1");
    expect(parsed.layer).toBe("L1");
    expect(parsed.topology_type).toBe("domain");
    expect(parsed.description?.summary).toBe("UI batch rendering rules");
  });

  it("accepts nodes without activation and preserves derived defaults", () => {
    const parsed = agentsMetaNodeSchema.parse({
      file: ".fabric/agents/packages/server/AGENTS.md",
      scope_glob: "packages/server/**",
      deps: [],
      priority: "medium",
      hash: "sha256:test",
    });

    expect(parsed.activation).toBeUndefined();
    expect(parsed.layer).toBe("L1");
    expect(parsed.topology_type).toBe("mirror");
  });

  it("accepts optional activation tiers and preserves activation through derived defaults", () => {
    const parsed = agentsMetaNodeSchema.parse({
      file: ".fabric/agents/_cross/typescript.md",
      scope_glob: "**/*.ts",
      deps: [],
      priority: "high",
      hash: "sha256:cross",
      activation: {
        tier: "description",
        description: "TypeScript rules available when the task is TS-related.",
      },
    });

    expect(parsed.activation).toEqual({
      tier: "description",
      description: "TypeScript rules available when the task is TS-related.",
    });
    expect(parsed.layer).toBe("L1");
    expect(parsed.topology_type).toBe("cross-cutting");

    expect(
      withDerivedAgentsMetaNodeDefaults({
        file: ".fabric/agents/packages/server/src/AGENTS.md",
        scope_glob: "packages/server/src/**",
        deps: [],
        priority: "medium",
        hash: "sha256:derived",
        activation: {
          tier: "always",
        },
      }).activation,
    ).toEqual({ tier: "always" });
  });

  it("derives stable identity metadata when declarations are absent", () => {
    const parsed = agentsMetaNodeSchema.parse({
      file: ".fabric/agents/packages/server/rules.md",
      scope_glob: "packages/server/**",
      deps: [],
      priority: "medium",
      hash: "sha256:test",
    });

    expect(parsed.stable_id).toBe("packages/server/rules");
    expect(parsed.identity_source).toBe("derived");
    expect(deriveAgentsMetaStableId(".fabric/bootstrap/README.md")).toBe("bootstrap");
    expect(deriveAgentsMetaIdentitySource(parsed)).toBe("derived");
  });

  it("preserves declared stable identity metadata", () => {
    const parsed = agentsMetaNodeSchema.parse({
      file: ".fabric/agents/packages/server/rules.md",
      scope_glob: "packages/server/**",
      deps: [],
      priority: "medium",
      hash: "sha256:test",
      stable_id: "rules/server-core",
      identity_source: "declared",
    });

    expect(parsed.stable_id).toBe("rules/server-core");
    expect(parsed.identity_source).toBe("declared");
    expect(deriveAgentsMetaIdentitySource(parsed)).toBe("declared");
  });
});

describe("v2.0 knowledge stable_id (path-decoupled)", () => {
  it("isKnowledgeStableId recognises KP-/KT-{TYPE}-{NNNN} ids", () => {
    expect(isKnowledgeStableId("KP-MOD-0001")).toBe(true);
    expect(isKnowledgeStableId("KT-DEC-0042")).toBe(true);
    expect(isKnowledgeStableId("KT-GLD-99999")).toBe(true);
    expect(isKnowledgeStableId("KP-PIT-0007")).toBe(true);
    expect(isKnowledgeStableId("KT-PRO-1234")).toBe(true);

    // Non-knowledge ids must NOT match.
    expect(isKnowledgeStableId("rules/server-core")).toBe(false);
    expect(isKnowledgeStableId("packages/server/rules")).toBe(false);
    expect(isKnowledgeStableId("KT-XYZ-0001")).toBe(false); // bad type code
    expect(isKnowledgeStableId("KX-DEC-0001")).toBe(false); // bad layer code
    expect(isKnowledgeStableId("KT-DEC-1")).toBe(false); // counter < 4 digits
    expect(isKnowledgeStableId(undefined)).toBe(false);
  });

  it("allocateKnowledgeId returns sequential ids and advances counters", () => {
    const seed = {
      KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
      KT: { MOD: 0, DEC: 5, GLD: 0, PIT: 0, PRO: 0 },
    };
    const { id, nextCounters } = allocateKnowledgeId("team", "decision", seed);
    expect(id).toBe("KT-DEC-0006");
    expect(nextCounters.KT.DEC).toBe(6);
    // Other slots untouched.
    expect(nextCounters.KT.MOD).toBe(0);
    expect(nextCounters.KP).toEqual(seed.KP);
  });

  it("allocateKnowledgeId is pure (does not mutate input)", () => {
    const seed = defaultAgentsMetaCounters();
    const before = JSON.stringify(seed);
    allocateKnowledgeId("personal", "model", seed);
    expect(JSON.stringify(seed)).toBe(before);
  });

  it("withDerivedAgentsMetaNodeDefaults preserves declared knowledge id verbatim across path moves", () => {
    // First location.
    const original = withDerivedAgentsMetaNodeDefaults({
      file: ".fabric/knowledge/team/decisions/oauth-strategy.md",
      scope_glob: "**",
      deps: [],
      priority: "medium",
      hash: "sha256:test",
      stable_id: "KP-GLD-0003",
    });
    expect(original.stable_id).toBe("KP-GLD-0003");
    expect(original.identity_source).toBe("declared");

    // After git mv: same id, different path. Identity must NOT regenerate.
    const moved = withDerivedAgentsMetaNodeDefaults({
      file: ".fabric/knowledge/team/guidelines/oauth-strategy.md",
      scope_glob: "**",
      deps: [],
      priority: "medium",
      hash: "sha256:test",
      stable_id: "KP-GLD-0003",
    });
    expect(moved.stable_id).toBe("KP-GLD-0003");
    expect(moved.identity_source).toBe("declared");
  });

  it("agentsMetaNodeSchema accepts knowledge stable_id and marks it declared", () => {
    const parsed = agentsMetaNodeSchema.parse({
      file: ".fabric/knowledge/team/decisions/oauth.md",
      scope_glob: "**",
      deps: [],
      priority: "medium",
      hash: "sha256:k",
      stable_id: "KT-DEC-0042",
    });
    expect(parsed.stable_id).toBe("KT-DEC-0042");
    expect(parsed.identity_source).toBe("declared");
  });

  it("agentsMetaSchema accepts the optional counters envelope", () => {
    const parsed = agentsMetaSchema.parse({
      revision: "abc",
      nodes: {},
      counters: {
        KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
        KT: { MOD: 0, DEC: 5, GLD: 0, PIT: 0, PRO: 0 },
      },
    });
    expect(parsed.counters?.KT.DEC).toBe(5);
  });

  it("agentsMetaSchema loads pre-v2.0 meta (no counters) without errors", () => {
    const parsed = agentsMetaSchema.parse({
      revision: "abc",
      nodes: {},
    });
    expect(parsed.counters).toBeUndefined();
  });

  it("deriveAgentsMetaIdentitySource flags any KP-/KT- stable_id as declared", () => {
    const source = deriveAgentsMetaIdentitySource({
      file: ".fabric/knowledge/team/anywhere.md",
      stable_id: "KT-MOD-0007",
    });
    expect(source).toBe("declared");
  });
});
