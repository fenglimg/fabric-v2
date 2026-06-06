# Fabric 知识层 × 全生命周期职责设计 — v3（新 frame：multi-store × 真实有效性）

> Ground truth：`./lifecycle-baseline.md`（A 定档层 FROZEN / C 新轴 / C2 五 finding）。
> v3 = 定档层(v1/v2 已 2 轮冷评收敛，不复述) + 新轴设计 + cite 观测推断核心。

## 元定位（贯穿）

> **F-EFF-4（可观测性）是地基，先修它**。当前 `hook_surface_emitted=0` → 注入命中、cite 率、图谱有效性、全景价值**全部测不了**。三点 append 闭环修复：**SessionStart 记 surfaced / PostToolUse 记 edited / SessionEnd 对账**。其余 finding 多是"采集/推断"问题，不是架构问题——**拒绝为"填空"过度建设**（22 节点不建图谱可视化）。

## 核心创新 — cite 2.5% 靠「观测推断」而非加大 nudge

claude r3 突破，v3 主轴：cite policy 失效（2.5%）的根因是**依赖"人愿不愿手写 KB:"**。解法是把它**解耦为"系统能不能观测"**：
- SessionStart/PreToolUse 注入时 append `hook_surface_emitted`（surfaced stable_id[] + store + session_id）。
- PostToolUse 记 `file_mutated`（edited path + tool_call_id）。
- **Stop join**：本轮 surfaced 条目的 contract glob 命中实际 edited path → 弱推断 `cite:applied(inferred)`。
- 真实 cite 覆盖率 = 显式 `KB:`（人写）∪ inferred（系统观测）。**这吃掉 2.5% 的结构性低值**，且与既有 recall→edit 自动记账同源。

---

## 主轴 — 8 Hook 阶段（store 维度 + finding 解）

| # | 阶段 | 裁定 | store 维度 | 解哪个 finding（机制） |
|---|---|---|---|---|
| 1 | **SessionStart** ✅ | 保留+增强 | 读 `required_stores ∪ personal` 分 store 召回后合并；personal 同主题 overlay 优先于 team（KP-*=0 当前退化纯 team，留接口不写排序代码）；注入每条标 `team:`/`personal:` 前缀 | **F-EFF-4**：注入后 append `hook_surface_emitted`(surfaced ids+store+session_id) ·**F-EFF-5**：22 节点直接升 k 列全集 description（不建地图）+ per-store 全景摘要头(每 store count/类型/graph density，density=0 诚实显示"graph empty") |
| 2 | **SessionEnd** ❌→激活(轻) | 无召回/无写知识 | 仅 telemetry 收口：append `session_close`(本会话 surfaced/cited/edited 命中数，按 store 分组) | **F-EFF-4 读侧闭环**：每会话一次对账 surfaced→cited→edited funnel（每会话一次≠每轮，合规 O(1)）。**反对**在此塞 archive nudge（Stop 职责） |
| 3 | **UserPromptSubmit** ❌ | **保持盲（裁定：3:1）** | — | **无 ROI**：高频阶段默认不接；cite reminder 已被 rc.34 删迁 PreToolUse 证明此处无效；cite 提升改由观测推断(核心创新)解，不需在此加 reminder |
| 4 | **Stop** ✅ | 保留+增强（cite 推断核心） | 首行 `KB:` 收割解析 store-qualified（`team:`/`personal:`）；容忍裸 id(legacy)回填 store(默认 team)；archive nudge 提示"写哪个 store"但实际路由在 skill | **F-EFF-3（核心）**：surfaced×edited join → `cite:applied(inferred)` ·**F-EFF-4**：轮次级 telemetry append ·**F-EFF-1**：archive 成功 append `graph_edge_candidate_requested`(下沉 doctor/skill 产边，hook 不跑 LLM) |
| 5 | **StopFailure** ❌ | 不可接(守 B2) | — | 无真实 hook 事件；失败轮知识下沉 doctor 离线或下个真实 Stop 被动捕获；不强造埋点 |
| 6 | **PreToolUse** ⚠️ | 保留窄+telemetry | narrow 召回标 store 前缀；`cite-policy-evict` 识别 store-qualified 但不阻断(nudge 非 gate)；**反对**扩 Read/Bash(只读不在 cite 范围) | **F-EFF-4**：narrow 注入 append `hook_surface_emitted`(窄域版，surfaced→edited join 的左半边) ·**F-EFF-3**：首行检查保留但降低期待，真正提升靠 Stop 观测推断 |
| 7 | **PostToolUse** ❌→激活 | 落成功 mutation(定档层已定) | 更新 session mutation 计数 | **F-EFF-4（右半边）**：append `file_mutated`(edited path + tool_call_id)，per-call key `.cache/..._${tool_call_id}.json` 配对(避并行竞态)；与 surfaced join 算真实消费转化 |
| 8 | **PostToolUseFailure** ❌ | 不可接(守 B2) | — | 无真实事件；失败并入 PostToolUse status 或 doctor 派生 |

---

## 另 3 类 lifecycle

| lifecycle | 裁定 |
|---|---|
| **Todo** | 保持盲（8 hook 无 todo-transition 事件，B3 锁定）；若观测仅经 TodoWrite 当 PostToolUse matcher，低优先 |
| **Skill 内容/压缩** | `PreCompact` 只 append `precompact_observed`（注入能力未 grounding，round2 已裁）；纯问答 cite 兜底走 SessionStart 全集 description（升 k）+ 观测推断 |
| **会话模式/store⊥session 双轴** | session_id-scoping(定档层) **×** store-scoping(新轴)正交：每 event 带 session_id + 节点打 `store:` 标签防跨库污染；read-set = required_stores ∪ personal；personal→team 泄露强 warning |

---

## 3 个分歧裁定（主裁，grounded）

1. **UserPromptSubmit 接不接** → **不接**（agy/gemini/claude vs codex = 3:1）。codex 的关切（纯问答轮 cite 无提醒点）真实，但 claude 给了更好的解：cite 靠 Stop 观测推断，不靠"某阶段加 reminder"。rc.34 已实证此处 reminder 无效。
2. **全景怎么做** → **当前规模(22 节点)升 k 列全集 description**（claude）+ **per-store 全景摘要头**（codex，多 store 下看每 store count/density）。**不建可视化/冷热地图**（claude 反对成立：22 节点不值）。规模增长后再议按需全景。
3. **图谱边谁产、在哪产** → **hook 不产边**（claude/codex：hook 跑不了 LLM、不 require server 包）。Stop 只 append `graph_edge_candidate_requested`；实际抽 `related` 边在 **fabric-archive skill**（LLM 有上下文）或 **doctor 后台共现分析**（agy 的共现下沉 doctor）。gemini 的"archive 时 related_to 必填、孤岛拒入库"作为 **skill 产出要求**保留。

---

## 净变更（v3，相对当前实现）

- **修地基 F-EFF-4（最高优先）**：SessionStart/PreToolUse append `hook_surface_emitted` · PostToolUse append `file_mutated` · SessionEnd append `session_close` 对账。三点闭环让 `hook_surface_emitted=0` 翻转。
- **cite 2.5% → 观测推断**：Stop join surfaced×edited → `cite:applied(inferred)`，不加大 nudge。
- **multi-store 落地**：分 store 召回合并 + 注入标 store 前缀 + cite store-qualified + 节点 store 标签 + personal→team 泄露护栏 + store⊥session 双轴。
- **全景**：升 k 全集 description + per-store 摘要头（不建地图）。
- **图谱**：hook 不产边；Stop append 候选 + skill/doctor 产边；当前 0 边诚实显示"graph empty"。
- **激活**：SessionEnd(telemetry 收口)、PostToolUse(mutation+消费)。
- **保持盲**：UserPromptSubmit / StopFailure / PostToolUseFailure / Todo。
- **定档层全保留 frozen**（events 单账 / KT-DEC-0007 / O(1) / 并发锁 / PostToolUse 闭环 / session fallback）。

## 本版核心主张
> **先修可观测性地基（F-EFF-4 三点闭环），再把 cite 从"手写声明"转为"观测推断"——多 store 下每条信号 store-qualified、节点打物理标签、personal 不泄露 team；图谱与全景在 22 节点规模按"诚实显示空 + 升 k 覆盖"处理而非过度建设。知识层从"空转假设"转为"先可观测、再谈有效"。**
