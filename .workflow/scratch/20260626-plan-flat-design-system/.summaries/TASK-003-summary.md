# TASK-003: Wave3 G2+G5 — 重装误报与折叠死结 + spinner 单行原地刷新

Commit: `80a8ccb`(branch `feat/cli-flat-design-system`)

## Changes
- `packages/shared/src/i18n/locales/en.ts` / `zh-CN.ts`: 新增 `cli.install.stage.uptodate`(up to date / 已最新)+ `cli.install.stage.installed-count`(`{count} installed` / `{count} 项已安装`),双库齐备。
- `packages/cli/src/install/pipeline/pipeline.ts`:
  - **G2-a** `buildSummary` 明细 `value`:ran 阶段从 `${r.installed.length} installed` 改为按 `r.changed` 分支 —— `changed===true` → `t('cli.install.stage.installed-count')`,否则 `t('cli.install.stage.uptodate')`。与 `allIdempotent`(line 371,keyed off `r.changed`)同一真相源。
  - **G2-a** per-step 成功 detail(~line 243):同样改按 `result.changed` 判定,无改动显示 uptodate,不再用 installed.length 拼 "N installed, M skipped"。
  - **G2-b** 折叠门(line 322):去掉 `!buffer.flushed`,改为 `if (buffer !== undefined && this.allIdempotent(context))`。全幂等重装即使被 store 阶段 clack 提问 flush 过 buffer 仍折叠成体检卡。
- `packages/cli/src/tui/ConsoleOutputRenderer.ts`:
  - **G5** `renderStep` 重写:新增 `runningLineOnScreen` 字段追踪。`isTTY = colorOn && process.stdout.isTTY === true`。running 状态:非 TTY 直接 return(抑制占位),TTY 写占位并标记。terminal 状态:TTY 且占位在屏 → `\x1b[1A\x1b[2K` + 最终行原地覆盖;否则直接打。`cleanup` 重置标记。

## Verification(逐 convergence 标准 + 证据)
- [x] **C1** buildSummary detail 按 `r.changed` 派生,grep 确认 ran-stage `value` 不再读 `installed.length`(`grep '${.*installed.length} installed'` 在 pipeline.ts 返回 NONE;C1 区块 grep 命中 `r.changed === true ? installed-count : uptodate`)。
- [x] **C2** en.ts AND zh-CN.ts 均定义 `cli.install.stage.uptodate` + `.installed-count` —— 双库 grep 4/4 命中(en 957/958,zh 936/937)。
- [x] **C3** 折叠门去 `!buffer.flushed` —— grep `!buffer.flushed` 在 pipeline.ts 返回空;门为 `buffer !== undefined && allIdempotent`(line 322)。无双重 emit:折叠分支 line 339 `return` 在 normal-path `flushBuffer`(line 344)之前;且 `flushBuffer` 对 `buffer.flushed` no-op(line 356-358)。
- [x] **C4** renderStep 含 `\x1b[1A` + `\x1b[2K`(line 110),由 `isTTY && runningLineOnScreen`(line 109)门控;`isTTY` 要求 `process.stdout.isTTY === true`(line 92);非 TTY 路径 line 97-99 early-return 不写占位。
- [x] **C5** [UI-observable] 全幂等重装(即使 store 提问 mid-pipeline flush)→ 单张 `已是最新/up to date` 体检卡,无 'N installed' 明细、无 per-stage replay —— 由反转后的 render 测试断言:`renderSummaryCard` 调 1 次,title=`healthcheck.title`,`details=[]`(见 install-v2-pipeline-render.test.ts "G2 root b" 用例);flushTo 用例额外证 buffered 行无重复(no double-emit)。
- [x] **C6** [UI-observable] TTY 单行 —— install-renderer-step-singleline.test.ts:TTY+color 下 running→success 两次 write,第二次含 `\x1b[1A`/`\x1b[2K`(原地覆盖);非 TTY 仅 1 行无 escape;colors:false on TTY 不发 escape。
- [x] **C7** `pnpm --filter @fenglimg/fabric-shared test` exit 0(53 files / 635 tests,含 locale-parity)&& `pnpm --filter @fenglimg/fabric-cli test` exit 0(122 files / 1202 tests)&& `pnpm -r exec tsc --noEmit` exit 0。

## Tests
- [x] `pnpm --filter @fenglimg/fabric-shared build`(locale 改动需 rebuild dist,见 MEMORY)→ success。
- [x] `pnpm --filter @fenglimg/fabric-shared test` → 635/635 passed。
- [x] `pnpm -r exec tsc --noEmit` → exit 0。
- [x] `pnpm --filter @fenglimg/fabric-cli test` → 1202/1202 passed(122 files;新增 5 个用例:3 G5 单行 + G2-a 误报 + 反转 G2-b 折叠)。受影响子集 `vitest run install-v2-pipeline-render + install-renderer-step-singleline + install-renderer-reskin + install-v2-pipeline` → 29/29。
- 备注:TASK-001 提及的 flaky `install-url-bind.test.ts` 本次全量跑通过,未复现。

## Deviations
- 反转了 install-v2-pipeline-render.test.ts 的旧 "Bug-B" 断言:原断言「flush 后放弃折叠 → 标准总结卡」,TASK-003 G2-b 明确要求「全幂等即使 flush 仍折叠」,故改为断言体检卡 + `details=[]`。同文件 "flushTo replays" 用例的尾断言也从标准卡改为体检卡(全幂等),并加 `post-flush-3` 去重断言以证 collapse-after-flush 路径不 double-emit。属本任务行为变更的必要连带更新,非额外 scope。
- per-step 成功 detail 在无改动时显式显示 uptodate(原代码无改动时为 `undefined` 不显)。任务 action 要求「per-step detail keyed off changed」,显示 uptodate 与总结卡一致,且 C5/C6 测试不依赖该明细文案,无回归。

## Notes(供下一任务)
- 新 i18n key `cli.install.stage.uptodate` / `.installed-count` 已就位,uninstall/doctor 等后续套总结卡若需同款状态词可直接复用。
- `runningLineOnScreen` 重绘假设 running 占位是该 step 紧邻的上一条 stdout 写入(renderStep per-step 串行,假设成立);若未来 step 间插入其它 write,需重新评估。
- 折叠门现仅 `buffer !== undefined && allIdempotent` —— buffer 仅在 re-install(firstInstall===false)+ liveRenderer 存在时构建,首装永不折叠的语义不变。
