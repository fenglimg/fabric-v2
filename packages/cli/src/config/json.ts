import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";

import type { ClientConfigWriter, ClientKind, RemoveResult, ServerEntry } from "./writer.js";
import { createServerEntry } from "./writer.js";

type JsonObject = Record<string, unknown>;

export type DeepMergeOptions = {
  /**
   * Dotted-path keys (e.g. `"hooks.Stop"` or `"events.Stop"`) at which the
   * default array-REPLACE behaviour is replaced by array-APPEND-WITH-DEDUPE.
   * Two array items are considered duplicates when either:
   *   - both expose a top-level string `.command` field that matches, or
   *   - both expose a `hooks` array whose first element's `.command` matches,
   *   - or the items are deeply equal.
   * Omitting `arrayAppendPaths` (or passing an empty array) preserves the
   * historical REPLACE semantics — every existing call site is unchanged.
   */
  arrayAppendPaths?: string[];
};

/**
 * Minimal hand-rolled deep merge. Merges `source` into `target` recursively
 * for plain objects. By default arrays, primitives, and `null` are replaced
 * by the source value (matches the v1 contract). When `arrayAppendPaths` is
 * supplied, arrays at those dotted paths are merged via append-with-dedupe
 * instead of replaced — used by the rc.2 hook config writers to preserve
 * user-authored Stop entries while idempotently inserting fabric-archive.
 */
export function deepMerge<T>(target: T, source: unknown, options: DeepMergeOptions = {}): T {
  return deepMergeAtPath(target, source, "", options) as T;
}

function deepMergeAtPath(
  target: unknown,
  source: unknown,
  path: string,
  options: DeepMergeOptions,
): unknown {
  // Array-append special case: both sides must be arrays AND the current
  // path must be listed. Falls through to REPLACE if either side is not an
  // array (e.g. user wrote an object where we expected an array — defer to
  // source rather than crash).
  if (
    options.arrayAppendPaths &&
    options.arrayAppendPaths.includes(path) &&
    Array.isArray(target) &&
    Array.isArray(source)
  ) {
    return appendArrayWithDedupe(target, source);
  }

  if (
    target === null ||
    typeof target !== "object" ||
    Array.isArray(target) ||
    source === null ||
    typeof source !== "object" ||
    Array.isArray(source)
  ) {
    return source;
  }

  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const childPath = path === "" ? key : `${path}.${key}`;
    out[key] = deepMergeAtPath(
      (target as Record<string, unknown>)[key],
      (source as Record<string, unknown>)[key],
      childPath,
      options,
    );
  }

  return out;
}

function appendArrayWithDedupe(target: unknown[], source: unknown[]): unknown[] {
  const out = [...target];
  for (const candidate of source) {
    if (out.some((existing) => isSameHookEntry(existing, candidate))) {
      continue;
    }
    out.push(candidate);
  }
  return out;
}

function isSameHookEntry(a: unknown, b: unknown): boolean {
  const cmdA = extractHookCommand(a);
  const cmdB = extractHookCommand(b);
  if (cmdA !== null && cmdB !== null) {
    return cmdA === cmdB;
  }
  return deepEqual(a, b);
}

function extractHookCommand(item: unknown): string | null {
  if (item === null || typeof item !== "object") {
    return null;
  }
  const obj = item as Record<string, unknown>;
  if (typeof obj.command === "string") {
    return obj.command;
  }
  if (Array.isArray(obj.hooks)) {
    for (const inner of obj.hooks) {
      if (inner !== null && typeof inner === "object") {
        const innerObj = inner as Record<string, unknown>;
        if (typeof innerObj.command === "string") {
          return innerObj.command;
        }
      }
    }
  }
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
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
 * Idempotently remove a named MCP server entry from a JSON client config file.
 * Best-effort: returns `skipped` when the config file is absent or the named
 * entry is not present. Preserves all other `mcpServers` entries byte-for-byte;
 * the only structural change is the key deletion + rewrite via atomic JSON.
 *
 * Used by ClaudeCodeCLIWriter / ClaudeCodeDesktopWriter — the
 * JSON-format clients. Codex (TOML) implements its own remove() via
 * targeted regex stripping; see toml.ts.
 */
export async function removeJsonClientConfigEntry(
  configPath: string,
  serverName: string,
): Promise<RemoveResult> {
  if (!existsSync(configPath)) {
    return { status: "skipped", path: configPath, message: "no-config-file" };
  }

  let existing: JsonObject;
  try {
    existing = await readJsonConfig(configPath);
  } catch (error: unknown) {
    return {
      status: "error",
      path: configPath,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const mcpServers = existing.mcpServers;
  if (
    mcpServers === undefined ||
    mcpServers === null ||
    typeof mcpServers !== "object" ||
    Array.isArray(mcpServers)
  ) {
    return { status: "skipped", path: configPath, message: "no-mcp-servers-object" };
  }

  const servers = mcpServers as JsonObject;
  if (!Object.prototype.hasOwnProperty.call(servers, serverName)) {
    return { status: "skipped", path: configPath, message: "not-present" };
  }

  const nextServers: JsonObject = { ...servers };
  delete nextServers[serverName];
  const next: JsonObject = { ...existing, mcpServers: nextServers };

  try {
    await mkdir(dirname(configPath), { recursive: true });
    await atomicWriteJson(configPath, next, { indent: 2 });
    return { status: "removed", path: configPath };
  } catch (error: unknown) {
    return {
      status: "error",
      path: configPath,
      message: error instanceof Error ? error.message : String(error),
    };
  }
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

  async remove(serverName: string, workspaceRoot: string, overridePath?: string): Promise<RemoveResult> {
    const configPath = await this.detect(workspaceRoot, overridePath);
    if (configPath === null) {
      return { status: "skipped", message: "no-config-path" };
    }

    return removeJsonClientConfigEntry(configPath, serverName);
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

