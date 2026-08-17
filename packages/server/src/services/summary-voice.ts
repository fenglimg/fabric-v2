/**
 * Pure summary session-voice heuristics (shared by propose + doctor).
 *
 * A knowledge entry's `summary` is the ONLY field `fab_recall` puts on the wire
 * (bodies are fetched on demand), so it is what an agent reads to decide whether
 * the entry is worth opening. A summary written as a session minute — "the user
 * asked X, I first tried Y, then they rejected it" — records who said what, not
 * what was concluded, and is therefore unusable as an index line.
 *
 * Scope of this check (deliberately narrow, see KT-GLD-0006): it is the
 * WRITE-TIME FLOOR, not the gate. It catches the crude failure — session
 * pronouns and meeting-minute verbs — and nothing else. A summary that is fluent
 * but merely POINTS at the body ("Notes on the exit modal decision") passes here
 * and is caught downstream by the zero-context cold-eval judge, which is the real
 * gate. Do not grow this module toward semantic self-sufficiency judgement.
 *
 * Calibration (KT-GLD-0022 — a string-shaped static gate must be narrowed against
 * the real corpus before it ships, never shipped at its first-guess width):
 * measured over the wespy-team-cocos-knowledge-base corpus (180 entries), the
 * naive pronoun list produced 93 hits / 3 false positives — all three from the
 * DOMAIN NOUN `用户X` ("user info", "user avatar"), and all three were correctly
 * written declarative summaries. Stripping domain-noun compounds before matching
 * takes false positives on that corpus to zero. Re-run the calibration when
 * pointing this at a new store's corpus.
 */
export type SummaryVoiceAssessment =
  | { ok: true }
  | { ok: false; code: "summary_session_voice"; detail: string };

/**
 * Domain-noun compounds stripped BEFORE pronoun matching. `用户` is both a
 * session pronoun ("the user asked") and an extremely common domain noun in a
 * game codebase ("user info panel", "user avatar"). Without this strip, three
 * well-written wespy summaries were flagged.
 */
const DOMAIN_NOUN_RE = /用户(?:头像|信息|昵称|等级|数据|列表|画像|体验|态|名|反馈|ID|id|Id)/gu;

/**
 * Session-voice markers. Chinese entries use bare pronouns; English domain text
 * says "user" constantly ("user avatar"), so the English side matches PHRASES
 * (pronoun + speech/decision verb) rather than the bare noun.
 */
const VOICE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/用户/u, "用户"],
  [/我先|我把|我一开始|我最初/u, "第一人称叙述"],
  [/本次|这次会话|此后|随后我/u, "会话时点指代"],
  [/拍板|逐字确认|要求我|否掉|重申/u, "会议纪要动词"],
  [/\bthe user (?:asked|requested|said|wanted|rejected|confirmed|pushed back)/iu, "the user <verb>"],
  [/\bI (?:first|initially|originally) (?:tried|wrote|assumed|implemented)/iu, "I <first> <verb>"],
  [/\bthis (?:session|conversation|time)\b/iu, "this session"],
];

/**
 * Assess whether a summary is written in session voice (a minute) rather than as
 * a standalone declarative conclusion.
 */
export function assessSummaryVoice(summary: string): SummaryVoiceAssessment {
  const raw = summary.trim();
  if (raw.length === 0) return { ok: true };

  // Strip domain-noun compounds so `用户信息弹窗` does not read as `用户`.
  const probe = raw.replace(DOMAIN_NOUN_RE, "");

  const hits: string[] = [];
  for (const [re, label] of VOICE_PATTERNS) {
    if (re.test(probe)) hits.push(label);
  }
  if (hits.length === 0) return { ok: true };

  return {
    ok: false,
    code: "summary_session_voice",
    detail: hits.join(","),
  };
}
