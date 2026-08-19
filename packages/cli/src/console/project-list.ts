// ---------------------------------------------------------------------------
// The machine's project list — merged from two half-complete sources.
//
// Neither source alone can answer "which projects are on this machine, and
// which of them can I configure":
//
//   ~/.fabric/state/projects.json   has the PATH, may lack a project_id
//                                   (an install with no store binding never
//                                   gets one)
//   fabric-global.json `projects`   has the project_id and the actual
//                                   overrides, and can NEVER supply a path —
//                                   the segment is keyed by id and nothing
//                                   maps an id back to a directory
//
// Merging on `project_id` is therefore not a nicety; taking either source alone
// hides a real category of project from the page. Kept as a pure function
// because this is the one place in the feature with genuine branching, and
// branching is far cheaper to pin here than through an assembled view.
// ---------------------------------------------------------------------------

import type { RegisteredProjectView } from "../store/project-registry-io.js";

/**
 * Where the knowledge of this project came from — which determines what the
 * page may claim about it and whether it can be configured at all.
 */
export type ProjectOrigin =
  /** Registered AND carries overrides (or at least an id). The normal case. */
  | "both"
  /**
   * Registered, but no `project_id` — an install that never bound a store.
   * Visible but NOT configurable: per-project settings live under
   * `projects[<id>]`, so with no id there is no location to write to.
   */
  | "registry-only"
  /**
   * Not registered, and its directory is unknown. Every project is this today
   * (the registry postdates these installs) and it stays possible afterwards
   * for a repo that was moved or deleted. Configurable — the id is in hand —
   * but its path must not be guessed.
   */
  | "config-only"
  /**
   * Not registered either, but the console is running INSIDE it, so its path is
   * known first-hand rather than guessed. That is the whole difference from
   * `config-only`, and it is the difference between a row labelled by directory
   * and openable as a scope, and a bare uuid that cannot be opened at all.
   *
   * Whether it also has a config segment is deliberately not encoded here: it
   * changes nothing a caller does. What every caller needs from origin is "is it
   * registered" (no — same `fabric install` remedy as `config-only`) and "do we
   * know where it is" (yes — unlike `config-only`).
   */
  | "current-only";

export interface MergedProject {
  /** null only for `registry-only`. */
  projectId: string | null;
  /** null for `config-only` — unknown, not "none". */
  path: string | null;
  /** Basename of `path`, or the id when there is no path. Display only. */
  name: string;
  origin: ProjectOrigin;
  /** Registry says it is installed at a path that no longer exists. */
  stale: boolean;
  /** True when the console was launched from this project. */
  isCurrent: boolean;
  /** False for `registry-only` — see {@link ProjectOrigin}. */
  editable: boolean;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]+/u).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/**
 * Merge the two sources into one list.
 *
 * Ordering is by display name and NOTHING else — specifically not "current
 * project first".
 *
 * Current-first was the first version, on the reasoning that it is what the user
 * came to change. It also made the list order depend on the launch directory,
 * which is the exact property this whole page exists to remove: two consoles
 * open on one machine would disagree about the order of the same list. The
 * current project is marked with `isCurrent` and the page badges it, which
 * serves findability without letting the working directory reorder anything.
 *
 * A unit fixture whose current project sorted first either way passed the
 * cwd-independence assertion while this was still broken; only a real
 * two-directory comparison caught it.
 */
export function mergeProjectList(input: {
  registry: readonly RegisteredProjectView[];
  /** Keys of the global config's `projects` segment. */
  configuredIds: readonly string[];
  /** `project_id` of the launch directory, when it has one. */
  currentProjectId: string | null;
  /**
   * Absolute path of the launch directory. Used ONLY to fill in the synthesized
   * current-project row, which otherwise has no path and would be labelled with
   * a bare uuid — and would be unopenable as a scope on exactly the machines
   * where it is the only project there is.
   *
   * Required rather than optional: an optional path is how the read side and the
   * write side came to build different lists from the same function.
   */
  currentProjectPath: string | null;
}): MergedProject[] {
  const { registry, configuredIds, currentProjectId, currentProjectPath } = input;
  const configured = new Set(configuredIds);
  const merged: MergedProject[] = [];
  const claimedIds = new Set<string>();

  for (const entry of registry) {
    const projectId = entry.projectId ?? null;
    // A registry entry with no id can never be matched to a config segment, so
    // it is always its own row — several such rows can coexist.
    if (projectId !== null) claimedIds.add(projectId);
    merged.push({
      projectId,
      path: entry.path,
      name: basename(entry.path),
      origin: projectId === null ? "registry-only" : "both",
      stale: entry.stale,
      isCurrent: projectId !== null && projectId === currentProjectId,
      editable: projectId !== null,
    });
  }

  // Everything the registry did not account for, from BOTH remaining sources at
  // once: ids that carry config overrides, and the launch directory's own id
  // when it carries none.
  //
  // These were two separate loops, and the split was the bug: the launch
  // directory's path was only filled in by the second one, which never ran when
  // the first had already claimed the id. On the machine this was written for —
  // where every project has a config segment and none is registered — that meant
  // the ONE project whose directory we know first-hand was the one rendered as a
  // bare uuid, and it was unopenable as a scope for want of a path we were
  // standing in.
  const unregistered = new Set(configured);
  if (currentProjectId !== null) unregistered.add(currentProjectId);

  for (const id of unregistered) {
    if (claimedIds.has(id)) continue;
    // The path is used ONLY for the current row, where it is observed rather
    // than looked up. No other id can be given one: nothing maps an id back to
    // a directory (KT-PIT-0050), and guessing would put a wrong path on a row
    // the user can click.
    const isCurrent = id === currentProjectId;
    const path = isCurrent ? currentProjectPath : null;
    merged.push({
      projectId: id,
      path,
      name: path === null ? id : basename(path),
      origin: path === null ? "config-only" : "current-only",
      // Staleness is a claim about a path. With no path, we do not know and
      // must not imply that we do; with the path we are standing in, it is by
      // construction not stale.
      stale: false,
      isCurrent,
      editable: true,
    });
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}
