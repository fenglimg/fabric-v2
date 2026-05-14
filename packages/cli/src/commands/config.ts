import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FabricConfig } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { resolveClients } from "../config/resolver.js";
import type { ClaudeMcpScope } from "../config/json.js";
import type { ClientKind } from "../config/writer.js";
import { t } from "../i18n.js";

// ---------------------------------------------------------------------------
// rc.15 TASK-004 (C6 + C9): `fab config` is a visible placeholder pointing at
// the rc.16 TUI panel. The previous subCommands map (`fab config hooks`,
// `fab config install`) has been deleted — hook installation now flows
// exclusively through `fab install` (which delegates to
// `installHooks` in ../install/hooks-orchestrator.ts), and MCP-only
// client wiring is handled by the install pipeline. parseClientFilter +
// CLIENT_ALIASES (used only by the removed `fab config install` subcommand)
// have been removed as orphans.
//
// `installMcpClients` is preserved as a named export because `install.ts`
// re-imports it via `import * as configCommand` to wire MCP entries during
// the install stage.
// ---------------------------------------------------------------------------

type ConfigArgs = {
  target?: string;
};

type InstallMcpClientsOptions = {
  clients?: ClientKind[];
  dryRun?: boolean;
  localServerPath?: string;
  claudeMcpScope?: ClaudeMcpScope;
};

type McpInstallAction = "wrote" | "dry-run" | "skipped";

type McpInstallDetail = {
  client: ClientKind;
  path: string | null;
  action: McpInstallAction;
};

export type InstallMcpClientsResult = {
  installed: ClientKind[];
  skipped: ClientKind[];
  details: McpInstallDetail[];
};

async function loadFabricConfig(workspaceRoot: string): Promise<FabricConfig> {
  const configPath = resolve(workspaceRoot, "fabric.config.json");
  if (!existsSync(configPath)) {
    return {};
  }

  const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("cli.config.errors.expected-object", { path: configPath }));
  }

  return parsed as FabricConfig;
}

function resolveServerPath(override?: string): string {
  if (override) return override;
  if (process.env.FAB_SERVER_PATH) return resolve(process.env.FAB_SERVER_PATH);
  return fileURLToPath(import.meta.resolve("@fenglimg/fabric-server"));
}

export const configCmd = defineCommand({
  meta: {
    name: "config",
    description: t("cli.config.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.config.args.target.description"),
      valueHint: "path",
    },
  },
  async run(_ctx: { args: ConfigArgs }) {
    console.log(t("cli.config.placeholder"));
  },
});

export default configCmd;

export async function installMcpClients(
  target: string,
  options: InstallMcpClientsOptions = {},
): Promise<InstallMcpClientsResult> {
  const workspaceRoot = resolve(target);
  const fabricConfig = await loadFabricConfig(workspaceRoot);
  const selectedClients = options.clients === undefined ? null : new Set(options.clients);
  const serverPath = resolveServerPath(options.localServerPath);
  const writers = resolveClients(workspaceRoot, fabricConfig, { claudeMcpScope: options.claudeMcpScope }).filter((writer) =>
    selectedClients === null ? true : selectedClients.has(writer.clientKind),
  );
  const installed: ClientKind[] = [];
  const skipped: ClientKind[] = [];
  const details: McpInstallDetail[] = [];

  for (const writer of writers) {
    const configPath = await writer.detect(workspaceRoot);
    if (configPath === null) {
      skipped.push(writer.clientKind);
      details.push({ client: writer.clientKind, path: null, action: "skipped" });
      continue;
    }

    if (options.dryRun) {
      skipped.push(writer.clientKind);
      details.push({ client: writer.clientKind, path: configPath, action: "dry-run" });
      continue;
    }

    await writer.write(serverPath, workspaceRoot);
    installed.push(writer.clientKind);
    details.push({ client: writer.clientKind, path: configPath, action: "wrote" });
  }

  return { installed, skipped, details };
}
