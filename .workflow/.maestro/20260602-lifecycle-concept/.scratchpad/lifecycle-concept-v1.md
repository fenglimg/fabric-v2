# Fabric 知识层 × 全生命周期职责设计 — v1（待冷评）

> Ground truth：`./lifecycle-baseline.md`。术语以其为准；失败/压缩阶段标注实际事件名。

## 元原则（贯穿全设计）

1. **events.jsonl 才是产品，hook 只是它的 append 点。** 只有当某阶段能捕获**别处拿不到的独占信号**时，才新增一个 append 点；否则不接。
2. **前台轻、后台重。** hook 只做轻量 surface / observe / nudge（自拼 JSON + appendFileSync，不 require server 包）；重分析（digest、cite-coverage、archive 判断、失败诊断）一律由 doctor 事后读 ledger 重建。
3. **session_id-scoping 是非协商不变量。** 每条写入 events.jsonl 的事件必带 `session_id`（从 stdin payload 取）；所有 nudge 去重 / cadence / self-archive-once 必按 session_id 过滤。
4. **hook 永远 nudge 非 gate（KT-DEC-0007）。** 错误必静默 exit 0，绝不挡用户/工具。

---

## 主轴 — 8 Hook 阶段裁定

| # | 阶段 | 裁定 | 做什么 | 挂哪条 event |
|---|---|---|---|---|
| 1 | **SessionStart** ✅ | 保留 + 极轻增强 | 维持全集→评分→top8 注入；**唯一增强**：top8 之上追加**一行** cross-session knowledge-debt 摘要（pending>10 / archive overdue / 上会话 stale cite 数），只读 ledger 聚合 | 沿用 `hook_surface_emitted` + injection-log（debt 摘要不新增 event） |
| 2 | **SessionEnd** ❌→轻接 | 仅边界 marker | **不**跑 digest/reconcile/archive（Stop 已逐轮 harvest，doctor 事后可重算）。只 append 一条 `session_ended`（session_id + ts），纯为 doctor 切分会话提供干净锚点 | 新增 `session_ended`（轻量边界事件） |
| 3 | **UserPromptSubmit** ❌ | 保持盲 | **什么都不做**。rc.34 已刻意把 cite reminder 下沉到 PreToolUse（更贴近真实 edit 边界），不应撤销；normative 短语（"以后/always"）已被 Stop-harvest + AI self-trigger 覆盖；此处每轮触发=高频引噪 | 无 |
| 4 | **Stop** ✅ | 保留，警惕过载 | 维持 archive/review/import nudge + 首行 `KB:` 收割 + session-digest 写。**不再追加新职责**（已 4 件事挤一处）；新 mutation 信号放 PostToolUse，不塞这里 | 沿用 `assistant_turn_observed` / `hook_signal_emitted` |
| 5 | **StopFailure** ❌ | 不可接 | **无真实事件**（baseline §2：回复失败不触发 hook）。不造幻象埋点。断裂由 doctor 事后从 ledger 发现"有 prompt/intent 但无 assistant_turn_observed"派生 `assistant_turn_missing` | 无（doctor 派生，非 hook） |
| 6 | **PreToolUse** ⚠️半 | 保留窄 matcher | 维持 `Edit\|Write\|MultiEdit` 的 narrow-hint + cite-evict。**不扩 matcher**：窄覆盖恰好对齐 cite 边界（只读 Bash 本就豁免 `KB: none [not-applicable]`）；扩到 Bash/Read 会高频引噪。应**文档化"窄是有意为之"** | 沿用 `edit_intent_checked`；增强 path-based ranking boost |
| 7 | **PostToolUse** ❌→**接（唯一强推新增）** | 落 mutation 事实 | matcher=`Edit\|Write\|MultiEdit`，工具**成功返回后**追加 `file_mutated`（实际 path + session_id + ts + 关联 pre 事件 id）。**两个独占价值**：(a) 喂 archive-cadence 的 edit-counter（基于真实落盘，非意图）；(b) **闭合 cite-contract 校验**——把首行 `KB:…→edit:<glob>` 承诺与实际 mutation path 比对，doctor 稽核契约兑现。**纯 append，不在此 nudge** | 新增 `file_mutated` |
| 8 | **PostToolUseFailure** ❌ | 不独立接 | **无真实失败事件**。失败状态**并入 PostToolUse** 的 result status（`file_mutated{status:failure}`）承载；完全无 Post 事件时由 doctor 派生 `tool_result_missing`。wrong-turn 信号 defer 到平台暴露失败事件再议 | 并入 `file_mutated`（status 字段） |

---

## 另 3 类 lifecycle 裁定

| lifecycle | 裁定 | 理由 + 接点 |
|---|---|---|
| **Todo**（Created→Activated→Completed→Removed） | **不建独立集成** | **8 hook 里无 todo-transition 事件**（grounding 事实）；唯一触达是把 `TodoWrite` 当 **PostToolUse 的一个 matcher** 顺带观测（Completed 作弱 archive 提示）。按 todo-activated 主动注入会与 SessionStart 互搏、高 churn 刷屏；Completed 的决策 harvest 已被 Stop-harvest 覆盖。→ 低优先，不在 v1 主体 |
| **Skill 内容 / 5000-token 压缩** | **CONDITIONAL：先埋点后决策** | 真问题：AGENTS.md 的 cite/archive policy 以 skill-content 注入，长会话压缩只保留近 5000 token → policy 可能被截 → AI 中途停 cite。**不投机式接**：先在 events.jsonl 按 **session 内位置**统计 cite-coverage 是否随会话变长衰减（instrument-before-optimize）；**确证衰减**再接 `PreCompact`（baseline §2 确认其为实际事件，不在主轴 8 列）压缩后重注入最小 cite 契约一行 |
| **会话模式（Agent SDK / session_id scoping）** | **贯穿不变量（HIGH），非新接点** | 不新增逻辑，而是把元原则 #3 落实到**全部** event（surface/cite/edit_intent/file_mutated/digest）。多窗口并发同 repo 下，session-scoping 错则所有 per-session 信号失真。实质是"把现有连接做对"，不是"加连接"。子代理可用实际 `SubagentStop` 记 provenance，但不混同为 StopFailure |

---

## 净变更清单（相对当前实现）

- **新增 1 个 hook 连接**：PostToolUse → `file_mutated`（含失败 status）。**这是 v1 唯一强推的新埋点。**
- **轻量补 1 个边界事件**：SessionEnd → `session_ended` marker（可选，数据完整性微优化）。
- **明确保持盲**：UserPromptSubmit / StopFailure / PostToolUseFailure（无真实事件或高频引噪）。
- **文档化既有设计**：PreToolUse 窄 matcher 是有意为之，非缺口。
- **硬化不变量**：所有事件强制 session_id-scoping。
- **待观测后定**：Skill 压缩重注入（先测 cite 衰减）；Todo 弱观测（搭 PostToolUse 顺带）。

## 本版核心主张
> hook 不是知识层的主体，events.jsonl 才是。生命周期设计的纪律不是"每个阶段都接点什么"，而是"只在能拿到独占信号的阶段加一个 append 点"——据此全 11 项里只新增 PostToolUse 一个实连接，其余靠"保持盲 + 后台重算 + session-scoping 做对"达成最小而完整的闭环。
