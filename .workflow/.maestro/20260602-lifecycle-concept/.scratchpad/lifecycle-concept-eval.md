# 生命周期概念设计 — 评判 Ledger（panel 可评判文档）

> 真源：`../status.json`。本文件累积每轮 4-LLM 候选 + 冷评 verdict + gap。最终收敛版另存 `../lifecycle-concept-final.md`。
> Ground truth：`./lifecycle-baseline.md`（所有候选共享，禁止臆造阶段名）。

## 冷评 rubric（行为型，反膨胀）

| 维度 | 问什么 | 反膨胀红线 |
|---|---|---|
| 完整性 | 8 hook 阶段 + 3 lifecycle 是否逐一给职责 | 漏阶段 / 含糊带过 = 扣 |
| 职责清晰 | 每阶段「做什么」是否可落地、与 event 挂钩 | 空话「增强可观测性」无机制 = 扣 |
| 防 desync | 是否守 baseline 术语 + 标注失败/压缩阶段实际事件名 | 臆造不存在的 hook = 扣 |
| 守 KT-DEC-0007 | 新增阶段是否仍 nudge 非 gate | 提议硬 block = 扣 |
| ROI 诚实 | 对盲点阶段是否给「该不该接」而非无脑全接 | 为接而接、无 ROI = 扣 |

---

## Round 1

### 候选（4-LLM 各一份）— 已回收 ✅

| 候选 | 镜头 | 核心主张 | 立场 |
|---|---|---|---|
| C1-codex | backend/数据流 | 前台 hook 轻 observe/nudge + 后台 events 重建因果 | 中间偏接（补 SessionEnd/PostToolUse/Todo/session-scoping，谨慎接 UserPromptSubmit，不臆造失败 hook） |
| C2-gemini | fullstack/交互 | Pre 注入准星 + Post 闭环观测 | **最激进**（扩 PreToolUse 到 Read、SessionEnd 做 archive、PostToolUseFailure 调文件知识权重） |
| C3-claude | 最小必要/防过度埋点 | events.jsonl 才是产品，只接 PostToolUse 一个独占点，其余主动保持盲 | **最克制**（Todo 拒接、压缩先埋点后决策） |
| C4-agy | 正交找漏 | PostToolUse+PostToolUseFailure = wrong-turn X/Y 双现场；session_id scoping 是噪音生命线 | 偏接（强调 wrong-turn 信号链 + Todo Completed 触发 self-archive） |

### 主裁 synthesize → v1（`.scratchpad/lifecycle-concept-v1.md`）

**强共识（4/4 直接采纳）**：① events.jsonl 是产品、hook 是 append 点（codex+claude 同词）；② **PostToolUse 该接、全场最高 ROI**（4/4）；③ session_id-scoping 是贯穿不变量非新接点；④ StopFailure 无真实事件不可接。

**5 个真分歧 + 主裁裁决**：
1. **PostToolUseFailure**：agy 接(wrong-turn X 现场) vs claude/codex「无真实失败事件」→ **裁：不独立接，失败状态并入 PostToolUse 的 `file_mutated{status}`**（grounding 胜过理论价值）。
2. **SessionEnd**：gemini/agy 想做 archive/digest vs claude「保持盲，ledger 事后重算更稳」→ **裁：只 append 轻量 `session_ended` 边界 marker（doctor 切分锚点），不跑 digest/archive**（综合 codex 的「只 append」+ claude 的「别寄托收口」）。
3. **UserPromptSubmit**：codex 想轻量记账 normative vs claude「NO，rc.34 刻意设计，已被 Stop-harvest+self-trigger 覆盖」→ **裁：保持盲**。
4. **Todo**：gemini/codex/agy 想 Activated-surface/Completed-harvest vs claude「8 hook 无 todo-transition 事件」→ **裁：不建独立集成，TodoWrite 当 PostToolUse matcher 弱观测**（grounding 事实胜）。
5. **Skill 压缩**：三家想直接接 PreCompact 重注入 vs claude「instrument-before-optimize」→ **裁：先埋点测 cite-coverage 随会话衰减，确证再接**。

→ v1 净变更：**唯一强推新增 = PostToolUse → `file_mutated`**；SessionEnd 轻 marker；3 阶段明确保持盲；session-scoping 硬化；2 项待观测后定。

### 零上下文冷评 v1 — 已回收 ✅（3/3 BLOCK）

| 路 | verdict | 关键 gap | 镜头独特点 |
|---|---|---|---|
| agy | BLOCK | UserPromptSubmit↔StopFailure 悖论；PostToolUse 跨进程 id；SessionStart/Stop 读 2.7MB 卡；并发写锁 | 技术深水区（性能/并发） |
| codex | BLOCK | PostToolUse 臆造 failure 承载；Todo 自相矛盾；StopFailure 派生依据缺失；PreCompact 时序；session_id 缺 fallback | grounding 越界审计 |
| gemini | BLOCK | 纯问答轮 cite 静默失效（PreCompact 截断 AGENTS.md）；[误读]PostToolUse 不存在；[偏差]SubagentStop 抢救 | 交互可观测漏水点 |

**主裁聚合（verify 后）**：8 confirmed distinct gap + 2 refuted。
- refuted-1：gemini「PostToolUse 不存在」→ baseline §1 明列其真实（仅未接），desync 只涉 StopFailure/PostToolUseFailure。
- refuted-2：gemini「SubagentStop 抢救主 agent 失败」→ SubagentStop 仅 subagent 结束触发，非主 agent 失败代理。
- 8 confirmed 的 suggested fix **verbatim 采纳** → 产 **v2**（`.scratchpad/lifecycle-concept-v2.md`）。

**v2 净变更**：2 实连接（PostToolUse 仅成功 mutation + tool_call_id 配对 / PreCompact 压缩前 cite 兜底）+ 1 轻锚点（UserPromptSubmit user_prompt_seen）+ 硬化 3 不变量（O(1) 读缓存 / session fallback / 并发锁）+ Todo 收紧为全盲。

### Round 1 收敛判定

- distinct 改进数：**8**（远未收敛）　no_improvement_streak：**0/2**（本轮大改进，重置）　terminate_reason：null
- → carry round2：对 v2 起 3 路冷评，看是否 PASS / 仅 cosmetic（连续 2 轮无 distinct 改进才 converged）。

---

## Round 2

### 冷评 v2 — 进行中（lc-coldeval-{codex,gemini,agy}-r2）

_对 v2 起零上下文冷评；若 3/3 PASS 或仅 cosmetic → 计一轮无 distinct 改进。_
