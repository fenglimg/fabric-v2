import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

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
    await mkdir(join(projectRoot, ".fabric", "rules"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(join(projectRoot, ".fabric", "rules", "global.md"), "# Global\n");
    await writeFile(join(projectRoot, ".fabric", "rules", "ui.md"), "# UI\n");
    await writeFile(join(projectRoot, ".fabric", "rules", "battle-view.md"), "# Battle View\n");
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-neutral",
        nodes: {
          "L0/global": {
            stable_id: "global-protocol",
            file: ".fabric/rules/global.md",
            content_ref: ".fabric/rules/global.md",
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
            file: ".fabric/rules/ui.md",
            content_ref: ".fabric/rules/ui.md",
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
            file: ".fabric/rules/battle-view.md",
            content_ref: ".fabric/rules/battle-view.md",
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
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-plan-context-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}
