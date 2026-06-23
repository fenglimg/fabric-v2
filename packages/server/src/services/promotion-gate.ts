import { readEventLedger } from "./event-ledger.js";

// ---------------------------------------------------------------------------
// v2.2 C1 — verified→proven NECESSARY gate: "0 dismiss".
//
// processes/maturity-promotion-rubric-v1 splits promotion into MECHANICAL
// necessary gates (cheap, deterministic — enforced here / by doctor) and a
// SUFFICIENT judgment (guideline/model summary cold-eval + a reviewer's "this is
// foundational" affirmation — offline / human, driven by the fabric-review
// skill). The one necessary condition enforceable synchronously server-side is
// "0 dismiss": an entry carrying an UNRESOLVED dismissed cite has a live
// objection on record and must not be laundered into the foundational tier.
//
// SIGNAL (KT-DEC-0021): the dismissal verdict lives on `assistant_turn_observed`
// events, which carry the per-turn cite audit payload — index-aligned
// `cite_ids[]` / `cite_tags[]` where each tag ∈ {applied, dismissed, none}. A
// later `applied` cite RE-AFFIRMS a previously dismissed entry, so the verdict
// is last-write-wins per id: only the LATEST cite tag decides. Pure read over
// the ledger; never throws (a missing/unreadable ledger = no dismissal evidence
// = does not block — the gate fails OPEN, leaving the human reviewer in charge).
// ---------------------------------------------------------------------------

// Strip an optional `<alias>:` store prefix so a qualified cite (`team:KT-DEC-1`)
// and a bare local one (`KT-DEC-1`) compare equal (mirrors
// doctor-knowledge-promotion.toLocalId).
function toLocalId(id: string): string {
  const sep = id.indexOf(":");
  return sep === -1 ? id : id.slice(sep + 1);
}

/**
 * True when the LATEST cite verdict recorded for `id` (qualified or local) is
 * `dismissed` — an unresolved objection that blocks promotion to `proven`.
 * Returns false when the entry was never cited, was last re-affirmed
 * (`applied`), or the ledger cannot be read.
 */
export async function hasUnresolvedDismissal(projectRoot: string, id: string): Promise<boolean> {
  const target = toLocalId(id);
  let events;
  try {
    ({ events } = await readEventLedger(projectRoot, { event_type: "assistant_turn_observed" }));
  } catch {
    return false; // no ledger → no dismissal evidence (gate fails open).
  }

  let latestTs = -1;
  let latestTag: "applied" | "dismissed" | "none" | undefined;
  for (const event of events) {
    if (event.event_type !== "assistant_turn_observed") continue;
    const ids = event.cite_ids;
    const tags = event.cite_tags;
    for (let i = 0; i < ids.length; i += 1) {
      const cited = ids[i];
      if (cited === undefined || toLocalId(cited) !== target) continue;
      const tag = tags[i];
      if (tag === undefined) continue;
      // >= so a later same-ts event still wins; file order is chronological.
      if (event.ts >= latestTs) {
        latestTs = event.ts;
        latestTag = tag;
      }
    }
  }

  return latestTag === "dismissed";
}
