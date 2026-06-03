import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { planContext, __bm25CacheStats, __resetBm25Cache } from "./plan-context.js";
import { contextCache } from "../cache.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

// v2.0.0-rc.22 Scope D T-D2: planContext now routes through
// loadActiveMetaOrStale which calls buildKnowledgeMeta — that scan walks BOTH
// the team root (.fabric/knowledge/) and the personal root
// (~/.fabric/knowledge/). Without FABRIC_HOME isolation the developer's real
// personal knowledge leaks into the fixture's derived meta and corrupts
// description_index assertions. Mirror load-active-meta.test.ts setup.
beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-plan-context-home-"));
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
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("planContext", () => {
  it("returns a neutral requirement profile and a description index sorted by stable_id", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "knowledge", "guidelines"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    // v2.0.0-rc.22 Scope D T-D2: only seed files that have hand-crafted meta
    // nodes — auto-heal would otherwise mint a fresh node (with derived id)
    // for the orphan battle-view.md and pollute the description_index.
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "global.md"), "# Global\n");
    await writeFile(join(projectRoot, ".fabric", "knowledge", "guidelines", "ui.md"), "# UI\n");
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-neutral",
        nodes: {
          "global-protocol": {
            stable_id: "global-protocol",
            file: ".fabric/knowledge/decisions/global.md",
            content_ref: ".fabric/knowledge/decisions/global.md",
            scope_glob: "**",
            hash: "sha256:global",
            description: {
              summary: "Global protocol",
              intent_clues: [],
              tech_stack: ["Fabric"],
              impact: [],
              must_read_if: "before any edit",
            },
          },
          "ui-batch-rendering": {
            stable_id: "ui-batch-rendering",
            file: ".fabric/knowledge/guidelines/ui.md",
            content_ref: ".fabric/knowledge/guidelines/ui.md",
            scope_glob: "**",
            hash: "sha256:ui",
            description: {
              summary: "UI batch rendering",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "when editing UI",
            },
          },
        },
      }, null, 2)}\n`,
    );

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

    // v2.0.0-rc.22 Scope D T-D2: revision_hash is now auto-healed from the
    // on-disk knowledge tree by loadActiveMetaOrStale. The "rev-neutral"
    // sentinel in the seeded meta drifts away the moment buildKnowledgeMeta
    // sees the real .md files, so we assert shape (non-empty string) rather
    // than a literal — the heal pipeline is exercised by the dedicated
    // auto-heal tests below.
    expect(result.revision_hash).toEqual(expect.any(String));
    expect(result.revision_hash.length).toBeGreaterThan(0);
    expect(result.auto_healed).toBe(true);
    expect(result.previous_revision_hash).toBe("rev-neutral");
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
    expect(index.map((item) => item.stable_id)).toEqual(["global-protocol", "ui-batch-rendering"]);

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
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-current",
        nodes: {},
      }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, {
      paths: ["src/index.ts"],
      client_hash: "rev-old",
    });

    // v2.0.0-rc.22 Scope D T-D2: empty knowledge tree → derived meta has
    // nodes:{} and a deterministic revision based on `computeRevision({})`.
    // We don't pin the literal — just verify the staleness contract: a
    // client_hash that does not match the current (post-heal) revision flips
    // `stale: true`.
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
    // empty description_index; candidates_full_content field is gone.
    expect(result.selection_token).toEqual(expect.any(String));
    expect(result).not.toHaveProperty("candidates_full_content");
  });

  // ---------------------------------------------------------------------------
  // v2.0 dual-root knowledge-field passthrough (TASK-005 / TASK-007)
  // ---------------------------------------------------------------------------

  it("passes_through_knowledge_fields_to_description_index — type/maturity/layer + inferred layer fallback", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    // v2.0.0-rc.22 Scope D T-D2: auto-heal now scans the on-disk knowledge
    // tree. Seed the .md files this fixture used to reference only by meta
    // so buildKnowledgeMeta preserves the hand-crafted description blobs via
    // its `...existing?.node` carry-over. The personal entry lives under
    // FABRIC_HOME (set in beforeEach) — its dual-root scan picks it up.
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "knowledge", "pending"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "team-auth.md"),
      [
        "---",
        "summary: Team JWT decision",
        "id: KT-DEC-0001",
        "type: decision",
        "maturity: verified",
        "layer: team",
        "layer_reason: shared across services",
        "---",
        "# Team JWT decision",
        "",
      ].join("\n"),
    );
    // legacy.md intentionally has NO frontmatter — exercises the heading-only
    // fallback path where extractRuleDescription synthesizes a description
    // with type=undefined / maturity=undefined / layer=undefined.
    await writeFile(join(projectRoot, ".fabric", "knowledge", "pending", "legacy.md"), "# Legacy v1.x entry\n");
    const fakeHome = process.env.FABRIC_HOME!;
    await mkdir(join(fakeHome, ".fabric", "knowledge", "guidelines"), { recursive: true });
    await writeFile(
      join(fakeHome, ".fabric", "knowledge", "guidelines", "personal-style.md"),
      [
        "---",
        "summary: Personal coding style",
        "id: KP-GLD-0001",
        "type: guideline",
        "maturity: draft",
        "layer: personal",
        "---",
        "# Personal coding style",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-v2-passthrough",
        nodes: {
          "KT-DEC-0001": {
            stable_id: "KT-DEC-0001",
            file: ".fabric/knowledge/decisions/team-auth.md",
            content_ref: ".fabric/knowledge/decisions/team-auth.md",
            scope_glob: "**",
            hash: "sha256:team-auth",
            identity_source: "declared",
            description: {
              summary: "Team JWT decision",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "Team JWT decision",
              id: "KT-DEC-0001",
              knowledge_type: "decisions",
              maturity: "verified",
              knowledge_layer: "team",
              layer_reason: "shared across services",
              created_at: "2026-05-10T08:00:00Z",
            },
          },
          "KP-GLD-0001": {
            stable_id: "KP-GLD-0001",
            file: "~/.fabric/knowledge/guidelines/personal-style.md",
            content_ref: "~/.fabric/knowledge/guidelines/personal-style.md",
            scope_glob: "**",
            hash: "sha256:personal-style",
            identity_source: "declared",
            description: {
              summary: "Personal coding style",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "Personal coding style",
              id: "KP-GLD-0001",
              knowledge_type: "guidelines",
              maturity: "draft",
              knowledge_layer: "personal",
              created_at: "2026-05-10T08:00:00Z",
            },
          },
          "legacy-v1": {
            stable_id: "legacy-v1",
            file: ".fabric/knowledge/pending/legacy.md",
            content_ref: ".fabric/knowledge/pending/legacy.md",
            scope_glob: "**",
            hash: "sha256:legacy",
            description: {
              summary: "Legacy v1.x entry",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "Legacy v1.x entry",
            },
          },
        },
      }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const indexById = new Map(result.candidates.map((item) => [item.stable_id, item] as const));

    // v2.0.0-rc.38 UX-3: top-level type/maturity/layer mirrors removed — these
    // now live only on description.*, and the inferred layer is backfilled into
    // description.knowledge_layer.
    expect(indexById.get("KT-DEC-0001")?.description).toMatchObject({
      knowledge_type: "decisions",
      maturity: "verified",
      knowledge_layer: "team",
      layer_reason: "shared across services",
    });
    expect(indexById.get("KT-DEC-0001")).not.toHaveProperty("type");
    expect(indexById.get("KT-DEC-0001")).not.toHaveProperty("layer");

    expect(indexById.get("KP-GLD-0001")?.description).toMatchObject({
      knowledge_type: "guidelines",
      maturity: "draft",
      knowledge_layer: "personal",
    });

    // legacy-v1 had no knowledge_type/knowledge_layer in frontmatter; the layer
    // is backfilled from the (team-rooted) content_ref, type stays undefined.
    expect(indexById.get("legacy-v1")?.description.knowledge_type).toBeUndefined();
    expect(indexById.get("legacy-v1")?.description.maturity).toBeUndefined();
    expect(indexById.get("legacy-v1")?.description.knowledge_layer).toBe("team");
  });

  // F54 (ISS-20260531-090): layer_filter was declared in planContextInputSchema
  // (and recallInputSchema) but the tool callbacks never forwarded it and the
  // service never applied it — every layer leaked into every result. These
  // assert the param now actually narrows the candidate corpus by layer.
  async function seedDualLayerProject(): Promise<string> {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "team-auth.md"), "# Team JWT\n");
    const fakeHome = process.env.FABRIC_HOME!;
    await mkdir(join(fakeHome, ".fabric", "knowledge", "guidelines"), { recursive: true });
    await writeFile(join(fakeHome, ".fabric", "knowledge", "guidelines", "personal-style.md"), "# Personal style\n");
    const mkDesc = (summary: string, id: string, layer: "team" | "personal", type: string) => ({
      summary, intent_clues: [], tech_stack: [], impact: [], must_read_if: summary,
      id, knowledge_type: type, maturity: "draft", knowledge_layer: layer,
    });
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-layerfilter",
        nodes: {
          "KT-DEC-0001": {
            stable_id: "KT-DEC-0001", file: ".fabric/knowledge/decisions/team-auth.md",
            content_ref: ".fabric/knowledge/decisions/team-auth.md", scope_glob: "**",
            hash: "sha256:team", identity_source: "declared",
            description: mkDesc("Team JWT decision", "KT-DEC-0001", "team", "decisions"),
          },
          "KP-GLD-0001": {
            stable_id: "KP-GLD-0001", file: "~/.fabric/knowledge/guidelines/personal-style.md",
            content_ref: "~/.fabric/knowledge/guidelines/personal-style.md", scope_glob: "**",
            hash: "sha256:personal", identity_source: "declared",
            description: mkDesc("Personal coding style", "KP-GLD-0001", "personal", "guidelines"),
          },
        },
      }, null, 2)}\n`,
    );
    return projectRoot;
  }

  it("layer_filter=team surfaces only team candidates, dropping personal (KP-*)", async () => {
    const projectRoot = await seedDualLayerProject();
    const result = await planContext(projectRoot, { paths: ["src/index.ts"], layer_filter: "team" });
    const ids = result.candidates.map((c) => c.stable_id);
    expect(ids).toContain("KT-DEC-0001");
    expect(ids).not.toContain("KP-GLD-0001");
  });

  it("layer_filter=personal surfaces only personal candidates, dropping team (KT-*)", async () => {
    const projectRoot = await seedDualLayerProject();
    const result = await planContext(projectRoot, { paths: ["src/index.ts"], layer_filter: "personal" });
    const ids = result.candidates.map((c) => c.stable_id);
    expect(ids).toContain("KP-GLD-0001");
    expect(ids).not.toContain("KT-DEC-0001");
  });

  it("layer_filter omitted (default both) surfaces every layer", async () => {
    const projectRoot = await seedDualLayerProject();
    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);
    expect(ids).toContain("KT-DEC-0001");
    expect(ids).toContain("KP-GLD-0001");
  });

  // ---------------------------------------------------------------------------
  // v2.0-rc.7 T9: degenerate single-stage mode removed. Output is now
  // symmetric across all candidate counts — description_index + selection_token,
  // no candidates_full_content. See docs/decisions/rc5-a3-superseded.md.
  // ---------------------------------------------------------------------------

  it("test_plan_context_symmetric_small_set — 5 entries return description_index + selection_token (no inline bodies)", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);

    const nodes: Record<string, unknown> = {};
    for (let i = 0; i < 5; i += 1) {
      const id = `KT-DEC-${String(i + 1).padStart(4, "0")}`;
      const file = `.fabric/knowledge/decisions/d${i + 1}.md`;
      await writeFile(join(projectRoot, file), `# Decision ${i + 1}\n\nBody for ${id}.\n`);
      nodes[id] = {
        stable_id: id,
        file,
        content_ref: file,
        scope_glob: "**",
        hash: `sha256:d${i + 1}`,
        identity_source: "declared",
        description: {
          summary: `Decision ${i + 1}`,
          intent_clues: [],
          tech_stack: [],
          impact: [],
          must_read_if: "",
          id,
          knowledge_type: "decisions",
          maturity: "verified",
          knowledge_layer: "team",
          created_at: "2026-05-10T00:00:00Z",
        },
      };
    }
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: "rev-small", nodes }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    expect(result.selection_token).toEqual(expect.any(String));
    expect(result.candidates).toHaveLength(5);
    // Negative assertion: degenerate-mode field is gone from the response.
    expect(result).not.toHaveProperty("candidates_full_content");
  });

  it("test_plan_context_symmetric_large_set — 100 entries return same shape as small set", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);

    const nodes: Record<string, unknown> = {};
    // 100 stub entries — well above the legacy degenerate threshold. Shape
    // must match the small-set response exactly.
    // v2.0.0-rc.22 Scope D T-D2: each stub needs a backing .md file so
    // buildKnowledgeMeta (now invoked by auto-heal) preserves the hand-crafted
    // description blob via `...existing?.node`. Without the file the node is
    // dropped from the rebuilt meta and the description_index shrinks below
    // 100.
    for (let i = 0; i < 100; i += 1) {
      const id = `KT-DEC-${String(i + 1).padStart(4, "0")}`;
      const file = `.fabric/knowledge/decisions/d${i + 1}.md`;
      await writeFile(join(projectRoot, file), `# Decision ${i + 1}\n`);
      nodes[id] = {
        stable_id: id,
        file,
        content_ref: file,
        scope_glob: "**",
        hash: `sha256:d${i + 1}`,
        identity_source: "declared",
        description: {
          summary: `Decision ${i + 1}`,
          intent_clues: [],
          tech_stack: [],
          impact: [],
          must_read_if: "",
          id,
          knowledge_type: "decisions",
          maturity: "verified",
          knowledge_layer: "team",
          created_at: "2026-05-10T00:00:00Z",
        },
      };
    }
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: "rev-large", nodes }, null, 2)}\n`,
    );

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
  // v2.0-rc.5 C3 (TASK-012): relevance_paths filter
  //
  // Build a mixed registry with broad + narrow entries and assert filter
  // semantics against various target_paths inputs:
  //   * broad always passes (filter is a no-op for cross-cutting entries)
  //   * narrow passes ONLY when its relevance_paths globs match a target
  //   * narrow fails when no glob matches any target_paths
  //   * empty target_paths → narrow fails open (every narrow passes too)
  // ---------------------------------------------------------------------------

  async function seedRelevanceRegistry(projectRoot: string): Promise<void> {
    await mkdir(join(projectRoot, ".fabric", "knowledge", "guidelines"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    // v2.0.0-rc.22 Scope D T-D2: seed real YAML frontmatter so auto-heal's
    // extractRuleDescription parses the same relevance_scope / relevance_paths
    // the hand-crafted meta declared. Heading-only fallback would default to
    // broad+[] and silently flip every narrow entry to fail-open.
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "guidelines", "broad.md"),
      [
        "---",
        "summary: Broad cross-cutting guideline",
        "id: KT-GLD-0001",
        "type: guideline",
        "maturity: verified",
        "layer: team",
        "relevance_scope: broad",
        "relevance_paths: []",
        "---",
        "# Broad",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "guidelines", "ui-narrow.md"),
      [
        "---",
        "summary: Narrow UI guideline",
        "id: KT-GLD-0002",
        "type: guideline",
        "maturity: verified",
        "layer: team",
        "relevance_scope: narrow",
        `relevance_paths: ["src/ui/**", "packages/ui/"]`,
        "---",
        "# UI Narrow",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "auth-narrow.md"),
      [
        "---",
        "summary: Narrow auth decision",
        "id: KT-DEC-0001",
        "type: decision",
        "maturity: verified",
        "layer: team",
        "relevance_scope: narrow",
        `relevance_paths: ["src/auth/**"]`,
        "---",
        "# Auth Narrow",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-relevance",
        nodes: {
          "KT-GLD-0001": {
            stable_id: "KT-GLD-0001",
            file: ".fabric/knowledge/guidelines/broad.md",
            content_ref: ".fabric/knowledge/guidelines/broad.md",
            scope_glob: "**",
            hash: "sha256:broad",
            identity_source: "declared",
            description: {
              summary: "Broad cross-cutting guideline",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "",
              id: "KT-GLD-0001",
              knowledge_type: "guidelines",
              maturity: "verified",
              knowledge_layer: "team",
              created_at: "2026-05-10T00:00:00Z",
              relevance_scope: "broad",
              relevance_paths: [],
            },
          },
          "KT-GLD-0002": {
            stable_id: "KT-GLD-0002",
            file: ".fabric/knowledge/guidelines/ui-narrow.md",
            content_ref: ".fabric/knowledge/guidelines/ui-narrow.md",
            scope_glob: "**",
            hash: "sha256:ui-narrow",
            identity_source: "declared",
            description: {
              summary: "Narrow UI guideline",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "",
              id: "KT-GLD-0002",
              knowledge_type: "guidelines",
              maturity: "verified",
              knowledge_layer: "team",
              created_at: "2026-05-10T00:00:00Z",
              relevance_scope: "narrow",
              relevance_paths: ["src/ui/**", "packages/ui/"],
            },
          },
          "KT-DEC-0001": {
            stable_id: "KT-DEC-0001",
            file: ".fabric/knowledge/decisions/auth-narrow.md",
            content_ref: ".fabric/knowledge/decisions/auth-narrow.md",
            scope_glob: "**",
            hash: "sha256:auth-narrow",
            identity_source: "declared",
            description: {
              summary: "Narrow auth decision",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "",
              id: "KT-DEC-0001",
              knowledge_type: "decisions",
              maturity: "verified",
              knowledge_layer: "team",
              created_at: "2026-05-10T00:00:00Z",
              relevance_scope: "narrow",
              relevance_paths: ["src/auth/**"],
            },
          },
        },
      }, null, 2)}\n`,
    );
  }

  it("test_plan_context_returns_all_even_unrelated_path — Wave A1: unrelated path still returns ALL entries (no filter)", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    // Pre-Wave-A1: src/unrelated/ did not match any narrow relevance_paths
    // → only broad survived.
    // Wave A1: server returns ALL, LLM decides via descriptions.
    const result = await planContext(projectRoot, {
      paths: ["src/unrelated/index.ts"],
      target_paths: ["src/unrelated/index.ts"],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    expect(ids).toEqual(["KT-DEC-0001", "KT-GLD-0001", "KT-GLD-0002"]);
  });

  it("test_plan_context_returns_all_for_ui_path — Wave A1: src/ui path still returns ALL entries (broad + both narrows)", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    const result = await planContext(projectRoot, {
      paths: ["src/ui/Button.tsx"],
      target_paths: ["src/ui/Button.tsx"],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    // Wave A1: server returns ALL candidates with descriptions; LLM picks.
    // Pre-Wave-A1 this would have been [KT-GLD-0001, KT-GLD-0002] (broad +
    // ui-narrow only, auth-narrow excluded).
    expect(ids).toEqual(["KT-DEC-0001", "KT-GLD-0001", "KT-GLD-0002"]);
  });

  it("test_plan_context_no_narrow_filter — Wave A1: server returns ALL candidates regardless of relevance_scope/relevance_paths match", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    const result = await planContext(projectRoot, {
      paths: ["src/auth/login.ts"],
      target_paths: ["src/auth/login.ts"],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    // Wave A1 (per KB [[no-server-side-kb-filter]]): no server-side relevance
    // filter — broad + ALL narrow entries returned, LLM picks via descriptions.
    // Pre-Wave-A1 behavior excluded ui-narrow when its relevance_paths did not
    // anchor against the target_paths; that filter is now disabled.
    expect(ids).toEqual(["KT-DEC-0001", "KT-GLD-0001", "KT-GLD-0002"]);
  });

  it("test_plan_context_no_paths_returns_all — empty target_paths fails open (narrow included)", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    // Explicit empty target_paths → fail-open: include broad AND every narrow.
    const result = await planContext(projectRoot, {
      paths: ["**"],
      target_paths: [],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    expect(ids).toEqual(["KT-DEC-0001", "KT-GLD-0001", "KT-GLD-0002"]);
  });

  it("test_plan_context_returns_all_for_dir_anchored_path — Wave A1: dir-anchored path still returns ALL entries", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    // Pre-Wave-A1: packages/ui/ → packages/ui/** matched ui-narrow only.
    // Wave A1: server returns ALL, LLM decides relevance from descriptions.
    const result = await planContext(projectRoot, {
      paths: ["packages/ui/Card.tsx"],
      target_paths: ["packages/ui/Card.tsx"],
    });
    const ids = result.candidates.map((item) => item.stable_id).sort();
    expect(ids).toEqual(["KT-DEC-0001", "KT-GLD-0001", "KT-GLD-0002"]);
  });

  it("test_plan_context_drops_cocos_fields — output schema lacks Cocos + L0/L1/L2 ceremony fields", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "g.md"), "# G\n");
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-cocos-drop",
        nodes: {
          "KT-DEC-0001": {
            stable_id: "KT-DEC-0001",
            file: ".fabric/knowledge/decisions/g.md",
            content_ref: ".fabric/knowledge/decisions/g.md",
            scope_glob: "**",
            hash: "sha256:g",
            identity_source: "declared",
            description: {
              summary: "G",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "",
              id: "KT-DEC-0001",
              knowledge_type: "decisions",
              maturity: "verified",
              knowledge_layer: "team",
              created_at: "2026-05-10T00:00:00Z",
            },
          },
        },
      }, null, 2)}\n`,
    );

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

  // ---------------------------------------------------------------------------
  // v2.0.0-rc.22 Scope D T-D2 (TASK-009): auto-heal banner + graceful degrade
  //
  // The two paths under test:
  //   1. fresh meta + matching tree → no auto_healed field in the response
  //      (omitting the field on the steady-state path keeps the wire shape
  //      minimal — downstream renderers branch only when the field is true).
  //   2. graceful degrade when buildKnowledgeMeta throws → response carries
  //      stale:true and falls back to the on-disk meta, never throws.
  //
  // The stale → auto_healed:true path is exercised by the very first test in
  // this file (revision_hash + auto_healed + previous_revision_hash); no need
  // to re-prove the heal pipeline here.
  // ---------------------------------------------------------------------------

  it("planContext_no_auto_healed_field_when_fresh — steady-state response omits auto_healed", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "foo.md"),
      "# Foo\n",
    );
    // Build the meta from the real on-disk tree so its revision matches the
    // derived revision — no drift → no heal.
    const { writeKnowledgeMeta } = await import("./knowledge-meta-builder.js");
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    expect(result.auto_healed).toBeUndefined();
    expect(result.previous_revision_hash).toBeUndefined();
    // stale stays false on the steady-state path — no client_hash was sent.
    expect(result.stale).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // v2.0.0-rc.23 TASK-005 (a-B): description-undefined auto-heal
  //
  // Symmetric to rc.22 D2 but covers the case where revision hashes match
  // (no revision drift) yet on-disk meta carries nodes with
  // description === undefined. Such legacy meta degrades hint quality and
  // collapses to "KB: none" in cite enforcement. Three cases:
  //   1. Undefined-description present → reconcile fires + auto_healed:true,
  //      meta_reconciled event emitted with trigger:'auto-heal-description'.
  //   2. All-fresh KB → no reconcile, auto_healed stays absent.
  //   3. Idempotent re-run on already-healed KB → no second reconcile.
  // ---------------------------------------------------------------------------

  it("planContext_auto_heals_when_description_is_undefined — fires reconcile + auto_healed:true", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    // Seed an .md file WITH frontmatter so the reconcile rebuild can populate
    // a real description for it — the heal must be observably effective.
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "global.md"),
      [
        "---",
        "stable_id: DEC-001",
        "knowledge_type: decision",
        "maturity: verified",
        "knowledge_layer: team",
        "description:",
        "  summary: Global protocol",
        "  intent_clues: []",
        "  tech_stack: [Fabric]",
        "  impact: []",
        "  must_read_if: before any edit",
        "---",
        "# Global",
        "",
      ].join("\n"),
    );

    // Seed an on-disk meta whose revision matches the derived revision
    // (so loadActiveMetaOrStale does NOT trigger its own auto-heal) but whose
    // node lacks `description`. To do that we first let writeKnowledgeMeta
    // compute the canonical meta, then surgically strip the description.
    const { writeKnowledgeMeta } = await import("./knowledge-meta-builder.js");
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as {
      revision: string;
      nodes: Record<string, { description?: unknown; activation?: { description?: unknown } }>;
    };
    const originalRevision = parsed.revision;
    // Strip both description surfaces from every node so the predicate
    // (description===undefined && activation?.description===undefined) is hit.
    for (const node of Object.values(parsed.nodes)) {
      delete node.description;
      if (node.activation !== undefined) {
        delete node.activation.description;
      }
    }
    await fs.writeFile(metaPath, `${JSON.stringify(parsed, null, 2)}\n`);

    // Bust the meta cache so the next read sees our doctored bytes.
    contextCache.invalidate("meta_write", projectRoot);

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    // Auto-heal banner surfaced.
    expect(result.auto_healed).toBe(true);
    expect(result.previous_revision_hash).toBe(originalRevision);

    // Post-heal meta on disk has description populated again.
    const healedRaw = await fs.readFile(metaPath, "utf8");
    const healedParsed = JSON.parse(healedRaw) as {
      nodes: Record<string, { description?: unknown }>;
    };
    const healedNodes = Object.values(healedParsed.nodes);
    expect(healedNodes.length).toBeGreaterThan(0);
    for (const node of healedNodes) {
      expect(node.description).toBeDefined();
    }

    // Ledger captured the trigger.
    const ledger = await readEventLedger(projectRoot, { event_type: "meta_reconciled" });
    const triggers = ledger.events.map((e) => (e as { trigger?: string }).trigger);
    expect(triggers).toContain("auto-heal-description");
  });

  it("planContext_no_heal_when_descriptions_all_defined — auto_healed stays absent", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "global.md"),
      [
        "---",
        "stable_id: DEC-001",
        "knowledge_type: decision",
        "maturity: verified",
        "knowledge_layer: team",
        "description:",
        "  summary: Global protocol",
        "  intent_clues: []",
        "  tech_stack: [Fabric]",
        "  impact: []",
        "  must_read_if: before any edit",
        "---",
        "# Global",
        "",
      ].join("\n"),
    );
    const { writeKnowledgeMeta } = await import("./knowledge-meta-builder.js");
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    // No drift on either axis → wire shape stays minimal.
    expect(result.auto_healed).toBeUndefined();
    expect(result.previous_revision_hash).toBeUndefined();

    // And no auto-heal-description event in the ledger.
    const ledger = await readEventLedger(projectRoot, { event_type: "meta_reconciled" });
    const triggers = ledger.events.map((e) => (e as { trigger?: string }).trigger);
    expect(triggers).not.toContain("auto-heal-description");
  });

  it("planContext_idempotent_after_description_heal — second call does not re-trigger", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "global.md"),
      [
        "---",
        "stable_id: DEC-001",
        "knowledge_type: decision",
        "maturity: verified",
        "knowledge_layer: team",
        "description:",
        "  summary: Global protocol",
        "  intent_clues: []",
        "  tech_stack: [Fabric]",
        "  impact: []",
        "  must_read_if: before any edit",
        "---",
        "# Global",
        "",
      ].join("\n"),
    );
    const { writeKnowledgeMeta } = await import("./knowledge-meta-builder.js");
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    // Strip descriptions to set up the drift, same way as the first test.
    const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as {
      nodes: Record<string, { description?: unknown; activation?: { description?: unknown } }>;
    };
    for (const node of Object.values(parsed.nodes)) {
      delete node.description;
      if (node.activation !== undefined) {
        delete node.activation.description;
      }
    }
    await fs.writeFile(metaPath, `${JSON.stringify(parsed, null, 2)}\n`);
    contextCache.invalidate("meta_write", projectRoot);

    // First call heals.
    const first = await planContext(projectRoot, { paths: ["src/index.ts"] });
    expect(first.auto_healed).toBe(true);

    // Second call must NOT heal again — meta is fresh now.
    const second = await planContext(projectRoot, { paths: ["src/index.ts"] });
    expect(second.auto_healed).toBeUndefined();
    expect(second.previous_revision_hash).toBeUndefined();

    // Ledger holds exactly one auto-heal-description event from the first call.
    const ledger = await readEventLedger(projectRoot, { event_type: "meta_reconciled" });
    const autoHealEvents = ledger.events.filter(
      (e) => (e as { trigger?: string }).trigger === "auto-heal-description",
    );
    expect(autoHealEvents).toHaveLength(1);
  });

  it("planContext_degrades_on_build_failure — graceful return with stale:true", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "foo.md"),
      "# Foo\n",
    );
    const knowledgeMetaBuilder = await import("./knowledge-meta-builder.js");
    await knowledgeMetaBuilder.writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    // Inject a synthetic build failure. loadActiveMetaOrStale must return the
    // on-disk meta with degraded:true (we only see the surface via stale:true).
    vi.spyOn(knowledgeMetaBuilder, "buildKnowledgeMeta").mockRejectedValueOnce(
      new Error("synthetic build failure"),
    );

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    // Graceful path — no exception, response shape preserved, stale flag set.
    expect(result.stale).toBe(true);
    // No auto-heal happened (build threw before any write), so the banner
    // pair stays absent.
    expect(result.auto_healed).toBeUndefined();
    expect(result.previous_revision_hash).toBeUndefined();
    // The on-disk meta is still served — revision_hash is non-empty.
    expect(result.revision_hash).toEqual(expect.any(String));
    expect(result.revision_hash.length).toBeGreaterThan(0);
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
    const projectRoot = await createTempProject();
    await expect(
      planContext(projectRoot, { paths: ["/etc/passwd"] }),
    ).rejects.toThrow(/absolute paths are not allowed/u);
  });

  it("rejects `..` traversal in input.paths", async () => {
    const projectRoot = await createTempProject();
    await expect(
      planContext(projectRoot, { paths: ["../../../etc/passwd"] }),
    ).rejects.toThrow(/traversal is not allowed/u);
  });

  it("rejects `~/` shell sigil in input.paths", async () => {
    const projectRoot = await createTempProject();
    await expect(
      planContext(projectRoot, { paths: ["~/.ssh/id_rsa"] }),
    ).rejects.toThrow(/shell sigil/u);
  });

  it("rejects `..` traversal in input.target_paths", async () => {
    const projectRoot = await createTempProject();
    await expect(
      planContext(projectRoot, {
        paths: ["src/index.ts"],
        target_paths: ["../../../etc/hosts"],
      }),
    ).rejects.toThrow(/traversal is not allowed/u);
  });

  it("accepts the `**` global sentinel without throwing", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      JSON.stringify({ revision: "init", nodes: {} }),
    );
    const result = await planContext(projectRoot, { paths: ["**"] });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.path).toBe("**");
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.38 UX-2 (fold ②): empty-shell suppression
// ---------------------------------------------------------------------------

describe("planContext empty-shell suppression (UX-2)", () => {
  it("drops signal-less shells from candidates and surfaces them via empty_shell_suppressed", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    // Seed real YAML frontmatter so auto-heal's re-derivation reproduces the
    // same descriptions (heading-only files would let reconcile rewrite them).
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "real.md"),
      [
        "---",
        "summary: A real decision with signal",
        "id: KT-DEC-0001",
        "type: decision",
        "maturity: proven",
        "layer: team",
        "intent_clues: [when wiring auth]",
        "---",
        "# Real",
        "",
      ].join("\n"),
    );
    // Empty shell: summary === stable_id, all signal arrays empty.
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "shell.md"),
      [
        "---",
        "summary: KT-DEC-9001",
        "id: KT-DEC-9001",
        "type: decision",
        "maturity: draft",
        "layer: team",
        "---",
        "# Shell",
        "",
      ].join("\n"),
    );
    const { writeKnowledgeMeta } = await import("./knowledge-meta-builder.js");
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    const ids = result.candidates.map((item) => item.stable_id);
    expect(ids).toContain("KT-DEC-0001");
    expect(ids).not.toContain("KT-DEC-9001");

    const suppressed = result.preflight_diagnostics.find((d) => d.code === "empty_shell_suppressed");
    expect(suppressed).toBeDefined();
    expect(suppressed?.stable_ids).toContain("KT-DEC-9001");
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.38 UX-1 / UX-4 (fold ①): payload no longer scales per-path, and a
// realistic single-path payload stays well under the 4000-token budget
// (G-MCP-PAYLOAD). Baseline before the fold: ~11900 tokens on this repo.
// ---------------------------------------------------------------------------

describe("planContext payload size (UX-1/UX-4 regression)", () => {
  async function seedRealisticRegistry(projectRoot: string, count: number): Promise<void> {
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i < count; i += 1) {
      const id = `KT-DEC-${String(i + 1).padStart(4, "0")}`;
      const file = `.fabric/knowledge/decisions/d${i + 1}.md`;
      await writeFile(join(projectRoot, file), `# Decision ${i + 1}\n\nBody for ${id}.\n`);
      nodes[id] = {
        stable_id: id,
        file,
        content_ref: file,
        scope_glob: "**",
        hash: `sha256:d${i + 1}`,
        identity_source: "declared",
        description: {
          summary: `Decision ${i + 1}: a representative architecture decision with a realistic summary length`,
          intent_clues: ["when touching the relevant module"],
          tech_stack: ["TypeScript"],
          impact: ["affects downstream consumers"],
          must_read_if: "before editing the relevant area",
          id,
          knowledge_type: "decisions",
          maturity: "proven",
          knowledge_layer: "team",
          created_at: "2026-05-10T00:00:00Z",
        },
      };
    }
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: `rev-${count}`, nodes }, null, 2)}\n`,
    );
  }

  it("single-path payload stays under the 4000-token budget (~25 typical entries)", async () => {
    const projectRoot = await createTempProject();
    await seedRealisticRegistry(projectRoot, 25);

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const serialized = JSON.stringify(result);
    // char/4 token proxy — conservative for dense JSON.
    const approxTokens = Math.ceil(serialized.length / 4);
    expect(approxTokens).toBeLessThanOrEqual(4000);
  });

  it("payload does not scale per-path (fold ① — N paths != N copies of candidates)", async () => {
    const projectRoot = await createTempProject();
    await seedRealisticRegistry(projectRoot, 25);

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
});

// v2.2 A-INFRA-1 (W1-T2-BM25): content-relevance ranking. Seeds two entries
// with disjoint vocabularies and asserts that a caller intent matching one
// floats it above the other — and that, absent any intent, the ordering falls
// back to the pre-BM25 stable_id sort (backward compatibility).
describe("planContext BM25 content ranking (W1-T2)", () => {
  async function seedTwoTopicRegistry(projectRoot: string): Promise<void> {
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    const node = (stableId: string, file: string, summary: string) => ({
      stable_id: stableId,
      file,
      content_ref: file,
      scope_glob: "**",
      hash: `sha256:${stableId}`,
      identity_source: "declared",
      description: {
        summary,
        intent_clues: [],
        tech_stack: [],
        impact: [],
        must_read_if: "",
        id: stableId,
        knowledge_type: "decisions",
        maturity: "verified",
        knowledge_layer: "team",
        created_at: "2026-05-10T00:00:00Z",
        relevance_scope: "broad",
        relevance_paths: [],
      },
    });
    const frontmatter = (id: string, summary: string) =>
      ["---", `summary: ${summary}`, `id: ${id}`, "type: decision", "maturity: verified", "layer: team", "relevance_scope: broad", "relevance_paths: []", "---", `# ${id}`, ""].join("\n");
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "vector.md"),
      frontmatter("KT-DEC-9001", "Vector embedding semantic retrieval over the knowledge base"),
    );
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "archive.md"),
      frontmatter("KT-DEC-9002", "Git lifecycle archive cadence deprecation nudge"),
    );
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-bm25",
        nodes: {
          "KT-DEC-9001": node("KT-DEC-9001", ".fabric/knowledge/decisions/vector.md", "Vector embedding semantic retrieval over the knowledge base"),
          "KT-DEC-9002": node("KT-DEC-9002", ".fabric/knowledge/decisions/archive.md", "Git lifecycle archive cadence deprecation nudge"),
        },
      }, null, 2)}\n`,
    );
  }

  it("floats the content-matching entry to the top when intent is supplied", async () => {
    const projectRoot = await createTempProject();
    await seedTwoTopicRegistry(projectRoot);

    const result = await planContext(projectRoot, {
      paths: ["src/retrieval.ts"],
      intent: "add vector embedding semantic search",
    });

    // BM25 ranks the vector entry first despite KT-DEC-9002 sorting earlier
    // alphabetically — content relevance leads.
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["KT-DEC-9001", "KT-DEC-9002"]);
  });

  it("falls back to stable_id order when no intent is supplied (BM25 disabled)", async () => {
    const projectRoot = await createTempProject();
    await seedTwoTopicRegistry(projectRoot);

    const result = await planContext(projectRoot, { paths: ["src/retrieval.ts"] });

    // No query terms → BM25 contributes 0 → both entries tie on content and
    // the alphabetic stable_id tiebreaker restores deterministic order.
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["KT-DEC-9001", "KT-DEC-9002"]);
  });

  it("ranks the archive entry first when the intent matches it instead", async () => {
    const projectRoot = await createTempProject();
    await seedTwoTopicRegistry(projectRoot);

    const result = await planContext(projectRoot, {
      paths: ["src/lifecycle.ts"],
      intent: "git archive deprecation cadence",
    });

    expect(result.candidates.map((item) => item.stable_id)).toEqual(["KT-DEC-9002", "KT-DEC-9001"]);
  });
});

// v2.2 A-INFRA-3 (W1-T3-TOPK): bounded top_k truncation applied AFTER BM25
// ranking. Seeds three entries, caps to two via plan_context_top_k, and asserts
// the dropped entry is the least content-relevant one (not an alphabetic tail)
// and that the omitted count is surfaced.
describe("planContext top_k truncation (W1-T3)", () => {
  async function seedThreeTopicRegistry(projectRoot: string, topK?: number): Promise<void> {
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    if (topK !== undefined) {
      await writeFile(
        join(projectRoot, "fabric.config.json"),
        `${JSON.stringify({ plan_context_top_k: topK }, null, 2)}\n`,
      );
    }
    const topics: Array<[string, string, string]> = [
      ["KT-DEC-9101", "vector.md", "Vector embedding semantic retrieval over the knowledge base"],
      ["KT-DEC-9102", "bm25.md", "BM25 content relevance scoring tokenization"],
      ["KT-DEC-9103", "archive.md", "Git lifecycle archive cadence deprecation nudge"],
    ];
    const node = (stableId: string, file: string, summary: string) => ({
      stable_id: stableId,
      file,
      content_ref: file,
      scope_glob: "**",
      hash: `sha256:${stableId}`,
      identity_source: "declared",
      description: {
        summary,
        intent_clues: [],
        tech_stack: [],
        impact: [],
        must_read_if: "",
        id: stableId,
        knowledge_type: "decisions",
        maturity: "verified",
        knowledge_layer: "team",
        created_at: "2026-05-10T00:00:00Z",
        relevance_scope: "broad",
        relevance_paths: [],
      },
    });
    const nodes: Record<string, unknown> = {};
    for (const [id, fileName, summary] of topics) {
      const file = `.fabric/knowledge/decisions/${fileName}`;
      await writeFile(
        join(projectRoot, file),
        ["---", `summary: ${summary}`, `id: ${id}`, "type: decision", "maturity: verified", "layer: team", "relevance_scope: broad", "relevance_paths: []", "---", `# ${id}`, ""].join("\n"),
      );
      nodes[id] = node(id, file, summary);
    }
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: "rev-topk", nodes }, null, 2)}\n`,
    );
  }

  it("caps candidates to plan_context_top_k after BM25 ranking and surfaces the omitted count", async () => {
    const projectRoot = await createTempProject();
    await seedThreeTopicRegistry(projectRoot, 2);

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
    expect(ids).toContain("KT-DEC-9101");
    expect(ids).toContain("KT-DEC-9102");
    expect(ids).not.toContain("KT-DEC-9103");
  });

  it("omits the count field entirely when nothing is truncated", async () => {
    const projectRoot = await createTempProject();
    await seedThreeTopicRegistry(projectRoot); // no cap → default 24 > 3

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
    projectRoot: string,
    entries: Array<{ id: string; file: string; summary: string; maturity: "draft" | "verified" | "proven" }>,
  ): Promise<void> {
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    const nodes: Record<string, unknown> = {};
    for (const e of entries) {
      const file = `.fabric/knowledge/decisions/${e.file}`;
      await writeFile(
        join(projectRoot, file),
        ["---", `summary: ${e.summary}`, `id: ${e.id}`, "type: decision", `maturity: ${e.maturity}`, "layer: team", "relevance_scope: broad", "relevance_paths: []", "---", `# ${e.id}`, ""].join("\n"),
      );
      nodes[e.id] = {
        stable_id: e.id,
        file,
        content_ref: file,
        scope_glob: "**",
        hash: `sha256:${e.id}`,
        identity_source: "declared",
        description: {
          summary: e.summary,
          intent_clues: [],
          tech_stack: [],
          impact: [],
          must_read_if: "",
          id: e.id,
          knowledge_type: "decisions",
          maturity: e.maturity,
          knowledge_layer: "team",
          created_at: "2026-05-10T00:00:00Z",
          relevance_scope: "broad",
          relevance_paths: [],
        },
      };
    }
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: "rev-salience", nodes }, null, 2)}\n`,
    );
  }

  it("floats higher maturity up among entries with identical content relevance", async () => {
    const projectRoot = await createTempProject();
    // Same summary text → identical BM25 + locality; only maturity differs.
    await seedMaturityRegistry(projectRoot, [
      { id: "KT-DEC-7001", file: "draft.md", summary: "Shared lifecycle governance topic", maturity: "draft" },
      { id: "KT-DEC-7002", file: "proven.md", summary: "Shared lifecycle governance topic", maturity: "proven" },
      { id: "KT-DEC-7003", file: "verified.md", summary: "Shared lifecycle governance topic", maturity: "verified" },
    ]);

    const result = await planContext(projectRoot, { paths: ["src/x.ts"] });

    // proven (15) > verified (8) > draft (0).
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["KT-DEC-7002", "KT-DEC-7003", "KT-DEC-7001"]);
  });

  it("never lets high maturity override content relevance (防高成熟低相关压过正文)", async () => {
    const projectRoot = await createTempProject();
    await seedMaturityRegistry(projectRoot, [
      // draft but matches the intent
      { id: "KT-DEC-7101", file: "match.md", summary: "Vector embedding semantic retrieval", maturity: "draft" },
      // proven but unrelated to the intent
      { id: "KT-DEC-7102", file: "mature.md", summary: "Git archive deprecation cadence", maturity: "proven" },
    ]);

    const result = await planContext(projectRoot, {
      paths: ["src/retrieval.ts"],
      intent: "vector embedding semantic search",
    });

    // The draft content-match outranks the proven non-match: BM25 (~50+/term)
    // dwarfs the 15-point salience gap.
    expect(result.candidates.map((item) => item.stable_id)).toEqual(["KT-DEC-7101", "KT-DEC-7102"]);
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

  async function seedTwoOpaqueEntries(projectRoot: string): Promise<void> {
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    const mk = (id: string, file: string, summary: string) => ({
      stable_id: id, file, content_ref: file, scope_glob: "**", hash: `sha256:${id}`, identity_source: "declared",
      description: { summary, intent_clues: [], tech_stack: [], impact: [], must_read_if: "", id, knowledge_type: "decisions", maturity: "verified", knowledge_layer: "team", created_at: "2026-05-10T00:00:00Z", relevance_scope: "broad", relevance_paths: [] },
    });
    const fm = (id: string, summary: string) => ["---", `summary: ${summary}`, `id: ${id}`, "type: decision", "maturity: verified", "layer: team", "relevance_scope: broad", "relevance_paths: []", "---", `# ${id}`, ""].join("\n");
    // KT-DEC-9301 (b-heavy) sorts FIRST alphabetically; KT-DEC-9302 (a-heavy) second.
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "bbb.md"), fm("KT-DEC-9301", "bbbb bottle buzz"));
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "aaa.md"), fm("KT-DEC-9302", "aaaa apple aardvark"));
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: "rev-vec", nodes: { "KT-DEC-9301": mk("KT-DEC-9301", ".fabric/knowledge/decisions/bbb.md", "bbbb bottle buzz"), "KT-DEC-9302": mk("KT-DEC-9302", ".fabric/knowledge/decisions/aaa.md", "aaaa apple aardvark") } }, null, 2)}\n`,
    );
  }

  it("re-ranks by vector similarity when embeddings are enabled (BM25 silent)", async () => {
    const { __resetEmbedderForTesting } = await import("./vector-retrieval.js");
    __resetEmbedderForTesting(fakeEmbedder);
    try {
      const projectRoot = await createTempProject();
      await seedTwoOpaqueEntries(projectRoot);
      // embed_weight defaults to 30 (≤49 cap). BM25 is 0 for both candidates
      // (no shared token), so any positive vector weight is the deciding signal.
      await writeFile(join(projectRoot, "fabric.config.json"), `${JSON.stringify({ embed_enabled: true })}\n`);

      // Query is 'a'-heavy and shares no lexical token with either summary, so
      // BM25 is 0 for both — the vector supplement is the deciding signal.
      const result = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "aaaaaa" });

      // The 'a'-heavy entry (alphabetically SECOND) floats to the top via vectors.
      expect(result.candidates.map((c) => c.stable_id)).toEqual(["KT-DEC-9302", "KT-DEC-9301"]);
    } finally {
      __resetEmbedderForTesting(undefined);
    }
  });

  it("falls back to text-only order when embeddings stay disabled", async () => {
    const { __resetEmbedderForTesting } = await import("./vector-retrieval.js");
    __resetEmbedderForTesting(fakeEmbedder); // available, but config keeps it OFF
    try {
      const projectRoot = await createTempProject();
      await seedTwoOpaqueEntries(projectRoot);
      // No embed_enabled → vector path never runs → alphabetic stable_id order.
      const result = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "aaaaaa" });
      expect(result.candidates.map((c) => c.stable_id)).toEqual(["KT-DEC-9301", "KT-DEC-9302"]);
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
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    const node = (id: string, file: string, summary: string, relevancePaths: string[]) => ({
      stable_id: id, file, content_ref: file, scope_glob: "**", hash: `sha256:${id}`, identity_source: "declared",
      description: { summary, intent_clues: [], tech_stack: [], impact: [], must_read_if: "", id, knowledge_type: "decisions", maturity: "verified", knowledge_layer: "team", created_at: "2026-05-10T00:00:00Z", relevance_scope: "broad", relevance_paths: relevancePaths },
    });
    const fm = (id: string, summary: string, rp: string) =>
      ["---", `summary: ${summary}`, `id: ${id}`, "type: decision", "maturity: verified", "layer: team", "relevance_scope: broad", `relevance_paths: [${rp}]`, "---", `# ${id}`, ""].join("\n");
    // CONTENT: matches the rare query terms, but NO locality (no relevance_paths).
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "content.md"), fm("KT-DEC-8001", "zephyr quokka nimbus retrieval", ""));
    // LOCALITY: perfect same-file locality but ZERO content overlap with the query.
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "local.md"), fm("KT-DEC-8002", "unrelated bottle topic", "src/target.ts"));
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: "rev-cal", nodes: {
        "KT-DEC-8001": node("KT-DEC-8001", ".fabric/knowledge/decisions/content.md", "zephyr quokka nimbus retrieval", []),
        "KT-DEC-8002": node("KT-DEC-8002", ".fabric/knowledge/decisions/local.md", "unrelated bottle topic", ["src/target.ts"]),
      } }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, {
      paths: ["src/target.ts"],
      target_paths: ["src/target.ts"],
      intent: "zephyr quokka nimbus",
    });

    // Content match (BM25 ~3 rare terms × 50) beats perfect same-file locality (100).
    expect(result.candidates.map((c) => c.stable_id)).toEqual(["KT-DEC-8001", "KT-DEC-8002"]);
  });
});

// W4-02 (ISS-024): the BM25 model is corpus-keyed (meta.revision) and reused
// across queries — repeated query-bearing recalls over the same KB must NOT
// re-tokenize + re-index the whole corpus.
describe("planContext BM25 model cache (ISS-024)", () => {
  // `marker` varies the KB content so two projects produce DIFFERENT healed
  // revisions (planContext re-hashes the .md files; the seeded revision literal
  // is overwritten by the auto-heal).
  async function seedQueryableProject(marker: string): Promise<string> {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    const summaryA = `zephyr quokka nimbus retrieval ${marker}`;
    const fm = (id: string, summary: string) =>
      ["---", `summary: ${summary}`, `id: ${id}`, "type: decision", "maturity: verified", "layer: team", "relevance_scope: broad", "relevance_paths: []", "---", `# ${id}`, ""].join("\n");
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "a.md"), fm("KT-DEC-7001", summaryA));
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "b.md"), fm("KT-DEC-7002", "unrelated bottle topic widget"));
    const node = (id: string, file: string, summary: string) => ({
      stable_id: id, file, content_ref: file, scope_glob: "**", hash: `sha256:${id}`, identity_source: "declared",
      description: { summary, intent_clues: [], tech_stack: [], impact: [], must_read_if: "", id, knowledge_type: "decisions", maturity: "verified", knowledge_layer: "team", created_at: "2026-05-10T00:00:00Z", relevance_scope: "broad", relevance_paths: [] },
    });
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: `seed-${marker}`, nodes: {
        "KT-DEC-7001": node("KT-DEC-7001", ".fabric/knowledge/decisions/a.md", summaryA),
        "KT-DEC-7002": node("KT-DEC-7002", ".fabric/knowledge/decisions/b.md", "unrelated bottle topic widget"),
      } }, null, 2)}\n`,
    );
    return projectRoot;
  }

  it("builds the model once across multiple query-bearing calls over the same KB", async () => {
    __resetBm25Cache();
    const projectRoot = await seedQueryableProject("same");

    const r1 = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "zephyr quokka" });
    const r2 = await planContext(projectRoot, { paths: ["src/x.ts"], intent: "nimbus retrieval bottle" });

    // Different intents → contextCache misses → both reach the ranker, but the
    // corpus (and thus the BM25 model) is identical → built exactly once.
    expect(__bm25CacheStats().builds).toBe(1);
    // Content-relevant entry still ranks first for both queries (correctness).
    expect(r1.candidates[0]?.stable_id).toBe("KT-DEC-7001");
    expect(r2.candidates.map((c) => c.stable_id).sort()).toEqual(["KT-DEC-7001", "KT-DEC-7002"]);
  });

  it("rebuilds when the corpus revision changes", async () => {
    __resetBm25Cache();
    const p1 = await seedQueryableProject("alpha");
    await planContext(p1, { paths: ["src/x.ts"], intent: "zephyr" });
    expect(__bm25CacheStats().builds).toBe(1);

    const p2 = await seedQueryableProject("beta-distinct-content");
    await planContext(p2, { paths: ["src/x.ts"], intent: "zephyr" });
    expect(__bm25CacheStats().builds).toBe(2);
  });
});

// lifecycle-refactor W3-T2 (§7 图谱消费 / §5 hook 沿 related 二阶召回): planContext
// include_related二阶召回. Seeds a registry where a high-ranking entry declares a
// `related` edge to a low-ranking neighbour that top_k would drop; asserts the
// neighbour is pulled back in + provenance is reported, and the graph-empty path
// stays an honest no-op.
describe("planContext include_related graph二阶召回 (W3-T2)", () => {
  async function seedRelatedRegistry(
    projectRoot: string,
    opts: { topK?: number; withEdge?: boolean } = {},
  ): Promise<void> {
    const withEdge = opts.withEdge !== false;
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    if (opts.topK !== undefined) {
      await writeFile(
        join(projectRoot, "fabric.config.json"),
        `${JSON.stringify({ plan_context_top_k: opts.topK }, null, 2)}\n`,
      );
    }
    // KT-DEC-9201: strongly matches the intent (ranks top). KT-DEC-9202: the
    // neighbour, irrelevant to the intent (ranks last → dropped by topK=1).
    const topic = (id: string, file: string, summary: string, related: string[]) => ({
      stable_id: id,
      file,
      content_ref: file,
      scope_glob: "**",
      hash: `sha256:${id}`,
      identity_source: "declared",
      description: {
        summary,
        intent_clues: [],
        tech_stack: [],
        impact: [],
        must_read_if: "",
        id,
        knowledge_type: "decisions",
        maturity: "verified",
        knowledge_layer: "team",
        created_at: "2026-05-10T00:00:00Z",
        relevance_scope: "broad",
        relevance_paths: [],
        ...(related.length > 0 ? { related } : {}),
      },
    });
    const nodes: Record<string, unknown> = {
      "KT-DEC-9201": topic(
        "KT-DEC-9201",
        ".fabric/knowledge/decisions/auth.md",
        "Authentication token refresh rotation strategy decision",
        withEdge ? ["KT-DEC-9202"] : [],
      ),
      "KT-DEC-9202": topic(
        "KT-DEC-9202",
        ".fabric/knowledge/decisions/colors.md",
        "Palette gradient swatch tints for marketing brochures",
        [],
      ),
    };
    for (const [id, n] of Object.entries(nodes)) {
      const file = (n as { file: string }).file;
      const desc = (n as { description: { summary: string; related?: string[] } }).description;
      const summary = desc.summary;
      // related must live in the frontmatter too — loadActiveMetaOrStale may
      // re-derive the meta from disk, so a meta-only `related` would be dropped.
      const relatedLine =
        desc.related && desc.related.length > 0 ? [`related: [${desc.related.join(", ")}]`] : [];
      await writeFile(
        join(projectRoot, file),
        ["---", `summary: ${summary}`, `id: ${id}`, "type: decision", "maturity: verified", "layer: team", "relevance_scope: broad", "relevance_paths: []", ...relatedLine, "---", `# ${id}`, ""].join("\n"),
      );
    }
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: "rev-related", nodes }, null, 2)}\n`,
    );
  }

  it("appends the one-hop related neighbour dropped by top_k and reports provenance", async () => {
    const projectRoot = await createTempProject();
    await seedRelatedRegistry(projectRoot, { topK: 1, withEdge: true });

    // top_k=1 → only the auth decision survives ranking; its `related` edge to the
    // colors decision pulls that neighbour back in despite ranking last.
    const result = await planContext(projectRoot, {
      paths: ["src/auth.ts"],
      intent: "authentication token refresh rotation",
      include_related: true,
    });

    const ids = result.candidates.map((c) => c.stable_id);
    expect(ids).toContain("KT-DEC-9201"); // surfaced by ranking
    expect(ids).toContain("KT-DEC-9202"); // pulled in via related二阶
    expect(result.related_appended).toEqual({ "KT-DEC-9202": "KT-DEC-9201" });
  });

  it("graph-empty honest no-op: no related edge → no append, field omitted", async () => {
    const projectRoot = await createTempProject();
    await seedRelatedRegistry(projectRoot, { topK: 1, withEdge: false });

    const result = await planContext(projectRoot, {
      paths: ["src/auth.ts"],
      intent: "authentication token refresh rotation",
      include_related: true,
    });

    // top_k=1 + no related edge → only the top-ranked entry, no fake graph append.
    expect(result.candidates.map((c) => c.stable_id)).toEqual(["KT-DEC-9201"]);
    expect(result).not.toHaveProperty("related_appended");
  });

  it("include_related off (default) never appends — byte-identical to pre-W3-T2", async () => {
    const projectRoot = await createTempProject();
    await seedRelatedRegistry(projectRoot, { topK: 1, withEdge: true });

    const result = await planContext(projectRoot, {
      paths: ["src/auth.ts"],
      intent: "authentication token refresh rotation",
    });

    expect(result.candidates.map((c) => c.stable_id)).toEqual(["KT-DEC-9201"]);
    expect(result).not.toHaveProperty("related_appended");
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-plan-context-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}
