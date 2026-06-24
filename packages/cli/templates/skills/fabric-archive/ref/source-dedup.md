# Phase 3 — LLM-Driven Dedup vs Canonical (ref)

> **Loaded on demand.** SKILL.md hot path retains the Phase 3 purpose statement + 4-step outline + completion sentinel. This file holds the full Step 3.1/3.2/3.3/3.4 MCP call shapes, semantic compare 5-way classification, and the underseed sentinel rationale.

For each pending entry created in Phase 2 (read from `p2_processed_commits[].pending_path` and `p2_processed_docs[].pending_paths`), check if it duplicates / contradicts / is subsumed by an existing canonical entry. **Semantic comparison is the LLM's job — `fab_review` does not compare meaning.**

## Step 3.1 — Search Canonical of Same Type

For each just-proposed pending entry (read its frontmatter via the `Read` tool to get type + slug + title):

```ts
mcp__fabric__fab_review({
  action: "search",
  query: "<title or summary keywords from the pending entry>",
  filters: { type: "<same type as pending>" }
})
```

The server returns ranked `items[]` of CANONICAL entries (not pending) of the same type. Cap the comparison set at the top 5 results.

## Step 3.2 — Semantic Compare

For each `(pending, canonical)` pair the LLM judges:

- **Duplicate** — same essential claim. LLM 主观判断：标题与摘要表达同一核心结论，新 pending 未提供新证据。具体阈值不可量化。Action: **reject** the new pending.
- **Subsumption** (pending narrower) — canonical fully covers the pending plus more. Action: **reject** the new pending (canonical already serves).
- **Subsumption-with-novelty** (pending adds evidence) — canonical covers the claim but the new pending brings new evidence (commit sha, file paths). Action: **modify** the canonical to merge in the new evidence; **reject** the new pending citing the modified canonical.
- **Contradiction** — opposing claims about the same scope. Action: leave pending; flag for user via roll-up. The user must decide via `fabric-review` later — `archive source mode` does NOT auto-resolve contradictions.
- **Genuinely new** — no canonical match. Action: leave pending in place (will surface in next `fabric-review` run for normal approval flow).

## Step 3.3 — Issue Dedup MCP Calls

For each `reject`-classified pending:

```ts
mcp__fabric__fab_review({
  action: "reject",
  pending_paths: ["<the new pending path>"],
  reason: "duplicate of <stable_id of canonical>"   // OR "subsumed by <stable_id>"
})
```

For each `subsumption-with-novelty` case (modify canonical, then reject pending):

```ts
// Step A: merge new evidence into canonical
mcp__fabric__fab_review({
  action: "modify",
  pending_path: "<canonical's pending_path-style relative path>",
  changes: { summary: "<merged summary; original + new evidence cite>" }
})

// Step B: reject the now-superseded pending
mcp__fabric__fab_review({
  action: "reject",
  pending_paths: ["<the new pending path>"],
  reason: "merged into <stable_id of modified canonical>"
})
```

Append to `.fabric/.import-state.json` after EACH successful MCP call:

- `p3_dedup_completed[].push({pending_path: <new pending>, action: "reject" | "modify-then-reject" | "kept", canonical_ref: "<stable_id>" | null})`
- `last_checkpoint_at = <ISO8601 now>`

## Step 3.4 — Phase 3 Completion

After all Phase 2 outputs are dedup-reviewed:

- Update `.fabric/.import-state.json`: `phase = "complete"`, `last_checkpoint_at = <ISO8601 now>`, `final_summary = {proposed: N, kept: K, rejected_dup: R, merged: M, contradictions_flagged: C}`.
- Render the final roll-up to the user (see Output Contract — see `ref/source-output-contract.md`).

> Setting `phase = "complete"` in `.fabric/.import-state.json` is enough to silence the SessionStart underseed self-check banner (`shouldRecommendImport()` returns false for any non-`absent` state). 无需额外清理 sentinel 文件 — 该机制已在 rc.8 下线。

The user MAY manually delete `.fabric/.import-state.json` to reset, or the skill MAY offer a one-line "reset state and re-run from scratch?" prompt the next time it is invoked with `phase="complete"` already present.
