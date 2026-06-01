import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GLOBAL_STATE_DIR, storeRelativePath } from "@fenglimg/fabric-shared";
import { GenericIOError } from "@fenglimg/fabric-shared/errors";

import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import {
  abortSync,
  applySyncEvent,
  continueSync,
  deferredPushStores,
  isSyncSettled,
  planSync,
  type SyncEvent,
  type SyncSession,
  type SyncStoreStatus,
} from "./state-machine.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric sync` I/O orchestrator (S9/S17/S37).
//
// The state machine (state-machine.ts) is the pure reducer; this module is the
// I/O edge that drives it: it walks each remote-backed store, runs
// `git pull --rebase`, classifies the outcome, and persists a resume session at
// `~/.fabric/state/sync-session.json` so `--continue` / `--abort` survive across
// process boundaries. The git operations are injectable so the orchestration
// (session persistence, conflict pause/resume, deferred-push reporting, settle →
// bindings snapshot) is integration-tested deterministically. When the session
// settles, the bindings snapshot is regenerated (P3→P4 chain).
// ---------------------------------------------------------------------------

const NO_GLOBAL_CONFIG =
  "no global Fabric config — run `fabric install --global <url>` first";
const NO_SESSION = "no sync in progress — run `fabric sync` first";
const NO_CONFLICT = "no conflicted store to resume — sync is not paused";

export type GitRebaseOutcome = "clean" | "conflict" | "offline";

// I/O edge contracts (injected in tests; real git defaults in production).
export type GitRebasePull = (storeDir: string) => GitRebaseOutcome;
export type GitRebaseResolve = (storeDir: string) => void;

export interface RunSyncOptions {
  // Project whose bindings snapshot is regenerated once the session settles.
  projectRoot: string;
  globalRoot?: string;
  // ISO-8601 timestamp for the regenerated snapshot (injected for tests).
  now: string;
  pull?: GitRebasePull;
  rebaseContinue?: GitRebaseResolve;
  rebaseAbort?: GitRebaseResolve;
  writeScope?: string;
}

export interface RunSyncResult {
  session: SyncSession;
  settled: boolean;
  // Stores whose push was deferred while offline (retry on a later sync, S17).
  deferred: SyncStoreStatus[];
  // True when the session settled AND a snapshot was regenerated.
  snapshotWritten: boolean;
}

function syncSessionPath(globalRoot: string): string {
  return join(globalRoot, GLOBAL_STATE_DIR, "sync-session.json");
}

function loadSession(globalRoot: string): SyncSession | null {
  const path = syncSessionPath(globalRoot);
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw) as SyncSession;
  } catch (error) {
    // F58 (ISS-20260531-097): a truncated / corrupt sync-session.json must not
    // crash every later `fabric sync --continue/--abort` with a bare
    // SyntaxError that the user cannot act on. Quarantine the bytes to a
    // `.corrupted.{ts}` sidecar (mirrors agents.meta.json forensics) and throw
    // an actionable FabricError so the operator can recover.
    const corruptedPath = `${path}.corrupted.${Date.now()}`;
    try {
      writeFileSync(corruptedPath, raw, "utf8");
    } catch {
      // best-effort forensics — never mask the original parse failure
    }
    throw new GenericIOError(
      `sync-session.json is corrupt (forensic copy: ${corruptedPath}). Parse error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        actionHint: `Delete ${path} to start a fresh sync (any in-progress rebase must be resolved manually with git first).`,
        details: { path, corruptedPath },
      },
    );
  }
}

function saveSession(globalRoot: string, session: SyncSession): void {
  const path = syncSessionPath(globalRoot);
  mkdirSync(join(path, ".."), { recursive: true });
  // F58: write-tmp + rename so an interruption/power-loss can never leave a
  // half-written (corrupt) session file that breaks the next sync command.
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  renameSync(tmpPath, path);
}

function clearSession(globalRoot: string): void {
  rmSync(syncSessionPath(globalRoot), { force: true });
}

// Real `git pull --rebase`, classified into the three sync outcomes. A conflict
// exits non-zero with CONFLICT in its output; an unreachable remote is offline
// (S17 offline-first). Any other git failure is corruption — surface git's own
// diagnostic in an actionable FabricError (ISS-032), not execFileSync's bare
// "Command failed". Exported for direct error-surfacing tests.
export function defaultPull(storeDir: string): GitRebaseOutcome {
  try {
    execFileSync("git", ["pull", "--rebase"], {
      cwd: storeDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "clean";
  } catch (error) {
    const detail = `${gitErrText(error, "stdout")}${gitErrText(error, "stderr")}`;
    if (/CONFLICT|could not apply|needs merge|rebase --continue/i.test(detail)) {
      return "conflict";
    }
    if (
      /could not resolve host|could not read from remote|unable to access|connection|network is unreachable|timed out/i.test(
        detail,
      )
    ) {
      return "offline";
    }
    // ISS-032: any other failure (auth denied, detached HEAD, dirty tree, no
    // upstream) — re-surface the git diagnostic we just captured instead of
    // discarding it behind execFileSync's generic "Command failed" message.
    const gitMessage = detail.trim().length > 0 ? detail.trim() : "unknown git error";
    throw new GenericIOError(`git pull --rebase failed in ${storeDir}: ${gitMessage}`, {
      actionHint:
        "resolve the git issue above (e.g. authentication, a dirty working tree, or a detached HEAD), then re-run `fabric sync`",
      details: error,
    });
  }
}

function gitErrText(error: unknown, key: "stdout" | "stderr"): string {
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" || Buffer.isBuffer(value) ? String(value) : "";
}

// F57 (ISS-20260531-096): `git rebase --continue/--abort` can fail (unstaged
// conflicts still present, no rebase in progress, dirty tree). Without catching,
// execFileSync's bare "Command failed" throw propagates uncaught and crashes the
// CLI, leaving sync-session.json in a stale conflicted state. Mirror defaultPull
// (ISS-032): re-surface git's own diagnostic in an actionable FabricError.
function runRebaseStep(storeDir: string, step: "continue" | "abort"): void {
  try {
    execFileSync("git", ["rebase", `--${step}`], {
      cwd: storeDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = `${gitErrText(error, "stdout")}${gitErrText(error, "stderr")}`.trim();
    const gitMessage = detail.length > 0 ? detail : "unknown git error";
    throw new GenericIOError(`git rebase --${step} failed in ${storeDir}: ${gitMessage}`, {
      actionHint:
        step === "continue"
          ? "resolve the remaining conflicts (git status) and stage them, then re-run `fabric sync --continue`; or run `fabric sync --abort` to discard the rebase"
          : "inspect the store with `git status`; if no rebase is in progress the session may already be resolved — delete sync-session.json to reset",
      details: error,
    });
  }
}

function defaultRebaseContinue(storeDir: string): void {
  runRebaseStep(storeDir, "continue");
}

function defaultRebaseAbort(storeDir: string): void {
  runRebaseStep(storeDir, "abort");
}

const OUTCOME_EVENT: Record<GitRebaseOutcome, SyncEvent> = {
  clean: "rebase_clean",
  conflict: "rebase_conflict",
  offline: "network_unavailable",
};

// Walk the still-`pending` stores in order, pulling each. A conflict pauses the
// walk (the state machine permits only one conflicted store at a time); offline
// stores are recorded and the walk continues (deferred push, S17).
function walkPending(
  session: SyncSession,
  storeDirOf: (status: SyncStoreStatus) => string,
  pull: GitRebasePull,
): SyncSession {
  let next = session;
  for (const store of session.stores) {
    if (store.state !== "pending") {
      continue;
    }
    const outcome = pull(storeDirOf(store));
    next = applySyncEvent(next, store.alias, OUTCOME_EVENT[outcome]);
    if (outcome === "conflict") {
      break;
    }
  }
  return next;
}

function finalize(
  session: SyncSession,
  options: RunSyncOptions,
  globalRoot: string,
): RunSyncResult {
  const settled = isSyncSettled(session);
  let snapshotWritten = false;
  if (settled) {
    clearSession(globalRoot);
    const snapshot = regenerateBindingsSnapshot(options.projectRoot, {
      globalRoot,
      now: options.now,
      ...(options.writeScope === undefined ? {} : { writeScope: options.writeScope }),
    });
    snapshotWritten = snapshot !== null;
  } else {
    saveSession(globalRoot, session);
  }
  return { session, settled, deferred: deferredPushStores(session), snapshotWritten };
}

// `fabric sync`: plan + walk every remote-backed mounted store. Local-only
// stores are skipped (nothing to push/pull). Pauses + persists on first conflict.
export function runStartSync(options: RunSyncOptions): RunSyncResult {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    throw new Error(NO_GLOBAL_CONFIG);
  }
  const syncable = config.stores.filter((store) => store.remote !== undefined);
  const session = planSync(
    syncable.map((store) => ({ alias: store.alias, store_uuid: store.store_uuid })),
  );
  const storeDirOf = (status: SyncStoreStatus): string =>
    join(globalRoot, storeRelativePath(status.store_uuid));
  const walked = walkPending(session, storeDirOf, options.pull ?? defaultPull);
  return finalize(walked, options, globalRoot);
}

// `fabric sync --continue`: the user resolved the conflict; advance that store
// (git rebase --continue) and resume the walk over any remaining pending stores.
export function runContinueSync(options: RunSyncOptions): RunSyncResult {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const session = loadSession(globalRoot);
  if (session === null) {
    throw new Error(NO_SESSION);
  }
  const conflicted = session.stores.find((store) => store.state === "conflict");
  if (conflicted === undefined) {
    throw new Error(NO_CONFLICT);
  }
  const storeDirOf = (status: SyncStoreStatus): string =>
    join(globalRoot, storeRelativePath(status.store_uuid));
  (options.rebaseContinue ?? defaultRebaseContinue)(storeDirOf(conflicted));
  const resumed = walkPending(continueSync(session), storeDirOf, options.pull ?? defaultPull);
  return finalize(resumed, options, globalRoot);
}

// `fabric sync --abort`: abandon the conflicted store's rebase (git rebase
// --abort), leave it unsynced, and resume the walk over remaining pending stores.
export function runAbortSync(options: RunSyncOptions): RunSyncResult {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const session = loadSession(globalRoot);
  if (session === null) {
    throw new Error(NO_SESSION);
  }
  const conflicted = session.stores.find((store) => store.state === "conflict");
  if (conflicted === undefined) {
    throw new Error(NO_CONFLICT);
  }
  const storeDirOf = (status: SyncStoreStatus): string =>
    join(globalRoot, storeRelativePath(status.store_uuid));
  (options.rebaseAbort ?? defaultRebaseAbort)(storeDirOf(conflicted));
  const resumed = walkPending(abortSync(session), storeDirOf, options.pull ?? defaultPull);
  return finalize(resumed, options, globalRoot);
}
