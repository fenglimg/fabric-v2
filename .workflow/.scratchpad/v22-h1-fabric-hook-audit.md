# Fabric v2.2 — H1: 知识/cite 注入 hook 源码级审计

只读审计。范围: Fabric 自身的注入/cite hook + 共享 lib。不分析 maestro hook 链, 不碰检索算法, 不碰 store provenance。

Hook 注册 (`.claude/settings.json`):
| Event | Matcher | Script |
| --- | --- | --- |
| `Stop` | `*` | `fabric-hint.cjs` |
| `SessionStart` | `*` | `knowledge-hint-broad.cjs` |
| `PreToolUse` | `Edit\|Write\|MultiEdit` | `knowledge-hint-narrow.cjs` |
| `UserPromptSubmit` | `*` | `cite-policy-evict.cjs` |
| (无 `Notification` hook 注册) | | |

`archive-hint.cjs` 在本 settings.json 中**未注册** (其 `decide()` 逻辑已被 `fabric-hint.cjs` 的 Stop hook 吸收/重实现; 二者 `decide()` 高度同源, archive-hint 是更早的独立版本)。

---

## 1. knowledge-hint-broad.cjs (SessionStart, 838 行)

### 1a. file:line 表
| 关注点 | file:line | 说明 |
| --- | --- | --- |
| Event | settings.json `SessionStart`; main `:647` | 每次 SessionStart 触发 (含 compact/clear/new-window) |
| 调的 CLI | `:385` `spawnSync("fabric", ["plan-context-hint","--all"])` | 拿 broad-scoped 全索引 |
| 渲染什么 | `:568 renderSummary` → `:488 renderFull` / `:520 renderTruncated` | **目录列表** (id · summary), 非 KB 正文; 末尾提示 `fab_get_knowledge_sections` |
| 输出通道 | stderr `:749`; stdout JSON envelope `:771-783` (`hookSpecificOutput.additionalContext`, 仅 Claude Code) | 双通道; stdout 让 model 入 context |
| TopK | `:104 DEFAULT=8`, `:185 readBroadTopK` (config `hint_broad_top_k`, 1..50), slice 在 `:688` | 膨胀治理①: 截断前先 slice topK |
| 截断阈值 | `:317 TRUNCATION_THRESHOLD=12` | >12 条走 grouped-truncation (proven 全列/verified id-list/draft 仅计数) |
| summary 长度 | `:328 DEFAULT=80`, `:330 readSummaryMaxLen` (config `hint_summary_max_len`, 40..240) | |
| cooldown | `:110 DEFAULT=0` (默认每次都发), `:197 readBroadCooldownHours` (config `hint_broad_cooldown_hours`, 0..168h), gate `:660` | 默认 0 = 无 cooldown |
| 去重/隔离 | `:113 HINT_BROAD_LAST_EMIT_FILE` 单一 last-emit 时间戳 sidecar (仅 cooldown>0 时写, `:789`) | **非 session-scoped** — 全 workspace 一个时间戳 |
| 自检 banner | `:287 shouldRecommendImport` → underseed + `/fabric-import` nudge `:732` | |
| next-step nudge | `:742-746` 双语 "下一步调 fab_recall/fab_plan_context" | |
| opaque summary 补全 | `:702 resolveOpaqueSummaries` | summary==id 时从 .md `## Summary` 取首段 |

### 1b. 定性
无状态 ambient 索引注入: 每次 SessionStart 把 broad KB **目录** (topK=8) 渲染到 stderr + stdout-context, 默认无 cooldown、无 session 隔离。

---

## 2. knowledge-hint-narrow.cjs (PreToolUse:Edit|Write|MultiEdit, 1591 行)

### 2a. file:line 表
| 关注点 | file:line | 说明 |
| --- | --- | --- |
| Event | settings.json `PreToolUse Edit\|Write\|MultiEdit`; main `:1212` | |
| 路径提取 | `:272 extractPaths` (file_path/file_paths/MultiEdit edits[]) | dedupe |
| 调的 CLI | `:747 invokePlanContextHint(cwd, paths)` `--paths p1,p2` | 拿匹配 edit 目标的窄域条目 |
| 渲染什么 | `:1179 renderSummary` → `[<id>] (<type>/<maturity>) <summary>` | **目录行**, 非正文; 末尾 "调 fab_plan_context 重读 broad" |
| 输出通道 | stderr `:1471`; stdout JSON envelope `:1488-1500` (PreToolUse `additionalContext`, 仅 CC) | |
| scope 过滤 | `:1341` 只保留 `relevance_scope==="narrow"` (rc.27 §2.5 防 broad 泄露) | |
| TopK | `:162 DEFAULT=5`, `:893 readNarrowTopK` (config `hint_narrow_top_k`, 1..20), slice `:1349` | |
| cooldown | `:184 DEFAULT=0`, `:915 readNarrowCooldownHours` (`hint_narrow_cooldown_hours`, 0..168h), gate `:1281` | |
| **去重 layer 1: session-hints cache (E3)** | `:558 readSessionHintsCache`, `:650 applyEmitGate`; 文件 `session-hints-{session_id}.json` | per-session; revision_hash 失配整体丢弃; 过滤已 hint 的 stable_id/path |
| **去重 layer 2: per-file dedup window (W2-2)** | `:1060 applyNarrowDedupWindow`; `narrow-dedup-window.json` (counter+recent ring, cap 1000 `:180`); window `:170 DEFAULT=5` turns (`hint_narrow_dedup_window_turns`, 1..50) | workspace 级 (非 session); 同 (path,id) N turn 内静默 |
| **结果缓存 (rc.37 NEW-17)** | `:839 readNarrowResultCache` / `:854 write`; `narrow-result-cache-{sid}.json` 以 agents.meta.json mtime 为 freshness token `:816` | 省 CLI cold-start; per-session, cap 50 |
| session 解析 | `:507 resolveSessionId`: payload.session_id → env FABRIC_SESSION_ID → 进程级 synthetic UUID `:519` | |
| **遥测 sidecar (E4)** | `:416 appendEditCounter` → `.fabric/.cache/edit-counter` (每 fire 一行 `{ts,paths}`) | 测**编辑**节奏, 非注入命中 |
| **遥测 sidecar (E6)** | `:476 appendHintSilenceCounter` → `hint-silence-counter` (每次静默 fire 一行 ts) | 静默率分母 (供 doctor lint #26) |
| **events.jsonl 写 (rc.35 P0-2)** | `:361 appendEditIntentToLedger` 写 `edit_intent_checked` 事件 (`ledger_source:'hook'`, 含真实 session_id `:1264`) | 喂 doctor cite-coverage 的 editsTouched |

### 2b. 定性
三层去重 (session-hints + dedup-window + result-cache) 的窄域 PreToolUse 注入: 渲染 edit 目标命中的 narrow 目录 (topK=5) 到 stderr+context, 并旁路写 edit/silence 计数 + `edit_intent_checked` 事件供 cite-coverage 审计。

---

## 3. cite-policy-evict.cjs (UserPromptSubmit, 231 行)

### 3a. file:line 表
| 关注点 | file:line | 说明 |
| --- | --- | --- |
| Event | settings.json `UserPromptSubmit *`; main `:143` | 也支持 SessionStart 模式 (Codex/Cursor) `:171` |
| 输出什么 | `:128 renderReminder` → **cite-contract 提醒文本** (非 KB, 非目录) | 重申 `KB: <id> [applied/dismissed]` + contract operator + skip 词典 |
| 输出通道 | `emitContext` (CC: stdout `UserPromptSubmit` envelope `:210`; Codex/Cursor: stderr `:180`) | |
| 触发: turn 窗口 | `:115 evaluateCiteEvict`: turnCount % interval === 0 | |
| interval config | `:61 DEFAULT=10` (rc.37 NEW-18 默认 ON), `:69 readEvictInterval` (`cite_evict_interval`, min 0; 0=OFF) | |
| 去重/隔离 | `:81 readEvictState` → `cite-evict-state.json` `{session_id,turn_count}`; session 切换计数归 1 `:200` | **per-session** (按 payload.session_id) |

### 3b. 定性
长会话 cite-policy 衰减对抗: 每 N (默认10) 个 user prompt 把 cite-contract 提醒注入 model context, per-session turn 计数, 不发 KB 内容只发规则提醒。

---

## 4. fabric-hint.cjs (Stop, 2035 行)

### 4a. file:line 表
| 关注点 | file:line | 说明 |
| --- | --- | --- |
| Event | settings.json `Stop *`; main `:1714` | |
| 输出什么 | `:1935 out.write(JSON.stringify(result))` → `{decision:'block', reason, signal}` 四信号 nudge (archive/review/maintenance/import); **非 KB 注入** | 是 archive/review **行为 nudge**, 不注入知识正文/目录 |
| cite 抓取 (核心) | `:1324 extractAndWriteAssistantTurnsBestEffort` 解析 transcript 每个 assistant turn 首 `KB:` 行 → 写 `assistant_turn_observed` 事件 `:1396`; empty-shell 折叠进 metrics.jsonl 计数 `:1409` | cite-coverage **采集端** |
| cite 解析 | `:1256 parseKbLine` (用 lib/cite-line-parser.cjs `:32`) | |
| **cite contract 软提醒 (L1)** | `:1652 emitCiteContractRemindersBestEffort` (用 lib/cite-contract-reminder.cjs) → `⚠ KB:<id> ... missing contract` | decision/pitfall [recalled] 缺 contract 时提醒 |
| 信号 decide | `:654 decide` (A archive/B review/C underseed/import) + `:1127 evaluateMaintenanceSignal` (D) | |
| cooldown | A/B/C 共享 hours cooldown `:1922` (`archive_hint_cooldown_hours` 默认12); D 用 day-based last-emit `:1913` | |
| 去重/隔离 | shown-cache (per-signal 时间戳, 非 session); per-signal dismiss `:1902 readDismissedSignals` (config `hint_dismiss_signals` + session sidecar) | |
| 客户端检测 | `:1290 detectClient` (lib/client-adapter) → 事件 client 标签 | |

### 4b. 定性
Stop hook 是 cite-coverage 的**采集与审计端** + archive/review 行为 nudge 端 (4 信号), 它**不注入 KB**; 把 transcript 的 `KB:` cite 行落成 `assistant_turn_observed` 事件并对缺 contract 的 decision/pitfall cite 软提醒。

---

## 5. lib/cite-line-parser.cjs + lib/cite-contract-reminder.cjs

### 5a. file:line
| | file:line | 说明 |
| --- | --- | --- |
| parser: id 正则 | `:29 ID_RE = /^K[TP]-[A-Z]+-\d+$/` | KT/KP 前缀 |
| parser: sentinel | `:30 SENTINEL_RE` `KB: none [..]` | |
| parser: full 行 | `:33 FULL_RE` 多 id (逗号) + (用法) + [tag] + → contract | rc.27 §2.18 多 id |
| parser: tag 词典 | `:37 ALLOWED_TAGS` = applied/dismissed (新) + planned/recalled/chained-from/none (legacy) | rc.37 NEW-1 2-state |
| parser: contract tail | `:59 parseContractTail` operator edit/!edit→not_edit/require/forbid + skip:<reason> | |
| reminder: type map | `:59 readKnowledgeTypeMap` 从 agents.meta.json 建 stable_id→type | |
| reminder: 过滤 | `:122 formatContractMissingReminders`; `:42 CONTRACT_REQUIRED_TYPES`= decision/pitfall | 仅这两类要 contract; 按 **`recalled` tag** 判 `:135` |

### 5b. 定性
纯函数 CJS 双胞胎 (TS 源的手抄 parity 版): parser 把 `KB:` 行解析成 {ids,tags,commitments}; reminder 仅对 decision/pitfall + `recalled` tag + 空 contract 的 cite 产出软提醒行。

---

## 现状能力清单

注入侧:
- SessionStart broad **目录**注入 (topK=8, 截断阈值12, summary 80字, opaque-summary 回填, next-step nudge)
- PreToolUse narrow **目录**注入 (topK=5, scope==narrow 过滤, 三层去重: session-hints/dedup-window/result-cache)
- 双通道输出: stderr (human) + stdout `hookSpecificOutput.additionalContext` (model in-context, 仅 CC)
- i18n (banner-i18n, fabric_language)
- 注入内容均为**目录行 (id·summary)**, 不是 KB 正文 — 正文靠 AI 主动调 fab_recall/fab_get_knowledge_sections

cite 侧:
- UserPromptSubmit 周期 cite-contract 提醒 (interval 默认10, per-session turn 计数)
- Stop hook cite **采集** (assistant_turn_observed 事件 + empty-shell metrics 折叠) + L1 contract 软提醒
- doctor `--cite-coverage` 审计 (本审计范围外的 CLI)

治理/旋钮:
- 61 个 fabric-config 字段; 注入相关: hint_broad_top_k / hint_narrow_top_k / hint_summary_max_len / hint_broad_cooldown_hours / hint_narrow_cooldown_hours / hint_narrow_dedup_window_turns / hint_reminder_to_context / cite_evict_interval / hint_dismiss_signals / cite_policy_enabled
- 去重: broad 单 last-emit 时间戳; narrow 三层; cite-evict per-session 计数; Stop per-signal shown-cache + dismiss
- 遥测: narrow 侧 edit-counter + hint-silence-counter (静默率); Stop 侧 assistant_turn_observed + metrics.jsonl 计数

---

## 缺口清单 (已验证)

### 缺口 1 — 无 always-inject pin (确认真缺)
config schema (`packages/shared/src/schemas/fabric-config.ts:57-362`) **没有** `always_knowledge_ids` 或任何 pin/钉死字段。两注入 hook 完全依赖 `plan-context-hint` 的 scope/relevance 检索结果, 没有"无视检索、某条 KB 每次必 surface"的旁路。broad 只有 topK 截断 (`knowledge-hint-broad.cjs:688`), narrow 只有 scope 过滤 + topK (`:1341/:1349`); 任何条目掉出 topK 即不出现, 无法被钉住。**真缺口。**

### 缺口 2 — 无 per-injection telemetry / 注入命中率 (确认真缺, 部分相邻能力存在)
现有 sidecar 测的都不是"注入命中":
- `edit-counter` (`knowledge-hint-narrow.cjs:416`) = 编辑节奏
- `hint-silence-counter` (`:476`) = 静默 fire 数 (能算"narrow 静默率"分母, 但不记录哪些 id 被注入、是否被后续 cite 命中)
- `assistant_turn_observed` (`fabric-hint.cjs:1396`) = cite 采集 (注入的**消费端**信号, 不是注入端结构化日志)

**没有任何 hook 在注入时写一条结构化记录** ("SessionStart/PreToolUse 注入了 ids=[X,Y], scope, session, ts")。因此无法量化"注入了 X → 后续被 cite/被 edit 命中"的闭环命中率。schema 也无 `injection_telemetry`/`inject_log` 开关。**真缺口** (相邻的 silence/edit 计数存在, 但 injection→hit 归因链断裂)。

### 缺口 3 — SessionStart full 列表膨胀治理: 有分档, 但**无 token/字节 budget** (部分缺)
**已有**的膨胀治理 (非真空):
- topK 硬上限 8 (`hint_broad_top_k`, schema `:266`)
- 截断阈值 12 → grouped-truncation 三档 (proven 全列 / verified id-list / draft 仅计数, `knowledge-hint-broad.cjs:520`)
- summary 截断 80 字 (`hint_summary_max_len`)
- opaque-summary 回填避免 "id·id" 噪声

**缺**的: 没有按 **token/字节预算**分档的治理 — topK 是固定条数, 不感知每条 summary 实际长度之和; 没有 "broad banner 总字节 ≤ N" 的 budget 字段。schema 无 budget 类字段。即膨胀治理是"条数+单条长度"维度, **缺总量 budget 维度**。算半个真缺口。

---

## 意外发现

1. **archive-hint.cjs (321行) 在 settings.json 中未注册** — 它是 Stop hook archive/review 逻辑的早期独立实现, `decide()` 与 fabric-hint.cjs `:654 decide()` 高度同源 (archive>review 优先级一致)。现役 Stop hook 是 fabric-hint.cjs。archive-hint 是 dead/legacy 注册, 维护两份 `decide()` 有 drift 风险。

2. **lib/cite-contract-reminder.cjs 按 legacy `recalled` tag 过滤** (`:135 citeTags.includes("recalled")`), 但 rc.37 NEW-1 已把 cite 词典简化为 `applied`/`dismissed` (parser `:37` 同时接受新旧)。L1 软提醒只匹配老 `recalled` tag — 新 `[applied]` cite 缺 contract 时**不会**触发 L1 提醒。这是注入/cite 侧的一个 tag-vocabulary drift, 可能让缺 contract 的提醒在新词典下静默失效。

3. **broad hook 去重不 session-scoped** (`:113` 单一 last-emit 时间戳), 与 narrow/cite-evict 的 per-session 隔离不一致; 多窗口并发 (用户已知偏好) 下 broad cooldown 会跨会话互相抑制。
