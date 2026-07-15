import { existsSync, mkdirSync, readdirSync, rmdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

// Legacy dot-less recall-cache locations (< unify-fabric-cache-dir). The new
// location co-locates with the hook sidecar cache under `.fabric/.cache/` so
// the single `.cache/` line in `.fabric/.gitignore` covers both subsystems —
// previously `.fabric/cache/{bm25,vectors}` sat outside that rule and only
// escaped commit-leaks via each project's top-level `.gitignore`.
//
// Migration is idempotent: called before the first mkdir of the new location.
// - old dir missing → no-op (already migrated or fresh project)
// - new dir already present → no-op (never clobber; the pre-existing new dir
//   was populated by a newer code path first, keep it authoritative)
// - both present-old / absent-new → renameSync the whole subtree, preserving
//   every cached snapshot (no re-embed cost, no BM25 rebuild)
//
// After all subdir renames, best-effort rmdir of an empty legacy
// `<projectRoot>/.fabric/cache/` parent so `fabric doctor` doesn't keep
// flagging a stale empty directory.
const LEGACY_MIGRATIONS: ReadonlyArray<readonly [string, string]> = [
  [".fabric/cache/bm25", ".fabric/.cache/bm25"],
  [".fabric/cache/vectors", ".fabric/.cache/vectors"],
];

export function migrateLegacyFabricCache(projectRoot: string): void {
  if (projectRoot.length === 0) return;
  for (const [oldRel, newRel] of LEGACY_MIGRATIONS) {
    const oldAbs = join(projectRoot, oldRel);
    if (!existsSync(oldAbs)) continue;
    const newAbs = join(projectRoot, newRel);
    if (existsSync(newAbs)) continue;
    try {
      mkdirSync(dirname(newAbs), { recursive: true });
      renameSync(oldAbs, newAbs);
    } catch {
      // Best-effort: a cross-device / permission-denied failure must not block
      // the caller — the new mkdir will still create a fresh dir and re-embed.
    }
  }
  // Sweep the now-empty legacy parent so doctor's lint eventually reports clean.
  const legacyParent = join(projectRoot, ".fabric/cache");
  try {
    const entries = readdirSync(legacyParent);
    if (entries.length === 0) rmdirSync(legacyParent);
  } catch {
    // Missing / non-directory / permission — nothing to sweep.
  }
}

// Public for the doctor lint: returns the legacy subdirs that still exist
// under this projectRoot. Empty array = healthy.
export function detectLegacyFabricCacheDirs(projectRoot: string): string[] {
  const strays: string[] = [];
  for (const [oldRel] of LEGACY_MIGRATIONS) {
    if (existsSync(join(projectRoot, oldRel))) strays.push(oldRel);
  }
  return strays;
}
