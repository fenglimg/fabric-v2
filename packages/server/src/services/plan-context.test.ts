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

    // Degenerate single-stage mode: 2 entries ≤ 30 ⇒ candidates_full_content
    // populated, selection_token omitted.
    expect(result.candidates_full_content).toBeDefined();
    expect(result.candidates_full_content?.map((c) => c.stable_id).sort()).toEqual(
      ["global-protocol", "ui-batch-rendering"],
    );
    expect(result.selection_token).toBeUndefined();

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
    // Empty index ≤ 30 ⇒ degenerate mode (token omitted, empty inline payload).
    expect(result.selection_token).toBeUndefined();
    expect(result.candidates_full_content).toEqual([]);
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
  // v2.0-rc.5 A3 (TASK-007): degenerate vs two-stage mode + Cocos field removal
  // ---------------------------------------------------------------------------

  it("test_plan_context_degenerate_mode_le30 — ≤30 entries returns candidates_full_content and omits selection_token", async () => {
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
      `${JSON.stringify({ revision: "rev-degenerate", nodes }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    expect(result.selection_token).toBeUndefined();
    expect(result.candidates_full_content).toBeDefined();
    expect(result.candidates_full_content).toHaveLength(5);
    expect(result.candidates_full_content?.[0]?.content).toContain("Body for KT-DEC-0001");
    // Every candidate carries a non-empty body.
    for (const candidate of result.candidates_full_content ?? []) {
      expect(candidate.content.length).toBeGreaterThan(0);
    }
  });

  it("test_plan_context_two_stage_gt30 — >30 entries retains selection_token and omits candidates_full_content", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);

    const nodes: Record<string, unknown> = {};
    // 31 stub entries → just above the degenerate threshold (30). No file
    // bodies needed because two-stage mode does not pre-read content.
    for (let i = 0; i < 31; i += 1) {
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
      `${JSON.stringify({ revision: "rev-two-stage", nodes }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });

    expect(result.selection_token).toEqual(expect.any(String));
    expect(result.candidates_full_content).toBeUndefined();
    expect(result.shared.description_index).toHaveLength(31);
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
