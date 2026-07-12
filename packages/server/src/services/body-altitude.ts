/** Pure body-altitude heuristics (shared by propose + doctor). */
export type BodyAltitudeAssessment =
  | { ok: true }
  | { ok: false; code: "body_altitude_dump" | "body_altitude_transcript_shape"; detail: string };

const TURN_MARKER_RE = /^(?:User|Assistant|Human|AI|System)\s*:/imu;
const TIMESTAMP_TURN_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b.*\b(?:User|Assistant|Human|AI)\b/imu;
const TRANSCRIPT_HEADER_RE = /\b(?:session\s*transcript|chat\s*log|conversation\s*dump)\b/iu;

/**
 * Detect dump / transcript-shaped knowledge bodies.
 * Structured H2 bodies (especially type=guidelines documenting anti-patterns) are allowed.
 */
export function assessBodyAltitude(
  sessionContext: string,
  summary: string,
  type: string,
): BodyAltitudeAssessment {
  const body = `${summary}\n${sessionContext}`.trim();
  if (body.length === 0) return { ok: true };

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const turnMarkers = lines.filter((l) => TURN_MARKER_RE.test(l)).length;
  const hasTranscriptHeader = TRANSCRIPT_HEADER_RE.test(body);
  const timestampTurns = lines.filter((l) => TIMESTAMP_TURN_RE.test(l)).length;
  const h2Count = (body.match(/^##\s+/gm) ?? []).length;

  // Structured guidelines may quote dump anti-patterns under ## sections.
  if (type === "guidelines" && h2Count >= 1 && turnMarkers < 6) {
    return { ok: true };
  }

  // Dump shape: dense role-turn markers without structured H2 guidance body.
  if (turnMarkers >= 3 && h2Count === 0) {
    return {
      ok: false,
      code: "body_altitude_dump",
      detail: `turn_markers=${turnMarkers} h2=${h2Count}`,
    };
  }
  // COR-004: transcript header only fails when body lacks H2 structure (parity with turnMarkers rule).
  if (hasTranscriptHeader && turnMarkers >= 2 && h2Count === 0) {
    return {
      ok: false,
      code: "body_altitude_transcript_shape",
      detail: `transcript_header+turn_markers=${turnMarkers} h2=${h2Count}`,
    };
  }
  if (timestampTurns >= 3 && h2Count === 0) {
    return {
      ok: false,
      code: "body_altitude_transcript_shape",
      detail: `timestamp_turns=${timestampTurns}`,
    };
  }
  return { ok: true };
}
