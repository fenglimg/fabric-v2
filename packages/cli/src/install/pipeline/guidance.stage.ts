import { join } from "node:path";

import { confirm, isCancel, select, text } from "@clack/prompts";

import { paint } from "../../colors.js";
import { loadProjectConfig } from "../../store/project-config-io.js";
import {
  enableSemanticSearch,
  renderSemanticSearchInstructions,
} from "../semantic-search.js";
import { detectClientSupports } from "../../config/resolver.js";
import {
  storeCreate,
  storeBind,
  storeSwitchWrite,
  storeList,
} from "../../store/store-ops.js";
import { regenerateBindingsSnapshot } from "../../store/bindings-io.js";
import { mountStoreFromRemote } from "../run-global-install.js";
import { resolveGlobalRoot } from "../../store/global-config-io.js";
import type { Stage, InstallContext, StageResult, DetectedClientSupport } from "./types.js";
import { stageRan, stageFailedFromError } from "./pipeline.js";

// ---------------------------------------------------------------------------
// Guidance Stage
// ---------------------------------------------------------------------------

/**
 * Guidance stage: outputs next-step guidance and prompts.
 *
 * Responsibilities:
 * 1. Print "next steps" message
 * 2. Print surfaces.md reference
 * 3. Handle semantic search prompt (if --enable-embed or interactive)
 * 4. Print restart banner for MCP clients
 * 5. Print fabric_language hint
 * 6. Print capability summary table
 *
 * This stage always runs and provides user-facing output.
 */
export class GuidanceStage implements Stage {
  readonly name = "guidance" as const;

  async execute(context: InstallContext): Promise<StageResult> {
    try {
      // Skip guidance output if planOnly mode
      if (context.options.planOnly) {
        return stageRan("guidance", [], []);
      }
      const translate = context.translate;

      // Handle semantic search
      if (context.args["enable-embed"]) {
        this.enableSemanticSearchAndReport(context.target, context.args["embed-model"]);
      } else if (context.wizardEnabled) {
        await this.promptSemanticSearch(context.target);
      }

      // Print final next steps only after all optional prompts have completed.
      console.log("");
      console.log(translate("cli.install.next-steps"));
      console.log("");
      console.log(paint.muted("More: docs/ARCHITECTURE.md explains CLI / Skill / MCP boundaries."));

      // Print restart banner
      console.log("");
      console.log(translate("cli.install.restart-banner"));

      // Print language preference hint
      if (context.state.fabricLanguage) {
        console.log(
          paint.muted(translate("cli.install.language_preference_hint", { value: context.state.fabricLanguage })),
        );
      }

      // Print capability summary
      const finalSupports = detectClientSupports(context.target);
      this.printCapabilitySummary(finalSupports, context);

      return stageRan("guidance", [], []);
    } catch (error) {
      return stageFailedFromError("guidance", error);
    }
  }

  private enableSemanticSearchAndReport(projectRoot: string, model?: string): void {
    const enabled = enableSemanticSearch(projectRoot, model === undefined ? {} : { model });
    console.log("");
    if (enabled.alreadyEnabled) {
      console.log(
        paint.muted(`语义搜索已是启用状态 (embed_model=${enabled.model})，未改动 ${enabled.configPath}。`),
      );
      return;
    }
    for (const line of renderSemanticSearchInstructions(enabled.model)) {
      console.log(line);
    }
  }

  private async promptSemanticSearch(projectRoot: string): Promise<void> {
    const enable = await confirm({
      message: "Enable vector semantic search? (downloads an embedding model on first use)",
      initialValue: false,
    });
    if (isCancel(enable) || !enable) {
      return;
    }
    this.enableSemanticSearchAndReport(projectRoot);
  }

  private printCapabilitySummary(
    supports: DetectedClientSupport[],
    context: InstallContext,
  ): void {
    const detected = supports.filter((s) => s.detected);
    const translate = context.translate;
    if (detected.length === 0) {
      console.log(translate("cli.install.capabilities.none"));
      return;
    }

    console.log(translate("cli.install.capabilities.title"));

    // Print table headers
    const headers = {
      client: translate("cli.install.capabilities.header.client"),
      bootstrap: translate("cli.install.capabilities.header.bootstrap"),
      mcp: translate("cli.install.capabilities.header.mcp"),
      hook: translate("cli.install.capabilities.header.hook"),
      skill: translate("cli.install.capabilities.header.skill"),
      followUp: translate("cli.install.capabilities.header.follow-up"),
    };

    // Calculate column widths
    const widths = {
      client: Math.max(6, ...detected.map((s) => s.label.length)),
      bootstrap: Math.max(8, 8),
      mcp: Math.max(3, 3),
      hook: Math.max(4, 4),
      skill: Math.max(5, 5),
      followUp: Math.max(9, 9),
    };

    // Print header row
    const headerRow = [
      headers.client.padEnd(widths.client),
      headers.bootstrap.padEnd(widths.bootstrap),
      headers.mcp.padEnd(widths.mcp),
      headers.hook.padEnd(widths.hook),
      headers.skill.padEnd(widths.skill),
      headers.followUp.padEnd(widths.followUp),
    ].join("  ");
    console.log(headerRow);

    // Print divider
    const divider = [
      "".padEnd(widths.client, "-"),
      "".padEnd(widths.bootstrap, "-"),
      "".padEnd(widths.mcp, "-"),
      "".padEnd(widths.hook, "-"),
      "".padEnd(widths.skill, "-"),
      "".padEnd(widths.followUp, "-"),
    ].join("  ");
    console.log(divider);

    // Print rows for each client
    for (const support of detected) {
      const bootstrap = support.capabilities.bootstrap
        ? this.capabilityStatus(context.options.skipBootstrap ? "skipped" : "ran", translate)
        : translate("cli.install.capabilities.status.na");
      const mcp = support.capabilities.mcp
        ? this.capabilityStatus(context.options.skipMcp ? "skipped" : "ran", translate)
        : translate("cli.install.capabilities.status.na");
      const hook = this.capabilityInstallStatus(support, "hook", translate);
      const skill = this.capabilityInstallStatus(support, "skill", translate);

      const followUp = this.hasInstalledCapability(support, "skill")
        ? translate("cli.install.capabilities.follow-up.ready")
        : support.capabilities.skill
          ? translate("cli.install.capabilities.follow-up.install")
          : translate("cli.install.capabilities.follow-up.manual");

      const row = [
        support.label.padEnd(widths.client),
        bootstrap.padEnd(widths.bootstrap),
        mcp.padEnd(widths.mcp),
        hook.padEnd(widths.hook),
        skill.padEnd(widths.skill),
        followUp.padEnd(widths.followUp),
      ].join("  ");
      console.log(row);
    }
  }

  private capabilityStatus(
    disposition: "ran" | "skipped" | "failed" | null,
    translate: InstallContext["translate"],
  ): string {
    switch (disposition) {
      case "ran":
        return translate("cli.install.capabilities.status.ready");
      case "skipped":
        return translate("cli.install.capabilities.status.skipped");
      case "failed":
        return translate("cli.install.capabilities.status.failed");
      case null:
        return translate("cli.install.capabilities.status.na");
      default:
        return translate("cli.install.capabilities.status.ready");
    }
  }

  private capabilityInstallStatus(
    support: DetectedClientSupport,
    capability: "hook" | "skill",
    translate: InstallContext["translate"],
  ): string {
    if (!support.capabilities[capability]) {
      return translate("cli.install.capabilities.status.na");
    }
    return this.hasInstalledCapability(support, capability)
      ? translate("cli.install.capabilities.status.installed")
      : translate("cli.install.capabilities.status.supported");
  }

  private hasInstalledCapability(
    support: DetectedClientSupport,
    capability: "hook" | "skill",
  ): boolean {
    return support.installedCapabilities?.[capability] === true;
  }
}
