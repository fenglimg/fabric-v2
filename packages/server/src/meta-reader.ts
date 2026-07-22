import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { agentsMetaSchema, type AgentsMeta } from "@fenglimg/fabric-shared";
import { IOFabricError } from "@fenglimg/fabric-shared/errors";

import { contextCache } from "./cache.js";

// v2.0.0-rc.29 TASK-006 (BUG-Q1): dropped `agentsMetaNodeSchema` re-export —
// downstream consumers (cli/tests) import it directly from
// `@fenglimg/fabric-shared`, the re-export here was dead. `agentsMetaSchema` is
// still re-exported because `parseAgentsMetaFile` below uses it internally and
// other server modules consume the type via this barrel.
export type { AgentsMeta } from "@fenglimg/fabric-shared";
export { agentsMetaSchema } from "@fenglimg/fabric-shared";

export class AgentsMetaFileMissingError extends IOFabricError {
  readonly code = "FABRIC_META_MISSING";
  readonly httpStatus = 404;

  constructor(readonly metaPath: string, opts?: { actionHint?: string }) {
    super(`Fabric agents metadata file is missing: ${metaPath}`, {
      actionHint: opts?.actionHint ?? "Run `fabric install` to scaffold the .fabric/agents.meta.json file",
    });
  }
}

export class AgentsMetaInvalidError extends IOFabricError {
  readonly code = "FABRIC_META_INVALID";
  readonly httpStatus = 500;

  constructor(readonly metaPath: string, cause: unknown, opts?: { actionHint?: string }) {
    const detail = cause instanceof Error ? cause.message : String(cause);

    super(`Fabric agents metadata file is invalid: ${metaPath}. ${detail}`, {
      actionHint: opts?.actionHint ?? "Check the agents.meta.json file for schema errors and regenerate if needed",
    });
  }
}

function getAgentsMetaPath(projectRoot: string): string {
  return join(projectRoot, ".fabric", "agents.meta.json");
}

// Compatibility facade: project-root/context ownership lives in
// project-context-provider.ts. Keep these exports so downstream consumers do
// not acquire a second resolution policy during the migration.
export {
  isProjectRootConfigured,
  resetMcpRootsHint,
  resolveProjectRoot,
  setMcpRootsHint,
} from "./project-context-provider.js";

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

// v2.0.0-rc.29 TASK-006 (BUG-Q1): removed `getRevision(projectRoot)` —
// orphan helper with zero callers across the entire monorepo. Callers that
// need the revision use `(await readAgentsMeta(projectRoot)).revision`
// directly, which avoids the extra round-trip through this 1-liner.
