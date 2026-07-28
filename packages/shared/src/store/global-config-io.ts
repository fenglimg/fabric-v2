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
// ISS-20260711-256: production saves use withFileLock + atomicWriteJson so a
// concurrent write cannot interleave a partially-written file.
//
// ⚠️ `saveGlobalConfigAsync` locks the WRITE ONLY. A caller that does
// `loadGlobalConfig()` → spread-modify → `saveGlobalConfigAsync()` performs its
// READ OUTSIDE the lock, so two concurrent processes both read the same
// baseline, each mutate a different field, and the later write silently
// discards the earlier one. The lock guarantees write atomicity, NOT
// read-modify-write serialisability.
//
// config-single-home W1: use {@link mutateGlobalConfig} for every RMW mutation —
// it performs load → mutate → save INSIDE one lock. Keep any user interaction
// OUTSIDE the mutator (the lock has a 10s staleMs; an interactive prompt held
// inside would let another process reclaim the lock mid-edit).
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
 * Locked read-modify-write — the ONLY safe way to mutate an existing global
 * config from a production path (config-single-home W1).
 *
 * `load → mutate → save` all happen INSIDE one lock, so two concurrent
 * processes serialise instead of both reading the same baseline and the later
 * write discarding the earlier one. The mutator receives the CURRENT on-disk
 * config (`null` when the file does not exist yet) and returns the next one.
 *
 * The mutator MUST be pure and fast: no user prompts, no network, no spawning.
 * `withFileLock` reclaims a lock held longer than `staleMs` (10s), so an
 * interactive prompt inside the mutator would let another process enter the
 * critical section mid-edit. Resolve interactive input BEFORE calling, then
 * apply the resolved value inside the mutator:
 *
 * ```ts
 * const picked = await askUserForLanguage();          // interaction: outside
 * await mutateGlobalConfig((cur) => ({ ...(cur ?? EMPTY), language: picked }));
 * ```
 *
 * Return `null` from the mutator to SKIP the write (value already correct, or a
 * precondition re-checked inside the lock no longer holds) — the file is left
 * untouched and the current config is returned. Re-checking preconditions inside
 * the mutator rather than before the call is the whole point: a check performed
 * outside the lock can go stale before the write lands.
 *
 * Returns the persisted (schema-validated) config, or the untouched current one
 * when the mutator skipped. Throws — releasing the lock — when the on-disk config
 * fails to parse, so a corrupt file is never silently overwritten (KT-DEC-0048
 * write-strict; the lenient `.passthrough()` root keeps forward-compat keys
 * intact through the round-trip).
 */
export async function mutateGlobalConfig(
  mutate: (current: GlobalConfig | null) => GlobalConfig | null,
  globalRoot: string = resolveGlobalRoot(),
): Promise<GlobalConfig | null> {
  await mkdir(globalRoot, { recursive: true });
  const path = globalConfigPath(globalRoot);
  return withFileLock(globalConfigLockPath(globalRoot), async () => {
    const current = loadGlobalConfig(globalRoot);
    const next = mutate(current);
    if (next === null) {
      return current;
    }
    const validated = globalConfigSchema.parse(next);
    await atomicWriteJson(path, validated, { indent: 2 });
    return validated;
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
