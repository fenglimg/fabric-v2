# rc.36 Autonomous Execution — Launch Prompt

**用途**:你(用户)在新终端开 Claude Code,把下面整段(从 `## PASTE START` 到 `## PASTE END`)复制粘贴进去,Claude 即按 plan.json autonomous 跑 rc.36 全程。

---

## PASTE START

我是新开的终端,接管 rc.36 autonomous 执行任务。

**Working directory**: `/Users/wepie/Desktop/personal-projects/pcf`
**Plan**: `.workflow/.lite-plan/rc36-extended-bundle-2026-05-26/plan.json`
**Progress**: `.workflow/.lite-plan/rc36-extended-bundle-2026-05-26/progress.md`
**Audit source**: `.workflow/.scratchpad/rc36-werewolf-eval/EVAL-REPORT.md`

## 你要做的事

按 plan.json 32 task / 12 wave 顺序 autonomous 执行,直到全 done 或 BLOCKED。

### 执行 loop(伪码)

```
while True:
    1. Read progress.md → 找下一个 PENDING task (按 wave + task_ids 顺序)
    2. 没有 PENDING:
        - 若 Wave 10 review-fix 未跑 → 跑 review-fix loop
        - 若 review SHIP + Wave 11 release 未跑 → 跑 release
        - 若 全 DONE → 写完成 summary,退出
    3. 标 task IN-PROGRESS,执行:
        a. read plan.json 对应 task 的 what / why / acceptance
        b. grep 验证 audit claim (per [[feedback-audit-verification]],rc.27 5 项被驳回教训)
        c. 实施(主线 Edit/Write/Bash,不 spawn Agent per [[feedback-low-agent-spawn-cost]])
        d. 跑 gate: `pnpm -r exec tsc --noEmit && pnpm test --filter 受影响包 && pnpm lint`
        e. 若改 packages/shared schema: `pnpm --filter @fenglimg/fabric-shared build`
        f. git add -A
        g. git commit -m "类型(rc36 TASK-NN): 简短描述"
           - 类型: feat/fix/refactor/docs/test/chore/audit/infra
           - 中文 message
        h. git push origin main
        i. 在 progress.md "Execution log" 追加:`[YYYY-MM-DD HH:MM] TASK-NN DONE  (M min)  commit:SHA`
        j. 标 task DONE
    4. 失败处理:
        - tsc/test/lint fail: 修一次 → 再跑 → 仍 fail 计 FAIL-N
        - FAIL-3: 写 progress.md BLOCKED + last_3_attempts 摘要 + 退出 (等用户介入)
```

### 关键工程纪律

**必须遵守(违反 = 历史复发风险):**

1. **`pnpm -r exec tsc --noEmit` 每 task 必跑** — rc.21/24/29 三次复发([[feedback-local-tsc-vs-ci-tsc]])
2. **改 `packages/shared/src/schemas/` 必跑 `pnpm --filter @fenglimg/fabric-shared build`** — [[feedback-shared-rebuild-on-schema-change]]
3. **per-task commit + push** — 不积累,CI 早期发现 break
4. **不 spawn Claude Agent** — 全部主线 Bash/Edit/Write 串行,per [[feedback-low-agent-spawn-cost]]
5. **NPM 2FA 模式问题** — release 若 403 "granular access token with bypass 2fa enabled" → 告诉用户切换 npmjs 2FA 模式,**不 regen token** ([[feedback-npm-publish-2fa]])
6. **grep 先验证 audit claim** — 不盲信 EVAL-REPORT 描述([[feedback-audit-verification]])

### Wave 10 review-fix loop(特殊)

```
iter = 0
while iter < 3:
    iter += 1
    1. maestro delegate "PURPOSE: rc.36 全 chain code review. TASK: SHIP/NO-SHIP/CONDITIONAL verdict + High/Medium/Low 问题清单 file:line. MODE: analysis. CONTEXT: @packages/**/*.ts @templates/**/* @docs/**/*.md @CHANGELOG.md | Memory: rc.36 32 task / commit range HEAD..70cbd23. EXPECTED: verdict + 分级清单. CONSTRAINTS: 范围限 rc.36 commit range" \
        --to gemini --model gemini-3.1-pro-preview \
        --mode analysis --rule analysis-review-code-quality \
        --cd /Users/wepie/Desktop/personal-projects/pcf
        --id rc36-review-iter-${iter}
    2. 等 callback (run_in_background: true,callback 自带结果)
    3. parse output 落 .workflow/.scratchpad/rc36-closure/gemini-review-iter-${iter}.md
    4. 若 verdict == SHIP: break
    5. 否则:
        - High 类问题:每条独立修 → tsc + test + lint + commit + push
        - Medium 类:maestro delegate to codex --model gpt-5.5 复审单条,codex SHIP 则跳过,否则修
        - Low 类:collect 到 CHANGELOG rc.36 follow-up 段(commit)
    6. 续 loop
if iter == 3 and verdict != SHIP:
    write progress.md "REVIEW-BLOCKED @ ISO ..." + 退出
```

### Wave 11 release

调用 `/release-rc` skill 跑标准 release。该 skill 包:
- bump 所有 workspace 到 2.0.0-rc.36
- version-sync 验证
- `pnpm -r exec tsc --noEmit`
- commit + tag v2.0.0-rc.36 + push
- CI watch
- Release workflow npm publish 监控

skill 跑完后 TASK-25 memory 回灌(3 条新 memo + MEMORY.md index +3 行)。

### TASK-00 注意

rc.35 npm publish 状态确认。若 npm 仍 rc.34,需手动 trigger release.yml on tag v2.0.0-rc.35。若卡 2FA OTP 输入,**立即标 BLOCKED + 告诉用户**,不强行重试。

### 完成标准(全部满足 = exit 成功)

- [ ] plan.json 32 task 全 DONE in progress.md
- [ ] Wave 10 review verdict == SHIP
- [ ] Wave 11 release CI ✅ + npm publish ✅
- [ ] TASK-25 3 条 memo + MEMORY.md +3 行
- [ ] git log --oneline 上有 v2.0.0-rc.36 tag

## 即刻开始

1. 读 `.workflow/.lite-plan/rc36-extended-bundle-2026-05-26/plan.json` 全文
2. 读 `.workflow/.lite-plan/rc36-extended-bundle-2026-05-26/planning-context.md`
3. 读 `.workflow/.lite-plan/rc36-extended-bundle-2026-05-26/progress.md` 找下一个 PENDING
4. 开始 loop

不要回复"明白了"或类似 metadata 文本,直接 act on task list。

## PASTE END

---

## 跨终端协作约定

- **本终端(plan 创建者)**:不动 plan.json / progress.md,只在新终端阻塞时介入
- **新终端(executor)**:append-only 写 progress.md execution log,出错写 blocker
- **冲突处理**:两个终端同时改同一文件不会发生 — 新终端写 progress.md execution log,本终端只读

## 紧急停止

若需要在中途停掉新终端:
- `Ctrl+C` 或 直接关终端
- 状态保留在 progress.md(最后一条 IN-PROGRESS 的 task 可能 partial commit)
- 用户检查 git log 是否有半完成的 partial commit,必要时 reset --soft 重做

## 重启续作

新终端重启 paste 同样 prompt 即可。executor 会:
- 读 progress.md 找最近的 PENDING(跳过 DONE)
- IN-PROGRESS 状态的 task 若 git log 有 partial commit → 用户介入或手动 reset
- BLOCKED 状态用户必须先 unblock
