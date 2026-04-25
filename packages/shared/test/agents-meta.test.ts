import { describe, expect, it } from "vitest";

import {
  agentsMetaNodeSchema,
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

  it("rejects Description.id so stable_id remains the only rule identity", () => {
    expect(() =>
      ruleDescriptionSchema.parse({
        id: "ui-batch-rendering",
        summary: "UI batch rendering rules",
        intent_clues: ["优化 drawcall"],
        tech_stack: ["Cocos", "UI"],
        impact: ["Performance"],
        must_read_if: "修改多个 UI 节点的层级或混合模式时",
      }),
    ).toThrow();
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
      file: ".fabric/rules/ui-batch-rendering.md",
      content_ref: ".fabric/rules/ui-batch-rendering.md",
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
    expect(parsed.content_ref).toBe(".fabric/rules/ui-batch-rendering.md");
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
