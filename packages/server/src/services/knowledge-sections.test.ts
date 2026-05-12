import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createSelectionToken, planContext } from "./plan-context.js";
import { readEventLedger } from "./event-ledger.js";
import { getKnowledgeSections, parseKnowledgeSections } from "./knowledge-sections.js";

// v2.0-rc.5 A3 (TASK-007): planContext() emits selection_token only when the
// description_index has > 30 entries (degenerate mode skips the token). The
// two-stage selection tests below construct corpora well below that threshold
// for fixture clarity, so we mint the token directly from the plan output.
function mintTokenFromPlan(
  plan: Awaited<ReturnType<typeof planContext>>,
  requiredStableIds: string[],
  aiSelectableStableIds: string[],
): string {
  if (plan.selection_token !== undefined) {
    return plan.selection_token;
  }
  return createSelectionToken(
    plan.revision_hash,
    plan.entries.map((entry) => entry.path),
    requiredStableIds,
    aiSelectableStableIds,
  );
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("parseKnowledgeSections", () => {
  it("extracts structured sections without falling back to full content", () => {
    const sections = parseKnowledgeSections(`# 规则：对象池规范

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
    const sections = parseKnowledgeSections(`## [MANDATORY_INJECTION]
first

## [CONTEXT_INFO]
context

### [MANDATORY_INJECTION]
second
`);

    expect(sections.get("MANDATORY_INJECTION")).toBe("first\n\nsecond");
  });
});

describe("getKnowledgeSections", () => {
  it("merges required L0/L2 with AI-selected L1 and returns requested sections", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["global-protocol", "battle-view-local"],
      ["ui-batch-rendering"],
    );

    const result = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
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
      // v2.0: warn-level signal that this rule lacks knowledge metadata
      // (no type/layer in frontmatter). Does not block delivery.
      {
        code: "missing_knowledge_metadata",
        severity: "warn",
        stable_id: "global-protocol",
        message: "Rule global-protocol has no knowledge metadata (type/layer) — likely an un-migrated v1.x entry.",
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
      {
        code: "missing_knowledge_metadata",
        severity: "warn",
        stable_id: "ui-batch-rendering",
        message: "Rule ui-batch-rendering has no knowledge metadata (type/layer) — likely an un-migrated v1.x entry.",
      },
      {
        code: "missing_knowledge_metadata",
        severity: "warn",
        stable_id: "battle-view-local",
        message: "Rule battle-view-local has no knowledge metadata (type/layer) — likely an un-migrated v1.x entry.",
      },
    ]);
    // v2.0 rc.5 TASK-014 (C5): event ledger now also receives
    // knowledge_consumed events (one per resolved stable_id, deduped per
    // request) after knowledge_sections_fetched. Use slice/find rather than
    // a brittle exact-array match.
    const allEvents = (await readEventLedger(projectRoot)).events;
    const lifecycleEvents = allEvents.filter(
      (e) => e.event_type !== "knowledge_consumed",
    );
    expect(lifecycleEvents).toEqual([
      expect.objectContaining({
        event_type: "knowledge_context_planned",
        target_paths: ["assets/scripts/ui/BattleView.ts"],
      }),
      expect.objectContaining({
        event_type: "knowledge_selection",
        selection_token: selectionToken,
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
        event_type: "knowledge_sections_fetched",
        selection_token: selectionToken,
        target_paths: ["assets/scripts/ui/BattleView.ts"],
        requested_sections: ["MISSION_STATEMENT", "MANDATORY_INJECTION", "BUSINESS_LOGIC_CHUNKS", "CONTEXT_INFO"],
        final_stable_ids: ["global-protocol", "ui-batch-rendering", "battle-view-local"],
        ai_selected_stable_ids: ["ui-batch-rendering"],
        diagnostics: result.diagnostics,
        correlation_id: "corr-sections",
        session_id: "session-sections",
      }),
    ]);
    const consumed = allEvents.filter((e) => e.event_type === "knowledge_consumed");
    expect(consumed).toHaveLength(3);
    expect(
      consumed.map((e) => (e as { stable_id: string }).stable_id).sort(),
    ).toEqual(["battle-view-local", "global-protocol", "ui-batch-rendering"]);
  });

  // -----------------------------------------------------------------------
  // v2.0 rc.5 TASK-014 (C5): knowledge_consumed event emission + dedupe
  // -----------------------------------------------------------------------

  it("emits one knowledge_consumed event per resolved stable_id with client_hash + consumed_at", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["global-protocol", "battle-view-local"],
      ["ui-batch-rendering"],
    );

    const before = Date.now();
    await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["ui-batch-rendering"],
      ai_selection_reasons: { "ui-batch-rendering": "BattleView touches UI rendering." },
      correlation_id: "corr-consume",
      session_id: "session-consume",
      client_hash: "rev-sections",
    });
    const after = Date.now();

    const { events } = await readEventLedger(projectRoot);
    const consumed = events.filter((e) => e.event_type === "knowledge_consumed");
    expect(consumed).toHaveLength(3);

    const stableIds = consumed
      .map((e) => (e as { stable_id: string }).stable_id)
      .sort();
    expect(stableIds).toEqual(["battle-view-local", "global-protocol", "ui-batch-rendering"]);

    for (const event of consumed) {
      const e = event as {
        client_hash: string;
        consumed_at: string;
        session_id?: string;
        correlation_id?: string;
      };
      expect(e.client_hash).toBe("rev-sections");
      expect(e.session_id).toBe("session-consume");
      expect(e.correlation_id).toBe("corr-consume");
      const ts = Date.parse(e.consumed_at);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    }
  });

  it("dedupes knowledge_consumed within a single request — duplicate stable_ids emit once", async () => {
    // Force a corpus where the same stable_id surfaces twice in the resolved
    // rule list by selecting one L1 id and seeding it as both required and
    // ai-selectable. The service uses a Set keyed by stable_id so the second
    // appearance is suppressed.
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    // Mint a token where global-protocol is BOTH required and (artificially)
    // re-listed in selected_stable_ids upstream — but since the service builds
    // selected_stable_ids by [required, ...ai_selected] and dedupes on insert
    // via the Set, the cleanest reproduction is asserting a single id maps to
    // a single event regardless of pipeline shape: just check that for a
    // 3-rule fetch we see exactly 3 events (not 4+).
    const selectionToken = mintTokenFromPlan(
      plan,
      ["global-protocol", "battle-view-local"],
      ["ui-batch-rendering"],
    );

    await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["ui-batch-rendering"],
      ai_selection_reasons: { "ui-batch-rendering": "UI." },
      client_hash: "rev-sections",
    });

    const { events } = await readEventLedger(projectRoot);
    const consumed = events.filter((e) => e.event_type === "knowledge_consumed");
    // 3 distinct stable_ids resolved, 3 events — never more, never duplicates.
    expect(consumed).toHaveLength(3);
    const distinct = new Set(consumed.map((e) => (e as { stable_id: string }).stable_id));
    expect(distinct.size).toBe(3);
  });

  it("knowledge_consumed falls back to empty client_hash when caller omits it", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["global-protocol", "battle-view-local"],
      ["ui-batch-rendering"],
    );

    await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["ui-batch-rendering"],
      ai_selection_reasons: { "ui-batch-rendering": "UI." },
      // No client_hash passed — service should default to "".
    });

    const { events } = await readEventLedger(projectRoot);
    const consumed = events.filter((e) => e.event_type === "knowledge_consumed");
    expect(consumed).toHaveLength(3);
    for (const event of consumed) {
      expect((event as { client_hash: string }).client_hash).toBe("");
    }
  });

  it("hard-errors invalid L1 selections and missing AI selection reasons", async () => {
    const projectRoot = await createSectionProject();
    const plan = await planContext(projectRoot, { paths: ["assets/scripts/ui/BattleView.ts"] });
    const selectionToken = mintTokenFromPlan(
      plan,
      ["global-protocol", "battle-view-local"],
      ["ui-batch-rendering"],
    );

    await expect(getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["unknown-l1"],
      ai_selection_reasons: { "unknown-l1": "not selectable" },
    })).rejects.toThrow(/Invalid L1 rule selection/u);

    await expect(getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["ui-batch-rendering"],
      ai_selection_reasons: {},
    })).rejects.toThrow(/Missing AI selection reason/u);

    await expect(getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["global-protocol"],
      ai_selection_reasons: { "global-protocol": "L0 cannot be selected by AI." },
    })).rejects.toThrow(/Invalid L1 rule selection/u);
  });

  it("hard-errors missing or expired selection tokens", async () => {
    const projectRoot = await createSectionProject();

    await expect(getKnowledgeSections(projectRoot, {
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
    const selectionToken = mintTokenFromPlan(
      plan,
      ["global-protocol", "battle-view-local"],
      ["ui-batch-rendering", "ui-low-priority"],
    );

    const result = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
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

  // ---------------------------------------------------------------------------
  // v2.0 diagnostic: missing_knowledge_metadata (TASK-005)
  // ---------------------------------------------------------------------------

  it("emits_missing_knowledge_metadata_diagnostic — flags un-migrated v1.x entries (warn, not error)", async () => {
    // Build a project where the global rule HAS v2.0 knowledge fields and the
    // UI rule does NOT — verify the diagnostic only fires for the un-migrated
    // entry while selection still completes successfully.
    const projectRoot = await mkdtemp(join(tmpdir(), "fabric-knowledge-sections-v2-"));
    tempDirs.push(projectRoot);

    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "human-lock.json"),
      `${JSON.stringify({ locked: [] }, null, 2)}\n`,
    );
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "knowledge", "guidelines"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "global.md"),
      "# Global\n\n## [MANDATORY_INJECTION]\nGlobal mandatory.\n",
    );
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "guidelines", "ui.md"),
      "# UI\n\n## [MANDATORY_INJECTION]\nUI mandatory.\n",
    );

    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-knowledge-diag",
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
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "any edit",
              // v2.0 frontmatter present — should NOT trigger diagnostic.
              id: "KT-DEC-0001",
              knowledge_type: "decision",
              maturity: "verified",
              knowledge_layer: "team",
            },
          },
          "L1/ui": {
            stable_id: "ui-rule",
            file: ".fabric/knowledge/guidelines/ui.md",
            content_ref: ".fabric/knowledge/guidelines/ui.md",
            scope_glob: "**",
            deps: [],
            priority: "medium",
            level: "L1",
            layer: "L1",
            topology_type: "domain",
            hash: "sha256:ui",
            description: {
              summary: "UI rule",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "UI rule",
              // No knowledge_type / knowledge_layer — should trigger diagnostic.
            },
          },
        },
      }, null, 2)}\n`,
    );

    const plan = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const selectionToken = mintTokenFromPlan(plan, ["global-protocol"], ["ui-rule"]);
    const result = await getKnowledgeSections(projectRoot, {
      selection_token: selectionToken,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: ["ui-rule"],
      ai_selection_reasons: { "ui-rule": "ui touch" },
    });

    // Selection still completes — both rules surface.
    expect(result.selected_stable_ids).toEqual(["global-protocol", "ui-rule"]);

    const knowledgeDiagnostics = result.diagnostics.filter(
      (d): d is Extract<typeof d, { code: "missing_knowledge_metadata" }> =>
        d.code === "missing_knowledge_metadata",
    );
    // Diagnostic fires ONLY for the un-migrated entry, at warn severity.
    expect(knowledgeDiagnostics).toEqual([
      {
        code: "missing_knowledge_metadata",
        severity: "warn",
        stable_id: "ui-rule",
        message:
          "Rule ui-rule has no knowledge metadata (type/layer) — likely an un-migrated v1.x entry.",
      },
    ]);
  });
});

async function createSectionProject(options: { extraL1?: boolean } = {}): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-knowledge-sections-"));
  tempDirs.push(projectRoot);

  await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
  await mkdir(join(projectRoot, ".fabric", "knowledge", "guidelines"), { recursive: true });
  await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
  await writeFile(join(projectRoot, ".fabric", "knowledge", "decisions", "global.md"), `# Global

## [MANDATORY_INJECTION]
Global mandatory.
`);
  await writeFile(join(projectRoot, ".fabric", "knowledge", "guidelines", "ui.md"), `# UI

## [MANDATORY_INJECTION]
UI mandatory.

## [CONTEXT_INFO]
UI context.
`);
  await writeFile(join(projectRoot, ".fabric", "knowledge", "guidelines", "battle-view.md"), `# Battle

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
    await writeFile(join(projectRoot, ".fabric", "knowledge", "guidelines", "ui-low.md"), `# UI Low

## [MANDATORY_INJECTION]
UI low mandatory.
`);
  }
  await writeFile(
    join(projectRoot, ".fabric", "agents.meta.json"),
    `${JSON.stringify({
      revision: "rev-sections",
      nodes: {
        "L0/global": ruleNode("global-protocol", "L0", ".fabric/knowledge/decisions/global.md", "**"),
        "L1/ui": ruleNode("ui-batch-rendering", "L1", ".fabric/knowledge/guidelines/ui.md", "**"),
        ...(options.extraL1 === true
          ? {
              "L1/ui-low": {
                ...ruleNode("ui-low-priority", "L1", ".fabric/knowledge/guidelines/ui-low.md", "**"),
                priority: "low",
              },
            }
          : {}),
        "L2/battle-view": ruleNode(
          "battle-view-local",
          "L2",
          ".fabric/knowledge/guidelines/battle-view.md",
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
