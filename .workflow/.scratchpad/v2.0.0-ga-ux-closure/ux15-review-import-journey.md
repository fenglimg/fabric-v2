# UX-15 fabric-review + fabric-import 交互旅程 dogfood

## 方法
pcf 自身 .fabric (4 pending) 快照→跑 fab_review 全 action→还原。import 侧审 ref/ 流程。

## fabric-review 全 action 实跑 (snapshot-restore 已还原)
| action | response | UX 观察 |
|---|---|---|
| list | {items:[{pending_path,type,layer,maturity,origin}]} | 清晰, 路由字段齐 ✅ |
| search "server-side filter" | items:[] (空) | ⚠️ 字面 substring 无分词: 多词自然查询 (空格隔开非相邻 token) 漏命中 |
| search "server-side" | 命中 1 (含 summary) | ✅ 响应含 path/type/layer/summary |
| modify-content {maturity,tags} | {action,pending_path} | ⚠️ 不回显改了什么 (无 before/after); 须 re-read 验证 |
| defer {until} | {action,deferred:[path]} | ⚠️ 不回显 until 日期确认 |
| reject {reason} | {action,rejected:[path]} | ⚠️ 不回显去向 (rejected 目录?) |
| approve | {action,approved:[{pending_path,stable_id:KT-GLD-0005}]} | ✅ 金标准: 回显分配的 stable_id |

approve 用 git mv/git rm 提升 pending→canonical (review.ts:89,574-589) — **intentional** (保 rename detection, 留 staged move 待 commit), 非 bug。

## fabric-import 3-phase 审计
- **dedup (phase-3)**: 显式 "Semantic comparison is the LLM's job — fab_review does not compare meaning"。LLM 语义去重, 非依赖 substring → search 字面限制在 import 路径被**缓解** ✅
- **resumability (.import-state.json)**: 2-step atomic write (.tmp + mv rename(2)), crash 窗口 (A/B 间/B 中/A 前) 全覆盖, Phase 0 残留 .tmp 三分类; 状态机 P1-done/P2-done/complete + 24h re-run guard ✅ 健壮

## 结论
无 P0/P1 交互断裂。两 skill 旅程功能完整、定位无歧义。残留 P3 polish:
1. fab_review modify/defer/reject 响应过简 (不回显 what-changed/until/destination), 不及 approve 回显 stable_id 的金标准。
2. search 字面 substring 无分词 (手动 review 查询小坑; import dedup 已被 LLM 语义兜底)。
→ NEW-2 P3 defer 候选。
