# Output Contract (ref)

> **Loaded on demand.** SKILL.md hot path mentions the roll-up requirement + section names. This file holds the full bilingual roll-up templates rendered after Phase 3 completes (or on any phase exit due to cap / error / interrupt).

UX i18n Policy class 1 — render either the en variant or the zh-CN variant per `fabric_language`; the protected tokens (`relevance_scope`, `relevance_paths`, `broad`, `pending_path`, `layer`, `team`, `personal`, `fab_review`, `.fabric/.import-state.json`, etc.) appear verbatim in BOTH variants.

## en variant (`fabric_language === "en"`)

```md
# Import Summary — phase=<P1-done | P2-done | complete>

## Phase 2 — Mining
- Commits scanned: <N>     (skipped: <S> — cosmetic/metadata/baseline-overlap)
- Docs scanned:    <D>     (skipped: <DS> — README/CHANGELOG/boilerplate)
- Pending proposed: <P>     (cap_reached: <true|false>)
- Scope: all <P> proposed entries use relevance_scope=broad, relevance_paths=[] (fabric-import contract).

## Phase 3 — Dedup
- Kept (genuinely new):       <K>
- Rejected (duplicate):       <RD>
- Modified-then-rejected:     <MR>     (canonical entries enriched: <list of stable_ids>)
- Contradictions flagged:     <C>     (require manual fabric-review)

## State
- .fabric/.import-state.json phase: <phase>
- last_checkpoint_at: <ISO8601>
- Re-invoke to continue if phase != complete.

## Next Steps
- Run `fabric-review` to approve the <K> kept pending entries.
- Resolve <C> contradictions manually if any.
- If any kept entry is actually narrow-scoped, narrow it via `fab_review action="modify"` with `changes.relevance_scope="narrow"` + `changes.relevance_paths=[...]` (this skill cannot narrow — see Mandatory Scope Rule in Phase 2).
```

## zh-CN variant (`fabric_language === "zh-CN"`)

```md
# Import 汇总 — phase=<P1-done | P2-done | complete>

## Phase 2 — 挖掘
- 扫描 commit 数: <N>      (跳过: <S> — cosmetic/metadata/与 baseline 重叠)
- 扫描文档数:    <D>      (跳过: <DS> — README/CHANGELOG/样板文件)
- 提议 pending:  <P>      (cap_reached: <true|false>)
- 作用域: 全部 <P> 条提议使用 relevance_scope=broad, relevance_paths=[] (fabric-import 契约)。

## Phase 3 — 去重
- 保留 (新知识):              <K>
- 已驳回 (重复):              <RD>
- 修改后驳回:                 <MR>     (被合入 evidence 的 canonical 条目: <stable_ids 列表>)
- 已标记冲突:                 <C>     (需手动通过 fabric-review 解决)

## 状态
- .fabric/.import-state.json phase: <phase>
- last_checkpoint_at: <ISO8601>
- 如 phase != complete, 请重新调用 fabric-import 续作。

## 下一步
- 运行 `fabric-review` 审批 <K> 条新 pending。
- 手动解决 <C> 条 contradictions 标记 (如有)。
- 若某条 kept 条目实际是 narrow-scoped, 通过 `fab_review action="modify"` 配 `changes.relevance_scope="narrow"` + `changes.relevance_paths=[...]` 收窄 (本 skill 无法收窄 — 见 Phase 2 Mandatory Scope Rule)。
```
