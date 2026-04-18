import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import type { ClientConfigWriter, ClientKind, ServerEntry } from "./writer.js";
import { createServerEntry } from "./writer.js";

type JsonObject = Record<string, unknown>;

function expandHome(filePath: string): string {
  if (filePath === "~") {
    return homedir();
  }

  if (filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(2));
  }

  return filePath;
}

export function normalizeConfigPath(filePath: string): string {
  return resolve(expandHome(filePath));
}

async function readJsonConfig(configPath: string): Promise<JsonObject> {
  try {
    const raw = await readFile(configPath, "utf8");
    if (raw.trim().length === 0) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Expected JSON object in ${configPath}`);
    }

    return parsed as JsonObject;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function writeJsonClientConfig(configPath: string, serverEntry: ServerEntry): Promise<void> {
  const config = await readJsonConfig(configPath);
  const existingServers = config.mcpServers;

  config.mcpServers =
    existingServers !== null && typeof existingServers === "object" && !Array.isArray(existingServers)
      ? { ...(existingServers as JsonObject), fabric: serverEntry }
      : { fabric: serverEntry };

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

abstract class JsonClientConfigWriter implements ClientConfigWriter {
  abstract readonly clientKind: ClientKind;
  private readonly configuredPath?: string;

  protected constructor(configuredPath?: string) {
    this.configuredPath = configuredPath;
  }

  protected abstract defaultPath(workspaceRoot: string): string | null;

  async detect(workspaceRoot: string, overridePath?: string): Promise<string | null> {
    const explicitPath = overridePath ?? this.configuredPath;
    if (explicitPath !== undefined) {
      return normalizeConfigPath(explicitPath);
    }

    const configPath = this.defaultPath(workspaceRoot);
    return configPath === null ? null : normalizeConfigPath(configPath);
  }

  async write(serverPath: string, workspaceRoot: string, overridePath?: string): Promise<void> {
    const configPath = await this.detect(workspaceRoot, overridePath);
    if (configPath === null) {
      return;
    }

    await writeJsonClientConfig(configPath, createServerEntry(serverPath));
  }
}

export class ClaudeCodeCLIWriter extends JsonClientConfigWriter {
  readonly clientKind = "ClaudeCodeCLI" as const;

  constructor(configuredPath?: string) {
    super(configuredPath);
  }

  protected defaultPath(): string | null {
    const claudeDir = join(homedir(), ".claude");
    return existsSync(claudeDir) ? join(claudeDir, "settings.json") : null;
  }
}

export class CursorWriter extends JsonClientConfigWriter {
  readonly clientKind = "Cursor" as const;

  constructor(configuredPath?: string) {
    super(configuredPath);
  }

  protected defaultPath(workspaceRoot: string): string | null {
    const cursorDir = join(workspaceRoot, ".cursor");
    return existsSync(cursorDir) ? join(cursorDir, "mcp.json") : null;
  }
}

export class WindsurfWriter extends JsonClientConfigWriter {
  readonly clientKind = "Windsurf" as const;

  constructor(configuredPath?: string) {
    super(configuredPath);
  }

  protected defaultPath(workspaceRoot: string): string | null {
    const windsurfDir = join(workspaceRoot, ".windsurf");
    return existsSync(windsurfDir) ? join(windsurfDir, "mcp.json") : null;
  }
}

export class RooCodeWriter extends JsonClientConfigWriter {
  readonly clientKind = "RooCode" as const;

  constructor(configuredPath?: string) {
    super(configuredPath);
  }

  protected defaultPath(workspaceRoot: string): string | null {
    const rooDir = join(workspaceRoot, ".roo");
    return existsSync(rooDir) ? join(rooDir, "mcp.json") : null;
  }
}

export class GeminiCLIWriter extends JsonClientConfigWriter {
  readonly clientKind = "GeminiCLI" as const;

  constructor(configuredPath?: string) {
    super(configuredPath);
  }

  protected defaultPath(workspaceRoot: string): string | null {
    const geminiDir = join(homedir(), ".gemini");
    return existsSync(geminiDir) || existsSync(join(workspaceRoot, "GEMINI.md"))
      ? join(geminiDir, "settings.json")
      : null;
  }
}
