# Semantic Check Guidance — fabric-review

LLM-assisted duplicate / contradiction / subsumption detection during `pending` mode (and on demand during `topic` mode).

> Boundary B (locked): "extraction classification / layer inference / slug naming / mode inference / **semantic dedup** → Skill (LLM); pending file write / frontmatter assembly / idempotency check / counter mgmt / layer-flip transaction / atomic promote → MCP (deterministic)"

Semantic check is the LLM's job — the MCP tool does NOT compare meaning.

## Procedure

For each pending entry to be presented:

1. Call `fab_review action="search"` with `query=<title or summary keywords>` and `filters.type=<same type>` to fetch already-canonical entries of the same type.
2. Compare semantically (LLM judgment, not string match). 三类判断均为 LLM 主观判断 dup/subsumption；具体阈值不可量化（不使用百分比 / 相似度数值伪精度）：
   - **Duplicate** — same essential claim. 标题与摘要表达同一核心结论，pending 未提供新证据或新上下文。Flag: `⚠ Possible duplicate of <stable_id>`.
   - **Contradiction** — opposing claims about the same subject. 例：一个 entry 说 "use X"，pending 说 "avoid X"，且作用域一致。Flag: `⚠ Contradicts <stable_id>`.
   - **Subsumption** — pending fully covered by an existing entry plus extras. Flag: `⚠ Subsumed by <stable_id>; consider modify-to-merge`.
3. Surface the flag in the per-item display block (see `per-mode-flows.md` pending mode step 4).
4. The user decides:
   - Still approve → flag is informational; pending becomes canonical alongside the existing entry.
   - Modify-to-harmonize → user supplies edits via `modify` action; consider merging language with the existing entry.
   - Reject as duplicate → reason field MUST cite the existing stable_id (e.g. `reason="duplicate of KT-D-7"`).

## What NOT to do

DO NOT call `AskUserQuestion` to ask "is this a duplicate?" — the LLM has already judged. The user only chooses among approve / reject / modify, which is a genuine choice.
