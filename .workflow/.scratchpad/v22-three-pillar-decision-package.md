# v2.2 三支柱决策包 — Hook 注入 / 配套 Skill / MCP 知识设施

> session 20260530-design-rule-hook-skill-mcp · H3/S3/M3 综合 + X1 · 2026-05-30
> 建立在前三轮(mining/infra/hybrid)之上, 补"知识规则交付层"空白; 避开 northstar D7(provenance/store-qualified)

## 跨支柱总览

前三轮是"挑卡片算法"中心(检索打分/向量/治理); 本轮补"交付层"——知识规则**怎么被注入、被 skill 编排、被 MCP 工具吐出来**。三支柱各确认了真缺口, 其中部分**确认并细化**了前三轮已 absorb 的候选(A5 always-pin / A12 telemetry), 部分是**净新**(MCP server-prompt 引导层 / fabric-audit skill)。

---

## 支柱① Hook 注入 (H1+H2 → H3)

Fabric 有 5 hook(broad/narrow/cite-evict/fabric-hint/archive-hint), 写入/cite 采集成熟, 但**注入治理薄**。

| id | 候选 | verdict | P | 与前轮关系 |
|---|---|---|---|---|
| **HK1** | always-inject pin (`always_knowledge_ids` config, broad hook 强制并入) | absorb | P1 | **确认+细化 A5**(给出 fabric-config.ts:57-362 无字段实证 + broad:688 落点) |
| **HK2** | SessionStart 降级阶梯 + markdown-aware 截断 (借 maestro context-budget.ts:40-169) | absorb | P1 | 净新; 解 H1-G3 SessionStart 无 token budget |
| **HK3** | per-injection telemetry (injections.jsonl, broad/narrow 写注入 id) | absorb | P2 | **确认+细化 A12**(注入侧 vs 现有消费侧 counter, 归因链补全) |
| **HK4** | hook hygiene 修复(3 个 drift bug) | absorb | P0 | 净新 bug: ①archive-hint.cjs 未注册 legacy drift ②cite-contract-reminder:135 只认 legacy `recalled` 未跟 rc.37 `applied`(致缺 contract 的 applied cite 不触 L1 提醒) ③broad 去重非 session-scoped 多窗口跨会话互抑(印证 user_multiwindow) |
| **HK5** | token 双 cap + summary fallback (noosphere budget.ts) | defer | P3 | 比 HK2 精确但更重; HK2 落地后规模需要再上 |

---

## 支柱② 配套 Skill (S1+S2 → S3)

**核心发现: Fabric skill 拓扑偏科** —— 写入轴(archive/import/review)成熟, **维护/治理轴空白**(无 connect/digest/audit 对等, 全压 doctor 单 CLI 入口)。

| id | 候选 | verdict | P | 依据 |
|---|---|---|---|---|
| **SK1** | `fabric-audit` skill (语义淘汰: deprecate-over-delete + rescue-before-delete + stale/confirm/resolve) | absorb | P1 | 最大缺口; 借 maestro manage-knowledge-audit(SKILL.md:44-90)+OpenAkashic stale/confirm/resolve_conflict(SKILL.md:87-90); 补 doctor lint 之上的 LLM 语义层(互补非替代) |
| **SK2** | `fabric-connect` skill (链接发现, 写回 related) | absorb | P2 | 借 wiki-connect(workflows/wiki-connect.md:38-150 载入→多维发现→打分→写回); **依赖前轮 H2 related 字段**(未建则 defer) |
| **SK3** | `fabric-digest` skill (主题聚类+gap→pending) | absorb | P2 | 借 wiki-digest; gap 复用 fabric-review pending 流; 比 SK2 早可用(不强依赖图) |
| **SK4** | 写前 dedup-branch 子 stage | reject | — | **already-have**: fabric-archive SKILL.md:86 已有 Phase 2.5 Glob slug-stem 查重硬门, 不重复吸收 |
| **SK5** | 裁决表 + 契约文档渐进加载进 skill 体(借 valence review-tensions:47-94 + OpenAkashic 契约解耦) | absorb | P2 | 把三级裁决从 AGENTS.md/goal-mode 下沉进 fabric-review skill 体, 减 managed block 膨胀 |

**编排范式裁定**: Fabric 自家 GATHER/REVIEW/PERSIST + ref 渐进加载 + MCP-first 写, **比 maestro workflow.md numbered-stages 更先进**; 新 skill 沿用 Fabric 范式, 只借 maestro 的 stage 逻辑(多维发现/打分/三态淘汰 invariant), 不照搬其结构。

---

## 支柱③ MCP 知识设施 (M1+M2 → M3) — 最大真缺口

Fabric MCP-first 但工具面"挑卡片算法"研究透、交付层没研究。`fab_recall` 本身是好的真 one-shot(被 OpenAkashic production 验证设计正确), 缺的是**打包精度 + 引导层**。

| id | 候选 | verdict | P | 依据 |
|---|---|---|---|---|
| **MC1** | fab_recall one-shot 增量(首行 directive + body 截断阈 + `_next` hint + include_related 开关 + gap→archive 串联) | absorb | P1 | 借 OpenAkashic search_and_read_top(mcp_server.py:492); Fabric recall.ts:27 已 one-shot, 补打包精度 |
| **MC2** | **server-level instructions prompt + 活体 tool manifest** (per-tool do_not_use/failure_hint) | absorb | P1 | **Fabric 全缺 + 净新最高价值**; 借 OpenAkashic mcp_server.py:111/265; Fabric 引导全压 AGENTS.md 三端 block, 缺 server-prompt 层 → 解 SK5 同源的 AGENTS.md 膨胀 |
| **MC3** | 修 hook 工具调用引导(broad footer:660 矛盾 + narrow 零引导) | absorb | P0 | 净新 bug: M1-G3; broad:660 推两步第二步 fab_get_knowledge_sections(需 token AI 调不了)与:782 正确 fab_recall nudge 自相矛盾; narrow 最该触发 recall 却零引导 |
| **MC4** | MCP payload 预算(条数/token 预估, 撞 64KB hard 前) | absorb | P2 | **横向确认前轮 A-INFRA-3 top_k + C5 budget**; M1-G1 现状只撞墙(mcp-payload-guard.ts:24-25)不预算 |
| **MC5** | 对称收敛引导(plan_context/sections/review/extract 给具体 action_hint) | absorb | P2 | M1-G2 现仅 recall/archive_scan 给 hint, 其余泛化/丢弃 guard warning; 廉价 |

**northstar 边界**: 全部 absorb 项落"工具粒度/one-shot 打包/引导调用"三维, 与多 store provenance 正交, **无 defer-to-northstar 项**。valence provenance_*/contention_* + OpenAkashic store-qualified 显式记录但不吸收(归 D7)。

---

## v2.2 落地建议序 (待 X1 双 LLM 冷评确认 grounded 后定稿)

**Tier 0 — bug/廉价(立刻):** HK4(hook hygiene) · MC3(修工具引导) · MC5(对称 hint)
**Tier 1 — 高 ROI 净新:** MC2(server-prompt 引导层) · SK1(fabric-audit) · HK1(always-pin) · HK2(SessionStart 降级) · MC1(recall 打包增量)
**Tier 2 — 依赖/中成本:** HK3(telemetry) · SK2/SK3(connect/digest, 依赖 related 字段) · SK5(裁决下沉) · MC4(payload 预算, 接前轮)
**defer:** HK5(token 双 cap)

待 X1: gemini 验 Fabric 侧落点真实 + codex 跨目录验产品源端断言, quorum=2 无 refuted。

---

## X1 双冷评结果 (2026-05-30, quorum=2 一致 0 REFUTED → G-GROUNDED PASS)

- **gemini Fabric 侧** (gem-145632-d8fe): HK1/HK4/MC1/MC2/MC3/MC4 全 **GROUNDED**。
  - HK1: fabric-config.ts:57-363 无 always_knowledge_ids; broad:688 硬 slice(0,topK) 掉出即弃。
  - HK4: settings.json 无 archive-hint; cite-contract-reminder.cjs:136 `if(!citeTags.includes("recalled"))continue` 漏 applied; broad:656 全局 cooldown 非 session-scoped。
  - MC1: recall.ts:27 描述 "Combined one-call replacement" 坐实 one-shot。
  - MC2: index.ts:153 McpServer 实例化无 instructions 无 _TOOL_MANIFEST。
  - MC3: broad:638 推 fab_get_knowledge_sections 与 :744 fab_recall nudge 矛盾。
  - MC4: mcp-payload-guard.ts:27-31 serialize 后才量字节(无事前预算) + plan-context.ts:251 无 slice。
- **codex 产品端** (cdx-145649-2997): maestro context-budget / noosphere budget / valence capture-insight+review-tensions / OpenAkashic stale+search_and_read_top+_TOOL_MANIFEST+instructions / manage-knowledge-audit 全 **CONFIRMED**。

### 行号 offset 校正 (内容真实, 仅锚点)
| 候选 | 原引 | 校正 |
|---|---|---|
| MC4 | plan-context.ts:262 | :251 (近期改动行移) |
| MC3 | broad:660 | :638(推 sections) + :744(正确 recall nudge) |
| HK2 | noosphere budget.ts:113-158 | 补 :18-23(maxTokens/maxResults 定义) + :96-100(构造归一化) |
| SK1 | manage-knowledge-audit SKILL.md:44-90 | 更权威 workflows/knowledge-audit.md:349-356(Safety invariants); 命令入口 :23-30 (SKILL.md:47-53 亦含, codex clone 树用 workflow.md) |

**结论**: 三支柱 15 候选机制全部真实存在, 无编造。v2.2 决策包定稿可用。
