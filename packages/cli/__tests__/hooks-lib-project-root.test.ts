/**
 * Unit tests for the shared project-root resolver
 * (templates/hooks/lib/project-root.cjs).
 *
 * Regression guard for the stray-`.fabric` bug: hooks used to derive their
 * `.fabric` base from `process.cwd()` (the session's subdirectory), scattering
 * telemetry dirs across the source tree. resolveProjectRoot pins the
 * resolution order — CLAUDE_PROJECT_DIR → nearest `.git` ancestor → nearest
 * `.fabric` ancestor → unchanged cwd — and the critical stray-immune property:
 * a `.fabric/` left in an intermediate directory must NOT capture the walk.
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { resolveProjectRoot } = require("../templates/hooks/lib/project-root.cjs") as {
  resolveProjectRoot: (startCwd?: string) => string;
};

const savedEnv = { ...process.env };
const tmpDirs: string[] = [];

function makeTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

beforeEach(() => {
  delete process.env.CLAUDE_PROJECT_DIR;
});

afterEach(() => {
  process.env = { ...savedEnv };
  for (const d of tmpDirs.splice(0)) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

describe("resolveProjectRoot — shared hook project-root resolver", () => {
  it("returns CLAUDE_PROJECT_DIR verbatim when set, ignoring the filesystem walk", () => {
    const base = makeTmp("pr-env-");
    const sub = join(base, "packages", "cli", "src");
    mkdirSync(sub, { recursive: true });
    process.env.CLAUDE_PROJECT_DIR = "/explicit/project/root";
    expect(resolveProjectRoot(sub)).toBe("/explicit/project/root");
  });

  it("walks up to the nearest .git ancestor from a deep subdirectory", () => {
    const base = makeTmp("pr-git-");
    mkdirSync(join(base, ".git"), { recursive: true });
    const sub = join(base, "packages", "cli", "src", "commands");
    mkdirSync(sub, { recursive: true });
    expect(resolveProjectRoot(sub)).toBe(base);
  });

  it("is stray-immune: a .fabric in an intermediate dir does NOT capture the walk — .git root wins", () => {
    const base = makeTmp("pr-stray-");
    mkdirSync(join(base, ".git"), { recursive: true });
    const mid = join(base, "packages", "cli");
    mkdirSync(join(mid, ".fabric"), { recursive: true }); // stray telemetry dir
    const sub = join(mid, "src", "commands");
    mkdirSync(sub, { recursive: true });
    expect(resolveProjectRoot(sub)).toBe(base);
  });

  it("falls back to the nearest .fabric anchor when no .git exists anywhere up the chain", () => {
    const base = makeTmp("pr-nogit-");
    const proj = join(base, "proj");
    mkdirSync(join(proj, ".fabric"), { recursive: true });
    const sub = join(proj, "sub", "deep");
    mkdirSync(sub, { recursive: true });
    expect(resolveProjectRoot(sub)).toBe(proj);
  });

  it("returns the start cwd unchanged when no .git or .fabric marker is found", () => {
    const bare = makeTmp("pr-bare-");
    expect(resolveProjectRoot(bare)).toBe(bare);
  });

  it("defaults to process.cwd() when called with no argument", () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    // process.cwd() is inside this git repo, so the resolver climbs to a .git root.
    const got = resolveProjectRoot();
    expect(typeof got).toBe("string");
    expect(existsSync(join(got, ".git")) || got === process.cwd()).toBe(true);
  });
});
