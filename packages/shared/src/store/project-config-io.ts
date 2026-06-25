import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fabricConfigLoadSchema, fabricConfigSchema } from "../schemas/fabric-config.js";
import type { FabricConfig } from "../types/config.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Project config (<projectRoot>/.fabric/fabric-config.json)
// load/save. This file carries project_id (S13) + required_stores (S59) +
// active_write_store (S60) and is the upward marker the ProjectRootResolver
// keys off. Writes validate through the schema so a bad mutation never lands.
//
// v2.1 global-refactor (W1-T2): relocated CLI → shared so the MCP server can
// resolve the project's write-target (active_write_store) + read-set
// (required_stores) on the recall/extract paths without depending on the CLI
// package. The CLI's `store/project-config-io.ts` re-exports these for compat.
// ---------------------------------------------------------------------------

export function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, ".fabric", "fabric-config.json");
}

export function loadProjectConfig(projectRoot: string): FabricConfig | null {
  const path = projectConfigPath(projectRoot);
  if (!existsSync(path)) {
    return null;
  }
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = fabricConfigSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  // W2 dual-slot (TASK-002 / R6): the ONLY tolerated parse failure on the read
  // path is the max-1-team `required_stores` refinement — a pre-dual-slot config
  // that still carries >1 non-personal store. Hard-rejecting it here would break
  // every existing consumer (server write-routes, doctor, recall) the moment a
  // legacy config is read, violating backward-compat. Instead the LOAD path stays
  // tolerant (parse field shapes, skip the max-1 contract) and the INSTALL flow
  // migrates the file forward on next run; `saveProjectConfig` still enforces the
  // contract so no NEW >1-team config is ever written. Any OTHER schema error
  // (genuine corruption) still throws via the strict parse below.
  return fabricConfigLoadSchema.parse(raw);
}

export function saveProjectConfig(config: FabricConfig, projectRoot: string): void {
  const validated = fabricConfigSchema.parse(config);
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  writeFileSync(projectConfigPath(projectRoot), `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
