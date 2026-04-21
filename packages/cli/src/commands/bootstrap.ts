import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FabricConfig } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

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

  for (const bootstrapTarget of targets) {
    const detail = installBootstrapTarget(bootstrapTarget, workspaceRoot, options);
    details.push(detail);

    if (detail.action === "skipped") {
      skipped.push(bootstrapTarget.client);
    } else {
      installed.push(bootstrapTarget.client);
    }
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

function installBootstrapTarget(
  target: BootstrapTarget,
  workspaceRoot: string,
  options: InstallBootstrapOptions,
): BootstrapInstallDetail {
  const targetPath = resolve(workspaceRoot, CLIENT_TARGET_MAP[target.bootstrapClient]);
  const templatePath = findTemplatePath(CLIENT_TEMPLATE_MAP[target.bootstrapClient]);
  const template = readFileSync(templatePath, "utf8");

  mkdirSync(dirname(targetPath), { recursive: true });

  if (target.bootstrapClient === "codex") {
    return {
      client: target.client,
      path: targetPath,
      action: writeCodexBootstrap(targetPath, template, options.force),
    };
  }

  const existed = existsSync(targetPath);
  writeFileSync(targetPath, ensureTrailingNewline(template), "utf8");
  return {
    client: target.client,
    path: targetPath,
    action: existed ? "overwritten" : "installed",
  };
}

function writeCodexBootstrap(targetPath: string, template: string, force?: boolean): BootstrapInstallAction {
  const nextContent = ensureTrailingNewline(template);

  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, nextContent, "utf8");
    return "installed";
  }

  const existing = readFileSync(targetPath, "utf8");
  if (existing.includes("# Fabric Bootstrap")) {
    if (!force) {
      return "skipped";
    }

    const remainder = stripExistingCodexBootstrap(existing, nextContent);
    writeFileSync(targetPath, joinBootstrapSections(nextContent, remainder), "utf8");
    return "overwritten";
  }

  writeFileSync(targetPath, joinBootstrapSections(nextContent, existing), "utf8");
  return force ? "overwritten" : "prepended";
}

function stripExistingCodexBootstrap(existing: string, template: string): string {
  if (existing.startsWith(template)) {
    return existing.slice(template.length).replace(/^\n+/, "");
  }

  if (!existing.startsWith("# Fabric Bootstrap")) {
    return existing;
  }

  const nextTopLevelHeadingIndex = existing.indexOf("\n# ", "# Fabric Bootstrap".length);
  if (nextTopLevelHeadingIndex === -1) {
    return "";
  }

  return existing.slice(nextTopLevelHeadingIndex + 1).replace(/^\n+/, "");
}

function joinBootstrapSections(header: string, body: string): string {
  if (body.trim().length === 0) {
    return header;
  }

  const separator = body.startsWith("\n") ? "" : "\n";
  return `${header}${separator}${body}`;
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

  throw new Error(t("cli.shared.template-not-found", { path: relativePath }));
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

  return candidates.reverse();
}
