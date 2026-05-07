import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { FabricConfig, McpPayloadLimits } from "@fenglimg/fabric-shared";

/**
 * Reads fabric.config.json from the project root.
 * Returns an empty config object when the file is absent.
 * Throws if the file content is not a JSON object.
 */
function readFabricConfig(projectRoot: string): FabricConfig {
  const configPath = join(projectRoot, "fabric.config.json");
  if (!existsSync(configPath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected object in ${configPath}`);
  }

  return parsed as FabricConfig;
}

/**
 * Returns the mcpPayloadLimits block from fabric.config.json, or undefined
 * when absent so call sites fall back to the guard's built-in defaults.
 */
export function readPayloadLimits(projectRoot: string): McpPayloadLimits | undefined {
  return readFabricConfig(projectRoot).mcpPayloadLimits;
}
