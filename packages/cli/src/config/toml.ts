import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import { atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

import type { ClientConfigWriter, RemoveResult, ServerEntry } from "./writer.js";
import { createServerEntry } from "./writer.js";

function expandHome(filePath: string): string {
  if (filePath === "~") {
    return homedir();
  }

  if (filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(2));
  }

  return filePath;
}

function escapeTomlString(value: string): string {
  return JSON.stringify(value);
}

function serializeTomlStringArray(values: string[]): string {
  return `[${values.map((value) => escapeTomlString(value)).join(", ")}]`;
}

function serializeTomlInlineTable(values: Record<string, string>): string {
  const entries = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key} = ${escapeTomlString(value)}`);

  return `{ ${entries.join(", ")} }`;
}

function serializeCodexServerBlock(serverName: string, serverEntry: ServerEntry): string {
  const lines = [
    `[mcp_servers.${serverName}]`,
    `command = ${escapeTomlString(serverEntry.command)}`,
    `args = ${serializeTomlStringArray(serverEntry.args)}`,
  ];

  if (serverEntry.env !== undefined && Object.keys(serverEntry.env).length > 0) {
    lines.push(`env = ${serializeTomlInlineTable(serverEntry.env)}`);
  }

  return `${lines.join("\n")}\n`;
}

function trimTrailingBlankLines(value: string): string {
  return value.replace(/\s+$/u, "");
}

/**
 * Strip any `[mcp_servers.<serverName>]` (and the legacy `[mcp.servers.<serverName>]`)
 * blocks from a Codex TOML config string. Returns the resulting TOML text and
 * whether a block was actually removed (used by callers to distinguish
 * `removed` vs `skipped` results).
 *
 * Preserves all other content byte-for-byte aside from collapsing trailing
 * whitespace. Idempotent: invoking on a config that no longer contains the
 * block is a no-op (`changed=false`).
 */
function removeCodexServerBlock(
  rawConfig: string,
  serverName: string,
): { text: string; changed: boolean } {
  const normalized = rawConfig.replace(/\r\n/g, "\n");
  const escaped = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const legacyPattern = new RegExp(
    String.raw`\n?\[mcp\.servers\.${escaped}\]\n[\s\S]*?(?=\n\[[^\n]+\]\n|$)`,
    "g",
  );
  const currentPattern = new RegExp(
    String.raw`\n?\[mcp_servers\.${escaped}\]\n[\s\S]*?(?=\n\[[^\n]+\]\n|$)`,
    "g",
  );

  const withoutLegacy = normalized.replace(legacyPattern, "");
  const withoutCurrent = withoutLegacy.replace(currentPattern, "");
  const changed = withoutCurrent !== normalized;
  // Trim trailing whitespace only when something was removed — otherwise the
  // caller's check for "no change" stays byte-accurate against the original.
  const text = changed ? `${trimTrailingBlankLines(withoutCurrent)}\n` : rawConfig;
  return { text, changed };
}

function upsertCodexServerBlock(rawConfig: string, serverName: string, serverEntry: ServerEntry): string {
  const block = serializeCodexServerBlock(serverName, serverEntry);
  const normalized = rawConfig.replace(/\r\n/g, "\n");
  const legacyPattern = new RegExp(String.raw`\n?\[mcp\.servers\.${serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\]\n[\s\S]*?(?=\n\[[^\n]+\]\n|$)`, "g");
  const currentPattern = new RegExp(
    String.raw`\n?\[mcp_servers\.${serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\]\n[\s\S]*?(?=\n\[[^\n]+\]\n|$)`,
    "g",
  );

  const withoutLegacy = normalized.replace(legacyPattern, "");
  const withoutExisting = withoutLegacy.replace(currentPattern, "");
  const trimmed = trimTrailingBlankLines(withoutExisting);

  if (trimmed.length === 0) {
    return block;
  }

  return `${trimmed}\n\n${block}`;
}

async function readTomlConfigText(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
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

    const rawConfig = await readTomlConfigText(configPath);
    const nextConfig = upsertCodexServerBlock(rawConfig, "fabric", createServerEntry(serverPath));

    await mkdir(dirname(configPath), { recursive: true });
    await atomicWriteText(configPath, nextConfig);
  }

  async remove(serverName: string, workspaceRoot: string, overridePath?: string): Promise<RemoveResult> {
    const configPath = await this.detect(workspaceRoot, overridePath);
    if (configPath === null) {
      return { status: "skipped", message: "no-config-path" };
    }

    if (!existsSync(configPath)) {
      return { status: "skipped", path: configPath, message: "no-config-file" };
    }

    let rawConfig: string;
    try {
      rawConfig = await readTomlConfigText(configPath);
    } catch (error: unknown) {
      return {
        status: "error",
        path: configPath,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const { text, changed } = removeCodexServerBlock(rawConfig, serverName);
    if (!changed) {
      return { status: "skipped", path: configPath, message: "not-present" };
    }

    try {
      await mkdir(dirname(configPath), { recursive: true });
      await atomicWriteText(configPath, text);
      return { status: "removed", path: configPath };
    } catch (error: unknown) {
      return {
        status: "error",
        path: configPath,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export { removeCodexServerBlock, serializeCodexServerBlock, upsertCodexServerBlock };
