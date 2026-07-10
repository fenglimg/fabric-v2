import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";
import { recallOutputSchema } from "@fenglimg/fabric-shared/schemas/api-contracts";

import { recall, attachPathStore } from "./recall.js";
import { readEventLedger } from "./event-ledger.js";
import { contextCache } from "../cache.js";

// W1 (KT-DEC-0026 / KT-GLD-0005): recall returns DESCRIPTIONS + READ PATHS only —
// no bodies, no selection_token, no two-step fetch. The agent Reads a
// `paths[].path` to load the body on demand. Candidates come SOLELY from the
// mounted stores in the read-set (store-qualified `<alias>:<stable_id>`); the
// fixtures seed knowledge .md files directly into a team store under an isolated
// ~/.fabric.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE = "11111111-1111-4111-8111-111111111111";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-recall-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

/** mkdtemp a project root declaring the team store as required. */
async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-recall-proj-"));
  tempDirs.push(root);
  await mkdir(join(root, ".fabric"), { recursive: true });
  await writeFile(
    join(root, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );
  await writeFile(
    join(root, ".fabric", "human-lock.json"),
    `${JSON.stringify({ locked: [] }, null, 2)}\n`,
  );
  return root;
}

/** Register the team store in the global config. */
function mountStores(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:team.git" }],
  });
}

/** Write a knowledge .md into the team store under the isolated ~/.fabric. */
async function writeStoreEntry(type: string, id: string, lines: string[]): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: TEAM_STORE }),
    STORE_LAYOUT.knowledgeDir,
    type,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), lines.join("\n"));
}

async function seedTwoEntryProject(): Promise<string> {
  const projectRoot = await createTempProject();
  await writeStoreEntry("decisions", "KT-DEC-0001", [
    "---",
    "id: KT-DEC-0001",
    "type: decision",
    "layer: team",
    "maturity: verified",
    "created_at: 2026-06-04T00:00:00.000Z",
    "intent_clues: [auth]",
    "tech_stack: [TypeScript]",
    "summary: Auth decision",
    "---",
    "# Auth body",
    "",
  ]);
  await writeStoreEntry("guidelines", "KT-GLD-0001", [
    "---",
    "id: KT-GLD-0001",
    "type: guideline",
    "layer: team",
    "maturity: verified",
    "created_at: 2026-06-04T00:00:00.000Z",
    "intent_clues: [ui]",
    "summary: UI guideline",
    "---",
    "# UI body",
    "",
  ]);
  mountStores();
  return projectRoot;
}

describe("recall (lean one-call — KT-DEC-0026: descriptions + read paths, no bodies)", () => {
  it("returns the full candidate description index + one read path per candidate, NO body", async () => {
    const projectRoot = await seedTwoEntryProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      // Intent matches BOTH seeded entries (auth → KT-DEC-0001, ui → KT-GLD-0001)
      // symmetrically, so both clear the KT-DEC-0038 ratio-to-top floor and this
      // test stays focused on the lean wire shape, not relevance filtering.
      intent: "auth ui",
      correlation_id: "corr-recall-1",
      session_id: "session-recall-1",
    });

    // ux-w2-4: one unified ranked entries[] (description + read_path merged).
    expect(result.revision_hash).toEqual(expect.any(String));
    expect(result.entries.map((e) => e.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
    // TASK-004: entries returned best-first (array index is the ranking signal;
    // explicit `rank` field dropped from the wire — derivable + zero consumers).
    expect(result.entries.length).toBe(2);

    // Each surfaced entry carries a read_path pointing at the on-disk store file.
    expect(result.entries.filter((e) => e.read_path).map((e) => e.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
    const authEntry = result.entries.find((e) => e.stable_id === "team:KT-DEC-0001");
    expect(authEntry?.read_path).toMatch(/KT-DEC-0001\.md$/);
    // TASK-004: store surface flattened { alias } → store_alias.
    expect(authEntry?.store_alias).toBe("team");

    // No bodies / no two-step fields leak into the wire shape.
    expect(result).not.toHaveProperty("rules");
    expect(result).not.toHaveProperty("body_tier");
    expect(result).not.toHaveProperty("selection_token");
    expect(result).not.toHaveProperty("selected_stable_ids");

    // Planning telemetry still fires; recall no longer emits the retired
    // sections-fetched / consumed events (no body fetch happens).
    const planned = await readEventLedger(projectRoot, { event_type: "knowledge_context_planned" });
    expect(planned.events).toHaveLength(1);
    const fetched = await readEventLedger(projectRoot, { event_type: "knowledge_sections_fetched" });
    expect(fetched.events).toEqual([]);
    const consumed = await readEventLedger(projectRoot, { event_type: "knowledge_consumed" });
    expect(consumed.events).toEqual([]);
  });

  // BORROW-008 proximity regression guard. scoreBreakdownForItem historically
  // OMITTED the proximityBoost component from `final`, so `final` = score −
  // proximity for every multi-term-query candidate whose text has the query terms
  // close together — silently violating the "final === scoreDescriptionItem by
  // construction" invariant. The pre-existing invariant test uses a SYMMETRIC
  // "auth ui" fixture where neither entry holds BOTH terms, so proximity is
  // trivially 0 and could never catch the omission. This seeds an entry whose
  // summary holds an ADJACENT query bigram so proximityBoost actually fires (>0),
  // then asserts final still reconciles to score AND the field survives the wire.
  it("sums score_breakdown.proximity into final when a query bigram is adjacent", async () => {
    const projectRoot = await createTempProject();
    await writeStoreEntry("decisions", "KT-DEC-0009", [
      "---",
      "id: KT-DEC-0009",
      "type: decision",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      "intent_clues: [recall proximity boost]",
      "tech_stack: [TypeScript]",
      "summary: Recall proximity boost ranking",
      "---",
      "# Proximity body",
      "",
    ]);
    mountStores();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      // Two query terms ADJACENT in the seeded summary → proximityBoost > 0.
      intent: "recall proximity",
      session_id: "session-recall-proximity",
      // TASK-006: opt in to score_breakdown to inspect the proximity signal.
      include_score_breakdown: true,
    });

    const entry = result.entries.find((e) => e.stable_id.endsWith("KT-DEC-0009"));
    expect(entry).toBeDefined();
    // The component actually fired — proves this test exercises proximity, unlike
    // the symmetric fixture where it is a trivial 0.
    expect(entry?.score_breakdown?.proximity).toBeGreaterThan(0);
    // KT-PIT-0036 invariant (wire-side): breakdown.final is now the sole surfaced
    // ranking signal (entry.score dropped in TASK-004). It must be > 0 when
    // proximity fired — the wave-1 "final desynced from score" regression would
    // manifest as final === 0 or final !== bm25+vector+salience+recency+locality
    // +proximity(+credibility×content). Runtime invariant (scored.score === final)
    // still enforced at the plan-context layer where the Map originates.
    expect(entry?.score_breakdown?.final).toBeGreaterThan(0);

    // KT-PIT-0005 wire-strip lock now covers the new field: proximity survives the
    // recallOutputSchema round-trip (zod .strip() would otherwise drop it).
    const parsed = recallOutputSchema.parse(result);
    const parsedEntry = parsed.entries.find((e) => e.stable_id.endsWith("KT-DEC-0009"));
    expect(parsedEntry?.score_breakdown?.proximity).toBe(entry?.score_breakdown?.proximity);
  });

  // PLN-004 F1 credibility content-age decay: an older entry ranks below an
  // otherwise-identical fresher one, and the final===score parity survives the
  // multiplier being applied to BOTH the ranking score and its breakdown.
  it("down-weights a content-stale entry below an identical fresh entry, preserving final===score", async () => {
    const projectRoot = await createTempProject();
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    // Both >7d old (no recencyBoost confound) and <238d old (a decisions/draft entry
    // only hits the 0.4 floor past ~238d), so the credibility factor is strictly
    // monotonic in age. Computed relative to Date.now() so the test is run-time-stable.
    const freshDate = new Date(now - 14 * DAY).toISOString();
    const staleDate = new Date(now - 70 * DAY).toISOString();
    const entryLines = (id: string, createdAt: string): string[] => [
      "---",
      `id: ${id}`,
      "type: decision",
      "layer: team",
      "maturity: draft",
      `created_at: ${createdAt}`,
      "intent_clues: [caching]",
      "summary: Caching layer decision",
      "---",
      "# Caching body",
      "",
    ];
    await writeStoreEntry("decisions", "KT-DEC-9001", entryLines("KT-DEC-9001", staleDate));
    await writeStoreEntry("decisions", "KT-DEC-9002", entryLines("KT-DEC-9002", freshDate));
    mountStores();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      intent: "caching",
      session_id: "session-credibility-age",
      // TASK-006: opt in to score_breakdown to inspect the credibility multiplier.
      include_score_breakdown: true,
    });

    const stale = result.entries.find((e) => e.stable_id.endsWith("KT-DEC-9001"));
    const fresh = result.entries.find((e) => e.stable_id.endsWith("KT-DEC-9002"));
    expect(stale).toBeDefined();
    expect(fresh).toBeDefined();

    // Identical content/structural → the credibility multiplier is the ONLY
    // differentiator, so the fresher entry ranks strictly higher and its factor is
    // strictly larger (and still < 1, i.e. it actually decayed).
    // TASK-004: use score_breakdown.final as the ranking-signal proxy — the wire
    // no longer exposes a separate entry.score field (final === score by invariant).
    const staleFinal = stale?.score_breakdown?.final ?? 0;
    const freshFinal = fresh?.score_breakdown?.final ?? 0;
    const staleCred = stale?.score_breakdown?.credibility ?? 1;
    const freshCred = fresh?.score_breakdown?.credibility ?? 1;
    expect(freshFinal).toBeGreaterThan(staleFinal);
    expect(freshCred).toBeGreaterThan(staleCred);
    expect(freshCred).toBeLessThan(1);
  });

  // v2.2 glossary aliases (C-001/C-002 / R1): an alias term merged into an entry's
  // BM25 body (plan-context documentFieldsForItem summary MID-weight slot + flat
  // vector body) lifts a long-tail entry into recall results when the query uses
  // the ALIAS — proving aliases are not a no-op field. But it must NOT out-rank a
  // control entry carrying the SAME term directly in its content (summary → title
  // HIGH-weight slot, boost 3 > summary boost 1.5): aliases land in the mid-weight
  // slot so long-tail entries surface WITHOUT overtaking direct content hits
  // ("content 领先"). Distinctive nonsense terms (florble/quaxil) avoid any
  // synonym/stemming bridge that would let "quaxil" match "florble" directly.
  it("recalls a long-tail entry via its alias term, but not above a direct content hit", async () => {
    const projectRoot = await createTempProject();
    // Alias entry: "florble" is its only real content term; "quaxil" appears ONLY
    // as an alias. Without the aliases→BM25 wiring a "quaxil" query never matches
    // it. Kept short so its summary-slot length penalty (b=0.75) stays modest.
    await writeStoreEntry("decisions", "KT-DEC-7001", [
      "---",
      "id: KT-DEC-7001",
      "type: decision",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      "intent_clues: [florble]",
      "aliases: [quaxil]",
      "summary: Florble",
      "---",
      "# Florble body",
      "",
    ]);
    // Control entry: carries "quaxil" DIRECTLY in its summary → the title
    // HIGH-weight slot. Same created_at + no relevance_paths → credibility /
    // recency / locality are identical to the alias entry, so the ONLY score
    // differentiator is which BM25F slot the term lands in.
    await writeStoreEntry("decisions", "KT-DEC-7002", [
      "---",
      "id: KT-DEC-7002",
      "type: decision",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      "intent_clues: [florble]",
      "summary: Quaxil",
      "---",
      "# Quaxil body",
      "",
    ]);
    mountStores();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      intent: "quaxil",
      session_id: "session-recall-alias",
      // TASK-006: opt in to score_breakdown for the ranking comparison.
      include_score_breakdown: true,
    });

    const aliasEntry = result.entries.find((e) => e.stable_id.endsWith("KT-DEC-7001"));
    const directEntry = result.entries.find((e) => e.stable_id.endsWith("KT-DEC-7002"));

    // (1) The alias term lifted the long-tail entry into recall results with a real
    // score — proves aliases feed the BM25 body rather than being an inert field.
    // TASK-004: entry.score dropped from wire; final in score_breakdown is the
    // ranking-signal proxy (final === score by KT-PIT-0036 invariant).
    expect(aliasEntry).toBeDefined();
    expect(aliasEntry?.score_breakdown?.final ?? 0).toBeGreaterThan(0);

    // (2) The direct content hit out-ranks the alias hit: aliases (summary slot,
    // boost 1.5) must NOT overtake direct content (title slot, boost 3). `<=`
    // matches the plan's convergence contract; in practice it is strictly less.
    expect(directEntry).toBeDefined();
    expect(aliasEntry?.score_breakdown?.final ?? 0).toBeLessThanOrEqual(
      directEntry?.score_breakdown?.final ?? 0,
    );
  });

  // wire-slim (payload) guard: recall projects a LEAN description (selection signal
  // only). The seed's KT-DEC-0001 carries tech_stack — so `not.toHaveProperty` is a
  // red-before/green-after check that the verbose fields left the wire. The agent
  // Reads read_path for the full frontmatter when it actually needs those.
  it("wire-slim: entry.description keeps selection signal, drops verbose fields on the wire", async () => {
    const projectRoot = await seedTwoEntryProject();
    const result = await recall(projectRoot, { paths: ["src/index.ts"], intent: "auth ui" });

    expect(result.entries.length).toBeGreaterThan(0);
    for (const entry of result.entries) {
      const desc = entry.description as Record<string, unknown>;
      // KEEP — the field the agent always selects on.
      expect(desc).toHaveProperty("summary");
      // TASK-002: must_read_if is optional on the wire — when present, distinct
      // from summary (dedup omits it when identical). Consumers fall back to
      // summary when absent. Both branches are wire-legal.
      if ("must_read_if" in desc) {
        expect(desc.must_read_if).not.toEqual(desc.summary);
      }
      // DROPPED — reachable on demand via read_path, never on the wire.
      // TASK-005: intent_clues joined the dropped-from-wire set (0 hook consumers).
      for (const gone of ["intent_clues", "tech_stack", "impact", "relevance_paths", "tags", "related", "created_at", "maturity"]) {
        expect(desc).not.toHaveProperty(gone);
      }
    }

    // The lean shape survives the recallOutputSchema round-trip (optional-absent OK).
    const parsed = recallOutputSchema.parse(result);
    expect((parsed.entries[0].description as Record<string, unknown>)).not.toHaveProperty("tech_stack");
  });

  // TASK-002 wire dedup: two branches — must_read_if omitted when ===summary,
  // present when distinct. Seed both cases explicitly (frontmatter no-fallback
  // vs frontmatter distinct-value) to prove each branch of the projection.
  it("wire dedup: must_read_if omitted when identical to summary, present when distinct", async () => {
    const projectRoot = await createTempProject();
    // Case A: frontmatter has no must_read_if → knowledge-meta-builder falls back
    // to summary → dedup applies → wire omits must_read_if.
    await writeStoreEntry("decisions", "KT-DEC-0001", [
      "---",
      "id: KT-DEC-0001",
      "type: decision",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      "intent_clues: [dedup-a]",
      "summary: Case A summary",
      "---",
      "# Case A body",
      "",
    ]);
    // Case B: frontmatter declares a DIFFERENT must_read_if → wire keeps it.
    await writeStoreEntry("guidelines", "KT-GLD-0001", [
      "---",
      "id: KT-GLD-0001",
      "type: guideline",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      "intent_clues: [dedup-b]",
      "summary: Case B summary",
      "must_read_if: Read when case B trigger fires",
      "---",
      "# Case B body",
      "",
    ]);
    mountStores();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      intent: "dedup-a dedup-b",
    });

    const byId = new Map(result.entries.map((e) => [e.stable_id, e.description as Record<string, unknown>]));
    const caseA = byId.get("team:KT-DEC-0001");
    const caseB = byId.get("team:KT-GLD-0001");

    expect(caseA).toBeDefined();
    expect(caseA).not.toHaveProperty("must_read_if");
    expect(caseA?.summary).toBe("Case A summary");

    expect(caseB).toBeDefined();
    expect(caseB?.must_read_if).toBe("Read when case B trigger fires");
    expect(caseB?.must_read_if).not.toEqual(caseB?.summary);
  });

  // P1 recall-engine-refactor (TASK-002) — lean read_path contract (KT-GLD-0005 /
  // KT-DEC-0019): the default entry carries the discovery INDEX (description +
  // score) + a read_path, but NOT the entry's markdown BODY. The body ("# Auth
  // body") is reached on demand via read_path, never packaged into the payload —
  // hard-cutting the description itself is explicitly rejected by KT-DEC-0019
  // ("硬砍丢描述会背叛 no-server-filter 哲学并漏可发现性"), so this asserts the
  // body is absent while the description index + read_path stay present.
  it("default payload omits the entry body, keeps the description index + read_path (lean)", async () => {
    const projectRoot = await seedTwoEntryProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      intent: "auth ui",
    });

    const authEntry = result.entries.find((e) => e.stable_id === "team:KT-DEC-0001");
    expect(authEntry).toBeDefined();
    // read_path is present and points at the on-disk store file (body on demand).
    expect(authEntry?.read_path).toMatch(/KT-DEC-0001\.md$/);
    // The discovery index survives (summary is the headline the LLM selects on).
    expect(authEntry?.description.summary).toBe("Auth decision");

    // The markdown BODY text never enters the payload, anywhere in the envelope.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("# Auth body");
    expect(serialized).not.toContain("# UI body");
  });

  it("scopes the read-path index when `ids` provided, intersecting surfaced candidates; descriptions stay full", async () => {
    const projectRoot = await seedTwoEntryProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001", "non-existent-id"],
    });

    // Only the intersection of `ids` and surfaced candidates gets a read_path.
    expect(result.entries.filter((e) => e.read_path).map((e) => e.stable_id)).toEqual([
      "team:KT-DEC-0001",
    ]);
    // The entry list still shows the full set for discovery (descriptions intact).
    expect(result.entries.map((e) => e.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
  });

  it("does not carry a per-response directive on the wire (TASK-001: bootstrap-injected)", async () => {
    const projectRoot = await seedTwoEntryProject();
    const result = await recall(projectRoot, { paths: ["src/index.ts"] });
    // TASK-001 envelope thinning: the cite policy is bootstrap-injected via
    // AGENTS.md + SessionStart, not re-echoed on every recall response. Wire
    // schema no longer declares `directive`; result type has no such field.
    expect((result as Record<string, unknown>).directive).toBeUndefined();
  });

  // W1-3 (KT-DEC-0031): include_related surfaces the related neighbour's read
  // path (not its body). The `related` edge references the store-qualified id.
  async function seedRelatedProject(edgeId = "team:KT-GLD-0001"): Promise<string> {
    const projectRoot = await createTempProject();
    await writeStoreEntry("decisions", "KT-DEC-0001", [
      "---",
      "id: KT-DEC-0001",
      "type: decision",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      `related: [${edgeId}]`,
      "summary: Auth decision",
      "---",
      "# Auth body",
      "",
    ]);
    await writeStoreEntry("guidelines", "KT-GLD-0001", [
      "---",
      "id: KT-GLD-0001",
      "type: guideline",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      "summary: UI guideline",
      "---",
      "# UI body",
      "",
    ]);
    mountStores();
    return projectRoot;
  }

  it("include_related expands a scoped recall to surface the related neighbour's read path", async () => {
    const projectRoot = await seedRelatedProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001"],
      include_related: true,
    });

    expect(result.entries.filter((e) => e.read_path).map((e) => e.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
  });

  it("include_related expands bare local related ids against store-qualified candidates", async () => {
    const projectRoot = await seedRelatedProject("KT-GLD-0001");

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001"],
      include_related: true,
    });

    expect(result.entries.filter((e) => e.read_path).map((e) => e.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
  });

  it("hints via next_steps that related entries exist when their path was not surfaced", async () => {
    const projectRoot = await seedRelatedProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001"],
    });

    // Only auth got a read_path, but the packaging nudges include_related.
    expect(result.entries.filter((e) => e.read_path).map((e) => e.stable_id)).toEqual([
      "team:KT-DEC-0001",
    ]);
    expect(result.next_steps ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/include_related:true/)]),
    );
  });

  it("attaches store provenance for store-backed read paths", async () => {
    const projectRoot = await seedTwoEntryProject();
    const result = await recall(projectRoot, { paths: ["src/index.ts"] });
    const withPath = result.entries.filter((e) => e.read_path);
    expect(withPath.length).toBeGreaterThan(0);
    for (const e of withPath) {
      // TASK-004: store surface flattened { alias } → store_alias on the wire.
      // (Internal RecallPath.store retains the nested shape — see attachPathStore.)
      expect(e.store_alias).toBe("team");
    }
  });

  it("attachPathStore derives the alias from a `<alias>:<id>` qualifier; a bare id yields no store field", async () => {
    expect(attachPathStore({ stable_id: "team:KT-DEC-0001", path: "/x/KT-DEC-0001.md" })).toEqual({
      stable_id: "team:KT-DEC-0001",
      path: "/x/KT-DEC-0001.md",
      store: { alias: "team" },
    });
    expect(attachPathStore({ stable_id: "KT-DEC-0001", path: "/x/KT-DEC-0001.md" })).toEqual({
      stable_id: "KT-DEC-0001",
      path: "/x/KT-DEC-0001.md",
    });
  });

  it("surfaces a structured dropped[]{id,reason} + a next_steps hint when the budget omits candidates", async () => {
    const projectRoot = await seedTwoEntryProject();
    // top_k=1 over two candidates → one omitted by the retrieval budget.
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }], plan_context_top_k: 1 }, null, 2)}\n`,
    );

    const result = await recall(projectRoot, { paths: ["src/index.ts"] });

    // K6 + TASK-003 wire transform: dropped[{id,reason}] is hoisted to
    // dropped_ids (KT-DEC-0028 id-transparency) + dropped_reasons count map.
    // Here: one retrieval_budget drop (the lower-ranked candidate the top_k cap
    // removed).
    expect(result.dropped_ids).toEqual(["team:KT-GLD-0001"]);
    expect(result.dropped_reasons).toEqual({ retrieval_budget: 1 });
    // Only the surviving candidate is surfaced (with a read_path).
    expect(result.entries.filter((e) => e.read_path)).toHaveLength(1);
    expect(result.next_steps ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/omitted by the retrieval budget/)]),
    );
  });

  it("returns empty paths when no candidates surface (no spurious fetch)", async () => {
    const projectRoot = await createTempProject();

    const result = await recall(projectRoot, { paths: ["src/index.ts"] });

    expect(result.entries).toEqual([]);
    // TASK-001: directive is no longer part of the wire; verify absence.
    expect((result as Record<string, unknown>).directive).toBeUndefined();

    const fetched = await readEventLedger(projectRoot, { event_type: "knowledge_sections_fetched" });
    expect(fetched.events).toEqual([]);
  });

  // always-active dedupe marker: the SessionStart hook injects broad
  // model/guideline BODIES in full ("ALWAYS-ACTIVE RULES") while broad
  // decision/pitfall/process get a REFERENCE id+hook only. recall re-surfaces
  // those same broad model/guideline entries; mark them `always_active:true` so
  // the agent knows the body is already in context and need not re-Read it. The
  // predicate is a pure function of (relevance_scope, knowledge_type) — no client
  // state needed. NOT dropped/demoted: SessionStart injection degrades to an
  // index line on budget overflow, so the body is not guaranteed present.
  it("marks broad model/guideline entries body_in_context:true; decisions are not", async () => {
    const projectRoot = await createTempProject();
    await writeStoreEntry("models", "KT-MOD-0001", [
      "---",
      "id: KT-MOD-0001",
      "type: model",
      "layer: team",
      "maturity: draft",
      "created_at: 2026-06-04T00:00:00.000Z",
      "relevance_scope: broad",
      "summary: scope model",
      "---",
      "# body",
      "",
    ]);
    await writeStoreEntry("guidelines", "KT-GLD-0001", [
      "---",
      "id: KT-GLD-0001",
      "type: guideline",
      "layer: team",
      "maturity: draft",
      "created_at: 2026-06-04T00:00:00.000Z",
      "relevance_scope: broad",
      "summary: a guideline",
      "---",
      "# body",
      "",
    ]);
    await writeStoreEntry("decisions", "KT-DEC-0001", [
      "---",
      "id: KT-DEC-0001",
      "type: decision",
      "layer: team",
      "maturity: draft",
      "created_at: 2026-06-04T00:00:00.000Z",
      "relevance_scope: broad",
      "summary: a decision",
      "---",
      "# body",
      "",
    ]);
    mountStores();

    const result = await recall(projectRoot, { paths: ["src/x.ts"], intent: "scope model guideline" });
    const byId = new Map(result.entries.map((e) => [e.stable_id, e]));

    expect(byId.get("team:KT-MOD-0001")?.body_in_context).toBe(true);
    expect(byId.get("team:KT-GLD-0001")?.body_in_context).toBe(true);
    // REFERENCE-tier (decision) is NOT full-injected at SessionStart → no marker.
    expect(byId.get("team:KT-DEC-0001")?.body_in_context ?? false).toBe(false);

    // wire-strip lock (KT-PIT-0005): body_in_context must be DECLARED in
    // recallOutputSchema, else zod .strip() silently drops it at the MCP boundary
    // — the field would work in this unit test (direct call) yet vanish over the
    // wire. Round-trip through the output schema and assert it survives.
    const parsed = recallOutputSchema.parse(result);
    const parsedById = new Map(parsed.entries.map((e) => [e.stable_id, e]));
    expect(parsedById.get("team:KT-MOD-0001")?.body_in_context).toBe(true);
  });

  // TASK-006 opt-in: score_breakdown is omitted by default (steady-state wire
  // thinning) and populated only when the caller sets include_score_breakdown.
  // The KT-PIT-0036 final===score invariant is still enforced at the plan-context
  // service layer (candidate_scores Map) regardless of this flag — so opting in
  // is a pure observability surface, not a ranking-behavior toggle.
  it("score_breakdown opt-in: omitted by default, populated (+schema round-trip) when include_score_breakdown=true", async () => {
    const projectRoot = await seedTwoEntryProject();

    // Default call (no flag) → breakdown omitted from every entry.
    const defaultRes = await recall(projectRoot, {
      paths: ["src/index.ts"],
      intent: "auth ui",
    });
    expect(defaultRes.entries.length).toBeGreaterThan(0);
    for (const entry of defaultRes.entries) {
      expect(entry.score_breakdown).toBeUndefined();
    }

    // Opt-in call → breakdown surfaces, is numbers-only, and survives the
    // recallOutputSchema round-trip (KT-PIT-0005 wire-strip lock).
    const optInRes = await recall(projectRoot, {
      paths: ["src/index.ts"],
      intent: "auth ui",
      include_score_breakdown: true,
    });
    expect(optInRes.entries.length).toBeGreaterThan(0);
    for (const entry of optInRes.entries) {
      expect(entry.score_breakdown).toBeDefined();
      expect(typeof entry.score_breakdown?.final).toBe("number");
      expect(entry.score_breakdown?.final).toBeGreaterThan(0);
      // numbers-only: every breakdown value is a number, never body text.
      for (const value of Object.values(entry.score_breakdown ?? {})) {
        expect(typeof value).toBe("number");
      }
    }
    const parsed = recallOutputSchema.parse(optInRes);
    expect(parsed.entries[0].score_breakdown).toEqual(optInRes.entries[0].score_breakdown);
  });
});
