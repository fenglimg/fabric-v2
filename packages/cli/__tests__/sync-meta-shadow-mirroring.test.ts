import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { agentsMetaSchema } from "@fenglimg/fabric-shared";
import { describe, expect, it } from "vitest";

import { computeAgentsMeta, deriveLayer, deriveTopologyType } from "../src/commands/sync-meta.ts";

const WEREWOLF_FIXTURE = fileURLToPath(new URL("../../../examples/werewolf-minigame-stub", import.meta.url));

describe("sync-meta shadow mirroring regression", () => {
  it("derives layer and topology for mirror and cross-cutting paths", () => {
    expect(deriveLayer("AGENTS.md")).toBe("L0");
    expect(deriveLayer(".fabric/agents/root.md")).toBe("L0");
    expect(deriveLayer(".fabric/agents/assets/scripts/hunter.md")).toBe("L1");
    expect(deriveLayer(".fabric/agents/assets/scripts/balance/night-order.md")).toBe("L2");

    expect(deriveTopologyType(".fabric/agents/assets/scripts/hunter.md")).toBe("mirror");
    expect(deriveTopologyType(".fabric/agents/_cross/role-balance.md")).toBe("cross-cutting");
  });

  it("scans only shadow-mirroring markdown files and preserves layer metadata", () => {
    const meta = agentsMetaSchema.parse(computeAgentsMeta(WEREWOLF_FIXTURE));
    const shadowNodes = Object.entries(meta.nodes)
      .filter(([, node]) => node.file !== "AGENTS.md")
      .map(([id, node]) => ({
        id,
        file: node.file,
        layer: node.layer,
        topology_type: node.topology_type,
      }));

    expect(shadowNodes.every((node) => node.file.startsWith(".fabric/agents/"))).toBe(true);
    expect(shadowNodes.every((node) => node.file.endsWith(".md"))).toBe(true);
    expect(meta.nodes["L1/_cross/role-balance"]).toMatchObject({
      layer: "L1",
      topology_type: "cross-cutting",
    });
    expect(shadowNodes).toMatchInlineSnapshot(`
      [
        {
          "file": ".fabric/agents/root.md",
          "id": "L0/root",
          "layer": "L0",
          "topology_type": "mirror",
        },
        {
          "file": ".fabric/agents/_cross/role-balance.md",
          "id": "L1/_cross/role-balance",
          "layer": "L1",
          "topology_type": "cross-cutting",
        },
        {
          "file": ".fabric/agents/assets/scripts/hunter.md",
          "id": "L1/assets/scripts/hunter",
          "layer": "L1",
          "topology_type": "mirror",
        },
        {
          "file": ".fabric/agents/assets/scripts/seer.md",
          "id": "L1/assets/scripts/seer",
          "layer": "L1",
          "topology_type": "mirror",
        },
        {
          "file": ".fabric/agents/assets/scripts/villager.md",
          "id": "L1/assets/scripts/villager",
          "layer": "L1",
          "topology_type": "mirror",
        },
        {
          "file": ".fabric/agents/assets/scripts/werewolf.md",
          "id": "L1/assets/scripts/werewolf",
          "layer": "L1",
          "topology_type": "mirror",
        },
        {
          "file": ".fabric/agents/assets/scripts/witch.md",
          "id": "L1/assets/scripts/witch",
          "layer": "L1",
          "topology_type": "mirror",
        },
      ]
    `);
  });

  it("verifies business directories contain zero colocated AGENTS.md files", () => {
    const businessDirs = [join(WEREWOLF_FIXTURE, "assets")].filter((directory) => existsSync(directory));
    const colocatedAgents: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name === "AGENTS.md") {
          colocatedAgents.push(relative(WEREWOLF_FIXTURE, fullPath));
        }
      }
    };
    for (const dir of businessDirs) walk(dir);

    expect(existsSync(join(WEREWOLF_FIXTURE, "AGENTS.md"))).toBe(true);
    expect(colocatedAgents).toEqual([]);
  });

  it("upgrades legacy shadow metadata without losing node identity", () => {
    const target = cloneFixture("fab-sync-meta-legacy");

    try {
      writeFileSync(
        join(target, ".fabric", "agents.meta.json"),
        `${JSON.stringify(
          {
            revision: "legacy-shadow",
            nodes: {
              L0: {
                file: "AGENTS.md",
                scope_glob: "**",
                deps: [],
                priority: "high",
                hash: "sha256:legacy-bootstrap",
              },
              "L1/_cross/role-balance": {
                file: ".fabric/agents/_cross/role-balance.md",
                scope_glob: "**",
                deps: ["L0"],
                priority: "medium",
                hash: "sha256:legacy-cross",
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const meta = agentsMetaSchema.parse(computeAgentsMeta(target));

      expect(meta.nodes.L0).toMatchObject({
        file: "AGENTS.md",
        layer: "L0",
        topology_type: "mirror",
      });
      expect(meta.nodes["L1/_cross/role-balance"]).toMatchObject({
        file: ".fabric/agents/_cross/role-balance.md",
        layer: "L1",
        topology_type: "cross-cutting",
      });
      expect(Object.keys(meta.nodes)).toContain("L1/assets/scripts/werewolf");
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});

function cloneFixture(prefix: string): string {
  const target = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  cpSync(WEREWOLF_FIXTURE, target, { recursive: true });
  return target;
}
