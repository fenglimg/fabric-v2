import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import type { FabricConfig } from "./config/resolver.js";

export type DevModeSource = "cli" | "env" | "config" | "cwd";

export type DevModeResolution = {
  target: string;
  source: DevModeSource;
  chain: string[];
};

export type DebugLogger = (message: string) => void;

export function readFabricConfig(workspaceRoot: string = process.cwd()): FabricConfig {
  const configPath = join(workspaceRoot, "fabric.config.json");
  if (!existsSync(configPath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected object in ${configPath}`);
  }

  return parsed as FabricConfig;
}

export function resolveDevMode(cliTarget?: string, workspaceRoot: string = process.cwd()): DevModeResolution {
  const envTarget = normalizeTarget(process.env.EXTERNAL_FIXTURE_PATH, workspaceRoot);
  const fabricConfig = readFabricConfig(workspaceRoot);
  const configTarget = normalizeTarget(fabricConfig.externalFixturePath, workspaceRoot);
  const directTarget = normalizeTarget(cliTarget, workspaceRoot);

  const chain = [
    formatResolutionStep("cliTarget", directTarget),
    formatResolutionStep("EXTERNAL_FIXTURE_PATH", envTarget),
    formatResolutionStep("fabric.config.json.externalFixturePath", configTarget),
    formatResolutionStep("process.cwd()", workspaceRoot),
  ];

  if (directTarget !== undefined) {
    return { target: directTarget, source: "cli", chain };
  }

  if (envTarget !== undefined) {
    return { target: envTarget, source: "env", chain };
  }

  if (configTarget !== undefined) {
    return { target: configTarget, source: "config", chain };
  }

  return { target: workspaceRoot, source: "cwd", chain };
}

export function resolveDevModeTarget(cliTarget?: string): string {
  return resolveDevMode(cliTarget).target;
}

export function isDevMode(cliTarget?: string): boolean {
  return normalizeTarget(cliTarget) !== undefined || normalizeTarget(process.env.EXTERNAL_FIXTURE_PATH) !== undefined;
}

export function createDebugLogger(debug?: boolean): DebugLogger {
  const enabled = debug === true || process.env.FABRIC_DEBUG === "1";

  return (message: string) => {
    if (!enabled) {
      return;
    }

    process.stderr.write(`[fabric:debug] ${message}\n`);
  };
}

function normalizeTarget(value: string | undefined, workspaceRoot: string = process.cwd()): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return isAbsolute(value) ? value : resolve(workspaceRoot, value);
}

function formatResolutionStep(source: string, value: string | undefined): string {
  return `${source}: ${value ?? "<unset>"}`;
}
