// C1-W6 (credibility decay): port of maestro-flow src/graph/kg/credibility.ts
// computeDecayFactor (lines 78-87) + the type half-life table (36-49). fabric
// takes the ALGORITHM, not the storage — there is deliberately NO sqlite
// credibility table (synthesis: "只取算法不取存储, 不引 sqlite"). The age that
// feeds the decay is derived at recall time from the existing events.jsonl
// last-active index (buildLastActiveIndex), so this adds zero new persistence.
//
// The factor MULTIPLIES a candidate's BM25 relevance in plan-context. A stale
// (long-untouched) entry has its content-relevance discounted; a fresh or
// frequently-recalled one keeps full weight. Because it is a multiplier on the
// relevance term (never additive, never a filter), it can only reorder
// candidates that are already close on relevance — it never buries a strong
// content match under a fresher weak one (KT-PIT-0020: content relevance stays
// primary; KT-DEC-0019: no hard floor / no candidate dropped).

const LN2 = Math.LN2;
const MS_PER_DAY = 86_400_000;

export interface DecayConfig {
  /**
   * The lowest the multiplier can fall to as age → ∞. NOT maestro's 0.3:
   * fabric uses 0.5 so the decay can at most halve a candidate's relevance
   * weight — guaranteeing that an entry twice as relevant always outranks a
   * fresher one regardless of age (the KT-PIT-0020 "content stays primary"
   * invariant, enforced by construction rather than by tuning).
   */
  floor: number;
  /** knowledge_type (plural form) → half-life in DAYS. */
  halfLives: Record<string, number>;
  /** Half-life for an unrecognized / absent type. */
  defaultHalfLife: number;
}

// Half-lives in DAYS. fabric knowledge is durable, so these are long — an entry
// only decays appreciably after months untouched. Ordered by type durability:
// mental models and guidelines outlast decisions / processes / pitfalls, which
// can be superseded as the code they describe changes.
export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  floor: 0.5,
  halfLives: {
    models: 180,
    guidelines: 150,
    decisions: 120,
    processes: 120,
    pitfalls: 120,
  },
  defaultHalfLife: 120,
};

/**
 * Continuous exponential decay multiplier in [floor, 1].
 *
 * factor = floor + (1 - floor) · e^(−λ · ageDays), λ = ln2 / halfLife.
 * age 0 → 1.0 (no decay); age = halfLife → floor + (1−floor)/2; age → ∞ → floor.
 * A non-positive age is clamped to 0 (a future / just-touched entry is fresh).
 */
export function computeDecayFactor(
  ageDays: number,
  knowledgeType: string,
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  const halfLife = config.halfLives[knowledgeType] ?? config.defaultHalfLife;
  const lambda = LN2 / halfLife;
  const age = ageDays > 0 ? ageDays : 0;
  return config.floor + (1 - config.floor) * Math.exp(-lambda * age);
}

/**
 * Resolve a candidate's decay multiplier from its observed activity.
 *
 * Age reference, in priority order:
 *   1. `lastActiveMs` — the most recent events.jsonl activity for this id
 *      (read / surfaced / promoted). A frequently-recalled entry stays fresh.
 *   2. `createdAt`     — frontmatter creation time, used when the entry has no
 *      events yet (a brand-new entry is fresh, not stale).
 *   3. otherwise `nowMs` (age 0 → factor 1) — never decay an entry we know
 *      nothing about.
 */
export function decayFactor(
  opts: {
    lastActiveMs?: number;
    createdAt?: string;
    nowMs: number;
    knowledgeType: string;
  },
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  let refMs = opts.lastActiveMs;
  if (refMs === undefined || !Number.isFinite(refMs)) {
    const parsed = typeof opts.createdAt === "string" ? Date.parse(opts.createdAt) : NaN;
    refMs = Number.isFinite(parsed) ? parsed : opts.nowMs;
  }
  const ageDays = (opts.nowMs - refMs) / MS_PER_DAY;
  return computeDecayFactor(ageDays, opts.knowledgeType, config);
}
