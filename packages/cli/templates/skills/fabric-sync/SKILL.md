---
name: fabric-sync
description: 多 store git 同步辅助 — 遍历挂载的知识 store, pull --rebase + push, AI 辅助解冲突。Triggers 同步知识库/sync stores/fabric-sync/解决 store 冲突/rebase 冲突.
---

# fabric-sync

跨多个挂载知识 store 的 git 同步辅助 (v2.1, S46)。CLI `fabric sync` 是事务/状态机引擎；本 skill 是它的 AI 辅助外层：遍历 store、解释每个 store 的同步结果、在 rebase 冲突时辅助用户决断 continue/abort。

## Precondition

- 已 `fabric install --global` (存在 `~/.fabric` + 全局 store registry)。无全局配置 → 提示先装，停止。
- 本 skill 不直接读 `~/.fabric` store 树；所有 store 状态经 `fabric sync` / `fabric store list` / `fabric scope-explain` 的 JSON 输出获取 (hook/skill 不自解析 store)。

## Phase 0 — Enumerate stores

`fabric store list` 拿到挂载的 store (alias / uuid / remote)。仅 remote-backed store 参与同步；local-only store 跳过 (无可推/拉)，但提示「local-only — 加 remote 备份」(R5#5)。

## Phase 1 — Run sync

执行 `fabric sync`。逐 store 渲染结果 (NOT 聚合成一坨)：
- `synced` — 干净 rebase + push 完成。
- `offline` — 网络不可达；本地已提交，push 已 defer (S17 offline-first)，下次 online 重试。**不报错**。
- `conflict` — rebase 冲突，sync 暂停并持久化 session。进入 Phase 2。

## Phase 2 — AI-assisted conflict resolution (仅冲突时)

冲突 store 的工作区停在 rebase 中途。辅助用户：
1. 展示冲突文件 (知识 markdown 的 `<<<<<<<`/`=======`/`>>>>>>>` 段)。
2. 对每个冲突，解释两侧 (ours = 本地草稿/晋升, theirs = 远端协作者)，给出**合并建议**（知识条目通常可并存或取更成熟 maturity）。NEVER 擅自丢弃任一侧未经用户确认。
3. 用户解决后 → `fabric sync --continue` (git rebase --continue + 恢复遍历剩余 store)。
4. 用户选择放弃该 store → `fabric sync --abort` (git rebase --abort，该 store 留未同步，继续遍历其余)。

## Phase 3 — Settle

所有 store settled (无 pending/conflict) 后：CLI 自动清 session 并重生 `~/.fabric/state/bindings/<id>_resolved.json` 快照 (P3→P4 链)。汇报：已同步 store 数、deferred (offline) store 数、aborted store 数。

## UX i18n Policy

按 `.fabric/fabric-config.json` 的 `fabric_language` 渲染用户可见文案。Protected tokens (`fabric sync`, `--continue`, `--abort`, `git rebase`, store alias, enum) NEVER translate。

## Constraints

- Hook/skill **绝不**直接解析 store 或执行 store 内任何文件 (S65 RCE 防线：store 是数据-only)。
- 冲突合并建议是辅助，最终由用户拍板；不静默丢弃知识。
- promotion/CR 经普通 git commit，不跨 store 搬运条目。
