# v2.0.0 GA UX Audit — Surface Inventory (Phase 1 / C1)

**Date**: 2026-05-27
**Goal**: 列出所有 user-facing surface — Phase 2-7 walkthrough 的 table of contents
**Dogfood target (后续 Phase 2/3/5)**: `~/Desktop/projects/werewolf-minigame/.fabric/`

---

## A. Skills (3 个,canonical templates)

| Skill | 触发场景 | 用户感知 |
|---|---|---|
| `fabric-archive` | 用户显式 / hook 提醒 / AI 自触发(self-archive policy 4 信号) | 把会话中产生的新知识捕获到 `.fabric/knowledge/pending/` |
| `fabric-review` | 用户显式 / hook 提醒(pending ≥ 2 + 最早 ≥ 7d) | 审 pending 条目 → approve/reject 入 `knowledge/<type>/` |
| `fabric-import` | 用户显式 | 从 legacy 路径 / 外部 KB 导入到 Fabric |

**注**:`release-rc` / `manage-knowhow-capture` / `spec-add` 等不属 Fabric 自身 skill,是 user 个人 Maestro 工作流。

---

## B. Hooks (4 文件 + 5 helper lib)

**Trigger events**(per `packages/cli/templates/hooks/configs/claude-code.json`):

| Event | Hook | 用户感知 |
|---|---|---|
| `Stop` | `fabric-hint.cjs` | turn 结束时检查 — archive cadence nudge / pending review nudge |
| `SessionStart` | `knowledge-hint-broad.cjs` | 列 broad-scoped KB(含 personal layer)作为 session 开场 hint |
| `PreToolUse` (Edit/Write/MultiEdit) | `knowledge-hint-narrow.cjs` | 改文件前推 path-relevant KB 候选 |
| `UserPromptSubmit` | `cite-policy-evict.cjs` | 用户消息进来时,清理过期 cite contract reminder |

**Helper libs**(`packages/cli/templates/hooks/lib/`):
- `summary-fallback.cjs` — Stop hook digest fallback
- `cite-contract-reminder.cjs` — cite contract 状态机
- `cite-line-parser.cjs` — KB: 首行解析
- `banner-i18n.cjs` — hook banner zh/en 渲染
- `session-digest-writer.cjs` — Phase 0.0 cross-session digest 落盘

**Cross-client**:`cursor-hooks.json` + `codex-hooks.json` 是 client-specific event/匹配方式翻译版,核心 .cjs 文件复用。

---

## C. CLI 子命令 (8 top-level)

| Command | 用户感知 |
|---|---|
| `fabric` | 入口 + help |
| `fabric install` | 在当前项目 scaffold .fabric/ + 装 hooks + 配 MCP(6 子步骤:preflight / scaffold / bootstrap / mcp / hooks / post-setup) |
| `fabric uninstall` | 全 revert(mcp / bootstrap / scaffold 三 phase) |
| `fabric doctor` | 35 check + 多 mode:`--fix` / `--fix-knowledge` / `--cite-coverage` / `--archive-history` / `--enrich-descriptions` / `--strict` |
| `fabric config` | 配置子命令(`dismiss-slot` / `onboard-reset`) |
| `fabric onboard-coverage` | S5 onboarding slot 覆盖检查(JSON output) |
| `fabric plan-context-hint` | 低 level,hook 内部调用,非 user-facing |
| `fabric serve` | **GA 候选 quarantine**(Wave A2) |

---

## D. MCP Tools (4 个,server 暴露给所有 client)

| Tool | 用途 |
|---|---|
| `fab_plan_context` | KB recall step 1:给定 paths → 返回候选(**选 selectable=true 的子集**,Wave A1 候选删 filter) |
| `fab_get_knowledge_sections` | KB recall step 2:给定 selection_token + ai_selected_stable_ids → 拉全文 |
| `fab_extract_knowledge` | Skill 端:Phase 2 写 pending 条目 |
| `fab_review` | fabric-review skill 端:approve/reject pending |

**Transport**:stdio MCP only(client spawn `node packages/server/dist/index.js` 子进程)。HTTP server 见 Wave A2 quarantine。

---

## E. AGENTS.md Policy 块 (4 块,canonical + project 双份)

| 块 | 内容 |
|---|---|
| 行为规则 | 修改文件前的两步调用规则 + `.fabric/agents.meta.json` 禁手编 |
| 知识库 (KB) | Discovery (SessionStart hook) / Usage (两步式 plan_context → get_sections) / Write flows (3 skill) / Language config |
| Self-archive policy | 4 触发信号(Normative / Wrong-turn-revert / Decision-confirmation / Explicit-dismissal-with-reason) + 3 anti-loop + marker text 协议 + 呈现模板 |
| Cite policy | 首行 `KB: <id> (用法) [planned\|recalled\|chained-from\|dismissed:<reason>]` + contract 语法 `→ edit:/!edit:/require:/forbid:/skip:<reason>` + 7 skip reason 词典 + `KB: none [<reason>]` sentinel + 稽核工具 |

**双份存在**:`AGENTS.md`(canonical 模板)+ `.fabric/AGENTS.md`(项目级)。三 client 通过 SKILL.md / project-level AGENTS.md 接入。

---

## F. Doctor Check 域 (6 大类 / 35 sub-check)

| Category | 入口 |
|---|---|
| Report | `runDoctorReport` — 35 check 一键体检(默认) |
| Fix | `runDoctorFix` — auto-fix mutations |
| Apply lint | `runDoctorApplyLint` — apply-lint mutations |
| Cite coverage | `runDoctorCiteCoverage` — `--cite-coverage` flag |
| Archive history | `runDoctorArchiveHistory` — `--archive-history` flag |
| Emit cadence | `runDoctorEmitCadenceCheck` — events.jsonl 心跳指标 |

**Knowledge auto-fix 5 类**(`packages/cli/src/commands/doctor.ts:75-79`):
- `knowledge_orphan_demote_required`(demote maturity)
- `knowledge_stale_archive_required`(archive git mv)
- `knowledge_pending_auto_archive`(archive pending)
- `knowledge_index_drift`(counter bump)
- `knowledge_session_hints_stale`(cache delete)

**i18n**:rc.26 完成 35 check zh-CN / en 双 locale snapshot。

---

## G. 交互算法 / Policy (9 项,Phase 4 重点 audit 对象)

| # | 名称 | 位置 | Phase 4 重点 |
|---|---|---|---|
| 1 | **cite policy** | AGENTS.md L52-83 | 首行规则 / contract 语法 / sentinel — rc.32 实测遵循率 3.1% |
| 2 | **self-archive policy** | AGENTS.md L18-50 | 4 触发信号 / anti-loop / marker text — rc.25 引入,实际触发率? |
| 3 | **plan-context selectable filter** | packages/server (待 grep) | **已决策删**(Wave A1) — 374→7→1 funnel |
| 4 | **recall verification** | AGENTS.md L8 + L46 | 两步调用 `fab_plan_context` → `fab_get_knowledge_sections` 强制 — 防 id 编造 |
| 5 | **archive viability gate (Phase 0.5)** | fabric-archive SKILL.md | 8 archive signals + 4 anti-archive signals + 决策矩阵 |
| 6 | **archive layer classification** | fabric-archive SKILL.md | 强 team / 强 personal / 默认 team 启发式 |
| 7 | **archive slug naming** | fabric-archive SKILL.md | 5 规则:kebab-case, 2-5 词, 20-40 字符, semantic core, unique |
| 8 | **relevance_paths derivation (Phase 1.5)** | fabric-archive SKILL.md | 6-step:collect → dedupe → blacklist → generalize → scope gate → attach evidence;**rc.5 edit_paths single-signal**,多 signal 推 rc.7+ |
| 9 | **doctor remediation 文案** | packages/server/src/services/doctor.ts (i18n) | 35 check × zh/en × actionable hint;rc.32 测出 2 条"引导删 ledger"反例 |

---

## H. 用户旅程 8 阶段(Phase 5 走查对象)

| 阶段 | 入口 | 关键产物 |
|---|---|---|
| 1. install | `fabric install` | .fabric/ scaffold + hooks 装 + MCP 配 |
| 2. discover | 新 session 开场 → SessionStart hook | broad-scoped KB hint 出现 |
| 3. cite | AI 准备 edit/decide/propose plan → 首行 `KB: ...` | cite-policy-evict hook 跟踪 |
| 4. archive | 用户/AI 触发 fabric-archive | pending/ 落地 |
| 5. review | Stop hook 提醒 → 用户跑 fabric-review | pending → knowledge/<type>/ promote |
| 6. doctor | 用户 `fabric doctor` / `--fix` | 35 check 报告 + remediation |
| 7. upgrade | `fabric install` 二次运行 / `--force-skills-only` | drift detect + hooks 重 install |
| 8. drift | hook drift / SKILL.md drift / meta drift | doctor 报告 + remediation |

---

## I. 5 横切关注(Phase 6 spot-check 对象)

| 横切 | 含义 |
|---|---|
| i18n | zh-CN / en 全 user-facing string 完整 + remediation 一致 |
| cross-client | Claude Code / Cursor / Codex CLI 三 client 行为一致 |
| perf | cold start / hook latency / MCP 调用延迟 |
| security | prompt injection (KB body 可被注入) + secrets 泄漏 |
| observability | events.jsonl / metrics / doctor history |

---

## Summary

- **3 Skills + 4 Hooks + 8 CLI subcommands + 4 MCP tools + 4 Policy 块 + 6 Doctor 域 + 9 交互算法**
- 涵盖 GA 期所有 user-facing surface
- Phase 4 重点 audit 上面 **G. 9 交互算法**
- Phase 2/3/5 dogfood `werewolf-minigame` 真跑 Skills / Hooks / 8 阶段旅程

**下一阶段**:Phase 4 算法/policy paper audit — 逐个 audit G 表 9 项,产出 `algorithms-verdict.md`。
