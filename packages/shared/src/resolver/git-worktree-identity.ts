import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export interface GitWorktreeIdentity {
  workspaceRoot: string;
  identityRoot: string;
  gitDir: string;
  commonDir: string;
}

function git(start: string, args: string[]): string {
  return execFileSync("git", ["-C", start, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function canonical(path: string): string {
  return realpathSync(path);
}

/** Resolve the active checkout separately from the repository's shared identity. */
export function resolveGitWorktreeIdentity(start: string): Readonly<GitWorktreeIdentity> | null {
  const absolute = resolve(start);
  if (!existsSync(absolute)) {
    return null;
  }

  try {
    const workspaceRoot = canonical(git(absolute, ["rev-parse", "--show-toplevel"]));
    const gitDir = canonical(git(absolute, ["rev-parse", "--absolute-git-dir"]));
    const commonRaw = git(absolute, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const commonDir = canonical(isAbsolute(commonRaw) ? commonRaw : resolve(workspaceRoot, commonRaw));

    // A normal repository and all of its linked worktrees share <main>/.git.
    // The linked worktree's own gitDir is <main>/.git/worktrees/<name> and must
    // never be treated as the project identity root.
    const identityRoot = basename(commonDir) === ".git" ? canonical(dirname(commonDir)) : workspaceRoot;
    return Object.freeze({ workspaceRoot, identityRoot, gitDir, commonDir });
  } catch {
    return null;
  }
}
