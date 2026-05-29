import { writeBindingsSnapshot, type ResolvedBindingsSnapshot } from "@fenglimg/fabric-shared";

import { resolveGlobalRoot } from "./global-config-io.js";
import { loadProjectConfig } from "./project-config-io.js";
import { buildResolveInput } from "./scope-explain.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Resolved-bindings snapshot regeneration (P3→P4 chain).
//
// `fabric store bind` and `fabric sync` regenerate the project's snapshot at
// `~/.fabric/state/bindings/<project_id>_resolved.json`. It is produced through
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
// `install --global`) or the project has no `project_id` to key the snapshot on.
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
  return writeBindingsSnapshot({
    globalRoot,
    projectId: project.project_id,
    resolveInput,
    writeScope: options.writeScope ?? DEFAULT_WRITE_SCOPE,
    now: options.now,
  });
}
