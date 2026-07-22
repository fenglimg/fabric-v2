import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAIN_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const UNRELATED_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
export const ISOLATED_WORKSPACE_BINDING_ID = "linked-worktree-isolated";

export type GitFixtureRoot = "main" | "linked" | "unrelated";

export interface GitWorktreeFixture {
  base: string;
  main: string;
  linked: string;
  unrelated: string;
  configureLinkedBinding(mode: "inherited" | "isolated"): void;
  cleanup(): void;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureCommitter(repo: string): void {
  git(repo, ["config", "user.email", "matrix@fabric.local"]);
  git(repo, ["config", "user.name", "Fabric Matrix"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
}

function writeProjectConfig(root: string, projectId: string, workspaceBindingId?: string): void {
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    `${JSON.stringify({
      project_id: projectId,
      required_stores: [{ id: "team" }],
      ...(workspaceBindingId === undefined ? {} : { workspace_binding_id: workspaceBindingId }),
    }, null, 2)}\n`,
    "utf8",
  );
}

function initializeCommittedRepo(root: string, projectId: string): void {
  mkdirSync(root, { recursive: true });
  git(root, ["init", "-b", "main"]);
  configureCommitter(root);
  writeProjectConfig(root, projectId);
  writeFileSync(join(root, "README.md"), `fixture ${projectId}\n`, "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "seed fixture"]);
}

/**
 * Create a committed main repository, a real linked worktree, and an unrelated
 * committed repository. The linked checkout starts without a workspace-local
 * `.fabric`, so identity and binding must be inherited from the Git common dir.
 */
export function createGitWorktreeFixture(): GitWorktreeFixture {
  const base = mkdtempSync(join(tmpdir(), "fabric-context-matrix-"));
  const main = join(base, "main");
  const linked = join(base, "linked");
  const unrelated = join(base, "unrelated");

  initializeCommittedRepo(main, MAIN_PROJECT_ID);
  // Exercise the real `git worktree add` boundary rather than copying a checkout.
  git(main, ["worktree", "add", "-b", "matrix-linked", linked]);
  rmSync(join(linked, ".fabric"), { recursive: true, force: true });
  initializeCommittedRepo(unrelated, UNRELATED_PROJECT_ID);

  let cleaned = false;
  return {
    base,
    main,
    linked,
    unrelated,
    configureLinkedBinding(mode) {
      rmSync(join(linked, ".fabric"), { recursive: true, force: true });
      if (mode === "isolated") {
        writeProjectConfig(linked, MAIN_PROJECT_ID, ISOLATED_WORKSPACE_BINDING_ID);
      }
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        git(main, ["worktree", "remove", "--force", linked]);
        git(main, ["worktree", "prune"]);
      } catch {
        // Recursive cleanup below is the deterministic fallback for partial fixtures.
      }
      rmSync(base, { recursive: true, force: true });
    },
  };
}

export function fixtureRoot(fixture: GitWorktreeFixture, root: GitFixtureRoot): string {
  return fixture[root];
}
