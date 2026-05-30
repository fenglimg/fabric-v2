// v2.2 HK3-telemetry (W3-T1): injection-side telemetry. `.fabric/metrics.jsonl`
// (server) records the CONSUMPTION side — which knowledge the agent actually
// fetched/consumed. But nothing recorded the INJECTION side — which knowledge a
// hook OFFERED the agent at SessionStart / PreToolUse. Without that denominator
// the "true hit rate" (consumed ÷ injected) cannot be computed: a high consume
// count tells you nothing if the hook injected ten times as many entries.
//
// This lib appends one row per injection to `.fabric/injections.jsonl`:
//   { ts, surface: "broad"|"narrow", count, stable_ids: [...], revision_hash }
//
// Best-effort + synchronous: hooks are short-lived processes, so a sync append
// is simpler than threading async, and ANY failure is swallowed — telemetry
// must never break or delay the hook (failure invariant: silent). Concurrent
// writers from multiple windows are serialized with an advisory lock (see
// appendLockedLine below) so a contended write can't corrupt a line.

const { appendFileSync, mkdirSync, openSync, closeSync, statSync, rmSync } = require("node:fs");
const { join, dirname } = require("node:path");

// Multi-window concurrency guard (ADJ-W3-INJECTION-CONCURRENCY): the same repo
// is frequently edited from several client sessions at once, so multiple hook
// processes can append to injections.jsonl simultaneously. A bare appendFileSync
// can interleave a partial write under contention and corrupt a line. We guard
// each append with an advisory lock file created atomically via O_EXCL ("wx"):
//   - acquired  → write the row, then release the lock
//   - contended → DROP this row. Telemetry is best-effort; a missing row only
//                 shrinks the denominator slightly, and dropping is what keeps
//                 the ledger from ever being corrupted by an interleave.
//   - stale     → a holder that crashed leaves the lock behind; reclaim it once
//                 past STALE_LOCK_MS so contention can't wedge forever.
const STALE_LOCK_MS = 5000;

function appendLockedLine(path, line) {
  const lockPath = `${path}.lock`;
  let fd;
  try {
    fd = openSync(lockPath, "wx"); // atomic create-exclusive = acquire
  } catch (err) {
    if (!err || err.code !== "EEXIST") return; // unexpected → drop (best-effort)
    try {
      if (Date.now() - statSync(lockPath).mtimeMs <= STALE_LOCK_MS) return; // fresh holder → drop
      rmSync(lockPath, { force: true }); // stale holder crashed → reclaim
      fd = openSync(lockPath, "wx");
    } catch {
      return; // racing another reclaimer → drop
    }
  }
  try {
    closeSync(fd);
    appendFileSync(path, line);
  } finally {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      /* lock already released */
    }
  }
}

/**
 * Append one injection record to `<projectRoot>/.fabric/injections.jsonl`.
 *
 * @param {string} projectRoot
 * @param {{ surface: "broad"|"narrow", stableIds?: string[], count?: number, revisionHash?: string|null, ts?: number }} record
 */
function logInjection(projectRoot, record) {
  try {
    if (!projectRoot || !record || typeof record.surface !== "string") {
      return;
    }
    const stableIds = Array.isArray(record.stableIds) ? record.stableIds.filter((id) => typeof id === "string") : [];
    const count = typeof record.count === "number" ? record.count : stableIds.length;
    if (count <= 0) {
      return; // nothing injected → no row (keeps the denominator honest)
    }
    const row = {
      ts: typeof record.ts === "number" ? record.ts : Date.now(),
      surface: record.surface,
      count,
      stable_ids: stableIds,
      revision_hash: typeof record.revisionHash === "string" ? record.revisionHash : null,
    };
    const path = join(projectRoot, ".fabric", "injections.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendLockedLine(path, `${JSON.stringify(row)}\n`);
  } catch {
    // Telemetry is best-effort — never crash or delay the hook.
  }
}

module.exports = { logInjection };
