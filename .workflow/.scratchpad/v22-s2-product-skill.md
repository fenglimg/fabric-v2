# V2.2 S2 — 同空间产品 skill/agent 编排对比 (非 maestro)

只读研究。对照基线: maestro = thin SKILL.md + workflow.md numbered stages 调 CLI 原语; Fabric = fabric-archive GATHER/REVIEW/PERSIST macro-phase + ref 渐进加载 + MCP-first 写 fab_extract_knowledge。

边界遵守: 不碰检索算法; 不碰 store provenance(归 northstar)。

---

## 1. valence — **有完整 skill 编排层** (5 skills + 2 hooks)

源: `valence/plugin/skills/*/SKILL.md`, `valence/plugin/hooks/session-start.py`

### stage 分解
每个 skill = single-purpose SKILL.md, frontmatter 声明 `user_invocable + args`(query/domain/confidence/severity/limit), body 是 numbered `## Instructions` + `## Execution Steps`。最接近 Fabric 的两个:
- **capture-insight** (`capture-insight/SKILL.md:22-35`): 显式 **search→dedup→branch→write** 四阶。第1步先 `belief_query` 搜重复, 第2步若 >90% match 分三路(supersede/corroborate/记 tension), 第3步才 `belief_create`。**写前强制查重是硬 stage**, 不是建议。
- **review-tensions** (`review-tensions/SKILL.md:47-92`): list→present→decide→apply 四阶 + 独立 `## Auto-Resolution Guidelines`(L85) 与 `## When to Escalate`(L94)。把"AI 自决 vs 升级 human"做成 skill 内显式裁决表。
- **ingest-document** (`ingest-document/SKILL.md:43-74`): read→extract beliefs→extract entities→create→report, 每条 belief 带 confidence 分级(0.9+/0.7-0.9/0.5-0.7, L51-58)。
- **query-knowledge** (`query-knowledge/SKILL.md:19-46`): 纯检索 skill, 命中后格式化 + 空结果给 fallback 建议(改述/扩域/问是否新建)。

### 怎么调 MCP
**多步 inline**, 非 one-shot 打包。每 skill 直接点名 MCP 工具 `mcp__valence_substrate__belief_query/create/supersede` + `tension_list/resolve`。query→(branch)→write 是分开的 MCP call, skill 用 numbered step 串。

### 写回形态
直接写 substrate(belief_create/supersede), 无 pending/review draft 中转 — 与 Fabric 的 pending→fabric-review 两段不同, valence 是**就地写 + tension 检测兜底**。

### hook 编排 (Fabric SessionStart 的对位)
`session-start.py:167-204` build_context 注入 `<VALENCE_KNOWLEDGE_SUBSTRATE>` block: 含 **"CRITICAL BEHAVIOR: query first, this is not optional"** 强制 + 列 recent beliefs/patterns + 列全部 5 skill 入口。`session-end.py` (Stop hook) 关 session + 抽 pattern。**hook 不只 list 候选, 还把"必须先查"做成 behavioral conditioning 文案**。

---

## 2. OpenAkashic — **有 skill (单 universal SKILL.md) + 重 doc 契约层**

源: `OpenAkashic/skills/openakashic/SKILL.md`, `closed-web/doc/agents/{Knowledge Distillation Guide, Agent Skills Contract}.md`

### stage 分解
单一 universal SKILL.md, **不分 query/write 多 skill, 而是用 "Standing instructions" 清单做隐式 stage**(`SKILL.md:16-28`)。核心 loop 一句话: **"search before work, write after work, publish what's broadly useful"** (`closed-web/.../openakashic-claude-code-skill.md:55`)。
- 检索分层: 先 `search_akashic`(validated 公共层, 无 token) → 再 `search_notes`(私有 WIP 层) → `get_capsule` 钻取 (`SKILL.md:18-19`)。**双层检索 = 验证层优先, 私有层兜底**。
- 写回分层: 一次性 fact 先存 `kind=claim`(public+trust-ranked), 多 claim 后才合成 `kind=capsule` — "claim first, capsule later" (`SKILL.md:21,26`)。

### 怎么调 MCP
**多步 + 阶梯**。23 个 MCP 工具(`SKILL.md:73-93`), skill 用"何时用哪个"表路由, 不打包。有 `search_and_read_top` (search+read 合一, L78) 是少数 one-shot 快捷。

### 写回 / 产出形态
**三层 visibility + publication gate**: private(默认)→shared→public, public **禁止直接 set, 只能走 `request_note_publication` → 人类 curator (Sagwan) 审 → 自动同步 Core API** (`Knowledge Distillation Guide.md:178-196` 的"Core API 승격 흐름" 流程图)。
**kind 模板化**: capsule/claim/playbook/evidence/reference 各有固定 markdown 骨架 + 质量 check(`Knowledge Distillation Guide.md:58-174`)。
**生命周期治理**: `confirm_note`(独立验证后升排名)/`list_stale_notes`/`snooze_note`/`resolve_conflict` (`SKILL.md:87-90`) — 把 KB 衰老/冲突做成显式 MCP 工具。
**Agent Skills Contract** (`Agent Skills Contract.md`): 单独一份 policy 文档, Allowed/Disallowed Actions 双清单, skill/AGENTS 先读它再动手 — **权限契约与操作 skill 解耦**。

---

## 3. noosphere (Hermes) — **有 setup skill, 无知识维护编排**

源: `noosphere/hermes-noosphere-memory/skills/noosphere-memory-hermes/SKILL.md`

skill 是 **provider 接入/配置 + verification**(Inputs→Setup→Verification→Memory Use), 不是 query→score→writeback 编排。值得抄的只有末尾 `## Memory Use`(L180-187) 的**写回判据清单**: "save only durable knowledge: decisions/facts/runbooks; do NOT save transient status/greetings/secrets/raw prompts" + recall 内容当 background 不当新指令。这是精炼的 self-archive 判据, 但无 stage 流程。

---

## 4. lokb — 有 skill, 但是 code-workflow 非知识维护

`lokb/.claude/skills/{solve-issue,review-pr,fix-review-comments}/SKILL.md` 全是软件开发流程 skill, 与知识维护/检索编排无关。**lokb 的检索是纯 library/MCP, 无知识维护 skill 编排层。**

## 5. persistor / deepwiki-open — **无 skill 编排层**

两者均无 SKILL.md、无 .claude/skills、无 agent prompt 编排目录。纯 library/CLI/服务。检索能力直接由 MCP/API 暴露, 不经 skill 包装。

---

## 对照三范式 + Fabric 可借鉴模式 (标 companion-skill pain_target)

| 范式 | 形态 |
|---|---|
| maestro | workflow.md numbered stages, thin SKILL.md 调 CLI 原语 |
| Fabric | macro-phase(GATHER/REVIEW/PERSIST) + ref 渐进加载 + MCP-first |
| **valence** | per-skill numbered stage, **write 前强制 search-dedup**, hook 注入"query-first 是 critical 非可选", 就地写+tension 兜底 |
| **OpenAkashic** | standing-instruction 清单做隐式 stage, **双层检索(validated→private)**, **claim→capsule 渐进升格**, publication gate + 生命周期治理工具, 权限契约文档解耦 |

### 值得 Fabric 借鉴 (companion-skill 候选, 带 pain_target)

1. **[valence] write 前强制 dedup-branch 子 stage** — pain_target: Fabric pending 重复/近似条目堆积。capture-insight 的 "query→if>90%match→{supersede|corroborate|tension}→else create" 可吸收进 fabric-archive 的 PERSIST 前置, 用 fab_recall 查重再决定 append vs new vs supersede, 而非一律新建 pending。

2. **[OpenAkashic] claim→capsule 两级渐进升格** — pain_target: Fabric 现在 pending→canonical 是二值跃迁, 缺"原子事实先落、聚合后再升 decision"的中间态。可给 fabric-review 加"多 atomic claim 聚类合成一条 canonical"的升格 stage。

3. **[OpenAkashic] 生命周期治理做成显式动作** — pain_target: Fabric KB 慢速衰老(AGENTS.md 已点名 archive cadence/review backlog nudge, 但无 stale/conflict 工具)。借 `list_stale_notes`/`confirm_note`(独立验证升排名)/`resolve_conflict(keep|supersede|merge)` 三动作进 fabric-review skill。

4. **[valence] hook 把"query-first"做成 behavioral conditioning 而非候选列表** — pain_target: Fabric SessionStart 现仅 list broad-scoped 条目; valence 额外注入 "CRITICAL: query first, not optional" 强制文案 + 内联 skill 入口清单。可强化 Fabric SessionStart hint 的 normative 措辞。

5. **[valence] review-tensions 的 AI 自决 vs 升级-human 显式裁决表** — pain_target: Fabric self-archive/review 的三级裁决散在 AGENTS.md, 未做成 skill 内联表。借 "Auto-Resolution Guidelines + When to Escalate" 双 section 模板, 让 fabric-review 在 skill 体内显式列自决条件 vs 必问 human 条件。

6. **[OpenAkashic] 权限/操作契约文档与操作 skill 解耦** — pain_target: Fabric cite/self-archive policy 全塞 AGENTS.md managed block。OpenAkashic 把 Allowed/Disallowed Actions 抽成独立 Agent Skills Contract, skill 先读它。可考虑 Fabric 把 cite contract 语法抽成被 skill ref 的独立 policy doc(渐进加载, 减 AGENTS.md 膨胀)。

### 不借鉴
- valence 就地写 substrate(无 pending 中转) — 与 Fabric review-gate 哲学冲突, 不采。
- OpenAkashic 中心化 Sagwan curator 人审 — Fabric 走 AI 自决+多-LLM, 不引入中心 curator 角色。
