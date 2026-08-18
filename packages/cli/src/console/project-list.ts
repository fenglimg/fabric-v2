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
   * Has a config segment but no registry entry. Every project is this today
   * (the registry postdates these installs) and it stays possible afterwards
   * for a repo that was moved or deleted. Configurable — the id is in hand —
   * but its path is unknown and must not be guessed.
   */
  | "config-only";

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
}): MergedProject[] {
  const { registry, configuredIds, currentProjectId } = input;
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

  for (const id of configured) {
    if (claimedIds.has(id)) continue;
    merged.push({
      projectId: id,
      path: null,
      name: id,
      origin: "config-only",
      // Staleness is a claim about a path. With no path, we do not know and
      // must not imply that we do.
      stale: false,
      isCurrent: id === currentProjectId,
      editable: true,
    });
  }

  // A project the console is sitting in but which neither source knows about
  // (installed before the registry AND never configured) would otherwise be
  // invisible on its own machine — the one project the user is most likely
  // looking for.
  if (currentProjectId !== null && !merged.some((p) => p.projectId === currentProjectId)) {
    merged.push({
      projectId: currentProjectId,
      path: null,
      name: currentProjectId,
      origin: "config-only",
      stale: false,
      isCurrent: true,
      editable: true,
    });
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}
