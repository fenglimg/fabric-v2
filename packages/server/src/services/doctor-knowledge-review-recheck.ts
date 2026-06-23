import type { Translator } from "@fenglimg/fabric-shared";

import { readBroadReviewRecheckThresholdDays } from "../config-loader.js";
import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import type { DoctorCheck } from "./doctor.js";

// ---------------------------------------------------------------------------
// v2.2 C1 — broad REVIEW-RECHECK lint. The follow-up to the broad age-decay
// exemption in doctor-knowledge-age.ts.
//
// `broad` entries are SessionStart-pushed (never pull-recalled), so usage-age is
// structurally blind to them — they are EXEMPT from orphan_demote/stale_archive
// (doctor-knowledge-age.ts). But exempt-from-decay must not mean
// never-rechecked: processes/maturity-promotion-rubric-v1 replaces the age
// clock for broad with a REVIEW-CONFIRMATION clock — "N months with no fab-review
// re-confirmation → surface a recheck nudge".
//
// CLOCK SOURCE: `last_review_confirmed_at` frontmatter, stamped by review.ts at
// approve/modify (the review-confirmation moment). Falls back to `created_at` for
// entries approved BEFORE this field existed (a legacy broad entry never
// re-confirmed since creation is exactly what should be flagged). An entry with
// NEITHER timestamp carries no recheck evidence → skipped (conservative, mirrors
// the age lint's skip-on-no-signal).
//
// INFO-KIND (not warn): this is a non-blocking re-confirm NUDGE, never an
// auto-demote (the rubric is explicit: broad is "提示复查", not降级). Keeping it
// info-kind leaves doctor health "ok" — symmetric with the promotion-candidate
// growth lint. Pure read; never throws.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Line-regex over the raw frontmatter block (mirrors
// cross-store-recall.readSemanticScope — flat scalar, optional surrounding
// quotes). We read the raw body rather than widening the parsed description
// contract: the two timestamps are needed ONLY by this lint.
const LAST_REVIEW_CONFIRMED_LINE = /^last_review_confirmed_at:\s*"?([^"\n]+?)"?\s*$/mu;
const CREATED_AT_LINE = /^created_at:\s*"?([^"\n]+?)"?\s*$/mu;

type ResolvedClock = { ms: number; source: "review" | "created" };

// Resolve the recheck clock for an entry: last_review_confirmed_at wins; else
// created_at. Returns undefined when neither is present or parseable (no signal).
function resolveClock(source: string): ResolvedClock | undefined {
  const review = LAST_REVIEW_CONFIRMED_LINE.exec(source)?.[1];
  if (review !== undefined) {
    const ms = Date.parse(review);
    if (!Number.isNaN(ms)) return { ms, source: "review" };
  }
  const created = CREATED_AT_LINE.exec(source)?.[1];
  if (created !== undefined) {
    const ms = Date.parse(created);
    if (!Number.isNaN(ms)) return { ms, source: "created" };
  }
  return undefined;
}

export type BroadReviewRecheckCandidate = {
  stable_id: string; // store-qualified id (`<alias>:<local-id>`)
  path: string;
  age_days: number;
  // Which clock fired: a review-confirmed entry gone stale vs a legacy entry
  // never re-confirmed since creation.
  clock_source: "review" | "created";
};

export interface BroadReviewRecheckInspection {
  candidates: BroadReviewRecheckCandidate[];
  threshold_days: number;
}

// Walk the store corpus and surface `broad` entries whose review-confirmation
// clock exceeds the recheck threshold. `now` + `thresholdDays` are injectable for
// unit tests (thresholdDays defaults to the fabric-config override / 180d).
export async function inspectStoreBroadReviewRecheck(
  projectRoot: string,
  now: number,
  thresholdDays: number = readBroadReviewRecheckThresholdDays(projectRoot),
): Promise<BroadReviewRecheckInspection> {
  const entries = await collectStoreCanonicalEntries(projectRoot);

  const candidates: BroadReviewRecheckCandidate[] = [];
  for (const entry of entries) {
    // Symmetric with the age lint's exemption predicate: broad (incl. the
    // parse-layer broad default for entries with no explicit relevance_scope).
    if (entry.description.relevance_scope !== "broad") {
      continue;
    }
    const clock = resolveClock(entry.body);
    if (clock === undefined) {
      continue; // no review/created timestamp → no recheck evidence (conservative).
    }
    const ageDays = Math.floor((now - clock.ms) / MS_PER_DAY);
    if (ageDays > thresholdDays) {
      candidates.push({
        stable_id: entry.qualifiedId,
        path: `store:${entry.qualifiedId}`,
        age_days: ageDays,
        clock_source: clock.source,
      });
    }
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates, threshold_days: thresholdDays };
}

export function createBroadReviewRecheckCheck(
  t: Translator,
  inspection: BroadReviewRecheckInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return {
      name: t("doctor.check.broad_review_recheck.name"),
      status: "ok",
      message: t("doctor.check.broad_review_recheck.ok"),
    };
  }
  const first = inspection.candidates[0];
  const clockLabel = first.clock_source === "review" ? "last reviewed" : "never re-confirmed since creation,";
  const detail = `${first.stable_id} (broad, ${clockLabel} ${first.age_days}d ago → recheck)`;
  const count = inspection.candidates.length;
  return {
    name: t("doctor.check.broad_review_recheck.name"),
    // A re-confirm nudge, not a defect — info kind keeps doctor health "ok"
    // (broad is exempt from decay warnings; this is the gentler review clock).
    status: "ok",
    kind: "info",
    code: "knowledge_broad_review_recheck",
    fixable: false,
    message: t(`doctor.check.broad_review_recheck.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      thresholdDays: String(inspection.threshold_days),
      detail,
    }),
    actionHint: t("doctor.check.broad_review_recheck.remediation"),
  };
}
