import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, platform } from "node:os";

import type { ClientConfigWriter, McpRootPolicy, RemoveResult, ServerEntry } from "./writer.js";
import { createServerEntry } from "./writer.js";
import { ClaudeCodeCLIWriter, normalizeConfigPath, removeJsonClientConfigEntry, writeJsonClientConfig } from "./json.js";

export function getClaudeDesktopConfigPath(): string {
  const os = platform();

  if (os === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }

  if (os === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }

  // Linux and other Unix-like platforms use the conventional XDG-style fallback.
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function writeSkip(message: string): void {
  process.stderr.write(`${message}\n`);
}

export class ClaudeCodeDesktopWriter implements ClientConfigWriter {
  readonly clientKind = "ClaudeCodeDesktop" as const;
  private readonly configuredPath?: string;

  constructor(configuredPath?: string) {
    this.configuredPath = configuredPath;
  }

  async detect(_workspaceRoot: string, overridePath?: string): Promise<string | null> {
    const configPath = normalizeConfigPath(overridePath ?? this.configuredPath ?? getClaudeDesktopConfigPath());
    return existsSync(configPath) || overridePath !== undefined || this.configuredPath !== undefined ? configPath : null;
  }

  async write(serverPath: string, workspaceRoot: string, overridePath?: string, mcpRootPolicy?: McpRootPolicy): Promise<void> {
    const configPath = await this.detect(workspaceRoot, overridePath);
    if (configPath === null) {
      return;
    }

    await writeJsonClientConfig(configPath, createServerEntry(serverPath, mcpRootPolicy), this.clientKind);
  }

  async remove(serverName: string, workspaceRoot: string, overridePath?: string): Promise<RemoveResult> {
    const configPath = await this.detect(workspaceRoot, overridePath);
    if (configPath === null) {
      return { status: "skipped", message: "no-config-path" };
    }

    return removeJsonClientConfigEntry(configPath, serverName);
  }
}

export async function writeClaudeCodeAll(serverEntry: ServerEntry, workspaceRoot: string): Promise<void> {
  const cliWriter = new ClaudeCodeCLIWriter();
  const desktopWriter = new ClaudeCodeDesktopWriter();
  const entries: Array<[ClientConfigWriter, string]> = [
    [cliWriter, resolve(join(homedir(), ".claude", "settings.json"))],
    [desktopWriter, getClaudeDesktopConfigPath()],
  ];

  for (const [writer, defaultPath] of entries) {
    const configPath = await writer.detect(workspaceRoot, defaultPath);
    if (configPath === null) {
      writeSkip(`Skipping ${writer.clientKind}: no config path detected.`);
      continue;
    }

    if (!existsSync(configPath)) {
      writeSkip(`Skipping ${writer.clientKind} because config path does not exist: ${configPath}`);
      continue;
    }

    await writeJsonClientConfig(configPath, serverEntry, writer.clientKind);
  }
}

export { ClaudeCodeCLIWriter };
