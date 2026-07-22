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
const generatedRuntime = join(
  repoRoot,
  "packages/cli/templates/hooks/lib/project-context-runtime.cjs",
);
const tempDirs: string[] = [];

function collectFiles(root: string, matches: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if ([".git", ".workflow", "node_modules"].includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...collectFiles(path, matches));
    else if (entry.isFile() && matches(entry.name)) found.push(path);
  }
  return found;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("generated hook ProjectContext runtime", () => {
  it("regenerates byte-identically into an isolated output directory", () => {
    const outDir = mkdtempSync(join(tmpdir(), "fabric-hook-runtime-"));
    tempDirs.push(outDir);
    execFileSync(
      process.execPath,
      [join(repoRoot, "scripts/build-hook-project-context.mjs"), "--out-dir", outDir],
      { cwd: repoRoot, stdio: "pipe" },
    );

    expect(readFileSync(join(outDir, "project-context-runtime.cjs"))).toEqual(
      readFileSync(generatedRuntime),
    );
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
