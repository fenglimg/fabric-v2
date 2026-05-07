import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { planContext } from "./plan-context.js";
import { readAuditLog } from "./audit-log.js";
import { readEventLedger } from "./event-ledger.js";
import { getRuleSections, parseRuleSections } from "./rule-sections.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("parseRuleSections", () => {
  it("extracts structured sections without falling back to full content", () => {
    const sections = parseRuleSections(`# 规则：对象池规范

## [MISSION_STATEMENT]
- 本脚本只负责资源池生命周期。

## [MANDATORY_INJECTION]
- 必须在 onDestroy 中执行 unuse 逻辑。

## [BUSINESS_LOGIC_CHUNKS]
### ID: BL-CC-POOL-001
- **Anchor**: \`BL-CC-POOL-001\`
- **Intent**: 保持资源释放顺序稳定。
- **Scars**: 连续 Tab 切换曾出现黑屏。
- **Constraint**: 必须延迟一帧释放资源。

## [CONTEXT_INFO]
- 此规则关联到：assets/scripts/core/PoolManager.ts

## 普通说明
不应该进入结构化 section。
`);

    expect(sections.get("MISSION_STATEMENT")).toBe("- 本脚本只负责资源池生命周期。");
    expect(sections.get("MANDATORY_INJECTION")).toBe("- 必须在 onDestroy 中执行 unuse 逻辑。");
    expect(sections.get("BUSINESS_LOGIC_CHUNKS")).toContain("BL-CC-POOL-001");
    expect(sections.get("CONTEXT_INFO")).toBe("- 此规则关联到：assets/scripts/core/PoolManager.ts");
    expect(Array.from(sections.keys())).not.toContain("普通说明");
  });

  it("merges duplicate structured headings in document order", () => {
    const sections = parseRuleSections(`## [MANDATORY_INJECTION]
first

## [CONTEXT_INFO]
context

### [MANDATORY_INJECTION]
second
`);

    expect(sections.get("MANDATORY_INJECTION")).toBe("first\n\nsecond");
  });
});

describe("getRuleSections", () => {
  it("merges required L0/L2 with AI-selected L1 and returns requested sections", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });

    const result = await getRuleSections(projectRoot, {
      selection_token: plan.selection_token,
      sections: ["MISSION_STATEMENT", "MANDATORY_INJECTION", "BUSINESS_LOGIC_CHUNKS", "CONTEXT_INFO"],
      ai_selected_stable_ids: ["ui-batch-rendering"],
      ai_selection_reasons: {
        "ui-batch-rendering": "BattleView.ts touches UI rendering nodes and labels.",
      },
      correlation_id: "corr-sections",
      session_id: "session-sections",
    });

    expect(result.revision_hash).toBe("rev-sections");
    expect(result.precedence).toEqual(["L2", "L1", "L0"]);
    expect(result.selected_stable_ids).toEqual(["global-protocol", "ui-batch-rendering", "battle-view-local"]);
    expect(result.rules).toEqual([
      expect.objectContaining({
        stable_id: "global-protocol",
        level: "L0",
        sections: {
          MISSION_STATEMENT: "",
          MANDATORY_INJECTION: "Global mandatory.",
          BUSINESS_LOGIC_CHUNKS: "",
          CONTEXT_INFO: "",
        },
      }),
      expect.objectContaining({
        stable_id: "ui-batch-rendering",
        level: "L1",
        sections: {
          MISSION_STATEMENT: "",
          MANDATORY_INJECTION: "UI mandatory.",
          BUSINESS_LOGIC_CHUNKS: "",
          CONTEXT_INFO: "UI context.",
        },
      }),
      expect.objectContaining({
        stable_id: "battle-view-local",
        level: "L2",
        sections: {
          MISSION_STATEMENT: "BattleView owns combat UI lifecycle boundaries.",
          MANDATORY_INJECTION: "BattleView mandatory.",
          BUSINESS_LOGIC_CHUNKS: [
            "### ID: BL-BATTLE-001",
            "- **Anchor**: `BL-BATTLE-001`",
            "- **Intent**: Avoid flicker when tabs switch quickly.",
            "- **Scars**: Releasing assets immediately caused black frames.",
            "- **Constraint**: Keep delayed release.",
          ].join("\n"),
          CONTEXT_INFO: "BattleView context.",
        },
      }),
    ]);
    expect(result.diagnostics).toEqual([
      {
        code: "missing_section",
        severity: "warn",
        stable_id: "global-protocol",
        section: "MISSION_STATEMENT",
        message: "Rule global-protocol does not define section MISSION_STATEMENT.",
      },
      {
        code: "missing_section",
        severity: "warn",
        stable_id: "global-protocol",
        section: "BUSINESS_LOGIC_CHUNKS",
        message: "Rule global-protocol does not define section BUSINESS_LOGIC_CHUNKS.",
      },
      {
        code: "missing_section",
        severity: "warn",
        stable_id: "global-protocol",
        section: "CONTEXT_INFO",
        message: "Rule global-protocol does not define section CONTEXT_INFO.",
      },
      {
        code: "missing_section",
        severity: "warn",
        stable_id: "ui-batch-rendering",
        section: "MISSION_STATEMENT",
        message: "Rule ui-batch-rendering does not define section MISSION_STATEMENT.",
      },
      {
        code: "missing_section",
        severity: "warn",
        stable_id: "ui-batch-rendering",
        section: "BUSINESS_LOGIC_CHUNKS",
        message: "Rule ui-batch-rendering does not define section BUSINESS_LOGIC_CHUNKS.",
      },
    ]);
    expect(await readAuditLog(projectRoot)).toEqual([
      expect.objectContaining({
        kind: "audit-event",
        event: "get_rules",
        path: "assets/scripts/ui/BattleView.ts",
      }),
      expect.objectContaining({
        kind: "audit-event",
        event: "rule_selection",
        path: "assets/scripts/ui/BattleView.ts",
        target_paths: ["assets/scripts/ui/BattleView.ts"],
        required_stable_ids: ["global-protocol", "battle-view-local"],
        ai_selectable_stable_ids: ["ui-batch-rendering"],
        ai_selected_stable_ids: ["ui-batch-rendering"],
        final_stable_ids: ["global-protocol", "ui-batch-rendering", "battle-view-local"],
        ai_selection_reasons: {
          "ui-batch-rendering": "BattleView.ts touches UI rendering nodes and labels.",
        },
        rejected_stable_ids: [],
        ignored_stable_ids: [],
      }),
    ]);
    expect((await readEventLedger(projectRoot)).events).toEqual([
      expect.objectContaining({
        event_type: "rule_context_planned",
        target_paths: ["assets/scripts/ui/BattleView.ts"],
      }),
      expect.objectContaining({
        event_type: "rule_selection",
        selection_token: plan.selection_token,
        target_paths: ["assets/scripts/ui/BattleView.ts"],
        required_stable_ids: ["global-protocol", "battle-view-local"],
        ai_selectable_stable_ids: ["ui-batch-rendering"],
        ai_selected_stable_ids: ["ui-batch-rendering"],
        final_stable_ids: ["global-protocol", "ui-batch-rendering", "battle-view-local"],
        ai_selection_reasons: {
          "ui-batch-rendering": "BattleView.ts touches UI rendering nodes and labels.",
        },
        correlation_id: "corr-sections",
        session_id: "session-sections",
      }),
      expect.objectContaining({
        event_type: "rule_sections_fetched",
        selection_token: plan.selection_token,
        target_paths: ["assets/scripts/ui/BattleView.ts"],
        requested_sections: ["MISSION_STATEMENT", "MANDATORY_INJECTION", "BUSINESS_LOGIC_CHUNKS", "CONTEXT_INFO"],
        final_stable_ids: ["global-protocol", "ui-batch-rendering", "battle-view-local"],
        ai_selected_stable_ids: ["ui-batch-rendering"],
        diagnostics: result.diagnostics,
        correlation_id: "corr-sections",
        session_id: "session-sections",
      }),
    ]);
  });

  it("hard-errors invalid L1 selections and missing AI selection reasons", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });

    await expect(getRuleSections(projectRoot, {
      selection_token: plan.selection_token,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["unknown-l1"],
      ai_selection_reasons: { "unknown-l1": "not selectable" },
    })).rejects.toThrow(/Invalid L1 rule selection/u);

    await expect(getRuleSections(projectRoot, {
      selection_token: plan.selection_token,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["ui-batch-rendering"],
      ai_selection_reasons: {},
    })).rejects.toThrow(/Missing AI selection reason/u);

    await expect(getRuleSections(projectRoot, {
      selection_token: plan.selection_token,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["global-protocol"],
      ai_selection_reasons: { "global-protocol": "L0 cannot be selected by AI." },
    })).rejects.toThrow(/Invalid L1 rule selection/u);
  });

  it("hard-errors missing or expired selection tokens", async () => {
    const projectRoot = await createSectionProject();

    await expect(getRuleSections(projectRoot, {
      selection_token: "missing",
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: [],
      ai_selection_reasons: {},
    })).rejects.toThrow(/selection_token is missing or expired/u);
  });

  it("sorts priority only within the same layer while keeping deterministic final order", async () => {
    const projectRoot = await createSectionProject({
      extraL1: true,
    });
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });

    const result = await getRuleSections(projectRoot, {
      selection_token: plan.selection_token,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["ui-low-priority", "ui-batch-rendering"],
      ai_selection_reasons: {
        "ui-low-priority": "Also touches UI rendering.",
        "ui-batch-rendering": "Primary UI rendering rule.",
      },
    });

    expect(result.precedence).toEqual(["L2", "L1", "L0"]);
    expect(result.selected_stable_ids).toEqual([
      "global-protocol",
      "ui-batch-rendering",
      "ui-low-priority",
      "battle-view-local",
    ]);
  });
});

async function createSectionProject(options: { extraL1?: boolean } = {}): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-rule-sections-"));
  tempDirs.push(projectRoot);

  await mkdir(join(projectRoot, ".fabric", "rules"), { recursive: true });
  await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
  await writeFile(join(projectRoot, ".fabric", "rules", "global.md"), `# Global

## [MANDATORY_INJECTION]
Global mandatory.
`);
  await writeFile(join(projectRoot, ".fabric", "rules", "ui.md"), `# UI

## [MANDATORY_INJECTION]
UI mandatory.

## [CONTEXT_INFO]
UI context.
`);
  await writeFile(join(projectRoot, ".fabric", "rules", "battle-view.md"), `# Battle

## [MISSION_STATEMENT]
BattleView owns combat UI lifecycle boundaries.

## [MANDATORY_INJECTION]
BattleView mandatory.

## [BUSINESS_LOGIC_CHUNKS]
### ID: BL-BATTLE-001
- **Anchor**: \`BL-BATTLE-001\`
- **Intent**: Avoid flicker when tabs switch quickly.
- **Scars**: Releasing assets immediately caused black frames.
- **Constraint**: Keep delayed release.

## [CONTEXT_INFO]
BattleView context.
`);
  if (options.extraL1 === true) {
    await writeFile(join(projectRoot, ".fabric", "rules", "ui-low.md"), `# UI Low

## [MANDATORY_INJECTION]
UI low mandatory.
`);
  }
  await writeFile(
    join(projectRoot, ".fabric", "agents.meta.json"),
    `${JSON.stringify({
      revision: "rev-sections",
      nodes: {
        "L0/global": ruleNode("global-protocol", "L0", ".fabric/rules/global.md", "**"),
        "L1/ui": ruleNode("ui-batch-rendering", "L1", ".fabric/rules/ui.md", "**"),
        ...(options.extraL1 === true
          ? {
              "L1/ui-low": {
                ...ruleNode("ui-low-priority", "L1", ".fabric/rules/ui-low.md", "**"),
                priority: "low",
              },
            }
          : {}),
        "L2/battle-view": ruleNode(
          "battle-view-local",
          "L2",
          ".fabric/rules/battle-view.md",
          "assets/scripts/ui/BattleView.ts",
        ),
      },
    }, null, 2)}\n`,
  );

  return projectRoot;
}

function ruleNode(stableId: string, level: "L0" | "L1" | "L2", file: string, scopeGlob: string) {
  return {
    stable_id: stableId,
    file,
    content_ref: file,
    scope_glob: scopeGlob,
    deps: [],
    priority: "medium",
    level,
    layer: level,
    topology_type: level === "L0" ? "global" : level === "L1" ? "domain" : "local",
    hash: `sha256:${stableId}`,
    description: {
      summary: stableId,
      intent_clues: [],
      tech_stack: [],
      impact: [],
      must_read_if: stableId,
    },
  };
}
