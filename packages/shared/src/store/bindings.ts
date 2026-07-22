import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

import {
  GLOBAL_BINDINGS_DIR,
  GLOBAL_STATE_DIR,
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  storeRelativePathForMount,
} from "../schemas/store.js";
import {
  resolvedBindingsSnapshotSchema,
  type ResolvedBindingsSnapshot,
} from "../schemas/bindings-snapshot.js";
import type { StoreReadSet, StoreResolveInput } from "../resolver/contracts.js";
import { createStoreResolver } from "../resolver/store-resolver.js";
import { loadProjectConfig } from "./project-config-io.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Bindings snapshot generation + read (P3→P4 chain).
//
// `writeBindingsSnapshot` resolves the read-set + write-target via the SAME
// StoreResolver the runtime uses, then persists the result so P4 hooks can read
// it without re-resolving (consistency is the acceptance criterion). Lives in
// shared so both the CLI (generates) and hooks/server (read) share one shape.
// ---------------------------------------------------------------------------

// project_id is free-form user config (fabricConfigSchema.project_id), so it
// must never be interpolated into a filesystem path unsanitized — a value like
// "../../etc/cron.d/x" would otherwise escape the bindings dir and let
// writeBindingsSnapshot clobber an arbitrary file (path-traversal write).
const SAFE_BINDING_ID = /^[A-Za-z0-9._-]+$/;

function assertSafeBindingId(bindingId: string): void {
  if (!SAFE_BINDING_ID.test(bindingId) || bindingId.includes("..")) {
    throw new Error(
      `bindingsSnapshotPath: refusing unsafe workspace_binding_id ${JSON.stringify(bindingId)} ` +
        `(must match ${SAFE_BINDING_ID} and contain no "..")`,
    );
  }
}

// Absolute path to a project's resolved-bindings snapshot under the global home.
// `globalRoot` is the `~/.fabric` directory (FABRIC_HOME/.fabric in tests).
export function bindingsSnapshotPath(globalRoot: string, bindingId: string): string {
  assertSafeBindingId(bindingId);
  const bindingsDir = resolve(join(globalRoot, GLOBAL_STATE_DIR, GLOBAL_BINDINGS_DIR));
  const path = resolve(join(bindingsDir, `${bindingId}_resolved.json`));
  // Defence in depth: even a charset-clean id must resolve back inside the dir.
  if (path !== bindingsDir && !path.startsWith(bindingsDir + sep)) {
    throw new Error(`bindingsSnapshotPath: resolved path escapes bindings dir for ${JSON.stringify(bindingId)}`);
  }
  return path;
}

export function resolveWorkspaceBindingId(config: {
  project_id?: string;
  workspace_binding_id?: string;
}): string | undefined {
  return config.workspace_binding_id ?? config.project_id;
}

/** Resolve repo identity from identityRoot and an optional per-worktree binding override. */
export function resolveBindingIdForRoots(
  identityRoot: string,
  workspaceRoot: string = identityRoot,
): string | undefined {
  const identityConfig = loadProjectConfig(identityRoot);
  if (identityConfig === null) return undefined;
  if (workspaceRoot === identityRoot) return resolveWorkspaceBindingId(identityConfig);
  const workspaceConfig = loadProjectConfig(workspaceRoot);
  return (
    workspaceConfig?.workspace_binding_id ??
    identityConfig.workspace_binding_id ??
    identityConfig.project_id
  );
}

export interface WriteBindingsSnapshotOptions {
  globalRoot: string;
  projectId: string;
  workspaceBindingId?: string;
  resolveInput: StoreResolveInput;
  // Scope used to resolve the write target (non-personal default e.g. "team").
  writeScope: string;
  // ISO-8601 timestamp; injected for deterministic tests.
  now: string;
}

function countMarkdownFiles(dir: string): { count: number; oldestMtimeMs: number | null } {
  let count = 0;
  let oldestMtimeMs: number | null = null;
  if (!existsSync(dir)) {
    return { count, oldestMtimeMs };
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { count, oldestMtimeMs };
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = countMarkdownFiles(fullPath);
      count += nested.count;
      if (
        nested.oldestMtimeMs !== null &&
        (oldestMtimeMs === null || nested.oldestMtimeMs < oldestMtimeMs)
      ) {
        oldestMtimeMs = nested.oldestMtimeMs;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    let mtimeMs;
    try {
      mtimeMs = statSync(fullPath).mtimeMs;
    } catch {
      continue;
    }
    count += 1;
    if (oldestMtimeMs === null || mtimeMs < oldestMtimeMs) {
      oldestMtimeMs = mtimeMs;
    }
  }
  return { count, oldestMtimeMs };
}

function collectKnowledgeStats(globalRoot: string, resolveInput: StoreResolveInput, readSet: StoreReadSet) {
  let pendingCount = 0;
  let oldestPendingMtimeMs: number | null = null;
  let canonicalCount = 0;
  // Resolved store ROOT dirs the counts came from — persisted alongside the
  // counts so hooks can recount LIVE (the counts themselves go stale, the dirs
  // do not). One entry per read-set store, in read-set order.
  const storeDirs: string[] = [];

  for (const store of readSet.stores) {
    const mounted = resolveInput.mountedStores.find((entry) => entry.store_uuid === store.store_uuid) ?? {
      store_uuid: store.store_uuid,
    };
    const storeDir = join(globalRoot, storeRelativePathForMount(mounted));
    storeDirs.push(storeDir);
    for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
      const canonical = countMarkdownFiles(join(storeDir, STORE_LAYOUT.knowledgeDir, type));
      canonicalCount += canonical.count;
    }
    const pending = countMarkdownFiles(join(storeDir, STORE_LAYOUT.knowledgeDir, "pending"));
    pendingCount += pending.count;
    if (
      pending.oldestMtimeMs !== null &&
      (oldestPendingMtimeMs === null || pending.oldestMtimeMs < oldestPendingMtimeMs)
    ) {
      oldestPendingMtimeMs = pending.oldestMtimeMs;
    }
  }

  return {
    stats: {
      pending_count: pendingCount,
      canonical_count: canonicalCount,
      oldest_pending_mtime_ms: oldestPendingMtimeMs,
    },
    storeDirs,
  };
}

function atomicWriteJsonSync(path: string, value: unknown): void {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup only
    }
    throw error;
  }
}

// Resolve + persist the snapshot; returns the snapshot object that was written.
export function writeBindingsSnapshot(
  options: WriteBindingsSnapshotOptions,
): ResolvedBindingsSnapshot {
  const resolver = createStoreResolver();
  const read_set = resolver.resolveReadSet(options.resolveInput);
  const { target } = resolver.resolveWriteTarget(options.resolveInput, options.writeScope);

  const { stats, storeDirs } = collectKnowledgeStats(options.globalRoot, options.resolveInput, read_set);

  const snapshot: ResolvedBindingsSnapshot = resolvedBindingsSnapshotSchema.parse({
    version: 1,
    project_id: options.projectId,
    workspace_binding_id: options.workspaceBindingId ?? options.projectId,
    generated_at: options.now,
    read_set,
    write_target: target,
    knowledge_stats: stats,
    knowledge_store_dirs: storeDirs,
  });

  const path = bindingsSnapshotPath(options.globalRoot, snapshot.workspace_binding_id);
  mkdirSync(join(path, ".."), { recursive: true });
  atomicWriteJsonSync(path, snapshot);
  return snapshot;
}

// Read a project's snapshot, or null when absent/unparsable (hooks degrade
// harmlessly — they must never block on a missing snapshot, KT-DEC-0007).
export function readBindingsSnapshot(
  globalRoot: string,
  projectId: string,
): ResolvedBindingsSnapshot | null {
  const path = bindingsSnapshotPath(globalRoot, projectId);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = resolvedBindingsSnapshotSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
