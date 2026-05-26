# rc.36 extended bundle — planning context

## Source

Audit-driven plan,基于 rc.35 dev cli 在 werewolf-minigame 实测:

- **EVAL-REPORT**: `.workflow/.scratchpad/rc36-werewolf-eval/EVAL-REPORT.md`
- **Evidence**: `.workflow/.scratchpad/rc36-werewolf-eval/evidence/`(doctor 全 35 check / events histogram / cite-coverage 等)
- **被测**: ~/Desktop/projects/werewolf-minigame/.fabric/ (8 天 19726 events / 49 KB entry)
- **工具**: pcf packages/cli/dist (v2.0.0-rc.35) 通过 `npm link` 全局

## 三块整合 + 吸收原推 rc.37 + Review-fix 闭环

| Block | 来源需求 | rc.36 应对 |
|---|---|---|
| A | rc.34/rc.35 残留 P0/P1 + 本次新发现 4 P0-NEW | 10 task(hook 升级 / cite 防护 / archive nudge / 文案 bug batch / **fab 残留 sweep** / funnel audit+fix) |
| B | events.jsonl 优化 | 5 task,Plan B counter 化(clean-slate)+ 5 条内禀质量门 |
| C | 测试框架硬门槛 + 砍冗余 | 7 task:fixture 仓 + 3 CI hard gate + 3 砍冗余 batch |
| D | 跨客户端模拟 | 1 task simulated cursor/codex |
| **E (新)** | **原推 rc.37 项全吸收** | **6 task:codex stream / archive-history MCP / prompt injection / MCP telemetry / cite hallucination CI / Codex CLI CI** |
| **F (新)** | **Gemini review-fix loop** | **1 task iteration cap 3,新问题 rc.36 闭环** |
| Release | - | 2 task:release-rc + memory 回灌(release 之后) |

## 关键设计决策(全 Q1-Q10 lock + surface 6 项)

1. **Branch:main**(Q1)— rc.35 同模式,lite-plan single-agent serial 不分 branch
2. **Per-task commit**(Q2)— 中文 message,`类型(rc36 TASK-NN): ...`
3. **Per-task push**(Q3)— CI 早期发现 break
4. **Error handling**(Q4)— fail 3 次阻塞 + 写 progress.md BLOCKED,不 auto-skip
5. **Review cap 3 轮**(Q5)— 3 轮未 SHIP → 阻塞等用户
6. **Review-fix 分级**(Q6)— High 必修 / Medium 走 Codex 复审(双 LLM 防偏见)/ Low 入 CHANGELOG follow-up
7. **Memory 回灌在 release 之后**(Q7)— shipped memo 需 git tag/push 事实
8. **LAUNCH-PROMPT.md 提供**(Q8)— self-contained text 给新终端 paste
9. **跨终端协作**(Q9)— progress.md 滚动追加,任一端可读最新状态
10. **状态还原 user 本机**(Q10)— rc.36 ship 后 user 操作,不在 chain

## 工程纪律(每 task 必跑)

- `pnpm -r exec tsc --noEmit`(per [[feedback-local-tsc-vs-ci-tsc]] rc.21/24/29 三次复发教训)
- `pnpm test`(包 unit + integration)
- `pnpm lint`(knip zero-baseline)
- 改 packages/shared schema 必跑 `pnpm --filter @fenglimg/fabric-shared build`(per [[feedback-shared-rebuild-on-schema-change]])
- 实施前 grep 验证 audit claim(per [[feedback-audit-verification]])
- review-fix 阶段改了代码必再跑 tsc + test(不可跳)
- NPM 2FA 模式 — 若 publish 403 "granular access token with bypass 2fa enabled" → 切换 npmjs 账号 2FA 模式,**不是 regen token**(per [[feedback-npm-publish-2fa]])

## Autonomous execution mode

新终端 paste `LAUNCH-PROMPT.md` 内容触发。Loop body:
```
while true:
  task = read_next_pending_task(plan.json, progress.md)
  if not task: break
  if all_tasks_done: enter review-fix wave
  if review_ship: enter release wave
  if review_iter == 3 and not ship: WRITE_BLOCKED + exit
  
  ATOMIC TASK:
    grep verify audit claim
    implement
    tsc + test + lint
    if shared schema changed: pnpm --filter shared build
    commit (中文 message)
    push
    append progress.md "TASK-NN DONE @ ISO"
    if fail_count >= 3 for this task: WRITE_BLOCKED + exit
```

## Out-of-scope(真做不了,物理约束)

| 项 | 物理约束 |
|---|---|
| X5 Counterfactual ROI A/B | 需外部真人用户 A/B test |
| S6 KB cohort 月级衰减 | 需 30 天滚动观测 |
| A3×B3×C2+C3 真人长期感知 | 需外部 dogfood 周期 |

仅 3 项,**所有可技术解决的全部吸收 rc.36**。

## Sizing

| Sizing | Tasks | Hours |
|---|---|---|
| **extended (lock)** | **32** | **~66** |

## Surface 6 项确认

1. **rc.35 npm publish 状态在 TASK-00**:本地可跑;若 2FA OTP 需用户输 → 阻塞等
2. **改 shared schema 必 rebuild dist**:TASK-12 + TASK-29 都触发,task desc 已 explicit
3. **release 前 tsc --noEmit**:/release-rc skill 包,TASK-32 review-fix 改代码后必再跑
4. **NPM 2FA 模式**:见工程纪律
5. **TASK-32 实际 task 数动态**:1 review run + N fix(N: 0-10),plan 写估时中位 360min
6. **TASK-10 升级 audit+fix**:不只产 memo,诊断 selectable 后立即写 fix
