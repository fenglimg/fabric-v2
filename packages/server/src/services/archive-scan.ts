/**
 * v2.0.0-rc.37 NEW-9: deterministic Phase 1 ledger scan for fabric-archive.
 *
 * Ports the previously LLM-driven anchor-find → session forward-collect →
 * outcome-ledger filter state machine (Steps 2-4.5 of fabric-archive's Phase 1)
 * to the server, where it runs deterministically. The Skill calls this once,
 * then loads digests for the returned `session_ids` and does the semantic
 * stitching itself (Boundary B: deterministic ledger scan → MCP; semantic
 * selection / context build → LLM).
 *
 * Never throws on a missing / empty ledger — degrades to "scan everything"
 * (anchor_ts null, no sessions dropped).
 */

import type {
  ArchiveScanInput,
  ArchiveScanOutput,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { readEventLedger } from "./event-ledger.js";

// rc.25 TASK-05 constants (verbatim from ref/phase-1-cross-session.md).
const ANTI_LOOP_HOURS = 12;
const HIGH_VALUE_EVENT_TYPES = new Set([
  "knowledge_context_planned",
  "edit_paths_recorded",
  "edit_intent_checked", // the real high-freq edit signal (rc.37 NEW-14/B3)
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
// Window for the cross-session pending dedupe scan (matches the digest window
// horizon — 30 days is generous; the ledger rotation tick trims older events).
const PROPOSED_KEYS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type LedgerEvent = {
  ts?: number;
  event_type?: string;
  session_id?: string;
  outcome?: string;
  covered_through_ts?: number;
  knowledge_proposed_ids?: string[];
  [key: string]: unknown;
};

export async function collectArchiveScan(
  projectRoot: string,
  input: ArchiveScanInput = {},
): Promise<ArchiveScanOutput> {
  const nowMs = typeof input.now_ms === "number" ? input.now_ms : Date.now();
  let events: LedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events as LedgerEvent[];
  } catch {
    return {
      anchor_ts: null,
      session_ids: [],
      dropped: [],
      covered_through_ts: null,
      already_proposed_keys: [],
    };
  }

  // Step 2 — anchor = ts of the most recent knowledge_proposed.
  let anchorTs: number | null = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.event_type === "knowledge_proposed" && typeof e.ts === "number") {
      anchorTs = e.ts;
      break;
    }
  }

  // Optional Phase 0 scope constraint.
  const rangeSet =
    Array.isArray(input.range) && input.range.length > 0 ? new Set(input.range) : null;

  // Step 3 — distinct session_ids on events newer than the anchor, first-seen
  // order. (anchor null → consider every event.)
  const sessionOrder: string[] = [];
  const seen = new Set<string>();
  let maxExaminedTs: number | null = null;
  for (const e of events) {
    if (typeof e.ts !== "number") continue;
    if (anchorTs !== null && e.ts <= anchorTs) continue;
    if (maxExaminedTs === null || e.ts > maxExaminedTs) maxExaminedTs = e.ts;
    const sid = e.session_id;
    if (typeof sid !== "string" || sid.length === 0) continue;
    if (rangeSet && !rangeSet.has(sid)) continue;
    if (!seen.has(sid)) {
      seen.add(sid);
      sessionOrder.push(sid);
    }
  }

  // Index: most-recent session_archive_attempted per session_id.
  const lastAttempt = new Map<string, LedgerEvent>();
  for (const e of events) {
    if (e.event_type !== "session_archive_attempted") continue;
    const sid = e.session_id;
    if (typeof sid !== "string" || typeof e.ts !== "number") continue;
    const prior = lastAttempt.get(sid);
    if (!prior || (typeof prior.ts === "number" && e.ts > prior.ts)) {
      lastAttempt.set(sid, e);
    }
  }

  // Step 4.5 — outcome-ledger filter state machine.
  const kept: string[] = [];
  const dropped: ArchiveScanOutput["dropped"] = [];
  for (const sid of sessionOrder) {
    const attempt = lastAttempt.get(sid);
    if (!attempt) {
      kept.push(sid); // (e) never attempted → keep
      continue;
    }
    if (attempt.outcome === "user_dismissed") {
      dropped.push({ session_id: sid, reason: "user_dismissed" }); // (b)
      continue;
    }
    if (typeof attempt.ts === "number" && nowMs - attempt.ts < ANTI_LOOP_HOURS * 3_600_000) {
      dropped.push({ session_id: sid, reason: "cooldown" }); // (c)
      continue;
    }
    if (typeof attempt.covered_through_ts === "number") {
      if (hasHighValueSignal(events, sid, attempt.covered_through_ts)) {
        kept.push(sid); // (d) new substantive activity → keep
      } else {
        dropped.push({ session_id: sid, reason: "no_new_signal" }); // (d)
      }
      continue;
    }
    kept.push(sid); // attempted but no watermark → keep
  }

  // (f) Cross-session pending dedupe — union of knowledge_proposed_ids from
  // recent outcome=proposed attempts across ALL sessions.
  const proposedKeys = new Set<string>();
  for (const e of events) {
    if (e.event_type !== "session_archive_attempted") continue;
    if (e.outcome !== "proposed") continue;
    if (typeof e.ts === "number" && nowMs - e.ts > PROPOSED_KEYS_WINDOW_MS) continue;
    for (const id of Array.isArray(e.knowledge_proposed_ids) ? e.knowledge_proposed_ids : []) {
      if (typeof id === "string" && id.length > 0) proposedKeys.add(id);
    }
  }

  return {
    anchor_ts: anchorTs,
    session_ids: kept,
    dropped,
    covered_through_ts: maxExaminedTs,
    already_proposed_keys: [...proposedKeys],
  };
}

// (d) high-value signal probe: any HIGH_VALUE_EVENT_TYPES for this session past
// the watermark, OR a NORMATIVE_KEYWORDS hit in the latest assistant_turn_observed.
function hasHighValueSignal(
  events: LedgerEvent[],
  sessionId: string,
  watermarkTs: number,
): boolean {
  let latestTurn: LedgerEvent | null = null;
  for (const e of events) {
    if (e.session_id !== sessionId) continue;
    if (typeof e.ts !== "number" || e.ts <= watermarkTs) continue;
    if (typeof e.event_type === "string" && HIGH_VALUE_EVENT_TYPES.has(e.event_type)) {
      return true;
    }
    if (e.event_type === "assistant_turn_observed") {
      if (!latestTurn || (typeof latestTurn.ts === "number" && e.ts > latestTurn.ts)) {
        latestTurn = e;
      }
    }
  }
  if (latestTurn) {
    const haystack = JSON.stringify(latestTurn).toLowerCase();
    for (const kw of NORMATIVE_KEYWORDS) {
      if (haystack.includes(kw.toLowerCase())) return true;
    }
  }
  return false;
}
