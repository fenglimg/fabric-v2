import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FabricConfig } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { resolveClients } from "../config/resolver.js";
import type { ClientKind } from "../config/writer.js";
import { t } from "../i18n.js";

const CLIENT_ALIASES: Record<string, ClientKind> = {
  claude: "ClaudeCodeCLI",
  claudecodecli: "ClaudeCodeCLI",
  "claude-code-cli": "ClaudeCodeCLI",
  claudecli: "ClaudeCodeCLI",
  claudecodedesktop: "ClaudeCodeDesktop",
  "claude-code-desktop": "ClaudeCodeDesktop",
  claudedesktop: "ClaudeCodeDesktop",
  cursor: "Cursor",
  windsurf: "Windsurf",
  roocode: "RooCode",
  "roo-code": "RooCode",
  roo: "RooCode",
  geminicli: "GeminiCLI",
  "gemini-cli": "GeminiCLI",
  gemini: "GeminiCLI",
  codexcli: "CodexCLI",
  "codex-cli": "CodexCLI",
  codex: "CodexCLI",
};

type InstallArgs = {
  clients?: string;
  "dry-run"?: boolean;
};

type InstallMcpClientsOptions = {
  clients?: ClientKind[];
  force?: boolean;
  dryRun?: boolean;
  localServerPath?: string;
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

export function parseClientFilter(value: string | undefined): Set<ClientKind> | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  const clients = new Set<ClientKind>();
  for (const rawClient of value.split(",")) {
    const alias = rawClient.trim().toLowerCase();
    const clientKind = CLIENT_ALIASES[alias];
    if (clientKind === undefined) {
      throw new Error(t("cli.config.errors.unknown-client", { client: rawClient }));
    }

    clients.add(clientKind);
  }

  return clients;
}

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

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

export const configCmd = defineCommand({
  meta: {
    name: "config",
    description: t("cli.config.description"),
  },
  subCommands: {
    install: defineCommand({
      meta: {
        name: "install",
        description: t("cli.config.install.description"),
      },
      args: {
        clients: {
          type: "string",
          description: t("cli.config.install.args.clients.description"),
        },
        "dry-run": {
          type: "boolean",
          description: t("cli.config.install.args.dry-run.description"),
          default: false,
        },
      },
      async run({ args }: { args: InstallArgs }) {
        const selectedClients = parseClientFilter(args.clients);
        const result = await installMcpClients(process.cwd(), {
          clients: selectedClients === null ? undefined : Array.from(selectedClients),
          dryRun: args["dry-run"],
        });

        if (result.details.length === 0) {
          writeStderr(t("cli.config.install.no-configs"));
          return;
        }

        for (const detail of result.details) {
          if (detail.action === "skipped") {
            writeStderr(t("cli.config.install.no-config-path", { client: detail.client }));
            continue;
          }

          if (detail.action === "dry-run" && detail.path !== null) {
            writeStderr(t("cli.config.install.dry-run", { client: detail.client, path: detail.path }));
            continue;
          }

          if (detail.path !== null) {
            writeStderr(t("cli.config.install.wrote", { client: detail.client, path: detail.path }));
          }
        }
      },
    }),
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
  const writers = resolveClients(workspaceRoot, fabricConfig).filter((writer) =>
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
