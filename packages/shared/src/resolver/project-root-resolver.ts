import type {
  ProjectRootResolution,
  ProjectRootResolver,
  ProjectRootSignals,
} from "./contracts.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0.6 — ProjectRootResolver implementation.
//
// Pure precedence over the collected signals (no fs/env access here — signal
// COLLECTION lives in the caller). Highest first:
//   env       — FABRIC_PROJECT_ROOT explicit override
//   markerDir — nearest dir at-or-above cwd with `.fabric/fabric-config.json`;
//               labeled "cwd" when markerDir === cwd, else "marker"
//   repoRoot  — git repo root fallback (no .fabric marker found)
//   (none)    — bare cwd with no marker and no repo → null (not a project)
// projectId is echoed from `discoveredProjectId` (collection reads it from the
// resolved root's config; null when none exists yet). One repo = one .fabric =
// one project_id (S32); worktrees share the committed id (S45). See ADJ-P0-1.
// ---------------------------------------------------------------------------

// Retained for backward compat with any P0.5 red-suite import sites; no longer
// thrown by this resolver but still used by the not-yet-implemented stubs
// (store-disk-reader). Kept here as the canonical definition.
export class ResolverNotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (TDD target)`);
    this.name = "ResolverNotImplementedError";
  }
}

export function createProjectRootResolver(): ProjectRootResolver {
  return {
    resolve(signals: ProjectRootSignals): ProjectRootResolution | null {
      const projectId = signals.discoveredProjectId ?? null;

      if (signals.env !== undefined) {
        return { projectRoot: signals.env, projectId, signalUsed: "env" };
      }
      if (signals.markerDir !== undefined) {
        return {
          projectRoot: signals.markerDir,
          projectId,
          signalUsed: signals.markerDir === signals.cwd ? "cwd" : "marker",
        };
      }
      if (signals.repoRoot !== undefined) {
        return { projectRoot: signals.repoRoot, projectId, signalUsed: "repo" };
      }
      return null;
    },
  };
}
