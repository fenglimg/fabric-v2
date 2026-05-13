import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { planContext } from "./plan-context.js";

const tempDirs: string[] = [];

afterEach(async () => {
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
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "global.md"), "# Global\n");
    await writeFile(join(projectRoot, ".fabric", "knowledge", "guidelines", "ui.md"), "# UI\n");
    await writeFile(join(projectRoot, ".fabric", "knowledge", "guidelines", "battle-view.md"), "# Battle View\n");
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

    expect(result.revision_hash).toBe("rev-neutral");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.path).toBe("src/index.ts");
    expect(result.entries[0]?.requirement_profile).toMatchObject({
      target_path: "src/index.ts",
      extension: ".ts",
      user_intent: "rendering tweak",
      known_tech: ["TypeScript"],
      detected_entities: ["Renderer"],
    });

    // v2.0-rc.5 A3 (TASK-007): Cocos-era fields removed from the profile.
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("inferred_domain");
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("intent_tokens");
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("impact_hints");

    // L0/L1/L2 selection ceremony fields removed from the per-entry shape.
    expect(result.entries[0]).not.toHaveProperty("required_stable_ids");
    expect(result.entries[0]).not.toHaveProperty("ai_selectable_stable_ids");
    expect(result.entries[0]).not.toHaveProperty("initial_selected_stable_ids");
    expect(result.entries[0]).not.toHaveProperty("selection_policy");

    // Same fields gone from `shared` too.
    expect(result.shared).not.toHaveProperty("required_stable_ids");
    expect(result.shared).not.toHaveProperty("ai_selectable_stable_ids");

    const index = result.entries[0]?.description_index ?? [];
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

    expect(result.revision_hash).toBe("rev-current");
    expect(result.stale).toBe(true);
    expect(result.entries).toEqual([
      {
        path: "src/index.ts",
        description_index: [],
        requirement_profile: expect.objectContaining({ target_path: "src/index.ts" }),
      },
    ]);
    expect(result.shared.description_index).toEqual([]);
    expect(result.shared.preflight_diagnostics).toEqual([]);
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
              knowledge_type: "decision",
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
              knowledge_type: "guideline",
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
    const indexById = new Map(result.shared.description_index.map((item) => [item.stable_id, item] as const));

    expect(indexById.get("KT-DEC-0001")).toMatchObject({
      type: "decision",
      maturity: "verified",
      layer: "team",
      layer_reason: "shared across services",
    });

    expect(indexById.get("KP-GLD-0001")).toMatchObject({
      type: "guideline",
      maturity: "draft",
      layer: "personal",
    });

    expect(indexById.get("legacy-v1")).toMatchObject({
      type: undefined,
      maturity: undefined,
      layer: "team",
    });
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
          knowledge_type: "decision",
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
    expect(result.shared.description_index).toHaveLength(5);
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
    for (let i = 0; i < 100; i += 1) {
      const id = `KT-DEC-${String(i + 1).padStart(4, "0")}`;
      const file = `.fabric/knowledge/decisions/d${i + 1}.md`;
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
          knowledge_type: "decision",
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

    expect(result.selection_token).toEqual(expect.any(String));
    expect(result.shared.description_index).toHaveLength(100);
    expect(result).not.toHaveProperty("candidates_full_content");
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
    await writeFile(join(projectRoot, ".fabric", "knowledge", "guidelines", "broad.md"), "# Broad\n");
    await writeFile(join(projectRoot, ".fabric", "knowledge", "guidelines", "ui-narrow.md"), "# UI Narrow\n");
    await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "auth-narrow.md"), "# Auth Narrow\n");
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
              knowledge_type: "guideline",
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
              knowledge_type: "guideline",
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
              knowledge_type: "decision",
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

  it("test_plan_context_filter_broad_always_included — broad entries pass any target_paths", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    // No glob matches any of the narrow entries.
    const result = await planContext(projectRoot, {
      paths: ["src/unrelated/index.ts"],
      target_paths: ["src/unrelated/index.ts"],
    });
    const ids = result.shared.description_index.map((item) => item.stable_id);
    expect(ids).toContain("KT-GLD-0001"); // broad always
    expect(ids).not.toContain("KT-GLD-0002"); // narrow filtered out
    expect(ids).not.toContain("KT-DEC-0001"); // narrow filtered out
  });

  it("test_plan_context_filter_narrow_matched_path — narrow entries pass when relevance_paths matches", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    const result = await planContext(projectRoot, {
      paths: ["src/ui/Button.tsx"],
      target_paths: ["src/ui/Button.tsx"],
    });
    const ids = result.shared.description_index.map((item) => item.stable_id).sort();
    // Broad + ui-narrow match; auth-narrow does not.
    expect(ids).toEqual(["KT-GLD-0001", "KT-GLD-0002"]);
  });

  it("test_plan_context_filter_narrow_unmatched_excluded — non-matching narrow entries excluded", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    const result = await planContext(projectRoot, {
      paths: ["src/auth/login.ts"],
      target_paths: ["src/auth/login.ts"],
    });
    const ids = result.shared.description_index.map((item) => item.stable_id).sort();
    // Broad + auth-narrow match; ui-narrow does not.
    expect(ids).toEqual(["KT-DEC-0001", "KT-GLD-0001"]);
  });

  it("test_plan_context_no_paths_returns_all — empty target_paths fails open (narrow included)", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    // Explicit empty target_paths → fail-open: include broad AND every narrow.
    const result = await planContext(projectRoot, {
      paths: ["**"],
      target_paths: [],
    });
    const ids = result.shared.description_index.map((item) => item.stable_id).sort();
    expect(ids).toEqual(["KT-DEC-0001", "KT-GLD-0001", "KT-GLD-0002"]);
  });

  it("test_plan_context_filter_dir_anchor_match — relevance_paths ending in / matches via /** expansion", async () => {
    const projectRoot = await createTempProject();
    await seedRelevanceRegistry(projectRoot);

    // packages/ui/ in registry → packages/ui/** under the hood.
    const result = await planContext(projectRoot, {
      paths: ["packages/ui/Card.tsx"],
      target_paths: ["packages/ui/Card.tsx"],
    });
    const ids = result.shared.description_index.map((item) => item.stable_id).sort();
    expect(ids).toEqual(["KT-GLD-0001", "KT-GLD-0002"]);
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
              knowledge_type: "decision",
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
    expect(result.shared).not.toHaveProperty("required_stable_ids");
    expect(result.shared).not.toHaveProperty("ai_selectable_stable_ids");
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-plan-context-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}
