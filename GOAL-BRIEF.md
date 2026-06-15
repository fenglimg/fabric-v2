# GOAL-BRIEF — Goal A:bootstrap 文案修复 + 内容层 i18n(mode③)

> 派生自 2026-06-15 fallback-purge 收尾 grill。本 worktree = `pcf-i18n`,分支 `feat/content-layer-i18n`(off main 9ad706d)。
> 启动:`/goal-mode` 读本文件 scaffold status.json + 命名 ship gate;gate 全绿即合 main。
> 关联 KB:`team:KT-DEC-0025`(内容层 i18n:语言流向已统一 resolveGlobalLocale 单源,真成本=churning-doc 双写税)。先 `fab_recall` 验证再 cite。

## 目标
让内容层(写进 artifact 的正文)跟随统一语言流向(`resolveGlobalLocale` 单源),消除"英文用户拿到中文 AGENTS.md / 中文 Why proposed"。先修一行 stale 文案债(ADJ-3),再造双语能力。

## 现状(已捞回的在制改动)
本 worktree 已 `stash apply` 了 ADJ-3 的两处改动(未提交):
- `packages/shared/src/templates/bootstrap-canonical.ts:127` — 已把 cite backward-compat 文案从 `legacy→applied` 改为 `legacy→none`(对齐 `cite-line-parser.ts:12-15,82-92` 真实行为:clean-slate,未识别 tag 降级 none,chained-from 仅抢救 id)。
- `packages/cli/__tests__/__snapshots__/i18n.test.ts.snap` — 受影响快照(注意见 G-ADJ3 的快照漂移说明)。

## 命名 Ship Gate(全绿即达成)
- [ ] **G-ADJ3** — bootstrap-canonical L127 文案对齐 parser ✓ + **cli `i18n.test.ts.snap` 既存漂移修净**(⚠️ main 上该快照本就不完整,test run 靠 vitest 自动补写才"绿",CI 模式 `CI=true` 会 FAIL;须把缺失快照块正式写入并提交,肉眼 diff 确认只是补全 + L127 那一处文字变化)+ shared/server/cli 相关测试绿 + 本仓 `fabric install` 重同步 `.fabric/AGENTS.md` 消 L1-drift。
- [ ] **G-DUALBODY** — `BOOTSTRAP_CANONICAL` 拆 `_EN/_ZH` 双体 + `PROPOSED_REASON_DESCRIPTIONS`(api-contracts.ts:637)拆 en/zh 双 map;install 写侧(pipeline)+ doctor drift 比对侧(doctor-bootstrap-lints)各调 `resolveGlobalLocale()` 挑体。
- [ ] **G-PARITY** — 新增内容层 parity 闸(en↔zh 结构对齐:marker/section 数量一致,protected tokens 边界);处理"全机器语言切换致已装项目 AGENTS.md 报 drift"边界(doctor 容双 locale 或提示重装)。
- [ ] **G-GREEN** — `tsc -r` 0 error + shared/server/cli 全量测试 0 fail 0 skip(改 shared 后 `pnpm --filter @fenglimg/fabric-shared build` rebuild dist)。

## 任务(顺序)
1. **ADJ-3 收口**(stash 已捞回)→ 修快照漂移 → 重同步本仓 AGENTS.md → commit → G-ADJ3
2. 拆 `BOOTSTRAP_CANONICAL_EN/_ZH` + PROPOSED_REASON 双 map → G-DUALBODY
3. install/doctor 接 `resolveGlobalLocale` 挑体 → G-DUALBODY
4. 内容层 parity 闸 + 语言切换 drift 边界 → G-PARITY
5. 全量 tsc + 测试绿 → G-GREEN → 合 main

## 铁律
- 改 shared **必 rebuild dist**(server/cli 引 `@fenglimg/fabric-shared` dist)。
- 动 `BOOTSTRAP_CANONICAL` / `PROPOSED_REASON` 是 byte-稳定敏感(改前者改每个新装 AGENTS.md,改后者改每个新 pending 文件的 `## Why proposed`)——改后跑 byte-lock drift 测试 + install 测试。
- 快照 `-u` 前**肉眼 diff** 确认只是预期变化,不掩盖真 mismatch。
- 语言流向唯一源:`~/.fabric/fabric-global.json` language → `resolveGlobalLocale()`(fallback FAB_LANG→LANG→en);内容层挑体必走此解析器,勿自建。

## 启动命令(新终端)
```
cd /Users/wepie/Desktop/personal-projects/pcf-i18n
pnpm install            # 新 worktree 首次需装依赖
claude                  # 开会话后:/goal-mode 读 GOAL-BRIEF.md 起 mode③ goal
```
