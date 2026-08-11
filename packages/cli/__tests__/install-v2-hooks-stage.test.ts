import { describe, expect, it, vi } from "vitest";

import type { InstallContext } from "../src/install/pipeline/types.js";

const mocks = vi.hoisted(() => {
  const ok = (step: string, path = `${step}.ok`) => Promise.resolve({ step, path, status: "written" as const });
  const okList = (step: string) => Promise.resolve([{ step, path: `${step}.ok`, status: "written" as const }]);
  return {
    ok,
    okList,
    installFabricArchiveSkill: vi.fn(() =>
      Promise.resolve([
        {
          step: "skill-install",
          path: ".codex/skills/fabric-archive/SKILL.md",
          status: "error" as const,
          message: "skill copy denied",
        },
      ]),
    ),
    installFabricReviewSkill: vi.fn(() => okList("skill-review-install")),
    installFabricSyncSkill: vi.fn(() => okList("skill-sync-install")),
    installFabricStoreSkill: vi.fn(() => okList("skill-store-install")),
    installFabricRecallPlaybookSkill: vi.fn(() => okList("skill-recall-playbook-install")),
    installFabricConfigSkill: vi.fn(() => okList("skill-config-install")),
    installKnowledgePretoolUseHook: vi.fn(() => okList("hook-pretooluse-script")),
    installSharedSkillLib: vi.fn(() => okList("skill-shared-lib")),
    installArchiveHintHook: vi.fn(() => okList("hook-script")),
    installKnowledgeHintBroadHook: vi.fn(() => okList("hook-broad-script")),
    installKnowledgeHintNarrowHook: vi.fn(() => okList("hook-narrow-script")),
    installCitePolicyEvictHook: vi.fn(() => okList("hook-cite-policy-evict-script")),
    installSessionEndMarkerHook: vi.fn(() => okList("hook-session-end-script")),
    installPostTooluseMutationHook: vi.fn(() => okList("hook-post-tooluse-script")),
    installHookLibs: vi.fn(() => okList("hook-lib")),
    mergeClaudeCodeHookConfig: vi.fn(() => ok("claude-hook-config")),
    mergeCodexHookConfig: vi.fn(() => {
      throw new Error("codex config locked");
    }),
    writeClaudeBootstrapThinShell: vi.fn(() => ok("bootstrap-claude")),
    writeCodexBootstrapManagedBlock: vi.fn(() => ok("bootstrap-codex")),
    writeFabricAgentsSnapshot: vi.fn(() => ok("bootstrap-snapshot")),
    validateHookPaths: vi.fn(() => []),
  };
});

// One mock per writer module the stage imports. The stage is under test here,
// so every writer it calls must be stubbed — a module left real would load the
// filesystem plumbing and the stage's own error accounting would report the
// mock harness's failures as install failures (which is what the single
// pre-split mock of `skills-and-hooks.js` silently did: it omitted three
// installers, and their "not defined on the mock" errors rode along in
// `result.errors` next to the two this test actually asserts).
vi.mock("../src/install/install-skills.js", () => ({
  installFabricArchiveSkill: mocks.installFabricArchiveSkill,
  installFabricReviewSkill: mocks.installFabricReviewSkill,
  installFabricSyncSkill: mocks.installFabricSyncSkill,
  installFabricStoreSkill: mocks.installFabricStoreSkill,
  installFabricRecallPlaybookSkill: mocks.installFabricRecallPlaybookSkill,
  installFabricConfigSkill: mocks.installFabricConfigSkill,
  installSharedSkillLib: mocks.installSharedSkillLib,
}));

vi.mock("../src/install/install-hook-scripts.js", () => ({
  installArchiveHintHook: mocks.installArchiveHintHook,
  installKnowledgeHintBroadHook: mocks.installKnowledgeHintBroadHook,
  installKnowledgeHintNarrowHook: mocks.installKnowledgeHintNarrowHook,
  installKnowledgePretoolUseHook: mocks.installKnowledgePretoolUseHook,
  installCitePolicyEvictHook: mocks.installCitePolicyEvictHook,
  installSessionEndMarkerHook: mocks.installSessionEndMarkerHook,
  installPostTooluseMutationHook: mocks.installPostTooluseMutationHook,
  installHookLibs: mocks.installHookLibs,
}));

vi.mock("../src/install/hook-config-merge.js", () => ({
  mergeClaudeCodeHookConfig: mocks.mergeClaudeCodeHookConfig,
  mergeCodexHookConfig: mocks.mergeCodexHookConfig,
}));

vi.mock("../src/install/bootstrap-propagation.js", () => ({
  writeClaudeBootstrapThinShell: mocks.writeClaudeBootstrapThinShell,
  writeCodexBootstrapManagedBlock: mocks.writeCodexBootstrapManagedBlock,
}));

vi.mock("../src/install/write-bootstrap-snapshot.js", () => ({
  writeFabricAgentsSnapshot: mocks.writeFabricAgentsSnapshot,
}));

vi.mock("../src/install/hooks-orchestrator.js", () => ({
  installHooks: vi.fn(),
  validateHookPaths: mocks.validateHookPaths,
}));

const { HooksStage } = await import("../src/install/pipeline/hooks.stage.js");

function createContext(): InstallContext {
  return {
    target: "C:/tmp/fabric-project",
    args: {},
    options: {},
    mcpInstallMode: "global",
    claudeMcpScope: "user",
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: {},
  };
}

describe("install v2 HooksStage", () => {
  it("returns failed when best-effort and single-step installers report errors", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await new HooksStage().execute(createContext());

      expect(result.disposition).toBe("failed");
      expect(result.name).toBe("hooks");
      // Exactly two, not "at least two": an incomplete mock shows up as extra
      // error rows, and arrayContaining would have swallowed them.
      expect(result.errors).toEqual([
        "skill-install: skill copy denied",
        "codex-hook-config: codex config locked",
      ]);
      expect(result.installed).toContain("claude-hook-config.ok");
      expect(result.installed).not.toContain(".codex/skills/fabric-archive/SKILL.md");
      expect(String(stderrSpy.mock.calls.join("\n"))).toContain("skill copy denied");
      expect(String(stderrSpy.mock.calls.join("\n"))).toContain("codex config locked");
    } finally {
      logSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });
});
