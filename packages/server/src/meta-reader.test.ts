import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveProjectRoot } from "./meta-reader.js";

// v2.3.0-rc.11: git-anchor resolveProjectRoot on the server side. The old
// implementation returned `process.cwd()` unchanged, so any Fabric CLI /
// server call launched from a subdirectory of the repo made downstream
// writers (metrics.ts / event-ledger.ts / plan-context.ts / vector-retrieval.ts)
// create a brand-new `<subdir>/.fabric/` alongside the real one. Cover the
// resolution order documented on the resolver and lock behavior parity with
// the hook-side twin (packages/cli/templates/hooks/lib/project-root.cjs).

const tempRoots: string[] = [];
const savedCwd = process.cwd();
let savedEnvClaude: string | undefined;
let savedEnvFabric: string | undefined;

beforeEach(() => {
  savedEnvClaude = process.env.CLAUDE_PROJECT_DIR;
  savedEnvFabric = process.env.FABRIC_PROJECT_ROOT;
  delete process.env.CLAUDE_PROJECT_DIR;
  delete process.env.FABRIC_PROJECT_ROOT;
});

afterEach(() => {
  if (savedEnvClaude === undefined) {
    delete process.env.CLAUDE_PROJECT_DIR;
  } else {
    process.env.CLAUDE_PROJECT_DIR = savedEnvClaude;
  }
  if (savedEnvFabric === undefined) {
    delete process.env.FABRIC_PROJECT_ROOT;
  } else {
    process.env.FABRIC_PROJECT_ROOT = savedEnvFabric;
  }
  process.chdir(savedCwd);
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

// macOS `/var` is a symlink to `/private/var`, so `process.chdir(deep)` +
// `process.cwd()` returns the canonical form while `mkdtempSync` returns the
// pre-resolution path. Normalise both sides through realpathSync so the
// resolver's walk (which uses the effective cwd) compares against the same
// canonicalisation.
function newTmpProject(): { root: string; deep: string } {
  const raw = mkdtempSync(join(tmpdir(), "meta-reader-"));
  tempRoots.push(raw);
  mkdirSync(join(raw, ".git"), { recursive: true });
  const root = realpathSync(raw);
  const deep = join(root, "scripts", "asset-dedup", "out");
  mkdirSync(deep, { recursive: true });
  return { root, deep };
}

describe("resolveProjectRoot (server side)", () => {
  it("returns FABRIC_PROJECT_ROOT when explicitly set (highest priority)", () => {
    const { root, deep } = newTmpProject();
    process.env.FABRIC_PROJECT_ROOT = root;
    process.env.CLAUDE_PROJECT_DIR = "/tmp/should-be-ignored";
    expect(resolveProjectRoot(deep)).toBe(root);
  });

  it("returns CLAUDE_PROJECT_DIR when FABRIC_PROJECT_ROOT is unset", () => {
    const { root, deep } = newTmpProject();
    process.env.CLAUDE_PROJECT_DIR = root;
    expect(resolveProjectRoot(deep)).toBe(root);
  });

  it("walks up to the .git anchor from a deep subdirectory (root-cause fix)", () => {
    // This is the exact fault mode that scattered .fabric across the
    // werewolf-minigame source tree — a subprocess with cwd=<repo>/scripts/
    // asset-dedup/out/. `.git` at <repo>/.git must win the walk.
    const { root, deep } = newTmpProject();
    expect(resolveProjectRoot(deep)).toBe(root);
  });

  it("falls back to the nearest .fabric anchor when no .git is present (non-git project)", () => {
    const raw = mkdtempSync(join(tmpdir(), "meta-reader-nogit-"));
    tempRoots.push(raw);
    const root = realpathSync(raw);
    mkdirSync(join(root, ".fabric"), { recursive: true });
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    expect(resolveProjectRoot(deep)).toBe(root);
  });

  it("returns startCwd unchanged when neither .git nor .fabric is found", () => {
    const raw = mkdtempSync(join(tmpdir(), "meta-reader-bare-"));
    tempRoots.push(raw);
    const root = realpathSync(raw);
    const deep = join(root, "a", "b");
    mkdirSync(deep, { recursive: true });
    // No .git, no .fabric anywhere in the chain — resolver returns the
    // start cwd so a brand-new repo still bootstraps unchanged.
    expect(resolveProjectRoot(deep)).toBe(deep);
  });

  it("uses process.cwd() when startCwd is omitted (back-compat with existing callers)", () => {
    const { root, deep } = newTmpProject();
    process.chdir(deep);
    expect(resolveProjectRoot()).toBe(root);
  });

  it("prefers the .git anchor over a stray .fabric in a subdir (immunity invariant)", () => {
    // This is the exact scenario that motivates the .git-first walk: a stale
    // .fabric/ left in a subdirectory (e.g. rc.10 residual) must NOT capture
    // the walk and become the resolved root.
    const { root, deep } = newTmpProject();
    mkdirSync(join(root, "scripts", "asset-dedup", ".fabric"), { recursive: true });
    expect(resolveProjectRoot(deep)).toBe(root);
  });
});

// Behaviour parity check — under (CLAUDE_PROJECT_DIR | .git walk | .fabric
// fallback | startCwd) the server-side resolver must return the same answer
// as the hook-side twin. FABRIC_PROJECT_ROOT is server-only, so it is not
// part of the parity contract.
describe("resolveProjectRoot ↔ hook lib/project-root.cjs parity", () => {
  const require = createRequire(import.meta.url);
  const hookResolver = require("../../cli/templates/hooks/lib/project-root.cjs") as {
    resolveProjectRoot: (startCwd?: string) => string;
  };

  it("agrees under CLAUDE_PROJECT_DIR env", () => {
    const { root, deep } = newTmpProject();
    process.env.CLAUDE_PROJECT_DIR = root;
    expect(resolveProjectRoot(deep)).toBe(hookResolver.resolveProjectRoot(deep));
  });

  it("agrees under .git anchor walk", () => {
    const { root, deep } = newTmpProject();
    expect(resolveProjectRoot(deep)).toBe(root);
    expect(hookResolver.resolveProjectRoot(deep)).toBe(root);
    expect(resolveProjectRoot(deep)).toBe(hookResolver.resolveProjectRoot(deep));
  });

  it("agrees under .fabric fallback (no .git)", () => {
    const raw = mkdtempSync(join(tmpdir(), "meta-reader-parity-nogit-"));
    tempRoots.push(raw);
    const root = realpathSync(raw);
    mkdirSync(join(root, ".fabric"), { recursive: true });
    const deep = join(root, "a", "b");
    mkdirSync(deep, { recursive: true });
    expect(resolveProjectRoot(deep)).toBe(hookResolver.resolveProjectRoot(deep));
  });
});
