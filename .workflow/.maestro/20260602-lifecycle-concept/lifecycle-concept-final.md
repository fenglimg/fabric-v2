# Fabric 知识层 × 全生命周期职责设计 — 最终版

> 收敛产物。多-LLM panel(codex/gemini/claude-delegate/agy)+ claude 主裁判,5 轮迭代 + 1 次 human frame-pivot。
> 真源链：`lifecycle-baseline.md`(多轴 ground truth)← 本文 ← `lifecycle-concept-eval.md`(评判 ledger)。
> 收敛依据：gap 7→3 塌缩为边界 polish、两路独立预告 PASS、v5 verbatim 补完、无新架构方向。

---

## 0. 一句话定位
> **hook 不是知识层的主体，events.jsonl 才是；前台只 O(1) append、后台 doctor 重建因果。** 设计纪律：只在能拿独占信号且不违背定档层的阶段加 append 点；多 store 下每条信号 store-qualified、物理隔离不泄露；可观测性先于有效性，诚实先于好看。

## 1. 定档层（FROZEN 不变量）
events.jsonl 单总账（multi-store 下限定为「每物理 store 账本内唯一」）· hook = nudge 非 gate（KT-DEC-0007，错误静默 exit 0）· 前台 O(1)（绝不遍历/聚合账本，只读 doctor 预算的扁平 `.cache`）· append advisory-lock 并发不抛 · 每 event 带 session_id（缺失 skip/degraded）· hook 不 require server 包 · PostToolUse 闭 mutation 环（per-call key 配对）。

## 2. 两根正交轴
- **session 轴**：每信号带 session_id；nudge 去重/cadence/self-archive-once 按 session 过滤（多窗口并发不串）。
- **store 轴**：read-set = `required_stores ∪ personal`；每节点打 `store:` 标签；cite 必 store-qualified（`team:KT-*` / `personal:KP-*`）。
- 两轴正交，独立 scoping。

## 3. cite 哲学：诚实拆分，不注水
真实有效性审计实测 cite 仅 **2.5%**（24/946）。终态设计**绝不用弱推断掩盖**：
- `cite:applied(explicit)` = 人写 `KB:` = **真遵循度**，诚实显示（仍 2.5%，是要解决的真问题）。
- `cite:exposed_and_mutated` = 曝光且路径变更 = **弱辅助信号**，独立字段，`doctor --cite-coverage` 分列，**禁止合并成稀释覆盖率**。命中需三条件：来自 narrow PreToolUse surfaced + contract glob 特异(排除 `**/*`/通用 guidelines) + 本轮未 `[dismissed]`。
- cite 提升靠**观测**(surfaced×edited join，下沉 doctor)而非加大 nudge（rc.34 已证加 reminder 无效）。

## 4. 隐私物理隔离总图（贯彻全数据面）
| 数据面 | team(`KT-*`) | personal(`KP-*`) |
|---|---|---|
| events 总账 | `./.fabric/events.jsonl`(随 git) | `~/.fabric/events.jsonl`(本地) |
| flat counter | `./.fabric/.cache/..._team.json` | `~/.fabric/.cache/..._personal.json` |
| keyed telemetry | 仅 id-free aggregate 入项目 | `~/.fabric/`(keyed) |
| 图谱 related 边 | KT→KT；**禁 KT→KP**（拓扑泄漏） | KP→KP / KP→KT(允许) |
| cite 归因 | `team:KT-*` 主键 | `personal:KP-*`，不写项目账本 |

> **铁律**：项目物理目录(`./.fabric/` 含 .cache)绝不含任何 personal 行为指纹(id/引用/计数/拓扑边)。doctor 是唯一跨轨合并者，合并态留本地，不回写项目。泄露护栏**硬编码进 `fabric-archive`/`import` skill 的 pre-flight**(hook 拦不住 skill 写入)。

## 5. 八 Hook 阶段终态

| # | 阶段 | 裁定 | 核心职责 |
|---|---|---|---|
| 1 | **SessionStart** ✅ | 保留+增强 | 分 store 召回合并(team 项目级优先/personal overlay 软提示)+ 标 store 前缀 · 注入后 append `hook_surface_emitted`(surfaced ids+store，**修 telemetry=0 地基**) · per-store 全景摘要(type count/graph density，节点<30 才附全集 description，超则按需 `fab_plan_context` 展开) · 沿 related 边二阶召回 · personal 曝光写个人账本 |
| 2 | **SessionEnd** ❌→激活 | **仅 marker** | 只 append `session_ended`(session_id+ts，零计算)。所有 surfaced→cited→edited funnel 对账下沉 doctor |
| 3 | **UserPromptSubmit** ❌ | 保持盲 | 高频引噪；cite 提升靠观测推断不靠此处 reminder(rc.34 已证无效) |
| 4 | **Stop** ✅ | 保留+增强 | store-qualified `KB:` 收割(容忍裸 id 回填) · append flat counter(分轨，不在 hook 内 join) · archive 成功 append `graph_edge_candidate_requested`(边由 skill/doctor 产) · cite 分 explicit/exposed |
| 5 | **StopFailure** ❌ | 不可接 | 无真实 hook 事件(守 B2)；失败轮下沉 doctor 或下个真实 Stop 被动捕获 |
| 6 | **PreToolUse** ⚠️ | 保留窄+telemetry | 仅 `Edit\|Write\|MultiEdit`(不扩 Read/Bash) · narrow 标 store · 沿 related 边二阶召回 · append `hook_surface_emitted`(窄域，surfaced→edited join 左半边) · cite 软检查不阻断 |
| 7 | **PostToolUse** ❌→激活 | 落 mutation | append `file_mutated`(edited path+tool_call_id，per-call key 防并行竞态) · doctor 侧 `git diff` 仅 low-confidence `mutation_pool`(需 session shell event+baseline+source_event_id 才升 fallback，否则 `unattributed_workspace_dirty`) · 归因主键 `store_id+stable_id+source_event_id` 防多 store 双计 |
| 8 | **PostToolUseFailure** ❌ | 不可接 | 无真实事件(守 B2)；失败由 doctor 派生 |

## 6. 三类 lifecycle 终态
- **Todo**：保持盲(8 hook 无 todo-transition 事件)。
- **Skill 内容/压缩**：`PreCompact` 只 append `precompact_observed`(注入能力未 grounding)；纯问答 cite 兜底走 SessionStart 全景 + 观测推断。
- **会话模式**：session⊥store 双轴落地(§2)；SubagentStop 仅 subagent provenance，不混主 agent 失败。

## 7. 图谱生命周期（F-EFF-1 真闭环）
- **生成**：archive/import skill 内 LLM 抽 `related`(有上下文) + doctor 后台共现补边；边 store-qualified；禁 KT→KP。
- **消费**：SessionStart/PreToolUse 召回沿 `related` 边追加对端节点(标 `reason: related-to-{id}`)。边=0 时诚实 no-op + 显示 `graph empty`。
- **维护**：doctor 做边 decay，与节点 decay 同步。

## 8. 五 finding → 修复映射
| finding | 真实值 | 终态解 |
|---|---|---|
| F-EFF-1 图谱空转 | related 0/22 | §7 生成(skill/doctor)+消费(二阶召回)+decay 闭环 |
| F-EFF-2 multi-store 当下 | ~/.fabric/stores 存在 | §2 store 轴 + §4 物理隔离 |
| F-EFF-3 cite 2.5% | 24/946 | §3 拆 explicit/exposed + 观测推断(不掩盖) |
| F-EFF-4 telemetry 断 | hook_surface_emitted=0 | SessionStart/PreToolUse 记 surfaced + PostToolUse 记 edited + doctor 对账(三点闭环) |
| F-EFF-5 personal 空+非全景 | KP=0 / top8 | §5#1 per-store 全景摘要 + 按需展开;personal 冷启动(可选)由 skill 处理 |

## 9. 实现期注记（非概念，留编码阶段）
hook 双路复用写(store 前缀拆包，两 advisory-lock 路径) · `.cache/panorama.json` 由 doctor/server 异步预编译(hook 不现算) · 全景全集阈值(暂 30) · `unattributed_workspace_dirty` 等字段命名。

## 10. 核心主张
> 可观测性是地基(先修 `hook_surface_emitted=0`)，诚实是底线(cite 真遵循度 2.5% 绝不被弱推断稀释)，隔离是铁律(个人知识的 id/引用/计数/拓扑边绝不落项目物理目录)，下沉是纪律(所有 join/funnel/边生成交 doctor，前台只 O(1) append)。Fabric 知识层从「空转假设」转为「可观测、可信、不泄露、真闭环」。
