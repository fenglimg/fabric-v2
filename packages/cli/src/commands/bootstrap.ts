import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";

import { type FabricConfig, resolveClients } from "../config/resolver.js";
import type { ClientKind } from "../config/writer.js";
import { readFabricConfig } from "../dev-mode.js";

type BootstrapClient = "claude" | "cursor" | "windsurf" | "roo" | "gemini" | "codex";

type InstallArgs = {
  clients?: string;
};

const CLIENT_ALIASES: Record<string, BootstrapClient> = {
  claude: "claude",
  "claude-code": "claude",
  claudecode: "claude",
  claudecli: "claude",
  claudecodecli: "claude",
  claudedesktop: "claude",
  claudecodedesktop: "claude",
  cursor: "cursor",
  windsurf: "windsurf",
  roo: "roo",
  "roo-code": "roo",
  roocode: "roo",
  gemini: "gemini",
  "gemini-cli": "gemini",
  geminicli: "gemini",
  codex: "codex",
  "codex-cli": "codex",
  codexcli: "codex",
};

const CLIENT_TEMPLATE_MAP: Record<BootstrapClient, string> = {
  claude: "templates/bootstrap/CLAUDE.md",
  cursor: "templates/bootstrap/cursor-fabric-bootstrap.mdc",
  windsurf: "templates/bootstrap/windsurf-fabric.md",
  roo: "templates/bootstrap/roo-fabric.md",
  gemini: "templates/bootstrap/GEMINI.md",
  codex: "templates/bootstrap/codex-AGENTS-header.md",
};

const CLIENT_TARGET_MAP: Record<BootstrapClient, string> = {
  claude: "CLAUDE.md",
  cursor: ".cursor/rules/fabric-bootstrap.mdc",
  windsurf: ".windsurf/rules/fabric.md",
  roo: ".roo/rules/fabric.md",
  gemini: "GEMINI.md",
  codex: "AGENTS.md",
};

export const bootstrapCommand = defineCommand({
  meta: {
    name: "bootstrap",
    description: "Install Fabric bootstrap prompt templates for supported AI clients.",
  },
  subCommands: {
    install: defineCommand({
      meta: {
        name: "install",
        description: "Copy Fabric bootstrap templates into client-native locations.",
      },
      args: {
        clients: {
          type: "string",
          description: "Optional comma-separated client filter, e.g. claude,cursor,codex.",
        },
      },
      async run({ args }: { args: InstallArgs }) {
        const workspaceRoot = process.cwd();
        const selectedClients = parseClientFilter(args.clients);
        const fabricConfig = readFabricConfig(workspaceRoot);
        const detectedClients = detectBootstrapClients(workspaceRoot, fabricConfig);
        const clients = selectedClients ?? detectedClients;

        if (clients.size === 0) {
          process.stderr.write(
            "No bootstrap targets detected. Pass --clients claude,cursor,windsurf,roo,gemini,codex to install explicitly.\n",
          );
          return;
        }

        for (const client of clients) {
          installBootstrap(client, workspaceRoot);
        }
      },
    }),
  },
});

export default bootstrapCommand;

function parseClientFilter(value: string | undefined): Set<BootstrapClient> | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  const clients = new Set<BootstrapClient>();
  for (const rawClient of value.split(",")) {
    const alias = rawClient.trim().toLowerCase();
    const client = CLIENT_ALIASES[alias];
    if (client === undefined) {
      throw new Error(`Unknown client "${rawClient}". Use a comma-separated list such as claude,cursor,codex.`);
    }

    clients.add(client);
  }

  return clients;
}

function detectBootstrapClients(workspaceRoot: string, fabricConfig: FabricConfig): Set<BootstrapClient> {
  const clients = new Set<BootstrapClient>();

  for (const writer of resolveClients(workspaceRoot, fabricConfig)) {
    const bootstrapClient = mapClientKind(writer.clientKind);
    if (bootstrapClient !== null) {
      clients.add(bootstrapClient);
    }
  }

  return clients;
}

function mapClientKind(clientKind: ClientKind): BootstrapClient | null {
  switch (clientKind) {
    case "ClaudeCodeCLI":
    case "ClaudeCodeDesktop":
      return "claude";
    case "Cursor":
      return "cursor";
    case "Windsurf":
      return "windsurf";
    case "RooCode":
      return "roo";
    case "GeminiCLI":
      return "gemini";
    case "CodexCLI":
      return "codex";
    default:
      return null;
  }
}

function installBootstrap(client: BootstrapClient, workspaceRoot: string): void {
  const targetPath = resolve(workspaceRoot, CLIENT_TARGET_MAP[client]);
  const templatePath = findTemplatePath(CLIENT_TEMPLATE_MAP[client]);
  const template = readFileSync(templatePath, "utf8");

  mkdirSync(dirname(targetPath), { recursive: true });

  if (client === "codex") {
    writeCodexBootstrap(targetPath, template);
    return;
  }

  writeFileSync(targetPath, ensureTrailingNewline(template), "utf8");
  process.stderr.write(`Installed ${targetPath}\n`);
}

function writeCodexBootstrap(targetPath: string, template: string): void {
  const nextContent = ensureTrailingNewline(template);

  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, nextContent, "utf8");
    process.stderr.write(`Installed ${targetPath}\n`);
    return;
  }

  const existing = readFileSync(targetPath, "utf8");
  if (existing.includes("# Fabric Bootstrap")) {
    process.stderr.write(`Skipped ${targetPath}: Fabric Bootstrap header already present.\n`);
    return;
  }

  const separator = existing.startsWith("\n") || existing.length === 0 ? "" : "\n";
  writeFileSync(targetPath, `${nextContent}${separator}${existing}`, "utf8");
  process.stderr.write(`Prepended ${targetPath}\n`);
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function findTemplatePath(relativePath: string): string {
  const currentModuleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...templateCandidatesFrom(process.cwd(), relativePath),
    ...templateCandidatesFrom(currentModuleDir, relativePath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Template not found: ${relativePath}`);
}

function templateCandidatesFrom(start: string, relativePath: string): string[] {
  const candidates: string[] = [];
  let current = resolve(start);

  while (true) {
    candidates.push(join(current, ...relativePath.split("/")));

    const parent = dirname(current);
    if (parent === current || parse(current).root === current) {
      break;
    }

    current = parent;
  }

  return candidates;
}
