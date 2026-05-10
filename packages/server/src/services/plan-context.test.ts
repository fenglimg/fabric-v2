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
  it("returns a neutral requirement profile, description index, and selection token", async () => {
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
          "L0/global": {
            stable_id: "global-protocol",
            file: ".fabric/knowledge/decisions/global.md",
            content_ref: ".fabric/knowledge/decisions/global.md",
            scope_glob: "**",
            deps: [],
            priority: "high",
            level: "L0",
            layer: "L0",
            topology_type: "global",
            hash: "sha256:global",
            description: {
              summary: "Global protocol",
              intent_clues: ["协作稳定"],
              tech_stack: ["Fabric"],
              impact: ["Governance"],
              must_read_if: "任何编辑前",
            },
          },
          "L1/ui": {
            stable_id: "ui-batch-rendering",
            file: ".fabric/knowledge/guidelines/ui.md",
            content_ref: ".fabric/knowledge/guidelines/ui.md",
            scope_glob: "**",
            deps: ["L0/global"],
            priority: "medium",
            level: "L1",
            layer: "L1",
            topology_type: "domain",
            hash: "sha256:ui",
            description: {
              summary: "UI batch rendering",
              intent_clues: ["优化 drawcall", "Label 闪烁"],
              tech_stack: ["Cocos", "UI"],
              impact: ["Performance"],
              must_read_if: "修改多个 UI 节点的层级或混合模式时",
            },
          },
          "L2/battle-view": {
            stable_id: "battle-view-local",
            file: ".fabric/knowledge/guidelines/battle-view.md",
            content_ref: ".fabric/knowledge/guidelines/battle-view.md",
            scope_glob: "assets/scripts/ui/BattleView.ts",
            deps: ["L0/global"],
            priority: "medium",
            level: "L2",
            layer: "L2",
            topology_type: "local",
            hash: "sha256:battle",
            description: {
              summary: "BattleView local lifecycle",
              intent_clues: ["BattleView"],
              tech_stack: ["Cocos", "UI"],
              impact: ["Correctness"],
              must_read_if: "修改 BattleView.ts 时",
            },
          },
        },
      }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, {
      paths: ["assets/scripts/ui/BattleView.ts"],
      intent: "我想优化战斗界面的渲染性能",
      known_tech: ["Cocos Creator", "TypeScript"],
      detected_entities: {
        "assets/scripts/ui/BattleView.ts": ["cc.Label", "SpriteAtlas", "Layout"],
      },
      correlation_id: "corr-plan",
      session_id: "session-plan",
    });

    expect(result.revision_hash).toBe("rev-neutral");
    expect(result.selection_token).toEqual(expect.any(String));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      path: "assets/scripts/ui/BattleView.ts",
      required_stable_ids: ["global-protocol", "battle-view-local"],
      ai_selectable_stable_ids: ["ui-batch-rendering"],
      initial_selected_stable_ids: ["global-protocol", "battle-view-local"],
    });
    expect(result.entries[0]?.requirement_profile).toMatchObject({
      target_path: "assets/scripts/ui/BattleView.ts",
      extension: ".ts",
      user_intent: "我想优化战斗界面的渲染性能",
      known_tech: ["Cocos Creator", "TypeScript"],
      detected_entities: ["cc.Label", "SpriteAtlas", "Layout"],
    });
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("score");
    expect(result.entries[0]?.requirement_profile).not.toHaveProperty("match_reasons");

    const index = result.entries[0]?.description_index ?? [];
    expect(index).toEqual([
      expect.objectContaining({
        stable_id: "global-protocol",
        level: "L0",
        required: true,
        selectable: false,
      }),
      expect.objectContaining({
        stable_id: "ui-batch-rendering",
        level: "L1",
        required: false,
        selectable: true,
      }),
      expect.objectContaining({
        stable_id: "battle-view-local",
        level: "L2",
        required: true,
        selectable: false,
      }),
    ]);
    for (const item of index) {
      expect(item).not.toHaveProperty("score");
      expect(item).not.toHaveProperty("confidence");
      expect(item).not.toHaveProperty("match_reasons");
      expect(item).not.toHaveProperty("negative_reasons");
      expect(item).not.toHaveProperty("matched_profile_fields");
      expect(item.description).not.toHaveProperty("id");
    }
    expect(result.shared.required_stable_ids).toEqual(["global-protocol", "battle-view-local"]);
    expect(result.shared.ai_selectable_stable_ids).toEqual(["ui-batch-rendering"]);
    expect((await readEventLedger(projectRoot, { event_type: "knowledge_context_planned" })).events).toEqual([
      expect.objectContaining({
        event_type: "knowledge_context_planned",
        target_paths: ["assets/scripts/ui/BattleView.ts"],
        required_stable_ids: ["global-protocol", "battle-view-local"],
        ai_selectable_stable_ids: ["ui-batch-rendering"],
        final_stable_ids: ["global-protocol", "battle-view-local"],
        selection_token: result.selection_token,
        intent: "我想优化战斗界面的渲染性能",
        known_tech: ["Cocos Creator", "TypeScript"],
        diagnostics: [],
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

    expect(result).toMatchObject({
      revision_hash: "rev-current",
      stale: true,
      entries: [
        {
          path: "src/index.ts",
          required_stable_ids: [],
          ai_selectable_stable_ids: [],
          initial_selected_stable_ids: [],
          description_index: [],
        },
      ],
      shared: {
        required_stable_ids: [],
        ai_selectable_stable_ids: [],
        description_index: [],
        preflight_diagnostics: [],
      },
    });
    expect(result.selection_token).toEqual(expect.any(String));
  });

  // ---------------------------------------------------------------------------
  // v2.0 dual-root knowledge-field passthrough (TASK-005)
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
          // Team entry with full v2.0 frontmatter.
          "L1/team/decisions/team-auth": {
            stable_id: "KT-DEC-0001",
            file: ".fabric/knowledge/decisions/team-auth.md",
            content_ref: ".fabric/knowledge/decisions/team-auth.md",
            scope_glob: "**",
            deps: [],
            priority: "medium",
            level: "L1",
            layer: "L1",
            topology_type: "domain",
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
          // Personal entry — exercise the personal `~/.fabric/knowledge/`
          // content_ref + frontmatter-set layer.
          "L1/personal/guidelines/personal-style": {
            stable_id: "KP-GLD-0001",
            file: "~/.fabric/knowledge/guidelines/personal-style.md",
            content_ref: "~/.fabric/knowledge/guidelines/personal-style.md",
            scope_glob: "**",
            deps: [],
            priority: "medium",
            level: "L1",
            layer: "L1",
            topology_type: "domain",
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
          // v1.x legacy entry — no knowledge frontmatter at all. Layer should
          // be inferred from the team-root content_ref.
          "L1/team/legacy": {
            stable_id: "legacy-v1",
            file: ".fabric/knowledge/pending/legacy.md",
            content_ref: ".fabric/knowledge/pending/legacy.md",
            scope_glob: "**",
            deps: [],
            priority: "medium",
            level: "L1",
            layer: "L1",
            topology_type: "domain",
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

    // v2.0 team entry: frontmatter fields surface at top level + inside description.
    expect(indexById.get("KT-DEC-0001")).toMatchObject({
      type: "decision",
      maturity: "verified",
      layer: "team",
      layer_reason: "shared across services",
      description: expect.objectContaining({
        knowledge_type: "decision",
        knowledge_layer: "team",
      }),
    });

    // v2.0 personal entry — same shape, layer=personal.
    expect(indexById.get("KP-GLD-0001")).toMatchObject({
      type: "guideline",
      maturity: "draft",
      layer: "personal",
      description: expect.objectContaining({
        knowledge_type: "guideline",
        knowledge_layer: "personal",
      }),
    });

    // v1.x legacy: no top-level type/maturity, but layer is inferred from the
    // team-root content_ref so MCP clients still see SOMETHING.
    expect(indexById.get("legacy-v1")).toMatchObject({
      type: undefined,
      maturity: undefined,
      layer: "team",
    });
  });

  it("accepts include_deprecated input flag — wiring is in place for future MaturitySchema expansion", async () => {
    // include_deprecated is a no-op placeholder today: TASK-002 MaturitySchema
    // is draft|verified|proven only, so no entry can carry a 'deprecated'
    // value through the strict meta parse. We exercise the input wiring here
    // so future expansion does not need a protocol break — the planContext
    // call must accept the flag (default false / true) without error and
    // return a stable index either way.
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-deprecated-wiring",
        nodes: {
          "L1/team/active": {
            stable_id: "active-rule",
            file: ".fabric/knowledge/decisions/active.md",
            content_ref: ".fabric/knowledge/decisions/active.md",
            scope_glob: "**",
            deps: [],
            priority: "medium",
            level: "L1",
            layer: "L1",
            topology_type: "domain",
            hash: "sha256:active",
            description: {
              summary: "Active rule",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "Active rule",
              maturity: "verified",
            },
          },
        },
      }, null, 2)}\n`,
    );

    const defaultResult = await planContext(projectRoot, { paths: ["src/index.ts"] });
    expect(defaultResult.shared.description_index.map((item) => item.stable_id)).toEqual(["active-rule"]);

    const allResult = await planContext(projectRoot, {
      paths: ["src/index.ts"],
      include_deprecated: true,
    });
    expect(allResult.shared.description_index.map((item) => item.stable_id)).toEqual(["active-rule"]);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-plan-context-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}
