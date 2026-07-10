import { detectUnboundProject } from "./doctor-unbound-project.js";
import type { GateWarning } from "./first-reconcile-gate.js";

/**
 * Write-path advisory for the project-scope drift the doctor check
 * (`detectUnboundProject`) already models, surfaced at the moment knowledge is
 * WRITTEN rather than discovered later on a `fabric doctor` run.
 *
 * When a repo has a write store bound (`active_write_store`) but no project
 * coordinate (`project_id` / `active_project`), `resolveStoreCanonicalBase`
 * cannot inject the `projects/<id>/` segment on promote — so team-layer entries
 * land FLAT under `knowledge/<type>/` and get `semantic_scope: team` instead of
 * the project-partitioned `knowledge/projects/<id>/<type>/`. That drift is
 * invisible at write time today: the propose/approve succeeds, the misplacement
 * is only noticed when someone audits the store layout.
 *
 * This helper folds the SAME `detectUnboundProject` precondition into a soft
 * `GateWarning` the four write-path tools already carry, so `fab_propose` /
 * `fab_review` fail-loud the drift the instant it would occur. It is advisory,
 * never blocking (KT-DEC-0007): a genuinely cross-project team-knowledge repo
 * may legitimately have no project coordinate, so the operator decides whether
 * to seal via `fabric doctor --fix` or ignore.
 *
 * Never throws — mirrors `detectUnboundProject`, which degrades to `null` on an
 * absent/unreadable project config, keeping the hot write path safe.
 */
export function unsealedProjectScopeWarning(projectRoot: string): GateWarning | null {
  const violation = detectUnboundProject(projectRoot);
  if (violation === null) {
    return null;
  }
  return {
    code: "project_scope_unsealed",
    file: "<response>",
    action_hint:
      `Write store '${violation.alias}' is bound but this repo is missing ${violation.missing.join(", ")} — ` +
      "team-layer entries will land flat under knowledge/<type>/ (semantic_scope: team) instead of the " +
      "project-partitioned knowledge/projects/<id>/<type>/. Run `fabric doctor --fix` to seal the project " +
      "coordinate, or ignore if this is genuinely cross-project team knowledge.",
  };
}
