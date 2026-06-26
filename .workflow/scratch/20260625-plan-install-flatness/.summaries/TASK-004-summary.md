# TASK-004: 首装 vs 重装 定调 + 重装智能折叠体检卡片

## Files Modified
- `packages/cli/src/install/pipeline/types.ts` — `InstallState.firstInstall?: boolean` + `InitArgs.verbose?: boolean`.
- `packages/cli/src/commands/install-v2.ts` — `--verbose` arg; `createInstallContext` 早期检测 `firstInstall = loadGlobalConfig(resolveGlobalRoot()) === null` 写入 `state.firstInstall`.
- `packages/cli/src/install/pipeline/store.stage.ts` — 用 in-stage `globalConfig === null` re-affirm `context.state.firstInstall`;新增 `withFirstRunContext()` 在首装时给 language / personal onboarding 提问加「首次设置中」语境标签(未动 TASK-002 双槽结构)。
- `packages/cli/src/install/pipeline/pipeline.ts` — 新增 `RecordingRenderer`(end-pass 缓冲)；首装走 `cli.install.pipeline.intro.firstRun` onboarding intro;`execute()` 末尾 end-pass:`firstInstall===false`(buffer 存在)且 `allIdempotent()`(每阶段 skipped 或 ran+installed.length===0)且无错误 → 丢弃缓冲、`renderSummaryCard` 单张体检卡片;否则 flush 缓冲 + 正常 summary card。失败/异常路径先 flush 缓冲再渲 error box。
- `packages/cli/src/install/pipeline/guidance.stage.ts` — C-006:`printCapabilitySummary` 4×6 表降级到 `context.args.verbose !== true` 时只打 `cli.install.capabilities.summaryLine` 单行。
- `packages/shared/src/i18n/locales/en.ts` + `zh-CN.ts` — 5 个新 key,en+zh 全 parity:`pipeline.intro.firstRun`、`store.firstRunContext`、`healthcheck.title`、`capabilities.summaryLine`、`args.verbose.description`(均带 `{count}` 处)。
- `packages/cli/__tests__/install-v2-pipeline-render.test.ts` — 3 个 TASK-004 runtime 测试 + `rendererContext` 加 overrides 参数。

## Verification (each convergence criterion)
- [x] grep `firstInstall`/`globalConfig === null` in store.stage.ts → 命中(line 71-72 set flag,84/92 thread to prompts)。
- [x] grep `firstRun`/`firstRunContext` in zh-CN.ts → 命中(915 intro.firstRun, 1032 firstRunContext)。
- [x] grep `healthcheck`/`已是最新`/`无改动` in zh-CN.ts → 命中(919 `✓ Fabric 已是最新 · {count} 阶段就绪 · 无改动`)。
- [x] grep `verbose` in install-v2.ts → 命中(72 arg 定义)。
- [x] grep `verbose|summaryLine` in guidance.stage.ts → 命中(190 gate, 191 summaryLine)。
- [x] grep `firstInstall` in types.ts → 命中(132)。
- [x] [runtime] firstInstall=false + 全 skipped/zero-installed → `renderSummaryCard` 调 1 次且 title===healthcheck.title,`renderStep`/`renderSection` 未调(per-phase streaming suppressed)。PASS。
- [x] [runtime] firstInstall=false + 一阶段 installed.length>0 → 不折叠(renderStep/renderSection 被调,summary card title===pipeline.complete);firstInstall=true → onboarding intro 出现在 renderInfo,renderStep 被调(不折叠)。PASS。

## Verification Output
- `pnpm exec tsc --noEmit` (packages/cli) → exit 0。
- `pnpm test -- pipeline` → 118 test files / 1159 tests 全 passed。
- `pnpm exec vitest run install-v2-pipeline-render` → 5/5 passed(2 原 + 3 新)。
- `pnpm exec vitest run store.stage` → 5/5 passed。
- 防御性 `pnpm exec tsc --noEmit` (packages/shared) → exit 0。
- `pnpm --filter @fenglimg/fabric-shared build` 已跑(新 i18n key 进 dist;dist gitignored 不提交)。

## Commit
- `05d7c1e` on `feat/install-flatness-w2-store-dualslot`,8 files / +329 -22。

## Deviations
- **firstInstall 检测落点**:task action 提示「e.g. install-v2.ts createInstallContext or preflight/env」。选 createInstallContext(read-only `loadGlobalConfig`),因 pipeline intro 在所有 stage 前渲染,必须在 context 构造时就知 firstInstall。store.stage 再用 in-stage config load re-affirm(权威 `globalConfig===null`),双写一致、store stage 自足。无功能偏差。
- **折叠实现 = RecordingRenderer 缓冲**:R13 要求 collapse 是 end-pass。因 per-phase streaming 在 loop 内即时发出,无法预知幂等。引入缓冲 renderer 录制整段(含 stage 自身 renderInfo)保序,end-pass 决定 replay(正常)或丢弃(折叠)。failure 路径先 flush 再渲 error box,保证报错可见。这是「keep streaming minimal then card at end」的忠实落地,非新 render path(仍走 TASK-001 OutputRenderer 接口)。
- 既有 `install-v2-pipeline-render.test.ts` 用 `state: {}`(firstInstall===undefined),collapse 严格要求 `firstInstall===false`,故不误折叠、原测试不破。
