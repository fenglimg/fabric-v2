import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { t } from "../../i18n.js";
import { detectPackageManager } from "../../lib/package-manager.js";
import * as configCommand from "../../commands/config.js";
import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";
import { paint } from "../../colors.js";

const LOCAL_FABRIC_SERVER_PATH = join("node_modules", "@fenglimg", "fabric-server", "dist", "index.js");
const FABRIC_SERVER_PACKAGE = "@fenglimg/fabric-server";

/** ClientKind → friendly label (grill C-14): mcp output lists names, not a count. */
const MCP_CLIENT_LABELS: Record<string, string> = {
  ClaudeCodeCLI: "Claude Code CLI",
  ClaudeCodeDesktop: "Claude Code Desktop",
  CodexCLI: "Codex CLI",
  CodexDesktop: "Codex Desktop",
  Cursor: "Cursor",
};

// ---------------------------------------------------------------------------
// MCP Stage
// ---------------------------------------------------------------------------

/**
 * MCP stage: configures MCP server for all clients.
 *
 * Responsibilities:
 * 1. Install local fabric-server if using local mode
 * 2. Configure MCP for Claude Code and Codex
 * 3. Use appropriate scope (project or user)
 *
 * This stage can be skipped via --skipMcp.
 */
export class McpStage implements Stage {
  readonly name = "mcp" as const;

  async execute(context: InstallContext): Promise<StageResult> {
    if (context.options.skipMcp) {
      return stageSkipped("mcp", "skipped via --skipMcp");
    }
    if (context.options.planOnly === true) {
      return stageSkipped("mcp", "dry-run: MCP config install planned without writing files");
    }

    try {
      const target = context.target;
      const mode = context.mcpInstallMode;

      // The phase header is owned solely by the pipeline ([N/7] / renderSection);
      // the stage no longer prints a second "下一步" header (grill C-13).
      if (mode === "local") {
        const manager = detectPackageManager(target);
        process.stderr.write(`${t("cli.install.mcp.install.local")}\n`);
        process.stderr.write(`${t("cli.install.mcp.local.installing", { manager })}\n`);
        this.installLocalFabricServer(target, manager);
        process.stderr.write(`${t("cli.install.mcp.local.installed")}\n`);
      } else {
        process.stderr.write(`${t("cli.install.mcp.install.global")}\n`);
      }

      const result = await configCommand.installMcpClients(target, {
        localServerPath: mode === "local" ? LOCAL_FABRIC_SERVER_PATH : undefined,
        claudeMcpScope: context.claudeMcpScope,
      });

      if (result.details.length === 0) {
        console.log(this.formatStageResult("mcp", "skipped", 0, 0, t("cli.config.install.no-configs")));
        return stageSkipped("mcp", "no MCP configs to install");
      }

      console.log(this.formatMcpOutcome(result.installed, result.skipped.length, context.args.debug === true));

      // TASK-004/Bug-A: changed iff at least one client's config file content
      // actually changed this run (idempotent re-writes don't count). `installed`
      // / display stay as-is (per-phase still lists every configured client name).
      return stageRan("mcp", result.installed, result.skipped, undefined, result.changed.length > 0);
    } catch (error) {
      return stageFailedFromError("mcp", error);
    }
  }

  private installLocalFabricServer(target: string, manager: "pnpm" | "npm" | "yarn"): void {
    const installArgs = manager === "npm"
      ? ["install", "-D", FABRIC_SERVER_PACKAGE]
      : ["add", "-D", FABRIC_SERVER_PACKAGE];

    execFileSync(manager, installArgs, {
      cwd: target,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }

  /**
   * grill C-14: list the configured client NAMES instead of an opaque
   * `installed=3`. result.installed is a ClientKind[]; map to friendly labels.
   * Raw skipped count moves behind --debug.
   */
  private formatMcpOutcome(installed: string[], skippedCount: number, debug: boolean): string {
    const ok = paint.success(t("cli.install.stages.completed"));
    if (installed.length === 0) {
      return `${ok} ${t("cli.install.mcp.none")}`;
    }
    const names = installed.map((kind) => MCP_CLIENT_LABELS[kind] ?? kind).join(" / ");
    const raw = debug ? ` ${paint.muted(`(skipped=${skippedCount})`)}` : "";
    return `${ok} ${t("cli.install.mcp.configured", { clients: names })}${raw}`;
  }

  private formatStageResult(
    stage: string,
    status: "completed" | "skipped",
    installedCount: number,
    skippedCount: number,
    note?: string,
  ): string {
    const completedStageLabel = () => paint.success(t("cli.install.stages.completed"));
    const skippedStageLabel = () => paint.muted(t("cli.install.stages.skipped"));
    const label = status === "completed" ? completedStageLabel() : skippedStageLabel();
    const counts = `installed=${installedCount} skipped=${skippedCount}`;
    const suffix = note ? ` ${paint.muted(`(${note})`)}` : "";
    return `${label} ${stage}: ${counts}${suffix}`;
  }
}
