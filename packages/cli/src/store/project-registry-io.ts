import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { atomicWriteJson, withFileLock } from "@fenglimg/fabric-shared/node/atomic-write";

import { resolveGlobalRoot } from "./global-config-io.js";

// ---------------------------------------------------------------------------
// Machine-level project registry — `~/.fabric/state/projects.json`.
//
// WHY THIS EXISTS: `bindings/<project_id>_resolved.json` records which stores a
// project reads, but nothing on this machine records WHERE a project lives on
// disk. Without that, "list every repo that has Fabric installed and show which
// ones are behind" has no data source at all — it is a missing table, not a
// missing view.
//
// SNAPSHOT, NOT LEDGER: `fabric install` is idempotent and gets re-run on every
// upgrade, so each entry is simply overwritten. Deliberately NOT a "first seen"
// / once-ever stamp: KT-PIT-0076 records a once-ever timestamp placed inside an
// idempotent command being reset by every re-run, leaving a downstream gate that
// could never fire. Snapshot semantics make re-running harmless by construction.
//
// STATE, NOT KNOWLEDGE: lives under `~/.fabric` and never enters repo git
// (KT-DEC-0003 dual-root).
//
// NEVER-THROW: this is bookkeeping attached to install/uninstall. A failure to
// record must never take down the operation the user actually asked for, so
// every entry point returns a boolean and swallows its own errors.
// ---------------------------------------------------------------------------

const REGISTRY_SCHEMA_VERSION = 1;

/**
 * One registry entry as it appears on disk. The INSTALL PATH is the map key.
 *
 * project_id was the obvious first choice (stable across moves) and was
 * rejected on evidence: a `fabric install` that binds no store leaves
 * `.fabric/fabric-config.json` as `{}` — there is no project_id at all. Keying
 * on it would have silently excluded every store-less project from the console,
 * which is precisely the "installed but invisible" state this registry exists
 * to end.
 *
 * The path is always present, and is also the thing the console actually needs:
 * to upgrade a project you must know where to run `fabric install`. project_id
 * is kept as an optional field for joining against store bindings.
 */
type StoredProject = {
  project_id?: string;
  /**
   * Absent when the entry was backfilled by a scan rather than written by an
   * install.
   *
   * Optional rather than a `"unknown"` sentinel because every consumer already
   * had to handle "no version" — `versionByPath.get(path) ?? null` predates
   * this — and a sentinel string would instead be COMPARED against the running
   * version and reported as out of date. Five installs that predate the install
   * manifest have no version to read; saying so is honest, calling them stale
   * is a guess wearing a fact's clothes.
   */
  fabric_version?: string;
  registered_at: string;
};

type ProjectRegistryFile = {
  schema_version: number;
  /** Keyed by absolute install path. */
  projects: Record<string, StoredProject>;
};

export type RegisteredProject = {
  /** Absent when the project has no store binding yet. */
  projectId: string | undefined;
  path: string;
  /** null for a scan-backfilled entry — see {@link StoredProject.fabric_version}. */
  fabricVersion: string | null;
  registeredAt: string;
};

/** A registered project plus read-time derived state. */
export type RegisteredProjectView = RegisteredProject & {
  /** True when `path` no longer exists on disk. Derived per read — never stored,
   * because a stored copy is wrong the moment the user moves a directory. */
  stale: boolean;
};

export function projectRegistryPath(globalRoot: string = resolveGlobalRoot()): string {
  return join(globalRoot, "state", "projects.json");
}

/**
 * Resolve the global root INSIDE the caller's try block.
 *
 * Not a default parameter value: a default is evaluated in the caller's frame
 * before the function body runs, so a throwing `resolveGlobalRoot()` would
 * escape this module's own try/catch and fail the install it was only meant to
 * annotate. (It does throw today under the test runner when FABRIC_HOME is
 * unset — a deliberate guard against tests writing to the real ~/.fabric.)
 */
function rootOr(globalRoot: string | undefined): string {
  return globalRoot ?? resolveGlobalRoot();
}

function registryLockPath(globalRoot: string): string {
  return `${projectRegistryPath(globalRoot)}.lock`;
}

function emptyRegistry(): ProjectRegistryFile {
  return { schema_version: REGISTRY_SCHEMA_VERSION, projects: {} };
}

/**
 * Read the registry, tolerating every way it can be unusable (absent, corrupt,
 * wrong shape) by returning an empty registry. A hand-mangled file must not
 * brick `fabric install`; the next successful write rebuilds it.
 */
async function readRegistry(globalRoot: string): Promise<ProjectRegistryFile> {
  let raw: string;
  try {
    raw = await readFile(projectRegistryPath(globalRoot), "utf8");
  } catch {
    return emptyRegistry();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return emptyRegistry();
    const projects = (parsed as ProjectRegistryFile).projects;
    if (projects === null || typeof projects !== "object") return emptyRegistry();
    return { schema_version: REGISTRY_SCHEMA_VERSION, projects };
  } catch {
    return emptyRegistry();
  }
}

/**
 * Serialize a read-modify-write of the registry behind the shared cross-process
 * lock.
 *
 * The lock is NOT optional: two `fabric install` runs finishing at once would
 * otherwise clobber each other and silently drop a project from the console's
 * list. `withFileLock` is used rather than a hand-rolled one because it already
 * carries the fixes this pattern needs — notably treating win32 `EPERM`/`EBUSY`
 * as contention (POSIX signals that as `EEXIST`), which is the exact trap
 * recorded in KT-PIT-0085.
 *
 * `mutate` returns whether anything changed; an unchanged registry is not
 * rewritten, so reads leave no trace and no-op deregistrations do not touch the
 * file's mtime.
 */
async function updateRegistry(
  globalRootInput: string | undefined,
  mutate: (registry: ProjectRegistryFile) => boolean,
): Promise<boolean> {
  try {
    const globalRoot = rootOr(globalRootInput);
    const path = projectRegistryPath(globalRoot);
    await mkdir(dirname(path), { recursive: true });
    return await withFileLock(registryLockPath(globalRoot), async () => {
      const registry = await readRegistry(globalRoot);
      if (!mutate(registry)) return false;
      await atomicWriteJson(path, registry);
      return true;
    });
  } catch {
    // Includes lock-acquisition timeouts. Bookkeeping never breaks install.
    return false;
  }
}

/**
 * Record (or refresh) where a project is installed and at which version.
 *
 * `path` MUST be the root this install actually wrote `.fabric/` into — i.e.
 * `InstallContext.target`. Do not re-derive it here: `resolveProjectRoot` short
 * -circuits on `CLAUDE_PROJECT_DIR` (always set inside a Claude Code session),
 * so installing into another repo from such a session would register the
 * session's repo instead. One path rule, one source.
 *
 * @returns true when the registry was updated.
 */
export async function registerProject(
  input: {
    path: string;
    /** Absent for a project with no store binding — see {@link StoredProject}. */
    projectId?: string;
    /** Absent when there is none to read — see {@link StoredProject.fabric_version}. */
    fabricVersion?: string;
    /** Injectable for deterministic tests; defaults to now. */
    registeredAt?: string;
  },
  globalRoot?: string,
): Promise<boolean> {
  const registeredAt = input.registeredAt ?? new Date().toISOString();
  return updateRegistry(globalRoot, (registry) => {
    // When the project HAS an id, it is stable across moves — so an entry with
    // the same id at a different path is this same project's old location, and
    // is dropped rather than left behind as a permanent phantom. Without an id
    // that cleanup is impossible, and the old path simply shows up as `stale`
    // (honest, and the user is told to re-install at the new location).
    if (input.projectId !== undefined) {
      for (const [path, entry] of Object.entries(registry.projects)) {
        if (path !== input.path && entry.project_id === input.projectId) {
          delete registry.projects[path];
        }
      }
    }
    registry.projects[input.path] = {
      ...(input.projectId === undefined ? {} : { project_id: input.projectId }),
      ...(input.fabricVersion === undefined ? {} : { fabric_version: input.fabricVersion }),
      registered_at: registeredAt,
    };
    return true;
  });
}

/**
 * Drop a project's entry — the uninstall-side twin of {@link registerProject}.
 *
 * Matching is by path rather than project_id because `fabric uninstall` removes
 * `.fabric/fabric-config.json`, which is where project_id lives; an id-based
 * lookup would depend on read-before-delete ordering that a later refactor could
 * quietly break.
 *
 * Without this, an uninstalled project lingers forever as "installed but
 * outdated" and its upgrade button silently reinstalls Fabric (KT-PIT-0074:
 * a sweeper without its twin is a half-mechanism).
 *
 * @returns true when an entry was actually removed.
 */
export async function deregisterProjectByPath(
  path: string,
  globalRoot?: string,
): Promise<boolean> {
  return updateRegistry(globalRoot, (registry) => {
    if (!(path in registry.projects)) return false;
    delete registry.projects[path];
    return true;
  });
}

/**
 * List every registered project, with `stale` derived from disk at read time.
 *
 * Reading never writes — not even to create or normalize the file.
 */
export async function listRegisteredProjects(
  globalRoot?: string,
): Promise<RegisteredProjectView[]> {
  let registry: ProjectRegistryFile;
  try {
    registry = await readRegistry(rootOr(globalRoot));
  } catch {
    return [];
  }
  return Object.entries(registry.projects).map(([path, entry]) => ({
    projectId: entry.project_id,
    path,
    fabricVersion: entry.fabric_version ?? null,
    registeredAt: entry.registered_at,
    stale: !existsSync(path),
  }));
}
