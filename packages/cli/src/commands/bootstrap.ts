import { resolve } from "node:path";

import type { FabricConfig } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { ensureFabricBootstrapGuide, FABRIC_GUIDE_PATH } from "../bootstrap-guide.js";
import { resolveClients } from "../config/resolver.js";
import type { ClientKind } from "../config/writer.js";
import { readFabricConfig } from "../dev-mode.js";
import { t } from "../i18n.js";

type BootstrapClient = "claude" | "cursor" | "windsurf" | "roo" | "gemini" | "codex";

type InstallArgs = {
  clients?: string;
};

type InstallBootstrapOptions = {
  clients?: ClientKind[];
  force?: boolean;
};

type BootstrapInstallAction = "installed" | "overwritten" | "prepended" | "skipped";

type BootstrapInstallDetail = {
  client: ClientKind;
  path: string;
  action: BootstrapInstallAction;
};

export type BootstrapInstallResult = {
  installed: ClientKind[];
  skipped: ClientKind[];
  details: BootstrapInstallDetail[];
};

type BootstrapTarget = {
  client: ClientKind;
  bootstrapClient: BootstrapClient;
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

export const bootstrapCommand = defineCommand({
  meta: {
    name: "bootstrap",
    description: t("cli.bootstrap.description"),
  },
  subCommands: {
    install: defineCommand({
      meta: {
        name: "install",
        description: t("cli.bootstrap.install.description"),
      },
      args: {
        clients: {
          type: "string",
          description: t("cli.bootstrap.install.args.clients.description"),
        },
      },
      async run({ args }: { args: InstallArgs }) {
        const workspaceRoot = process.cwd();
        const selectedClients = parseClientFilter(args.clients);
        const result = await installBootstrap(workspaceRoot, {
          clients: selectedClients === null ? undefined : Array.from(selectedClients, mapBootstrapClientToClientKind),
        });

        if (result.details.length === 0) {
          process.stderr.write(
            `${t("cli.bootstrap.install.no-targets")}\n`,
          );
          return;
        }

        for (const detail of result.details) {
          if (detail.action === "skipped") {
            process.stderr.write(`${t("cli.bootstrap.install.skipped-header", { path: detail.path })}\n`);
            continue;
          }

          if (detail.action === "prepended") {
            process.stderr.write(`${t("cli.bootstrap.install.prepended", { path: detail.path })}\n`);
            continue;
          }

          process.stderr.write(`${t("cli.bootstrap.install.installed", { path: detail.path })}\n`);
        }
      },
    }),
  },
});

export default bootstrapCommand;

export async function installBootstrap(
  target: string,
  options: InstallBootstrapOptions = {},
): Promise<BootstrapInstallResult> {
  const workspaceRoot = resolve(target);
  const fabricConfig = readFabricConfig(workspaceRoot);
  const targets = resolveBootstrapTargets(workspaceRoot, fabricConfig, options.clients);
  const installed: ClientKind[] = [];
  const skipped: ClientKind[] = [];
  const details: BootstrapInstallDetail[] = [];

  ensureFabricBootstrapGuide(workspaceRoot, options.force);

  for (const bootstrapTarget of targets) {
    details.push({
      client: bootstrapTarget.client,
      path: resolve(workspaceRoot, FABRIC_GUIDE_PATH),
      action: "skipped",
    });
    skipped.push(bootstrapTarget.client);
  }

  return { installed, skipped, details };
}

function parseClientFilter(value: string | undefined): Set<BootstrapClient> | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  const clients = new Set<BootstrapClient>();
  for (const rawClient of value.split(",")) {
    const alias = rawClient.trim().toLowerCase();
    const client = CLIENT_ALIASES[alias];
    if (client === undefined) {
      throw new Error(t("cli.bootstrap.errors.unknown-client", { client: rawClient }));
    }

    clients.add(client);
  }

  return clients;
}

function resolveBootstrapTargets(
  workspaceRoot: string,
  fabricConfig: FabricConfig,
  selectedClients?: ClientKind[],
): BootstrapTarget[] {
  const targets: BootstrapTarget[] = [];
  const seenClients = new Set<BootstrapClient>();
  const clientKinds =
    selectedClients ?? resolveClients(workspaceRoot, fabricConfig).map((writer) => writer.clientKind);

  for (const clientKind of clientKinds) {
    const bootstrapClient = mapClientKind(clientKind);
    if (bootstrapClient === null || seenClients.has(bootstrapClient)) {
      continue;
    }

    seenClients.add(bootstrapClient);
    targets.push({ client: clientKind, bootstrapClient });
  }

  return targets;
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

function mapBootstrapClientToClientKind(client: BootstrapClient): ClientKind {
  switch (client) {
    case "claude":
      return "ClaudeCodeCLI";
    case "cursor":
      return "Cursor";
    case "windsurf":
      return "Windsurf";
    case "roo":
      return "RooCode";
    case "gemini":
      return "GeminiCLI";
    case "codex":
      return "CodexCLI";
  }
}
