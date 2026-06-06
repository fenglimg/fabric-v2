# Phase 0 — 多轴生命周期 Ground Truth v2（human 掀 frame 后升级，panel 必须引用）

> **升级说明**：原 baseline 困在「单 store + 真空设计」frame，round1/2 在其中收敛已作废。
> 本版加 4 轴（store / 有效性 / 图谱周期 / 全景）+ 嵌入**真实数据 grounded finding** + 显式分「定档层 FROZEN / 发现层 OPEN」。
> 术语权威=用户 Claude docs taxonomy；当前态=20260602 代码核验 + 真实 `events.jsonl`/`agents.meta.json`/`fabric-config.json` 统计。

---

## A. 定档层（FROZEN — round1/2 已真收敛，panel 不得 reopen）

这些是旧 frame 两轮冷评的收敛成果，与 store/图谱无关，**钉死，不再讨论**：
- **events.jsonl 是唯一总账**；hook 只是它的 append 点。
- **KT-DEC-0007**：hook = nudge 非 gate，错误必静默 exit 0，绝不挡用户/工具。
- **前台 O(1)**：hook 绝不遍历/聚合 events.jsonl（已 2.7MB+），只读后台 doctor 预算的扁平 `.cache/*.json`。
- **append 并发锁**：advisory-lock + drop-on-contention（现有 `appendLockedLine`），并发写永不抛。
- **session_id-scoping + fallback**：每条 event 带 session_id；缺失则 skip 或 `degraded:true`，绝不报错。
- **PostToolUse 闭 mutation 环**：PostToolUse 是真实 hook（非臆造），仅记成功 mutation，pre/post 配对靠 per-call key（`.cache/..._${tool_call_id}.json`）或下沉 doctor。
- **hook 不能 require server 包**；自拼 JSON 内联手抄字段。

---

## B. 主轴 Ground Truth（原表，保留为基础）

### B1. Hook 生命周期 × Fabric 当前态
| 层 | Claude 阶段 | Fabric 当前做什么 | 状态 |
|---|---|---|---|
| 会话级 | **SessionStart** | `knowledge-hint-broad`：全集→评分→top8 注入 | ✅ |
| 会话级 | **SessionEnd** | 无 | ❌ 盲 |
| 轮次级 | **UserPromptSubmit** | 无（rc.34 cite reminder 已删，迁 PreToolUse） | ❌ 盲 |
| 轮次级 | **Stop** | `fabric-hint`：archive/review/import nudge + 首行 `KB:` 收割 + session-digest | ✅ |
| 轮次级 | **StopFailure** | 无 | ❌ 盲 |
| 工具级 | **PreToolUse** | `knowledge-hint-narrow` + `cite-policy-evict`，仅 `Edit\|Write\|MultiEdit` | ⚠️ 半 |
| 工具级 | **PostToolUse** | 无 | ❌ 盲 |
| 工具级 | **PostToolUseFailure** | 无 | ❌ 盲 |

### B2. 术语 desync（锁定）
用户 taxonomy 的 `StopFailure`/`PostToolUseFailure` 实际无独立 hook 事件（`PreCompact`/`SubagentStop`/`SessionEnd` 另算）。失败/压缩阶段须标注实际事件名，禁止把不存在的 hook 当可用埋点。**`PostToolUse` 与 `SessionEnd` 是真实存在的 hook（仅未接），不是臆造。**

### B3. 另 3 类 lifecycle
Todo（Created→Activated→Completed→Removed，**8 hook 里无 todo-transition 事件**）/ Skill 内容（压缩保留近 5000 token，`PreCompact` 是真实事件但注入能力未 grounding）/ 会话模式（session_id scoping，多窗口并发）。

---

## C. 新轴（发现层 OPEN — 本轮重审重点）

### C1. store 轴 —— multi-store 是【当下现实】，非未来
**真实数据**：`~/.fabric/stores` 存在 + `fabric-config.json` `required_stores:[{id:personal}]` + `default_layer_filter:both`。当前 KT-*(team)=22 条、KP-*(personal)=0 条。
**设计问题（每阶段都要重答）**：
- SessionStart 从**哪些** store 取、怎么合并排序、personal vs team 谁优先？
- cite 必须 **store-qualified**（`KB: team:KT-001` / `personal:KP-003`）；当前 store-qualified cite=**0**。
- archive 写**哪个** store？personal 决策误入 team 产物 = **泄露**，要防护。
- **store ⊥ session 是两根正交 scoping 轴**（旧 frame 只想了 session）。

### C2. 有效性轴 —— 真实数据，不再假设（5 grounded finding）
| finding | 真实值 | 暴露 |
|---|---|---|
| **F-EFF-1 图谱空转** | `related` 边 **0/22 节点**；`include_related` 触发 **0** | "知识图谱"从未存在，谈不上"有效利用" |
| **F-EFF-2 multi-store 当下** | `~/.fabric/stores` 存在 + required_stores:personal | baseline 漏整根 store 轴 |
| **F-EFF-3 cite 几乎没发生** | `assistant_turn_observed` 946 中含 cite 仅 **24 ≈ 2.5%** | cite policy 形同虚设（坐实 efficacy 1/5） |
| **F-EFF-4 注入 telemetry 断** | `hook_surface_emitted`=**0**；recall 1487 / consumed 153（去重 **23**） | 注入命中率根本无法被观测 |
| **F-EFF-5 personal 空 + 非全景** | KP-*=0；`hint_broad_top_k`=8（22 节点只露 8） | personal store 空壳；注入是采样非全景 |

> **铁律**：本轮设计必须针对这些**真实失效**给修复方向，不许回到"假设知识图谱/注入/cite 都好用"的真空。

### C3. 图谱周期轴
真实：图为空（C2 F-EFF-1）。设计问题：`related` 边**谁生成**（archive 时 LLM 抽？import 时？）/ 怎么维护 / 何时失效 / 可视化 / **图 decay 与节点 decay 同步**。这根轴与生命周期强相关——边在哪个阶段产生与消费。

### C4. 全景轴
真实：top8 采样，无全景视图（C2 F-EFF-5）。设计问题：top_k 采样 vs **知识库全景地图**（类型/数量/图结构/冷热）；多 store 下全景是**合并图**还是**分 store 图**；全景在哪个生命周期阶段呈现（SessionStart 一次性？按需？）。

---

## D. 关键既有约束（保留）
- **scope 已退化**：server 端不再按 path 过滤，broad/narrow 仅排序倾向 + top_k。
- events.jsonl 唯一总账；hook 不能 require server 包（见 A 节）。

---

## E. 新 frame panel 答题任务

> 为 **8 hook × 3 lifecycle**，在 **multi-store（C1）× 真实有效性（C2 五 finding）** 约束下**重新**设计每阶段职责。每阶段必须回答：
> 1. **store 维度**：此阶段在 N 知识库下怎么做（注入选哪些 store / cite 怎么 store-qualified / 写哪个 store / 防泄露）？
> 2. **有效性修复**：此阶段对 C2 的哪个 finding 有解？（图谱空怎么填边、cite 2.5% 怎么提、surface telemetry 断怎么补、全景怎么给）——给**可落地机制**，不空喊。
> 3. **图谱周期 + 全景**（C3/C4）：related 边在此阶段生成/消费吗？全景在此阶段呈现吗？
> 4. **守定档层**：不得 reopen A 节任何不变量（events 单账 / KT-DEC-0007 / O(1) / 并发锁 / PostToolUse 闭 mutation / session fallback）。
> 5. 对盲点阶段仍给「该不该接 + ROI」；对 ✅/⚠️ 给「保留/增强/收缩」——但这次评判标准多两维：**store 正确性** + **有效性 grounded**。
