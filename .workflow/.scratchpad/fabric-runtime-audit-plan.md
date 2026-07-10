# Fabric Runtime 设计审计与优化 — Plan + 现状梳理笔记

> 状态:进行中(走查 + 科普阶段,未写代码)
> 创建:2026-06-10
> 性质:审计/优化方法论 + runtime 现状梳理。本文件是 scratchpad,边走边补。

---

## 0. 本质需求(用户原话提炼)

测出**当前 runtime 是否符合预期**,同时**优化 runtime 的设计**。这里的 "runtime" 指
**skill / hook / AGENTS.md 这些行为契约设计是否合理且足够好** —— 不是检索算法的代码正确性。

核心信号:很多策略(cite / self-archive / recall-first)在真实运行里**压根没被遵循**。

**根本拷问(地基)**:这套基于 Fabric 的 runtime 的**设计理念**是否符合需求、且**符合一个新接受者的直觉认知**。
理念是地基;AGENTS.md / hook / skill 是地基之上的施工。**先验地基,再施工。**

---

## 1. 已拍板决策(本轮 locked)

- **D1 — 理念审计尺度:允许冷评推翻 / 大改整个 Fabric 理念。**
  Phase 1 不设"只能在现有理念上优化"的护栏;零上下文多-LLM 冷评 + human frame-challenge
  可以质疑乃至否定 Fabric runtime 的第一性假设。(契合用户 clean-slate 偏好)

- **D2 — 可观测性修复纳入本轮(允许改埋点代码)。**
  实测 `fabric doctor --cite-coverage` → 账本为空(`no events found`),即 `hook 触发→注入→agent 遵循`
  这条链记不进 `events.jsonl`。没有账本,"遵循率"无法度量,一切优化只能凭感觉。
  因此可观测性修复升级为**独立施工 Phase,走 TDD**,且**排在文案优化之前**(否则后续改完无从验证遵循率)。

---

## 2. 文档源地图(改源,不然 `fabric install` 会覆盖)

| 层 | 源(优化改这里) | 运行时产物(install 生成,别手改) |
|---|---|---|
| AGENTS.md | `.fabric/AGENTS.md`(~6.3 KB) | 三端 managed block |
| hook(4) | `packages/cli/src/install/assets/hooks/*.cjs`(`archive-hint`·`fabric-hint`·`knowledge-hint-broad`·`knowledge-hint-narrow`,+ `lib/`) | `.claude/hooks/` · `.codex/hooks/` |
| skill(7) | `packages/cli/src/install/assets/skills/<name>/SKILL.md` + `ref/` | `.claude/skills/` · `.codex/skills/` |
| 可观测性埋点 | hook 侧 `assets/hooks/lib/`(`append-event`·`event-emitter`·`ledger`)+ server 侧 `packages/shared/src/schemas/event-ledger.ts`、`packages/server/src/services/doctor*.ts` / `metrics.ts` | `.fabric/events.jsonl`(现为空=断点) |

权威 hook 事件映射:`packages/cli/src/install/hook-config.ts`(自称 single source of truth)。

**疑似 finding**:`archive-hint.cjs` 产物已删、Stop 只绑 `fabric-hint.cjs`,但 assets 源仍留 `archive-hint.cjs` → 孤儿,待 census 核。

---

## 3. 时间线脊柱:从打开客户端到一个 turn 结束

| # | 时刻 | 触发物 | 类型 |
|---|---|---|---|
| T0 | 客户端打开 / session 启动 | ① `AGENTS.md`(经 CLAUDE.md 静态 @import 全量进 context)② SessionStart → `knowledge-hint-broad.cjs` | 静态注入 + hook |
| T1 | 改文件**前** | PreToolUse(`Edit\|Write\|MultiEdit`)→ `knowledge-hint-narrow.cjs` | hook |
| T2 | 改文件**后** | PostToolUse(同 matcher)→ `knowledge-hint-narrow.cjs`(计数 + recall-state) | hook |
| T3 | 想查知识 | MCP:`fab_recall` / `fab_plan_context` → `fab_get_knowledge_sections` 等 6 个 | agent 主动调 |
| T4 | turn 结束 | Stop → `fabric-hint.cjs`(归档节奏 nudge + review backlog nudge) | hook |
| T5 | 满足条件时 | 7 skill(archive/review/import/store/sync/connect/audit) | agent 主动触发 |

---

## 4. Plan(Phase 0–5)

- **Phase 0 — census + 可观测性体检**:三层源文件全量普查(用上面源地图)+ 实测为何记不进 ledger。产出现状图 + 缺口清单。
- **Phase 1 — 理念审计(GATE,可推翻 = D1)**:拷问四条第一性假设(AI 会读?会遵循?净值 > 认知负荷?符直觉?)。零上下文多-LLM 冷评 + human frame-challenge。理念不过先改理念。
- **Phase 2 — 可观测性修复(代码,TDD = D2)**:接通账本,让后续每层优化都有 deterministic measure。排在文案优化前。
- **Phase 3 — AGENTS.md**:反膨胀 + 消歧(cite policy 三写法)+ 忠实表达理念。
- **Phase 4 — hook**:逐 hook 时机/条件/内容/文案 + 全局编排。
- **Phase 5 — skill**:逐 skill 触发/流程/拆分/极简;`fabric-archive`(13 ref 文档)为重点。

**贯穿纪律**:每层改完用遵循率(账本通后)+ 冷评分双度量;升了才算优化对;收敛即停(防过拟合)。

规模定位 = `/goal-mode` 的 mode②(审计)+ mode④(优化)合体长跑。

---

## 5. 现状梳理笔记(走查进度 — 边走边补)

### 已科普概念(6 块,全局认知策略层)
1. **AGENTS.md vs CLAUDE.md**:不是同一个。CLAUDE.md(Claude Code 三层记忆之一:用户全局 `~/.claude/CLAUDE.md`、项目 `<repo>/CLAUDE.md`、本地 `CLAUDE.local.md`)里仅一行 `@.fabric/AGENTS.md` 把 Fabric 契约拉进 context。记忆机制是 Claude Code 的,Fabric 只是搭便车。→ 认知问题:Fabric KB 与 Claude Code 记忆是两套并行"记忆系统",新人困惑该记哪。
2. **broad-scoped**:不是扫描出来的,是写入时打的 `scope` 标签。broad=全局相关,session start 无条件浮出;narrow=绑路径,踩到对应文件(T1)才浮出。8 条=当前 store 全部 broad,非 top-8 筛选。
3. **session_id**:本次会话唯一编号,纯记账身份证(跨会话 edit 计数、pending 归属、cite 遵循统计),与知识内容无关。多窗口并发会串台。
4. **read-set**:本会话能读哪些库 = `required_stores ∪ personal`(personal 隐式恒在)。回答"AI 这次能看见谁的知识",是 multi-store 可见性边界。
5. **maturity 成熟度阶梯**:合法值 `draft → verified → proven`(`endorsed` 已废弃)。AI 自归档默认 `draft`,走 `fabric-review` 升级。
6. **team / personal**:两类物理隔离库。team(`KT-*`,共享进 git)/ personal(`KP-*`,私有)。前置策略:写路由按语义 scope 落库;**禁止 KT→KP 关联边(防私人结论泄进团队)**,KP→KT 允许;多库同名 id 冲突时 cite 带库前缀消歧。

### T0 走查 — 已识别的"新人认知"张力点
1. 未问先答:还没敲第一个字,就被灌几千字 policy + 8 条 KB。
2. 满屏黑话:`team:KT-DEC-0001` / `broad-scoped` / `read-set` / `revision_hash` 新人无从理解。
3. 指令时机错位:"下一步:调 fab_recall(paths)" 但此刻 agent 还没有任何 paths。
4. 展示 or 命令?:系统把这类 hint 标成 *background context, not instructions* → 可能被当噪声划走。

### 待走查
- T1 PreToolUse(narrow hint + cite nudge)
- T2 PostToolUse(计数 / recall-state)
- T3 MCP 检索族(recall / plan_context / get_sections)
- T4 Stop(archive + review backlog nudge)
- T5 7 skill
