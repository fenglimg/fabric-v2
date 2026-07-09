// G3 (ralph-v2-20260709 / GRL-STOPHOOK-AIONLY-20260709):
// CJS twin of packages/shared/src/high-value-predicate.ts.
//
// Hook runtime has NO node_modules access, so the shared TS module cannot be
// imported. This file is a hand-authored CJS mirror; behavioural parity is
// asserted by packages/server/src/services/high-value-sst.test.ts (the round-
// trip SST oracle) which runs BOTH implementations against the same fixture
// and asserts identical output. Any drift MUST be reflected in BOTH files —
// otherwise the oracle test fails and blocks the commit.
//
// Twin precedent: packages/cli/templates/hooks/lib/cite-line-parser.cjs (same
// pattern — shared TS canon + hand-authored .cjs mirror + parity test).
//
// PROBLEM this SST fixes: crack-2 hook backlog scan reported 26 sessions
// "carrying high-value work" while fab_archive_scan MCP tool (semantically
// equivalent) accepted only 1. Root cause = two independent predicate
// implementations with drifting scoping / watermark rules. Both consumers now
// call the SAME function (this .cjs mirror inside the hook, the shared TS
// canon inside the server) — the round-trip test locks parity.
//
// Vocabulary (mirrored 1:1 with the TS source):
//   HIGH_VALUE_ARCHIVE_EVENT_TYPES: knowledge_context_planned,
//     edit_paths_recorded, edit_intent_checked
//   NORMATIVE_KEYWORDS: 以后, always, never, from now on, 下次, 记一下,
//     永远不要
//   Scope: session-scoped strictly (undefined sessionId → false);
//     watermark null → treated as 0 (never-archived session, all past events
//     count) — matches KT-PIT-0021 fix.

"use strict";

const HIGH_VALUE_ARCHIVE_EVENT_TYPES = new Set([
  "knowledge_context_planned",
  "edit_paths_recorded",
  "edit_intent_checked",
]);

const NORMATIVE_KEYWORDS = [
  "以后",
  "always",
  "never",
  "from now on",
  "下次",
  "记一下",
  "永远不要",
];

/**
 * Returns true iff `sessionId` carries a high-value archive signal past
 * `watermarkTs`. Byte-parity with packages/shared/src/high-value-predicate.ts.
 *
 * @param {unknown} events Ledger events (any-shape objects with ts/event_type/session_id).
 * @param {string|undefined} sessionId REQUIRED session scope. undefined/empty → returns false.
 * @param {number|null|undefined} watermarkTs Number (strict >) or null (treated as 0).
 * @returns {boolean}
 */
function isHighValueArchiveCandidate(events, sessionId, watermarkTs) {
  if (!Array.isArray(events)) return false;
  if (typeof sessionId !== "string" || sessionId.length === 0) return false;
  const wm = typeof watermarkTs === "number" ? watermarkTs : 0;
  let latestTurn = null;
  for (const e of events) {
    if (!e || typeof e.ts !== "number" || e.ts <= wm) continue;
    if (e.session_id !== sessionId) continue;
    if (typeof e.event_type === "string" && HIGH_VALUE_ARCHIVE_EVENT_TYPES.has(e.event_type)) {
      return true;
    }
    if (e.event_type === "assistant_turn_observed") {
      if (latestTurn === null || (typeof latestTurn.ts === "number" && e.ts > latestTurn.ts)) {
        latestTurn = e;
      }
    }
  }
  if (latestTurn !== null) {
    const haystack = JSON.stringify(latestTurn).toLowerCase();
    for (const kw of NORMATIVE_KEYWORDS) {
      if (haystack.includes(kw.toLowerCase())) return true;
    }
  }
  return false;
}

module.exports = {
  isHighValueArchiveCandidate,
  HIGH_VALUE_ARCHIVE_EVENT_TYPES,
  NORMATIVE_KEYWORDS,
};
