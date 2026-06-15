import { describe, expect, it, vi } from "vitest";

import type { InstallContext } from "../src/install/pipeline/types.js";

const mocks = vi.hoisted(() => {
  const ok = (step: string, path = `${step}.ok`) => Promise.resolve({ step, path, status: "written" as const });
  const okList = (step: string) => Promise.resolve([{ step, path: `${step}.ok`, status: "written" as const }]);
  return {
    ok,
    okList,
    cleanupDeprecatedSkills: vi.fn(() => okList("skill-deprecated-cleanup")),
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
    installFabricImportSkill: vi.fn(() => okList("skill-import-install")),
    installFabricSyncSkill: vi.fn(() => okList("skill-sync-install")),
    installFabricStoreSkill: vi.fn(() => okList("skill-store-install")),
    installFabricAuditSkill: vi.fn(() => okList("skill-audit-install")),
    installFabricConnectSkill: vi.fn(() => okList("skill-connect-install")),
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

vi.mock("../src/install/skills-and-hooks.js", () => ({
  cleanupDeprecatedSkills: mocks.cleanupDeprecatedSkills,
  installFabricArchiveSkill: mocks.installFabricArchiveSkill,
  installFabricReviewSkill: mocks.installFabricReviewSkill,
  installFabricImportSkill: mocks.installFabricImportSkill,
  installFabricSyncSkill: mocks.installFabricSyncSkill,
  installFabricStoreSkill: mocks.installFabricStoreSkill,
  installFabricAuditSkill: mocks.installFabricAuditSkill,
  installFabricConnectSkill: mocks.installFabricConnectSkill,
  installSharedSkillLib: mocks.installSharedSkillLib,
  installArchiveHintHook: mocks.installArchiveHintHook,
  installKnowledgeHintBroadHook: mocks.installKnowledgeHintBroadHook,
  installKnowledgeHintNarrowHook: mocks.installKnowledgeHintNarrowHook,
  installCitePolicyEvictHook: mocks.installCitePolicyEvictHook,
  installSessionEndMarkerHook: mocks.installSessionEndMarkerHook,
  installPostTooluseMutationHook: mocks.installPostTooluseMutationHook,
  installHookLibs: mocks.installHookLibs,
  mergeClaudeCodeHookConfig: mocks.mergeClaudeCodeHookConfig,
  mergeCodexHookConfig: mocks.mergeCodexHookConfig,
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
      expect(result.errors).toEqual(
        expect.arrayContaining(["skill-install: skill copy denied", "codex-hook-config: codex config locked"]),
      );
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
