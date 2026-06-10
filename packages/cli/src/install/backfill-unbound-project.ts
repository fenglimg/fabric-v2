import { detectUnboundProject } from "@fenglimg/fabric-server";

import { resolveGlobalRoot } from "../store/global-config-io.js";
import { ensureStoreProjectBinding } from "./store-project-onboarding.js";

export interface BackfillUnboundProjectResult {
  alias: string;
  project_id: string;
  active_project: string;
}

/**
 * CLI-side backfill for `fabric doctor --fix`. Seals the project coordinate for
 * repos bound BEFORE the store.stage.ts fix (a store bound as the write target
 * but with no `project_id` / `active_project`).
 *
 * The detection lives in the server package (read-only project config), but the
 * write reuses the SAME `ensureStoreProjectBinding` the install onboarding path
 * runs — so install and doctor mint the project coordinate identically (no
 * divergent second implementation, which is exactly the sibling-inconsistency
 * class of bug that left this hole in the first place).
 *
 * Idempotent: returns null when there is nothing to backfill, so a second
 * `--fix` run is a clean no-op.
 */
export async function backfillUnboundProject(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): Promise<BackfillUnboundProjectResult | null> {
  const violation = detectUnboundProject(projectRoot);
  if (violation === null) {
    return null;
  }
  const result = await ensureStoreProjectBinding(projectRoot, violation.alias, { globalRoot });
  return {
    alias: violation.alias,
    project_id: result.project_id,
    active_project: result.active_project,
  };
}
