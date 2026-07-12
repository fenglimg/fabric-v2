import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { atomicWriteJson, withFileLock } from "../node/atomic-write.js";
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
//
// ISS-20260711-256: production saves use withFileLock + atomicWriteJson so
// concurrent mount/unmount/switch-write RMW cannot clobber each other.
// ---------------------------------------------------------------------------

function isTestRuntime(): boolean {
  return process.env.VITEST !== undefined || process.env.VITEST_WORKER_ID !== undefined;
}

export function resolveGlobalRoot(): string {
  const fabricHome = process.env.FABRIC_HOME;
  if (fabricHome !== undefined && fabricHome !== "") {
    return join(fabricHome, ".fabric");
  }
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

function globalConfigLockPath(globalRoot: string): string {
  return `${globalConfigPath(globalRoot)}.lock`;
}

export function loadGlobalConfig(globalRoot: string = resolveGlobalRoot()): GlobalConfig | null {
  const path = globalConfigPath(globalRoot);
  if (!existsSync(path)) {
    return null;
  }
  return globalConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Locked + atomic save — use from production CLI/server mutation paths. */
export async function saveGlobalConfigAsync(
  config: GlobalConfig,
  globalRoot: string = resolveGlobalRoot(),
): Promise<void> {
  const validated = globalConfigSchema.parse(config);
  await mkdir(globalRoot, { recursive: true });
  const path = globalConfigPath(globalRoot);
  await withFileLock(globalConfigLockPath(globalRoot), async () => {
    await atomicWriteJson(path, validated, { indent: 2 });
  });
}

/**
 * Sync save for tests/fixtures. Atomic (tmp+rename) but no wait-lock.
 * Production writers should use {@link saveGlobalConfigAsync}.
 */
export function saveGlobalConfig(config: GlobalConfig, globalRoot: string = resolveGlobalRoot()): void {
  const validated = globalConfigSchema.parse(config);
  mkdirSync(globalRoot, { recursive: true });
  const path = globalConfigPath(globalRoot);
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}
