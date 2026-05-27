// v2.0.0-rc.37 Wave B (B4): server-side rotation tick.
//
// rotateEventLedgerIfNeeded already exists (event-ledger.ts) but is only
// triggered from doctor --fix. A long-lived MCP server that never sees
// doctor invocations would let events.jsonl accumulate past the retention
// horizon. Plan B counter-rollup (B1 lock) calls out a 6-hour idle
// rotation tick as part of the size-control story: even when no client is
// active, the server prunes events older than the configured retention
// window so the file stays bounded.
//
// Implementation: setInterval-based timer keyed by projectRoot (same
// pattern as services/metrics.ts). The tick is best-effort — rotation
// failures are logged to stderr but never crash the server, and the next
// tick retries from a fresh state.

import { rotateEventLedgerIfNeeded } from "./event-ledger.js";

const DEFAULT_TICK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const tickTimers = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Start the background rotation timer for a project root. Idempotent —
 * calling twice on the same root replaces the prior interval. Returns a
 * stop handle the caller can invoke at shutdown.
 *
 * The tick fires fire-and-forget (no await on the setInterval callback) so
 * the cadence stays accurate even when fs is slow. The first tick fires
 * AFTER one full interval — startup-time rotation should run separately
 * if desired (most callers don't, because rotation work blocks the
 * connect path).
 */
export function startRotationTick(
  projectRoot: string,
  options: { intervalMs?: number } = {},
): () => void {
  const interval = options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  stopRotationTick(projectRoot);
  const timer = setInterval(() => {
    void rotateEventLedgerIfNeeded(projectRoot).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[rotation-tick] failed for ${projectRoot}: ${message}\n`);
    });
  }, interval);
  if (typeof timer.unref === "function") timer.unref();
  tickTimers.set(projectRoot, timer);
  return () => {
    stopRotationTick(projectRoot);
  };
}

/**
 * Cancel the background rotation timer for a project root if one is
 * running. Does NOT trigger a final rotation — callers that want a final
 * rotation should call rotateEventLedgerIfNeeded(projectRoot) directly.
 */
export function stopRotationTick(projectRoot: string): void {
  const existing = tickTimers.get(projectRoot);
  if (existing !== undefined) {
    clearInterval(existing);
    tickTimers.delete(projectRoot);
  }
}

/**
 * Test-only helper: cancel all timers across all roots.
 */
export function resetRotationTickForTest(): void {
  for (const timer of tickTimers.values()) clearInterval(timer);
  tickTimers.clear();
}
