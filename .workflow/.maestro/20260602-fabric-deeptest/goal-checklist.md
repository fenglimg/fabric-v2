# Goal Checklist — Fabric 深度测试(补 fulltest 的洞)mode ③

> **真源 `status.json`**。前身 `20260602-fabric-fulltest`(8 门绿,但 frame 有洞——本 goal 补洞)。
> 诚实前提:fulltest 在小语料 + 单用户 + Claude Code 单端测的,以下是它结构性漏掉的真实场景。

## 目标(terminate 判据 — 10 门全绿即 auto-completed)
10 扇深度门各达成,或诚实标 `needs-real-env`(无法全自动的标出来浮用户,不假装测过)。confirmed bug 修+验,回归绿。

## 10 扇门(按重要性)
| 门 | 测什么 | 可模拟性 |
|---|---|---|
| **G-SCALE** 🔴 | 造 1000s 条合成语料 → BM25 排序区分度/top_k/payload 截断/上下文溢出/延迟 | L-DET |
| **G-MULTIUSER** 🔴 | bind team store → 2 clone 模拟双开发者 → A push / B pull / B recall 搜到 | L-DET |
| **G-SYNC** 🔴 | `fabric sync` 真 pull--rebase+push + 冲突 `--continue`/`--abort`(复查 F57/F58) | L-DET |
| **G-FAILPATH** | 损坏 meta/events、断网 sync、git 冲突、磁盘满 → 降级行为 | L-DET |
| **G-CROSSCLIENT** | Codex/Cursor **真运行** hook/MCP(非仅查配置 F5) | L-PARTIAL(可能需真客户端) |
| **G-COLDSTART** | clone 干净 repo → install → 第一次用 端到端新人体验 | L-DET |
| **G-PERF** | recall/plan_context/doctor 延迟+token+内存 **定量** | L-DET |
| **G-CANDIDATE-CLOSE** | fulltest 6 candidate(F5/F9/F13/F14/F15/F17)深验到终 verdict | L-DET |
| **G-EFFICACY-2** | 剩余 L-LLM 面冷评(review/import skill、narrow 注入、description 质量) | L-LLM |
| **G-FIX-REVERIFY** | 4 个已修 bug(F8/F11/F18/F10)dev build 真 app 复验(非仅单测) | L-DET |

## 执行准则(每 `/goal-mode continue` 单步)
1. 取一扇门 → deterministic 实跑(造语料 / 2 clone 模拟多人 / 真 sync / 注入失败 / dev build 跑)
2. **LIBERAL capture**:像 bug 的、设计疑惑、efficacy 弱 全记 findings,verify 阶梯判 confirmed/refuted
3. confirmed bug → 修 + deterministic 验证
4. **L-PARTIAL 门诚实标注**:跨客户端等无法全自动的,标 `needs-real-client` 浮用户,**不假装测过**
5. 6 candidate 逐个深验到终 verdict;剩余 L-LLM 面发多-LLM 冷评(quorum)
6. 每 wave 收口 commit;回归门必绿

## 边界
**IN**: 7 宏观+微观洞 · 造合成语料/模拟多人/真 sync/注入失败 · 6 candidate 深验 · 剩余冷评 · 4 fix 复验
**OUT**: 3 功能实现(那是 followup-impl goal)· KP-leak(多-store 已基本解)· 已修 4 bug 重修
**CONSTRAINTS**: deterministic 实跑 · 跨客户端不能全自动须诚实标 · 合成语料用完清理不污染真库 · sync/push 真 remote 前确认 synthetic 安全

## Resume
续跑 `/goal-mode continue`;10 门全绿(或诚实标 needs-real-env 闭合)时自动 `status=completed` + `[[FINAL_NOTIFICATION]]`。
