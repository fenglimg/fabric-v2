# TASK-001: Wave1 视觉底色 — CLI-local B-横线/C-圆点 header 原语 + 去 OUTPUT 区 `│` 竖墙

Commit: `389281a` (branch `feat/cli-flat-design-system`)

## Changes
- `packages/cli/src/tui/structure.ts`: 新增两个 CLI-local 原语 —
  `headerRule(title)` 返回 accent-bold 标题 + 一条 dim `─`×40 细线(NO_COLOR/非 TTY 降级为裸标题 + `-`×40);
  `groupDot(label)` 返回 accent `● <label>`(ASCII 降级 `* <label>`)。复用 shared `ANSI`/`PALETTE.accent`(既有 token),无新色值。
- `packages/cli/src/colors.ts`: `paint` 暴露 `accent` painter(既有 PALETTE token via `tokenPainter`,无新色值),供 `groupDot` 使用。
- `packages/cli/src/install/theme-clack.ts`: `buildIntro` 从 `sectionBar+手工 rule` 切到单一 `headerRule(title)`;`buildNote` 删除逐行 `│ `/`| ` 竖墙,正文改纯两空格缩进,可选标题走 `headerRule`。移除不再使用的 `sectionBar`/`isColorEnabled` 导入。
- `packages/cli/src/tui/ConsoleOutputRenderer.ts`: `buildErrorBlock` 从 `sectionBar+leftBar` 块改为 `headerRule([err] <title>)` + 平铺两空格缩进正文(message/💡 hint/↳ stack 全无 `│`);删除 `leftBar()` helper;更新 `renderError` 与类级 doc 注释。`sectionBar` 导入保留(`renderSummaryCard`/`renderSection` 仍用)。
- 测试:`theme-clack.test.ts` / `install-renderer-reskin.test.ts` / `colors.test.ts` 更新为 gutter-free 断言;重生两份 NO_COLOR 快照,删 4 个 obsolete 旧快照;colors 契约测试加入 `accent` key。

## Verification (每条 convergence 标准 + 证据)
- [x] **C1** structure.ts exports `headerRule` AND `groupDot` — `grep` 命中 `81:export function headerRule` + `92:export function groupDot`。
- [x] **C2** headerRule 含从 `─` 构建的 dim rule(NO_COLOR 下 `-`)— `grep` 命中 `84: const rule = paint.muted((on ? "─" : "-").repeat(40));`。
- [x] **C3** theme-clack buildNote 不再含 `│ ` gutter 字面量 — 源码无 `│ ` 代码字面量(仅 doc 注释里出现描述性 `│`);快照证实 untitled=`"  solo line"`,无 `| `。
- [x] **C4** ConsoleOutputRenderer 无 `leftBar`(grep `function leftBar` 无匹配),buildErrorBlock 无 `│` 字面量(仅注释)— grep 确认。
- [x] **C5** [UI-observable] 出错时 error block 无前导 `│`/`|`,header 为 B-横线,body 平铺缩进 — 双模式 eyeball:
  - NO_COLOR: `"[err] InstallError\n----------------------------------------\n\n  clone failed (E1)\n\n  💡 check url\n  ↳ Error: x ..."`
  - FORCE_COLOR: header = `\x1b[1m\x1b[38;2;155;89;182m...`(bold + amethyst)+ dim `────` rule,body 两空格缩进,零 `│`。
- [x] **C6** `pnpm -r exec tsc --noEmit` exits 0(已实跑,exit 0)。
- [x] **C7** 相关测试绿:`vitest run theme-clack + install-renderer-reskin + colors + structure` → 17 passed,4 obsolete 快照已删。

## Tests
- [x] `pnpm -r exec tsc --noEmit` → exit 0。
- [x] `pnpm exec vitest run __tests__/{theme-clack,install-renderer-reskin,colors,structure}.test.ts` → 17/17 passed,obsolete 快照清理干净。
- [~] `pnpm --filter @fenglimg/fabric-cli test`(全量 1198 tests):本次改动相关测试全绿。全量跑出现 1 个**与本任务无关**的 flaky 失败 `install-url-bind.test.ts > mountStoreFromRemote robustness ... adopts an on-disk store missing from the registry`(全量并发负载下 22s 超时;**单独跑 8/8 全绿,1.97s**)。该测试不 import 任何本次改动文件,属预存在的 git/fs 时序敏感 flake,非本任务回归。

## Deviations
- 任务 `action` 描述 `headerRule` 为 “`<accent-bold title>`”,但 `colors.ts` 的 `paint` 原本不含 `accent` 也无 bold helper。按 spec “复用既有 PALETTE token / 不引新色值” 红线,采用最小改动:`headerRule` 直接复用 shared `ANSI.bold`+`PALETTE.accent`(与 `sectionBar` 同手法),并在 `colors.ts` 暴露 `accent` painter 供 `groupDot` 用。未新增任何色值。
- 因新增 `paint.accent`,既有 `colors.test.ts` 的 paint-key 顺序契约测试需同步加入 `accent`(已更新)。属任务 risks 之外但必要的连带测试更新。

## Notes (供下一任务)
- `headerRule`/`groupDot` 已就位于 `tui/structure.ts`,后续 Wave(总结卡 / doctor / config / uninstall)可直接 import 复用,无需再碰 shared `theme.ts`。
- `sectionBar` 仍被 `ConsoleOutputRenderer.renderSummaryCard`/`renderSection` 使用 —— 两套 header 原语按计划暂时共存(shared sectionBar 给 hook,CLI headerRule 给输出),后续 Wave 若要把总结卡/section 也切 B-横线,再逐个替换。
- 全量 suite 里 `install-url-bind.test.ts` 在重负载下偶发超时失败,与本任务无关,后续若 CI 复现可单列治理。
