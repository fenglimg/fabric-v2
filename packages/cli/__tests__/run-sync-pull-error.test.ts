import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultPull } from "../src/sync/run-sync.js";
import { hasActionHint } from "../src/lib/error-render.js";

// W3-04 (ISS-032) — a git pull failure that is neither a rebase CONFLICT nor an
// offline/network error (here: a branch with no upstream tracking info) must
// surface git's own diagnostic in an actionable FabricError, instead of
// execFileSync's bare "Command failed: git pull --rebase".

const dirs: string[] = [];

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "fabric-pull-err-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-b", "main", dir], { stdio: ["ignore", "ignore", "pipe"] });
  git(dir, ["config", "user.email", "t@f.local"]);
  git(dir, ["config", "user.name", "T"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "f.txt"), "x", "utf8");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir; // no upstream configured → `git pull --rebase` fails (not conflict/offline)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("defaultPull error surfacing", () => {
  it("throws a FabricError carrying git's diagnostic + a remedy hint", () => {
    const repo = tmpRepo();
    const err = (() => {
      try {
        defaultPull(repo);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).not.toBeNull();
    expect(hasActionHint(err)).toBe(true);
  });
});
