import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GLOBAL_STATE_DIR, storeRelativePathForMount } from "@fenglimg/fabric-shared";
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

// v2.1 global-refactor (W2-T3, F-SYNC-NOPUSH): the push half of sync. A store
// only becomes truly "synced" once its local commits reach the remote. Push
// outcomes:
//   clean   → the remote advanced (local commits are now shared).
//   offline → the remote was unreachable; the local commits stay committed and
//             the push is deferred (S17 offline-first) — same "offline" state as
//             an offline pull, so the existing deferred-push reporting applies.
// Any other push failure (non-fast-forward after a clean rebase should not
// happen, auth denied, etc.) is surfaced as an actionable FabricError.
export type GitPushOutcome = "clean" | "offline";

// I/O edge contracts (injected in tests; real git defaults in production).
export type GitRebasePull = (storeDir: string) => GitRebaseOutcome;
export type GitPush = (storeDir: string) => GitPushOutcome;
export type GitRebaseResolve = (storeDir: string) => void;
// v2.1 global-refactor (W2-T3 review fix): commit the store's working-tree
// knowledge changes (the .md files extract/approve wrote into the store repo)
// BEFORE pull/push. Without this the store stays dirty: `git pull --rebase`
// aborts on the dirty tree (F-SYNC-DIRTY) and `git push` has no commit to send,
// so cross-machine team sharing never actually propagated — the whole point.
export type GitCommitDirty = (storeDir: string) => void;

export interface RunSyncOptions {
  // Project whose bindings snapshot is regenerated once the session settles.
  projectRoot: string;
  globalRoot?: string;
  // ISO-8601 timestamp for the regenerated snapshot (injected for tests).
  now: string;
  pull?: GitRebasePull;
  push?: GitPush;
  commit?: GitCommitDirty;
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

// v2.1 global-refactor (W2-T3, F-SYNC-NOPUSH): real `git push`, classified into
// the two push outcomes. Mirrors defaultPull's offline classification (S17
// offline-first). An unreachable remote is `offline` → the push is deferred and
// retried on a later sync. Any other failure (auth denied, non-fast-forward,
// no upstream) is re-surfaced as an actionable FabricError rather than
// execFileSync's bare "Command failed".
export function defaultPush(storeDir: string): GitPushOutcome {
  try {
    execFileSync("git", ["push"], {
      cwd: storeDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "clean";
  } catch (error) {
    const detail = `${gitErrText(error, "stdout")}${gitErrText(error, "stderr")}`;
    if (
      /could not resolve host|could not read from remote|unable to access|connection|network is unreachable|timed out/i.test(
        detail,
      )
    ) {
      return "offline";
    }
    const gitMessage = detail.trim().length > 0 ? detail.trim() : "unknown git error";
    throw new GenericIOError(`git push failed in ${storeDir}: ${gitMessage}`, {
      actionHint:
        "resolve the git issue above (e.g. authentication, no upstream branch, or a rejected non-fast-forward push), then re-run `fabric sync`",
      details: error,
    });
  }
}

// v2.1 global-refactor (W2-T3 review fix, NEW-APPROVE-PROMOTE seam): commit the
// store repo's working-tree knowledge changes before pull/push. extract-knowledge
// and review approve write/move .md files INTO the store repo but deliberately do
// NOT commit (they must not stage in a repo they don't own — that's sync's job).
// The store `.gitignore` already excludes state/ + agents.meta.json + .cache/, so
// `git add -A` stages only knowledge files. Best-effort: a non-repo dir (test
// fixture / not-yet-initialized store) or a missing git identity leaves the tree
// untouched and the next sync retries — a commit hiccup must never crash sync.
export function defaultCommitDirty(storeDir: string): void {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: storeDir,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    return; // not a git repo (test fixture / unmounted store) — nothing to commit.
  }
  try {
    execFileSync("git", ["add", "-A"], { cwd: storeDir, stdio: ["ignore", "ignore", "pipe"] });
    try {
      // Exits 0 when the index matches HEAD (nothing staged) → no commit needed.
      execFileSync("git", ["diff", "--cached", "--quiet"], {
        cwd: storeDir,
        stdio: ["ignore", "ignore", "ignore"],
      });
      return;
    } catch {
      // Non-zero exit → staged changes exist → commit them.
      execFileSync("git", ["commit", "-m", "fabric: sync local knowledge changes"], {
        cwd: storeDir,
        stdio: ["ignore", "ignore", "pipe"],
      });
    }
  } catch {
    // Best-effort — e.g. no configured git identity. Leave the changes
    // uncommitted; the next `fabric sync` retries once the env is fixed.
  }
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

// Walk the still-`pending` stores in order, pulling then pushing each. A
// conflict pauses the walk (the state machine permits only one conflicted store
// at a time); offline stores are recorded and the walk continues (deferred
// push, S17).
//
// v2.1 global-refactor (W2-T3, F-SYNC-NOPUSH): after a CLEAN rebase, a writable
// store's local commits are pushed. The push outcome refines the per-store
// event: a clean push keeps the store `synced`; an offline push marks it
// `offline` so the existing deferred-push reporting retries it later — without
// push, `fabric sync` reported "synced" while local commits never left the
// machine. Read-only stores (no write intent) and the rare non-pushable store
// skip push entirely (pull-only mirror).
function walkPending(
  session: SyncSession,
  storeDirOf: (status: SyncStoreStatus) => string,
  pull: GitRebasePull,
  push: GitPush,
  commit: GitCommitDirty,
  pushableAliases: ReadonlySet<string>,
): SyncSession {
  let next = session;
  for (const store of session.stores) {
    if (store.state !== "pending") {
      continue;
    }
    const dir = storeDirOf(store);
    // Commit any extract/approve knowledge writes sitting in the store's working
    // tree BEFORE rebasing — otherwise pull --rebase aborts on the dirty tree and
    // push would have no commit to send.
    commit(dir);
    const pullOutcome = pull(dir);
    if (pullOutcome !== "clean") {
      next = applySyncEvent(next, store.alias, OUTCOME_EVENT[pullOutcome]);
      if (pullOutcome === "conflict") {
        break;
      }
      continue;
    }
    // Clean rebase. Push the store's local commits when it accepts writes.
    if (!pushableAliases.has(store.alias)) {
      next = applySyncEvent(next, store.alias, "rebase_clean");
      continue;
    }
    const pushOutcome = push(dir);
    next = applySyncEvent(
      next,
      store.alias,
      pushOutcome === "clean" ? "rebase_clean" : "network_unavailable",
    );
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
  const storeDirOf = makeStoreDirResolver(globalRoot, config.stores);
  const pushableAliases = pushableAliasesOf(config);
  const walked = walkPending(
    session,
    storeDirOf,
    options.pull ?? defaultPull,
    options.push ?? defaultPush,
    options.commit ?? defaultCommitDirty,
    pushableAliases,
  );
  return finalize(walked, options, globalRoot);
}

// v2.1 global-refactor (W2-T3): a store is pushable iff it has a remote AND
// accepts writes (`writable` defaults true when unset, matching
// buildStoreResolveInput). A read-only mounted store is pull-only — pushing
// would be meaningless (the local tree only ever mirrors upstream).
function pushableAliasesOf(config: {
  stores: Array<{ alias: string; remote?: string; writable?: boolean }>;
}): ReadonlySet<string> {
  return new Set(
    config.stores
      .filter((store) => store.remote !== undefined && (store.writable ?? true))
      .map((store) => store.alias),
  );
}

function makeStoreDirResolver(
  globalRoot: string,
  stores: Array<{ store_uuid: string; mount_name?: string }>,
): (status: SyncStoreStatus) => string {
  return (status) =>
    join(
      globalRoot,
      storeRelativePathForMount(
        stores.find((store) => store.store_uuid === status.store_uuid) ?? {
          store_uuid: status.store_uuid,
        },
      ),
    );
}

// `fabric sync --continue`: the user resolved the conflict; advance that store
// (git rebase --continue) and resume the walk over any remaining pending stores.
export function runContinueSync(options: RunSyncOptions): RunSyncResult {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const session = loadSession(globalRoot);
  if (session === null) {
    throw new GenericIOError(NO_SESSION, {
      actionHint: "Run `fabric sync` to start a sync before `--continue`/`--abort`.",
    });
  }
  const conflicted = session.stores.find((store) => store.state === "conflict");
  if (conflicted === undefined) {
    throw new GenericIOError(NO_CONFLICT, {
      actionHint: "The sync is not paused on a conflict; there is nothing to resume.",
    });
  }
  const resumeConfig = loadGlobalConfig(globalRoot) ?? { stores: [] };
  const storeDirOf = makeStoreDirResolver(globalRoot, resumeConfig.stores);
  (options.rebaseContinue ?? defaultRebaseContinue)(storeDirOf(conflicted));
  // The conflicted store, now rebased clean, must also be pushed — and so must
  // any remaining pending stores. Recompute pushable aliases from the config
  // (the resumed session carries only state, not write intent). A missing/null
  // config (store unmounted between sessions) degrades to pull-only — never crash.
  const pushableAliases = pushableAliasesOf(resumeConfig);
  const push = options.push ?? defaultPush;
  // Push the just-resolved store (the state machine's walkPending only processes
  // `pending` stores; the conflicted store moves straight to synced/offline via
  // the explicit continue transition here). Offline push → defer (S17).
  let advanced: SyncSession;
  if (pushableAliases.has(conflicted.alias)) {
    const pushOutcome = push(storeDirOf(conflicted));
    advanced = applySyncEvent(
      session,
      conflicted.alias,
      pushOutcome === "clean" ? "user_continue" : "network_unavailable",
    );
  } else {
    advanced = continueSync(session);
  }
  const resumed = walkPending(
    advanced,
    storeDirOf,
    options.pull ?? defaultPull,
    push,
    options.commit ?? defaultCommitDirty,
    pushableAliases,
  );
  return finalize(resumed, options, globalRoot);
}

// `fabric sync --abort`: abandon the conflicted store's rebase (git rebase
// --abort), leave it unsynced, and resume the walk over remaining pending stores.
export function runAbortSync(options: RunSyncOptions): RunSyncResult {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const session = loadSession(globalRoot);
  if (session === null) {
    throw new GenericIOError(NO_SESSION, {
      actionHint: "Run `fabric sync` to start a sync before `--continue`/`--abort`.",
    });
  }
  const conflicted = session.stores.find((store) => store.state === "conflict");
  if (conflicted === undefined) {
    throw new GenericIOError(NO_CONFLICT, {
      actionHint: "The sync is not paused on a conflict; there is nothing to resume.",
    });
  }
  const resumeConfig = loadGlobalConfig(globalRoot) ?? { stores: [] };
  const storeDirOf = makeStoreDirResolver(globalRoot, resumeConfig.stores);
  (options.rebaseAbort ?? defaultRebaseAbort)(storeDirOf(conflicted));
  // The aborted store is abandoned (no push); remaining pending stores still
  // pull+push. Recompute pushable aliases from config (degrade to pull-only on
  // a missing config).
  const pushableAliases = pushableAliasesOf(resumeConfig);
  const resumed = walkPending(
    abortSync(session),
    storeDirOf,
    options.pull ?? defaultPull,
    options.push ?? defaultPush,
    options.commit ?? defaultCommitDirty,
    pushableAliases,
  );
  return finalize(resumed, options, globalRoot);
}
