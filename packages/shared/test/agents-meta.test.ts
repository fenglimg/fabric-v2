import { describe, expect, it } from "vitest";

import {
  agentsMetaNodeSchema,
  deriveAgentsMetaIdentitySource,
  deriveAgentsMetaStableId,
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
