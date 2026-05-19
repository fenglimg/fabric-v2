# TASK-08: fabric-archive SKILL.md — E5 周期触发 appendix (/loop + OS cron samples)

## Changes
- `packages/cli/templates/skills/fabric-archive/SKILL.md`: appended H2 section `## E5 周期触发 (Scheduled Daily Recap)` at EOF (after existing 'Worked Examples' Example 3) with 6 subsections + NOT in scope bullet.

## Verification
- [x] Criterion 1 — SKILL.md contains exact string `## E5 周期触发`: matched at line 1259.
- [x] Criterion 2 — SKILL.md contains `/loop /fabric-archive 今日复盘`: matched at line 1270.
- [x] Criterion 3 — SKILL.md contains `0 23 * * *` cron pattern: matched at line 1270 (/loop sample) and 1279 (OS cron sample).
- [x] Criterion 4 — Trade-off table with both /loop and OS cron columns: present in `### Trade-off table (/loop vs OS cron)` subsection with 4 rows (鉴权/跨平台/Token 成本/调试).
- [x] Criterion 5 — `今日复盘` recognized as magic phrase: line 1293 documents Phase -0.5 magic phrase contract.
- [x] Criterion 6 — `fab CLI does NOT provide a cron helper` present: line 1313 NOT-in-scope bullet.
- [x] Criterion 7 — Commit msg format: `docs(rc25): fabric-archive E5 周期触发 appendix (TASK-08)`.

## Tests
- None (documentation-only task; no `test.commands` defined).

## Deviations
- None.

## Notes
- Insertion point was after Example 3 (line 1257) — confirmed by `wc -l` returning 1257 before edit. Appendix added 60 lines (file now 1317 lines).
- Did NOT modify Phase -0.5, Phase 0.0 step 4.5, Phase 0.4 Trigger Gate, Phase 0.5 gate-FAIL branching, or Phase 2.5 — these landed in Wave 2 tasks and are referenced (not duplicated) in the E5 appendix.
- The appendix references Q3.1 入口集 and cli-design 原则 from planning-context.md as design rationale for the "no cron helper" decision.
