# Fabric v2.2 M1 — MCP 知识工具"工具面设计"源码级审计

只读审计。聚焦三个无人管的维度: **工具粒度 / one-shot 打包 / 引导 AI 调用**。
严格避开 store provenance / store-qualified cite / 多 store read-set / required_stores (归 v2.1 northstar D7)。不碰检索打分算法。

注册处: `packages/server/src/index.ts:164-169` 串行注册 6 工具 (无网关/聚合层)。
全部走同一信封模式: `awaitFirstReconcileGate` → `ensureKnowledgeFresh(autoHealOnDrift)` → service → `enforcePayloadLimit` → `{ content:[text], structuredContent }`。

---

## 1. fab_recall — 单步拿回 KB 正文 (rc.37 NEW-3)

| 维度 | 证据 (file:line) |
| --- | --- |
| 签名(入参) | `recallInputSchema` @ `api-contracts.ts:375-426`: `paths`(min 1, required) + 可选 `intent / known_tech / detected_entities / client_hash / correlation_id / session_id / layer_filter / target_paths / ids` |
| 签名(出参) | `recallOutputSchema` @ `api-contracts.ts:428-472`: `revision_hash, stale, selection_token, entries[], candidates[], preflight_diagnostics[], rules[]{stable_id,level,path,body}, selected_stable_ids[], diagnostics[], warnings?, auto_healed?, redirects?` |
| 注册 | `tools/recall.ts:27-35` |
| 粒度 | **真 one-shot**。service `services/recall.ts:53-117` 内部串 `planContext`→`getKnowledgeSections` 两个 service **进程内调用**(非两次 MCP 往返)。`ids` 省略 = 取 `candidates` 全集 (`recall.ts:71` `effectiveIds = rewrittenIds ?? candidateIds`)。AI 一次往返拿到全部 body。 |
| 返回结构 | 返**全候选** `candidates[]` + **全 body** `rules[]`,无 top-N 截断。唯一上限 = 64KB hard / 16KB warn (`mcp-payload-guard.ts:24-25`)。 |
| payload 引导 | 超 warn 时 `recall.ts:86-95` 注入 warning,`action_hint`= "Pass an explicit `ids` array to scope fab_recall, or fall back to the two-step flow"。**这是 6 工具里唯一给出"如何收敛 payload"具体引导的工具**。 |
| 何时退化两步 | 仅当单次 body 撑爆 64KB hard → 抛 `MCP_PAYLOAD_TOO_LARGE`,AI 才需改走 `ids` 子集或两步法。description (`recall.ts:31`) + AGENTS.md 行为规则都把它定为默认入口。 |
| 引导 AI 调 | description `recall.ts:31` 明说"single round-trip / collapses ceremony" + AGENTS.md「行为规则」首选单步 + SessionStart hook nudge (见 §7)。 |

**结论**: fab_recall 已达成 OpenAkashic `query_memory` 式单往返目标。one-shot 设计成立,非"常退化两步"。

## 2. fab_plan_context — 两步法第一步

| 维度 | 证据 |
| --- | --- |
| 签名(入参) | `planContextInputSchema` @ `api-contracts.ts:98-151`: `paths`(min1) + 同 recall 的可选项 (无 `ids`)。 |
| 签名(出参) | `planContextOutputSchema` @ `api-contracts.ts:186-214`: `selection_token` + `candidates[]{stable_id,description}` (无 body) + `entries[]` + `preflight_diagnostics[]` + `redirects?`。 |
| 注册 | `tools/plan-context.ts:22-30` |
| 粒度 | **两步法第一步**——只返 description 索引 + token,**不含 body**。必须再调 fab_get_knowledge_sections 才拿正文。 |
| 返回结构 | `candidates = dedupeDescriptionIndex(builtItems)` @ `services/plan-context.ts:262` —— **返全部去重候选,无 top-N 截断** (grep 确认 service 无 slice/limit/cap)。仅 64KB guard。 |
| payload 引导 | 超 warn 时 `plan-context.ts:76` 注入泛化 hint "Consider narrowing the request scope" —— **无具体收敛动作**。 |
| 引导 AI 调 | description `plan-context.ts:26` 仅"Use during plan/architecture phases…"。AGENTS.md 已将其降为"仅当单步正文过载需裁剪噪音时"才用。 |

## 3. fab_get_knowledge_sections — 两步法第二步

| 维度 | 证据 |
| --- | --- |
| 签名(入参) | `knowledgeSectionsInputSchema` @ `api-contracts.ts:274-299`: **必填** `selection_token`(min1) + `ai_selected_stable_ids[]` + `ai_selection_reasons`(record) + 可选 ids。 |
| 签名(出参) | `knowledgeSectionsOutputSchema` @ `api-contracts.ts:301-351`: `rules[]{stable_id,level,path,body}` + `diagnostics[]` + `redirect_to?`。 |
| 注册 | `tools/knowledge-sections.ts:25-33` |
| 粒度 | **两步法第二步**——强依赖上一步的 `selection_token` (硬耦合,token 必须来自最近 plan_context)。AI 必须先挑 id 再调。 |
| 返回结构 | 返所选 id 的全 body,无截断,仅 64KB guard。 |
| payload 引导 | `knowledge-sections.ts:65` 同泛化 hint "Consider narrowing the request scope" —— 无具体动作。 |
| 引导 AI 调 | description `knowledge-sections.ts:29` 引导"scan body for whatever headings"。 |

## 4. fab_archive_scan — 确定性 ledger 扫描 (rc.37 NEW-9)

| 维度 | 证据 |
| --- | --- |
| 签名 | in `archiveScanInputSchema` @ `api-contracts.ts:488-509` (`range?/now_ms?/correlation_id?/session_id?`);out `archiveScanOutputSchema` @ `api-contracts.ts:511-531` (`anchor_ts, session_ids[], dropped[], covered_through_ts, already_proposed_keys[]`)。 |
| 注册 | `tools/archive-scan.ts:21-28` (read-only,无 gate/heal) |
| 粒度 | **one-shot**,fabric-archive Skill 用。返 session_id 列表,Skill 再 load digest + 语义 stitch (边界 B: 确定性扫描归 MCP / 语义选择归 LLM)。 |
| 返回/payload | 仅 64KB guard;超限 hint "Pass an explicit `range`…" (`archive-scan.ts:50`)。 |

## 5. fab_review — pending 审查 (discriminated union)

| 维度 | 证据 |
| --- | --- |
| 签名 | `FabReviewInputShape` @ `api-contracts.ts:911-957` (扁平 shape,MCP SDK 1.29 限制);权威 union `FabReviewInputSchema` @ `847-895`,handler 内 `FabReviewInputSchema.parse` 二次收窄 (`tools/review.ts:47`)。8 action: list/approve/reject/modify/modify-content/modify-layer/search/defer。 |
| 注册 | `tools/review.ts:24-36` |
| 粒度 | **one-shot per action**。Skill-side (fabric-review)。`include_body` 默认关 (`api-contracts.ts:826`) 控 list/search payload。 |
| payload 引导 | `review.ts:58` 调 `enforcePayloadLimit` 但**丢弃 warning** (无注入)。 |

## 6. fab_extract_knowledge — 写 pending (rc.2)

| 维度 | 证据 |
| --- | --- |
| 签名 | in `FabExtractKnowledgeInputShape` @ `api-contracts.ts:769` (base shape);权威带 superRefine 的 `FabExtractKnowledgeInputSchema` @ `752-767` (强制非空 source_sessions)。out `FabExtractKnowledgeOutputSchema` @ `772-783` (`pending_path, idempotency_key`)。 |
| 注册 | `tools/extract-knowledge.ts:24-31` |
| 粒度 | **one-shot 写**。幂等 on (source_sessions[0], type, slug),重复调追加 evidence 不覆盖。Skill-side (session-stop)。 |
| payload 引导 | `extract-knowledge.ts:56` 调 guard 但显式丢弃 warning (响应小,注释说明)。 |

---

## 7. 引导 AI 调用机制 (description / AGENTS.md / hook 三层)

- **description (工具自描述)**: 每工具 `description` 字段是主引导。fab_recall `recall.ts:31` 最详尽 (single round-trip + 何时回退两步)。
- **AGENTS.md 行为规则**: 项目 `.fabric/AGENTS.md`「行为规则」明定"修改任何文件前优先单步 `fab_recall(paths)`;仅当正文过载才两步"。+ Cite policy 要求 edit/decide 前回复首行写 `KB: <id>` 并先 fab_recall 验证。
- **hook**: SessionStart broad-hint `knowledge-hint-broad.cjs`,PreToolUse narrow-hint `knowledge-hint-narrow.cjs`。

### hook 引导的两处缺陷 (file:line 证据)

1. **broad-hint footer 与 nudge 自相矛盾**: `knowledge-hint-broad.cjs:660` footer 硬写 `"Use \`fab_get_knowledge_sections\` to fetch full content."` —— 指向**两步法第二步**(还需先有 token,AI 无法直接调);而同文件 `:782-786` (rc.37 NEW-23) 的 nextStepNudge 才正确指向 `fab_recall(paths)`。两条引导并存,footer 是过时两步话术,**与 AGENTS.md 单步优先 + fab_recall 默认入口相冲突**。
2. **narrow-hint (PreToolUse / 每次 Edit) 零工具引导**: grep `knowledge-hint-narrow.cjs` 无任何 `fab_recall / fab_plan_context / fab_get_knowledge_sections` 串 (Bash 确认空输出)。即编辑文件触发 narrow hint 时,**不告诉 AI 用哪个工具拉正文** —— 最该触发 recall 的时机反而无引导。

### SessionStart 索引本身被 top-K 截断 (与 MCP 工具返全候选不一致)

- `knowledge-hint-broad.cjs:126` `DEFAULT_HINT_BROAD_TOP_K = 8` (config `hint_broad_top_k` 1..50;另 `:331` underseed 阈 12)。SessionStart banner **只列 top-8 broad 条目**,但 MCP 工具 (recall/plan_context) 返**全候选**。即 AI 在 SessionStart 看到的是被裁的子集,真调工具才拿全量——discovery 与 retrieval 的候选面不一致 (非缺陷但是认知 gap)。

---

## 真缺口汇总 (带证据)

**G1 [真] payload 治理仅"撞墙"不"预算"**: 唯一上限是 `enforcePayloadLimit` 的 64KB hard / 16KB warn (`mcp-payload-guard.ts:24-25`),**字节级,无条数预算 / 无 token 预估 / 无"返回 N 条够用"提示**。candidates[] 与 rules[] 全量返回 (`plan-context.ts:262` 无 slice;recall 默认取全集 `recall.ts:71`)。KB 规模一大,recall 默认 one-shot 会直接撞 64KB hard 抛错,而 AI 事前**收不到任何"该取多少 / 预计多大"的引导** —— 只有撞墙后才在 warning 里告知回退。对标 OpenAkashic 单往返,Fabric 已有 one-shot 形,但缺"一次打包足够且不超额"的预算设计。

**G2 [真] 收敛引导不对称且部分缺失**: 仅 fab_recall (`recall.ts:92-95`) + archive_scan (`:50`) 给出具体 action_hint;plan_context/knowledge_sections 只给泛化 "Consider narrowing the request scope" (`plan-context.ts:76` / `knowledge-sections.ts:65`);review/extract 直接丢弃 guard warning (`review.ts:58` / `extract-knowledge.ts:56`)。AI 拿不到统一的"如何缩"信号。

**G3 [真] hook 调用引导过时+缺失** (见 §7): broad footer 仍推两步第二步 `fab_get_knowledge_sections` 而非 fab_recall (`knowledge-hint-broad.cjs:660`);narrow/PreToolUse hint 完全不提任何知识工具。最该触发 recall 的 edit 时机无引导。

**G4 [偏弱/可不动] 两步法工具粒度仍偏细但已被 fab_recall 吸收**: plan_context + knowledge_sections 仍是两个独立工具且第二步硬依赖 token (`knowledge-sections.ts` input 必填 `selection_token`)。但 rc.37 fab_recall 已把常态收成单步,两步法退化为"正文过载需裁剪"的逃生通道。粒度过细问题**已实质缓解**,无需进一步合并 (砍掉两步会失去裁剪能力)。

**非缺口(已做好)**: one-shot 打包形态成立 (fab_recall 进程内串两 service,单 MCP 往返);返全候选不做 server-side filter (符合 [[feedback-no-server-side-kb-filter]] LLM-decides 哲学);幂等写 (extract)。

## northstar 边界

本审计**未触碰** store provenance / store-qualified cite / 多 store read-set / required_stores (D7 全局化 northstar)。G1-G4 全部落在"工具粒度 / one-shot 打包 / 引导 AI 调用"三维,与多 store 模型正交,无 defer 项。
