import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentsMetaSchema, ruleTestIndexSchema } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildRuleMeta,
  computeRuleTestIndex,
  computeRulesBasedAgentsMeta,
  writeRuleMeta,
} from "./rule-meta-builder.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("rule-meta-builder", () => {
  it("builds agents.meta and rule-test.index from .fabric/rules only", async () => {
    const projectRoot = await createProject("rules-builder-basic");
    await writeProjectFile(
      projectRoot,
      ".fabric/rules/packages/server/rules.md",
      [
        "---",
        "description: Server rule contract",
        "intent_clues: [server]",
        "tech_stack: [TypeScript]",
        "impact: [Runtime]",
        "must_read_if: Editing server services",
        "---",
        "<!-- fab:rule-id rules/server-core -->",
        "# Server rule contract",
        "## [MANDATORY_INJECTION]",
        "Use the service layer.",
        "",
      ].join("\n"),
    );
    await writeProjectFile(projectRoot, ".fabric/agents/packages/server/rules.md", "# legacy ignored\n");
    await writeProjectFile(
      projectRoot,
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

    const result = await writeRuleMeta(projectRoot, { source: "doctor_fix" });
    const meta = agentsMetaSchema.parse(JSON.parse(await readFile(join(projectRoot, ".fabric/agents.meta.json"), "utf8")));
    const index = ruleTestIndexSchema.parse(
      JSON.parse(await readFile(join(projectRoot, ".fabric/rule-test.index.json"), "utf8")),
    );

    expect(result.changed).toBe(true);
    expect(Object.values(meta.nodes).map((node) => node.content_ref ?? node.file)).toEqual([
      ".fabric/bootstrap/README.md",
      ".fabric/rules/packages/server/rules.md",
    ]);
    expect(Object.values(meta.nodes).some((node) => node.file.startsWith(".fabric/agents/"))).toBe(false);
    expect(meta.nodes["L1/packages/server/rules"]).toMatchObject({
      file: ".fabric/rules/packages/server/rules.md",
      content_ref: ".fabric/rules/packages/server/rules.md",
      stable_id: "rules/server-core",
      identity_source: "declared",
      level: "L1",
      layer: "L1",
      scope_glob: "packages/server/**",
      sections: ["MANDATORY_INJECTION"],
      description: {
        summary: "Server rule contract",
        intent_clues: ["server"],
        tech_stack: ["TypeScript"],
        impact: ["Runtime"],
        must_read_if: "Editing server services",
      },
    });
    expect(index).toMatchObject({
      revision: meta.revision,
      links: [
        {
          rule_stable_id: "rules/server-core",
          rule_file: ".fabric/rules/packages/server/rules.md",
          rule_hash: meta.nodes["L1/packages/server/rules"].hash,
          test_file: "packages/server/rules.contract.test.ts",
          annotation_line: 3,
        },
      ],
      orphan_annotations: [],
    });
  });

  it("preserves stale previous rule and test hashes", async () => {
    const projectRoot = await createProject("rules-builder-previous");
    await writeProjectFile(
      projectRoot,
      ".fabric/rules/packages/server/rules.md",
      "<!-- fab:rule-id rules/server-core -->\n# Server rules\n",
    );
    await writeProjectFile(
      projectRoot,
      "packages/server/rules.contract.test.ts",
      "// @fabric-verify rules/server-core\nexpect(true).toBe(true);\n",
    );

    const firstMeta = await computeRulesBasedAgentsMeta(projectRoot);
    const firstIndex = await computeRuleTestIndex(projectRoot, firstMeta);
    const firstLink = firstIndex.links[0];

    await writeProjectFile(
      projectRoot,
      ".fabric/rules/packages/server/rules.md",
      "<!-- fab:rule-id rules/server-core -->\n# Server rules\n\nChanged.\n",
    );
    await writeProjectFile(
      projectRoot,
      "packages/server/rules.contract.test.ts",
      "// @fabric-verify rules/server-core\nexpect(false).toBe(false);\n",
    );

    const nextMeta = await computeRulesBasedAgentsMeta(projectRoot);
    const nextIndex = await computeRuleTestIndex(projectRoot, nextMeta, firstIndex);

    expect(nextIndex.previous_revision).toBe(firstMeta.revision);
    expect(nextIndex.links[0]).toMatchObject({
      previous_rule_hash: firstLink.rule_hash,
      previous_test_hash: firstLink.test_hash,
    });
  });

  it("does not depend on .fabric/agents for target-state generation", async () => {
    const projectRoot = await createProject("rules-builder-no-agents");
    await writeProjectFile(projectRoot, ".fabric/agents/root.md", "<!-- fab:rule-id legacy/root -->\n# Legacy\n");

    const result = await buildRuleMeta(projectRoot);

    expect(Object.values(result.meta.nodes).map((node) => node.content_ref ?? node.file)).toEqual([
      ".fabric/bootstrap/README.md",
    ]);
    expect(result.ruleTestIndex.links).toEqual([]);
    expect(result.ruleTestIndex.orphan_annotations).toEqual([]);
  });
});

async function createProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), `${prefix}-`));
  tempDirs.push(projectRoot);
  await writeProjectFile(projectRoot, ".fabric/bootstrap/README.md", "# Bootstrap\n");
  return projectRoot;
}

async function writeProjectFile(projectRoot: string, path: string, content: string): Promise<void> {
  const target = join(projectRoot, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}
