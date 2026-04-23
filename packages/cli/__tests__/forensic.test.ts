import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  buildAssertions,
  buildCandidateFiles,
  buildForensicReport,
  inferPatternHint,
  type CodeSampleResult,
  type TopologyResult,
} from "../src/scanner/forensic.ts";
import {
  cleanupFixtureRoot,
  createEmptyFixtureRoot,
  createWerewolfFixtureRoot,
  writeFixtureFile,
} from "./helpers/init-test-utils.ts";

describe("forensic scanner helpers", () => {
  it("builds structured assertions and candidate files for the werewolf fixture", async () => {
    const target = createWerewolfFixtureRoot("fab-forensic-assertions");

    try {
      const report = await buildForensicReport(target);
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

  it("applies the HIGH, MEDIUM, and LOW confidence thresholds", async () => {
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

  it("caps candidate files, preserves families, and de-duplicates by path", async () => {
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

  it("uses AST imports to raise React TypeScript samples to HIGH confidence", async () => {
    const target = createEmptyFixtureRoot("fab-forensic-react-ast");

    try {
      writeFixtureFile(
        target,
        "package.json",
        JSON.stringify(
          {
            name: "react-ast-fixture",
            dependencies: {
              react: "^19.0.0",
              "react-dom": "^19.0.0",
            },
            devDependencies: {
              typescript: "^5.8.0",
            },
          },
          null,
          2,
        ),
      );
      writeFixtureFile(target, "tsconfig.json", "{}\n");
      const snippet = [
        'import React, { StrictMode, useEffect, useState } from "react";',
        'import type { ReactNode } from "react";',
        'import { createRoot } from "react-dom/client";',
        'import { flushSync } from "react-dom";',
        'import { jsx as _jsx } from "react/jsx-runtime";',
        "type AppProps = { children?: ReactNode };",
        "export function App(_props: AppProps) {",
        "  const [ready, setReady] = useState(false);",
        "  useEffect(() => setReady(true), []);",
        "  return _jsx(StrictMode, { children: ready });",
        "}",
        'createRoot(document.getElementById("root")!).render(<App />);',
      ].join("\n");
      writeFixtureFile(target, "src/App.tsx", snippet);

      const pattern = await inferPatternHint("src/App.tsx", snippet, {
        frameworkKind: "react",
        topology: makeTopology(["package.json", "tsconfig.json", "src/App.tsx"]),
        packageDependencies: new Map([
          ["react", "^19.0.0"],
          ["react-dom", "^19.0.0"],
        ]),
      });
      const report = await buildForensicReport(target);
      const appSample = report.code_samples.find((sample) => sample.path === "src/App.tsx");
      const frameworkAssertion = report.assertions.find((assertion) => assertion.type === "framework");

      expect(pattern).toMatchObject({
        pattern: "react-root",
        ast_level: true,
        confidence: "HIGH",
      });
      expect(appSample?.pattern_hint).toBe("react-root");
      expect(frameworkAssertion).toMatchObject({
        confidence: "HIGH",
      });
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("keeps text fallback capped at MEDIUM when AST parsing is unavailable", async () => {
    const target = createEmptyFixtureRoot("fab-forensic-react-fallback");

    try {
      writeFixtureFile(
        target,
        "package.json",
        JSON.stringify(
          {
            name: "react-fallback-fixture",
            dependencies: {
              react: "^19.0.0",
            },
          },
          null,
          2,
        ),
      );
      const snippet = [
        'import { createRoot } from "react-dom/client";',
        "type Broken = { value: string;",
        "createRoot(document.body).render(null);",
      ].join("\n");
      writeFixtureFile(target, "src/App.tsx", snippet);

      const pattern = await inferPatternHint("src/App.tsx", snippet, {
        frameworkKind: "react",
        topology: makeTopology(["package.json", "src/App.tsx"]),
        packageDependencies: new Map([["react", "^19.0.0"]]),
      });
      const report = await buildForensicReport(target);
      const appSample = report.code_samples.find((sample) => sample.path === "src/App.tsx");

      expect(pattern).toMatchObject({
        pattern: "react-root",
        ast_level: false,
        confidence: "MEDIUM",
      });
      expect(appSample?.pattern_hint).toBe("react-root");
    } finally {
      cleanupFixtureRoot(target);
    }
  });

  it("samples top-churned entry files before lexicographically earlier entries", async () => {
    const target = createEmptyFixtureRoot("fab-forensic-git-churn");

    try {
      writeFixtureFile(target, "package.json", JSON.stringify({ name: "churn-fixture", dependencies: { react: "^19.0.0" } }));
      writeFixtureFile(target, "src/App.tsx", 'import { createRoot } from "react-dom/client";\ncreateRoot(document.body).render(null);\n');
      writeFixtureFile(target, "src/main.ts", "export const main = true;\n");
      execFileSync("git", ["init"], { cwd: target, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: target });
      execFileSync("git", ["config", "user.name", "Test User"], { cwd: target });
      execFileSync("git", ["add", "."], { cwd: target });
      execFileSync("git", ["commit", "-m", "initial"], { cwd: target, stdio: "ignore" });
      writeFixtureFile(target, "src/main.ts", "export const main = 1;\n");
      execFileSync("git", ["add", "src/main.ts"], { cwd: target });
      execFileSync("git", ["commit", "-m", "churn main"], { cwd: target, stdio: "ignore" });

      const report = await buildForensicReport(target);

      expect(report.entry_points.map((entry) => entry.path).slice(0, 2)).toEqual(["src/main.ts", "src/App.tsx"]);
      expect(report.code_samples[0]?.path).toBe("src/main.ts");
    } finally {
      cleanupFixtureRoot(target);
    }
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
