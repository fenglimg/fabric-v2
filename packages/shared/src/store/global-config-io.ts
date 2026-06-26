import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema, type GlobalConfig } from "../schemas/store.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Global config (~/.fabric/fabric-global.json) load/save.
//
// The machine-wide config holding `uid` + the mounted-store registry (S33).
// FABRIC_HOME overrides $HOME so tests (and the isolated test wall) never touch
// the developer's real global config. Writes go through the schema so an
// invalid mutation can never be persisted.
//
// v2.1 global-refactor (W1-T1): relocated CLI → shared so the MCP server can
// resolve the mounted-store read-set on the recall path without depending on
// the CLI package (wrong dependency direction). The CLI's
// `store/global-config-io.ts` now re-exports these symbols for backward compat.
// ---------------------------------------------------------------------------

// Vitest sets VITEST in the main process and VITEST_WORKER_ID in each test
// worker (the pool the suite actually runs in). Either present ⇒ test runtime.
function isTestRuntime(): boolean {
  return process.env.VITEST !== undefined || process.env.VITEST_WORKER_ID !== undefined;
}

export function resolveGlobalRoot(): string {
  const fabricHome = process.env.FABRIC_HOME;
  if (fabricHome !== undefined && fabricHome !== "") {
    return join(fabricHome, ".fabric");
  }
  // Fail-closed under the test runner. A unit test that forgot to repoint
  // FABRIC_HOME to an isolated temp home would otherwise SILENTLY resolve to the
  // developer's REAL ~/.fabric and read/write the live store registry. That is
  // not hypothetical: a test fixture's `uid:"test-uid"` + seeded KT-DEC-* entries
  // once leaked into a real ~/.fabric, deregistering the user's real stores so
  // `fabric install` stopped offering them. Throwing converts that silent
  // corruption into a loud, local failure the leaking test owns.
  if (isTestRuntime()) {
    throw new Error(
      "resolveGlobalRoot(): FABRIC_HOME must be set under the test runner — refusing to " +
        "fall back to the real home dir (~/.fabric). Repoint process.env.FABRIC_HOME to an " +
        "isolated temp dir in beforeEach (see plan-context.test.ts for the pattern).",
    );
  }
  return join(homedir(), ".fabric");
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
