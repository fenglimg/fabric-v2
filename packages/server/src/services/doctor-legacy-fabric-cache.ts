import type { Translator } from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor-types.js";
import {
  detectLegacyFabricCacheDirs,
  migrateLegacyFabricCache,
} from "./fabric-cache-migration.js";

// ---------------------------------------------------------------------------
// legacy_fabric_cache_dir_detected — legacy `.fabric/cache/{bm25,vectors}`
// still on disk after the unify-fabric-cache-dir change moved recall caches
// into `.fabric/.cache/` (co-located with hook sidecars so one `.gitignore`
// rule covers both). Data is intact and useful; the fix is a rename, not a
// delete. Warning severity — the old path is a perf-tier accelerator, never
// load-bearing (a miss just rebuilds).
//
// Lazy migration in plan-context / vector-retrieval usually handles this
// invisibly on the first cold read. This lint exists for the case where a
// project hasn't triggered either code path yet (e.g. only ran doctor after
// an upgrade, no recall calls yet) — one `fabric doctor --fix` sweeps them.
// ---------------------------------------------------------------------------

export function createLegacyFabricCacheDirCheck(
  t: Translator,
  legacyDirs: string[],
): DoctorCheck {
  if (legacyDirs.length === 0) {
    return {
      name: t("doctor.check.legacy_fabric_cache_dir_detected.name"),
      status: "ok",
      message: t("doctor.check.legacy_fabric_cache_dir_detected.ok"),
    };
  }
  return {
    name: t("doctor.check.legacy_fabric_cache_dir_detected.name"),
    status: "warn",
    kind: "warning",
    code: "legacy_fabric_cache_dir_detected",
    fixable: true,
    message: t("doctor.check.legacy_fabric_cache_dir_detected.message", {
      count: String(legacyDirs.length),
      dirs: legacyDirs.join(", "),
    }),
    actionHint: t("doctor.check.legacy_fabric_cache_dir_detected.remediation"),
  };
}

export type LegacyFabricCacheFixResult = {
  before: string[];
  after: string[];
  ok: boolean;
};

// --fix arm: run the same idempotent migration used at the mkdir sites so a
// project that has never triggered recall since the upgrade still converges.
export function fixLegacyFabricCacheDirs(projectRoot: string): LegacyFabricCacheFixResult {
  const before = detectLegacyFabricCacheDirs(projectRoot);
  if (before.length === 0) return { before, after: [], ok: true };
  migrateLegacyFabricCache(projectRoot);
  const after = detectLegacyFabricCacheDirs(projectRoot);
  return { before, after, ok: after.length === 0 };
}
