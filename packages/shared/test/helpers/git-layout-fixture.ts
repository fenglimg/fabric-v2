import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Git layout fixtures for project-identity resolution.
 *
 * The pre-existing `git-worktree-fixture.ts` covers exactly one layout (a normal
 * repository plus one linked worktree) and *removes* the linked checkout's
 * `.fabric/` directory so identity has to be inherited from the Git common dir.
 * That deletion manufactures the very premise the old resolver was built on:
 * a real `git worktree add` carries the committed `.fabric/fabric-config.json`
 * into every checkout.
 *
 * This fixture therefore keeps the config committed by default and exposes
 * `dropLocalConfig()` for the genuinely cold path, so tests can tell apart
 * "identity came from this checkout" and "identity was inherited".
 */

export const LAYOUT_PROJECT_ID = "33333333-3333-4333-8333-333333333333";

export type GitLayoutKind =
  /** Normal repository + one linked worktree. */
  | "normal-linked"
  /** Bare repository named `foo.git`, hosting two worktrees. */
  | "bare-named"
  /** The `.bare` convention: `<dir>/.bare` plus a `<dir>/.git` file. */
  | "bare-dotbare"
  /** Bare repository placed at `<container>/.git` — container is not a checkout. */
  | "bare-as-dotgit";

export const GIT_LAYOUT_KINDS: readonly GitLayoutKind[] = [
  "normal-linked",
  "bare-named",
  "bare-dotbare",
  "bare-as-dotgit",
] as const;

export interface GitLayout {
  kind: GitLayoutKind;
  /** The container directory holding the repository and its checkouts. */
  container: string;
  /** The main checkout, or null for bare-hosted layouts (they have none). */
  mainCheckout: string | null;
  /** Every non-main checkout produced by `git worktree add`, in creation order. */
  worktrees: readonly string[];
  /** Remove a checkout's own `.fabric/` so identity must be inherited. */
  dropLocalConfig(checkout: string): void;
}

export interface GitLayoutFixture {
  base: string;
  layout(kind: GitLayoutKind): GitLayout;
  cleanup(): void;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureCommitter(repo: string): void {
  git(repo, ["config", "user.email", "layout@fabric.local"]);
  git(repo, ["config", "user.name", "Fabric Layout"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
}

/** Seed repository whose `.fabric/fabric-config.json` is committed, so every
 *  checkout cloned or worktree-added from it carries the same project identity. */
function createSeed(base: string): string {
  const seed = join(base, "seed");
  mkdirSync(join(seed, ".fabric"), { recursive: true });
  git(seed, ["init", "-b", "main"]);
  configureCommitter(seed);
  writeFileSync(
    join(seed, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ project_id: LAYOUT_PROJECT_ID, required_stores: [{ id: "team" }] }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(seed, "README.md"), "layout fixture\n", "utf8");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "seed layout fixture"]);
  return seed;
}

function dropLocalConfig(checkout: string): void {
  rmSync(join(checkout, ".fabric"), { recursive: true, force: true });
}

function buildLayout(base: string, seed: string, kind: GitLayoutKind): GitLayout {
  const container = join(base, kind);
  mkdirSync(container, { recursive: true });

  const common = { kind, container, dropLocalConfig } as const;

  if (kind === "normal-linked") {
    const main = join(container, "main");
    git(base, ["clone", "--quiet", seed, main]);
    configureCommitter(main);
    const linked = join(container, "linked");
    git(main, ["worktree", "add", "-b", "layout-linked", linked]);
    return { ...common, mainCheckout: realpathSync(main), worktrees: [realpathSync(linked)] };
  }

  // Every remaining layout is bare-hosted: there is no main checkout at all.
  const bareDir =
    kind === "bare-named"
      ? join(container, "foo.git")
      : kind === "bare-dotbare"
        ? join(container, ".bare")
        : join(container, ".git");

  git(base, ["clone", "--quiet", "--bare", seed, bareDir]);

  if (kind === "bare-dotbare") {
    // The `.bare` convention points the container's `.git` file at the bare repo.
    writeFileSync(join(container, ".git"), "gitdir: ./.bare\n", "utf8");
  }

  const names = kind === "bare-named" ? ["wt1", "wt2"] : ["wt1"];
  const worktrees = names.map((name, index) => {
    const path = join(container, name);
    git(bareDir, ["worktree", "add", "-b", `layout-${kind}-${index}`, path]);
    return realpathSync(path);
  });

  return { ...common, mainCheckout: null, worktrees };
}

export function createGitLayoutFixture(): GitLayoutFixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "fabric-git-layout-")));
  const seed = createSeed(base);
  const built = new Map<GitLayoutKind, GitLayout>();

  let cleaned = false;
  return {
    base,
    layout(kind) {
      const existing = built.get(kind);
      if (existing !== undefined) return existing;
      const layout = buildLayout(base, seed, kind);
      built.set(kind, layout);
      return layout;
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      rmSync(base, { recursive: true, force: true });
    },
  };
}
