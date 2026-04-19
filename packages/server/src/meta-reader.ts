import { readFileSync } from "node:fs";
import { join } from "node:path";

import { agentsMetaSchema, type AgentsMeta } from "@fabric/shared";

export type { AgentsMeta } from "@fabric/shared";
export { agentsMetaNodeSchema, agentsMetaSchema } from "@fabric/shared";

export class AgentsMetaFileMissingError extends Error {
  readonly code = "FABRIC_META_MISSING";

  constructor(readonly metaPath: string) {
    super(`Fabric agents metadata file is missing: ${metaPath}`);
    this.name = "AgentsMetaFileMissingError";
  }
}

export class AgentsMetaInvalidError extends Error {
  readonly code = "FABRIC_META_INVALID";

  constructor(readonly metaPath: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);

    super(`Fabric agents metadata file is invalid: ${metaPath}. ${detail}`);
    this.name = "AgentsMetaInvalidError";
  }
}

function getAgentsMetaPath(projectRoot: string): string {
  return join(projectRoot, ".fabric", "agents.meta.json");
}

export function resolveProjectRoot(): string {
  return process.env.FABRIC_PROJECT_ROOT ?? process.cwd();
}

export function readAgentsMeta(projectRoot: string): AgentsMeta {
  const metaPath = getAgentsMetaPath(projectRoot);

  let raw: string;

  try {
    raw = readFileSync(metaPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new AgentsMetaFileMissingError(metaPath);
    }

    throw error;
  }

  try {
    return agentsMetaSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new AgentsMetaInvalidError(metaPath, error);
  }
}

export function getRevision(projectRoot: string): string {
  return readAgentsMeta(projectRoot).revision;
}
