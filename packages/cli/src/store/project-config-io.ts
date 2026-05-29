import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fabricConfigSchema, type FabricConfig } from "@fenglimg/fabric-shared";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Project config (<projectRoot>/.fabric/fabric-config.json)
// load/save. This file carries project_id (S13) + required_stores (S59) +
// active_write_store (S60) and is the upward marker the ProjectRootResolver
// keys off. Writes validate through the schema so a bad mutation never lands.
// ---------------------------------------------------------------------------

export function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, ".fabric", "fabric-config.json");
}

export function loadProjectConfig(projectRoot: string): FabricConfig | null {
  const path = projectConfigPath(projectRoot);
  if (!existsSync(path)) {
    return null;
  }
  return fabricConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function saveProjectConfig(config: FabricConfig, projectRoot: string): void {
  const validated = fabricConfigSchema.parse(config);
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  writeFileSync(projectConfigPath(projectRoot), `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
