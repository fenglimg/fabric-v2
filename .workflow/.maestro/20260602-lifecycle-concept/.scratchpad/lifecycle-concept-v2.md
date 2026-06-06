# Fabric 知识层 × 全生命周期职责设计 — v2（应用 Round1 冷评 8 修正）

> Ground truth：`./lifecycle-baseline.md`。v1→v2 变更见文末「Round1 冷评应答」。

## 元原则（贯穿全设计）

1. **events.jsonl 才是产品，hook 只是它的 append 点。** 只有当某阶段能捕获**别处拿不到的独占信号**时，才新增一个 append 点。
2. **前台 O(1)、后台重。** hook 只做轻量 surface / observe / nudge（自拼 JSON + appendFileSync，不 require server 包）。**hook 绝不在执行期遍历/聚合 events.jsonl**（账本已 2.7MB+）；任何前台 nudge 要消费的统计（debt 摘要、edit-counter）一律读后台 doctor 预算写好的扁平 `.cache/*.json`（O(1) 读），或由写事件 hook append 时顺带增量累加。
3. **session_id-scoping 是不变量，但带 nudge-非-gate fallback。** 每条 event 优先写真实 `session_id`（从 stdin payload 取）；**缺失时静默 skip append 或写 `session_id:"unknown" + degraded:true`，绝不报错/阻断/改变工具结果**。所有 nudge 去重 / cadence / self-archive-once 按 session_id 过滤。
4. **所有 append 走 advisory-lock + drop-on-contention（现有 `appendLockedLine`）。** 多窗口 / 子代理并发写同一 events.jsonl 时，遭遇锁冲突 / EBUSY / EMFILE 必 try-catch 静默（退避重试或丢弃该遥测行），**并发写永不抛、永不损毁账本结构**。
5. **hook 永远 nudge 非 gate（KT-DEC-0007）。** 错误必静默 exit 0，绝不挡用户/工具。

---

## 主轴 — 8 Hook 阶段裁定

| # | 阶段 | 裁定 | 做什么 | 挂哪条 event |
|---|---|---|---|---|
| 1 | **SessionStart** ✅ | 保留 + 极轻增强 | 维持全集→评分→top8 注入；增强：top8 之上追加**一行** cross-session knowledge-debt 摘要。**关键修正**：debt 摘要**不在 hook 聚合 ledger**，而是 doctor 后台预算写 `.cache/debt-summary.json`，hook 仅 O(1) 读注入 | 沿用 `hook_surface_emitted` + injection-log |
| 2 | **UserPromptSubmit** ❌→**轻锚点（v2 反转）** | 接极轻 turn 锚点 | **不注入、不 nudge、不扫 normative 内容**。仅 append 一条 `user_prompt_seen`（**只含 `session_id` + `ts` + `turn_id`**）作为「本轮已启动」的唯一锚点。**理由**：① 消除 StopFailure 派生悖论（无此锚点，纯问答轮在 Stop 前崩溃则 ledger 完全隐形）；② 为纯问答轮的失败/引用可观测提供 turn 边界 | 新增 `user_prompt_seen`（最小锚点） |
| 3 | **Stop** ✅ | 保留，警惕过载 | 维持 archive/review/import nudge + 首行 `KB:` 收割 + session-digest 写。**修正**：edit-counter 等 cadence 判断**读增量 `.cache` 缓存，不遍历 ledger**。不再追加新职责 | 沿用 `assistant_turn_observed` / `hook_signal_emitted` |
| 4 | **StopFailure** ❌ | 不可接（保持盲） | **主 agent 回复失败无真实 hook 事件**（baseline §2）。失败检测下沉 doctor：基于 **`user_prompt_seen`（now exists）+ `edit_intent_checked` 配对缺失对应 `assistant_turn_observed`** 派生 `assistant_turn_missing`。**注**：SubagentStop 是独立真实事件，仅用于 subagent provenance（见 §会话模式），**不混为主 agent 失败抢救** | 无（doctor 派生，锚点来自 #2） |
| 5 | **PreToolUse** ⚠️半 | 保留窄 matcher | 维持 `Edit\|Write\|MultiEdit` 的 narrow-hint + cite-evict（窄覆盖对齐 cite 边界，只读 Bash 本豁免，是有意为之非缺口，应文档化）。增强 path-based ranking。**为 #6 配对预写**：把本次 `tool_call_id` + intent 写入 `.cache/session_<id>_pending_tool.json`（单键，供 PostToolUse O(1) 取关联，避免逆向解析账本） | 沿用 `edit_intent_checked` |
| 6 | **PostToolUse** ❌→**接（v2 第一实连接）** | 落成功 mutation 事实 | matcher=`Edit\|Write\|MultiEdit`，工具**成功返回后**追加 `file_mutated`（实际 path + session_id + ts + **`tool_call_id`**）。**修正**：(a) **只记成功 mutation，不声称承载失败 status**；(b) pre/post 关联**靠 `tool_call_id` 配对**（读 PreToolUse 写的单键 `.cache`，非逆向解析 ledger）；(c) 失败/缺失由 doctor 从「有 pre-intent 但缺对应 `file_mutated`」派生 `tool_result_missing`。独占价值：喂 archive-cadence 真实落盘计数 + 闭合 cite-contract（`KB:…→edit:<glob>` 承诺 vs 实际 mutation path）。纯 append 不 nudge。**[注：gemini 冷评称 PostToolUse「不存在」已 refute——baseline §1 明列其为真实工具级 hook]** | 新增 `file_mutated`（仅成功） |
| 7 | **PostToolUseFailure** ❌ | 不可接（保持盲） | **无真实失败事件**。失败由 doctor 经 #6(c) 派生，不在前台造幻象埋点 | 无（doctor 派生） |

---

## 另 3 类 lifecycle 裁定

| lifecycle | 裁定 | 理由 + 接点 |
|---|---|---|
| **Todo** | **完全保持盲（v2 收紧）** | **8 hook 里无 todo-transition 事件**；v1 的「TodoWrite 当 PostToolUse matcher 顺带观测」与「PostToolUse matcher 仅 Edit\|Write\|MultiEdit + 唯一新增 file_mutated」**自相矛盾，删除**。若未来要观测，须显式新增 matcher=`TodoWrite` + 独立 `todo_transition_observed` event（**不在本版**） |
| **Skill 内容 / 压缩** | **接 PreCompact（v2 第二实连接，从 v1「待观测」升级）** | **真漏水点（gemini）**：长会话纯问答/读取轮，AGENTS.md 的 cite policy 被压缩截断后**无任何生命周期重提醒 → 纯问答 turn 的 `KB:` 引用静默失效**。`PreCompact` 是 baseline §2 确认的真实事件。**修正时序（codex）**：在 `PreCompact`（压缩**前**触发）注入一行**可被压缩保留的最小 cite 契约**（如「reasoning 首行始终 `KB: <id>`」），兜底压缩后 cite 生存率，**不写「压缩后重注入」**（那时序不成立）。仍建议并行埋点观测 cite-coverage 随会话位置的衰减以校准 | 接 `PreCompact` → 记 `precompact_observed` + 重注入最小契约 |
| **会话模式（session_id scoping）** | **贯穿不变量（HIGH）** | 落实元原则 #3+#4 到全部 event。SubagentStop（真实事件）可记 `subagent_session_observed` 作 provenance，**不混同 StopFailure**。实质是「把现有连接做对 + 加 fallback/锁」，非加业务连接 |

---

## 净变更清单（v2，相对当前实现）

- **2 个实连接**：① PostToolUse → `file_mutated`（仅成功，tool_call_id 配对）；② PreCompact → 压缩前 cite 契约重注入（兜底纯问答轮）。
- **1 个轻锚点**：UserPromptSubmit → `user_prompt_seen`（仅 session_id+ts+turn_id，消 StopFailure 悖论）。
- **保持盲**：StopFailure / PostToolUseFailure / Todo（无真实事件或自相矛盾）。
- **硬化 3 不变量**：session-scoping + 缺失 fallback；前台 O(1) 读 `.cache`（绝不遍历 ledger）；append advisory-lock 并发不抛。
- **文档化**：PreToolUse 窄 matcher 有意为之。

## 本版核心主张
> hook 不是知识层主体，events.jsonl 才是；但「前台只 append、后台 doctor 重建」要成立，前提是**前台严格 O(1)（读预算缓存，绝不遍历账本）、并发写有锁不抛、每条 event 带 session_id 且缺失能优雅降级**。据此 v2 只在三个能拿独占信号且不违背上述前提的点动手——PostToolUse（真实 mutation）、PreCompact（纯问答 cite 兜底）、UserPromptSubmit（turn 锚点）——其余保持盲，靠 doctor 事后从锚点配对重建因果。

---

## Round1 冷评应答（3/3 BLOCK，8 confirmed / 2 refuted）

| # | gap（来源） | 处置 |
|---|---|---|
| 1 | UserPromptSubmit↔StopFailure 悖论（agy+codex） | ✅ 采纳 → #2 加 `user_prompt_seen` 锚点 |
| 2 | PostToolUse 跨进程拿 pre-id（agy） | ✅ 采纳 → #5/#6 tool_call_id 配对 |
| 3 | SessionStart/Stop 读 2.7MB 账本（agy+gemini） | ✅ 采纳 → 元原则#2 + #1/#3 读 `.cache` |
| 4 | 并发写锁（agy） | ✅ 采纳 → 元原则#4 显式化 |
| 5 | PostToolUse 臆造 failure 承载（codex） | ✅ 采纳 → #6 仅记成功 |
| 6 | Todo 自相矛盾（codex） | ✅ 采纳 → Todo 完全保持盲 |
| 7 | PreCompact 时序 + 纯问答 cite 兜底（codex+gemini） | ✅ 采纳 → Skill 升级接 PreCompact，压缩前注入 |
| 8 | session_id 缺 fallback（codex） | ✅ 采纳 → 元原则#3 |
| R1 | 「PostToolUse 不存在」（gemini） | ❌ refute → baseline §1 明列其真实存在，仅未接 |
| R2 | 「SubagentStop 抢救主 agent 失败」（gemini） | ⚠️ partial → SubagentStop 仅 subagent provenance，不混主 agent |
