import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  createProjectContextResolver,
  loadProjectConfig,
  ProjectContextAmbiguousError,
  resolveBindingIdForRoots,
  type ProjectContext,
} from "@fenglimg/fabric-shared";

function normalizeRoot(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const absolute = isAbsolute(trimmed) ? trimmed : resolve(trimmed);
    const real = existsSync(absolute) ? realpathSync(absolute) : absolute;
    if (real === "/" || /^[A-Za-z]:[\\/]?$/u.test(real)) return null;
    return real;
  } catch {
    return null;
  }
}

function climbToAnchor(start: string): string | null {
  let current = start;
  let firstFabric: string | null = null;
  for (let depth = 0; depth < 64; depth += 1) {
    if (existsSync(join(current, ".git"))) return current;
    if (firstFabric === null && existsSync(join(current, ".fabric"))) firstFabric = current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return firstFabric;
}

function resolveLegacyRoot(roots: readonly string[], startCwd = process.cwd()): string {
  for (const raw of [process.env.FABRIC_PROJECT_ROOT, process.env.CLAUDE_PROJECT_DIR]) {
    if (typeof raw !== "string") continue;
    const normalized = normalizeRoot(raw);
    if (normalized !== null) return normalized;
  }
  for (const root of roots) {
    const anchored = climbToAnchor(root);
    if (anchored !== null) return anchored;
  }
  const anchored = climbToAnchor(startCwd);
  return anchored ?? roots[0] ?? startCwd;
}

function fallbackContext(workspaceRoot: string): Readonly<ProjectContext> {
  const config = loadProjectConfig(workspaceRoot);
  const projectId = config?.project_id ?? `unresolved:${workspaceRoot}`;
  return Object.freeze({
    workspaceRoot,
    identityRoot: workspaceRoot,
    projectId,
    bindingId: resolveBindingIdForRoots(workspaceRoot) ?? projectId,
    source:
      process.env.FABRIC_PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR
        ? "explicit-pin"
        : "cwd",
  });
}

export class ProjectContextProvider {
  private roots: readonly string[] = Object.freeze([]);
  private refreshQueue: Promise<readonly string[]> = Promise.resolve(this.roots);

  snapshotForCall(startCwd = process.cwd()): Readonly<ProjectContext> {
    const explicitRoot = process.env.FABRIC_PROJECT_ROOT ?? process.env.CLAUDE_PROJECT_DIR;
    try {
      return createProjectContextResolver({
        ...(explicitRoot ? { explicitRoot } : {}),
        roots: this.roots,
        cwd: startCwd,
      });
    } catch (error) {
      if (error instanceof ProjectContextAmbiguousError) throw error;
      return fallbackContext(resolveLegacyRoot(this.roots, startCwd));
    }
  }

  setRoots(paths: readonly string[]): readonly string[] {
    const accepted = paths
      .map(normalizeRoot)
      .filter((path): path is string => path !== null && existsSync(path));
    this.roots = Object.freeze([...accepted]);
    return this.roots;
  }

  resetRoots(): void {
    this.roots = Object.freeze([]);
    this.refreshQueue = Promise.resolve(this.roots);
  }

  refreshRoots(load: () => Promise<readonly string[]>): Promise<readonly string[]> {
    const refresh = this.refreshQueue.then(async () => this.setRoots(await load()));
    this.refreshQueue = refresh.catch(() => this.roots);
    return refresh;
  }
}

export const defaultProjectContextProvider = new ProjectContextProvider();

export function resolveProjectRoot(startCwd?: string): string {
  return defaultProjectContextProvider.snapshotForCall(startCwd).workspaceRoot;
}

export function setMcpRootsHint(paths: string[]): string[] {
  return [...defaultProjectContextProvider.setRoots(paths)];
}

export function resetMcpRootsHint(): void {
  defaultProjectContextProvider.resetRoots();
}

export function isProjectRootConfigured(projectRoot: string): boolean {
  return existsSync(join(projectRoot, ".fabric", "fabric-config.json"));
}
