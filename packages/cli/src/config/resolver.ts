import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { ClientPaths, FabricConfig } from "@fabric/shared";
import { ClaudeCodeDesktopWriter, getClaudeDesktopConfigPath } from "./claude-code.js";
import { ClaudeCodeCLIWriter, CursorWriter, GeminiCLIWriter, RooCodeWriter, WindsurfWriter } from "./json.js";
import { CodexTOMLConfigWriter } from "./toml.js";
import type { ClientConfigWriter } from "./writer.js";

export type { ClientPaths, FabricConfig } from "@fabric/shared";
export { clientPathsSchema, fabricConfigSchema } from "@fabric/shared";

function hasExplicitPath(clientPaths: ClientPaths | undefined, key: keyof ClientPaths): boolean {
  return typeof clientPaths?.[key] === "string" && clientPaths[key]!.trim().length > 0;
}

function addIfDetected(
  writers: ClientConfigWriter[],
  detected: boolean,
  createWriter: (configuredPath?: string) => ClientConfigWriter,
  configuredPath?: string,
): void {
  if (configuredPath !== undefined || detected) {
    writers.push(createWriter(configuredPath));
  }
}

export function resolveClients(workspaceRoot: string, fabricConfig: FabricConfig = {}): ClientConfigWriter[] {
  const clientPaths = fabricConfig.clientPaths;
  const writers: ClientConfigWriter[] = [];

  addIfDetected(
    writers,
    existsSync(join(homedir(), ".claude")) || existsSync(join(workspaceRoot, ".claude")),
    (configuredPath) => new ClaudeCodeCLIWriter(configuredPath),
    hasExplicitPath(clientPaths, "claudeCodeCLI") ? clientPaths!.claudeCodeCLI : undefined,
  );

  addIfDetected(
    writers,
    existsSync(getClaudeDesktopConfigPath()),
    (configuredPath) => new ClaudeCodeDesktopWriter(configuredPath),
    hasExplicitPath(clientPaths, "claudeCodeDesktop") ? clientPaths!.claudeCodeDesktop : undefined,
  );

  addIfDetected(
    writers,
    existsSync(join(workspaceRoot, ".cursor")),
    (configuredPath) => new CursorWriter(configuredPath),
    hasExplicitPath(clientPaths, "cursor") ? clientPaths!.cursor : undefined,
  );

  addIfDetected(
    writers,
    existsSync(join(workspaceRoot, ".windsurf")),
    (configuredPath) => new WindsurfWriter(configuredPath),
    hasExplicitPath(clientPaths, "windsurf") ? clientPaths!.windsurf : undefined,
  );

  addIfDetected(
    writers,
    existsSync(join(workspaceRoot, ".roo")),
    (configuredPath) => new RooCodeWriter(configuredPath),
    hasExplicitPath(clientPaths, "rooCode") ? clientPaths!.rooCode : undefined,
  );

  addIfDetected(
    writers,
    existsSync(join(homedir(), ".gemini")) || existsSync(join(workspaceRoot, "GEMINI.md")),
    (configuredPath) => new GeminiCLIWriter(configuredPath),
    hasExplicitPath(clientPaths, "geminiCLI") ? clientPaths!.geminiCLI : undefined,
  );

  addIfDetected(
    writers,
    existsSync(join(homedir(), ".codex")),
    (configuredPath) => new CodexTOMLConfigWriter(configuredPath),
    hasExplicitPath(clientPaths, "codexCLI") ? clientPaths!.codexCLI : undefined,
  );

  return writers;
}
