# rc.35 Gemini Batch Review — prompt + invocation

Memory [[feedback_review_batching.md]]: multi-task lite-plan 链路末尾**一次**
Gemini review,不 per-task。范围:13 commit / 14 file 改动 / 7 个新 test。

## Invocation (copy-paste 到 shell)

```bash
maestro delegate "PURPOSE: rc.35 werewolf-eval-bundle 一次性 review,SHIP/NO-SHIP 决策 + High/Medium/Low 分级问题清单。
TASK: 1) review commit chain rc35 TASK-01..TASK-12 一致性 (反向 sweep 不留 fab 残留 / clean-slate 完整性) | 2) 验证 P0-2 cite infrastructure wire-up 不引入 race / append 原子性正确 | 3) 验证 TASK-09 ZodError 人话化没漏报错误细节 | 4) 验证 TASK-11 BOOTSTRAP_CANONICAL 改后 markmig + L1 drift lint 仍工作 | 5) 验证 TASK-12 audience tag 不破坏 doctor JSON output schema
MODE: analysis
CONTEXT: @packages/**/*.ts @packages/**/*.cjs @docs/**/*.md @CHANGELOG.md | Memory: rc.35 14 file / 13 commit / 7 new tests; W6 dogfood evidence at .workflow/.scratchpad/rc35-closure/evidence/
EXPECTED: 1) verdict SHIP/NO-SHIP/CONDITIONAL | 2) High/Medium/Low 问题清单含 file:line | 3) 反向 sweep 残留扫描 (\`fab \`/(\`bin\`/fab_*) | 4) typecheck/test gate 健康状态评估 | 5) 推送前必须修 vs 可 defer 的分界
CONSTRAINTS: 范围限 rc.35 13 commit (git log --oneline -13 HEAD);不评论 rc.34 及之前历史;不要求 100% audit 覆盖 (此前 7-batch 已 done)
" --to gemini --mode analysis --rule analysis-review-code-quality --cd "/Users/wepie/Desktop/personal-projects/pcf"
```

## Expected output shape

```
RC.35 BATCH REVIEW

Verdict: SHIP | NO-SHIP | CONDITIONAL (with conditions)

High:
- [file:line] ...
Medium:
- ...
Low:
- ...

Sweep residue scan:
- `fab ` occurrences outside CHANGELOG history: <count>
- `fab_*` MCP prefix occurrences (expected-defer): <count>
- `fab:rule-id` HTML marker (expected-defer): <count>

Gates summary:
- typecheck: 0 errors
- cli tests: 727/727
- server tests: 643/644 (1 skipped)
- shared tests: 430/430

Ship gate:
- [ ] Sweep residue per spec
- [ ] Tests pass
- [ ] No High severity issues unaddressed
- [ ] dogfood evidence collected
```

## After Gemini

1. 如果 SHIP/CONDITIONAL with addressable conditions → 修 → 重跑 typecheck/test → push
2. 如果 NO-SHIP → 评估问题严重度,决定 rc.35.1 hotfix 还是滚回部分 task
