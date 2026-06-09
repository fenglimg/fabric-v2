import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePath,
} from "@fenglimg/fabric-shared";

import { readEventLedger } from "./event-ledger.js";
import { planContext, readSelectionToken, __bm25CacheStats, __resetBm25Cache } from "./plan-context.js";
import { contextCache } from "../cache.js";

// v2.2 W5 R1/R7 (读侧退役): planContext no longer reads the project's
// co-location `.fabric/knowledge/` tree or `.fabric/agents.meta.json`. Candidates
// come SOLELY from the mounted stores in the read-set (required_stores ∪ implicit
// personal), assembled live by buildCrossStoreRawItems. Every candidate id is
// store-qualified (`<alias>:<stable_id>`). revision_hash is a store-corpus
// content fingerprint (computeReadSetRevision), not the agents.meta revision.
//
// FABRIC_HOME is repointed to an isolated fake home in beforeEach so the
// developer's real ~/.fabric/stores never leak into the fixture, and the seeded
// stores land under that fake home.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

// Fixed store UUIDs reused across the fixtures below. The team store backs the
// required_stores read-set; the personal store is auto-included via its
// `personal: true` flag (S11 implicit personal).
const TEAM_STORE = "11111111-1111-4111-8111-111111111111";
const PERSONAL_STORE = "22222222-2222-4222-8222-222222222222";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-plan-context-home-"));
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
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

// ---------------------------------------------------------------------------
// Store fixture helpers (mirror plan-context-scope-rank.test.ts).
// ---------------------------------------------------------------------------

/** mkdtemp a project root and write its fabric-config.json. No agents.meta. */
async function createProject(config: object): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-plan-context-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return projectRoot;
}

/** The default project — declares the team store as required. */
async function createTeamProject(extra: object = {}): Promise<string> {
  return createProject({ required_stores: [{ id: "team" }], ...extra });
}

type StoreEntryFields = {
  id: string;
  summary: string;
  type?: string;
  layer?: "team" | "personal";
  semantic_scope?: string;
  maturity?: string;
  created_at?: string;
  intent_clues?: string[];
  tech_stack?: string[];
  impact?: string[];
  relevance_scope?: "broad" | "narrow";
  relevance_paths?: string[];
  related?: string[];
};

/** Render a full-frontmatter knowledge .md body for a store entry. */
function entryMd(f: StoreEntryFields): string {
  const lines = [
    "---",
    `id: ${f.id}`,
    `type: ${f.type ?? "decision"}`,
    `layer: ${f.layer ?? "team"}`,
  ];
  if (f.semantic_scope !== undefined) lines.push(`semantic_scope: ${f.semantic_scope}`);
  lines.push(`visibility_store: "${f.layer ?? "team"}"`);
  lines.push(`maturity: ${f.maturity ?? "proven"}`);
  lines.push(`created_at: ${f.created_at ?? "2026-06-04T00:00:00.000Z"}`);
  if (f.intent_clues !== undefined) lines.push(`intent_clues: [${f.intent_clues.join(", ")}]`);
  if (f.tech_stack !== undefined) lines.push(`tech_stack: [${f.tech_stack.join(", ")}]`);
  if (f.impact !== undefined) lines.push(`impact: [${f.impact.join(", ")}]`);
  if (f.relevance_scope !== undefined) lines.push(`relevance_scope: ${f.relevance_scope}`);
  if (f.relevance_paths !== undefined) lines.push(`relevance_paths: [${f.relevance_paths.join(", ")}]`);
  if (f.related !== undefined && f.related.length > 0) lines.push(`related: [${f.related.join(", ")}]`);
  lines.push(`summary: ${f.summary}`);
  lines.push("---", "", `# ${f.id}`, "", `Body for ${f.id}.`, "");
  return lines.join("\n");
}

/** Write a knowledge .md into a store under the isolated ~/.fabric. */
async function writeStoreEntry(
  storeUuid: string,
  type: string,
  f: StoreEntryFields,
): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePath(storeUuid),
    STORE_LAYOUT.knowledgeDir,
    type,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${f.id}.md`), entryMd({ type: type.replace(/s$/u, ""), ...f }));
}

/** Register the team store (and optionally a personal store) in the global config. */
function mountStores(opts: { personal?: boolean } = {}): void {
  const stores = [
    { store_uuid: TEAM_STORE, alias: "team", remote: "git@e:team.git" },
  ];
  if (opts.personal === true) {
    stores.push({
      store_uuid: PERSONAL_STORE,
      alias: "personal",
      remote: "git@e:personal.git",
      // @ts-expect-error — personal flag is optional on the config store shape.
      personal: true,
    });
  }
  saveGlobalConfig({ uid: "test-uid", stores });
}

describe("planContext", () => {
  it("returns a neutral requirement profile and store-qualified candidates sorted by stable_id", async () => {
    const projectRoot = await createTeamProject();
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-0001",
      summary: "Global protocol",
      tech_stack: ["Fabric"],
    });
    await writeStoreEntry(TEAM_STORE, "guidelines", {
      id: "KT-GLD-0001",
      type: "guideline",
      summary: "UI batch rendering",
    });
    mountStores();

    const result = await planContext(projectRoot, {
      paths: ["src/index.ts"],
      intent: "rendering tweak",
      known_tech: ["TypeScript"],
      detected_entities: {
        "src/index.ts": ["Renderer"],
      },
      correlation_id: "corr-plan",
      session_id: "session-plan",
    });

    // revision_hash is the store-corpus content fingerprint
    // (computeReadSetRevision) — deterministic but we assert shape, not literal.
    expect(result.revision_hash).toEqual(expect.any(String));
    expect(result.revision_hash.length).toBeGreaterThan(0);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.path).toBe("src/index.ts");
    expect(result.entries[0]?.requirement_profile).toMatchObject({
      target_path: "src/index.ts",
      user_intent: "rendering tweak",
      known_tech: ["TypeScript"],
      detected_entities: ["Renderer"],
    });
    // v2.0.0-rc.38 UX-3: path_segments / extension dropped (derivable).
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("extension");
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("path_segments");

    // v2.0-rc.5 A3 (TASK-007): Cocos-era fields removed from the profile.
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("inferred_domain");
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("intent_tokens");
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("impact_hints");

    // L0/L1/L2 selection ceremony fields removed from the per-entry shape.
    expect(result.entries[0]).not.toHaveProperty("required_stable_ids");
    expect(result.entries[0]).not.toHaveProperty("ai_selectable_stable_ids");
    expect(result.entries[0]).not.toHaveProperty("initial_selected_stable_ids");
    expect(result.entries[0]).not.toHaveProperty("selection_policy");

    // Same fields never existed on the top-level result either.
    expect(result).not.toHaveProperty("required_stable_ids");
    expect(result).not.toHaveProperty("ai_selectable_stable_ids");
    // v2.0.0-rc.38 UX-1: per-path description_index collapsed into top-level candidates.
    expect(result.entries[0]).not.toHaveProperty("description_index");

    const index = result.candidates;
    // The intent "rendering tweak" floats the "UI batch rendering" guideline
    // above the unrelated "Global protocol" decision via BM25 (content leads).
    // Ids are store-qualified now.
    expect(index.map((item) => item.stable_id)).toEqual([
      "team:KT-GLD-0001",
      "team:KT-DEC-0001",
    ]);

    // v2.0-rc.7 T9: symmetric output — every response carries a
    // selection_token and the `candidates_full_content` field is gone.
    expect(result.selection_token).toEqual(expect.any(String));
    expect(result).not.toHaveProperty("candidates_full_content");

    expect((await readEventLedger(projectRoot, { event_type: "knowledge_context_planned" })).events).toEqual([
      expect.objectContaining({
        event_type: "knowledge_context_planned",
        target_paths: ["src/index.ts"],
        correlation_id: "corr-plan",
        session_id: "session-plan",
      }),
    ]);
  });

  it("marks the response stale when the client hash does not match the current revision", async () => {
    const projectRoot = await createTeamProject();
    // No store entries seeded → empty corpus, deterministic revision.
    mountStores();

    const result = await planContext(projectRoot, {
      paths: ["src/index.ts"],
      client_hash: "rev-old",
    });

    // Empty read-set corpus → computeReadSetRevision is a deterministic hash. We
    // don't pin the literal — just the staleness contract: a client_hash that
    // does not match the current revision flips `stale: true`.
    expect(result.revision_hash).toEqual(expect.any(String));
    expect(result.revision_hash).not.toBe("rev-old");
    expect(result.stale).toBe(true);
    expect(result.entries).toEqual([
      {
        path: "src/index.ts",
        requirement_profile: expect.objectContaining({ target_path: "src/index.ts" }),
      },
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.preflight_diagnostics).toEqual([]);
    // v2.0-rc.7 T9: symmetric output — selection_token issued even for an
    // empty candidate set; candidates_full_content field is gone.
    expect(result.selection_token).toEqual(expect.any(String));
    expect(result).not.toHaveProperty("candidates_full_content");
  });

  // ---------------------------------------------------------------------------
  // knowledge-field passthrough — type/maturity/layer surface on description.*
  // ---------------------------------------------------------------------------

  it("passes_through_knowledge_fields_to_candidates — type/maturity/layer on description", async () => {
    const projectRoot = await createTeamProject();
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-0001",
      summary: "Team JWT decision",
      maturity: "verified",
      layer: "team",
    });
    await writeStoreEntry(PERSONAL_STORE, "guidelines", {
      id: "KP-GLD-0001",
      type: "guideline",
      summary: "Personal coding style",
      maturity: "draft",
      layer: "personal",
    });
    mountStores({ personal: true });

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const indexById = new Map(result.candidates.map((item) => [item.stable_id, item] as const));

    // v2.0.0-rc.38 UX-3: type/maturity/layer live only on description.*.
    expect(indexById.get("team:KT-DEC-0001")?.description).toMatchObject({
      knowledge_type: "decisions",
      maturity: "verified",
      knowledge_layer: "team",
    });
    expect(indexById.get("team:KT-DEC-0001")).not.toHaveProperty("type");
    expect(indexById.get("team:KT-DEC-0001")).not.toHaveProperty("layer");

    expect(indexById.get("personal:KP-GLD-0001")?.description).toMatchObject({
      knowledge_type: "guidelines",
      maturity: "draft",
      knowledge_layer: "personal",
    });
  });

  // F54 (ISS-20260531-090): layer_filter narrows the candidate corpus by layer.
  // The team store backs `team`; the implicit personal store backs `personal`.
  async function seedDualLayerProject(): Promise<string> {
    const projectRoot = await createTeamProject();
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-0001",
      summary: "Team JWT decision",
      maturity: "draft",
      layer: "team",
    });
    await writeStoreEntry(PERSONAL_STORE, "guidelines", {
      id: "KP-GLD-0001",
      type: "guideline",
      summary: "Personal coding style",
      maturity: "draft",
      layer: "personal",
    });
    mountStores({ personal: true });
    return projectRoot;
  }

  it("layer_filter=team surfaces only team candidates, dropping personal (KP-*)", async () => {
    const projectRoot = await seedDualLayerProject();
    const result = await planContext(projectRoot, { paths: ["src/index.ts"], layer_filter: "team" });
    const ids = result.candidates.map((c) => c.stable_id);
    expect(ids).toContain("team:KT-DEC-0001");
    expect(ids).not.toContain("personal:KP-GLD-0001");
  });

  it("layer_filter=personal surfaces only personal candidates, dropping team (KT-*)", async () => {
    const projectRoot = await seedDualLayerProject();
    const result = await planContext(projectRoot, { paths: ["src/index.ts"], layer_filter: "personal" });
    const ids = result.candidates.map((c) => c.stable_id);
    expect(ids).toContain("personal:KP-GLD-0001");
    expect(ids).not.toContain("team:KT-DEC-0001");
  });

  it("layer_filter omitted (default both) surfaces every layer", async () => {
    const projectRoot = await seedDualLayerProject();
    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);
    expect(ids).toContain("team:KT-DEC-0001");
    expect(ids).toContain("personal:KP-GLD-0001");
  });

  // ---------------------------------------------------------------------------
  // v2.0-rc.7 T9: symmetric output across all candidate counts —
  // candidates + selection_token, no candidates_full_content.
  // ---------------------------------------------------------------------------

  it("test_plan_context_symmetric_small_set — 5 entries return candidates + selection_token (no inline bodies)", async () => {
    const projectRoot = await createTeamProject();
    for (let i = 0; i < 5; i += 1) {
      const id = `KT-DEC-${String(i + 1).padStart(4, "0")}`;
      await writeStoreEntry(TEAM_STORE, "decisions", {
        id,
        summary: `Decision ${i + 1}`,
        maturity: "verified",
      });
    }
    mountStores();

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    expect(result.selection_token).toEqual(expect.any(String));
    expect(result.candidates).toHaveLength(5);
    // Negative assertion: degenerate-mode field is gone from the response.
    expect(result).not.toHaveProperty("candidates_full_content");
  });

  it("test_plan_context_symmetric_large_set — 100 entries cap to top_k with omitted count", async () => {
    const projectRoot = await createTeamProject();
    for (let i = 0; i < 100; i += 1) {
      const id = `KT-DEC-${String(i + 1).padStart(4, "0")}`;
      await writeStoreEntry(TEAM_STORE, "decisions", {
        id,
        summary: `Decision ${i + 1}`,
        maturity: "verified",
      });
    }
    mountStores();

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    // Shape symmetry (selection_token present, no inline candidates_full_content)
    // holds regardless of corpus size — that is what this test guards.
    expect(result.selection_token).toEqual(expect.any(String));
    expect(result).not.toHaveProperty("candidates_full_content");
    // v2.2 A-INFRA-3 (W1-T3-TOPK): the candidate COUNT is now bounded by the
    // default top_k (24). The other 76 are dropped (least content-relevant
    // first — here no query, so the alphabetic tail) and the omitted count is
    // surfaced so the cap is not silent.
    expect(result.candidates).toHaveLength(24);
    expect(result.omitted_candidate_count).toBe(76);
  });

  // ---------------------------------------------------------------------------
  // v2.0-rc.5 C3 (TASK-012) → Wave A1: server returns ALL candidates regardless
  // of relevance_scope/relevance_paths match — the LLM decides via descriptions.
  // ---------------------------------------------------------------------------

  async function seedRelevanceRegistry(): Promise<string> {
    const projectRoot = await createTeamProject();
    await writeStoreEntry(TEAM_STORE, "guidelines", {
      id: "KT-GLD-0001",
      type: "guideline",
      summary: "Broad cross-cutting guideline",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    await writeStoreEntry(TEAM_STORE, "guidelines", {
      id: "KT-GLD-0002",
      type: "guideline",
      summary: "Narrow UI guideline",
      maturity: "verified",
      relevance_scope: "narrow",
      relevance_paths: ["src/ui/**", "packages/ui/"],
    });
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-0001",
      summary: "Narrow auth decision",
      maturity: "verified",
      relevance_scope: "narrow",
      relevance_paths: ["src/auth/**"],
    });
    mountStores();
    return projectRoot;
  }

  it("test_plan_context_returns_all_even_unrelated_path — Wave A1: unrelated path still returns ALL entries (no filter)", async () => {
    const projectRoot = await seedRelevanceRegistry();

    const result = await planContext(projectRoot, {
      paths: ["src/unrelated/index.ts"],
      target_paths: ["src/unrelated/index.ts"],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    expect(ids).toEqual(["team:KT-DEC-0001", "team:KT-GLD-0001", "team:KT-GLD-0002"]);
  });

  it("test_plan_context_returns_all_for_ui_path — Wave A1: src/ui path still returns ALL entries (broad + both narrows)", async () => {
    const projectRoot = await seedRelevanceRegistry();

    const result = await planContext(projectRoot, {
      paths: ["src/ui/Button.tsx"],
      target_paths: ["src/ui/Button.tsx"],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    // Wave A1: server returns ALL candidates with descriptions; LLM picks.
    expect(ids).toEqual(["team:KT-DEC-0001", "team:KT-GLD-0001", "team:KT-GLD-0002"]);
  });

  it("test_plan_context_no_narrow_filter — Wave A1: server returns ALL candidates regardless of relevance_scope/relevance_paths match", async () => {
    const projectRoot = await seedRelevanceRegistry();

    const result = await planContext(projectRoot, {
      paths: ["src/auth/login.ts"],
      target_paths: ["src/auth/login.ts"],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    // Wave A1 (per KB [[no-server-side-kb-filter]]): no server-side relevance
    // filter — broad + ALL narrow entries returned, LLM picks via descriptions.
    expect(ids).toEqual(["team:KT-DEC-0001", "team:KT-GLD-0001", "team:KT-GLD-0002"]);
  });

  it("test_plan_context_no_paths_returns_all — empty target_paths fails open (narrow included)", async () => {
    const projectRoot = await seedRelevanceRegistry();

    const result = await planContext(projectRoot, {
      paths: ["**"],
      target_paths: [],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    expect(ids).toEqual(["team:KT-DEC-0001", "team:KT-GLD-0001", "team:KT-GLD-0002"]);
  });

  it("test_plan_context_returns_all_for_dir_anchored_path — Wave A1: dir-anchored path still returns ALL entries", async () => {
    const projectRoot = await seedRelevanceRegistry();

    const result = await planContext(projectRoot, {
      paths: ["packages/ui/Card.tsx"],
      target_paths: ["packages/ui/Card.tsx"],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    expect(ids).toEqual(["team:KT-DEC-0001", "team:KT-GLD-0001", "team:KT-GLD-0002"]);
  });

  it("test_plan_context_drops_cocos_fields — output schema lacks Cocos + L0/L1/L2 ceremony fields", async () => {
    const projectRoot = await createTeamProject();
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-0001",
      summary: "G",
      maturity: "verified",
    });
    mountStores();

    // Use a Cocos-flavored path + Chinese performance intent to confirm
    // neither triggers the (removed) hardcoded inference.
    const result = await planContext(projectRoot, {
      paths: ["assets/scripts/ui/BattleView.ts"],
      intent: "性能 drawcall 优化",
    });

    const entry = result.entries[0];
    expect(entry?.requirement_profile).not.toHaveProperty("inferred_domain");
    expect(entry?.requirement_profile).not.toHaveProperty("intent_tokens");
    expect(entry?.requirement_profile).not.toHaveProperty("impact_hints");
    expect(entry).not.toHaveProperty("selection_policy");
    expect(entry).not.toHaveProperty("required_stable_ids");
    expect(entry).not.toHaveProperty("ai_selectable_stable_ids");
    expect(entry).not.toHaveProperty("initial_selected_stable_ids");
    expect(result).not.toHaveProperty("required_stable_ids");
    expect(result).not.toHaveProperty("ai_selectable_stable_ids");
  });

  it("steady-state response omits auto_healed / previous_revision_hash (auto-heal retired)", async () => {
    const projectRoot = await createTeamProject();
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-0001",
      summary: "Foo",
    });
    mountStores();

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    // v2.2 W5 R1: the auto_healed / previous_revision_hash pair was tied to the
    // co-location loadActiveMetaOrStale auto-heal, which is retired. Store-backed
    // recall reads frontmatter live, so these fields are never emitted now.
    expect(result.auto_healed).toBeUndefined();
    expect(result.previous_revision_hash).toBeUndefined();
    // stale stays false on the steady-state path — no client_hash was sent.
    expect(result.stale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.27 TASK-002 (audit §2.22): path traversal sandbox at planContext
// entry. The MCP layer is trusted but a misconfigured skill prompt that
// emits "../../../etc/passwd" must not silently land in downstream path
// matching.
// ---------------------------------------------------------------------------

describe("planContext path sandbox (TASK-002 / audit §2.22)", () => {
  it("rejects absolute paths in input.paths", async () => {
    const projectRoot = await createProject({});
    await expect(
      planContext(projectRoot, { paths: ["/etc/passwd"] }),
    ).rejects.toThrow(/absolute paths are not allowed/u);
  });

  it("rejects `..` traversal in input.paths", async () => {
    const projectRoot = await createProject({});
    await expect(
      planContext(projectRoot, { paths: ["../../../etc/passwd"] }),
    ).rejects.toThrow(/traversal is not allowed/u);
  });

  it("rejects `~/` shell sigil in input.paths", async () => {
    const projectRoot = await createProject({});
    await expect(
      planContext(projectRoot, { paths: ["~/.ssh/id_rsa"] }),
    ).rejects.toThrow(/shell sigil/u);
  });

  it("rejects `..` traversal in input.target_paths", async () => {
    const projectRoot = await createProject({});
    await expect(
      planContext(projectRoot, {
        paths: ["src/index.ts"],
        target_paths: ["../../../etc/hosts"],
      }),
    ).rejects.toThrow(/traversal is not allowed/u);
  });

  it("accepts the `**` global sentinel without throwing", async () => {
    const projectRoot = await createProject({});
    const result = await planContext(projectRoot, { paths: ["**"] });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.path).toBe("**");
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.38 UX-2 (fold ②): empty-shell suppression — now over store entries.
// ---------------------------------------------------------------------------

describe("planContext empty-shell suppression (UX-2)", () => {
  it("drops signal-less shells from candidates and surfaces them via empty_shell_suppressed", async () => {
    const projectRoot = await createTeamProject();
    // A real decision with selection signal.
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-0001",
      summary: "A real decision with signal",
      maturity: "proven",
      intent_clues: ["when wiring auth"],
    });
    // Empty shell: summary === store-qualified stable_id, all signal arrays empty.
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-9001",
      summary: "team:KT-DEC-9001",
      maturity: "draft",
    });
    mountStores();

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    const ids = result.candidates.map((item) => item.stable_id);
    expect(ids).toContain("team:KT-DEC-0001");
    expect(ids).not.toContain("team:KT-DEC-9001");

    const suppressed = result.preflight_diagnostics.find((d) => d.code === "empty_shell_suppressed");
    expect(suppressed).toBeDefined();
    expect(suppressed?.stable_ids).toContain("team:KT-DEC-9001");
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.38 UX-1 / UX-4 (fold ①): payload no longer scales per-path, and a
// realistic single-path payload stays well under the 4000-token budget
// (G-MCP-PAYLOAD).
// ---------------------------------------------------------------------------

describe("planContext payload size (UX-1/UX-4 regression)", () => {
  async function seedRealisticRegistry(count: number): Promise<string> {
    const projectRoot = await createTeamProject();
    for (let i = 0; i < count; i += 1) {
      const id = `KT-DEC-${String(i + 1).padStart(4, "0")}`;
      await writeStoreEntry(TEAM_STORE, "decisions", {
        id,
        summary: `Decision ${i + 1}: a representative architecture decision with a realistic summary length`,
        maturity: "proven",
        intent_clues: ["when touching the relevant module"],
        tech_stack: ["TypeScript"],
        impact: ["affects downstream consumers"],
      });
    }
    mountStores();
    return projectRoot;
  }

  it("single-path payload stays under the 4000-token budget (~25 typical entries)", async () => {
    const projectRoot = await seedRealisticRegistry(25);

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const serialized = JSON.stringify(result);
    // char/4 token proxy — conservative for dense JSON.
    const approxTokens = Math.ceil(serialized.length / 4);
    expect(approxTokens).toBeLessThanOrEqual(4000);
  });

  it("payload does not scale per-path (fold ① — N paths != N copies of candidates)", async () => {
    const projectRoot = await seedRealisticRegistry(25);

    const one = JSON.stringify(await planContext(projectRoot, { paths: ["src/a.ts"] })).length;
    const ten = JSON.stringify(
      await planContext(projectRoot, {
        paths: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts", "src/g.ts", "src/h.ts", "src/i.ts", "src/j.ts"],
      }),
    ).length;
    // 10 paths add only ~10 small requirement_profile objects, NOT 10 extra
    // copies of the candidate index. Pre-fold this ratio was ~10x.
    expect(ten).toBeLessThan(one * 1.5);
  });

  it("payload trimming happens before selection token ids are cached", async () => {
    const projectRoot = await createTeamProject();
    const longSummary = "Payload budget regression entry ".repeat(50);
    for (let i = 0; i < 4; i += 1) {
      await writeStoreEntry(TEAM_STORE, "decisions", {
        id: `KT-DEC-8${String(i).padStart(3, "0")}`,
        summary: `${longSummary}${i}`,
        maturity: "proven",
      });
    }
    mountStores();

    const result = await planContext(projectRoot, {
      paths: ["src/index.ts"],
      payload_budget: {
        limits: { warnBytes: 1200, hardBytes: 2600 },
        warnings: [],
        trim_warning: {
          code: "mcp_payload_trimmed",
          file: "<response>",
          action_hint: "trimmed for test",
        },
      },
    });

    expect(result.payload_trimmed).toBe(true);
    expect(result.candidates.length).toBeLessThan(4);
    expect(result.omitted_candidate_count).toBeGreaterThan(0);

    const token = readSelectionToken(result.selection_token);
    expect(token?.ai_selectable_stable_ids).toEqual(
      result.candidates.map((item) => item.stable_id),
    );
  });
});

// v2.2 A-INFRA-1 (W1-T2-BM25): content-relevance ranking. Seeds two entries
// with disjoint vocabularies and asserts that a caller intent matching one
// floats it above the other — and that, absent any intent, the ordering falls
// back to the pre-BM25 stable_id sort (backward compatibility).
describe("planContext BM25 content ranking (W1-T2)", () => {
  async function seedTwoTopicRegistry(): Promise<string> {
    const projectRoot = await createTeamProject();
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-9001",
      summary: "Vector embedding semantic retrieval over the knowledge base",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-9002",
      summary: "Git lifecycle archive cadence deprecation nudge",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    mountStores();
    return projectRoot;
  }

  it("floats the content-matching entry to the top when intent is supplied", async () => {
    const projectRoot = await seedTwoTopicRegistry();

    const result = await planContext(projectRoot, {
      paths: ["src/retrieval.ts"],
      intent: "add vector embedding semantic search",
    });

    // BM25 ranks the vector entry first despite KT-DEC-9002 sorting earlier
    // alphabetically — content relevance leads.
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["team:KT-DEC-9001", "team:KT-DEC-9002"]);
  });

  it("falls back to stable_id order when no intent is supplied (BM25 disabled)", async () => {
    const projectRoot = await seedTwoTopicRegistry();

    const result = await planContext(projectRoot, { paths: ["src/retrieval.ts"] });

    // No query terms → BM25 contributes 0 → both entries tie on content and
    // the alphabetic stable_id tiebreaker restores deterministic order.
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["team:KT-DEC-9001", "team:KT-DEC-9002"]);
  });

  it("ranks the archive entry first when the intent matches it instead", async () => {
    const projectRoot = await seedTwoTopicRegistry();

    const result = await planContext(projectRoot, {
      paths: ["src/lifecycle.ts"],
      intent: "git archive deprecation cadence",
    });

    expect(result.candidates.map((item) => item.stable_id)).toEqual(["team:KT-DEC-9002", "team:KT-DEC-9001"]);
  });
});

// v2.2 A-INFRA-3 (W1-T3-TOPK): bounded top_k truncation applied AFTER BM25
// ranking. Seeds three entries, caps to two via plan_context_top_k, and asserts
// the dropped entry is the least content-relevant one (not an alphabetic tail)
// and that the omitted count is surfaced.
describe("planContext top_k truncation (W1-T3)", () => {
  async function seedThreeTopicRegistry(topK?: number): Promise<string> {
    const projectRoot = await createTeamProject();
    if (topK !== undefined) {
      await writeFile(
        join(projectRoot, "fabric.config.json"),
        `${JSON.stringify({ plan_context_top_k: topK }, null, 2)}\n`,
      );
    }
    const topics: Array<[string, string]> = [
      ["KT-DEC-9101", "Vector embedding semantic retrieval over the knowledge base"],
      ["KT-DEC-9102", "BM25 content relevance scoring tokenization"],
      ["KT-DEC-9103", "Git lifecycle archive cadence deprecation nudge"],
    ];
    for (const [id, summary] of topics) {
      await writeStoreEntry(TEAM_STORE, "decisions", {
        id,
        summary,
        maturity: "verified",
        relevance_scope: "broad",
        relevance_paths: [],
      });
    }
    mountStores();
    return projectRoot;
  }

  it("caps candidates to plan_context_top_k after BM25 ranking and surfaces the omitted count", async () => {
    const projectRoot = await seedThreeTopicRegistry(2);

    const result = await planContext(projectRoot, {
      paths: ["src/retrieval.ts"],
      intent: "vector embedding bm25 retrieval scoring",
    });

    // top_k=2 from three entries → one dropped. The dropped entry is the
    // archive one (no overlap with the intent), so the two retrieval-relevant
    // entries survive.
    expect(result.candidates).toHaveLength(2);
    expect(result.omitted_candidate_count).toBe(1);
    const ids = result.candidates.map((item) => item.stable_id);
    expect(ids).toContain("team:KT-DEC-9101");
    expect(ids).toContain("team:KT-DEC-9102");
    expect(ids).not.toContain("team:KT-DEC-9103");
  });

  it("omits the count field entirely when nothing is truncated", async () => {
    const projectRoot = await seedThreeTopicRegistry(); // no cap → default 24 > 3

    const result = await planContext(projectRoot, { paths: ["src/retrieval.ts"] });

    expect(result.candidates).toHaveLength(3);
    expect(result).not.toHaveProperty("omitted_candidate_count");
  });
});

// v2.2 C3-salience (W2-T1): maturity as the finest tie-breaker. Asserts both
// directions: (1) among equally-relevant entries, higher maturity floats up;
// (2) the load-bearing invariant — a high-maturity entry that does NOT match
// the intent never outranks a low-maturity entry that DOES (content leads).
describe("planContext salience tie-breaker (W2-T1)", () => {
  async function seedMaturityRegistry(
    entries: Array<{ id: string; summary: string; maturity: "draft" | "verified" | "proven" }>,
  ): Promise<string> {
    const projectRoot = await createTeamProject();
    for (const e of entries) {
      await writeStoreEntry(TEAM_STORE, "decisions", {
        id: e.id,
        summary: e.summary,
        maturity: e.maturity,
        relevance_scope: "broad",
        relevance_paths: [],
      });
    }
    mountStores();
    return projectRoot;
  }

  it("floats higher maturity up among entries with identical content relevance", async () => {
    // Same summary text → identical BM25 + locality; only maturity differs.
    const projectRoot = await seedMaturityRegistry([
      { id: "KT-DEC-7001", summary: "Shared lifecycle governance topic", maturity: "draft" },
      { id: "KT-DEC-7002", summary: "Shared lifecycle governance topic", maturity: "proven" },
      { id: "KT-DEC-7003", summary: "Shared lifecycle governance topic", maturity: "verified" },
    ]);

    const result = await planContext(projectRoot, { paths: ["src/x.ts"] });

    // proven (15) > verified (8) > draft (0).
    expect(result.candidates.map((item) => item.stable_id)).toEqual([
      "team:KT-DEC-7002",
      "team:KT-DEC-7003",
      "team:KT-DEC-7001",
    ]);
  });

  it("never lets high maturity override content relevance (防高成熟低相关压过正文)", async () => {
    const projectRoot = await seedMaturityRegistry([
      // draft but matches the intent
      { id: "KT-DEC-7101", summary: "Vector embedding semantic retrieval", maturity: "draft" },
      // proven but unrelated to the intent
      { id: "KT-DEC-7102", summary: "Git archive deprecation cadence", maturity: "proven" },
    ]);

    const result = await planContext(projectRoot, {
      paths: ["src/retrieval.ts"],
      intent: "vector embedding semantic search",
    });

    // The draft content-match outranks the proven non-match: BM25 (~50+/term)
    // dwarfs the 15-point salience gap.
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["team:KT-DEC-7101", "team:KT-DEC-7102"]);
  });
});

// v2.2 C2-vector (W2-T7): optional vector semantic supplement. Default OFF →
// no-op (covered implicitly by every other test). Here we enable it with an
// injected fake embedder and assert it re-ranks where BM25 is silent.
describe("planContext vector semantic supplement (W2-T7)", () => {
  // Toy deterministic embedder: vector = [length, #a, #b]. Lets a query rich in
  // 'a' score an 'a'-heavy document above a 'b'-heavy one.
  const fakeEmbedder = {
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => [t.length, (t.match(/a/g) ?? []).length, (t.match(/b/g) ?? []).length]);
    },
  };

  async function seedTwoOpaqueEntries(): Promise<string> {
    const projectRoot = await createTeamProject();
    // KT-DEC-9301 (b-heavy) sorts FIRST alphabetically; KT-DEC-9302 (a-heavy) second.
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-9301",
      summary: "bbbb bottle buzz",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-9302",
      summary: "aaaa apple aardvark",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    mountStores();
    return projectRoot;
  }

  it("re-ranks by vector similarity when embeddings are enabled (BM25 silent)", async () => {
    const { __resetEmbedderForTesting } = await import("./vector-retrieval.js");
    __resetEmbedderForTesting(fakeEmbedder);
    try {
      const projectRoot = await seedTwoOpaqueEntries();
      // embed_weight defaults to 30 (≤49 cap). BM25 is 0 for both candidates
      // (no shared token), so any positive vector weight is the deciding signal.
      await writeFile(join(projectRoot, "fabric.config.json"), `${JSON.stringify({ embed_enabled: true })}\n`);

      // Query is 'a'-heavy and shares no lexical token with either summary, so
      // BM25 is 0 for both — the vector supplement is the deciding signal.
      const result = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "aaaaaa" });

      // The 'a'-heavy entry (alphabetically SECOND) floats to the top via vectors.
      expect(result.candidates.map((c) => c.stable_id)).toEqual(["team:KT-DEC-9302", "team:KT-DEC-9301"]);
    } finally {
      __resetEmbedderForTesting(undefined);
    }
  });

  it("falls back to text-only order when embeddings stay disabled", async () => {
    const { __resetEmbedderForTesting } = await import("./vector-retrieval.js");
    __resetEmbedderForTesting(fakeEmbedder); // available, but config keeps it OFF
    try {
      const projectRoot = await seedTwoOpaqueEntries();
      // No embed_enabled → vector path never runs → alphabetic stable_id order.
      const result = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "aaaaaa" });
      expect(result.candidates.map((c) => c.stable_id)).toEqual(["team:KT-DEC-9301", "team:KT-DEC-9302"]);
    } finally {
      __resetEmbedderForTesting(undefined);
    }
  });
});

// v2.2 W3-REVIEW (codex MED-1): scoring calibration lock. The additive score is
// deliberately BM25-LED — a strong content match outranks a perfect structural
// (locality) match. This test pins that design intent so a future weight tweak
// that accidentally lets locality/recency/salience trample content is caught.
describe("planContext scoring calibration — BM25 leads (W3-REVIEW)", () => {
  it("a strong multi-term content match outranks a perfect-locality non-match", async () => {
    const projectRoot = await createTeamProject();
    // CONTENT: matches the rare query terms, but NO locality (no relevance_paths).
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8001",
      summary: "zephyr quokka nimbus retrieval",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    // LOCALITY: perfect same-file locality but ZERO content overlap with the query.
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8002",
      summary: "unrelated bottle topic",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: ["src/target.ts"],
    });
    mountStores();

    const result = await planContext(projectRoot, {
      paths: ["src/target.ts"],
      target_paths: ["src/target.ts"],
      intent: "zephyr quokka nimbus",
    });

    // Content match (BM25 ~3 rare terms × 50) beats perfect same-file locality (100).
    expect(result.candidates.map((c) => c.stable_id)).toEqual(["team:KT-DEC-8001", "team:KT-DEC-8002"]);
  });
});

// W4-02 (ISS-024): the BM25 model is corpus-keyed (read-set revision) and reused
// across queries — repeated query-bearing recalls over the same KB must NOT
// re-tokenize + re-index the whole corpus.
describe("planContext BM25 model cache (ISS-024)", () => {
  // `marker` varies the KB content so two projects produce DIFFERENT
  // computeReadSetRevision fingerprints.
  async function seedQueryableProject(marker: string, storeUuid: string): Promise<string> {
    const projectRoot = await createTeamProject();
    const summaryA = `zephyr quokka nimbus retrieval ${marker}`;
    await writeStoreEntry(storeUuid, "decisions", {
      id: "KT-DEC-7001",
      summary: summaryA,
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    await writeStoreEntry(storeUuid, "decisions", {
      id: "KT-DEC-7002",
      summary: "unrelated bottle topic widget",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: storeUuid, alias: "team", remote: "git@e:team.git" }],
    });
    return projectRoot;
  }

  it("builds the model once across multiple query-bearing calls over the same KB", async () => {
    __resetBm25Cache();
    const projectRoot = await seedQueryableProject("same", TEAM_STORE);

    const r1 = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "zephyr quokka" });
    const r2 = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "nimbus retrieval bottle" });

    // Different intents → contextCache misses → both reach the ranker, but the
    // corpus (and thus the BM25 model) is identical → built exactly once.
    expect(__bm25CacheStats().builds).toBe(1);
    // Content-relevant entry still ranks first for both queries (correctness).
    expect(r1.candidates[0]?.stable_id).toBe("team:KT-DEC-7001");
    expect(r2.candidates.map((c) => c.stable_id).sort()).toEqual(["team:KT-DEC-7001", "team:KT-DEC-7002"]);
  });

  it("rebuilds when the corpus revision changes", async () => {
    __resetBm25Cache();
    const p1 = await seedQueryableProject("alpha", TEAM_STORE);
    await planContext(p1, { paths: ["src/x.ts"], intent: "zephyr" });
    expect(__bm25CacheStats().builds).toBe(1);

    // Distinct content under a DIFFERENT store uuid (the prior store still lives
    // in the shared fake home) → different read-set revision → rebuild.
    const p2 = await seedQueryableProject("beta-distinct-content", PERSONAL_STORE);
    await planContext(p2, { paths: ["src/x.ts"], intent: "zephyr" });
    expect(__bm25CacheStats().builds).toBe(2);
  });
});

// lifecycle-refactor W3-T2 (§7 图谱消费 / §5 hook 沿 related 二阶召回): planContext
// include_related二阶召回. Seeds a store where a high-ranking entry declares a
// `related` edge (store-qualified) to a low-ranking neighbour that top_k would
// drop; asserts the neighbour is pulled back in + provenance is reported, and the
// graph-empty path stays an honest no-op.
describe("planContext include_related graph二阶召回 (W3-T2)", () => {
  async function seedRelatedRegistry(
    opts: { topK?: number; withEdge?: boolean; edgeId?: string } = {},
  ): Promise<string> {
    const withEdge = opts.withEdge !== false;
    const edgeId = opts.edgeId ?? "team:KT-DEC-9202";
    const projectRoot = await createTeamProject();
    if (opts.topK !== undefined) {
      await writeFile(
        join(projectRoot, "fabric.config.json"),
        `${JSON.stringify({ plan_context_top_k: opts.topK }, null, 2)}\n`,
      );
    }
    // KT-DEC-9201: strongly matches the intent (ranks top). KT-DEC-9202: the
    // neighbour, irrelevant to the intent (ranks last → dropped by topK=1).
    // The `related` edge is store-qualified to match the candidate's qualified id.
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-9201",
      summary: "Authentication token refresh rotation strategy decision",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
      ...(withEdge ? { related: [edgeId] } : {}),
    });
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-9202",
      summary: "Palette gradient swatch tints for marketing brochures",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    mountStores();
    return projectRoot;
  }

  it("appends the one-hop related neighbour dropped by top_k and reports provenance", async () => {
    const projectRoot = await seedRelatedRegistry({ topK: 1, withEdge: true });

    // top_k=1 → only the auth decision survives ranking; its `related` edge to the
    // colors decision pulls that neighbour back in despite ranking last.
    const result = await planContext(projectRoot, {
      paths: ["src/auth.ts"],
      intent: "authentication token refresh rotation",
      include_related: true,
    });

    const ids = result.candidates.map((c) => c.stable_id);
    expect(ids).toContain("team:KT-DEC-9201"); // surfaced by ranking
    expect(ids).toContain("team:KT-DEC-9202"); // pulled in via related二阶
    expect(result.related_appended).toEqual({ "team:KT-DEC-9202": "team:KT-DEC-9201" });
  });

  it("also resolves bare local related ids against store-qualified candidates", async () => {
    const projectRoot = await seedRelatedRegistry({ topK: 1, edgeId: "KT-DEC-9202" });

    const result = await planContext(projectRoot, {
      paths: ["src/auth.ts"],
      intent: "authentication token refresh rotation",
      include_related: true,
    });

    expect(result.candidates.map((c) => c.stable_id)).toContain("team:KT-DEC-9202");
    expect(result.related_appended).toEqual({ "team:KT-DEC-9202": "team:KT-DEC-9201" });
  });

  it("graph-empty honest no-op: no related edge → no append, field omitted", async () => {
    const projectRoot = await seedRelatedRegistry({ topK: 1, withEdge: false });

    const result = await planContext(projectRoot, {
      paths: ["src/auth.ts"],
      intent: "authentication token refresh rotation",
      include_related: true,
    });

    // top_k=1 + no related edge → only the top-ranked entry, no fake graph append.
    expect(result.candidates.map((c) => c.stable_id)).toEqual(["team:KT-DEC-9201"]);
    expect(result).not.toHaveProperty("related_appended");
  });

  it("include_related off (default) never appends — byte-identical to pre-W3-T2", async () => {
    const projectRoot = await seedRelatedRegistry({ topK: 1, withEdge: true });

    const result = await planContext(projectRoot, {
      paths: ["src/auth.ts"],
      intent: "authentication token refresh rotation",
    });

    expect(result.candidates.map((c) => c.stable_id)).toEqual(["team:KT-DEC-9201"]);
    expect(result).not.toHaveProperty("related_appended");
  });
});
