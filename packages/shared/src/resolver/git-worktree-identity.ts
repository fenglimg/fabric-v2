import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export interface GitWorktreeIdentity {
  workspaceRoot: string;
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

/** Read the Git facts about the active checkout. Reports only what Git states —
 *  project identity is decided by the resolver, not inferred from these paths. */
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
    return Object.freeze({ workspaceRoot, gitDir, commonDir });
  } catch {
    return null;
  }
}

/**
 * The repository's MAIN worktree, as reported by Git itself.
 *
 * `git worktree list --porcelain` emits blank-line separated records and the
 * first record is always the main worktree. A bare repository marks that record
 * `bare`: it has no checkout, so there is nothing to inherit identity from and
 * this returns null rather than naming a directory that is not a working tree.
 *
 * This replaces the previous `basename(commonDir) === ".git"` heuristic, which
 * silently produced a wrong answer for bare-hosted worktree layouts (a bare repo
 * at `<container>/.git` made `<container>` — not a checkout at all — look like
 * the main repository) and could never fail, only mislead.
 */
export function resolveMainWorktree(start: string): string | null {
  const absolute = resolve(start);
  if (!existsSync(absolute)) {
    return null;
  }

  try {
    const [firstRecord = ""] = git(absolute, ["worktree", "list", "--porcelain"]).split(/\r?\n\r?\n/);
    const lines = firstRecord.split(/\r?\n/);
    if (lines.some((line) => line.trim() === "bare")) {
      return null;
    }
    const declared = lines.find((line) => line.startsWith("worktree "));
    if (declared === undefined) {
      return null;
    }
    const path = declared.slice("worktree ".length).trim();
    return path.length > 0 && existsSync(path) ? canonical(path) : null;
  } catch {
    return null;
  }
}
