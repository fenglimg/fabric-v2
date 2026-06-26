# TASK-006: Wave5 G3 uninstall — 套 B-横线总结卡 + 人话化(去黑话 bootstrap=是 / 去裸计数 removed=N)

Commit: `33994cc`(branch `feat/cli-flat-design-system`)

## Changes
- `packages/cli/src/commands/uninstall.ts`:
  - `printUninstallPlanSummary`(~1019):删 `cli.uninstall.plan.actions` 的 `yesNoLabel(...)` key=值行;改为按启用阶段逐条人话动作句 —— 启用列在 `将移除:` 下、未选(muted)列在 `将保留:` 下,遍历 `UNINSTALL_WIZARD_KEYS` + `cli.uninstall.plan.action.{key}`。StageName 路由键保持英文,只换 DISPLAY 文案。
  - `buildUninstallSummaryCard`(~959):明细 `value` 从裸 `cli.uninstall.stages.summary`(removed=/skipped=/errors=)改为结果词 —— ran 且有清理→`cli.uninstall.stage.cleaned-count`、ran 但无清理→`cli.uninstall.stage.already-clean`、有错→`cli.uninstall.stages.completed-with-errors`、skipped→`cli.shared.skipped`。与 install 明细行(`{count} installed` / `up to date`)对称。
  - `renderStageResult`(~865):per-stage step detail 同步去裸计数,改 `cleaned-count` / `uptodate` / `completed-with-errors`。
  - 删除已无引用的 `yesNoLabel` helper。
  - 总结卡标题不动 —— 已通过 TASK-002 的共享 `createInstallRenderer → renderSummaryCard → headerRule`(B-横线)渲染。
  - TASK-004 的 `promptReceipt`(multiselect 选中回执 / confirm No·取消的红 x 回执)完全保留未动。
- `packages/shared/src/i18n/locales/en.ts` + `zh-CN.ts`:新增双 locale 对齐键 ——
  `cli.uninstall.plan.will-remove` / `.will-keep` / `.action.{bootstrap,mcp,scaffold,store}`(人话动作句)+
  `cli.uninstall.stage.cleaned-count`(`{count} cleaned` / `已清理 {count} 项`)/ `cli.uninstall.stage.already-clean`(`already clean` / `已是干净`)。

## Verification(逐 convergence 标准 + 证据)
- [x] **C1** printUninstallPlanSummary 不再用 yesNoLabel 渲染 `bootstrap=…` —— grep 源码:`plan.actions`/`yesNoLabel` 已不存在,`bootstrap=` 仅命中一行注释;新增 `will-remove`/`will-keep` + `plan.action.${key}` 路径。
- [x] **C2** buildUninstallSummaryCard ran-stage value 用 `cli.uninstall.stage.cleaned-count` / `already-clean`,非 `cli.uninstall.stages.summary` —— sed+grep 确认。
- [x] **C3** en.ts AND zh-CN.ts 均定义 `cli.uninstall.stage.cleaned-count` + `.already-clean`(各 1 命中)+ 4 个 `plan.action.*` + 2 个 `plan.will-*` —— 双库 grep 全 [ok]。
- [x] **C4** 总结卡标题走共享 renderer 的 B-横线 —— `ConsoleOutputRenderer.ts:146 this.write(headerRule(summary.title))`,uninstall 仅调 `renderer.renderSummaryCard(...)`(926/933),无自绘 `│` 沟槽。
- [x] **C5** [UI-observable] dry-run 计划预览:zh-CN `将移除: - 客户端技能与 hook 脚本 / - MCP 服务注册 / - 项目脚手架文件;将保留: - 团队 store 绑定(本项目)`;en 同结构 —— 实跑 createTranslator 双 locale 确认,无 `bootstrap=是 mcp=是 scaffold=是 store=否`。
- [x] **C6** [UI-observable] 真卸载总结卡:`已清理 129 项` / `已是干净` / `已跳过`(en:`129 cleaned` / `already clean` / `Skipped`)—— 实跑确认,无 `removed=129 skipped=16`。
- [x] **C7** `pnpm --filter @fenglimg/fabric-shared test` 635 passed(locale parity 绿)&& `pnpm --filter @fenglimg/fabric-cli test` 1203 passed && `pnpm -r exec tsc --noEmit` exit 0。

## Tests
- [x] `pnpm --filter @fenglimg/fabric-shared build`(locale 改动需 rebuild dist,见 MEMORY)→ success。
- [x] `pnpm --filter @fenglimg/fabric-shared test` → 53 files / 635 passed。
- [x] `pnpm --filter @fenglimg/fabric-cli test` → 122 files / 1203 passed(无断言改动 —— uninstall 测试断言 disposition/status,不断言渲染文案)。
- [x] `pnpm -r exec tsc --noEmit` → exit 0。

## Deviations
- 非-TTY fallback `renderUninstallSummary` 仍用裸计数键 `cli.uninstall.summary.body`(`removed=/skipped=/errors=`)未改:它是 log scraper / 快照消费的稳定机读行,非交互用户 UX;G3 关注的是交互输出,与 install 保留其 fallback 同理。无测试断言此键,改它反增破坏 scraper 风险。convergence 标准均指向 TTY 卡 + 计划预览,二者已修。
- `cli.uninstall.stages.summary` / `.removed-count` 旧键保留(未删):前者仍被非-TTY fallback 引用,删除会破坏 parity census;只是用户面不再走它们。
- `cli.shared.yes`/`.no`:uninstall 内唯一消费者(yesNoLabel)已删,但二者仍被 `install-summary.ts` 引用 → 不孤儿,locale 键不动。

## Notes(供后续)
- G3 收口:install ↔ uninstall 现已视觉 + 语义对称(同一 headerRule B-横线总结卡 + 对称结果词 `{count} installed`↔`{count} cleaned` / `up to date`↔`already clean`)。
- 若日后要把非-TTY fallback 也人话化,需同步更新 log-scraper 期望与对应快照,属单独一项。
- 这是 flat-design-system plan 的最后一个任务(TASK-006)。
