import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema, type GlobalConfig } from "@fenglimg/fabric-shared";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Global config (~/.fabric/fabric-global.json) load/save.
//
// The machine-wide config holding `uid` + the mounted-store registry (S33).
// FABRIC_HOME overrides $HOME so tests (and the isolated test wall) never touch
// the developer's real global config. Writes go through the schema so an
// invalid mutation can never be persisted.
// ---------------------------------------------------------------------------

export function resolveGlobalRoot(): string {
  return join(process.env.FABRIC_HOME ?? homedir(), ".fabric");
}

export function globalConfigPath(globalRoot: string = resolveGlobalRoot()): string {
  return join(globalRoot, "fabric-global.json");
}

// Returns the parsed global config, or null when it does not exist yet (before
// `fabric install --global`).
export function loadGlobalConfig(globalRoot: string = resolveGlobalRoot()): GlobalConfig | null {
  const path = globalConfigPath(globalRoot);
  if (!existsSync(path)) {
    return null;
  }
  return globalConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function saveGlobalConfig(config: GlobalConfig, globalRoot: string = resolveGlobalRoot()): void {
  // Validate before persisting — never write an invalid global config.
  const validated = globalConfigSchema.parse(config);
  mkdirSync(globalRoot, { recursive: true });
  writeFileSync(globalConfigPath(globalRoot), `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
