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
// must never break or delay the hook (failure invariant: silent).

const { appendFileSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");

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
    appendFileSync(path, `${JSON.stringify(row)}\n`);
  } catch {
    // Telemetry is best-effort — never crash or delay the hook.
  }
}

module.exports = { logInjection };
