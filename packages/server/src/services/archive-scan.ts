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
// G3 (GRL-STOPHOOK-AIONLY-20260709): shared high-value predicate SST. Hook has
// a byte-parity .cjs twin at packages/cli/templates/hooks/lib/
// high-value-predicate.cjs; round-trip parity locked by
// packages/server/src/services/high-value-sst.test.ts. Fixes crack-2 26→1
// virtual-alarm drift where hook and this file each ran independent copies.
import { isHighValueArchiveCandidate } from "@fenglimg/fabric-shared";
import { readEventLedger } from "./event-ledger.js";

// rc.25 TASK-05 constants (verbatim from ref/phase-1-cross-session.md).
const ANTI_LOOP_HOURS = 12;
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
  // ISS-20260713-034: one ledger read + one forward pass for indexes, then
  // filter. Avoids reverse multipass re-walks; still needs the event array for
  // isHighValueArchiveCandidate (session-scoped scan after watermark).
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

  const rangeSet =
    Array.isArray(input.range) && input.range.length > 0 ? new Set(input.range) : null;

  let anchorTs: number | null = null;
  const sessionOrder: string[] = [];
  const seen = new Set<string>();
  let maxExaminedTs: number | null = null;
  const lastAttempt = new Map<string, LedgerEvent>();
  const proposedKeys = new Set<string>();

  // Single forward pass builds all indexes (O(N) once).
  for (const e of events) {
    if (typeof e.ts !== "number") continue;
    if (e.event_type === "knowledge_proposed" && (anchorTs === null || e.ts > anchorTs)) {
      anchorTs = e.ts;
    }
    if (e.event_type === "session_archive_attempted") {
      const sid = e.session_id;
      if (typeof sid === "string" && sid.length > 0) {
        const prior = lastAttempt.get(sid);
        if (!prior || (typeof prior.ts === "number" && e.ts > prior.ts)) {
          lastAttempt.set(sid, e);
        }
      }
      if (
        e.outcome === "proposed" &&
        nowMs - e.ts <= PROPOSED_KEYS_WINDOW_MS &&
        Array.isArray(e.knowledge_proposed_ids)
      ) {
        for (const id of e.knowledge_proposed_ids) {
          if (typeof id === "string" && id.length > 0) proposedKeys.add(id);
        }
      }
    }
  }

  // Session discovery uses the anchor found above (still O(N), no re-parse).
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

  const kept: string[] = [];
  const dropped: ArchiveScanOutput["dropped"] = [];
  for (const sid of sessionOrder) {
    const attempt = lastAttempt.get(sid);
    if (!attempt) {
      kept.push(sid);
      continue;
    }
    if (attempt.outcome === "user_dismissed") {
      dropped.push({ session_id: sid, reason: "user_dismissed" });
      continue;
    }
    if (typeof attempt.ts === "number" && nowMs - attempt.ts < ANTI_LOOP_HOURS * 3_600_000) {
      dropped.push({ session_id: sid, reason: "cooldown" });
      continue;
    }
    if (typeof attempt.covered_through_ts === "number") {
      if (isHighValueArchiveCandidate(events, sid, attempt.covered_through_ts)) {
        kept.push(sid);
      } else {
        dropped.push({ session_id: sid, reason: "no_new_signal" });
      }
      continue;
    }
    kept.push(sid);
  }

  return {
    anchor_ts: anchorTs,
    session_ids: kept,
    dropped,
    covered_through_ts: maxExaminedTs,
    already_proposed_keys: [...proposedKeys],
  };
}

// G3 (GRL-STOPHOOK-AIONLY-20260709): local hasHighValueSignal removed —
// replaced by isHighValueArchiveCandidate imported from @fenglimg/fabric-shared
// (single source of truth). Hook has a byte-parity .cjs twin. Round-trip
// parity verified by packages/server/src/services/high-value-sst.test.ts.
