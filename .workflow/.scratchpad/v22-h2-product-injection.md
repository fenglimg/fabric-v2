# V2.2 H2 — 同空间产品「注入/上下文预算治理」对比

研究边界: 只看注入/上下文预算的**分档·裁剪·session 去重**这层治理机制。不碰检索打分算法(另一条线), 不碰 store provenance(归 northstar)。所有 file:line 均为只读核验。

---

## 1. maestro-flow — context-remaining 驱动的「降级阶梯」

### 1.1 注入预算如何分档与裁剪

核心: `src/hooks/context-budget.ts`。它**不按 token 数算**, 而是读「剩余上下文百分比」(statusline 写进 bridge 文件), 按 4 档降级:

- 阈值定义 `context-budget.ts:40-45`:
  - `> 50%` remaining → `full`(原样注全部)
  - `35–50%` → `reduced`(markdown-aware 截断, `DEFAULT_MAX_CHARS=4096`)
  - `25–35%` → `minimal`(只留 headings)
  - `< 25%` → `skip`(完全不注)
- 决策入口 `evaluateContextBudget(specContent, sessionId)` `context-budget.ts:55-92`。**无 metrics 时默认 full**(`:64-66`, "be generous")。
- **markdown-aware 截断** `truncateMarkdown(content, maxChars)` `context-budget.ts:121-169`: 保留每个 section 的 heading + `---` 分隔 + 首段, 其余折叠为 `[... N lines omitted]` 占位(`:138`/`:165`)。这是「结构感知截断」, 不是粗暴 `slice`。
- **minimal 档** `extractHeadingsOnly` `context-budget.ts:175-180`: 只抽 `^#{1,6}` 行, 加一句 "headings only — context limited"。
- bridge 读取 `readRemainingPct` `context-budget.ts:98-111`: 读 `tmpdir()/maestro-ctx-{sessionId}.json`, 带 `STALE_SECONDS=60` 过期保护(constants.ts:`STALE_SECONDS`), 过期/缺失/解析失败一律返回 null → full。

注入侧消费 `src/hooks/spec-injector.ts:215-247`: 先 `maxContentLength` 硬裁(`:211-213`), 再过 budget; `skip` 档直接 `inject:false`(`:217-229`), 其余把 `budget.content` 作为 advisory `additionalContext` 注入(非改写 prompt)。

### 1.2 session 去重 / 隔离

两套 per-session sidecar 文件(都在 `tmpdir()`, 文件名带 `{sessionId}` → 天然 session 隔离):

- **context bridge**: `maestro-ctx-{sessionId}.json`(`BRIDGE_PREFIX`, constants.ts), statusline 产, budget 消费。
- **keyword 注入去重**: `src/hooks/spec-bridge.ts` — `maestro-spec-kw-{sessionId}.json`(`SPEC_KW_BRIDGE_PREFIX`)。结构 `{session_id, injected_keywords[], injected_entries[], updated_at}`(`spec-bridge.ts:19-24`)。
  - `markInjected` 加性合并、永不删(`spec-bridge.ts:50-80`)。
  - `filterUnjected(sessionId, entries)` 按 entry id 过掉本 session 已注入项(`spec-bridge.ts:104-113`)。
  - 消费点 `keyword-spec-injector.ts:125-150`: 命中 entry 先 `filterUnjected` → 全去重则 `inject:false`(`:126-139`, reason `all-deduped`) → 取前 `MAX_ENTRIES_PER_INJECTION=5`(`:58`/`:142`)注入 → 再 `markInjected` 落账。

### 1.3 解决什么问题

主治「**低上下文健康**」(context 快满时还硬注 spec → 加速 autocompact / 挤掉真实工作上下文)。降级阶梯让注入随剩余预算优雅缩水而非一刀切。keyword dedup 主治「同一 keyword 在多轮 prompt 反复命中 → 重复注入膨胀」。

---

## 2. noosphere — token-bounded 双 cap + summary fallback + verbosity 分档

### 2.1 注入预算如何分档与裁剪

核心: `src/lib/memory/budget.ts` 的 `ContextBudgetManager`(class)。这是**真·token 预算**(maestro-flow 是百分比代理量)。

- **双 cap** `budget.ts:18-36, 79-82`:
  - `maxTokens`(硬 token 上限, 默认 `2000`)
  - `maxResults`(硬条数上限, 默认 `20`)
  - 两 cap 独立: 先 `slice(0, maxResults)` 砍条数(`apply()` `budget.ts:113-114`, 记 `droppedByResultCap`), 再跑 token 预算(`:122-158`)。
- **summary-first 降级** `budget.ts:99, 195-199`: 默认 `summaryFirst=true` — 优先用 `result.summary` 顶替 full `content` 以塞下更多条。
- **token 不够时的 fallback 链** `apply()` `budget.ts:127-147` + `selectFallbackContent` `:202-231`: 若全文超预算, 退到 summary; summary 仍超 → 该条及之后**整体停**(`:143-146`, "stop here to preserve ranked order"), **刻意不跳过低排名小条**以保持 ranked 顺序(留 `droppedByTokenBudget` 计数)。
- **verbosity 三档** `BudgetVerbosity = minimal | standard | detailed` `budget.ts:16, 184-200`:
  - `detailed` → 全文, 不降级
  - `standard`(默认) → summary 优先 + title
  - `minimal` → 仅 summary 且每条再硬截到 `MINIMAL_PER_RESULT_TOKEN_CAP=60` tokens(`:84-86, 252-256`)
- **丰富 accounting** `BudgetResult` `budget.ts:38-59`: `tokensUsed / trimmedCount / droppedCount / droppedByResultCap / droppedByTokenBudget` — 可观测性远超 maestro-flow 的单一 budgetAction。

### 2.2 session 去重 / 隔离 + 注入路径

- budget 只在**注入路径**生效: orchestrator `recall()` 仅当 `query.mode === "auto"` 才 `applyRecallBudget`(`orchestrator.ts:200-206, 583-600`), 然后 `formatPromptInjection` 生成 `promptInjectionText`(`:207-210`)。非 auto 模式只做 `slice(0, cap)` 不跑 token 预算。token 预算可 per-query override(`query.tokenBudget`, `:184-188`)。
- 去重在**另一层**(cross-provider, 非 session): `CrossProviderDeduplicator` 在 budget **之前**跑(`orchestrator.ts:397-423`), 治「多 provider 返回同一条记忆」, 不是「跨 session 重复注入」。noosphere 此处**无 maestro-flow 式 per-session 注入 dedup**。

### 2.3 解决什么问题

主治「**payload 膨胀**」: 给注入到 prompt 的记忆一个**确定性 token 上限**, 用 summary/verbosity 在固定预算内尽量多塞高价值条目, 且全程留账(dropped/trimmed 计数)便于调参。

---

## 3. valence + persistor — 仅「条数 cap + 静态 snippet 截断」(无 token 预算)

任选 ≥1 它产品, 取两个对照, 共同结论: **都没有 token-budget 分档, 也没有 markdown-aware/降级阶梯, 只有 count cap + 定长 snippet 截断。**

- **valence** `src/valence/mcp/handlers/memory.py`:
  - `memory_recall` 只有 `limit`(条数), clamp 到 `max(1, min(limit,50))`(`:127`), 加 `RECALL_OVERFETCH_MULTIPLIER` 过取再后过滤(`:136`), 命中 `limit` 即 break(`:220-221`)。`memory_list` 同样仅 `limit` clamp `1..200`(`:380`)。
  - 唯一「裁剪」是 `SNIPPET_TRUNCATE_LENGTH = 200`(`:27`)定长字符截断, 非 token 感知、非结构感知。
- **persistor** `extensions/memory-persistor/unified-search.ts`:
  - query 定长 `slice(0,500)`(`:112`)、`config.persistor.searchLimit`(`:113`)、`maxResults` 默认 20 + `minScore` 过滤后 `slice(0, maxResults)`(`:187, 212`)。同样纯条数 cap。

→ 这两个属「检索层 limit」语义, 治的是 DB 过取, 不是 prompt 注入预算治理。对 Fabric 注入治理**无新增可借鉴点**(Fabric 已有 top_k cap 等价物)。

---

## 4. 对照 Fabric 现状 — already-have vs 真可借鉴

Fabric 现状(任务给定 + 行为规则): per-session dedup 走 session-hints sidecar; `hint_broad_top_k` / `narrow_top_k` 条数 cap; SessionStart 注 full 列表; **无 token-budget 分档**。

### 4.1 already-have(诚实标, 不为吸收而吸收)

- **per-session 注入 dedup** = maestro-flow `spec-bridge.ts` 的等价物。Fabric 已有 session-hints sidecar(per-session 隔离 + 已注入去重), 机制对等, **already-have, 不吸收**。
- **条数 cap** = maestro-flow `MAX_ENTRIES_PER_INJECTION=5` / noosphere `maxResults` / valence `limit` / persistor `maxResults` 的等价物。Fabric `hint_broad_top_k` / `narrow_top_k` 已覆盖, **already-have, 不吸收**。
- **query 定长硬裁 / maxContentLength** = persistor `slice(0,500)` / maestro-flow `maxContentLength`。属粗粒度兜底, Fabric 若需可低成本加, 非核心痛点, **不列为主候选**。

### 4.2 真可借鉴候选(标 hook-injection pain_target)

按 ROI / 与 Fabric「SessionStart 注 full 列表 + 无 token 分档」缺口的贴合度排序:

1. **[pain_target: SessionStart full-list 无上限膨胀] context-remaining 降级阶梯**
   源: maestro-flow `context-budget.ts:40-92`。Fabric SessionStart 当前**无条件注 full broad-list**, 大 KB / 长会话末期会挤占上下文。可借鉴**剩余预算 4 档降级(full/reduced/minimal/skip)**, 让 SessionStart 注入随上下文健康优雅缩水。**最贴 Fabric 当前缺口**。

2. **[pain_target: 注入正文膨胀 — 结构无关的粗裁] markdown-aware 截断**
   源: maestro-flow `truncateMarkdown` `context-budget.ts:121-169`。Fabric KB 条目本身是 markdown(headings/sections)。reduced 档可保 heading + 首段、折叠 body 为 `[... N omitted]`, 比定长 `slice` 保信息密度。与候选 1 配套。

3. **[pain_target: 注入无确定性 token 上限] token-budget 双 cap + summary fallback**
   源: noosphere `budget.ts` `ContextBudgetManager`(`maxTokens`+`maxResults` 双 cap、summary-first、ranked-order 停止策略)。Fabric 现仅条数 cap, 无 token 维度; KB 条目 description/body 长度差异大, 条数 cap 不能 bound payload token。可借鉴**token 维度硬上限 + summary(用 description 顶替 body)fallback**。比候选 1 更精确但实现更重。

4. **[pain_target: 注入治理不可观测 — 无法调参] budget accounting 计数**
   源: noosphere `BudgetResult` `budget.ts:38-59`(`tokensUsed/trimmedCount/droppedByResultCap/droppedByTokenBudget`)+ maestro-flow `logInjectionEvent`(spec-injector 全程埋 budgetAction)。Fabric 注入治理若引入分档/截断, **必须配套埋点**(否则黑盒无法调阈值)。低成本、与 v2.1 INSTR/T3 埋点债同源, 建议随候选 1/3 一并落。

### 4.3 不借鉴(明确排除)

- noosphere cross-provider dedup(`orchestrator.ts:397-423`)— 治多源去重, Fabric 多 store 归 northstar, 本线不碰。
- valence/persistor 的检索层 limit — 与 Fabric top_k 等价, already-have。
- noosphere verbosity 三档作为**用户配置面**可选吸收, 但其 minimal 档「每条硬截 60 token」偏激进; Fabric 若做先做候选 1/3 的机制, verbosity 作为后续 polish。
