// ---------------------------------------------------------------------------
// The machine's project list — merged from THREE half-complete sources.
//
// No source alone can answer "which projects are on this machine, and which of
// them can I open":
//
//   ~/.fabric/state/projects.json   has the PATH, may lack a project_id
//                                   (an install with no store binding never
//                                   gets one). Young: written only by `fabric
//                                   install`, and added long after people
//                                   started installing.
//   fabric-global.json `projects`   has the project_id and the actual
//                                   overrides, and can NEVER supply a path —
//                                   the segment is keyed by id and nothing
//                                   maps an id back to a directory
//   ~/.fabric/state/bindings/       has a project_id per project that ever
//                                   bound a store. The FULLEST source on a
//                                   real machine, and also pathless.
//
// The third source was missing until it was measured: registry 1, config 1,
// bindings 8. The page rendered one project and — because a project that never
// entered the list cannot be counted as blocked — reported nothing hidden. A
// switcher that silently claims your machine has one project is worse than one
// that says "8, and I can only open 1".
//
// Merging on `project_id` is therefore not a nicety; taking any source alone
// hides a real category of project. Kept as a pure function because this is the
// one place in the feature with genuine branching, and branching is far cheaper
// to pin here than through an assembled view.
// ---------------------------------------------------------------------------

import { asPlainObject, currentProjectIdOf } from "./config-resolve.js";
import { listBoundProjectIds } from "../store/bindings-io.js";
import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import {
  listRegisteredProjects,
  type RegisteredProjectView,
} from "../store/project-registry-io.js";

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
   * Known by id only — from a config segment, a store binding, or both — with
   * no directory to go with it. Most projects are this until someone runs the
   * scan (the registry postdates these installs), and it stays possible
   * afterwards for a repo that was moved or deleted. Configurable — the id is
   * in hand — but its path must not be guessed.
   *
   * Named for the config source it originally came from; a binding-only id
   * lands here too because nothing a caller does differs between the two. What
   * callers need is "not registered" and "we do not know where it is", and
   * those are the same either way.
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
  /**
   * project_ids with a resolved-bindings snapshot under `~/.fabric/state/`.
   *
   * Required rather than optional for the same reason `currentProjectPath` is:
   * an optional source is how four call sites came to build four different
   * answers to one question. It is now unrepresentable to forget it.
   */
  boundIds: readonly string[];
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
  const { registry, configuredIds, boundIds, currentProjectId, currentProjectPath } = input;
  const configured = new Set([...configuredIds, ...boundIds]);
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

/**
 * Gather all three sources and merge them. THE entry point — nothing else
 * should assemble `mergeProjectList`'s input.
 *
 * It was assembled inline in four places (the scope switcher, the machine
 * status page, the config page's read side, and its write side) with the same
 * three lines copied each time. That is fine right up until a source is added:
 * this function exists because adding the bindings source meant editing four
 * call sites that each had to stay identical, and the config read/write pair
 * MUST stay identical or the page renders rows it then refuses to save — a
 * failure this codebase has already had once.
 */
export async function collectKnownProjects(launchDir: string): Promise<MergedProject[]> {
  const global = asPlainObject(loadGlobalConfig(resolveGlobalRoot()));
  return mergeProjectList({
    registry: await listRegisteredProjects(),
    configuredIds: Object.keys(asPlainObject(global.projects)),
    boundIds: listBoundProjectIds(),
    currentProjectId: currentProjectIdOf(launchDir),
    currentProjectPath: launchDir,
  });
}
