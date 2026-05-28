# Worked Examples (ref)

> **Loaded on demand.** SKILL.md hot path points here for concrete end-to-end traces. These 4 examples illustrate Phase 2 mining (git + docs), Phase 3 dedup classification, and the out-of-band narrowing path that is NOT performed by this skill.

## Example A — Phase 2 git mining: feat commit → pitfall entry

Source signal: `git log` surfaces commit `50367b5` with subject `feat(server): add custom retry logic` and body explaining that initial implementation retried without exponential backoff, causing a thundering-herd outage during a brief upstream hiccup; the fix was jittered exponential backoff with a 30s ceiling.

LLM analysis: this is a **pitfall** (a non-obvious trap that wasted time and is repeatable across services). The body itself documents the trap. Slug candidates: `retry-without-backoff-thundering-herd` (5 words, 38 chars — passes 5 rules).

Skill output (note `relevance_scope: "broad"` + `relevance_paths: []` — mandatory for fabric-import):

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["fabric-import-2026-05-10"],
  recent_paths: ["packages/server/src/lib/retry.ts"],     // provenance only
  user_messages_summary: "重试无指数退避会在短暂上游故障下放大成雪崩。修正：jittered exponential backoff，30 秒上限。src=50367b5",
  type: "pitfalls",
  slug: "retry-without-backoff-thundering-herd",
  relevance_scope: "broad",                                // MANDATORY
  relevance_paths: [],                                     // MANDATORY — do NOT infer ["packages/server/src/lib/retry.ts"]
  proposed_reason: "diagnostic-then-fix",                  // Step 2.1.5: body describes long diagnostic chain (no-backoff → thundering-herd outage → root cause) → root-cause fix; this overrides the `feat(` prefix per the "body content wins over prefix" ambiguity rule.
  session_context: "Imported from git log analysis. Origin: commit 50367b5 (feat(server): add custom retry logic). No live session — see commit body for full context."
})
```

Counter-example — DO NOT do this:

```ts
// WRONG — this skill must never produce narrow + paths from git metadata.
// The retry pitfall applies to every retry site, not just the file touched by 50367b5.
mcp__fabric__fab_extract_knowledge({
  // ...
  relevance_scope: "narrow",                                // VIOLATION
  relevance_paths: ["packages/server/src/lib/retry.ts"]     // VIOLATION
})
```

If the user later judges this pitfall to be narrow-scoped, they (via `fabric-review`) issue `fab_review action="modify"` with `changes.relevance_scope` + `changes.relevance_paths` — that is the legal narrowing path.

State file delta:
```json
{ "p2_processed_commits": [
    { "sha": "50367b5...", "skipped": false,
      "pending_path": "knowledge/pending/pitfalls/retry-without-backoff-thundering-herd.md",
      "type": "pitfalls", "slug": "retry-without-backoff-thundering-herd" }
  ]
}
```

## Example B — Phase 2 doc mining: architecture.md → decision entry

Source signal: `docs/architecture.md` contains a section heading "## Why a monolith?" with body explaining the team chose monolith over microservices because the 3-engineer team couldn't justify the operational cost of multi-service deploys, and the dominant performance constraint (DB throughput) doesn't benefit from horizontal split.

LLM analysis: this is a **decision** (≥2 alternatives weighed — monolith vs microservices — with explicit rationale). Slug candidates: `monolith-over-microservices-small-team` (5 words, 38 chars — passes 5 rules).

Skill output (broad+[] mandatory; the doc's own path stays in `recent_paths` for provenance, NOT in `relevance_paths`):

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["fabric-import-2026-05-10"],
  recent_paths: ["docs/architecture.md"],                  // provenance only
  user_messages_summary: "选择单体架构而非微服务：3 人团队无法承担多服务运维成本，且主要性能瓶颈在 DB 吞吐而非应用层水平扩展。src=docs/architecture.md",
  type: "decisions",
  slug: "monolith-over-microservices-small-team",
  relevance_scope: "broad",                                // MANDATORY
  relevance_paths: []                                      // MANDATORY — a monolith-vs-microservices decision applies repo-wide, not only to docs/
})
```

## Example C — Phase 3 dedup finds duplicate, rejects

After Example A's pending entry (`retry-without-backoff-thundering-herd`) is proposed, Phase 3 runs:

```ts
mcp__fabric__fab_review({
  action: "search",
  query: "retry backoff thundering herd",
  filters: { type: "pitfalls" }
})
```

Server returns 1 canonical match: `KT-P-0007--retry-no-jitter-amplification.md` with summary "重试缺少 jitter 在并发场景放大原始故障峰值". LLM judgment: the existing canonical asserts the same essential claim (retry without jitter amplifies failures) — this is a **duplicate**, not subsumption-with-novelty (the new pending offers no new evidence beyond restating the trap).

Skill output:

```ts
mcp__fabric__fab_review({
  action: "reject",
  pending_paths: ["knowledge/pending/pitfalls/retry-without-backoff-thundering-herd.md"],
  reason: "duplicate of KT-P-0007"
})
```

State file delta:
```json
{ "p3_dedup_completed": [
    { "pending_path": "knowledge/pending/pitfalls/retry-without-backoff-thundering-herd.md",
      "action": "reject", "canonical_ref": "KT-P-0007" }
  ]
}
```

Final roll-up to user reflects: 1 proposed, 0 kept, 1 rejected_dup, 0 merged, 0 contradictions.

## Example D — Post-import narrowing (out-of-band, NOT this skill)

This example documents the legal narrowing path; it is NOT performed by `fabric-import` itself. After Example B's `monolith-over-microservices-small-team` decision is imported (with `relevance_scope=broad`, `relevance_paths=[]`) and later approved into canonical via `fabric-review`, the user decides the decision is actually narrow to the server package's deploy tooling.

The user issues (via `fabric-review`, NOT via this skill):

```ts
mcp__fabric__fab_review({
  action: "modify",
  pending_path: "knowledge/team/decisions/monolith-over-microservices-small-team.md",
  changes: {
    relevance_scope: "narrow",
    relevance_paths: ["packages/server/**", "scripts/deploy/**"]
  }
})
```

Key invariants of this flow:

- The narrowing decision originates from the **user**, informed by the actual paths they propose — not from `fabric-import` inferring paths from git metadata.
- The modify call goes through `fab_review`, not `fab_extract_knowledge`, because the entry already exists (post-import or post-approval).
- If the user later flips the entry's layer from `team` to `personal`, server-side auto-degrades scope back to `broad` and clears `relevance_paths` (see rc.5 C3 acceptance criterion; personal knowledge crosses projects so paths don't generalize). This is the only legal way for `relevance_paths` to be re-cleared.
