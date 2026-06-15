import { posix } from "node:path";

import type { Translator } from "@fenglimg/fabric-shared";

import { readOrphanDemoteThresholdDays } from "../config-loader.js";
import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import type { DoctorCheck, LintMaturity } from "./doctor.js";

// ---------------------------------------------------------------------------
// v2.2 Goal B (G-AGE) — knowledge decay lints over the read-set stores. The
// post-decolo successors of rc.4 TASK-001 (#16 orphan_demote / #17 stale_archive),
// rebuilt store-aware.
//
//   orphan_demote — a canonical entry whose inactivity (days since its last
//                   knowledge event in events.jsonl) exceeds the threshold for
//                   its maturity tier (proven=90 / verified=30 / draft=14,
//                   KT-DEC-0008). The --fix action demotes it one tier.
//   stale_archive — a DRAFT entry quiet beyond the draft demote threshold PLUS
//                   an additional 90d window (a terminal draft that never
//                   graduated and has gone silent → archive candidate).
//
// AGE SOURCE (Goal B directive): inactivity is measured from the entry's last
// knowledge event in events.jsonl (`buildLastActiveIndex`, store-agnostic, keyed
// by LOCAL stable_id) — NOT the optional frontmatter `created_at`. An entry with
// no event history carries no staleness evidence, so it is skipped (conservative:
// never demote/archive on absence of signal). Pure read; never throws.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// KT-DEC-0008 decay thresholds (days of inactivity) per maturity tier.
const ORPHAN_DEMOTE_THRESHOLD_DAYS: Record<LintMaturity, number> = {
  proven: 90,
  verified: 30,
  draft: 14,
};

// A draft is archive-eligible after the draft demote threshold (14d) PLUS this
// additional quiet window — "born-draft AND silent for ≥104d total".
const STALE_ARCHIVE_ADDITIONAL_DAYS = 90;

export type OrphanDemoteCandidate = {
  stable_id: string; // store-qualified id (`<alias>:<local-id>`)
  path: string;
  age_days: number;
  maturity: LintMaturity;
  // Next-lower tier the --fix demote would move it to (null when terminal=draft).
  next_maturity: "verified" | "draft" | null;
};

export interface OrphanDemoteInspection {
  candidates: OrphanDemoteCandidate[];
  thresholds: Record<LintMaturity, number>;
}

export type StaleArchiveCandidate = {
  stable_id: string;
  path: string;
  age_days: number;
  archive_path: string;
};

export interface StaleArchiveInspection {
  candidates: StaleArchiveCandidate[];
}

export interface KnowledgeAgeInspection {
  orphanDemote: OrphanDemoteInspection;
  staleArchive: StaleArchiveInspection;
}

// Resolve per-maturity thresholds, layering any fabric-config.json override on
// the KT-DEC-0008 defaults. Override keys are the canonical maturity vocabulary
// (proven/verified/draft) — see config-loader.readOrphanDemoteThresholdDays.
function resolveMaturityThresholds(projectRoot: string): Record<LintMaturity, number> {
  const overrides = readOrphanDemoteThresholdDays(projectRoot);
  return {
    proven: overrides.proven ?? ORPHAN_DEMOTE_THRESHOLD_DAYS.proven,
    verified: overrides.verified ?? ORPHAN_DEMOTE_THRESHOLD_DAYS.verified,
    draft: overrides.draft ?? ORPHAN_DEMOTE_THRESHOLD_DAYS.draft,
  };
}

function nextLowerMaturity(current: LintMaturity): "verified" | "draft" | null {
  if (current === "proven") return "verified";
  if (current === "verified") return "draft";
  return null;
}

// Compute both decay inspections in a single store-corpus walk. `lastActiveIndex`
// is the events.jsonl-derived Map<localStableId, lastActiveAtEpochMs> (built by
// the caller via doctor.buildLastActiveIndex); injected so the inspection stays
// pure + unit-testable with a hand-built index.
export async function inspectStoreKnowledgeAge(
  projectRoot: string,
  now: number,
  lastActiveIndex: Map<string, number>,
): Promise<KnowledgeAgeInspection> {
  const entries = await collectStoreCanonicalEntries(projectRoot);
  const thresholds = resolveMaturityThresholds(projectRoot);

  const orphanCandidates: OrphanDemoteCandidate[] = [];
  const staleCandidates: StaleArchiveCandidate[] = [];

  for (const entry of entries) {
    const maturity = entry.description.maturity;
    if (maturity === undefined) {
      continue; // no maturity → cannot tier the decay threshold.
    }
    const lastActive = lastActiveIndex.get(entry.stableId);
    if (lastActive === undefined) {
      continue; // no event history → no staleness evidence (conservative).
    }
    const ageDays = Math.floor((now - lastActive) / MS_PER_DAY);
    const display = `store:${entry.qualifiedId}`;

    if (ageDays > thresholds[maturity]) {
      orphanCandidates.push({
        stable_id: entry.qualifiedId,
        path: display,
        age_days: ageDays,
        maturity,
        next_maturity: nextLowerMaturity(maturity),
      });
    }

    if (
      maturity === "draft" &&
      ageDays > ORPHAN_DEMOTE_THRESHOLD_DAYS.draft + STALE_ARCHIVE_ADDITIONAL_DAYS
    ) {
      staleCandidates.push({
        stable_id: entry.qualifiedId,
        path: display,
        age_days: ageDays,
        archive_path: posix.join(".fabric/.archive", entry.type, `${entry.stableId}.md`),
      });
    }
  }

  orphanCandidates.sort((a, b) => a.path.localeCompare(b.path));
  staleCandidates.sort((a, b) => a.path.localeCompare(b.path));

  return {
    orphanDemote: { candidates: orphanCandidates, thresholds },
    staleArchive: { candidates: staleCandidates },
  };
}

export function createOrphanDemoteCheck(
  t: Translator,
  inspection: OrphanDemoteInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return {
      name: t("doctor.check.orphan_demote.name"),
      status: "ok",
      message: t("doctor.check.orphan_demote.ok"),
    };
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} at ${first.path} (${first.maturity}, ${first.age_days}d inactive${first.next_maturity === null ? ", terminal draft" : ` → ${first.next_maturity}`})`;
  const count = inspection.candidates.length;
  return {
    name: t("doctor.check.orphan_demote.name"),
    status: "warn",
    kind: "warning",
    code: "knowledge_orphan_demote_required",
    fixable: false,
    message: t(`doctor.check.orphan_demote.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      provenDays: String(inspection.thresholds.proven),
      verifiedDays: String(inspection.thresholds.verified),
      draftDays: String(inspection.thresholds.draft),
      detail,
    }),
    actionHint: t("doctor.check.orphan_demote.remediation"),
  };
}

export function createStaleArchiveCheck(
  t: Translator,
  inspection: StaleArchiveInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return {
      name: t("doctor.check.stale_archive.name"),
      status: "ok",
      message: t("doctor.check.stale_archive.ok"),
    };
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} at ${first.path} (${first.age_days}d inactive → ${first.archive_path})`;
  const count = inspection.candidates.length;
  return {
    name: t("doctor.check.stale_archive.name"),
    status: "warn",
    kind: "warning",
    code: "knowledge_stale_archive_required",
    fixable: false,
    message: t(`doctor.check.stale_archive.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      additionalDays: String(STALE_ARCHIVE_ADDITIONAL_DAYS),
      detail,
    }),
    actionHint: t("doctor.check.stale_archive.remediation"),
  };
}
