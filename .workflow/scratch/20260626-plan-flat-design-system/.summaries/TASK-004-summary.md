# TASK-004: Wave4 控件回执 — select/multiselect/confirm/text 后打平铺无沟槽 ✓/x 行 + 收紧文案

Commit: `a886628` (branch `feat/cli-flat-design-system`)

## Changes
- `packages/cli/src/install/theme-clack.ts`: 新增 `buildPromptReceipt(kind, value?)` 纯字符串 builder +
  `promptReceipt(kind, value?)` stdout 包装。回执平铺无沟槽(无 `│`),用 `symbol.ok`/`symbol.error` + `paint`,
  文案过 `t()`。`selected`/`set` → `✓ <label> · <value>`(无 value 时省略 ` · `);`cancelled` → 红 `x <已取消>`。
  C-006 SCOPE LOCK 注释保留并复述:不包裹/不重绘任何 clack PROMPT 控件,仅在控件落定后另起一行打回执。
- `packages/cli/src/commands/config.ts`: select/text 编辑成功后(`log.success` 之后)调 `promptReceipt("set", display)`。
  新增 `import { promptReceipt }`。
- `packages/cli/src/commands/uninstall.ts`: 卸载 wizard multiselect 落定后打 `promptReceipt("selected", 选中阶段标签)`;
  wizard 最终 confirm 与非-wizard `confirmDestructive` 的 No/取消分支打 `promptReceipt("cancelled")`。新增 import。
- `packages/cli/src/install/install-wizard.ts`: **关键执行注意** —— 回执在 clack `group(...)` **解析之后**才打
  (group 成功 resolve 后打 `promptReceipt("selected", 启用阶段短标签)`),不在 group 内交织;最终 execute confirm
  的 No/取消分支打 `promptReceipt("cancelled")`。新增 import。
- `packages/shared/src/i18n/locales/{en,zh-CN}.ts`: 新增 `cli.prompt.receipt.{selected,set,cancelled}`
  (Selected/Set/Cancelled · 已选/已设置/已取消)+ `cli.install.wizard.stage.{bootstrap,mcp,hooks}.short`
  (install wizard 回执用短阶段标签)。双 locale key 对齐。
- `packages/cli/__tests__/theme-clack.test.ts` + `.snap`: 新增 `buildPromptReceipt` 用例 —— 断言四种渲染均无 `│`,
  set/selected 含 ` · `,无 value 时不带 ` · `;NO_COLOR 快照固化输出。

## Verification(逐条 convergence 标准 + 证据)
- [x] **C1** `buildPromptReceipt`/`promptReceipt` helper 存在且 gutter-free,用 `symbol.ok`/`symbol.error` —
  grep 命中 helper(theme-clack.ts:81/101),源码无 `│` 字面量(仅 doc 注释里描述性出现)。
- [x] **C2** en.ts AND zh-CN.ts 均定义三键 —— grep 每键在两文件各命中 1 次。
- [x] **C3** clack 控件保持原生 —— theme-clack 不 import `@clack/prompts`;C-006 注释完整(theme-clack.ts:5/67);
  三个 call site 仍从 `@clack/prompts` 直接 import select/multiselect/confirm/text;无新增控件包裹。
- [x] **C4** [UI-observable] config 编辑后打平铺 `✓ 已设置 · <value>`(无 `│`)—— 快照 `set: "[ok] Set · zh-CN"`
  (NO_COLOR ASCII;FORCE_COLOR 下 `[ok]`→绿 ✓),零沟槽。
- [x] **C5** [UI-observable] 取消 confirm 打平铺红 `x <…取消>` —— 快照 `cancelled: "[error] Cancelled"`,无 clack 裸 outro。
- [x] **C6** `pnpm --filter @fenglimg/fabric-shared test`(635 passed,locale parity 绿)&&
  `pnpm --filter @fenglimg/fabric-cli test`(1203 passed,+1 新用例)&& `pnpm -r exec tsc --noEmit`(exit 0)。

## Tests
- [x] `pnpm --filter @fenglimg/fabric-shared test` → 635 passed(含 locale-parity census 两条)。
- [x] `pnpm --filter @fenglimg/fabric-cli test` → 1203 passed(122 文件)。
- [x] `pnpm -r exec tsc --noEmit` → exit 0。
- [x] `pnpm exec vitest run __tests__/theme-clack.test.ts` → 5 passed,新快照写入。

## install-wizard 回执时机确认
回执在 clack group **解析之后**触发,**非** group 内:`group(...)` await 返回后,先打 `promptReceipt("selected", …)`,
再走 review/execute-confirm。group 内的 `confirmInGroup`/`selectMcpInstallModeInGroup` 不被改动、不打回执 —— 避免与
clack group 渲染交织(plan-checker 执行注意已满足)。

## Deviations
- 为 install-wizard 回执补了 `cli.install.wizard.stage.{bootstrap,mcp,hooks}.short` 三键(任务 action 未显式列出)。
  原因:install 阶段无现成单词级 localized 标签,而 spec §0.7 要求文案过 `t()`、回执需列已选阶段名。补短标签是
  满足"`✓ 已选 · <label(s)>` + 全 t() 本地化"的最小做法,双 locale 对齐,parity 测试绿。
- config 的取消分支沿用 clack 原生 `cancel()`(已有),未额外叠加 x 回执 —— config select/text 的 isCancel 走
  `CANCELLED` symbol 后由调用方 `cancel(t("cli.config.cancel"))`,与 spec §4「捕 isCancel,收尾朱红 x」一致;
  回执 helper 集中用于 uninstall/install confirm 的 No 分支(破坏性动作的显式 x)。

## Notes(供下一任务)
- `buildPromptReceipt`/`promptReceipt` 已就位于 `install/theme-clack.ts`,后续若 doctor/其它交互需平铺回执可直接复用。
- shared i18n 改动需 rebuild dist(`pnpm --filter @fenglimg/fabric-shared build`)才让 cli runtime 读到新键 —— 已 rebuild。
- 回执只在 helper 中拼 ` · ` 分隔;value 为空/undefined 时自动省略 ` · `,调用方无需特判。
