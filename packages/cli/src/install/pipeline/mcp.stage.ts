import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { detectPackageManager } from "../../lib/package-manager.js";
import * as configCommand from "../../commands/config.js";
import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";
import { paint } from "../../colors.js";

const LOCAL_FABRIC_SERVER_PATH = join("node_modules", "@fenglimg", "fabric-server", "dist", "index.js");
const FABRIC_SERVER_PACKAGE = "@fenglimg/fabric-server";

// ---------------------------------------------------------------------------
// MCP Stage
// ---------------------------------------------------------------------------

/**
 * MCP stage: configures MCP server for all clients.
 *
 * Responsibilities:
 * 1. Install local fabric-server if using local mode
 * 2. Configure MCP for Claude Code, Codex, and Cursor
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

    try {
      const target = context.target;
      const mode = context.mcpInstallMode;
      const translate = context.translate;

      if (mode === "local") {
        const manager = detectPackageManager(target);
        process.stderr.write(`${translate("cli.install.mcp.install.local")}\n`);
        process.stderr.write(`${translate("cli.install.mcp.local.installing", { manager })}\n`);
        this.installLocalFabricServer(target, manager);
        process.stderr.write(`${translate("cli.install.mcp.local.installed")}\n`);
      } else {
        process.stderr.write(`${translate("cli.install.mcp.install.global")}\n`);
      }

      const result = await configCommand.installMcpClients(target, {
        localServerPath: mode === "local" ? LOCAL_FABRIC_SERVER_PATH : undefined,
        claudeMcpScope: context.claudeMcpScope,
      });

      if (result.details.length === 0) {
        console.log(
          this.formatStageResult(
            "mcp",
            "skipped",
            0,
            0,
            translate,
            translate("cli.config.install.no-configs"),
          ),
        );
        return stageSkipped("mcp", "no MCP configs to install");
      }

      console.log(this.formatStageResult("mcp", "completed", result.installed.length, result.skipped.length, translate));

      return stageRan("mcp", result.installed, result.skipped);
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

  private formatStageResult(
    stage: string,
    status: "completed" | "skipped",
    installedCount: number,
    skippedCount: number,
    translate: InstallContext["translate"],
    note?: string,
  ): string {
    const completedStageLabel = () => paint.success(translate("cli.install.stages.completed"));
    const skippedStageLabel = () => paint.muted(translate("cli.install.stages.skipped"));
    const label = status === "completed" ? completedStageLabel() : skippedStageLabel();
    const counts = `installed=${installedCount} skipped=${skippedCount}`;
    const suffix = note ? ` ${paint.muted(`(${note})`)}` : "";
    return `${label} ${stage}: ${counts}${suffix}`;
  }
}
