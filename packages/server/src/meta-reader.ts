import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { agentsMetaSchema, type AgentsMeta } from "@fenglimg/fabric-shared";

import { contextCache } from "./cache.js";

export type { AgentsMeta } from "@fenglimg/fabric-shared";
export { agentsMetaNodeSchema, agentsMetaSchema } from "@fenglimg/fabric-shared";

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

export async function readAgentsMeta(projectRoot: string): Promise<AgentsMeta> {
  const cached = contextCache.get<AgentsMeta>("meta", projectRoot);
  if (cached !== undefined) {
    return cached;
  }

  const metaPath = getAgentsMetaPath(projectRoot);
  let raw: string;

  try {
    raw = await readFile(metaPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new AgentsMetaFileMissingError(metaPath);
    }

    throw error;
  }

  let parsed: AgentsMeta;
  try {
    parsed = agentsMetaSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new AgentsMetaInvalidError(metaPath, error);
  }

  contextCache.set("meta", projectRoot, parsed);
  return parsed;
}

export async function getRevision(projectRoot: string): Promise<string> {
  return (await readAgentsMeta(projectRoot)).revision;
}
