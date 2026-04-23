import type { AgentsMetaNode } from "@fenglimg/fabric-shared";
import { describe, expect, it } from "vitest";

import { buildDirectoryCoverage } from "./coverage-heatmap";

describe("buildDirectoryCoverage", () => {
  it("marks directories as full, partial, or uncovered from scope globs", () => {
    const nodes: AgentsMetaNode[] = [
      {
        file: "packages/server/rules.md",
        scope_glob: "packages/server/**",
        deps: [],
        priority: "high",
        layer: "L1",
        topology_type: "mirror",
        hash: "server",
      },
      {
        file: "packages/dashboard/rules.md",
        scope_glob: "packages/dashboard/src/**/*.tsx",
        deps: [],
        priority: "medium",
        layer: "L2",
        topology_type: "mirror",
        hash: "dashboard",
      },
      {
        file: "notes/guide.md",
        scope_glob: "docs/*.md",
        deps: [],
        priority: "low",
        layer: "L1",
        topology_type: "cross-cutting",
        hash: "docs",
      },
    ];

    const coverage = buildDirectoryCoverage(nodes);

    expect(coverage.find((entry) => entry.path === "packages/server")).toMatchObject({
      density: "full",
    });
    expect(coverage.find((entry) => entry.path === "packages/dashboard")).toMatchObject({
      density: "partial",
    });
    expect(coverage.find((entry) => entry.path === "notes")).toMatchObject({
      density: "none",
    });
  });
});
