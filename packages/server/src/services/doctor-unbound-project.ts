import { loadProjectConfig, type Translator } from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor-types.js";

// ---------------------------------------------------------------------------
// unbound_project — project-scope binding backfill lint.
//
// A pre-D6 (or otherwise half-wired) install can leave a project with an
// `active_write_store` bound but NO `project_id` / `active_project`. That state
// silently parks the project-scope axis: recall / write fall back to team-scope
// because there is no project coordinate to route on. The fresh-install hole
// that produced it is sealed in store.stage.ts (all three bind paths now run
// ensureStoreProjectBinding); this lint covers the EXISTING repos minted before
// that fix.
//
// Detection is read-only (project config only). The backfill itself lives on the
// CLI side (`fabric doctor --fix` → ensureStoreProjectBinding) because minting
// the project + registering it in the store reuses the install-onboarding
// primitives, which the server package does not depend on.
// ---------------------------------------------------------------------------

export interface UnboundProjectViolation {
  /** The store already bound as the active write target. */
  alias: string;
  /** Which project-scope fields are absent: `project_id` and/or `active_project`. */
  missing: string[];
}

// Detect "store bound but project scope never minted". Returns null when there
// is no active write store (nothing to bind a project to yet) or the project
// coordinate is already complete. Never throws — a missing/unreadable config
// degrades to "no violation".
export function detectUnboundProject(projectRoot: string): UnboundProjectViolation | null {
  const config = loadProjectConfig(projectRoot);
  const alias = config?.active_write_store;
  if (typeof alias !== "string" || alias.length === 0) {
    return null;
  }
  const missing: string[] = [];
  if (typeof config?.project_id !== "string" || config.project_id.length === 0) {
    missing.push("project_id");
  }
  if (typeof config?.active_project !== "string" || config.active_project.length === 0) {
    missing.push("active_project");
  }
  return missing.length > 0 ? { alias, missing } : null;
}

// Roll the detection into a doctor warning. Advisory (never an error / never
// blocks health): on a single-project repo the project axis is near no-op, and
// `fabric doctor --fix` backfills it idempotently.
export function createUnboundProjectCheck(
  t: Translator,
  violation: UnboundProjectViolation | null,
): DoctorCheck {
  if (violation === null) {
    return {
      name: t("doctor.check.unbound_project.name"),
      status: "ok",
      message: t("doctor.check.unbound_project.ok"),
    };
  }
  return {
    name: t("doctor.check.unbound_project.name"),
    status: "warn",
    kind: "warning",
    code: "unbound_project",
    fixable: false,
    message: t("doctor.check.unbound_project.message", {
      alias: violation.alias,
      missing: violation.missing.join(" + "),
    }),
    actionHint: t("doctor.check.unbound_project.remediation"),
  };
}
