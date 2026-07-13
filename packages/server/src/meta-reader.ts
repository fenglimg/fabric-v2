import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

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

// v2.3.0-rc.11: root-cause fix for the stray-`.fabric/` fault mode that Cascade
// triggers when the server subprocess is launched from a subdirectory of the
// project (e.g. `fabric …` invoked from `scripts/asset-dedup/out/`). The old
// implementation returned `process.cwd()` unchanged, so downstream writers
// (plan-context bm25, vector-retrieval, event-ledger, metrics) then created a
// brand-new `<cwd>/.fabric/` inside the subdirectory rather than writing to the
// authoritative repo root.
//
// The hook side already got a matching git-anchor resolver in rc.10
// (`packages/cli/templates/hooks/lib/project-root.cjs`, KT-DEC-0050). This is
// the server-side twin — same resolution order, plus the server-only
// FABRIC_PROJECT_ROOT explicit override kept at the top.
//
// Resolution order (first match wins):
//   1. FABRIC_PROJECT_ROOT — explicit operator override (server-only knob).
//   2. CLAUDE_PROJECT_DIR — the same env Claude Code injects into hooks.
//   3. Walk up from `startCwd` (default `process.cwd()`) to the nearest
//      ancestor holding a `.git/` marker. `.git` is the authoritative repo
//      anchor and — crucially — IMMUNE to the stray `.fabric/` subdirectories
//      this resolver exists to prevent (a stray `.fabric/` in a subdir must
//      NOT capture the walk).
//   4. No `.git` in the chain (non-git Fabric project): fall back to the
//      nearest pre-existing `.fabric/` anchor seen during the same climb.
//   5. Fall back to `startCwd` unchanged (fresh repo with no marker yet).
//
// `startCwd` is optional to keep call sites unchanged; tests pass a tmpdir.
/**
 * ISS-20260713-047: FABRIC_PROJECT_ROOT / CLAUDE_PROJECT_DIR are trusted-operator
 * overrides. Still realpath + require usable absolute roots so relative typos and
 * filesystem-root values fail closed to the git-anchor walk.
 */
function normalizeTrustedRootOverride(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const abs = isAbsolute(trimmed) ? trimmed : resolve(trimmed);
    const real = existsSync(abs) ? realpathSync(abs) : abs;
    if (real === "/" || /^[A-Za-z]:[\\/]?$/.test(real)) return null;
    return real;
  } catch {
    return null;
  }
}

export function resolveProjectRoot(startCwd?: string): string {
  const envOverride = process.env.FABRIC_PROJECT_ROOT;
  if (typeof envOverride === "string" && envOverride.length > 0) {
    const normalized = normalizeTrustedRootOverride(envOverride);
    if (normalized !== null) return normalized;
  }
  const claudeRoot = process.env.CLAUDE_PROJECT_DIR;
  if (typeof claudeRoot === "string" && claudeRoot.length > 0) {
    const normalized = normalizeTrustedRootOverride(claudeRoot);
    if (normalized !== null) return normalized;
  }

  const start = typeof startCwd === "string" && startCwd.length > 0 ? startCwd : process.cwd();
  let dir = start;
  let firstFabric: string | null = null;
  // Bounded climb — a real repo is a handful of hops; the cap guards against
  // symlink / mount loops.
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (firstFabric === null && existsSync(join(dir, ".fabric"))) firstFabric = dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return firstFabric ?? start;
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

// v2.0.0-rc.29 TASK-006 (BUG-Q1): removed `getRevision(projectRoot)` —
// orphan helper with zero callers across the entire monorepo. Callers that
// need the revision use `(await readAgentsMeta(projectRoot)).revision`
// directly, which avoids the extra round-trip through this 1-liner.
