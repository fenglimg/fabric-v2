import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  resolveWorkspaceBindingId,
  writeBindingsSnapshot,
  type ResolvedBindingsSnapshot,
} from "@fenglimg/fabric-shared";

import { resolveGlobalRoot } from "./global-config-io.js";
import { loadProjectConfig } from "./project-config-io.js";
import { buildResolveInput } from "./scope-explain.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Resolved-bindings snapshot regeneration (P3→P4 chain).
//
// `fabric store bind` and `fabric sync` regenerate the project's snapshot at
// `~/.fabric/state/bindings/<workspace_binding_id>_resolved.json`. It is produced through
// the SAME `buildResolveInput` → `writeBindingsSnapshot` (StoreResolver) path
// that `scope-explain` and the runtime use, so the persisted snapshot is
// consistent-by-construction with live resolution — the done_when acceptance
// criterion. P4 hooks read it without re-resolving.
// ---------------------------------------------------------------------------

// Non-personal scope whose write-target the snapshot records (matches the
// resolver's scope vocabulary; personal writes are resolved separately at R5#3).
const DEFAULT_WRITE_SCOPE = "team";

export interface RegenerateBindingsOptions {
  globalRoot?: string;
  // ISO-8601 timestamp; injected for deterministic tests.
  now: string;
  writeScope?: string;
}

// Regenerate the project's resolved-bindings snapshot. Returns the snapshot that
// was written, or null when there is no global config (caller guides to
// `install --global`) or the project has no binding id to key the snapshot on.
export function regenerateBindingsSnapshot(
  projectRoot: string,
  options: RegenerateBindingsOptions,
): ResolvedBindingsSnapshot | null {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const resolveInput = buildResolveInput(projectRoot, globalRoot);
  if (resolveInput === null) {
    return null;
  }
  const project = loadProjectConfig(projectRoot);
  if (project?.project_id === undefined) {
    return null;
  }
  const workspaceBindingId = resolveWorkspaceBindingId(project);
  if (workspaceBindingId === undefined) {
    return null;
  }
  return writeBindingsSnapshot({
    globalRoot,
    projectId: project.project_id,
    workspaceBindingId,
    resolveInput,
    writeScope: options.writeScope ?? DEFAULT_WRITE_SCOPE,
    now: options.now,
  });
}

/**
 * Every project_id this machine has ever written a bindings snapshot for.
 *
 * The third source of project identity, and on a real machine the FULLEST one:
 * a snapshot is written by `fabric store bind` and `fabric sync`, which run
 * throughout a project's life, whereas the registry is written by `fabric
 * install` and only started existing recently. Measured here: 8 snapshots, 1
 * registry row.
 *
 * It carries no path — the paths inside a snapshot are STORE checkouts under
 * `~/.fabric/stores`, not the project's own directory. So an id known only from
 * here is a project this machine can name but not locate, which is exactly the
 * state the console must report rather than hide. Locating it is
 * project-discovery's job.
 */
/**
 * The snapshot files belonging to `projectId`, as absolute paths.
 *
 * Separate from deleting them so the console can SHOW the list before asking
 * for confirmation and then delete exactly what it showed — one enumeration,
 * not a preview implementation and a delete implementation that agree today
 * (KT-PIT-0106).
 *
 * The match is on the `project_id` INSIDE each file, never on the filename:
 * the filename is the workspace-binding id, which is only incidentally equal to
 * the project id. `listBoundProjectIds` reads the field for the same reason, and
 * a deleter that keyed off the name would remove the wrong file the moment that
 * stops holding.
 */
export function findBindingsForProject(
  projectId: string,
  globalRootInput?: string,
): string[] {
  const globalRoot = globalRootInput ?? resolveGlobalRoot();
  const dir = join(globalRoot, "state", "bindings");
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const file of files) {
    if (!file.endsWith("_resolved.json")) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if ((parsed as { project_id?: unknown } | null)?.project_id === projectId) {
        matches.push(join(dir, file));
      }
    } catch {
      continue; // a corrupt snapshot names no project, so it belongs to none
    }
  }
  return matches;
}

export function listBoundProjectIds(globalRootInput?: string): string[] {
  const globalRoot = globalRootInput ?? resolveGlobalRoot();
  let files: string[];
  try {
    files = readdirSync(join(globalRoot, "state", "bindings"));
  } catch {
    return []; // no bindings yet, or an unreadable global root
  }

  const ids = new Set<string>();
  for (const file of files) {
    if (!file.endsWith("_resolved.json")) continue;
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(join(globalRoot, "state", "bindings", file), "utf8"),
      );
      // The id inside the file wins over the filename. They agree today, but
      // the filename is the WORKSPACE BINDING id, which is only incidentally
      // equal to the project id — reading the field means this keeps working if
      // that ever stops being true.
      const id = (parsed as { project_id?: unknown } | null)?.project_id;
      if (typeof id === "string" && id.length > 0) ids.add(id);
    } catch {
      continue; // a corrupt snapshot is not a reason to lose the other seven
    }
  }
  return [...ids];
}
