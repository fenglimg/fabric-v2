// G4 (GRL-STOPHOOK-AIONLY-20260709) imports for checkBacklogAge. Kept at
// module top per TS spec; the function itself lives below computeDoctorHealth.
import { isHighValueArchiveCandidate } from "@fenglimg/fabric-shared";
import { readEventLedger } from "./event-ledger.js";

// v2.2 A14-doctor-health (W3-T4): doctor health rollup. `score` is 0-100,
// `grade` is the band, and `penalties` itemizes how each severity bucket
// subtracted from a perfect 100.
export type DoctorHealth = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  penalties: {
    manual_errors: number;
    fixable_errors: number;
    warnings: number;
  };
};

// G4 (GRL-STOPHOOK-AIONLY-20260709): backlog-age metric result. Pure metric —
// never carries lint severity, never affects doctor exit code. When count=0
// oldest_days is null (no candidates to age).
export type BacklogAgeMetric = {
  count: number;
  oldest_days: number | null;
  median_age_days: number;
  ages_days: number[];
};

// Per-finding penalty weights. Manual (un-auto-fixable) errors hurt most; a
// warning is a light nudge. Infos never penalize because they are FYI, not debt.
const DOCTOR_HEALTH_PENALTY_MANUAL_ERROR = 15;
const DOCTOR_HEALTH_PENALTY_FIXABLE_ERROR = 8;
const DOCTOR_HEALTH_PENALTY_WARNING = 3;

/**
 * Roll the lint findings into a 0-100 score + letter grade. Pure and
 * deterministic: it reuses the same counts doctor already computes, so the
 * score moves in lockstep with the lint set with no new I/O.
 */
export function computeDoctorHealth(
  manualErrorCount: number,
  fixableErrorCount: number,
  warningCount: number,
): DoctorHealth {
  const manualPenalty = manualErrorCount * DOCTOR_HEALTH_PENALTY_MANUAL_ERROR;
  const fixablePenalty = fixableErrorCount * DOCTOR_HEALTH_PENALTY_FIXABLE_ERROR;
  const warningPenalty = warningCount * DOCTOR_HEALTH_PENALTY_WARNING;
  const score = Math.max(0, Math.min(100, 100 - manualPenalty - fixablePenalty - warningPenalty));
  const grade: DoctorHealth["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return {
    score,
    grade,
    penalties: {
      manual_errors: manualPenalty,
      fixable_errors: fixablePenalty,
      warnings: warningPenalty,
    },
  };
}

// G4 (GRL-STOPHOOK-AIONLY-20260709): backlog-age observability entry.
//
// Reuses the shared archive high-value SST (isHighValueArchiveCandidate) — no
// re-implementation. For each distinct session_id in events.jsonl, tests
// whether the session carries a high-value archive candidate past its
// per-session archive watermark (max session_archive_attempted.covered_through_ts
// for that sid; null when the session was never archived). Returns count of
// qualifying sessions + oldest / median age-in-days for the population.
//
// Contract: NEVER-THROW. A missing/unreadable events.jsonl → count=0. This
// function is called from the doctor CLI path where a read failure MUST NOT
// change doctor's exit semantics — the caller wraps in try/catch as an
// additional safety net (verified by G4 test "gracefully degrades when
// checkBacklogAge throws"), and the internal try/catch here is the primary
// silent-degrade path.
type EventLike = {
  ts?: number;
  event_type?: string;
  session_id?: string;
  covered_through_ts?: number;
  outcome?: string;
};

export async function checkBacklogAge(
  projectRoot: string,
  nowMs: number = Date.now(),
): Promise<BacklogAgeMetric> {
  const empty: BacklogAgeMetric = {
    count: 0,
    oldest_days: null,
    median_age_days: 0,
    ages_days: [],
  };
  let events: EventLike[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events as EventLike[];
  } catch {
    return empty;
  }
  if (!Array.isArray(events) || events.length === 0) return empty;

  // Group: distinct session_ids seen in the ledger.
  const sids = new Set<string>();
  // Map sid -> most recent archive watermark (covered_through_ts) if any.
  const lastAttemptCoveredThrough = new Map<string, number>();
  // Map sid -> earliest ts (for age calculation of never-archived sessions).
  const firstEventTs = new Map<string, number>();
  for (const e of events) {
    if (typeof e.session_id !== "string" || e.session_id.length === 0) continue;
    if (typeof e.ts !== "number") continue;
    sids.add(e.session_id);
    const priorFirst = firstEventTs.get(e.session_id);
    if (priorFirst === undefined || e.ts < priorFirst) {
      firstEventTs.set(e.session_id, e.ts);
    }
    if (e.event_type === "session_archive_attempted" && typeof e.covered_through_ts === "number") {
      const prior = lastAttemptCoveredThrough.get(e.session_id);
      if (prior === undefined || e.ts > prior) {
        lastAttemptCoveredThrough.set(e.session_id, e.covered_through_ts);
      }
    }
  }

  // Collect qualifying (high-value backlog) sessions and their ages in days.
  const agesMs: number[] = [];
  for (const sid of sids) {
    const watermark = lastAttemptCoveredThrough.get(sid) ?? null;
    if (!isHighValueArchiveCandidate(events, sid, watermark)) continue;
    // Age = (now - session's first-event ts) rounded down to whole days.
    const first = firstEventTs.get(sid);
    if (typeof first !== "number") continue;
    const ageMs = Math.max(0, nowMs - first);
    agesMs.push(ageMs);
  }
  if (agesMs.length === 0) return empty;
  const agesDays = agesMs.map((ms) => Math.floor(ms / 86_400_000));
  agesDays.sort((a, b) => a - b);
  const oldestDays = agesDays[agesDays.length - 1];
  const medianAgeDays =
    agesDays.length % 2 === 1
      ? agesDays[Math.floor(agesDays.length / 2)]
      : Math.floor((agesDays[agesDays.length / 2 - 1] + agesDays[agesDays.length / 2]) / 2);
  return {
    count: agesDays.length,
    oldest_days: oldestDays,
    median_age_days: medianAgeDays,
    ages_days: agesDays,
  };
}

// G4 render helper: format the metric as the neutral one-liner shown by the
// doctor CLI. Two-space indent aligns with store-health rows; no colour.
export function renderBacklogAgeLine(metric: BacklogAgeMetric): string {
  if (metric.count === 0) return "  backlog: 0 high-value";
  return `  backlog: ${metric.count} high-value, oldest ${metric.oldest_days}d`;
}
