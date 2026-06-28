// ---------------------------------------------------------------------------
// BORROW-019: store reachability precheck with 60s cache.
//
// A lightweight pre-flight check that verifies each store in the project's
// read-set is reachable (on-disk directory exists + `.git` or store.json
// marker present). Results are cached for 60 seconds so repeated checks
// (doctor, plan-context, recall) don't hammer the filesystem.
//
// This is a "fail-fast" gate — rather than discovering a store is missing
// mid-recall (which silently degrades to no candidates), operators see the
// unreachable state early. Never throws: missing stores degrade to
// {reachable: false} with a reason string.
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
// Precheck
// ---------------------------------------------------------------------------

/**
 * Check that every store in the project's read-set is reachable on disk.
 *
 * A store is reachable when BOTH of these hold:
 *   1. The store directory exists (under ~/.fabric/stores/<uuid>/)
 *   2. The directory contains either a `.git/` subdirectory (git-cloned store)
 *      or a `store.json` file (local-only store).
 *
 * Results are cached for 60s (CACHE_TTL_MS). Call `clearPrecheckCache()`
 * when a store mount / unmount operation invalidates the cache.
 */
export async function precheckStoreReachability(
  projectRoot: string,
): Promise<PrecheckResult> {
  // Cache hit?
  const now = Date.now();
  const cached = cache.get(projectRoot);
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.result;
  }

  // Resolve read-set stores.
  const input = buildStoreResolveInput(projectRoot);
  if (input === null) {
    const result: PrecheckResult = { stores: [], allReachable: true };
    cache.set(projectRoot, { result, expiresAt: now + CACHE_TTL_MS });
    return result;
  }

  const readSet = createStoreResolver().resolveReadSet(input);
  const globalRoot = resolveGlobalRoot();

  const stores: StoreReachability[] = readSet.stores.map((entry) => {
    const mounted = input.mountedStores.find((s) => s.store_uuid === entry.store_uuid);
    const storeDir = join(
      globalRoot,
      storeRelativePathForMount(mounted ?? { store_uuid: entry.store_uuid }),
    );

    // Check 1: directory exists.
    if (!existsSync(storeDir)) {
      return {
        uuid: entry.store_uuid,
        alias: entry.alias,
        reachable: false,
        reason: `directory not found at ${storeDir}`,
      };
    }

    // Check 2: marker file (store.json or .git).
    const storeJsonPath = join(storeDir, "store.json");
    const gitDirPath = join(storeDir, ".git");
    const hasStoreJson =
      existsSync(storeJsonPath) && isValidStoreJson(storeJsonPath);
    const hasGitDir = existsSync(gitDirPath);

    if (!hasStoreJson && !hasGitDir) {
      return {
        uuid: entry.store_uuid,
        alias: entry.alias,
        reachable: false,
        reason: `no store.json or .git found in ${storeDir}`,
      };
    }

    return {
      uuid: entry.store_uuid,
      alias: entry.alias,
      reachable: true,
    };
  });

  const allReachable = stores.every((s) => s.reachable);
  const result: PrecheckResult = { stores, allReachable };

  // Cache the result.
  cache.set(projectRoot, { result, expiresAt: now + CACHE_TTL_MS });

  return result;
}

/**
 * Quick parse of store.json — confirms it can be read as valid JSON
 * (doesn't validate the schema, just surface-level parse).
 */
function isValidStoreJson(path: string): boolean {
  try {
    const raw = readFileSync(path, "utf8");
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}