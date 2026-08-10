import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const hookLibDir = join(repoRoot, "packages/cli/templates/hooks/lib");

/**
 * Every hook lib compiled from shared TS. Must stay in step with MANIFEST in
 * scripts/build-hook-project-context.mjs.
 *
 * B8: theme / cite-line-parser / high-value-predicate joined the list when
 * their hand-authored CJS twins were retired. This byte-identity check REPLACES
 * the three parity tests those twins needed (theme-parity, cite-line-parser-
 * parity, high-value-sst) and is strictly stronger: a parity test could only
 * say "the two implementations agree today", while this says "the artifact we
 * ship is what the current source compiles to" — which also catches a stale
 * checked-in .cjs that no one remembered to regenerate.
 */
const GENERATED_HOOK_LIBS = [
  "project-context-runtime.cjs",
  "theme.cjs",
  "cite-line-parser.cjs",
  "high-value-predicate.cjs",
];

const tempDirs: string[] = [];

function collectFiles(root: string, matches: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    // `.claude` holds `worktrees/<name>/` — full git-worktree checkouts of THIS
    // repo. Traversing them double-counts every package.json / tsup config, so
    // the single-declaration assertions below fail purely because a worktree
    // exists (a false red that says nothing about the repo's real state).
    if ([".git", ".claude", ".workflow", "node_modules"].includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...collectFiles(path, matches));
    else if (entry.isFile() && matches(entry.name)) found.push(path);
  }
  return found;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("generated hook libs", () => {
  it("every checked-in artifact regenerates byte-identically", () => {
    const outDir = mkdtempSync(join(tmpdir(), "fabric-hook-runtime-"));
    tempDirs.push(outDir);
    execFileSync(
      process.execPath,
      [join(repoRoot, "scripts/build-hook-project-context.mjs"), "--out-dir", outDir],
      { cwd: repoRoot, stdio: "pipe" },
    );

    for (const lib of GENERATED_HOOK_LIBS) {
      expect(readFileSync(join(outDir, lib)), `${lib} is stale — re-run the generator`).toEqual(
        readFileSync(join(hookLibDir, lib)),
      );
    }
  });

  it("no generated lib is hand-editable without tripping its DO NOT EDIT banner", () => {
    for (const lib of GENERATED_HOOK_LIBS) {
      const firstLine = readFileSync(join(hookLibDir, lib), "utf8").split("\n", 1)[0];
      expect(firstLine).toMatch(
        /^\/\/ @generated from packages\/shared\/src\/.+\.ts by scripts\/build-hook-project-context\.mjs; DO NOT EDIT$/,
      );
    }
  });

  it("has one package-script generator and one tsup runtime declaration", () => {
    const packageJsonFiles = collectFiles(repoRoot, (name) => name === "package.json");
    const scriptOccurrences = packageJsonFiles.reduce((count, path) => {
      const scripts = (JSON.parse(readFileSync(path, "utf8")) as { scripts?: Record<string, string> })
        .scripts;
      return (
        count +
        Object.values(scripts ?? {}).filter((script) =>
          script.includes("build-hook-project-context.mjs"),
        ).length
      );
    }, 0);

    const tsupConfigs = collectFiles(
      join(repoRoot, "packages"),
      (name) => name.startsWith("tsup") && name.endsWith(".config.ts"),
    );
    const runtimeConfigs = tsupConfigs.filter((path) =>
      readFileSync(path, "utf8").includes("project-context-runtime.cjs"),
    );
    const runtimeDeclarationCount = tsupConfigs.reduce(
      (count, path) =>
        count +
        (readFileSync(path, "utf8").match(/project-context-runtime\.cjs/g) ?? []).length,
      0,
    );

    expect(scriptOccurrences).toBe(1);
    expect(runtimeDeclarationCount).toBe(1);
    expect(runtimeConfigs.map((path) => basename(path))).toEqual([
      "tsup.hook-runtime.config.ts",
    ]);
  });
});
