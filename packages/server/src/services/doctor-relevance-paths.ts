import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

import { minimatch } from "minimatch";

import type { Translator } from "@fenglimg/fabric-shared";

import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import type { DoctorCheck } from "./doctor.js";

// ---------------------------------------------------------------------------
// v2.2 Goal B (G-RELEVANCE) — relevance_paths hygiene lints over the read-set
// stores. The post-decolo successors of rc.5 TASK-013 (#24 dangling / #25
// drift), rebuilt store-aware. The knowledge entries come from the mounted
// stores, but their `relevance_paths` globs anchor the PROJECT workspace (the
// repo being checked) — so the glob targets are resolved against `projectRoot`,
// exactly as the co-location version did.
//
//   relevance_paths_dangling — a glob in an entry's relevance_paths that
//                              resolves to zero files/dirs in the workspace
//                              (the anchor points at code that no longer
//                              exists). Warning kind.
//   relevance_paths_drift    — a narrow-scope entry whose relevance_paths
//                              globs match no file touched in the last
//                              RELEVANCE_PATHS_DRIFT_WINDOW_DAYS of git history
//                              (the anchored code has gone quiet — the entry
//                              may be stale). Info kind; git-log heuristic that
//                              degrades to ok when git is unavailable.
//
// #23 narrow_no_paths is intentionally NOT rebuilt (co-location niche, dropped
// in the fallback-purge backlog). Pure read; never throws.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// rc.5 TASK-013 drift window: 90 days of git history. Hardcoded (matches
// KT-DEC-0008 decay cadence; a config override may land if dogfooding warrants).
export const RELEVANCE_PATHS_DRIFT_WINDOW_DAYS = 90;

// Directories excluded from the workspace path scan — keeps the candidate list
// bounded so dangling-glob matching stays cheap.
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".fabric",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

export type DanglingGlobEntry = {
  stable_id: string; // store-qualified id (`<alias>:<local-id>`)
  path: string; // display path of the holding entry
  dangling_glob: string; // the glob that resolved to zero matches
};

export interface RelevancePathsDanglingInspection {
  entries: DanglingGlobEntry[];
}

export type RelevancePathsDriftCandidate = {
  stable_id: string;
  path: string;
  globs: string[]; // all relevance_paths globs (for the message)
};

export interface RelevancePathsDriftInspection {
  candidates: RelevancePathsDriftCandidate[];
  // False when git was unavailable / the call failed — the check downgrades to
  // an ok+info message rather than firing on every entry.
  git_available: boolean;
}

export interface RelevancePathsInspection {
  dangling: RelevancePathsDanglingInspection;
  drift: RelevancePathsDriftInspection;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

// A trailing-slash anchor (`src/foo/`) is shorthand for "this dir + all
// descendants" — expand to a `**` glob so minimatch resolves it.
function expandGlob(rawGlob: string): string {
  return rawGlob.endsWith("/") ? `${rawGlob}**` : rawGlob;
}

// Walk the workspace once to collect project-relative POSIX paths (files AND
// dirs, so directory-anchor globs resolve). Skips IGNORED_DIRECTORIES.
function collectWorkspacePaths(projectRoot: string): string[] {
  if (!existsSync(projectRoot)) {
    return [];
  }
  try {
    if (!statSync(projectRoot).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  const paths: string[] = [];
  const stack: string[] = [projectRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(current, entry.name);
      const rel = toPosix(abs.slice(projectRoot.length + 1));
      if (rel.length === 0) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        paths.push(rel);
        stack.push(abs);
      } else if (entry.isFile()) {
        paths.push(rel);
      }
    }
  }
  return paths;
}

// Shell out to `git log` for the union of paths touched in the window. Throws
// when git is unavailable / the workspace is not a repo (caller downgrades).
function readRecentGitTouchedPaths(projectRoot: string, windowDays: number): string[] {
  const since = new Date(Date.now() - windowDays * MS_PER_DAY).toISOString();
  const stdout = execFileSync(
    "git",
    ["log", `--since=${since}`, "--name-only", "--pretty=format:"],
    { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  const set = new Set<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      set.add(toPosix(trimmed));
    }
  }
  return Array.from(set);
}

// Single store-corpus walk computing both relevance_paths hygiene inspections.
export async function inspectStoreRelevancePaths(
  projectRoot: string,
): Promise<RelevancePathsInspection> {
  const entries = await collectStoreCanonicalEntries(projectRoot);

  // --- #24 dangling -------------------------------------------------------
  const danglingEntries: DanglingGlobEntry[] = [];
  const workspacePaths = collectWorkspacePaths(projectRoot);
  if (workspacePaths.length > 0) {
    for (const entry of entries) {
      const paths = entry.description.relevance_paths ?? [];
      for (const rawGlob of paths) {
        const glob = expandGlob(rawGlob);
        const matched = workspacePaths.some((target) =>
          minimatch(target, glob, { dot: true, matchBase: false }),
        );
        if (!matched) {
          danglingEntries.push({
            stable_id: entry.qualifiedId,
            path: `store:${entry.qualifiedId}`,
            dangling_glob: rawGlob,
          });
        }
      }
    }
  }
  danglingEntries.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    return byPath !== 0 ? byPath : a.dangling_glob.localeCompare(b.dangling_glob);
  });

  // --- #25 drift ----------------------------------------------------------
  let recentPaths: string[] | null = null;
  try {
    recentPaths = readRecentGitTouchedPaths(projectRoot, RELEVANCE_PATHS_DRIFT_WINDOW_DAYS);
  } catch {
    recentPaths = null;
  }
  const driftCandidates: RelevancePathsDriftCandidate[] = [];
  if (recentPaths !== null) {
    for (const entry of entries) {
      if (entry.description.relevance_scope !== "narrow") {
        continue;
      }
      const paths = entry.description.relevance_paths ?? [];
      if (paths.length === 0) {
        // narrow-with-no-paths is the dropped #23 lint's surface — drift only
        // applies when there ARE globs to evaluate.
        continue;
      }
      const anyMatch = paths.some((rawGlob) => {
        const glob = expandGlob(rawGlob);
        return recentPaths!.some((target) =>
          minimatch(target, glob, { dot: true, matchBase: false }),
        );
      });
      if (!anyMatch) {
        driftCandidates.push({
          stable_id: entry.qualifiedId,
          path: `store:${entry.qualifiedId}`,
          globs: paths.slice(),
        });
      }
    }
  }
  driftCandidates.sort((a, b) => a.path.localeCompare(b.path));

  return {
    dangling: { entries: danglingEntries },
    drift: { candidates: driftCandidates, git_available: recentPaths !== null },
  };
}

export function createRelevancePathsDanglingCheck(
  t: Translator,
  inspection: RelevancePathsDanglingInspection,
): DoctorCheck {
  if (inspection.entries.length === 0) {
    return {
      name: t("doctor.check.relevance_paths_dangling.name"),
      status: "ok",
      message: t("doctor.check.relevance_paths_dangling.ok"),
    };
  }
  const first = inspection.entries[0];
  const detail = `${first.stable_id} at ${first.path} → \`${first.dangling_glob}\` (0 matches)`;
  const count = inspection.entries.length;
  return {
    name: t("doctor.check.relevance_paths_dangling.name"),
    status: "warn",
    kind: "warning",
    code: "knowledge_relevance_paths_dangling",
    fixable: false,
    message: t(`doctor.check.relevance_paths_dangling.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    actionHint: t("doctor.check.relevance_paths_dangling.remediation"),
  };
}

export function createRelevancePathsDriftCheck(
  t: Translator,
  inspection: RelevancePathsDriftInspection,
): DoctorCheck {
  if (!inspection.git_available) {
    return {
      name: t("doctor.check.relevance_paths_drift.name"),
      status: "ok",
      message: t("doctor.check.relevance_paths_drift.ok.skipped", {
        windowDays: String(RELEVANCE_PATHS_DRIFT_WINDOW_DAYS),
      }),
    };
  }
  if (inspection.candidates.length === 0) {
    return {
      name: t("doctor.check.relevance_paths_drift.name"),
      status: "ok",
      message: t("doctor.check.relevance_paths_drift.ok.fresh", {
        windowDays: String(RELEVANCE_PATHS_DRIFT_WINDOW_DAYS),
      }),
    };
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} at ${first.path} (globs: ${first.globs.join(", ")})`;
  const count = inspection.candidates.length;
  return {
    name: t("doctor.check.relevance_paths_drift.name"),
    // Info kind — git-log heuristic is noisy; never bumps doctor status.
    status: "ok",
    kind: "info",
    code: "knowledge_relevance_paths_drift",
    fixable: false,
    message: t(`doctor.check.relevance_paths_drift.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
      windowDays: String(RELEVANCE_PATHS_DRIFT_WINDOW_DAYS),
    }),
    actionHint: t("doctor.check.relevance_paths_drift.remediation"),
  };
}
