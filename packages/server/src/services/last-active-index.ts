// Build a Map<stable_id, lastActiveAtEpochMs> in a single pass over events.jsonl.
// "Activity" is the union of events that reference a knowledge entry by its
// stable_id: knowledge_proposed, knowledge_promoted, knowledge_promote_started,
// knowledge_demoted, knowledge_archived, knowledge_layer_changed, knowledge_slug_renamed,
// AND read-side fetch events knowledge_sections_fetched (final_stable_ids[]) and
// knowledge_selection (final_stable_ids[] union ai_selected_stable_ids[] union
// required_stable_ids[]). knowledge_context_planned is also included.
//
// Complexity: O(N events). Per-file lookup is O(1). Documented per the risk
// note in TASK-001.json — sufficient for v2.0 ledgers (<10k events typical).
//
// C1-W6: extracted from doctor.ts so plan-context's credibility decay and the
// doctor orphan/stale lints share ONE event→last-active reducer (no drift). Both
// the staleness lint and the recall-time decay must read "last touched" the same
// way, so this is the single source of truth.

import { readEventLedger } from "./event-ledger.js";

export async function buildLastActiveIndex(projectRoot: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let events;
  try {
    ({ events } = await readEventLedger(projectRoot));
  } catch {
    return map;
  }

  for (const event of events) {
    const ts = event.ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) {
      continue;
    }
    // Collect every stable_id this event references.
    const ids: string[] = [];
    switch (event.event_type) {
      case "knowledge_proposed":
      case "knowledge_promote_started":
      case "knowledge_promoted":
      case "knowledge_promote_failed":
      case "knowledge_layer_changed":
      case "knowledge_slug_renamed":
      case "knowledge_demoted":
      case "knowledge_archived":
      case "knowledge_archive_attempted":
      case "knowledge_deferred":
      // KT-DEC-0030: knowledge_body_read is the native-Read consumption signal
      // that replaced knowledge_consumed/knowledge_sections_fetched — it carries a
      // single stable_id and is the forward recency source for orphan/stale lints.
      case "knowledge_body_read":
      case "knowledge_rejected": {
        if (typeof event.stable_id === "string" && event.stable_id.length > 0) {
          ids.push(event.stable_id);
        }
        break;
      }
      case "knowledge_context_planned": {
        ids.push(...event.required_stable_ids, ...event.ai_selectable_stable_ids, ...event.final_stable_ids);
        break;
      }
      case "knowledge_selection": {
        ids.push(
          ...event.required_stable_ids,
          ...event.ai_selectable_stable_ids,
          ...event.ai_selected_stable_ids,
          ...event.final_stable_ids,
        );
        break;
      }
      case "knowledge_sections_fetched": {
        ids.push(...event.final_stable_ids, ...event.ai_selected_stable_ids);
        break;
      }
      default:
        break;
    }

    for (const id of ids) {
      const prev = map.get(id);
      if (prev === undefined || ts > prev) {
        map.set(id, ts);
      }
    }
  }

  return map;
}
