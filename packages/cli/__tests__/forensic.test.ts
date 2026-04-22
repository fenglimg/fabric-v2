import { describe, expect, it } from "vitest";

import {
  buildAssertions,
  buildCandidateFiles,
  buildForensicReport,
  type CodeSampleResult,
  type TopologyResult,
} from "../src/scanner/forensic.ts";
import { cleanupFixtureRoot, createWerewolfFixtureRoot } from "./helpers/init-test-utils.ts";

describe("forensic scanner helpers", () => {
  it("builds structured assertions and candidate files for the werewolf fixture", () => {
    const target = createWerewolfFixtureRoot("fab-forensic-assertions");

    try {
      const report = buildForensicReport(target);
      const highAssertions = report.assertions.filter((assertion) => assertion.confidence === "HIGH");

      expect(report.assertions.length).toBeGreaterThanOrEqual(5);
      expect(highAssertions.length).toBeGreaterThanOrEqual(3);
      for (const assertion of report.assertions) {
        expect(assertion.evidence.length).toBeGreaterThanOrEqual(1);
        for (const evidence of assertion.evidence) {
          expect(evidence.file).toContain(".");
          expect(evidence.line).toMatch(/^\d+$/);
        }
      }
      expect(
        report.assertions.some(
          (assertion) =>
            assertion.confidence === "HIGH" &&
            assertion.coverage.ratio >= 0.8 &&
            assertion.coverage.co_occurring_patterns.length >= 2,
        ),
      ).toBe(true);
      expect(new Set(report.candidate_files.map((entry) => entry.family)).size).toBeGreaterThanOrEqual(3);
      expect(report.candidate_files.length).toBeLessThanOrEqual(12);
      expect(report.sampling_budget).toEqual({
        max_files: 15,
        max_lines_per_file: 100,
      });
      expect(report.recommendations_for_skill?.length).toBeGreaterThan(0);
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("applies the HIGH, MEDIUM, and LOW confidence thresholds", () => {
    const highAssertions = buildAssertions(
      "cocos-creator",
      makeTopology([
        "assets/scripts/Game.ts",
        "assets/scripts/Game.ts.meta",
        "assets/scripts/Player.ts",
        "assets/scripts/Player.ts.meta",
        "project.config.json",
        "package.json",
        "tsconfig.json",
      ]),
      [
        makeCodeSample("assets/scripts/Game.ts", {
          pattern_hint: "cocos-component-class",
          snippet: 'import { _decorator, Component } from "cc";\n@ccclass("Game")\nexport class Game extends Component {}',
          pattern_analysis: {
            pattern: "cocos-component-class",
            confidence: "HIGH",
            evidence_lines: ['from "cc"', "@ccclass(", "extends Component"],
            co_occurring: ["cc-import", "ccclass-decorator", "component-base"],
            family: "component",
            ast_level: true,
            statement: "Sampled entry files use Cocos Creator component classes.",
            proposed_rule: "Preserve component decorators and lifecycle hooks.",
            rationale: "Cocos markers co-occur.",
          },
        }),
        makeCodeSample("assets/scripts/Player.ts", {
          pattern_hint: "cocos-component-class",
          snippet: 'import { _decorator, Component } from "cc";\n@ccclass("Player")\nexport class Player extends Component {}',
          pattern_analysis: {
            pattern: "cocos-component-class",
            confidence: "HIGH",
            evidence_lines: ['from "cc"', "@ccclass(", "extends Component"],
            co_occurring: ["cc-import", "ccclass-decorator", "component-base"],
            family: "component",
            ast_level: true,
            statement: "Sampled entry files use Cocos Creator component classes.",
            proposed_rule: "Preserve component decorators and lifecycle hooks.",
            rationale: "Cocos markers co-occur.",
          },
        }),
      ],
    );

    const mediumAssertions = buildAssertions(
      "vite",
      makeTopology(["src/main.ts", "package.json"]),
      [
        makeCodeSample("src/main.ts", {
          pattern_hint: "vite-main-entry",
          snippet: "console.log('boot');",
          pattern_analysis: {
            pattern: "vite-main-entry",
            confidence: "MEDIUM",
            evidence_lines: ["console.log"],
            co_occurring: ["main-entry"],
            family: "entry",
            ast_level: false,
            statement: "Sampled entry files use the conventional Vite main entrypoint.",
            proposed_rule: "Keep primary bootstrapping logic inside src/main.*.",
            rationale: "Single entry marker present.",
          },
        }),
        makeCodeSample("src/secondary.ts", {
          pattern_hint: "source-entry",
          pattern_analysis: {
            pattern: "source-entry",
            confidence: "LOW",
            evidence_lines: ["secondary"],
            co_occurring: [],
            family: "domain",
            ast_level: false,
            statement: "Sampled entry file appears to be a generic source entry.",
            rationale: "No strong framework markers were detected in the sampled snippet.",
          },
        }),
      ],
    );

    const lowAssertions = buildAssertions(
      "unknown",
      makeTopology(["src/index.ts"]),
      [
        makeCodeSample("src/index.ts", {
          pattern_hint: "source-entry",
          pattern_analysis: {
            pattern: "source-entry",
            confidence: "LOW",
            evidence_lines: ["boot"],
            co_occurring: [],
            family: "domain",
            ast_level: false,
            statement: "Sampled entry file appears to be a generic source entry.",
            rationale: "No strong framework markers were detected in the sampled snippet.",
          },
        }),
        makeCodeSample("src/util.ts", {
          pattern_hint: "source-entry",
          pattern_analysis: {
            pattern: "source-entry",
            confidence: "LOW",
            evidence_lines: ["helper"],
            co_occurring: [],
            family: "domain",
            ast_level: false,
            statement: "Sampled entry file appears to be a generic source entry.",
            rationale: "No strong framework markers were detected in the sampled snippet.",
          },
        }),
      ],
    );

    expect(highAssertions.some((assertion) => assertion.confidence === "HIGH")).toBe(true);
    expect(mediumAssertions.some((assertion) => assertion.confidence === "MEDIUM")).toBe(true);
    expect(lowAssertions.some((assertion) => assertion.confidence === "LOW")).toBe(true);
  });

  it("caps candidate files, preserves families, and de-duplicates by path", () => {
    const topology = makeTopology([
      "src/main.ts",
      "src/App.tsx",
      "src/App.test.tsx",
      "src/domain/user.ts",
      "src/domain/session.ts",
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
    ]);
    const codeSamples = [
      makeCodeSample("src/main.ts", {
        pattern_hint: "vite-main-entry",
        pattern_analysis: {
          pattern: "vite-main-entry",
          confidence: "HIGH",
          evidence_lines: ["src/main"],
          co_occurring: ["main-entry", "import-meta"],
          family: "entry",
          ast_level: false,
          statement: "Sampled entry files use the conventional Vite main entrypoint.",
          proposed_rule: "Keep primary bootstrapping logic inside src/main.*.",
          rationale: "Entry markers co-occur.",
        },
      }),
      makeCodeSample("src/App.tsx", {
        pattern_hint: "cocos-component-class",
        pattern_analysis: {
          pattern: "cocos-component-class",
          confidence: "HIGH",
          evidence_lines: ["extends Component"],
          co_occurring: ["component-base", "jsx-component"],
          family: "component",
          ast_level: false,
          statement: "Component sample.",
          rationale: "Component markers co-occur.",
        },
      }),
    ];
    const entryPoints = [
      {
        path: "src/main.ts",
        reason: "application entry",
        size_bytes: 128,
      },
      {
        path: "src/App.tsx",
        reason: "top-level script",
        size_bytes: 256,
      },
    ];

    const candidates = buildCandidateFiles(topology, codeSamples, entryPoints);

    expect(candidates.length).toBeLessThanOrEqual(12);
    expect(new Set(candidates.map((candidate) => candidate.path)).size).toBe(candidates.length);
    expect(candidates.some((candidate) => candidate.family === "entry")).toBe(true);
    expect(candidates.some((candidate) => candidate.family === "component")).toBe(true);
    expect(candidates.some((candidate) => candidate.family === "config")).toBe(true);
    expect(candidates.some((candidate) => candidate.family === "test")).toBe(true);
    expect(candidates.some((candidate) => candidate.family === "domain")).toBe(true);
  });
});

function makeTopology(relativePaths: string[]): TopologyResult {
  const byExt: Record<string, number> = {};
  for (const relativePath of relativePaths) {
    const extension = /\.[^.]+$/.exec(relativePath)?.[0] ?? "[none]";
    byExt[extension] = (byExt[extension] ?? 0) + 1;
  }

  return {
    total_files: relativePaths.length,
    by_ext: byExt,
    key_dirs: ["src"],
    max_depth: 3,
    files: relativePaths.map((relativePath) => ({
      relativePath,
      sizeBytes: 128,
    })),
  };
}

function makeCodeSample(
  path: string,
  overrides: Partial<CodeSampleResult> & Pick<CodeSampleResult, "pattern_analysis">,
): CodeSampleResult {
  const snippet = overrides.snippet ?? `export const ${path.replace(/[^A-Za-z0-9]/g, "_")} = true;`;

  return {
    path,
    lines: overrides.lines ?? "1-1",
    snippet,
    pattern_hint: overrides.pattern_hint ?? overrides.pattern_analysis.pattern,
    pattern_analysis: overrides.pattern_analysis,
    evidence: overrides.evidence ?? [
      {
        file: path,
        line: "1",
        snippet: snippet.split("\n")[0] ?? "",
      },
    ],
  };
}
