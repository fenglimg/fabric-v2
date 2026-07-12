// Cite-policy Goodhart inspect (W8 extract from doctor.ts).
import type { EventLedgerEvent } from "@fenglimg/fabric-shared";

import { readEventLedger } from "./event-ledger.js";

// v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart detection. Static heuristics
// over the last 7 days of `assistant_turn_observed` events.
//
//   G1 ritual_cite     — same (kb_id, "applied") tuple repeated > 5 times
//                        across the window without contract change. Signal:
//                        user is reciting the cite incantation without acting.
//   G2 dismissal_abuse — > 60% of "applied" cites carry a skip_reason
//                        commitment instead of an operator contract. Signal:
//                        user is bypassing contract enforcement.
//   G5 placeholder_cite — "none" cites with generic kb_line_raw ("KB: none"
//                        or "[unspecified]") > 5. Signal: cite line ritual
//                        without semantic intent.
//
// v2.1.0-rc.1 (ADJ-P4-1, full remap): G3 chained_from_misuse was retired —
// rc.37 NEW-1 collapsed the cite vocabulary to 2-state, so the `chained-from`
// tag no longer exists (the parser/schema remap it to `applied`). The chain
// LINK it carried is still surfaced as a sibling cite_id, but the distinct tag
// it policed can never appear, so the lint became permanently dead. Removed
// rather than left as a no-op (fix, don't hide).
//
// All patterns are warning-level (never error) — Goodhart heuristics produce
// false positives by definition. Message enumerates fired patterns so the
// operator can audit per-pattern without re-running.
export type CiteGoodhartInspection = {
  status: "ok" | "warn";
  fired: Array<{ pattern: "G1" | "G2" | "G5"; detail: string }>;
};

// v2.0.0-rc.33 W3-3 (P1-3): Goodhart inspection over 7d of cite events.
// Reads `assistant_turn_observed` events from the ledger, applies 4 simple
// heuristics. Threshold tuning matches the rc.32 baseline cite-coverage 3.1%
// scenario — at that low signal density, > 5 instances of any one pattern
// over 7d is meaningful (vs noise floor < 1 per day).
export async function inspectCiteGoodhart(projectRoot: string): Promise<CiteGoodhartInspection> {
  const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const RITUAL_REPEAT_THRESHOLD = 5;
  const DISMISSAL_ABUSE_RATIO = 0.6;
  const PLACEHOLDER_COUNT_THRESHOLD = 5;
  const cutoffMs = Date.now() - WINDOW_MS;
  const fired: CiteGoodhartInspection["fired"] = [];

  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { status: "ok", fired: [] };
  }
  const turns = events.filter(
    (e): e is Extract<EventLedgerEvent, { event_type: "assistant_turn_observed" }> => {
      if (e.event_type !== "assistant_turn_observed") return false;
      const ts = Date.parse(e.timestamp);
      return Number.isFinite(ts) && ts >= cutoffMs;
    },
  );
  if (turns.length === 0) {
    return { status: "ok", fired: [] };
  }

  // G1: count (kb_id, "applied") tuples. Same tuple > threshold = ritual.
  // v2.1.0-rc.1 (ADJ-P4-1, full remap): cite_tags reaches here normalized to the
  // 2-state vocab (legacy 'recalled'/'planned'/'chained-from' → 'applied' on
  // read), so the single 'applied' category captures the Goodhart signal (AI
  // cites a single hot id over and over instead of expanding coverage).
  const appliedCount = new Map<string, number>();
  for (const turn of turns) {
    for (let i = 0; i < turn.cite_ids.length; i += 1) {
      if (turn.cite_tags[i] === "applied") {
        const key = turn.cite_ids[i];
        appliedCount.set(key, (appliedCount.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [id, n] of appliedCount.entries()) {
    if (n > RITUAL_REPEAT_THRESHOLD) {
      fired.push({ pattern: "G1", detail: `${id} repeated as [applied] ${n}x in 7d` });
      break; // one example is enough — operator scans the ledger for the rest
    }
  }

  // G2: dismissal abuse — skip_reason ratio on applied cites.
  let appliedTotal = 0;
  let appliedWithSkip = 0;
  for (const turn of turns) {
    for (let i = 0; i < turn.cite_ids.length; i += 1) {
      if (turn.cite_tags[i] !== "applied") continue;
      appliedTotal += 1;
      const commitment = turn.cite_commitments[i];
      if (commitment && typeof commitment.skip_reason === "string" && commitment.skip_reason.length > 0) {
        appliedWithSkip += 1;
      }
    }
  }
  if (appliedTotal >= 5 && appliedWithSkip / appliedTotal > DISMISSAL_ABUSE_RATIO) {
    fired.push({
      pattern: "G2",
      detail: `${appliedWithSkip}/${appliedTotal} applied cites used skip:<reason> (> ${Math.round(DISMISSAL_ABUSE_RATIO * 100)}%)`,
    });
  }

  // G3 chained_from_misuse retired in v2.1.0-rc.1 (ADJ-P4-1) — the chained-from
  // tag no longer exists post-remap, so the lint was permanently dead. See the
  // CiteGoodhartInspection type doc above.

  // G5: placeholder cite — "none" tags with generic kb_line_raw.
  // Generic markers: a kb_line_raw that is exactly "KB: none" (no bracketed reason)
  // OR contains "[unspecified]". The rc.33 cite-policy doc lists these as the
  // legacy/sentinel forms operators should NOT use long-term.
  let placeholderCount = 0;
  for (const turn of turns) {
    if (turn.cite_tags.length === 0) continue;
    const allNone = turn.cite_tags.every((t) => t === "none");
    if (!allNone) continue;
    const raw = (turn.kb_line_raw ?? "").trim();
    if (raw === "KB: none" || raw.includes("[unspecified]")) {
      placeholderCount += 1;
    }
  }
  if (placeholderCount > PLACEHOLDER_COUNT_THRESHOLD) {
    fired.push({
      pattern: "G5",
      detail: `${placeholderCount} placeholder "KB: none" / "[unspecified]" cites in 7d`,
    });
  }

  return { status: fired.length === 0 ? "ok" : "warn", fired };
}
