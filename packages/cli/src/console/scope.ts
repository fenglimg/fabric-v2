// ---------------------------------------------------------------------------
// The console's SCOPE — which machine/project a request is about.
//
// The console used to be about exactly one project: whichever directory it was
// launched in. That is a property of how the process was started, which meant
// two consoles open on one machine showed different worlds and neither could
// answer "what does my OTHER project see". Scope moves that decision out of the
// process and into the request: `?scope=machine|<projectId>`.
//
// Two rules keep it honest:
//
//   1. RESOLUTION NEVER FALLS BACK. A scope that cannot be opened returns an
//      explicit failure. Quietly degrading to the launch directory would show
//      project B's data under project A's name — the worst possible outcome for
//      a page whose entire job is telling you which project you are looking at.
//   2. THE REQUEST NEVER CARRIES A PATH. Paths are derived server-side from the
//      registry (or from the launch directory), exactly as the config write
//      channel does it.
// ---------------------------------------------------------------------------

import { currentProjectIdOf } from "./config-resolve.js";
import { collectKnownProjects, type MergedProject } from "./project-list.js";

/** The machine-wide scope's reserved id. No project_id can collide: ids are uuids. */
export const MACHINE_SCOPE = "machine";

/** Why a listed project cannot be opened as a workspace scope. */
export type ScopeBlockedReason =
  /** Registered at a path that no longer exists. */
  | "stale"
  /**
   * Known only by id — from a config segment, a store binding, or a registry row
   * with no id. No FILE maps a project_id back to a directory (KT-PIT-0050), but
   * that does not make the mapping unknowable: the id is sitting in the project's
   * own `.fabric/fabric-config.json`. `POST /api/scan` computes it. So this state
   * is "not looked up yet", not "permanently unknowable", and the page must offer
   * the scan rather than only telling the user to re-install.
   *
   * It stays permanent for one case the scan cannot fix: a directory that was
   * deleted or moved off the searched roots.
   */
  | "no-path"
  /**
   * The directory is known, but the project has no `project_id` — an install
   * that never bound a store leaves `.fabric/fabric-config.json` as `{}`.
   *
   * Separate from `no-path` because it used to be reported AS `no-path`, and
   * that was a lie the user could see: the switcher offered "run `fabric
   * install` there" for a project whose directory it was already displaying.
   * Re-installing would not help either — an id comes from binding a store —
   * so the wrong reason produced the wrong instruction.
   */
  | "no-id";

export interface ScopeOption {
  /** `"machine"` or the project's id. */
  id: string;
  kind: "machine" | "project";
  name: string;
  path: string | null;
  /** True when this is the directory the console was launched in. */
  isCurrent: boolean;
  openable: boolean;
  blockedReason: ScopeBlockedReason | null;
}

export interface ScopeList {
  /** The scope used when a request names none. */
  defaultScope: string;
  options: ScopeOption[];
  /**
   * How many known projects could not be listed as openable, BY REASON — so the
   * page can say why the switcher is shorter than the user's project count
   * instead of letting them conclude those projects do not exist.
   *
   * Broken down rather than totalled because each reason has a different
   * remedy, and the single total was being rendered with one instruction that
   * was wrong for two of the three cases. Absent keys mean zero; the total is
   * the caller's to sum, so there is no second field to drift out of step.
   */
  blockedByReason: Partial<Record<ScopeBlockedReason, number>>;
}

export type ResolvedScope =
  | { readonly kind: "machine" }
  | {
      readonly kind: "project";
      /** null when the launch directory has no `project_id` yet. */
      readonly projectId: string | null;
      readonly projectRoot: string;
    };

export type ScopeResolution =
  | { ok: true; scope: ResolvedScope }
  | { ok: false; status: number; error: string; reason: ScopeBlockedReason | "unknown" };

function toOption(project: MergedProject): ScopeOption {
  // Ordered most-specific first, and evaluated ONCE. The previous version
  // computed a reason here and then overrode it below for the id-less case,
  // which is how a project with a perfectly good directory came to be reported
  // as having no directory.
  //
  // A project with no id cannot be a scope even though it has a path: `?scope=`
  // names a project BY id, and the pages keyed to it (config overrides) have
  // nowhere to write.
  const blockedReason: ScopeBlockedReason | null =
    project.path === null
      ? "no-path"
      : project.stale
        ? "stale"
        : project.projectId === null
          ? "no-id"
          : null;
  return {
    id: project.projectId ?? project.path ?? project.name,
    kind: "project",
    name: project.name,
    path: project.path,
    isCurrent: project.isCurrent,
    openable: blockedReason === null,
    blockedReason,
  };
}

/** Everything the switcher needs to render, including what it cannot offer. */
export async function listScopes(launchDir: string): Promise<ScopeList> {
  const options = (await collectKnownProjects(launchDir)).map(toOption);
  const currentId = currentProjectIdOf(launchDir);
  return {
    // The launch directory stays the default so an unparameterised request keeps
    // meaning what it meant before scopes existed.
    defaultScope: currentId ?? MACHINE_SCOPE,
    options: [
      { id: MACHINE_SCOPE, kind: "machine", name: MACHINE_SCOPE, path: null, isCurrent: false, openable: true, blockedReason: null },
      ...options,
    ],
    blockedByReason: options.reduce<Partial<Record<ScopeBlockedReason, number>>>((acc, o) => {
      if (o.blockedReason === null) return acc;
      acc[o.blockedReason] = (acc[o.blockedReason] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

/**
 * Turn a `?scope=` value into the concrete target a collector needs.
 *
 * An absent value resolves to the launch directory — that is what every request
 * meant before this parameter existed, and preserving it keeps the console
 * usable in a repo that was never registered (the common case on a machine
 * installed before the registry).
 */
export async function resolveScope(
  raw: string | null | undefined,
  launchDir: string,
): Promise<ScopeResolution> {
  if (raw === null || raw === undefined || raw.length === 0) {
    return {
      ok: true,
      scope: { kind: "project", projectId: currentProjectIdOf(launchDir), projectRoot: launchDir },
    };
  }
  if (raw === MACHINE_SCOPE) return { ok: true, scope: { kind: "machine" } };

  // The launch directory answers for itself BEFORE the registry is consulted.
  // Its project is very often absent from the registry (installs predate it),
  // and refusing to open the one project the user is provably sitting in would
  // be the same read/write membership asymmetry that made the config page render
  // rows it could not save.
  if (raw === currentProjectIdOf(launchDir)) {
    return { ok: true, scope: { kind: "project", projectId: raw, projectRoot: launchDir } };
  }

  const match = (await collectKnownProjects(launchDir)).find((p) => p.projectId === raw);
  if (match === undefined) {
    return { ok: false, status: 404, reason: "unknown", error: `unknown scope: ${raw}` };
  }
  if (match.path === null) {
    return {
      ok: false,
      status: 409,
      reason: "no-path",
      error: `project ${raw} has settings on this machine but no registered directory`,
    };
  }
  if (match.stale) {
    return {
      ok: false,
      status: 409,
      reason: "stale",
      error: `project ${raw} was registered at ${match.path}, which no longer exists`,
    };
  }
  return { ok: true, scope: { kind: "project", projectId: raw, projectRoot: match.path } };
}
