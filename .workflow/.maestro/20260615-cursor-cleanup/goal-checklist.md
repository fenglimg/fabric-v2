# Goal Checklist — Cursor client clean-slate 砍除 (mode③ 混血)

> status.json 是真源, 本文件是投影视图。session: `20260615-cursor-cleanup` · branch `chore/remove-cursor-support`

## 目标
Cursor client 支持 clean-slate 删净, supported clients 收成 **cc + codex** 两端; build/类型/测试全绿、无 dangling cursor 引用、重装产物不再含 cursor。

## 边界契约
- **IN**: client 枚举骨架 4 处 / install 流水线 / doctor / i18n+模板 / `.cursor/` 模板目录 / docs / parity 测试
- **OUT (不动)**: `.workflow/.analysis/` 历史归档 · `ui-ux-pro-max` CSS `cursor:` 属性 · root 已安装产物
- **铁律**: 改 shared 必 rebuild dist · 删 enum 先看红再追平 · 快照 `-u` 前肉眼 diff · 合 main 后通知 release-eval

## 命名 Ship Gate (全绿即 completed)
- [ ] **G-ENUM** — 4 处 client 枚举收成 cc/codex (parity claudeCode/codexCLI), 类型连锁错全追平
- [ ] **G-SRC** — install/config/doctor/i18n/bootstrap-canonical cursor 分支删净, 无 dead branch
- [ ] **G-TPL** — 删 `packages/cli/.cursor/` + configs cursor hook config; uninstall 对称
- [ ] **G-PARITY** — cross-client-parity.test.ts + 快照只剩 cc+codex 绿
- [ ] **G-NODANGLE** — `git grep -i cursor packages/**/*.ts` (排 CSS cursor:) = 0 client 语义引用
- [ ] **G-REINSTALL** — 本仓 `fabric install` 重生成 + 删 root `.cursor/` + AGENTS.md 不提 cursor + doctor 绿
- [ ] **G-GREEN** — build + tsc --noEmit + lint + 全量 test (0 fail 0 skip) + test:strategy + test:store-only-e2e

## 任务 (顺序 TDD)
- [ ] **T1** shared 枚举骨架删 cursor (4 处) → write-red 看红
- [ ] **T2** 逐个追平 cli/server 消费者 → G-ENUM + G-SRC
- [ ] **T3** 删模板目录 + uninstall 对称 → G-TPL
- [ ] **T4** parity 测试 + 快照 (肉眼 diff) → G-PARITY
- [ ] **T5** docs/i18n/bootstrap 文案 + git grep 清零 → G-NODANGLE
- [ ] **T6** fabric install 重装 + doctor 绿 → G-REINSTALL
- [ ] **T7** 全量 build+tsc+lint+test 绿 → G-GREEN

## commit 节奏
每 gate / wave 收口即 `git add -A && git commit -m "refactor(cursor): <gate>"`, sha 回填 status.json `git_commits[]`。

## Resume
推进单步 → `/goal-mode continue` · 看进度 → `/goal-mode status` · 收尾 → `/goal-mode close`
