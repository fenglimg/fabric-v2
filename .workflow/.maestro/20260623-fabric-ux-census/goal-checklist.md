# Goal Checklist — Fabric UX 北极星全修 W0→W2(mode 3 混血)

> status.json 为真源,本文为投影。done 判据:三波命名门 G-W0/G-W1/G-W2 全绿(全项 done + tsc/vitest 绿 + committed)。
> 分支 `feat/ux-northstar-w0`。真源 `packages/cli/templates/` → 改完 `fabric install --yes` 同步。

## 🟢 G-W0 门(红线 trivia)— 2 项
- [x] W0-1 narrow 删退役工具 fab_plan_context 引用
- [x] W0-2 bootstrap fabric_language 字段修正

## 🟡 G-W1 门(机械 cheap-high)— 9 项
- [x] W1-1 fab_extract_knowledge→fab_propose + instructions
- [x] W1-2 fab_review description 内嵌 required 清单
- [x] W1-3 broad summary 套 hint_summary_max_len 截断
- [x] W1-4 grouped-help 派生 + group 标签(修 context)
- [x] W1-5 删 config 死字段 ×3
- [x] W1-6 删 deprecated 别名 whoami/status
- [x] W1-7 3 内部 RPC 加 __ 隐形
- [x] W1-8 KILL cite-contract-reminder lib
- [x] W1-9 nudge_mode 写进 shipped config 提表盘

## 🟠 G-W2 门(结构根治)— 10 项
- [x] W2-1 ★ 镜像 5→1(gitignore dogfood)
- [x] W2-2 doctor retired-reference lint
- [x] W2-3 旋钮 45→~18
- [x] W2-4 fab_recall 单 entries[]
- [x] W2-5 ★ 抽 theme.ts 共享渲染(鲜明多色)
- [x] W2-6 cite-policy-evict 并入 narrow
- [x] W2-7 server instructions 受众分组
- [x] W2-8 shared exports.development 走 src
- [x] W2-9 events.jsonl 单 guarded 写路径
- [x] W0-3 fabric-hint 4 信号 block→soft(配 invariant test)

## Resume
未达成时:读本文 + status.json(boundary_contract / task_decomposition / ship_criteria)作行动手册,调 `/goal-mode continue` 推进下一步。out_of_scope=W3 全部 9 项(逐项 grill)。
