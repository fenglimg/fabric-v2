import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { loadProjectConfig } from "../store/project-config-io.js";
import { resolveBindingIdForRoots } from "../store/bindings.js";
import type {
  ProjectContext,
  ProjectContextResolverInput,
  ProjectRootResolution,
  ProjectRootResolver,
  ProjectRootSignals,
} from "./contracts.js";
import {
  ProjectContextAmbiguousError,
  ProjectContextUnresolvedError,
} from "./contracts.js";
import { resolveGitWorktreeIdentity } from "./git-worktree-identity.js";

interface ResolvedRoots {
  workspaceRoot: string;
  identityRoot: string;
}

function canonicalCandidate(raw: string, cwd: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  if (!existsSync(absolute)) return null;
  try {
    return realpathSync(absolute);
  } catch {
    return null;
  }
}

function findProjectMarker(start: string): string | null {
  let current = start;
  for (let depth = 0; depth < 64; depth += 1) {
    if (existsSync(join(current, ".fabric", "fabric-config.json"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/** Legacy hook adapter retained while callers migrate to ProjectContext. */
export function resolveProjectRoot(startCwd?: string): string {
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (typeof envRoot === "string" && envRoot.length > 0) return envRoot;

  const start =
    typeof startCwd === "string" && startCwd.length > 0 ? startCwd : process.cwd();
  let current = start;
  let firstFabric: string | null = null;
  for (let depth = 0; depth < 64; depth += 1) {
    if (existsSync(join(current, ".git"))) return current;
    if (firstFabric === null && existsSync(join(current, ".fabric"))) {
      firstFabric = current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return firstFabric ?? start;
}

function resolveRoots(candidate: string): ResolvedRoots | null {
  const gitIdentity = resolveGitWorktreeIdentity(candidate);
  if (gitIdentity !== null) {
    return {
      workspaceRoot: gitIdentity.workspaceRoot,
      identityRoot: gitIdentity.identityRoot,
    };
  }
  const marker = findProjectMarker(candidate);
  return marker === null ? null : { workspaceRoot: marker, identityRoot: marker };
}

function uniqueRoots(candidates: readonly string[], cwd: string): ResolvedRoots[] {
  const roots = new Map<string, ResolvedRoots>();
  for (const raw of candidates) {
    const candidate = canonicalCandidate(raw, cwd);
    if (candidate === null) continue;
    const resolved = resolveRoots(candidate);
    if (resolved !== null) roots.set(resolved.workspaceRoot, resolved);
  }
  return [...roots.values()];
}

export function createProjectContextResolver(
  input: ProjectContextResolverInput = {},
): Readonly<ProjectContext> {
  const cwd = input.cwd ?? process.cwd();
  let source: ProjectContext["source"];
  let rawCandidates: readonly string[];

  if (input.explicitRoot !== undefined) {
    source = "explicit-pin";
    rawCandidates = [input.explicitRoot];
  } else if (input.roots !== undefined) {
    source = "client-root";
    rawCandidates = input.roots;
  } else {
    source = "cwd";
    rawCandidates = [cwd];
  }

  const roots = uniqueRoots(rawCandidates, cwd);
  if (roots.length === 0) {
    throw new ProjectContextUnresolvedError(rawCandidates);
  }
  if (roots.length > 1) {
    throw new ProjectContextAmbiguousError(roots.map((root) => root.workspaceRoot));
  }

  const { workspaceRoot, identityRoot } = roots[0]!;
  const identityConfig = loadProjectConfig(identityRoot);
  const projectId = identityConfig?.project_id;
  const bindingId = resolveBindingIdForRoots(identityRoot, workspaceRoot);
  if (projectId === undefined || bindingId === undefined) {
    throw new ProjectContextUnresolvedError([workspaceRoot]);
  }

  return Object.freeze({ workspaceRoot, identityRoot, projectId, bindingId, source });
}

/** Legacy pure adapter retained for callers that still collect root signals. */
export function createProjectRootResolver(): ProjectRootResolver {
  return {
    resolve(signals: ProjectRootSignals): ProjectRootResolution | null {
      const projectId = signals.discoveredProjectId ?? null;
      if (signals.env !== undefined) {
        return { projectRoot: signals.env, projectId, signalUsed: "env" };
      }
      if (signals.markerDir !== undefined) {
        return {
          projectRoot: signals.markerDir,
          projectId,
          signalUsed: signals.markerDir === signals.cwd ? "cwd" : "marker",
        };
      }
      if (signals.repoRoot !== undefined) {
        return { projectRoot: signals.repoRoot, projectId, signalUsed: "repo" };
      }
      return null;
    },
  };
}
