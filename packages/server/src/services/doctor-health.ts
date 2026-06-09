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
