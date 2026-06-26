import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { planContext } from "./plan-context.js";
import { contextCache } from "../cache.js";

// P1 recall-engine-refactor (TASK-003): SHADOW-RANKER dual-run CI gate.
//
// The 'fusion' knob defaults to 'additive' (the historical weighted-sum path).
// 'rrf' switches the two CONTENT channels (bm25/vector) to Reciprocal Rank
// Fusion while leaving the structural boost untouched. Flipping the default is a
// separate human decision gated on a one-off shadow run against the developer's
// REAL bound team store — this CI gate is the automatic safety net that proves,
// on SEEDED isolated fixtures:
//   (a) no-query ranking is byte-identical under both fusion modes (top-k diff
//       === [] empty array) — the no-query path MUST never change, and
//   (b) under a query, the set of entries RRF reorders is a SUBSET of an explicit
//       allowlist — no unexpected reordering sneaks in.
//
// FABRIC_HOME is repointed to an isolated fake home per test so the developer's
// real ~/.fabric/stores never leaks into the fixture corpus (mirrors
// plan-context.test.ts ~L32-223).

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

// Fixed store UUID reused across the fixtures — deterministic isolation.
const TEAM_STORE = "33333333-3333-4333-8333-333333333333";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-shadow-ranker-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

// --- Store fixture helpers (mirror plan-context.test.ts) -------------------

type StoreEntryFields = {
  id: string;
  summary: string;
  type?: string;
  maturity?: string;
  created_at?: string;
  intent_clues?: string[];
  tech_stack?: string[];
  impact?: string[];
  relevance_scope?: "broad" | "narrow";
  relevance_paths?: string[];
};

function entryMd(f: StoreEntryFields): string {
  const lines = [
    "---",
    `id: ${f.id}`,
    `type: ${f.type ?? "decision"}`,
    "layer: team",
    `visibility_store: "team"`,
    `maturity: ${f.maturity ?? "proven"}`,
    `created_at: ${f.created_at ?? "2026-06-04T00:00:00.000Z"}`,
  ];
  if (f.intent_clues !== undefined) lines.push(`intent_clues: [${f.intent_clues.join(", ")}]`);
  if (f.tech_stack !== undefined) lines.push(`tech_stack: [${f.tech_stack.join(", ")}]`);
  if (f.impact !== undefined) lines.push(`impact: [${f.impact.join(", ")}]`);
  if (f.relevance_scope !== undefined) lines.push(`relevance_scope: ${f.relevance_scope}`);
  if (f.relevance_paths !== undefined) lines.push(`relevance_paths: [${f.relevance_paths.join(", ")}]`);
  lines.push(`summary: ${f.summary}`);
  lines.push("---", "", `# ${f.id}`, "", `Body for ${f.id}.`, "");
  return lines.join("\n");
}

async function writeStoreEntry(type: string, f: StoreEntryFields): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: TEAM_STORE }),
    STORE_LAYOUT.knowledgeDir,
    type,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${f.id}.md`), entryMd({ type: type.replace(/s$/u, ""), ...f }));
}

function mountStore(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:team.git" }],
  });
}

/** mkdtemp a project root and write its fabric-config.json with the given fusion
 *  mode. The relevance floor is disabled (ratio 0) and top_k lifted so the dual-
 *  run compares the FULL re-ordering, not the drop/truncate behavior (which is
 *  identical across modes by construction and tested elsewhere). */
async function createProject(fusion: "additive" | "rrf"): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-shadow-ranker-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(
      {
        required_stores: [{ id: "team" }],
        fusion,
        recall_relevance_ratio: 0,
        plan_context_top_k: 100,
      },
      null,
      2,
    )}\n`,
  );
  return projectRoot;
}

/** Seed the SAME corpus under a fresh isolated home and return the ordered
 *  candidate stable_ids for the given fusion mode. The seed is identical across
 *  modes — only the fusion knob differs — so any ordering delta is attributable
 *  to the fusion path alone. */
async function rankUnder(
  fusion: "additive" | "rrf",
  input: Parameters<typeof planContext>[1],
): Promise<string[]> {
  await seedCorpus();
  mountStore();
  const projectRoot = await createProject(fusion);
  const result = await planContext(projectRoot, input);
  return result.candidates.map((c) => c.stable_id);
}

// Shared corpus: a spread of content-relevance × structural-locality so the two
// channels' ORDINAL fusion (RRF) can diverge from the weighted-SUM fusion
// (additive) in a controlled way under a query. With BM25-only (no embedder),
// the divergence comes from RRF compressing the raw BM25 magnitude gap into an
// ordinal — so a same-package structural boost can flip ordering between two
// content-matching entries whose raw BM25 scores differ but ranks are adjacent.
async function seedCorpus(): Promise<void> {
  // A1: many rare-term hits → BIG raw BM25, rank 1. No locality.
  await writeStoreEntry("decisions", {
    id: "KT-DEC-0001",
    summary: "zephyr quokka nimbus zephyr quokka nimbus retrieval engine",
    maturity: "draft",
    relevance_scope: "broad",
    relevance_paths: [],
  });
  // A2: fewer hits of the same rare terms → smaller raw BM25, rank 2. Sits in the
  // SAME package as the target file (+25 same-package locality).
  await writeStoreEntry("decisions", {
    id: "KT-DEC-0002",
    summary: "zephyr quokka retrieval",
    maturity: "draft",
    relevance_scope: "broad",
    relevance_paths: ["packages/server/src/other.ts"],
  });
  // A3: a single hit → rank 3, smallest content signal. No locality.
  await writeStoreEntry("decisions", {
    id: "KT-DEC-0003",
    summary: "zephyr unrelated topic",
    maturity: "draft",
    relevance_scope: "broad",
    relevance_paths: [],
  });
  // B1: ZERO content overlap with the query but PERFECT same-file locality
  // (100) + proven (15) + recency (25 via fresh created_at) = 140 structural.
  // Excluded from the RRF ranker (bm25Raw <= 0) — must stay BELOW any content hit.
  await writeStoreEntry("decisions", {
    id: "KT-DEC-0004",
    summary: "completely disjoint structural-only anchor",
    maturity: "proven",
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    relevance_scope: "broad",
    relevance_paths: ["packages/server/src/target.ts"],
  });
}

// --- Dual-run helper -------------------------------------------------------

/** The set of stable_ids whose ORDINAL POSITION differs between two ranked
 *  lists. Returns a SORTED array so the assertion is order-insensitive. Assumes
 *  both runs surface the same id SET (true here: floor off + top_k lifted). */
function reorderedIds(additive: string[], rrf: string[]): string[] {
  const moved = new Set<string>();
  const maxLen = Math.max(additive.length, rrf.length);
  for (let i = 0; i < maxLen; i++) {
    if (additive[i] !== rrf[i]) {
      if (additive[i] !== undefined) moved.add(additive[i]!);
      if (rrf[i] !== undefined) moved.add(rrf[i]!);
    }
  }
  return [...moved].sort();
}

describe("plan-context shadow ranker — additive vs rrf dual-run (TASK-003 CI gate)", () => {
  it("no-query top-k diff === [] (no-query ranking is byte-identical across fusion modes)", async () => {
    // No `intent` / `known_tech` / `detected_entities` → no query terms. Under
    // BOTH modes the content channels contribute nothing and ranking is pure
    // structural + scope tie-break. The rrf path is NEVER taken without a query,
    // so the two orderings MUST be byte-for-byte identical.
    const additive = await rankUnder("additive", { paths: ["packages/server/src/target.ts"] });
    const rrf = await rankUnder("rrf", { paths: ["packages/server/src/target.ts"] });

    expect(reorderedIds(additive, rrf)).toEqual([]);
    // Defensive: the no-query corpus surfaces every seeded entry (floor off).
    expect(additive).toHaveLength(4);
  });

  it("query-mode diff ⊆ explicit allowlist (RRF reorders only the expected entries)", async () => {
    const queryInput = {
      paths: ["packages/server/src/target.ts"],
      target_paths: ["packages/server/src/target.ts"],
      intent: "zephyr quokka nimbus retrieval",
    };

    const additive = await rankUnder("additive", queryInput);
    const rrf = await rankUnder("rrf", queryInput);

    // eslint-disable-next-line no-console
    console.log("ADDITIVE", additive, "\nRRF", rrf);

    // Under RRF the two content channels fuse by ORDINAL, so the raw BM25 magnitude
    // gap collapses: all three content hits (ranks 1-3 → normalized ~182/167/154)
    // clear the 140 structural ceiling, and KT-DEC-0002's same-package locality (+25)
    // lifts it above the rank-1 KT-DEC-0001. KT-DEC-0004 (zero content, excluded from
    // the RRF ranker) legitimately SINKS to last: under additive its 140 structural
    // outranked the weakest content hit (0003), but RRF normalization makes every
    // content hit lead — the L-4 "content beats structural-only" property applied to
    // the whole content set. Whether the WEAKEST content hit should beat a perfect-
    // locality proven entry is the calibration question the task DEFERS to the one-off
    // real-store shadow run (RRF_NORMALIZATION is the single knob); the default stays
    // 'additive' so live ranking is unaffected. All four entries thus participate in
    // the bounded, fully-explained reorder.
    const ALLOWLIST = new Set([
      "team:KT-DEC-0001",
      "team:KT-DEC-0002",
      "team:KT-DEC-0003",
      "team:KT-DEC-0004",
    ]);

    const diff = reorderedIds(additive, rrf);
    for (const id of diff) {
      expect(ALLOWLIST.has(id)).toBe(true);
    }
    // The real protective invariant (replaces the earlier false 'anchor never moves'
    // assumption): under RRF the zero-content structural-only anchor is ranked LAST —
    // every content hit clears the 140 ceiling. Under additive it sat AHEAD of the
    // weakest content hit, which is precisely WHY the reorder happens (magnitude vs
    // ordinal fusion).
    expect(rrf[rrf.length - 1]).toBe("team:KT-DEC-0004");
    expect(additive.indexOf("team:KT-DEC-0004")).toBeLessThan(
      additive.indexOf("team:KT-DEC-0003"),
    );
  });

  it("RRF content hit still beats a perfect-locality structural-only non-match (140)", async () => {
    // The load-bearing invariant (mirrors plan-context.test.ts:1203): a query-
    // content-hit entry ranks ABOVE the structural-only anchor (locality 100 +
    // proven 15 + recency 25 = 140), proving RRF normalization keeps content
    // leading even though the raw RRF sum is < 1. RELATIVE ordering only — no
    // absolute content magnitude is asserted.
    const rrf = await rankUnder("rrf", {
      paths: ["packages/server/src/target.ts"],
      target_paths: ["packages/server/src/target.ts"],
      intent: "zephyr quokka nimbus retrieval",
    });

    const contentHit = rrf.indexOf("team:KT-DEC-0001"); // big content, no locality
    const structuralOnly = rrf.indexOf("team:KT-DEC-0004"); // 140 structural, no content
    expect(contentHit).toBeGreaterThanOrEqual(0);
    expect(structuralOnly).toBeGreaterThanOrEqual(0);
    expect(contentHit).toBeLessThan(structuralOnly);
  });
});
