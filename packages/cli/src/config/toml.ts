import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import * as TOML from "@iarna/toml";

import type { ClientConfigWriter, ServerEntry } from "./writer.js";
import { createServerEntry } from "./writer.js";

type TomlObject = Record<string, unknown>;

function expandHome(filePath: string): string {
  if (filePath === "~") {
    return homedir();
  }

  if (filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(2));
  }

  return filePath;
}

function asObject(value: unknown): TomlObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as TomlObject) : {};
}

async function readTomlConfig(configPath: string): Promise<TomlObject> {
  try {
    const raw = await readFile(configPath, "utf8");
    if (raw.trim().length === 0) {
      return {};
    }

    return TOML.parse(raw) as TomlObject;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function mergeCodexServer(config: TomlObject, serverEntry: ServerEntry): TomlObject {
  const mcp = asObject(config.mcp);
  const servers = asObject(mcp.servers);

  servers.fabric = serverEntry;
  mcp.servers = servers;
  config.mcp = mcp;

  return config;
}

export class CodexTOMLConfigWriter implements ClientConfigWriter {
  readonly clientKind = "CodexCLI" as const;
  private readonly configuredPath?: string;

  constructor(configuredPath?: string) {
    this.configuredPath = configuredPath;
  }

  async detect(_workspaceRoot: string, overridePath?: string): Promise<string | null> {
    const explicitPath = overridePath ?? this.configuredPath;
    if (explicitPath !== undefined) {
      return resolve(expandHome(explicitPath));
    }

    const codexDir = join(homedir(), ".codex");
    return existsSync(codexDir) ? resolve(join(codexDir, "config.toml")) : null;
  }

  async write(serverPath: string, workspaceRoot: string, overridePath?: string): Promise<void> {
    const configPath = await this.detect(workspaceRoot, overridePath);
    if (configPath === null) {
      return;
    }

    const config = mergeCodexServer(await readTomlConfig(configPath), createServerEntry(serverPath));

    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, TOML.stringify(config), "utf8");
  }
}
