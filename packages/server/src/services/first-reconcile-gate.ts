/**
 * v2.0.0-rc.23 TASK-009 (d): Non-blocking MCP startup gate.
 *
 * The MCP server's `startStdioServer` previously awaited a full
 * `reconcileKnowledge` pass before completing the JSON-RPC handshake. With
 * large knowledge trees that pass can take seconds — long enough for
 * `claude mcp list` to mark the server unreachable even though tools later
 * work fine. The mismatch produced a confusing "connection failed" diagnostic
 * on a server that was, in practice, healthy.
 *
 * This module decouples handshake from reconcile:
 *
 *   1. `startStdioServer` completes `server.connect(transport)` immediately —
 *      MCP clients see the server as available the moment stdio is wired up.
 *   2. Reconcile is fired in the background. The resulting `Promise<void>` and
 *      any terminal failure are stored on the module-level state via
 *      `setFirstReconcile()`.
 *   3. Each tool handler calls `awaitFirstReconcileGate(timeoutMs)` at entry.
 *      The gate races the reconcile promise against a 5s deadline:
 *        - `ready`: reconcile finished cleanly; handler proceeds with fresh
 *          meta and emits no extra warning.
 *        - `stale`: reconcile still pending after the deadline; handler
 *          proceeds with whatever meta is currently on disk and emits a
 *          fail-loud `meta_stale` warning so the caller knows results may be
 *          based on stale view.
 *        - `failed`: reconcile already rejected; handler proceeds with the
 *          existing on-disk meta and emits a fail-loud `reconcile_failed`
 *          warning pointing the operator at `fabric doctor --fix`.
 *
 * The "proceed regardless" semantics are deliberate. Blocking on reconcile at
 * handler entry would just shift the original latency problem from handshake
 * to first-call — same UX, same diagnostic mismatch. Fail-loud warnings are
 * the rc.23 contract: tools never silently serve stale state, but a slow or
 * broken reconcile never sinks a tool call either.
 *
 * Both helpers are exported individually so the four tool handlers can wire
 * the gate without any shared mutable closure. Tests reset state through the
 * exported `resetFirstReconcileGate()` helper.
 */

/**
 * Structured warning emitted by tool handlers when the gate returns non-ready.
 * Mirrors `structuredWarningSchema` in `@fenglimg/fabric-shared/schemas/api-contracts`
 * (code: string, file: string, action_hint: string) but is declared here so
 * tool handlers can use it without a cross-package import dance.
 */
/**
 * `code` is typed as `string` (rather than the literal union
 * `"meta_stale" | "reconcile_failed"`) so a `GateWarning[]` assigns
 * structurally to the broader `structuredWarningSchema` arrays the four tool
 * response objects already carry. The narrower union would force every
 * handler into an explicit cast at the merge boundary. The two codes the
 * gate actually emits are documented in `gateWarning` and exercised by the
 * unit tests; runtime correctness does not depend on the literal type.
 */
export interface GateWarning {
  code: string;
  file: string;
  action_hint: string;
}

/**
 * Convert a gate result to a `GateWarning` for the response. Returns `null`
 * when the gate is `ready` — handlers should append the warning only when
 * non-null.
 */
export function gateWarning(result: GateStatus): GateWarning | null {
  if (result.status === "ready") return null;
  if (result.status === "stale") {
    return {
      code: "meta_stale",
      file: "<response>",
      action_hint:
        "Initial reconcile still pending; results may use cached meta. Retry shortly or run `fabric doctor --fix`.",
    };
  }
  return {
    code: "reconcile_failed",
    file: "<response>",
    action_hint:
      "Reconcile failed at startup; run `fabric doctor --fix` and restart the MCP server.",
  };
}

/**
 * Result of a single gate await.
 *
 * `ready`: first reconcile resolved before the timeout — no warning needed.
 * `stale`: timed out waiting; surface `meta_stale` warning, then proceed.
 * `failed`: first reconcile rejected; surface `reconcile_failed` warning, then
 *   proceed. The original error is included so handlers can log if desired.
 */
export type GateStatus =
  | { status: "ready" }
  | { status: "stale" }
  | { status: "failed"; error: unknown };

interface GateState {
  /**
   * Promise tracking the in-flight first reconcile. `null` before
   * `setFirstReconcile` is called (e.g. in unit tests that never call
   * `startStdioServer`). When null, the gate fast-paths to `ready` —
   * reconcile has not been started, so there is nothing to wait for.
   */
  firstReconcilePromise: Promise<void> | null;
  /**
   * Cached terminal failure from the first reconcile. Set by
   * `setFirstReconcile` after the inner reconcile promise rejects. Once set,
   * every gate call returns `failed` until the next `setFirstReconcile`
   * supersedes it.
   */
  reconcileFailure: unknown;
  /**
   * Resolved-flag tracked separately from the promise. Avoids racing against
   * the same promise object multiple times (each Promise.race adds a
   * microtask hop). Once the first reconcile settles, subsequent gate calls
   * short-circuit to `ready` or `failed` without scheduling a timer.
   */
  settled: boolean;
}

const state: GateState = {
  firstReconcilePromise: null,
  reconcileFailure: null,
  settled: false,
};

/**
 * Register the background first-reconcile promise. Called exactly once by
 * `startStdioServer` after kicking the reconcile off.
 *
 * Resolution and rejection of the inner promise are observed here and
 * recorded on the module state. The returned promise the gate awaits is
 * derived from `reconcilePromise` but converted to never-reject — the gate
 * inspects `state.reconcileFailure` to detect failure, so propagating a
 * rejection would force every gate caller into a try/catch.
 */
export function setFirstReconcile(reconcilePromise: Promise<unknown>): void {
  state.firstReconcilePromise = reconcilePromise.then(
    () => {
      state.settled = true;
    },
    (error: unknown) => {
      state.reconcileFailure = error;
      state.settled = true;
    },
  );
}

/**
 * Reset state. Test-only — never called from production code. Vitest's
 * `afterEach` invokes this so independent test cases do not leak gate
 * state into each other.
 */
export function resetFirstReconcileGate(): void {
  state.firstReconcilePromise = null;
  state.reconcileFailure = null;
  state.settled = false;
}

/**
 * Race the first-reconcile promise against `timeoutMs`. Resolves to a
 * `GateStatus` discriminating ready / stale / failed.
 *
 * `timeoutMs` defaults to 5000 (the rc.23 contract). Tests can shrink it to
 * keep suite duration low.
 *
 * If `setFirstReconcile` was never called (e.g. tools running in isolation
 * without a parent `startStdioServer`), the gate returns `ready`
 * immediately. Tools should still function in unit tests that bypass server
 * startup — gating would otherwise become a hard dependency on the global
 * server lifecycle.
 */
export async function awaitFirstReconcileGate(timeoutMs = 5000): Promise<GateStatus> {
  if (state.reconcileFailure !== null) {
    return { status: "failed", error: state.reconcileFailure };
  }
  if (state.firstReconcilePromise === null || state.settled) {
    // Either reconcile was never registered (test-only path) or it has
    // already resolved cleanly — no need to spin up a timer.
    return { status: "ready" };
  }

  // Race the wrapped reconcile against a timeout. We intentionally do NOT
  // unref the timeout: Node's event loop already exits as soon as the
  // promise settles, and `unref()` on a regular setTimeout handle is a
  // platform shim that adds noise to tests.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<"timeout">((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout("timeout"), timeoutMs);
  });

  try {
    const winner = await Promise.race([
      state.firstReconcilePromise.then(() => "reconcile" as const),
      timeoutPromise,
    ]);

    if (winner === "timeout") {
      return { status: "stale" };
    }

    // Reconcile won the race — check whether it failed by inspecting the
    // recorded failure (the wrapper promise never rejects).
    if (state.reconcileFailure !== null) {
      return { status: "failed", error: state.reconcileFailure };
    }
    return { status: "ready" };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
