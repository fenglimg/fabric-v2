import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const handlers = {
  registerRecall: "packages/server/src/tools/recall.ts",
  registerPending: "packages/server/src/tools/pending.ts",
  registerReview: "packages/server/src/tools/review.ts",
  registerExtractKnowledge: "packages/server/src/tools/extract-knowledge.ts",
  registerArchiveScan: "packages/server/src/tools/archive-scan.ts",
} as const;
const forbiddenPackage = "@fenglimg/fabric-server-http-experimental";
const forbiddenPath = "packages/server-http-experimental";

function filesBelow(root: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      [".git", "node_modules", "dist", "coverage", "server-http-experimental"].includes(
        entry.name,
      )
    ) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...filesBelow(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

describe("production handler ProjectContext census", () => {
  it("enumerates exactly the five production handlers and forbids direct root resolution", () => {
    const expected = [
      "registerRecall",
      "registerPending",
      "registerReview",
      "registerExtractKnowledge",
      "registerArchiveScan",
    ];
    expect(Object.keys(handlers)).toEqual(expected);
    const discovered = filesBelow(join(repoRoot, "packages/server/src/tools"))
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
      .flatMap((path) => [
        ...readFileSync(path, "utf8").matchAll(/export function (register[A-Z]\w*)\s*\(/gu),
      ])
      .map((match) => match[1])
      .sort();
    expect(discovered).toEqual([...expected].sort());
    for (const [symbol, path] of Object.entries(handlers)) {
      const source = readFileSync(join(repoRoot, path), "utf8");
      expect(source).toMatch(new RegExp(`export function ${symbol}\\b`, "u"));
      expect(source).toContain("snapshotForCall()");
      expect(source).not.toMatch(/resolveProjectRoot/u);
    }
  });

  it("keeps experimental HTTP out of dependencies, module specifiers, and release inputs", () => {
    const violations: string[] = [];
    for (const file of filesBelow(join(repoRoot, "packages"))) {
      const rel = relative(repoRoot, file).replaceAll("\\", "/");
      if (rel.endsWith("package.json")) {
        const pkg = JSON.parse(readFileSync(file, "utf8")) as Record<
          string,
          Record<string, string>
        >;
        for (const map of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
          for (const [name, value] of Object.entries(pkg[map] ?? {})) {
            if (name === forbiddenPackage || value.includes("server-http-experimental")) {
              violations.push(`${rel}:${map}:${name}`);
            }
          }
        }
        continue;
      }
      if (
        !/\.[cm]?[jt]sx?$/u.test(rel) ||
        /(?:\.test\.|\.spec\.|__tests__)/u.test(rel)
      ) continue;
      const source = readFileSync(file, "utf8");
      const specifiers = source.matchAll(
        /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/gu,
      );
      for (const match of specifiers) {
        if (
          match[1] === forbiddenPackage ||
          match[1]?.includes("server-http-experimental")
        ) violations.push(`${rel}:${match[1]}`);
      }
    }

    const releaseInputs = [
      "package.json",
      "scripts/test-strategy-gate.mjs",
      "scripts/apply-tag-version.mjs",
      "scripts/sync-versions.mjs",
      ".github/workflows/ci.yml",
      ".github/workflows/reusable-validate.yml",
      ".github/workflows/release.yml",
    ];
    for (const rel of releaseInputs) {
      const source = readFileSync(join(repoRoot, rel), "utf8");
      if (source.includes(forbiddenPackage) || source.includes(forbiddenPath)) {
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);

    const workspace = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    expect(workspace.match(/packages\/server-http-experimental/gu)).toHaveLength(1);
    expect(workspace).toContain('- "!packages/server-http-experimental"');
  });
});
