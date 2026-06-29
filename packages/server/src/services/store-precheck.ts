// ---------------------------------------------------------------------------
// BORROW-019: store reachability precheck with 60s cache.
//
// A lightweight pre-flight check that verifies each store in the project's
// read-set is reachable (on-disk directory exists + a `store.json` or `.git`
// marker present). Results are cached for 60 seconds so repeated checks
// (doctor, plan-context, recall) don't hammer the filesystem.
//
// This is a guard / "fail-fast" advisory — rather than discovering a store is
// missing mid-recall (which silently degrades to no candidates), operators see
// the unreachable state early via `fabric doctor`. Never throws: a missing /
// corrupt store degrades to {reachable:false} with a human reason string. The
// diagnostic wiring into the doctor surface lives in the CLI registry
// (packages/cli/src/store/knowledge-doctor-checks.ts); this module stays pure
// inspection so the reachability rule is unit-testable without the doctor shape.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildStoreResolveInput,
  createStoreResolver,
  resolveGlobalRoot,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoreReachability {
  uuid: string;
  alias: string;
  reachable: boolean;
  reason?: string;
}

export interface PrecheckResult {
  stores: StoreReachability[];
  allReachable: boolean;
}

// ---------------------------------------------------------------------------
// Cache (60s TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: PrecheckResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function clearPrecheckCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Pure reachability rule (unit-testable with temp dirs, no read-set resolve)
// ---------------------------------------------------------------------------

/**
 * Evaluate a single store directory's reachability. A store is reachable when
 * BOTH hold:
 *   1. The store directory exists on disk.
 *   2. The directory contains either a `store.json` (valid JSON, local-only
 *      store) OR a `.git/` subdirectory (git-cloned store).
 *
 * Pure (filesystem-only, no config resolution) so the rule is testable with a
 * temp directory regardless of the machine's ~/.fabric layout.
 */
export function evaluateStoreDir(
  storeDir: string,
  identity: { uuid: string; alias: string },
): StoreReachability {
  if (!existsSync(storeDir)) {
    return {
      uuid: identity.uuid,
      alias: identity.alias,
      reachable: false,
      reason: `directory not found at ${storeDir}`,
    };
  }

  const storeJsonPath = join(storeDir, "store.json");
  const gitDirPath = join(storeDir, ".git");
  const hasStoreJson = existsSync(storeJsonPath) && isValidStoreJson(storeJsonPath);
  const hasGitDir = existsSync(gitDirPath);

  if (!hasStoreJson && !hasGitDir) {
    return {
      uuid: identity.uuid,
      alias: identity.alias,
      reachable: false,
      reason: `no store.json or .git found in ${storeDir}`,
    };
  }

  return { uuid: identity.uuid, alias: identity.alias, reachable: true };
}

/**
 * Quick parse of store.json — confirms it can be read as valid JSON (does not
 * validate the schema, just a surface-level parse).
 */
function isValidStoreJson(path: string): boolean {
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Precheck (read-set resolve + per-dir evaluation + cache)
// ---------------------------------------------------------------------------

/**
 * Check that every store in the project's read-set is reachable on disk.
 * Results are cached for 60s (CACHE_TTL_MS). Call `clearPrecheckCache()` when a
 * store mount / unmount operation invalidates the cache.
 *
 * `globalRoot` is injectable for hermetic tests; production callers use the
 * resolved ~/.fabric root.
 */
export async function precheckStoreReachability(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
  now: number = Date.now(),
): Promise<PrecheckResult> {
  const cached = cache.get(projectRoot);
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.result;
  }

  const input = buildStoreResolveInput(projectRoot, globalRoot);
  if (input === null) {
    const result: PrecheckResult = { stores: [], allReachable: true };
    cache.set(projectRoot, { result, expiresAt: now + CACHE_TTL_MS });
    return result;
  }

  const readSet = createStoreResolver().resolveReadSet(input);

  const stores: StoreReachability[] = readSet.stores.map((entry) => {
    const mounted = input.mountedStores.find((s) => s.store_uuid === entry.store_uuid);
    const storeDir = join(
      globalRoot,
      storeRelativePathForMount(mounted ?? { store_uuid: entry.store_uuid }),
    );
    return evaluateStoreDir(storeDir, { uuid: entry.store_uuid, alias: entry.alias });
  });

  const result: PrecheckResult = {
    stores,
    allReachable: stores.every((s) => s.reachable),
  };
  cache.set(projectRoot, { result, expiresAt: now + CACHE_TTL_MS });
  return result;
}
