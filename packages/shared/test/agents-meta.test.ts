import { describe, expect, it } from "vitest";

import {
  agentsMetaNodeSchema,
  withDerivedAgentsMetaNodeDefaults,
} from "../src/schemas/agents-meta";

describe("agentsMetaNodeSchema", () => {
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
});
