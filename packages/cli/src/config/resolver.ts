import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { ClientPaths, FabricConfig } from "@fenglimg/fabric-shared";
import { ClaudeCodeDesktopWriter, getClaudeDesktopConfigPath } from "./claude-code.js";
import { ClaudeCodeCLIWriter, CursorWriter, GeminiCLIWriter, RooCodeWriter, WindsurfWriter } from "./json.js";
import { CodexTOMLConfigWriter } from "./toml.js";
import type { ClientConfigWriter } from "./writer.js";

export type { ClientPaths, FabricConfig } from "@fenglimg/fabric-shared";
export { clientPathsSchema, fabricConfigSchema } from "@fenglimg/fabric-shared";

export type DetectedClientCapability =
  | "bootstrap"
  | "mcp"
  | "hook"
  | "skill";

export type DetectedClientSupport = {
  clientKind: ClientConfigWriter["clientKind"];
  label: string;
  detected: boolean;
  bootstrapTargetPath: string | null;
  configPath: string | null;
  capabilities: Partial<Record<DetectedClientCapability, boolean>>;
  installedCapabilities?: Partial<Record<DetectedClientCapability, boolean>>;
};

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

export function detectClientSupports(
  workspaceRoot: string,
  fabricConfig: FabricConfig = {},
): DetectedClientSupport[] {
  const clientPaths = fabricConfig.clientPaths;
  const claudeDetected = existsSync(join(homedir(), ".claude")) || existsSync(join(workspaceRoot, ".claude"));
  const claudeDesktopDetected = existsSync(getClaudeDesktopConfigPath());
  const cursorDetected = existsSync(join(workspaceRoot, ".cursor"));
  const windsurfDetected = existsSync(join(workspaceRoot, ".windsurf"));
  const rooDetected = existsSync(join(workspaceRoot, ".roo"));
  const geminiDetected = existsSync(join(homedir(), ".gemini")) || existsSync(join(workspaceRoot, "GEMINI.md"));
  const codexDetected = existsSync(join(homedir(), ".codex"));

  return [
    {
      clientKind: "ClaudeCodeCLI",
      label: "Claude Code CLI",
      detected: claudeDetected || hasExplicitPath(clientPaths, "claudeCodeCLI"),
      bootstrapTargetPath: ".fabric/bootstrap/README.md",
      configPath: "project .claude/settings.json",
      capabilities: {
        bootstrap: true,
        mcp: true,
        hook: true,
        skill: true,
      },
      installedCapabilities: {
        hook: true,
        skill: true,
      },
    },
    {
      clientKind: "ClaudeCodeDesktop",
      label: "Claude Code Desktop",
      detected: claudeDesktopDetected || hasExplicitPath(clientPaths, "claudeCodeDesktop"),
      bootstrapTargetPath: ".fabric/bootstrap/README.md",
      configPath: "desktop Claude config",
      capabilities: {
        bootstrap: true,
        mcp: true,
        hook: false,
        skill: false,
      },
    },
    {
      clientKind: "Cursor",
      label: "Cursor",
      detected: cursorDetected || hasExplicitPath(clientPaths, "cursor"),
      bootstrapTargetPath: ".fabric/bootstrap/README.md",
      configPath: ".cursor/mcp.json",
      capabilities: {
        bootstrap: true,
        mcp: true,
        hook: false,
        skill: false,
      },
    },
    {
      clientKind: "Windsurf",
      label: "Windsurf",
      detected: windsurfDetected || hasExplicitPath(clientPaths, "windsurf"),
      bootstrapTargetPath: ".fabric/bootstrap/README.md",
      configPath: ".windsurf/mcp.json",
      capabilities: {
        bootstrap: true,
        mcp: true,
        hook: false,
        skill: false,
      },
    },
    {
      clientKind: "RooCode",
      label: "Roo Code",
      detected: rooDetected || hasExplicitPath(clientPaths, "rooCode"),
      bootstrapTargetPath: ".fabric/bootstrap/README.md",
      configPath: ".roo/mcp.json",
      capabilities: {
        bootstrap: true,
        mcp: true,
        hook: false,
        skill: false,
      },
    },
    {
      clientKind: "GeminiCLI",
      label: "Gemini CLI",
      detected: geminiDetected || hasExplicitPath(clientPaths, "geminiCLI"),
      bootstrapTargetPath: ".fabric/bootstrap/README.md",
      configPath: "~/.gemini/settings.json",
      capabilities: {
        bootstrap: true,
        mcp: true,
        hook: false,
        skill: false,
      },
    },
    {
      clientKind: "CodexCLI",
      label: "Codex CLI",
      detected: codexDetected || hasExplicitPath(clientPaths, "codexCLI"),
      bootstrapTargetPath: ".fabric/bootstrap/README.md",
      configPath: "~/.codex/config.toml",
      capabilities: {
        bootstrap: true,
        mcp: true,
        hook: true,
        skill: true,
      },
      installedCapabilities: {
        hook: existsSync(join(workspaceRoot, ".codex", "hooks.json")),
        skill: existsSync(join(workspaceRoot, ".agents", "skills", "fabric-init", "SKILL.md")),
      },
    },
  ];
}
