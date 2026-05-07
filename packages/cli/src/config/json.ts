import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";

import type { ClientConfigWriter, ClientKind, ServerEntry } from "./writer.js";
import { createServerEntry } from "./writer.js";

type JsonObject = Record<string, unknown>;

/**
 * Minimal hand-rolled deep merge. Merges `source` into `target` recursively
 * for plain objects; all other values (arrays, primitives, null) are replaced
 * by the source value. Avoids the lodash dependency.
 */
function deepMerge<T>(target: T, source: unknown): T {
  if (
    target === null ||
    typeof target !== "object" ||
    Array.isArray(target) ||
    source === null ||
    typeof source !== "object" ||
    Array.isArray(source)
  ) {
    return source as T;
  }

  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(source as Record<string, unknown>)) {
    out[key] = deepMerge(
      (target as Record<string, unknown>)[key],
      (source as Record<string, unknown>)[key],
    );
  }

  return out as T;
}

export type ClaudeMcpScope = "project" | "user";

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
  const existing = await readJsonConfig(configPath);
  const merged = deepMerge(existing, { mcpServers: { fabric: serverEntry } });

  await mkdir(dirname(configPath), { recursive: true });
  await atomicWriteJson(configPath, merged, { indent: 2 });
}

/**
 * Writes the Fabric MCP server entry to the correct Claude Code config file.
 *
 * - project scope: `<projectRoot>/.mcp.json`  (per Claude Code spec)
 * - user scope:    `~/.claude.json`
 *
 * Deep-merges with any existing content so other mcpServers entries are
 * preserved. Returns the path that was written and whether other servers
 * already existed.
 */
export async function writeClaudeMcpConfig(
  projectRoot: string,
  fabricEntry: ServerEntry,
  scope: ClaudeMcpScope,
): Promise<{ path: string; merged: boolean }> {
  const target =
    scope === "user"
      ? join(homedir(), ".claude.json")
      : join(projectRoot, ".mcp.json");

  const existing = await readJsonConfig(target);
  const hadOtherServers =
    existing.mcpServers !== null &&
    typeof existing.mcpServers === "object" &&
    !Array.isArray(existing.mcpServers) &&
    Object.keys(existing.mcpServers as JsonObject).length > 0;

  const merged = deepMerge(existing, { mcpServers: { fabric: fabricEntry } });

  await mkdir(dirname(target), { recursive: true });
  await atomicWriteJson(target, merged, { indent: 2 });

  return { path: target, merged: hadOtherServers };
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

  private readonly scope: ClaudeMcpScope;

  constructor(configuredPath?: string, scope: ClaudeMcpScope = "project") {
    super(configuredPath);
    this.scope = scope;
  }

  // Writes to project-level .mcp.json (per Claude Code MCP spec) by default,
  // or ~/.claude.json for user scope.
  // Detection still checks ~/.claude to confirm Claude Code is installed.
  protected defaultPath(workspaceRoot: string): string | null {
    const globalClaudeDir = join(homedir(), ".claude");
    const projectClaudeDir = join(workspaceRoot, ".claude");
    if (!existsSync(globalClaudeDir) && !existsSync(projectClaudeDir)) {
      return null;
    }

    return this.scope === "user"
      ? join(homedir(), ".claude.json")
      : join(workspaceRoot, ".mcp.json");
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

