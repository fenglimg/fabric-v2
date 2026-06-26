# TASK-005: Wave5 doctor + config 重排 — B-横线标题 + 健康徽章 + C-圆点分组(废树形线)+ config 平铺键值面板

Commit: `62f266e` (branch `feat/cli-flat-design-system`)

## Changes
- `packages/cli/src/commands/doctor.ts`:
  - import 由 `sectionBar`(@fenglimg/fabric-shared/theme) + `tree`(tui/structure) 换成 CLI-local `groupDot` + `headerRule`。
  - `renderDoctorHeader` → `headerRule('fabric doctor · <target>')`,健康徽章 `renderStatus()` 追加到标题行(rule 横线保持干净在下一行)。
  - `renderDoctorStoreHealth` → `groupDot(t('doctor.group.store-health'))` + 平铺两空格缩进行(`  <badge><ref> <message>`),废 `tree()`。行内文案/徽章 verbatim 保留。
  - `renderDoctorChecks` → `groupDot(t('doctor.group.checks'))` + 平铺缩进行,废 `tree()`。空集仍返回 `""`。
  - `renderFixKnowledgeMutations` / `writeIssueSection` 分组标题改 `groupDot(...)`,行缩进 +2 空格对齐。
- `packages/cli/src/commands/config.ts`:
  - 新增 `headerRule` import + `writeConfigPanel(fields, current)` helper:`headerRule(t('cli.config.panel.title'))` 标题 + 无沟槽平铺 `  <key> (<label>): <value>` 行(default 标记沿用)。
  - 在菜单 loop 内、`select` 之前调用 `writeConfigPanel`(每轮刷新显示 live 状态)。clack select/text 编辑流原生不动(TASK-004 的 `promptReceipt` 回执保留)。
- `packages/shared/src/i18n/locales/en.ts` + `zh-CN.ts`:新增 3 个 key(双 locale)——
  `doctor.group.store-health`(Store Health / 存储健康)、`doctor.group.checks`(Checks / 检查项)、`cli.config.panel.title`(Current configuration / 当前配置)。
- `packages/cli/__tests__/doctor-reskin.test.ts` + `.snap`:测试描述与 NO_COLOR 快照重生为新的平铺输出(B-横线 header + `* <group>` C-圆点 + 平铺行,零 `+-`/`` `- `` 树形线)。

## Verification(逐条 convergence 标准)
- [x] **C1** doctor.ts `renderDoctorHeader` 用 `headerRule`(grep 命中 L421)、不再用 `sectionBar`(仅注释残留),追加 `renderStatus()` 健康徽章。
- [x] **C2** `renderDoctorStoreHealth`/`renderDoctorChecks` 不再调 `tree()`(grep 仅命中注释行),改用 `groupDot` 分组头。
- [x] **C3** config.ts display 路径无 `│` 字面量(grep 仅命中两处描述性注释),键值行在 `headerRule` 标题下平铺。
- [x] **C4** 新分组标签 3 key 在 en.ts + zh-CN.ts 双向定义(grep 各命中);原 Store Health/Checks 文案在两 locale 本地化保留。
- [x] **C5** [UI-observable] `NO_COLOR=1 fabric doctor` 实跑:B-横线 header + `[warn]` 徽章 + dim rule,`* 检查项`/`* 警告：`/`* 存储健康` C-圆点分组 + 平铺缩进行,无树形分支。
- [x] **C6** [UI-observable] config 平铺面板:`writeConfigPanel` 走 `headerRule` 标题 + 无沟槽 `  key (label): value` 行;clack 编辑提示行的 `│` 为原生保留(spec §0.3 节奏化,非缺陷)。config-panel.test.ts(mock clack)全绿。
- [x] **C7** `pnpm --filter @fenglimg/fabric-shared test` → 635 passed;`pnpm --filter @fenglimg/fabric-cli test` → 1203 passed(含 doctor-reskin + config-panel);`pnpm -r exec tsc --noEmit` → exit 0。

## Tests
- [x] `pnpm --filter @fenglimg/fabric-shared test` → 53 files / 635 tests passed(locale parity 绿)。
- [x] `pnpm --filter @fenglimg/fabric-cli test` → 122 files / 1203 tests passed。
- [x] `pnpm -r exec tsc --noEmit` → exit 0。
- [x] `pnpm --filter @fenglimg/fabric-cli exec vitest run doctor-reskin.test.ts -u` → 6 passed,快照重生(2 written / 2 updated / 2 removed)。

## Deviations
- config.ts 原本**没有**独立的「display panel」函数 —— 键值展示此前内嵌在 clack select 菜单 label 里。按 spec §2 config「留白键值展示 → clack select 改值」,新增 `writeConfigPanel` 在 select 之前打印平铺面板(最贴合 spec 意图的最小新增),而非「修改既有 display 函数」(planner 未穷读 config display body,实际无此函数)。
- doctor 分组标题用模块级 `t`(非 target-bound `dt`)定位 locale —— 与原 hardcoded English 行为一致(原 Store Health/Checks 不随 target 变),且保持 `renderDoctorStoreHealth`/`renderDoctorChecks` 测试签名不变(无需透传 dt)。

## Notes(供下一任务)
- JSON 输出路径(`args.json`)完全未碰 —— 仅 human 渲染 composer 结构变。
- `sectionBar`/`tree` 在 doctor.ts 已无活引用(仅注释提及);若后续要清 import,二者已不在 import 行。
- config 面板每轮 loop 刷新,编辑后能立刻看到新值(re-read config)。
- dismissed: KP-DEC-9001 (not-applicable) —— recall 仅命中无关 personal canary。
