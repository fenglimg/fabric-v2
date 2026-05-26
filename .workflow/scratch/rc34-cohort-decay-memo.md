# rc.34 TASK-07 — Cohort-based Decay Evaluation Memo

**Date**: 2026-05-26
**Status**: Analysis only — no code changes in rc.34
**Decision recommendation**: **Don't implement cohort-based decay in rc.35**. Use the time to (a) gather more last_consumed_at signal density and (b) re-evaluate when the corpus passes ~50 entries spanning ≥3 months.

---

## 1. What "cohort-based decay" would mean

Current orphan_demote (rc.5 TASK-014 + rc.33 W4-B3) uses **per-maturity** thresholds:

| Maturity | `orphan_demote_*_days` (config) | Default | Semantics |
|---|---|---|---|
| stable | `orphan_demote_stable_days` | (hardcoded fallback) | inactivity days before stable → endorsed demotion |
| endorsed | `orphan_demote_endorsed_days` | (hardcoded fallback) | endorsed → draft |
| draft | `orphan_demote_draft_days` | (hardcoded fallback) | draft → demoted/archived candidate |

Decay signal = `last_consumed_at` (replay-derived from `knowledge_consumed` events).

**Cohort-based decay** would add a SECOND dimension: **time-of-ingest cohort**. Entries grouped by week/month they were proposed; older cohorts get more aggressive decay weights regardless of maturity. Conceptually: "an entry that has been around 6 months with 0 use is more clearly orphan than one that's been around 3 days with 0 use."

Two formulations possible:
- **Multiplier**: `effective_age = actual_inactive_days × cohort_weight(ingest_date)`, where weight grows with cohort age (e.g. 1.0 for ≤30d, 1.5 for 30-90d, 2.0 for 90d+)
- **Bucket override**: entries from "old" cohorts go straight to a tighter per-maturity threshold

## 2. Current Fabric corpus state (signal density)

Snapshot of `pcf/.fabric/knowledge/` (`fab doctor --json` equivalent):

| Metric | Count |
|---|---|
| Active entries | 22 |
| Archived entries | 1 |
| Pending entries | 1 |
| Distinct types | 3 (decisions / guidelines / pitfalls) |
| Mtime spread | ~16 days (2026-05-10 to 2026-05-26) |
| Distinct cohorts at week granularity | 2-3 |
| Distinct cohorts at month granularity | 1 |

**Signal density observation**: every active entry is in essentially the same cohort. The cohort dimension carries near-zero discriminating signal at current scale.

## 3. The case FOR cohort decay

| Pro | Strength | Caveat |
|---|---|---|
| Catches "old cobweb" entries that orphan_demote misses (LRU-like staleness with NO recent use signal) | Medium | last_consumed_at already proxies this — entry with no use looks orphan regardless of age. Cohort weight only changes the slope, not the direction. |
| Aligns with intuition: "old + 0 use is more suspect than new + 0 use" | Weak | But intuition can be encoded by tightening orphan_demote_*_days, not by adding a second dimension. |
| Useful in large corpora (1000+ entries spanning 2+ years) where per-maturity tuning hits diminishing returns | Strong (for future) | Not today's scale (22 entries / 16 days). |
| Distinguishes "freshly imported but untouched" (fabric-import drop) from "long-tenured but abandoned" (legitimate decay candidate) | Medium | But fabric-import-origin is already detectable via `source_sessions[0]` prefix (per fabric-review modify-flow). Could special-case fabric-import in the existing single-dimension model. |

## 4. The case AGAINST cohort decay

| Con | Strength |
|---|---|
| **Schema complexity** — adds an `ingest_cohort` derived field (or each entry needs explicit timestamp parsing on every doctor run); schema migration impact | Strong |
| **Tuning surface explosion** — instead of 3 config knobs (per-maturity), would need 3 × N-buckets = potentially 9-12 knobs; bad cognitive load | Strong |
| **Signal collision with last_consumed_at** — last_consumed_at + age-since-ingest are highly correlated for the no-use cohort (the only cohort that matters for decay decisions); adding cohort weight is double-counting | **Strong** |
| **Current corpus too small to validate** — 22 entries / 16 days mtime spread provides no statistical power to A/B cohort vs flat model | Strong |
| **Goodhart risk** — cohort weighting could optimize "demote rate" metric without actually surfacing the "right" demotions; needs ground-truth labeled set (don't have) | Medium |
| **Premature optimization** — orphan_demote per-maturity (rc.33 W4-B3) hasn't had time to demonstrate insufficiency in dogfood | **Strong** |

## 5. Counter-proposal — what to do instead

If the underlying concern is "old untouched entries", three lower-cost levers:

**A. Tighten orphan_demote_draft_days default** (currently soft / hardcoded fallback). Drafts are the "haven't been promoted, why not?" bucket; aggressive demotion is safe.

**B. Add `last_consumed_at` recency boost to fab_plan_context ranking** — instead of demoting old entries, surface fresher ones first. Reverses the lens: discoverability rather than punishment.

**C. fabric-import-origin special-case** — entries with `source_sessions[0]` starting with `fabric-import-` get tighter draft_days (e.g. 7d instead of 30d) because they're imports without explicit human curation; the user should explicitly engage within a week or they're noise.

All three are 1-line config / 1-file change. None touch schema. All testable in dogfood.

## 6. Decision (rc.35 推/不推?)

**Recommendation: DO NOT implement cohort-based decay in rc.35.** Reasons stacked:

1. **Signal collision** (con #3): cohort age and last_consumed_at carry highly overlapping information for the no-use cohort. Adding cohort weight rarely changes a demotion decision the simpler model wouldn't make.
2. **Scale insufficient** (con #4, observation §2): 22 entries / 16-day spread cannot validate a multi-cohort model.
3. **Counter-proposals are cheaper** (§5): three 1-line interventions can address the underlying concern without schema work.
4. **Goodhart risk** (con #5): without ground truth, cohort tuning risks optimizing the wrong metric.

**Threshold to revisit**: corpus passes ~50 entries spanning ≥3 months AND dogfood shows orphan_demote per-maturity has produced obvious misses (entries that "should have been demoted" but weren't). If we hit that state, run a 2-week A/B with cohort multiplier (formulation 1 in §1) against the flat model; ground-truth via manual label of ~20 candidate entries.

**Effort estimate IF we did implement (for the record)**:

- Schema: add `ingest_cohort_bucket` derived field on read (no migration; computed from existing created_at frontmatter) — **2h**
- Doctor inspect: cohort weight multiplier in `inspectOrphanDemote` — **3h**
- Config: 4-6 new knobs (`cohort_weight_30d`, `cohort_weight_90d`, etc.) — **1h**
- Tests: cohort math + threshold-crossing matrix — **4h**
- Doctor i18n: 1-2 new check messages — **1h**
- **Total: ~11h human effort.** Not trivial; reinforces the recommendation to defer.

## 7. Open questions (for future rc.35+ revisit)

- Should cohort be computed from `created_at` (proposed time) or `promoted_at` (first time it became canonical)? Plausibly the latter for stable/endorsed; the former for draft.
- Is "cohort" the right grouping, or should it be "rev-cohort" (entries created during the same RC release)? RC-cohort might align better with project rhythm.
- Could cohort weighting be folded into the existing per-maturity knobs by deriving "effective maturity" as a function of (declared maturity, cohort age) before threshold lookup? That keeps the threshold surface flat.

## 8. Cross-references

- [[rc34-tactical-lock]] — rc.34 scope decision (this memo is TASK-07 output)
- rc.5 TASK-014 — `knowledge_consumed` event + replay-derived `last_consumed_at`
- rc.33 W4-B3 — per-maturity decay thresholds (`orphan_demote_stable_days` / `orphan_demote_endorsed_days` / `orphan_demote_draft_days`)
- [[kb-candidate-pool-master]] Part A12 — telemetry on inject hit-rate (related signal; not the same problem but adjacent)
