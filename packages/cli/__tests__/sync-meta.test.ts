import { describe, expect, it } from "vitest";

import { agentsMetaSchema } from "@fenglimg/fabric-shared";

import { initFabric } from "../src/commands/init.ts";
import { computeAgentsMeta, deriveLayer, deriveTopologyType } from "../src/commands/sync-meta.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  readFixtureFile,
  writeFixtureFile,
} from "./helpers/init-test-utils.ts";

describe("sync-meta shadow mirroring", () => {
  it("derives layer from mirror paths", async () => {
    expect(deriveLayer(".fabric/agents/root.md")).toBe("L0");
    expect(deriveLayer(".fabric/agents/packages/server/rules.md")).toBe("L1");
    expect(deriveLayer(".fabric/agents/packages/server/routes/api.md")).toBe("L2");
    expect(deriveLayer(".fabric/agents/_cross/security.md")).toBe("L1");
  });

  it("derives topology type from mirror paths", async () => {
    expect(deriveTopologyType(".fabric/agents/packages/server/rules.md")).toBe("mirror");
    expect(deriveTopologyType(".fabric/agents/_cross/security.md")).toBe("cross-cutting");
  });

  it("migrates legacy meta and ignores colocated AGENTS.md files", async () => {
    const target = createWerewolfFixtureRoot("fab-sync-meta-shadow-mirroring");

    try {
      await initFabric(target);
      writeFixtureFile(target, ".fabric/agents/packages/server/rules.md", "# server rules\n");
      writeFixtureFile(target, ".fabric/agents/packages/server/routes/api.md", "# api rules\n");
      writeFixtureFile(target, ".fabric/agents/_cross/security.md", "# security rules\n");
      writeFixtureFile(target, "packages/server/AGENTS.md", "# legacy colocated rules\n");
      writeFixtureFile(
        target,
        ".fabric/agents.meta.json",
        `${JSON.stringify(
          {
            revision: "legacy",
            nodes: {
              L0: {
                file: ".fabric/bootstrap/README.md",
                scope_glob: "**",
                deps: [],
                priority: "high",
                hash: "sha256:legacy-root",
              },
              "legacy/server": {
                file: ".fabric/agents/packages/server/rules.md",
                scope_glob: "packages/server/**",
                deps: ["L0"],
                priority: "medium",
                hash: "sha256:legacy-server",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const meta = agentsMetaSchema.parse(computeAgentsMeta(target));

      expect(Object.values(meta.nodes).map((node) => node.file)).toEqual([
        ".fabric/bootstrap/README.md",
        ".fabric/agents/_cross/security.md",
        ".fabric/agents/packages/server/rules.md",
        ".fabric/agents/packages/server/routes/api.md",
      ]);
      expect(Object.values(meta.nodes).some((node) => node.file === "packages/server/AGENTS.md")).toBe(false);
      expect(meta.nodes.L0).toMatchObject({
        file: ".fabric/bootstrap/README.md",
        layer: "L0",
        topology_type: "mirror",
      });
      expect(meta.nodes["L1/_cross/security"]).toMatchObject({
        layer: "L1",
        topology_type: "cross-cutting",
        scope_glob: "**",
      });
      expect(meta.nodes["L1/packages/server/rules"]).toMatchObject({
        layer: "L1",
        topology_type: "mirror",
        scope_glob: "packages/server/**",
      });
      expect(meta.nodes["L2/packages/server/routes/api"]).toMatchObject({
        layer: "L2",
        topology_type: "mirror",
        scope_glob: "packages/server/routes/api/**",
      });
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("keeps init-produced L0 metadata typed from first write", async () => {
    const target = createWerewolfFixtureRoot("fab-init-meta-layer");

    try {
      await initFabric(target);

      const meta = agentsMetaSchema.parse(JSON.parse(readFixtureFile(target, ".fabric/agents.meta.json")));

      expect(meta.nodes.L0).toMatchObject({
        file: ".fabric/bootstrap/README.md",
        layer: "L0",
        topology_type: "mirror",
      });
    } finally {
      cleanupFixtureRoot(target);
    }
  });
});
