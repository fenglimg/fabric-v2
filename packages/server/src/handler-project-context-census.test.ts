import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const handlers = {
  registerRecall: "packages/server/src/tools/recall.ts",
  registerPending: "packages/server/src/tools/pending.ts",
  registerReview: "packages/server/src/tools/review.ts",
  registerExtractKnowledge: "packages/server/src/tools/extract-knowledge.ts",
  registerArchiveScan: "packages/server/src/tools/archive-scan.ts",
} as const;

function filesBelow(root: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "coverage"].includes(entry.name)) continue;
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

  // W4 B7: the second test here ("keeps experimental HTTP out of dependencies,
  // module specifiers, and release inputs") was deleted with its subject. It
  // guarded the quarantined packages/server-http-experimental/ against leaking
  // back into the mainline — a fence around a thing that no longer exists. With
  // the package gone, `tsc --noEmit` is the guard: an import of a deleted
  // package cannot compile, so no bespoke specifier scan is needed.
});
