// ---------------------------------------------------------------------------
// F03/F04 (review fix): THE always-active predicate.
//
// "Always-active" is the resident tier — the entries whose rule is presented to
// the agent unconditionally at SessionStart. Three surfaces have to agree on
// exactly which entries those are:
//
//   1. buildAlwaysActiveBodies (cross-store-recall)  — what is actually injected
//   2. fab_recall's `body_in_context` flag (recall)  — "already injected, skip
//                                                       the Read"
//   3. `fabric audit why-not-surfaced`               — "why isn't this showing?"
//
// They used to each carry their own copy of the rule, with a comment on one of
// them asking the next editor to keep them in sync by hand. That failed the
// first time the rule changed: the maturity axis landed in (1) only, so (2)
// started telling the agent a body was in context when it was not, and (3) kept
// answering `should_surface` for entries the resident tier had just dropped.
// One predicate, three callers — the drift cannot recur.
// ---------------------------------------------------------------------------

/**
 * Mirrors the SessionStart hook's ALWAYS_TYPES (knowledge-hint-broad.cjs):
 * guideline/model are RULES (resident); decision/pitfall/process are REFERENCE
 * (id + hook only, read on demand).
 */
export const ALWAYS_ACTIVE_TYPES = new Set(["models", "guidelines"]);

/** The maturity values that make an entry a settled rule rather than a proposal. */
const SETTLED_MATURITIES = new Set(["verified", "proven"]);

export type AlwaysActiveCandidate = {
  knowledge_type?: string;
  relevance_scope?: string;
  maturity?: string;
};

/**
 * Why an entry is NOT in the resident tier, in pipeline order, or `null` when it
 * IS. Callers that only need the boolean use `isAlwaysActive`; the diagnostic
 * command reports the reason.
 */
export type AlwaysActiveExclusion = "type_not_resident" | "narrow_timing" | "maturity_draft";

/**
 * F10 (review fix): an ABSENT maturity is `draft`, matching every other reader in
 * the repo (doctor-knowledge-hygiene, review-shared, review-search all use
 * `(maturity ?? "draft")`). Written as a settled-value whitelist rather than a
 * `=== "draft"` exclusion so that an INVALID on-disk value is treated the same
 * way the recall path already treats it: knowledge-meta-builder safeParses the
 * frontmatter and downgrades `Draft` / `DRAFT` / junk to undefined, i.e. draft.
 * An exclusion test would instead let those ride the resident tier as if settled.
 */
function isSettledMaturity(maturity: string | undefined): boolean {
  return SETTLED_MATURITIES.has((maturity ?? "draft").trim().toLowerCase());
}

export function alwaysActiveExclusion(candidate: AlwaysActiveCandidate): AlwaysActiveExclusion | null {
  if (!ALWAYS_ACTIVE_TYPES.has(candidate.knowledge_type ?? "")) return "type_not_resident";
  // SessionStart invariant: both sinks show BROAD only — narrow stays silent here
  // and surfaces contextually via the PreToolUse narrow hint. Absent means broad.
  if ((candidate.relevance_scope ?? "broad") === "narrow") return "narrow_timing";
  // `draft` is the unadjudicated maturity: a proposal, not a settled rule, so it
  // must not ride a tier that presents it as unconditional. Draft entries stay
  // fully reachable through fab_recall and the PreToolUse narrow hint.
  if (!isSettledMaturity(candidate.maturity)) return "maturity_draft";
  return null;
}

export function isAlwaysActive(candidate: AlwaysActiveCandidate): boolean {
  return alwaysActiveExclusion(candidate) === null;
}
