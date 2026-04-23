import type { AgentsMeta } from "@fenglimg/fabric-shared";
import { describe, expect, it } from "vitest";

import type { RulesContextPayload } from "../api/client";
import { buildHitReasonItems } from "./hit-reason-panel";

describe("buildHitReasonItems", () => {
  it("shows always-on, glob, and description items with stub text", () => {
    const meta: AgentsMeta = {
      revision: "rev-1",
      nodes: {
        "L1/global": {
          file: "rules/global.md",
          scope_glob: "**/*.ts",
          deps: [],
          priority: "high",
          layer: "L1",
          topology_type: "cross-cutting",
          hash: "a",
          activation: {
            tier: "always",
          },
        },
        "L2/path": {
          file: "rules/dashboard.md",
          scope_glob: "packages/dashboard/src/**",
          deps: [],
          priority: "medium",
          layer: "L2",
          topology_type: "mirror",
          hash: "b",
          activation: {
            tier: "path",
          },
        },
        "L2/description": {
          file: "rules/desc.md",
          scope_glob: "packages/dashboard/src/**",
          deps: [],
          priority: "low",
          layer: "L2",
          topology_type: "mirror",
          hash: "c",
          activation: {
            tier: "description",
            description: "Explain the dashboard topology intent",
          },
        },
      },
    };
    const rulesContext: RulesContextPayload = {
      L0: "",
      L1: [{ path: "rules/global.md", content: "global" }],
      L2: [{ path: "rules/dashboard.md", content: "dashboard" }],
      human_locked_nearby: [],
      description_stubs: [{
        path: "rules/desc.md",
        description: "Explain the dashboard topology intent",
      }],
    };

    const items = buildHitReasonItems(meta, rulesContext);

    expect(items).toEqual([
      expect.objectContaining({
        file: "rules/dashboard.md",
        tier: "path",
        layer: "L2",
      }),
      expect.objectContaining({
        file: "rules/desc.md",
        tier: "description",
        layer: "description",
        description: "Explain the dashboard topology intent",
      }),
      expect.objectContaining({
        file: "rules/global.md",
        tier: "always",
        layer: "L1",
      }),
    ]);
  });
});
