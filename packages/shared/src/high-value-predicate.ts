/**
 * G3 (ralph-v2-20260709 / GRL-STOPHOOK-AIONLY-20260709):
 * Canonical predicate for archive high-value signal detection.
 *
 * ROLE:
 *   Single source of truth (SST) for the "does this session carry unarchived
 *   high-value archive-worthy activity past the watermark?" question. Two
 *   consumers used to have their own copies of this logic:
 *     - packages/cli/templates/hooks/fabric-hint.cjs (Stop hook backlog scan)
 *     - packages/server/src/services/archive-scan.ts (fab_archive_scan MCP tool)
 *
 *   Drift between the two produced the crack-2 26→1 virtual-alarm bug: hook
 *   backlog scan reported 26 dead sessions "carrying high-value work" while
 *   fab_archive_scan (running semantically identical filter but on different
 *   scoping rules) accepted only 1. This module makes both call the same
 *   function so the counts always agree.
 *
 * DEPENDENCIES:
 *   Zero — pure function of the passed events array. Both the TS canonical here
 *   and the hand-authored .cjs twin at packages/cli/templates/hooks/lib/
 *   high-value-predicate.cjs MUST stay behavior-identical. Parity is asserted
 *   by packages/server/src/services/high-value-sst.test.ts (round-trip oracle).
 *
 * SEMANTICS:
 *   - Session-scoped: only events matching sessionId contribute (SST fix for
 *     the crack-2 virtual alarm — hook used to allow undefined sessionId for
 *     workspace-wide scan; that path is removed here for consistency with the
 *     server's already-scoped predicate).
 *   - Watermark strict >: only events past watermarkTs contribute.
 *   - watermarkTs = null → treated as 0 (never-archived session, all past
 *     events count). Fixes KT-PIT-0021 (backlog probe misuse of anchor as
 *     watermark for never-archived sessions).
 *   - Signal accepted iff EITHER:
 *       (1) any event of a HIGH_VALUE_EVENT_TYPES kind for this session past wm
 *       (2) OR the latest assistant_turn_observed for this session past wm
 *           carries a NORMATIVE_KEYWORDS keyword in its stringified payload
 *
 * INVARIANT:
 *   The literal event-type set and normative keyword list are duplicated in the
 *   .cjs twin. Any change here MUST be reflected in the twin — the round-trip
 *   test at packages/server/src/services/high-value-sst.test.ts will fail
 *   otherwise (blocks the commit).
 */

// Event types that unambiguously indicate archive-worthy activity. Mirrors the
// prior local set in packages/server/src/services/archive-scan.ts (HIGH_VALUE_
// EVENT_TYPES) and packages/cli/templates/hooks/fabric-hint.cjs
// (ARCHIVE_HIGH_VALUE_EVENT_TYPES).
export const HIGH_VALUE_ARCHIVE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "knowledge_context_planned",
  "edit_paths_recorded",
  "edit_intent_checked", // the real high-freq edit signal (rc.37 NEW-14/B3)
]);

// Normative keywords in the latest assistant_turn_observed → high-value signal.
// Same list as the two prior local copies.
export const NORMATIVE_KEYWORDS: readonly string[] = [
  "以后",
  "always",
  "never",
  "from now on",
  "下次",
  "记一下",
  "永远不要",
];

type LedgerEventLike = {
  ts?: number;
  event_type?: string;
  session_id?: string;
  [key: string]: unknown;
};

/**
 * Returns true iff `sessionId` carries a high-value archive signal past
 * `watermarkTs`. See module JSDoc for semantic contract.
 *
 * @param events Ledger events (any-shape objects with ts/event_type/session_id).
 * @param sessionId REQUIRED session scope. undefined/empty → returns false.
 * @param watermarkTs Number (strict >) or null (treated as 0 = never archived).
 */
export function isHighValueArchiveCandidate(
  events: unknown,
  sessionId: string | undefined,
  watermarkTs: number | null | undefined,
): boolean {
  if (!Array.isArray(events)) return false;
  if (typeof sessionId !== "string" || sessionId.length === 0) return false;
  const wm = typeof watermarkTs === "number" ? watermarkTs : 0;
  let latestTurn: LedgerEventLike | null = null;
  for (const raw of events) {
    const e = raw as LedgerEventLike;
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
