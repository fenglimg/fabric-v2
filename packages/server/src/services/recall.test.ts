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
    // Ranked best-first: every entry carries a 1-based rank.
    expect(result.entries.map((e) => e.rank).sort()).toEqual([1, 2]);

    // Each surfaced entry carries a read_path pointing at the on-disk store file.
    expect(result.entries.filter((e) => e.read_path).map((e) => e.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
    const authEntry = result.entries.find((e) => e.stable_id === "team:KT-DEC-0001");
    expect(authEntry?.read_path).toMatch(/KT-DEC-0001\.md$/);
    expect(authEntry?.store).toEqual({ alias: "team" });

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
    });

    const entry = result.entries.find((e) => e.stable_id.endsWith("KT-DEC-0009"));
    expect(entry).toBeDefined();
    // The component actually fired — proves this test exercises proximity, unlike
    // the symmetric fixture where it is a trivial 0.
    expect(entry?.score_breakdown?.proximity).toBeGreaterThan(0);
    // The omission this fix closes: final MUST include proximity → equals score.
    expect(entry?.score_breakdown?.final).toBe(entry?.score);

    // KT-PIT-0005 wire-strip lock now covers the new field: proximity survives the
    // recallOutputSchema round-trip (zod .strip() would otherwise drop it).
    const parsed = recallOutputSchema.parse(result);
    const parsedEntry = parsed.entries.find((e) => e.stable_id.endsWith("KT-DEC-0009"));
    expect(parsedEntry?.score_breakdown?.proximity).toBe(entry?.score_breakdown?.proximity);
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
      // KEEP — the fields the agent selects on.
      expect(desc).toHaveProperty("summary");
      expect(desc).toHaveProperty("must_read_if");
      expect(desc).toHaveProperty("intent_clues");
      // DROPPED — reachable on demand via read_path, never on the wire.
      for (const gone of ["tech_stack", "impact", "relevance_paths", "tags", "related", "created_at", "maturity"]) {
        expect(desc).not.toHaveProperty(gone);
      }
    }

    // The lean shape survives the recallOutputSchema round-trip (optional-absent OK).
    const parsed = recallOutputSchema.parse(result);
    expect((parsed.entries[0].description as Record<string, unknown>)).not.toHaveProperty("tech_stack");
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

  it("always returns a cite directive in the packaging", async () => {
    const projectRoot = await seedTwoEntryProject();
    const result = await recall(projectRoot, { paths: ["src/index.ts"] });
    // v2.2 C1 (W2): directive describes recall auto-accounting + dismissed-only,
    // not the retired first-line cite contract.
    expect(result.directive).toMatch(/auto-accounted as citations/i);
    expect(result.directive).toMatch(/dismiss/i);
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
      expect(e.store).toEqual({ alias: "team" });
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

    // K6: omissions are reported as a structured dropped[]{id,reason} list with a
    // controlled reason enum — here exactly one retrieval_budget drop (the
    // lower-ranked candidate the top_k cap removed).
    expect(result.dropped).toEqual([
      { id: "team:KT-GLD-0001", reason: "retrieval_budget" },
    ]);
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
    expect(result.directive).toMatch(/auto-accounted as citations/i);

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

  // P1 recall-observability: the fused score (computed internally during the
  // plan-context sort) is now EXPOSED on each entry, with an optional numbers-only
  // breakdown. Mirrors the body_in_context wire-strip precedent above: the field
  // must be DECLARED in recallOutputSchema or zod .strip() drops it at the MCP
  // boundary (KT-PIT-0005) — so we round-trip through the schema and assert it
  // survives. Lean read_path contract (KT-DEC-0019 / KT-GLD-0005): the breakdown
  // is numbers-only and never carries body text.
  it("exposes a numeric score + numbers-only score_breakdown per entry, surviving schema round-trip", async () => {
    const projectRoot = await seedTwoEntryProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      // A query is required for BM25 to contribute; matches both seeded entries.
      intent: "auth ui",
    });

    expect(result.entries.length).toBeGreaterThan(0);
    // Every surfaced entry carries a numeric score.
    for (const entry of result.entries) {
      expect(typeof entry.score).toBe("number");
      expect(entry.score_breakdown).toBeDefined();
      // breakdown.final reconciles to the threaded score (same computation).
      expect(entry.score_breakdown?.final).toBe(entry.score);
      // numbers-only: every breakdown value is a number, never body text.
      for (const value of Object.values(entry.score_breakdown ?? {})) {
        expect(typeof value).toBe("number");
      }
    }
    // entries[0] is the top-ranked entry and carries a numeric score.
    expect(typeof result.entries[0].score).toBe("number");

    // wire-strip lock (KT-PIT-0005): score / score_breakdown must survive the
    // recallOutputSchema round-trip — else zod .strip() drops them over the wire
    // while this direct-call test would still pass.
    const parsed = recallOutputSchema.parse(result);
    expect(typeof parsed.entries[0].score).toBe("number");
    expect(parsed.entries[0].score).toBe(result.entries[0].score);
    expect(parsed.entries[0].score_breakdown).toEqual(result.entries[0].score_breakdown);
  });
});
