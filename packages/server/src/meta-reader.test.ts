import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isProjectRootConfigured,
  resetMcpRootsHint,
  resolveProjectRoot,
  setMcpRootsHint,
} from "./meta-reader.js";

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
  resetMcpRootsHint();
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

// ISS werewolf-minigame (rootless MCP spawn, KT-PIT-0046): MCP client roots
// slot between the env overrides and the cwd climb. `startCwd` below plays the
// role of the degenerate spawn cwd ("/" in the wild — an anchor-free tmpdir in
// tests, since climbing from the real "/" could hit developer-machine markers).
describe("resolveProjectRoot — MCP client roots hint", () => {
  function newBareDir(prefix: string): string {
    const raw = mkdtempSync(join(tmpdir(), prefix));
    tempRoots.push(raw);
    return realpathSync(raw);
  }

  it("uses the roots hint when env is unset and cwd has no anchor (rootless-spawn repro)", () => {
    const { root } = newTmpProject();
    const bare = newBareDir("meta-reader-rootless-");
    setMcpRootsHint([root]);
    expect(resolveProjectRoot(bare)).toBe(root);
  });

  it("climbs from a roots hint that points inside the project", () => {
    const { root, deep } = newTmpProject();
    const bare = newBareDir("meta-reader-rootless-");
    setMcpRootsHint([deep]);
    expect(resolveProjectRoot(bare)).toBe(root);
  });

  it("env overrides beat the roots hint (FABRIC_PROJECT_ROOT > CLAUDE_PROJECT_DIR > roots)", () => {
    const { root: envRoot } = newTmpProject();
    const { root: hintRoot } = newTmpProject();
    setMcpRootsHint([hintRoot]);
    process.env.CLAUDE_PROJECT_DIR = envRoot;
    expect(resolveProjectRoot(newBareDir("meta-reader-rootless-"))).toBe(envRoot);
    process.env.FABRIC_PROJECT_ROOT = hintRoot;
    expect(resolveProjectRoot(newBareDir("meta-reader-rootless-"))).toBe(hintRoot);
  });

  it("an anchored cwd climb is NOT preempted by an unanchored roots hint", () => {
    const { root, deep } = newTmpProject();
    const bareHint = newBareDir("meta-reader-barehint-");
    setMcpRootsHint([bareHint]);
    // Hint has no .git/.fabric; the cwd climb finds the real anchor.
    expect(resolveProjectRoot(deep)).toBe(root);
  });

  it("an unanchored roots hint still beats an unanchored cwd (better than '/')", () => {
    const bareHint = newBareDir("meta-reader-barehint-");
    const bareCwd = newBareDir("meta-reader-barecwd-");
    setMcpRootsHint([bareHint]);
    expect(resolveProjectRoot(bareCwd)).toBe(bareHint);
  });

  it("skips unusable roots: nonexistent paths and the filesystem root", () => {
    const { root } = newTmpProject();
    const accepted = setMcpRootsHint(["/", join(tmpdir(), "does-not-exist-xyz"), root]);
    expect(accepted).toEqual([root]);
    expect(resolveProjectRoot(newBareDir("meta-reader-rootless-"))).toBe(root);
  });

  it("resetMcpRootsHint restores the pre-hint fallback", () => {
    const { root } = newTmpProject();
    const bare = newBareDir("meta-reader-rootless-");
    setMcpRootsHint([root]);
    resetMcpRootsHint();
    expect(resolveProjectRoot(bare)).toBe(bare);
  });
});

describe("isProjectRootConfigured", () => {
  it("is true only when .fabric/fabric-config.json exists at the root", () => {
    const { root } = newTmpProject();
    expect(isProjectRootConfigured(root)).toBe(false);
    mkdirSync(join(root, ".fabric"), { recursive: true });
    expect(isProjectRootConfigured(root)).toBe(false);
    writeFileSync(join(root, ".fabric", "fabric-config.json"), "{}\n");
    expect(isProjectRootConfigured(root)).toBe(true);
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
