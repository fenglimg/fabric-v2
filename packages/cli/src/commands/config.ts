import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";

import { resolveClients, type FabricConfig } from "../config/resolver.js";
import type { ClientKind } from "../config/writer.js";

const CLIENT_ALIASES: Record<string, ClientKind> = {
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

function parseClientFilter(value: string | undefined): Set<ClientKind> | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  const clients = new Set<ClientKind>();
  for (const rawClient of value.split(",")) {
    const alias = rawClient.trim().toLowerCase();
    const clientKind = CLIENT_ALIASES[alias];
    if (clientKind === undefined) {
      throw new Error(`Unknown client "${rawClient}". Use a comma-separated list such as cursor,codex,gemini.`);
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
    throw new Error(`Expected object in ${configPath}`);
  }

  return parsed as FabricConfig;
}

function resolveServerPath(): string {
  if (process.env.FAB_SERVER_PATH) return resolve(process.env.FAB_SERVER_PATH);
  return fileURLToPath(import.meta.resolve("@fenglimg/fabric-server"));
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

export const configCmd = defineCommand({
  meta: {
    name: "config",
    description: "管理 Fabric MCP 客户端配置。",
  },
  subCommands: {
    install: defineCommand({
      meta: {
        name: "install",
        description: "将 Fabric MCP 服务器条目安装到检测到的客户端配置中。",
      },
      args: {
        clients: {
          type: "string",
          description: "可选的逗号分隔客户端过滤器，例如 cursor,codex,gemini。",
        },
        "dry-run": {
          type: "boolean",
          description: "预览检测到的写入操作，不修改文件。",
          default: false,
        },
      },
      async run({ args }: { args: InstallArgs }) {
        const workspaceRoot = process.cwd();
        const fabricConfig = await loadFabricConfig(workspaceRoot);
        const selectedClients = parseClientFilter(args.clients);
        const serverPath = resolveServerPath();
        const writers = resolveClients(workspaceRoot, fabricConfig).filter((writer) =>
          selectedClients === null ? true : selectedClients.has(writer.clientKind),
        );

        if (writers.length === 0) {
          writeStderr("未检测到 Fabric MCP 客户端配置。请创建客户端目录或在 fabric.config.json 中设置 clientPaths。");
          return;
        }

        for (const writer of writers) {
          const configPath = await writer.detect(workspaceRoot);
          if (configPath === null) {
            writeStderr(`Skipping ${writer.clientKind}: no config path detected.`);
            continue;
          }

          if (args["dry-run"]) {
            writeStderr(`[dry-run] ${writer.clientKind}: would write ${configPath}`);
            continue;
          }

          await writer.write(serverPath, workspaceRoot);
          writeStderr(`${writer.clientKind}: wrote ${configPath}`);
        }
      },
    }),
  },
});

export default configCmd;
