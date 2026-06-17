import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageFailed, stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";
import { installHooks, validateHookPaths } from "../hooks-orchestrator.js";
import {
  cleanupDeprecatedSkills,
  installFabricRouterSkill,
  installFabricArchiveSkill,
  installFabricReviewSkill,
  installFabricImportSkill,
  installFabricSyncSkill,
  installFabricStoreSkill,
  installFabricAuditSkill,
  installFabricConnectSkill,
  installSharedSkillLib,
  installArchiveHintHook,
  installKnowledgeHintBroadHook,
  installKnowledgeHintNarrowHook,
  installCitePolicyEvictHook,
  installSessionEndMarkerHook,
  installPostTooluseMutationHook,
  installHookLibs,
  mergeClaudeCodeHookConfig,
  mergeCodexHookConfig,
  writeClaudeBootstrapThinShell,
  writeCodexBootstrapManagedBlock,
  type InstallStepResult,
} from "../skills-and-hooks.js";
import { writeFabricAgentsSnapshot } from "../write-bootstrap-snapshot.js";
import { t } from "../../i18n.js";
import { paint } from "../../colors.js";

// ---------------------------------------------------------------------------
// Hooks Stage
// ---------------------------------------------------------------------------

/**
 * Hooks stage: installs hooks and skills across all clients.
 *
 * Responsibilities:
 * 1. Clean up deprecated skills
 * 2. Install all Fabric skills (archive, review, import, sync, store, audit, connect)
 * 3. Install shared skill library
 * 4. Install hook scripts (fabric-hint, knowledge-hint-broad/narrow, cite-policy-evict, etc.)
 * 5. Install hook libs
 * 6. Merge hook configs for each client
 * 7. Write bootstrap snapshots and propagation
 * 8. Validate hook paths exist
 *
 * This stage can be skipped via --skipHooks.
 */
export class HooksStage implements Stage {
  readonly name = "hooks" as const;

  async execute(context: InstallContext): Promise<StageResult> {
    if (context.options.skipHooks) {
      return stageSkipped("hooks", "skipped via --skipHooks");
    }
    if (context.options.planOnly === true) {
      return stageSkipped("hooks", "dry-run: hook and skill install planned without writing files");
    }

    try {
      const target = context.target;
      const installResults: InstallStepResult[] = [];

      // Clean up deprecated skills
      installResults.push(...await this.runBestEffort("skill-deprecated-cleanup", () => cleanupDeprecatedSkills(target)));

      // Install all skills (B2 skill-router: fabric/ router first — its Intent
      // Map is regenerated from the 7 leaf descriptions)
      installResults.push(...await this.runBestEffort("skill-router-install", () => installFabricRouterSkill(target)));
      installResults.push(...await this.runBestEffort("skill-install", () => installFabricArchiveSkill(target)));
      installResults.push(...await this.runBestEffort("skill-review-install", () => installFabricReviewSkill(target)));
      installResults.push(...await this.runBestEffort("skill-import-install", () => installFabricImportSkill(target)));
      installResults.push(...await this.runBestEffort("skill-sync-install", () => installFabricSyncSkill(target)));
      installResults.push(...await this.runBestEffort("skill-store-install", () => installFabricStoreSkill(target)));
      installResults.push(...await this.runBestEffort("skill-audit-install", () => installFabricAuditSkill(target)));
      installResults.push(...await this.runBestEffort("skill-connect-install", () => installFabricConnectSkill(target)));
      installResults.push(...await this.runBestEffort("skill-shared-lib", () => installSharedSkillLib(target)));

      // Install hook scripts
      installResults.push(...await this.runBestEffort("hook-script", () => installArchiveHintHook(target)));
      installResults.push(...await this.runBestEffort("hook-broad-script", () => installKnowledgeHintBroadHook(target)));
      installResults.push(...await this.runBestEffort("hook-narrow-script", () => installKnowledgeHintNarrowHook(target)));
      installResults.push(...await this.runBestEffort("hook-cite-policy-evict-script", () => installCitePolicyEvictHook(target)));
      installResults.push(...await this.runBestEffort("hook-session-end-script", () => installSessionEndMarkerHook(target)));
      installResults.push(...await this.runBestEffort("hook-post-tooluse-script", () => installPostTooluseMutationHook(target)));
      installResults.push(...await this.runBestEffort("hook-lib", () => installHookLibs(target)));

      // Merge hook configs
      installResults.push(await this.runSingleStep("claude-hook-config", () => mergeClaudeCodeHookConfig(target)));
      installResults.push(await this.runSingleStep("codex-hook-config", () => mergeCodexHookConfig(target)));

      // Bootstrap snapshots
      installResults.push(await this.runSingleStep("bootstrap-snapshot", () => writeFabricAgentsSnapshot(target)));
      installResults.push(await this.runSingleStep("bootstrap-claude", () => writeClaudeBootstrapThinShell(target)));
      installResults.push(await this.runSingleStep("bootstrap-codex", () => writeCodexBootstrapManagedBlock(target)));

      // Validate hook paths
      installResults.push(...validateHookPaths(target));

      // Report errors
      for (const result of installResults) {
        if (result.status === "error") {
          process.stderr.write(`hooks ${result.step} ${result.path}: ${result.message ?? "unknown error"}\n`);
        }
      }

      const installed = installResults.filter((r) => r.status === "written").map((r) => r.path);
      const skipped = installResults.filter((r) => r.status === "skipped").map((r) => r.path);
      const errors = installResults.filter((r) => r.status === "error").map((r) => `${r.step}: ${r.message}`);

      // Print stage header and result
      console.log(this.formatStageHeader(t("cli.install.stages.hooks")));
      if (errors.length > 0) {
        console.log(this.formatStageResult("hooks", "failed", installed.length, skipped.length));
        return {
          ...stageFailed("hooks", errors),
          installed,
          skipped,
          payload: { installResults },
        };
      }
      console.log(this.formatStageResult("hooks", "completed", installed.length, skipped.length));

      return stageRan("hooks", installed, skipped);
    } catch (error) {
      return stageFailedFromError("hooks", error);
    }
  }

  private async runBestEffort(
    step: string,
    fn: () => Promise<InstallStepResult[]>,
  ): Promise<InstallStepResult[]> {
    try {
      return await fn();
    } catch (error: unknown) {
      return [
        {
          step,
          path: "",
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  }

  private async runSingleStep(
    step: string,
    fn: () => Promise<InstallStepResult>,
  ): Promise<InstallStepResult> {
    try {
      return await fn();
    } catch (error: unknown) {
      return {
        step,
        path: "",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private formatStageHeader(message: string): string {
    const nextLabel = () => paint.ai(t("cli.shared.next"));
    return `${nextLabel()} ${paint.muted(message)}`;
  }

  private formatStageResult(
    stage: string,
    status: "completed" | "skipped" | "failed",
    installedCount: number,
    skippedCount: number,
  ): string {
    const completedStageLabel = () =>
      status === "failed" ? paint.error("failed") : paint.success(t("cli.install.stages.completed"));
    const counts = `installed=${installedCount} skipped=${skippedCount}`;
    return `${completedStageLabel()} ${stage}: ${counts}`;
  }
}
