import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import {
  GLOBAL_BINDINGS_DIR,
  GLOBAL_STATE_DIR,
} from "../schemas/store.js";
import {
  resolvedBindingsSnapshotSchema,
  type ResolvedBindingsSnapshot,
} from "../schemas/bindings-snapshot.js";
import type { StoreResolveInput } from "../resolver/contracts.js";
import { createStoreResolver } from "../resolver/store-resolver.js";

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
const SAFE_PROJECT_ID = /^[A-Za-z0-9._-]+$/;

function assertSafeProjectId(projectId: string): void {
  if (!SAFE_PROJECT_ID.test(projectId) || projectId.includes("..")) {
    throw new Error(
      `bindingsSnapshotPath: refusing unsafe project_id ${JSON.stringify(projectId)} ` +
        `(must match ${SAFE_PROJECT_ID} and contain no "..")`,
    );
  }
}

// Absolute path to a project's resolved-bindings snapshot under the global home.
// `globalRoot` is the `~/.fabric` directory (FABRIC_HOME/.fabric in tests).
export function bindingsSnapshotPath(globalRoot: string, projectId: string): string {
  assertSafeProjectId(projectId);
  const bindingsDir = resolve(join(globalRoot, GLOBAL_STATE_DIR, GLOBAL_BINDINGS_DIR));
  const path = resolve(join(bindingsDir, `${projectId}_resolved.json`));
  // Defence in depth: even a charset-clean id must resolve back inside the dir.
  if (path !== bindingsDir && !path.startsWith(bindingsDir + sep)) {
    throw new Error(`bindingsSnapshotPath: resolved path escapes bindings dir for ${JSON.stringify(projectId)}`);
  }
  return path;
}

export interface WriteBindingsSnapshotOptions {
  globalRoot: string;
  projectId: string;
  resolveInput: StoreResolveInput;
  // Scope used to resolve the write target (non-personal default e.g. "team").
  writeScope: string;
  // ISO-8601 timestamp; injected for deterministic tests.
  now: string;
}

// Resolve + persist the snapshot; returns the snapshot object that was written.
export function writeBindingsSnapshot(
  options: WriteBindingsSnapshotOptions,
): ResolvedBindingsSnapshot {
  const resolver = createStoreResolver();
  const read_set = resolver.resolveReadSet(options.resolveInput);
  const { target } = resolver.resolveWriteTarget(options.resolveInput, options.writeScope);

  const snapshot: ResolvedBindingsSnapshot = resolvedBindingsSnapshotSchema.parse({
    version: 1,
    project_id: options.projectId,
    generated_at: options.now,
    read_set,
    write_target: target,
  });

  const path = bindingsSnapshotPath(options.globalRoot, options.projectId);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
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
