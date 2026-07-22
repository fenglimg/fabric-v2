import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { t } from "../../i18n.js";
import { detectPackageManager } from "../../lib/package-manager.js";
import * as configCommand from "../../commands/config.js";
import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";

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
      }
      // global mode: no separate "使用全局安装…" note — it was an out-of-frame
      // orphan line. The configured client names fold into the `● MCP 服务` line.

      const result = await configCommand.installMcpClients(target, {
        localServerPath: mode === "local" ? LOCAL_FABRIC_SERVER_PATH : undefined,
        claudeMcpScope: context.claudeMcpScope,
        mcpRootPolicy: context.mcpRootPolicy,
      });

      if (result.details.length === 0) {
        return stageSkipped("mcp", "no MCP configs to install");
      }

      // flat-design: fold the configured client NAMES into the stage line's detail,
      // and ONLY when something actually changed — an idempotent re-run reads the
      // generic "已最新". Replaces the former separate "已完成 已配置 MCP:…" line that
      // double-reported the stage outside the flat column.
      const clientNames = result.installed.map((kind) => MCP_CLIENT_LABELS[kind] ?? kind).join(" / ");
      const detail = result.changed.length > 0 && clientNames.length > 0 ? clientNames : undefined;

      // TASK-004/Bug-A: changed iff at least one client's config file content
      // actually changed this run (idempotent re-writes don't count). `installed`
      // / display stay as-is (per-phase still lists every configured client name).
      return {
        ...stageRan("mcp", result.installed, result.skipped, undefined, result.changed.length > 0),
        detail,
      };
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

}
