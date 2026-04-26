import { existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { agentsMetaSchema, ruleTestIndexSchema } from "@fenglimg/fabric-shared";

import { initFabric } from "../src/commands/init.ts";
import {
  computeAgentsMeta,
  computeRuleTestIndex,
  deriveLayer,
  deriveTopologyType,
  syncMetaCommand,
} from "../src/commands/sync-meta.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  readFixtureFile,
  writeFixtureFile,
} from "./helpers/init-test-utils.ts";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
});

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
                stable_id: "bootstrap",
                identity_source: "derived",
              },
              "legacy/server": {
                file: ".fabric/agents/packages/server/rules.md",
                scope_glob: "packages/server/**",
                deps: ["L0"],
                priority: "medium",
                hash: "sha256:legacy-server",
                stable_id: "packages/server/rules",
                identity_source: "derived",
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

  it("extracts declared stable ids from rule comments and marks derived identities otherwise", async () => {
    const target = createWerewolfFixtureRoot("fab-sync-meta-stable-id");

    try {
      await initFabric(target);
      writeFixtureFile(
        target,
        ".fabric/agents/packages/server/rules.md",
        "<!-- fab:rule-id rules/server-core -->\n# server rules\n",
      );
      writeFixtureFile(target, ".fabric/agents/packages/server/routes/api.md", "# api rules\n");

      const meta = agentsMetaSchema.parse(computeAgentsMeta(target));

      expect(meta.nodes["L1/packages/server/rules"]).toMatchObject({
        stable_id: "rules/server-core",
        identity_source: "declared",
      });
      expect(meta.nodes["L2/packages/server/routes/api"]).toMatchObject({
        stable_id: "packages/server/routes/api",
        identity_source: "derived",
      });
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("updates revision when stable identity metadata changes", async () => {
    const target = createWerewolfFixtureRoot("fab-sync-meta-revision");

    try {
      await initFabric(target);
      writeFixtureFile(target, ".fabric/agents/packages/server/rules.md", "# server rules\n");

      const before = agentsMetaSchema.parse(computeAgentsMeta(target));

      writeFixtureFile(
        target,
        ".fabric/agents/packages/server/rules.md",
        "<!-- fab:rule-id rules/server-core -->\n# server rules\n",
      );

      const after = agentsMetaSchema.parse(computeAgentsMeta(target));

      expect(before.nodes["L1/packages/server/rules"]).toMatchObject({
        stable_id: "packages/server/rules",
        identity_source: "derived",
      });
      expect(after.nodes["L1/packages/server/rules"]).toMatchObject({
        stable_id: "rules/server-core",
        identity_source: "declared",
      });
      expect(after.revision).not.toBe(before.revision);
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("records baseline acceptance events when sync-meta rewrites agents.meta.json", async () => {
    const target = createWerewolfFixtureRoot("fab-sync-meta-events");

    try {
      await initFabric(target);
      writeFixtureFile(target, ".fabric/agents/packages/server/rules.md", "# server rules\n");
      await syncMetaCommand.run?.({
        args: {
          target,
          "check-only": false,
        },
      } as never);

      const firstEvents = readEventLedger(target);
      const meta = agentsMetaSchema.parse(JSON.parse(readFixtureFile(target, ".fabric/agents.meta.json")));
      const serverNode = meta.nodes["L1/packages/server/rules"];

      expect(firstEvents.map((event) => event.event_type)).toEqual([
        "rule_baseline_accepted",
        "baseline_synced",
      ]);
      expect(firstEvents[0]).toMatchObject({
        event_type: "rule_baseline_accepted",
        revision: meta.revision,
        accepted_stable_ids: expect.arrayContaining(["bootstrap", "packages/server/rules"]),
        source: "sync_meta",
      });
      expect(firstEvents[1]).toMatchObject({
        event_type: "baseline_synced",
        synced_files: [".fabric/agents/packages/server/rules.md"],
        accepted_stable_ids: expect.arrayContaining(["bootstrap", "packages/server/rules"]),
        source: "sync_meta",
      });

      writeFixtureFile(target, ".fabric/agents/packages/server/rules.md", "# server rules\n\nChanged.\n");
      await syncMetaCommand.run?.({
        args: {
          target,
          "check-only": false,
        },
      } as never);

      const events = readEventLedger(target);
      const nextMeta = agentsMetaSchema.parse(JSON.parse(readFixtureFile(target, ".fabric/agents.meta.json")));
      const appendedEvents = events.slice(firstEvents.length);

      expect(appendedEvents.map((event) => event.event_type)).toEqual([
        "rule_drift_detected",
        "rule_baseline_accepted",
        "baseline_synced",
      ]);
      expect(appendedEvents[0]).toMatchObject({
        event_type: "rule_drift_detected",
        drifted_stable_ids: ["packages/server/rules"],
        stale_files: [".fabric/agents/packages/server/rules.md"],
        details: [
          {
            file: ".fabric/agents/packages/server/rules.md",
            stable_id: "packages/server/rules",
            expected_hash: serverNode.hash,
            actual_hash: nextMeta.nodes["L1/packages/server/rules"].hash,
          },
        ],
      });
      expect(appendedEvents[2]).toMatchObject({
        event_type: "baseline_synced",
        revision: nextMeta.revision,
        previous_revision: meta.revision,
        synced_files: [".fabric/agents/packages/server/rules.md"],
        source: "sync_meta",
      });
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("writes a rule-test index from single-line fabric verify annotations", async () => {
    const target = createWerewolfFixtureRoot("fab-sync-meta-rule-test-index");

    try {
      await initFabric(target);
      writeFixtureFile(
        target,
        ".fabric/agents/packages/server/rules.md",
        "<!-- fab:rule-id rules/server-core -->\n# server rules\n",
      );
      writeFixtureFile(
        target,
        "packages/server/rules.contract.test.ts",
        [
          "import { describe, it } from 'vitest';",
          "",
          "// @fabric-verify rules/server-core",
          "describe('server rule contract', () => {",
          "  it('keeps the contract explicit', () => {});",
          "});",
          "",
        ].join("\n"),
      );

      await syncMetaCommand.run?.({
        args: {
          target,
          "check-only": false,
        },
      } as never);

      const meta = agentsMetaSchema.parse(JSON.parse(readFixtureFile(target, ".fabric/agents.meta.json")));
      const index = ruleTestIndexSchema.parse(JSON.parse(readFixtureFile(target, ".fabric/rule-test.index.json")));

      expect(index).toMatchObject({
        schema_version: 1,
        revision: meta.revision,
        links: [
          {
            rule_stable_id: "rules/server-core",
            rule_file: ".fabric/agents/packages/server/rules.md",
            rule_hash: meta.nodes["L1/packages/server/rules"].hash,
            test_file: "packages/server/rules.contract.test.ts",
            annotation_line: 3,
          },
        ],
        orphan_annotations: [],
      });
      expect(index.links[0].test_hash).toMatch(/^sha256:/u);
      expect(index.links[0]).not.toHaveProperty("previous_rule_hash");
      expect(index.links[0]).not.toHaveProperty("previous_test_hash");
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("records orphan annotations when no computed rule has the referenced stable id", async () => {
    const target = createWerewolfFixtureRoot("fab-sync-meta-rule-test-orphan");

    try {
      await initFabric(target);
      writeFixtureFile(
        target,
        "packages/server/orphan.contract.test.ts",
        [
          "import { describe, it } from 'vitest';",
          "",
          "// @fabric-verify rules/missing",
          "describe('missing rule contract', () => {",
          "  it('stays visible', () => {});",
          "});",
          "",
        ].join("\n"),
      );

      const meta = computeAgentsMeta(target);
      const index = computeRuleTestIndex(target, meta);

      expect(index.links).toEqual([]);
      expect(index.orphan_annotations).toMatchObject([
        {
          rule_stable_id: "rules/missing",
          test_file: "packages/server/orphan.contract.test.ts",
          annotation_line: 3,
        },
      ]);
      expect(index.orphan_annotations[0].test_hash).toMatch(/^sha256:/u);
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("preserves previous rule and test hashes from the prior index when either side changes", async () => {
    const target = createWerewolfFixtureRoot("fab-sync-meta-rule-test-previous");

    try {
      await initFabric(target);
      writeFixtureFile(
        target,
        ".fabric/agents/packages/server/rules.md",
        "<!-- fab:rule-id rules/server-core -->\n# server rules\n",
      );
      writeFixtureFile(
        target,
        "packages/server/rules.contract.test.ts",
        [
          "import { describe, it } from 'vitest';",
          "",
          "// @fabric-verify rules/server-core",
          "describe('server rule contract', () => {",
          "  it('keeps the contract explicit', () => {});",
          "});",
          "",
        ].join("\n"),
      );

      const firstMeta = computeAgentsMeta(target);
      const firstIndex = computeRuleTestIndex(target, firstMeta);
      const firstLink = firstIndex.links[0];

      writeFixtureFile(
        target,
        ".fabric/agents/packages/server/rules.md",
        "<!-- fab:rule-id rules/server-core -->\n# server rules\n\nChanged.\n",
      );
      writeFixtureFile(
        target,
        "packages/server/rules.contract.test.ts",
        [
          "import { describe, it } from 'vitest';",
          "",
          "// @fabric-verify rules/server-core",
          "describe('server rule contract', () => {",
          "  it('keeps the contract explicit after a test edit', () => {});",
          "});",
          "",
        ].join("\n"),
      );

      const nextMeta = computeAgentsMeta(target);
      const nextIndex = computeRuleTestIndex(target, nextMeta, firstIndex);

      expect(nextIndex.previous_revision).toBe(firstMeta.revision);
      expect(nextIndex.links[0]).toMatchObject({
        previous_rule_hash: firstLink.rule_hash,
        previous_test_hash: firstLink.test_hash,
      });
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("fails check-only when the rule-test index is stale even if agents meta is current", async () => {
    const target = createWerewolfFixtureRoot("fab-sync-meta-rule-test-check-only");

    try {
      await initFabric(target);
      writeFixtureFile(
        target,
        ".fabric/agents/packages/server/rules.md",
        "<!-- fab:rule-id rules/server-core -->\n# server rules\n",
      );
      writeFixtureFile(
        target,
        "packages/server/rules.contract.test.ts",
        [
          "import { describe, it } from 'vitest';",
          "",
          "// @fabric-verify rules/server-core",
          "describe('server rule contract', () => {",
          "  it('keeps the contract explicit', () => {});",
          "});",
          "",
        ].join("\n"),
      );

      await syncMetaCommand.run?.({
        args: {
          target,
          "check-only": false,
        },
      } as never);
      expect(existsSync(`${target}/.fabric/rule-test.index.json`)).toBe(true);

      writeFixtureFile(
        target,
        "packages/server/rules.contract.test.ts",
        [
          "import { describe, it } from 'vitest';",
          "",
          "// @fabric-verify rules/server-core",
          "describe('server rule contract', () => {",
          "  it('changes without resyncing the sidecar', () => {});",
          "});",
          "",
        ].join("\n"),
      );

      await syncMetaCommand.run?.({
        args: {
          target,
          "check-only": true,
        },
      } as never);

      expect(process.exitCode).toBe(1);
    } finally {
      cleanupFixtureRoot(target);
    }
  });
});

function readEventLedger(target: string): Array<Record<string, unknown>> {
  return readFixtureFile(target, ".fabric/events.jsonl")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
