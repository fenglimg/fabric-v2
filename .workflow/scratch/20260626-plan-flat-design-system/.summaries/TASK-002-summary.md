# TASK-002: Wave2 G1+G6 — 收尾文案全过 t() + 总结卡 B-横线标题 + 单一「下一步 →」锚点

Commit: `0f2cf08`(branch `feat/cli-flat-design-system`)

## Changes
- `packages/shared/src/i18n/locales/en.ts`: 新增 `cli.summary.done`='Done!' / `cli.summary.all-ok`='All steps completed successfully' / `cli.summary.n-failed`='{count} step(s) failed' / `cli.summary.n-of-total`='{done}/{total} steps completed' / `cli.summary.count.succeeded`·`.skipped`·`.failed`='succeeded'·'skipped'·'failed' / `cli.install.next-step.anchor`='Next → {action}'。
- `packages/shared/src/i18n/locales/zh-CN.ts`: 同 8 个 key 的 zh-CN 值(完成! / 全部步骤已完成 / {count} 个步骤失败 / {done}/{total} 步已完成 / 成功·跳过·失败 / 下一步 → {action})。
- `packages/cli/src/tui/ConsoleOutputRenderer.ts`: import `t`;`renderComplete` → `t('cli.summary.done')`;`buildSummaryBlock` 三个计数 cell + summaryLine 三分支全改 `t()`;`renderSummaryCard` 标题从 `sectionBar(summary.title)` 切到 `headerRule(summary.title)`(TASK-001 B-横线原语)。
- `packages/cli/src/install/pipeline/guidance.stage.ts`: 默认收尾打单行 `cli.install.next-step.anchor`(action 取既有 `cli.install.next-step.message`);多行 `cli.install.next-steps` + `guidance.more` 收进 `context.args.verbose === true` 分支。
- 测试:`install-renderer-reskin.test.ts` 两个 summary 断言改为 `t()` key(去掉英文字面量与 locale-依赖快照);同步删 2 个 obsolete 快照;`install-v2-pipeline.test.ts` 的 footer 断言从 "Next steps" 改为 "Next →"(匹配新单锚点)。

## Verification(逐 convergence 标准)
- [x] C1 renderer 无 `All steps completed successfully` 字面量 — `grep -F` 返回空。
- [x] C2 renderer 无 `Done!` 字面量 — `grep -F` 返回空。
- [x] C3 buildSummaryBlock 计数 cell 是 `t()` 调用,无英文 `succeeded/skipped/failed` 字面量 — grep 仅命中 doc 注释行(`* ✓ N succeeded …`)与变量名 `skippedCount`/`errorCount`,非 cell 文案。
- [x] C4 en.ts AND zh-CN.ts 均定义 `cli.summary.done`/`.all-ok`/`.count.succeeded`/`.count.skipped`/`.count.failed`(+`.n-failed`/`.n-of-total`/`next-step.anchor`)— 8/8 双库 grep 全 [ok]。
- [x] C5 renderSummaryCard 用 `headerRule(summary.title)` 非 sectionBar — grep 命中 `112: this.write(headerRule(summary.title));`。
- [x] C6 guidance 打单一 `cli.install.next-step.anchor`,多行列表 --verbose-gated;en+zh-CN 均定义该 key。
- [x] C7 [UI-observable] zh-CN locale 下 createTranslator('zh-CN') 实跑:summary 全中文(完成! / 全部步骤已完成 / 成功·跳过·失败 / 2 个步骤失败),收尾单行 `下一步 → 运行 fabric install --reapply --yes …`,无 stray 'succeeded'/'Done!'。
- [x] C8 `pnpm --filter @fenglimg/fabric-shared test` exit 0 — 53 files / 635 tests passed(含 locale-parity)。
- [x] C9 `pnpm -r exec tsc --noEmit` exit 0;`pnpm --filter @fenglimg/fabric-cli test` 121 files / 1198 tests passed。

## Tests
- [x] `pnpm --filter @fenglimg/fabric-shared build`(locale 改动需 rebuild dist,见 MEMORY)→ success。
- [x] `pnpm --filter @fenglimg/fabric-shared test` → 635/635 passed。
- [x] `pnpm -r exec tsc --noEmit` → exit 0。
- [x] `pnpm --filter @fenglimg/fabric-cli test` → 1198/1198 passed(初次跑 1 个 `install-v2-pipeline` 因 footer 文案改动失败,已对齐断言后全绿)。

## Deviations
- `cli.summary.n-failed` 用 `{count} step(s) failed` 的 `(s)` 形式取代原代码的 `step${n>1?'s':''}` 运行时复数;i18n 模板不便表达条件复数,这是常见简化(zh-CN 无复数问题)。原 reskin 测试断言 `"1 step failed"` 已改为 `t('cli.summary.n-failed',{count:'1'})`。
- summary-block 的两个快照断言被移除(locale 由 machine-wide `~/.fabric/fabric-global.json` language 决定,本机为 zh-CN、CI 为 en,快照会跨环境漂移);改为对 active-locale `t()` 值断言,locale-agnostic。step/error 块快照(与 locale 无关)保留。
- `install-v2-pipeline.test.ts` footer 断言从 "Next steps"(旧多行标题)改为 "Next →"(新单锚点),属 G6 行为变更的必要连带更新。

## Notes(供下一任务)
- 总结卡现已用 `headerRule`;`ConsoleOutputRenderer.renderSection` 仍用 `sectionBar`(后续 Wave 若要 section 也切 B-横线再处理)。
- `cli.install.next-step.anchor` 已就位,uninstall 套总结卡(G3,后续 Wave)可复用同一锚点 key + headerRule。
- 工作区另有 2 个**与本任务无关**的预存在未提交改动未纳入本 commit:`packages/cli/__tests__/i18n-project-commands.test.ts` 与 `packages/shared/src/store/global-config-io.ts`(后者为 test-runtime FABRIC_HOME fail-closed 守护,正是它让 cli 测试在隔离 home 下以 en 跑)。已显式不 stage。
