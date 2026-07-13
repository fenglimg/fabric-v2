/**
 * ISS-20260713-011: two-tier (memory + disk) BM25 model cache for plan-context.
 */
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuleDescriptionIndexItem } from "@fenglimg/fabric-shared";
import {
  buildBm25Model,
  rehydrateBm25Model,
  serializeBm25Model,
  type Bm25Model,
  type SerializedBm25Model,
} from "./bm25.js";
import { documentFieldsForItem } from "./plan-context-doc-text.js";

// ISS-024: corpus-keyed BM25 model cache. The model depends only on the
// candidate corpus (a pure function of meta), so keying on meta.revision (a
// content hash) lets repeated query-bearing calls over the SAME KB reuse the
// index instead of re-tokenizing + re-indexing the full corpus each time. Two
// projects sharing a revision share identical corpora, so a cross-project hit
// returns an identical model — correct, not a leak.
let bm25ModelCache: { revision: string; model: Bm25Model } | null = null;
let bm25BuildCount = 0;

// P1 recall-engine-refactor (TASK-002): on-disk BM25 model cache. The model is a
// pure function of the candidate corpus, so it is keyed on the read-set revision
// (computeReadSetRevision — cross-store-recall.ts). A COLD process (a fresh hook
// invocation with an empty in-memory cache) can then `rehydrateBm25Model` from
// disk instead of re-tokenizing + re-indexing the whole corpus — the cold-start
// perf win. The key BINDS the read-set version: any content change moves the
// revision → a different filename → a miss → rebuild (whole-revision granularity,
// the chosen invalidation; no incremental). Stored under `.fabric/cache/bm25/`,
// alongside the other `.fabric/`-rooted runtime state (metrics/events ledgers).

/** ISS-20260713-015: keep only the newest N revision snapshots in a cache dir. */
export async function pruneRevisionCacheDir(dir: string, keep = 2): Promise<void> {
  try {
    const names = await readdir(dir);
    const jsons = names.filter((n) => n.endsWith(".json"));
    if (jsons.length <= keep) return;
    const withStat: Array<{ name: string; mtimeMs: number }> = [];
    for (const name of jsons) {
      try {
        const st = await stat(join(dir, name));
        withStat.push({ name, mtimeMs: st.mtimeMs });
      } catch {
        /* skip */
      }
    }
    withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const stale of withStat.slice(keep)) {
      try {
        await unlink(join(dir, stale.name));
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* missing dir ok */
  }
}

const BM25_CACHE_DIR = ".fabric/cache/bm25";

function bm25CachePath(projectRoot: string, revision: string): string {
  // The revision is a sha256 hex string (computeReadSetRevision), optionally
  // `sha256:`-prefixed — safe as a filename once the colon is normalized.
  const safe = revision.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(projectRoot, BM25_CACHE_DIR, `${safe}.json`);
}

async function loadBm25ModelFromDisk(
  projectRoot: string,
  revision: string,
): Promise<Bm25Model | null> {
  try {
    const raw = await readFile(bm25CachePath(projectRoot, revision), "utf8");
    const parsed = JSON.parse(raw) as SerializedBm25Model;
    // Reject a snapshot from a different serialization layout (version bump)
    // rather than rehydrating a mismatched shape into a broken scorer.
    if (parsed.version !== 1) return null;
    return rehydrateBm25Model(parsed);
  } catch {
    // Missing file / parse error / corrupt snapshot → treat as a miss. The cache
    // is a perf accelerator, never load-bearing: a bad read just rebuilds.
    return null;
  }
}

async function saveBm25ModelToDisk(
  projectRoot: string,
  revision: string,
  model: Bm25Model,
): Promise<void> {
  try {
    const path = bm25CachePath(projectRoot, revision);
    const dir = join(projectRoot, BM25_CACHE_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(serializeBm25Model(model)), "utf8");
    await pruneRevisionCacheDir(dir, 2);
  } catch {
    // Best-effort: a write failure (read-only FS, concurrent writer) must never
    // block ranking — the in-memory cache still serves this process.
  }
}

// ISS-024 + P1 (TASK-002): two-tier corpus-keyed BM25 cache. Tier 1 (process
// memory) serves hot repeat calls; tier 2 (disk, this function's addition) lets
// a COLD process skip the rebuild by rehydrating the persisted snapshot. On a
// total miss the model is built once, then written through to BOTH tiers.
export async function getOrBuildBm25Model(
  projectRoot: string,
  revision: string,
  rawItems: RuleDescriptionIndexItem[],
  _docTexts: Map<string, string>,
): Promise<Bm25Model> {
  if (bm25ModelCache !== null && bm25ModelCache.revision === revision) {
    return bm25ModelCache.model;
  }
  // Tier 2: cold-process disk hit — rehydrate, skip buildBm25Model entirely.
  const fromDisk = await loadBm25ModelFromDisk(projectRoot, revision);
  if (fromDisk !== null) {
    bm25ModelCache = { revision, model: fromDisk };
    return fromDisk;
  }
  // Total miss — build once, write through to memory + disk.
  bm25BuildCount += 1;
  const model = buildBm25Model(
    rawItems.map((item) => ({
      id: item.stable_id,
      fields: documentFieldsForItem(item.description),
    })),
  );
  bm25ModelCache = { revision, model };
  await saveBm25ModelToDisk(projectRoot, revision, model);
  return model;
}

// Test seams (mirror __knowledgeMetaCacheStats / __resetKnowledgeMetaCache).
export function __bm25CacheStats(): { builds: number } {
  return { builds: bm25BuildCount };
}
export function __resetBm25Cache(): void {
  bm25ModelCache = null;
  bm25BuildCount = 0;
}
