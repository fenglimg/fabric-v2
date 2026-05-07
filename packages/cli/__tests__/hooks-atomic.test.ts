import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as atomicWriteModule from "@fenglimg/fabric-shared/node/atomic-write";
import { installHooks } from "../src/commands/hooks.ts";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(prefix = "fabric-hooks-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function makeMinimalPackageJson(dir: string, extra: Record<string, unknown> = {}): string {
  const path = join(dir, "package.json");
  writeFileSync(path, JSON.stringify({ name: "test-pkg", ...extra }, null, 2) + "\n", "utf8");
  return path;
}

describe("hooks-atomic: no .tmp files left after install", () => {
  it("no .tmp files remain in .husky dir after fresh install", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    await installHooks(dir);

    const huskyDir = join(dir, ".husky");
    const files = readdirSync(huskyDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("no .tmp files remain in target dir after package.json update", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    await installHooks(dir);

    const files = readdirSync(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("hooks-atomic: callsite content correctness", () => {
  it("callsite created: hook file written with template content", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    const result = await installHooks(dir);

    expect(result.hookAction).toBe("created");
    const content = readFileSync(result.hookPath, "utf8");
    // Template contains the Fabric pre-commit hook shebang and identifier
    expect(content).toContain("#!/bin/sh");
    expect(content).toContain("Fabric pre-commit hook");
  });

  it("callsite overwritten: hook file replaced entirely when force=true", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    // First install
    await installHooks(dir);
    const hookPath = join(dir, ".husky", "pre-commit");
    const originalContent = readFileSync(hookPath, "utf8");

    // Prepend custom content that is NOT the Fabric marker
    writeFileSync(hookPath, "#!/bin/sh\n# custom hook\n" + originalContent, "utf8");

    // Force overwrite
    const result = await installHooks(dir, { force: true });

    expect(result.hookAction).toBe("overwritten");
    const afterContent = readFileSync(hookPath, "utf8");
    // Should be the original template, not prepended custom content
    expect(afterContent).toBe(originalContent);
  });

  it("callsite appended: Fabric block appended when hook exists without FAB_BIN marker", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);
    const huskyDir = join(dir, ".husky");

    // Pre-create a hook without the Fabric marker
    const { mkdirSync } = await import("node:fs");
    mkdirSync(huskyDir, { recursive: true });
    const hookPath = join(huskyDir, "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\n# existing hook\n", "utf8");

    const result = await installHooks(dir);

    expect(result.hookAction).toBe("appended");
    const content = readFileSync(hookPath, "utf8");
    expect(content).toContain("# existing hook");
    expect(content).toContain("# --- Fabric ---");
    // Fabric block content is appended (shebang stripped)
    expect(content).toContain("Fabric pre-commit hook");
  });

  it("callsite package.json: prepare script added atomically", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    const result = await installHooks(dir);

    expect(result.prepareAction).toBe("added");
    const pkg = JSON.parse(readFileSync(result.packageJsonPath, "utf8"));
    expect(pkg.scripts?.prepare).toBe("husky install");
    // Verify trailing newline preserved (atomicWriteJson adds newline)
    const raw = readFileSync(result.packageJsonPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

describe("hooks-atomic: atomicWriteText called for each hook callsite", () => {
  it("atomicWriteText is called for the created callsite (1 hook write)", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteText");

    await installHooks(dir);

    // One call for the hook file (created path)
    const hookCalls = spy.mock.calls.filter(([p]) => p.endsWith("pre-commit"));
    expect(hookCalls).toHaveLength(1);
  });

  it("atomicWriteText is called for the overwritten callsite (1 hook write)", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    // First install to create hook
    await installHooks(dir);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteText");
    await installHooks(dir, { force: true });

    const hookCalls = spy.mock.calls.filter(([p]) => p.endsWith("pre-commit"));
    expect(hookCalls).toHaveLength(1);
  });

  it("atomicWriteText is called for the appended callsite (1 hook write)", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);
    const huskyDir = join(dir, ".husky");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(huskyDir, { recursive: true });
    writeFileSync(join(huskyDir, "pre-commit"), "#!/bin/sh\n# other hook\n", "utf8");

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteText");

    await installHooks(dir);

    const hookCalls = spy.mock.calls.filter(([p]) => p.endsWith("pre-commit"));
    expect(hookCalls).toHaveLength(1);
  });

  it("atomicWriteJson is called for the package.json callsite", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteJson");

    await installHooks(dir);

    const jsonCalls = spy.mock.calls.filter(([p]) => p.endsWith("package.json"));
    expect(jsonCalls).toHaveLength(1);
  });
});

describe("hooks-atomic: hook scripts have executable permission", () => {
  it("pre-commit hook has executable permission after install (0o755)", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    const result = await installHooks(dir);

    const mode = statSync(result.hookPath).mode;
    // Check owner execute bit (0o100) and group/other execute (0o010, 0o001)
    expect(mode & 0o111).toBe(0o111);
  });

  it("pre-commit hook retains executable permission after force overwrite", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);

    await installHooks(dir);
    const result = await installHooks(dir, { force: true });

    const mode = statSync(result.hookPath).mode;
    expect(mode & 0o111).toBe(0o111);
  });

  it("pre-commit hook has executable permission after append", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir);
    const huskyDir = join(dir, ".husky");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(huskyDir, { recursive: true });
    writeFileSync(join(huskyDir, "pre-commit"), "#!/bin/sh\n# existing\n", "utf8");

    const result = await installHooks(dir);

    const mode = statSync(result.hookPath).mode;
    expect(mode & 0o111).toBe(0o111);
  });
});

describe("hooks-atomic: skipped callsite (no package.json write when prepare exists)", () => {
  it("atomicWriteJson is NOT called when prepare script already exists", async () => {
    const dir = makeTempDir();
    makeMinimalPackageJson(dir, { scripts: { prepare: "husky install" } });

    const spy = vi.spyOn(atomicWriteModule, "atomicWriteJson");

    const result = await installHooks(dir);

    expect(result.prepareAction).toBe("left");
    const jsonCalls = spy.mock.calls.filter(([p]) => p.endsWith("package.json"));
    expect(jsonCalls).toHaveLength(0);
  });
});
