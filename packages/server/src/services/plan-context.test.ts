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
  // Two-layer layout: the seed dir must match the store's MOUNTED group. Defaults
  // to the personal store uuid, but seedQueryableProject mounts PERSONAL_STORE as
  // a team store (it just reuses the uuid to force a corpus change) → pass false.
  personal: boolean = storeUuid === PERSONAL_STORE,
): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: storeUuid, personal }),
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
      known_tech: ["TypeScript"],
      detected_entities: ["Renderer"],
    });
    // ④ payload de-dup: user_intent was echoed verbatim into EVERY per-path
    // requirement_profile (N paths → N copies of the same intent string). Lifted
    // to a single top-level `intent` echo; per-entry profile no longer carries it.
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("user_intent");
    expect(result.intent).toBe("rendering tweak");
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
    // The intent "rendering tweak" matches the "UI batch rendering" guideline via
    // BM25; the unrelated "Global protocol" decision scores below the KT-DEC-0038
    // ratio-to-top floor (0.25 × top) and is dropped (content leads). Ids are
    // store-qualified.
    expect(index.map((item) => item.stable_id)).toEqual([
      "team:KT-GLD-0001",
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
    // K6: the 76 dropped are reported as structured dropped[]{id,reason}; with no
    // payload_budget every drop is a retrieval_budget (top_k cap) omission.
    expect(result.dropped).toHaveLength(76);
    expect(result.dropped?.every((d) => d.reason === "retrieval_budget")).toBe(true);
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

  it("rejects Windows drive-letter absolute paths", async () => {
    const projectRoot = await createProject({});
    await expect(
      planContext(projectRoot, { paths: ["C:\\repo\\src\\x.ts"] }),
    ).rejects.toThrow(/absolute paths are not allowed/u);
    await expect(
      planContext(projectRoot, { target_paths: ["D:/repo/src/x.ts"], paths: ["src/index.ts"] }),
    ).rejects.toThrow(/absolute paths are not allowed/u);
  });

  it("rejects Windows UNC absolute paths", async () => {
    const projectRoot = await createProject({});
    await expect(
      planContext(projectRoot, { paths: ["\\\\server\\share\\repo\\src\\x.ts"] }),
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
    // K6: the payload trim surfaces structured payload_budget drops in dropped[].
    expect((result.dropped ?? []).length).toBeGreaterThan(0);
    expect(result.dropped?.some((d) => d.reason === "payload_budget")).toBe(true);

    const token = readSelectionToken(result.selection_token);
    expect(token?.ai_selectable_stable_ids).toEqual(
      result.candidates.map((item) => item.stable_id),
    );
  });

  // K6 (W3-K) FEEDBACK-LOOP GUARD: a LARGE omission set (50 candidates, a small
  // top_k AND a tight payload_budget) must still trim to a SETTLED result. This
  // is the regression guard for the deferral reason — if the structured
  // dropped[]{id,reason} array leaked into the serialize MEASUREMENT closure it
  // would grow as the trim removed candidates, making the measured payload size
  // non-monotonic and the trim search oscillate (never converge / drop the wrong
  // count). With the numeric dropped_count proxy kept in the closure and the real
  // dropped[] assembled only AFTER the trim settles, the cut is exact and stable:
  // every corpus entry is either surfaced or dropped exactly once, retrieval_budget
  // (top_k cut, constant pre-trim) and payload_budget (post-trim) reasons partition
  // the dropped set, and the two sets are disjoint.
  it("trims a large omission set to a SETTLED result with correct reason counts (no oscillation)", async () => {
    const projectRoot = await createTeamProject({ plan_context_top_k: 8 });
    const longSummary = "Large omission stability corpus entry ".repeat(40);
    const CORPUS = 50;
    for (let i = 0; i < CORPUS; i += 1) {
      await writeStoreEntry(TEAM_STORE, "decisions", {
        id: `KT-DEC-7${String(i).padStart(3, "0")}`,
        summary: `${longSummary}${i}`,
        maturity: "proven",
        relevance_scope: "broad",
        relevance_paths: [],
      });
    }
    mountStores();

    const result = await planContext(projectRoot, {
      paths: ["src/index.ts"],
      // Tight budget so the payload trim fires ON TOP OF the top_k=8 cut — the
      // exact "two cuts compound" scenario the serialize closure must survive.
      payload_budget: {
        limits: { warnBytes: 1500, hardBytes: 3000 },
        warnings: [],
        trim_warning: {
          code: "mcp_payload_trimmed",
          file: "<response>",
          action_hint: "trimmed for test",
        },
      },
    });

    const surfaced = result.candidates.map((item) => item.stable_id);
    const dropped = result.dropped ?? [];

    // The trim SETTLED: a positive, bounded surfaced set (≤ top_k, never empty,
    // never the full corpus — both cuts fired) and a stable dropped tally.
    expect(surfaced.length).toBeGreaterThan(0);
    expect(surfaced.length).toBeLessThanOrEqual(8);
    expect(result.payload_trimmed).toBe(true);

    // Exact partition: every corpus entry is surfaced XOR dropped — no entry is
    // lost, double-counted, or appears in both sets (the oscillation symptom).
    expect(surfaced.length + dropped.length).toBe(CORPUS);
    const surfacedSet = new Set(surfaced);
    expect(dropped.every((d) => !surfacedSet.has(d.id))).toBe(true);
    expect(new Set(dropped.map((d) => d.id)).size).toBe(dropped.length);

    // Both reasons present and partitioning the dropped set: retrieval_budget
    // (the top_k cut, computed once pre-trim) + payload_budget (post-trim).
    const retrievalDrops = dropped.filter((d) => d.reason === "retrieval_budget");
    const payloadDrops = dropped.filter((d) => d.reason === "payload_budget");
    expect(retrievalDrops.length).toBeGreaterThan(0);
    expect(payloadDrops.length).toBeGreaterThan(0);
    expect(retrievalDrops.length + payloadDrops.length).toBe(dropped.length);

    // DETERMINISM (no oscillation across calls): a second identical call yields a
    // byte-identical surfaced set and dropped tally — the trim search converges to
    // the same fixed point, not a flapping one.
    const again = await planContext(projectRoot, {
      paths: ["src/index.ts"],
      payload_budget: {
        limits: { warnBytes: 1500, hardBytes: 3000 },
        warnings: [],
        trim_warning: { code: "mcp_payload_trimmed", file: "<response>", action_hint: "trimmed for test" },
      },
    });
    expect(again.candidates.map((item) => item.stable_id)).toEqual(surfaced);
    expect((again.dropped ?? []).length).toBe(dropped.length);
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

    // BM25 floats the vector entry to the top; the disjoint archive entry scores
    // below the KT-DEC-0038 ratio-to-top floor and is dropped (content leads).
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["team:KT-DEC-9001"]);
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

    // Symmetric to the above: the matching archive entry survives, the disjoint
    // vector entry falls below the KT-DEC-0038 ratio-to-top floor and is dropped.
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["team:KT-DEC-9002"]);
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
        join(projectRoot, ".fabric", "fabric-config.json"),
        `${JSON.stringify({ required_stores: [{ id: "team" }], plan_context_top_k: topK }, null, 2)}\n`,
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
    // K6: the dropped entry is reported as a structured retrieval_budget drop.
    expect(result.dropped).toEqual([
      { id: "team:KT-DEC-9103", reason: "retrieval_budget" },
    ]);
    const ids = result.candidates.map((item) => item.stable_id);
    expect(ids).toContain("team:KT-DEC-9101");
    expect(ids).toContain("team:KT-DEC-9102");
    expect(ids).not.toContain("team:KT-DEC-9103");
  });

  it("omits the count field entirely when nothing is truncated", async () => {
    const projectRoot = await seedThreeTopicRegistry(); // no cap → default 24 > 3

    const result = await planContext(projectRoot, { paths: ["src/retrieval.ts"] });

    expect(result.candidates).toHaveLength(3);
    // K6: nothing truncated → the dropped[] field is omitted entirely.
    expect(result).not.toHaveProperty("dropped");
  });
});

// KT-DEC-0038: ratio-to-top relevance floor. After ranking, recall keeps only
// candidates whose fused score >= α × the top candidate's score (α default 0.25).
// top_k degrades to a pure safety cap; the floor is the primary relevance cut.
// Gated on a query being present so the no-intent broad probe keeps completeness.
describe("planContext ratio-to-top relevance floor (KT-DEC-0038)", () => {
  it("drops a candidate scoring below α × top when an intent is supplied", async () => {
    const projectRoot = await createTeamProject();
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8001",
      summary: "vector embedding semantic retrieval bm25 scoring tokenization",
      maturity: "draft",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8002",
      summary: "git lifecycle archive cadence deprecation nudge",
      maturity: "draft",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    mountStores();

    const result = await planContext(projectRoot, {
      paths: ["src/retrieval.ts"],
      intent: "vector embedding semantic retrieval bm25 scoring",
    });

    // 8001 matches the intent; 8002 is disjoint (draft, no locality/recency →
    // fused score 0) so it falls below 0.25 × top and is dropped. top_k default
    // 24 is never reached — the cut is purely the ratio-to-top floor.
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["team:KT-DEC-8001"]);
    // K6: the ratio-to-top floor cut is a retrieval_budget drop in dropped[].
    expect(result.dropped).toEqual([
      { id: "team:KT-DEC-8002", reason: "retrieval_budget" },
    ]);
  });

  it("top_k stays a pure safety cap when every candidate is equally relevant", async () => {
    // 3 byte-identical proven entries → identical fused score → none below the
    // floor (all == top). With top_k=2 the cap (not the floor) drops exactly one.
    const projectRoot = await createTeamProject({ plan_context_top_k: 2 });
    for (const id of ["KT-DEC-8101", "KT-DEC-8102", "KT-DEC-8103"]) {
      await writeStoreEntry(TEAM_STORE, "decisions", {
        id,
        summary: "vector embedding semantic retrieval",
        maturity: "proven",
        relevance_scope: "broad",
        relevance_paths: [],
      });
    }
    mountStores();

    const result = await planContext(projectRoot, {
      paths: ["src/retrieval.ts"],
      intent: "vector embedding semantic retrieval",
    });

    expect(result.candidates).toHaveLength(2);
    // K6: the top_k safety cap drops exactly one (the stable_id-tiebreak tail) as
    // a retrieval_budget omission.
    expect(result.dropped).toEqual([
      { id: "team:KT-DEC-8103", reason: "retrieval_budget" },
    ]);
  });

  it("keeps every candidate when no intent is supplied (no floor — broad completeness)", async () => {
    // A locality-matching entry and a disjoint one, but NO query: the floor must
    // not fire (KT-DEC-0028 SessionStart completeness / KT-DEC-0019 no-filter).
    const projectRoot = await createTeamProject();
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8201",
      summary: "Local entry",
      maturity: "proven",
      relevance_scope: "broad",
      relevance_paths: ["src/index.ts"],
    });
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8202",
      summary: "Unrelated entry",
      maturity: "draft",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    mountStores();

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    expect(result.candidates.map((item) => item.stable_id).sort()).toEqual([
      "team:KT-DEC-8201",
      "team:KT-DEC-8202",
    ]);
    // K6: no truncation → dropped[] omitted entirely.
    expect(result).not.toHaveProperty("dropped");
  });

  it("recall_relevance_ratio=0 disables the floor (keeps the disjoint candidate)", async () => {
    const projectRoot = await createTeamProject({ recall_relevance_ratio: 0 });
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8301",
      summary: "vector embedding semantic retrieval bm25 scoring",
      maturity: "draft",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8302",
      summary: "git lifecycle archive cadence deprecation nudge",
      maturity: "draft",
      relevance_scope: "broad",
      relevance_paths: [],
    });
    mountStores();

    const result = await planContext(projectRoot, {
      paths: ["src/retrieval.ts"],
      intent: "vector embedding semantic retrieval bm25 scoring",
    });

    // α=0 → no floor → the disjoint entry survives (ranked last, but present).
    expect(result.candidates.map((item) => item.stable_id).sort()).toEqual([
      "team:KT-DEC-8301",
      "team:KT-DEC-8302",
    ]);
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

    // The draft content-match dwarfs the proven non-match: BM25 (~50+/term)
    // overwhelms the 15-point salience gap, AND the proven non-match falls below
    // the KT-DEC-0038 ratio-to-top floor so it is dropped entirely (content leads
    // even harder than a tie-break — a non-match never surfaces over a match).
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["team:KT-DEC-7101"]);
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
      await writeFile(
        join(projectRoot, ".fabric", "fabric-config.json"),
        `${JSON.stringify({ required_stores: [{ id: "team" }], embed_enabled: true }, null, 2)}\n`,
      );

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

  // recency calibration lock: recency is a TIE-BREAK nudge (~same-package tier),
  // NOT able to trample a stronger structural signal. A recently-created entry
  // sitting only in the same PACKAGE must not outrank an old entry that matches
  // the exact target FILE. Pre-fix recency was +100 (== same-file locality), so a
  // burst of recent archives drowned older path-relevant entries; this pins the
  // post-fix calibration where recency can no longer flip that ordering.
  // created_at is computed relative to Date.now() so the test stays hermetic
  // (no fixed near-future date that would stop earning the recency window).
  it("recency is a tie-break nudge, not a trampler — recent same-package loses to old same-file", async () => {
    const projectRoot = await createTeamProject();
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1d ago → recency window
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30d ago → no boost
    // RECENT + same-PACKAGE locality only (+25), no content overlap.
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8101",
      summary: "recent same package",
      maturity: "verified",
      created_at: recent,
      relevance_scope: "broad",
      relevance_paths: ["packages/cli/other/bar.ts"],
    });
    // OLD + same-FILE locality (+100), no content overlap.
    await writeStoreEntry(TEAM_STORE, "decisions", {
      id: "KT-DEC-8102",
      summary: "old same file",
      maturity: "verified",
      created_at: old,
      relevance_scope: "broad",
      relevance_paths: ["packages/cli/src/foo.ts"],
    });
    mountStores();

    // No intent → BM25 off → score = equal salience + recency + locality only.
    const result = await planContext(projectRoot, {
      paths: ["packages/cli/src/foo.ts"],
      target_paths: ["packages/cli/src/foo.ts"],
    });

    // same-file locality (100) must lead same-package (25) + recency nudge (25).
    expect(result.candidates.map((c) => c.stable_id)).toEqual([
      "team:KT-DEC-8102",
      "team:KT-DEC-8101",
    ]);
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
    }, false);
    await writeStoreEntry(storeUuid, "decisions", {
      id: "KT-DEC-7002",
      summary: "unrelated bottle topic widget",
      maturity: "verified",
      relevance_scope: "broad",
      relevance_paths: [],
    }, false);
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

  // P1 recall-engine-refactor (TASK-002): cold-process disk-cache hit. The first
  // call builds + serializes the model to `.fabric/cache/bm25/<revision>.json`.
  // Clearing ONLY the in-memory tier (__resetBm25Cache) simulates a fresh hook
  // process whose memory cache is empty but whose disk cache survives — the
  // second call over the SAME revision must rehydrate from disk and NOT call
  // buildBm25Model again (build counter stays 1).
  it("a cold process hits the disk cache and skips rebuild (same revision)", async () => {
    __resetBm25Cache();
    const projectRoot = await seedQueryableProject("disk-cache", TEAM_STORE);

    const r1 = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "zephyr retrieval" });
    expect(__bm25CacheStats().builds).toBe(1);

    // The disk snapshot is now written. Drop only the memory tier (cold process).
    __resetBm25Cache();
    expect(__bm25CacheStats().builds).toBe(0);

    const r2 = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "zephyr retrieval" });
    // Disk hit → rehydrate, no rebuild.
    expect(__bm25CacheStats().builds).toBe(0);
    // Ranking is unchanged across the disk round-trip (same corpus, same query).
    expect(r2.candidates.map((c) => c.stable_id)).toEqual(r1.candidates.map((c) => c.stable_id));
  });

  it("a cold process with no disk snapshot rebuilds (honest miss)", async () => {
    __resetBm25Cache();
    const projectRoot = await seedQueryableProject("no-disk", TEAM_STORE);
    // First-ever call for this revision: memory miss + disk miss → build.
    await planContext(projectRoot, { paths: ["src/x.ts"], intent: "zephyr" });
    expect(__bm25CacheStats().builds).toBe(1);
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
        join(projectRoot, ".fabric", "fabric-config.json"),
        `${JSON.stringify({ required_stores: [{ id: "team" }], plan_context_top_k: opts.topK }, null, 2)}\n`,
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
