import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProjectContextAmbiguousError,
  ProjectContextUnresolvedError,
} from "../../src/resolver/contracts.js";
import { resolveGitWorktreeIdentity } from "../../src/resolver/git-worktree-identity.js";
import { createProjectContextResolver } from "../../src/resolver/project-context-resolver.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepo(prefix: string): string {
  const repo = tempDir(prefix);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "resolver@fabric.local"]);
  git(repo, ["config", "user.name", "Resolver Test"]);
  mkdirSync(join(repo, ".fabric"), { recursive: true });
  writeFileSync(
    join(repo, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ project_id: PROJECT_ID, required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "seed"]);
  return repo;
}

afterEach(() => {
  for (const dir of dirs.splice(0).reverse()) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createProjectContextResolver", () => {
  it("inherits identity and binding across a real linked worktree", () => {
    const repo = createRepo("fabric-context-main-");
    const worktreeParent = tempDir("fabric-context-linked-");
    const worktree = join(worktreeParent, "work");
    git(repo, ["worktree", "add", "-b", "linked", worktree]);

    const main = createProjectContextResolver({ roots: [repo] });
    const linked = createProjectContextResolver({ roots: [worktree] });
    const gitIdentity = resolveGitWorktreeIdentity(worktree);

    expect(linked.workspaceRoot).not.toBe(main.workspaceRoot);
    expect(linked.identityRoot).toBe(main.identityRoot);
    expect(linked.projectId).toBe(main.projectId);
    expect(linked.bindingId).toBe(main.bindingId);
    expect(gitIdentity?.gitDir).not.toBe(gitIdentity?.commonDir);
    expect(Object.isFrozen(linked)).toBe(true);
  });

  it("keeps project identity while an explicit workspace_binding_id isolates state", () => {
    const repo = createRepo("fabric-context-isolation-main-");
    const worktreeParent = tempDir("fabric-context-isolation-linked-");
    const worktree = join(worktreeParent, "work");
    git(repo, ["worktree", "add", "-b", "isolated", worktree]);
    writeFileSync(
      join(worktree, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ project_id: PROJECT_ID, workspace_binding_id: "worktree-isolated" }, null, 2)}\n`,
    );

    const context = createProjectContextResolver({ roots: [worktree] });
    expect(context.projectId).toBe(PROJECT_ID);
    expect(context.bindingId).toBe("worktree-isolated");
  });

  it("uses an explicit root ahead of ambiguous client roots", () => {
    const selected = createRepo("fabric-context-explicit-");
    const other = createRepo("fabric-context-other-");
    const context = createProjectContextResolver({
      explicitRoot: selected,
      roots: [selected, other],
    });
    expect(context.workspaceRoot).toBe(realpathSync(selected));
    expect(context.source).toBe("explicit-pin");
  });

  it("throws a typed error without an anchored project root", () => {
    const rootless = tempDir("fabric-context-rootless-");
    expect(() => createProjectContextResolver({ cwd: rootless })).toThrow(
      ProjectContextUnresolvedError,
    );
    expect(() => createProjectContextResolver({ roots: [] })).toThrow(
      ProjectContextUnresolvedError,
    );
  });

  it("throws a typed error for multiple distinct workspace roots", () => {
    const first = createRepo("fabric-context-first-");
    const second = createRepo("fabric-context-second-");
    expect(() => createProjectContextResolver({ roots: [first, second] })).toThrow(
      ProjectContextAmbiguousError,
    );
  });
});
