// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric sync` state machine (S9/S17/S37).
//
// Multi-store sync walks each store and rebases/pushes. Outcomes per store:
//   clean    → synced
//   conflict → pause; the user resolves, then `fabric sync --continue`
//              (git rebase --continue) or `fabric sync --abort` (rebase --abort)
//   offline  → commit locally, defer the push (S17 offline-first)
//
// This module is the PURE reducer + multi-store session over those outcomes —
// the git operations are the I/O edge the `sync` command wires in. Invalid
// transitions throw loudly so a corrupt resume can't silently mis-step.
// ---------------------------------------------------------------------------

export type SyncStoreState = "pending" | "synced" | "conflict" | "offline" | "aborted";

export type SyncEvent =
  | "rebase_clean"
  | "rebase_conflict"
  | "network_unavailable"
  | "user_continue" // git rebase --continue after the user resolved conflicts
  | "user_abort" // git rebase --abort
  | "retry"; // re-attempt a previously offline store

export function syncTransition(state: SyncStoreState, event: SyncEvent): SyncStoreState {
  switch (state) {
    case "pending":
      if (event === "rebase_clean") return "synced";
      if (event === "rebase_conflict") return "conflict";
      if (event === "network_unavailable") return "offline";
      break;
    case "conflict":
      if (event === "user_continue") return "synced";
      if (event === "user_abort") return "aborted";
      break;
    case "offline":
      // Back online: retrying either pushes cleanly or surfaces a fresh conflict.
      if (event === "retry" || event === "rebase_clean") return "synced";
      if (event === "rebase_conflict") return "conflict";
      if (event === "network_unavailable") return "offline";
      break;
    case "synced":
    case "aborted":
      break;
  }
  throw new Error(`invalid sync transition: '${state}' --${event}-->`);
}

export interface SyncStoreStatus {
  alias: string;
  store_uuid: string;
  state: SyncStoreState;
}

export interface SyncSession {
  stores: SyncStoreStatus[];
}

export function planSync(
  stores: Array<{ alias: string; store_uuid: string }>,
): SyncSession {
  return { stores: stores.map((s) => ({ ...s, state: "pending" })) };
}

// Apply an event to one store (by alias), returning a NEW session (immutable).
export function applySyncEvent(
  session: SyncSession,
  alias: string,
  event: SyncEvent,
): SyncSession {
  return {
    stores: session.stores.map((s) =>
      s.alias === alias ? { ...s, state: syncTransition(s.state, event) } : s,
    ),
  };
}

// `--continue`: advance the single conflicted store past its (now-resolved)
// conflict. Throws if no store is paused on a conflict.
export function continueSync(session: SyncSession): SyncSession {
  const conflicted = session.stores.find((s) => s.state === "conflict");
  if (conflicted === undefined) {
    throw new Error("`sync --continue` with no conflicted store to resume");
  }
  return applySyncEvent(session, conflicted.alias, "user_continue");
}

// `--abort`: abandon the conflicted store's rebase, leaving it unsynced.
export function abortSync(session: SyncSession): SyncSession {
  const conflicted = session.stores.find((s) => s.state === "conflict");
  if (conflicted === undefined) {
    throw new Error("`sync --abort` with no conflicted store to abort");
  }
  return applySyncEvent(session, conflicted.alias, "user_abort");
}

// The session is settled when no store is still pending or awaiting conflict
// resolution (offline stores are "settled" — their push is deferred, S17).
export function isSyncSettled(session: SyncSession): boolean {
  return session.stores.every((s) => s.state !== "pending" && s.state !== "conflict");
}

// Stores whose push was deferred while offline (the CLI retries these later).
export function deferredPushStores(session: SyncSession): SyncStoreStatus[] {
  return session.stores.filter((s) => s.state === "offline");
}
