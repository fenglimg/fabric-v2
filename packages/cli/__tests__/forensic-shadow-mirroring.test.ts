import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildAssertions,
  buildCandidateFiles,
  type CodeSampleResult,
  type TopologyResult,
} from "../src/scanner/forensic.ts";

const WEREWOLF_FIXTURE = fileURLToPath(new URL("../../../examples/werewolf-minigame-stub", import.meta.url));

describe("forensic shadow mirroring fixture", () => {
  it("buildAssertions emits high-confidence werewolf assertions with meaningful forensic summaries", () => {
    const topology = buildFixtureTopology(WEREWOLF_FIXTURE);
    const codeSamples = createWerewolfCodeSamples();
    const assertions = buildAssertions("cocos-creator", topology, codeSamples);

    expect(assertions.length).toBeGreaterThanOrEqual(6);
    expect(
      assertions.some(
        (assertion) =>
          assertion.type === "framework" &&
          assertion.confidence === "HIGH" &&
          assertion.coverage.ratio >= 0.8 &&
          assertion.statement.includes("Cocos Creator"),
      ),
    ).toBe(true);
    expect(
      assertions.some(
        (assertion) =>
          assertion.confidence === "HIGH" &&
          assertion.statement.includes("component classes") &&
          assertion.evidence.some((evidence) => evidence.file === "assets/scripts/Game.ts"),
      ),
    ).toBe(true);
    expect(
      assertions.some(
        (assertion) =>
          assertion.confidence === "HIGH" &&
          assertion.proposed_rule === "Do not edit or delete .meta sidecars without explicit user confirmation.",
      ),
    ).toBe(true);

    expect(
      assertions.map((assertion) => ({
        type: assertion.type,
        confidence: assertion.confidence,
        statement: assertion.statement,
        coverage: assertion.coverage,
        proposed_rule: assertion.proposed_rule ?? null,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "confidence": "HIGH",
          "coverage": {
            "co_occurring_patterns": [
              "cc-import",
              "ccclass-decorator",
              "component-base",
              "decorator-destructure",
              "project-config-json",
              "meta-sidecars",
              "package-json",
            ],
            "matched": 3,
            "ratio": 1,
            "total": 3,
          },
          "proposed_rule": "Preserve Cocos component decorators, lifecycle methods, and paired .meta files during initialization.",
          "statement": "Project strongly matches a Cocos Creator TypeScript component layout.",
          "type": "framework",
        },
        {
          "confidence": "HIGH",
          "coverage": {
            "co_occurring_patterns": [
              "cc-import",
              "ccclass-decorator",
              "component-base",
              "decorator-destructure",
            ],
            "matched": 3,
            "ratio": 1,
            "total": 3,
          },
          "proposed_rule": "Treat assets/scripts/*.ts and adjacent .meta files as framework-owned structure unless the user says otherwise.",
          "statement": "Sampled entry files use Cocos Creator component classes.",
          "type": "pattern",
        },
        {
          "confidence": "HIGH",
          "coverage": {
            "co_occurring_patterns": [
              "assets/scripts",
              "cocos-creator",
              "cc-import",
            ],
            "matched": 3,
            "ratio": 1,
            "total": 3,
          },
          "proposed_rule": "Treat assets/scripts as the main execution boundary during initialization.",
          "statement": "Entry samples are concentrated in assets/scripts, indicating a stable primary source boundary.",
          "type": "pattern",
        },
        {
          "confidence": "HIGH",
          "coverage": {
            "co_occurring_patterns": [
              "meta-sidecar",
              "cocos-creator",
              "assets-scripts",
            ],
            "matched": 3,
            "ratio": 1,
            "total": 3,
          },
          "proposed_rule": "Do not edit or delete .meta sidecars without explicit user confirmation.",
          "statement": "Script files have adjacent .meta sidecars, which should be treated as coupled assets.",
          "type": "invariant",
        },
        {
          "confidence": "HIGH",
          "coverage": {
            "co_occurring_patterns": [
              "package-json",
              "project-config-json",
              "tsconfig-json",
            ],
            "matched": 3,
            "ratio": 1,
            "total": 3,
          },
          "proposed_rule": "Read bootstrap and compiler config before generating new rules or project structure.",
          "statement": "Project configuration is anchored by package.json, project.config.json, tsconfig.json.",
          "type": "invariant",
        },
        {
          "confidence": "HIGH",
          "coverage": {
            "co_occurring_patterns": [
              "pascal-case-modules",
              "domain-named-components",
              "lifecycle-hook",
            ],
            "matched": 3,
            "ratio": 1,
            "total": 3,
          },
          "proposed_rule": "Preserve domain-specific module names when mirroring structure into AGENTS.md or .fabric/agents/.",
          "statement": "Sampled modules are named as concrete domain concepts (Game, Network, Player).",
          "type": "domain",
        },
      ]
    `);
  });

  it("buildCandidateFiles keeps families grouped and capped for the werewolf fixture", () => {
    const topology = buildFixtureTopology(WEREWOLF_FIXTURE);
    const codeSamples = createWerewolfCodeSamples();
    const entryPoints = codeSamples.map((sample) => ({
      path: sample.path,
      reason: "top-level script",
      size_bytes: statSync(join(WEREWOLF_FIXTURE, sample.path)).size,
    }));

    const candidateFiles = buildCandidateFiles(topology, codeSamples, entryPoints);
    const grouped = Object.fromEntries(
      [...new Set(candidateFiles.map((candidate) => candidate.family))]
        .sort()
        .map((family) => [
          family,
          candidateFiles
            .filter((candidate) => candidate.family === family)
            .map((candidate) => candidate.path)
            .sort(),
        ]),
    );

    expect(candidateFiles.length).toBeLessThanOrEqual(12);
    expect(Object.keys(grouped).length).toBeGreaterThanOrEqual(3);
    expect(grouped.entry).toBeDefined();
    expect(grouped.component).toBeDefined();
    expect(grouped.config).toBeDefined();
    expect(grouped.domain).toBeDefined();
    expect({
      total: candidateFiles.length,
      grouped,
    }).toMatchInlineSnapshot(`
      {
        "grouped": {
          "component": [
            "assets/scripts/Network.ts",
            "assets/scripts/Player.ts",
          ],
          "config": [
            "package.json",
            "project.config.json",
            "tsconfig.json",
          ],
          "domain": [
            "README.md",
          ],
          "entry": [
            "assets/scripts/Game.ts",
          ],
        },
        "total": 7,
      }
    `);
  });
});

function buildFixtureTopology(root: string): TopologyResult {
  const files: TopologyResult["files"] = [];
  const byExt: Record<string, number> = {};
  const keyDirs = new Set<string>();
  let maxDepth = 0;

  walk(root, root, files, byExt, keyDirs, { current: 0 });

  return {
    total_files: files.length,
    by_ext: Object.fromEntries(Object.entries(byExt).sort(([left], [right]) => left.localeCompare(right))),
    key_dirs: [...keyDirs].sort(),
    max_depth: maxDepth,
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };

  function walk(
    targetRoot: string,
    current: string,
    collectedFiles: TopologyResult["files"],
    extCounts: Record<string, number>,
    collectedKeyDirs: Set<string>,
    state: { current: number },
  ): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".fabric") {
        continue;
      }

      const absolutePath = join(current, entry.name);
      const relativePath = relative(targetRoot, absolutePath).split("\\").join("/");

      if (relativePath === "AGENTS.md") {
        continue;
      }

      const depth = relativePath.split("/").length;
      state.current = Math.max(state.current, depth);
      maxDepth = Math.max(maxDepth, depth);

      if (entry.isDirectory()) {
        if (isKeyDirectory(relativePath)) {
          collectedKeyDirs.add(relativePath);
        }
        walk(targetRoot, absolutePath, collectedFiles, extCounts, collectedKeyDirs, state);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = extname(entry.name) || "[none]";
      extCounts[extension] = (extCounts[extension] ?? 0) + 1;
      collectedFiles.push({
        relativePath,
        sizeBytes: statSync(absolutePath).size,
      });
    }
  }
}

function createWerewolfCodeSamples(): CodeSampleResult[] {
  return [
    "assets/scripts/Game.ts",
    "assets/scripts/Network.ts",
    "assets/scripts/Player.ts",
  ].map((relativePath) => {
    const snippet = readFileSync(join(WEREWOLF_FIXTURE, relativePath), "utf8").trimEnd();
    const lines = snippet.split("\n");
    const fileBase = basename(relativePath, extname(relativePath));

    return {
      path: relativePath,
      lines: `1-${lines.length}`,
      snippet,
      pattern_hint: "cocos-component-class",
      pattern_analysis: {
        pattern: "cocos-component-class",
        type: "pattern",
        confidence: "HIGH",
        evidence_lines: ["_decorator", "@ccclass(", "extends Component"],
        co_occurring: ["cc-import", "ccclass-decorator", "component-base", "decorator-destructure"],
        family: "component",
        ast_level: true,
        statement: "Sampled entry files use Cocos Creator component classes.",
        proposed_rule: "Treat assets/scripts/*.ts and adjacent .meta files as framework-owned structure unless the user says otherwise.",
        alternatives: ["Generic TypeScript utility module"],
        rationale: "Cocos-specific decorators and Component inheritance co-occur in sampled entry files.",
      },
      evidence: [
        { file: relativePath, line: "1", snippet: lines[0] ?? "" },
        { file: relativePath, line: "5", snippet: lines[4] ?? "" },
        { file: relativePath, line: "6", snippet: lines[5] ?? "" },
      ],
    } satisfies CodeSampleResult;
  });
}

function isKeyDirectory(relativePath: string): boolean {
  return new Set(["app", "components", "pages", "prefabs", "scenes", "scripts", "src"]).has(
    posix.basename(relativePath),
  );
}
