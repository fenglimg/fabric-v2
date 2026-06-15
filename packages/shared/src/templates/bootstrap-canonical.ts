/**
 * Canonical Fabric bootstrap content + marker constants — single source of truth
 * consumed by both `fabric install` (writer) and the server-side doctor (drift
 * comparator). Mirrors the rc.18 banner-i18n shared-module pattern: shared
 * constants in `packages/shared` so the cross-package boundary stays clean
 * (server has zero dep on cli).
 *
 * rc.19 bootstrap-consolidation TASK-001: hoisted from per-writer ad-hoc
 * strings. The canonical body is fixed for all projects — no interpolation —
 * and intentionally zh-CN-hybrid per locked clarification 3.
 *
 * IMPORTANT: the {@link BOOTSTRAP_CANONICAL_ZH} / {@link BOOTSTRAP_CANONICAL_EN}
 * bodies are byte-locked. Do not edit casually — downstream drift detection
 * asserts byte-identical equality, and the published-package version becomes
 * the contract between Fabric CLI and any Fabric server.
 *
 * Content-layer i18n: the bootstrap body follows the unified language flow
 * (`resolveGlobalLocale`). `fabric install` and the doctor drift comparator
 * both select the locale-appropriate body via {@link resolveBootstrapCanonical}
 * — an en-locale machine writes/compares the EN body, a zh-CN machine the ZH
 * body. There is NO bare locale-agnostic `BOOTSTRAP_CANONICAL` anymore; every
 * consumer must resolve a locale (clean-slate, no ambiguous default).
 */

import { resolveGlobalLocale } from "../i18n/resolve-global-locale.js";
import type { Locale } from "../i18n/types.js";

/**
 * HTML-comment marker pair delimiting the managed Fabric bootstrap section.
 * Both writer (idempotent in-place replace) and uninstall helper match these
 * as plain substrings — keep byte-identical.
 */
export const BOOTSTRAP_MARKER_BEGIN = "<!-- fabric:bootstrap:begin -->";
export const BOOTSTRAP_MARKER_END = "<!-- fabric:bootstrap:end -->";

/**
 * Regex matching the entire managed bootstrap section, markers inclusive,
 * with an optional preceding blank-line separator (so re-install / uninstall
 * don't leave orphan blank lines). Non-greedy body matches any content
 * between the begin/end markers, including newlines. Mirrors the shape of
 * the existing `FABRIC_SECTION_REGEX` in `packages/cli/src/install/skills-and-hooks.ts`.
 */
export const BOOTSTRAP_REGEX =
  /(?:\r?\n){0,2}<!-- fabric:bootstrap:begin -->[\s\S]*?<!-- fabric:bootstrap:end -->/;

/**
 * Canonical bootstrap body (zh-CN) — byte-locked per rc.19 locked clarification 3.
 * Rendered into the managed block between {@link BOOTSTRAP_MARKER_BEGIN} and
 * {@link BOOTSTRAP_MARKER_END} by `fabric install` (via
 * {@link resolveBootstrapCanonical}) on a zh-CN machine, across both
 * supported clients (Claude Code, Codex CLI).
 *
 * Length guarantee: ≥ 800 bytes (rc.24: grew from ≥400 with cite-contract syntax).
 */
export const BOOTSTRAP_CANONICAL_ZH = `# Fabric Bootstrap

本项目使用 Fabric 管理跨客户端 AI 知识与行为规则。本文件由 \`fabric install\` 同步到两端 managed block,**不要手动编辑两端的 block**,只改这里 + 重跑 \`fabric install\`。

## For Developers

这个文件是 **AI 客户端的策略与规约配置**,不是 dev onboarding。你不需要读 Self-archive / Cite / Phase 0.4 等细节。
作为 dev 你只需要:在每个 repo 跑一次 \`fabric install\`,用 \`fabric store bind <alias>\` / \`fabric store switch-write <alias>\` 接入写入 store,出问题跑 \`fabric doctor\`。
**严禁手动编辑 \`.fabric/agents.meta.json\`** — 派生状态由 engine 重建。

## 5 分钟上手 (Dev Quickstart)

**Fabric 是什么**:跨客户端(Claude Code / Codex CLI)的 AI 知识层。把团队/项目的 **decisions / pitfalls / guidelines / models / processes** 存为 markdown,hook 自动 surface 给 AI,让 AI 不用每次重学。

**你要做的 (DO)** vs **engine 自动的 (DON'T 手动)**:

| 你 DO | 你 DON'T |
| --- | --- |
| 每个 repo 跑一次 \`fabric install\` | 手编 \`.fabric/agents.meta.json\` |
| 异常时跑 \`fabric doctor\` (--fix 自愈) | 手编 \`.claude/hooks/\` 下 \`.cjs\` |
| 用 \`fabric-archive\` / \`fabric-review\` / \`fabric store ...\` 管理 store-backed knowledge | 手写任何非 store knowledge 根 |
| \`npm install -g @fenglimg/fabric-cli@latest\` 升级 | 背 35 条 doctor lint 代码 |

**4 步循环**: \`fabric install\` (一次) → 绑定并选择写入 store → AI 正常工作 (hook on session start + edit) → AI 通过 MCP 写入当前 write store 的 pending 条目并返回 \`pending_path\` → 用 \`fabric-review\` skill 审核。

**真例**:某 sprite 黑边 root cause 是 \`atlas.premultiplyAlpha\` flag 反向 — 归档进 store 的 \`knowledge/pitfalls/\` 后,下次同类问题 AI 自动 reference。

完整 maintainer 版见 \`docs/USER-QUICKSTART.md\`。

## 行为规则
- **修改任何文件前**:优先单步 \`fab_recall(paths=[<被改文件>])\` —— 一次调用直接拿回所有相关 KB 正文(rc.37+ 默认路径,省掉手动挑 id 的环节)。**仅当单步拉回的正文过多、导致上下文过载需精确裁剪噪音时**才走两步:先 \`fab_plan_context(paths=[...])\` 拿 \`selection_token\` + 顶层 \`candidates[]\`(从 \`candidates[].stable_id\` 挑),再 \`fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>...] })\` 取正文。
- **\`.fabric/agents.meta.json\` 严禁手动编辑**;engine 会自动同步派生状态,显式 reconcile 跑 \`fabric doctor --fix\`。

## 知识库(KB)
- **Discovery**:SessionStart hook 列 broad-scoped 条目(含 personal layer \`KP-*\` 条目,引用方式相同);edit 文件时 PreToolUse hook 可能触发 narrow hint。
- **Usage**:常态走单步 \`fab_recall(paths=[...])\` 一次拿回相关 KB 正文。仅当单步正文过多致上下文过载、需精确裁剪噪音时才两步:\`fab_plan_context(paths=[...])\` 返回 \`selection_token\` + 顶层 \`candidates[]\`,再 \`fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<从 candidates[].stable_id 挑>...] })\` 拉全文;\`selection_token\` 必须来自最近一次 \`fab_plan_context\`,不可凭空编造。
- **session_id**: 调用 \`fab_recall\` / \`fab_plan_context\` 时, 务必把当前 client session id 作为 \`session_id\` 参数传入(Claude Code 的 session id 在 stdin payload 中, Codex 的对应 identifier 同理)。这能让 \`fabric doctor --archive-history\` 与 \`fabric-hint.cjs\` Stop hook 准确识别跨会话 debt 状态。
- **Skills (7)**:写流程 \`fabric-archive\` / \`fabric-review\` / \`fabric-import\`;store 流程 \`fabric-store\` / \`fabric-sync\` / \`fabric-connect\`;诊断 \`fabric-audit\`。
- **Language**:渲染按 \`.fabric/fabric-config.json\` 的 \`fabric_language\` 字段。
- **Archive cadence nudge** (rc.36): 每完成一批 Edit(默认 ~20 次, 与 Stop hook 阈值 config \`archive_edit_threshold\` 一致)/ 显著 decision 后,在合适回合主动 propose 调 \`fabric-archive\` skill — archive 没建立频率会让 KB 慢速死掉。
- **Review backlog nudge** (rc.36): 需要判断 pending backlog 时走 \`fab_review action="list"\` 或 \`fabric-review\` 返回的 \`pending_path\`;不要 glob 项目本地 \`.fabric/knowledge/pending\`。当可见 pending 累积 >10 条时,在合适回合主动 propose 调 \`fabric-review\` skill 批量审,避免 draft 卡死。

## Self-archive policy (v2.0.0-rc.37 NEW-2: 简化 4 信号 → 2 大类)

- **触发** (本会话出现以下任一信号, 在该 turn 回复末尾自主调用 \`fabric-archive\` skill, 走 AI 自触发入口 E3_ai_self_trigger):
  1. **User-driven normative** — 用户消息中显式表达 normative 意图: \`以后\` / \`always\` / \`never\` / \`from now on\` / \`下次注意\` / \`记一下\` / \`永远不要\`, OR 用户在 ≥2 候选间权衡后给出 rationale 锁定方向, OR 用户拒了某建议**并**说了原因 (拒绝理由本身是知识)
  2. **Wrong-turn-and-revert** — AI 尝试 path X, 反思后改走 path Y (尤其当 path X 是非显然踩坑); 涵盖技术决策反转 + 工具/范式切换 + 失败重试。Anchor: 一定有"否定+替代"的两步结构, 不是单纯探索失败

  老 4-state (Normative / Decision-confirmation / Explicit-dismissal / Wrong-turn) 现合并: 前 3 个全是"用户消息中显式表达"性质, 折成 1 类; 第 4 是"AI 自己的反思路径", 独立 1 类。两类各自的本质判别不变, 触发面没变窄。

- **Anti-trigger** (明确不触发):
  - 用户纯询问 (无 normative 表达)
  - 简单 refactor / typo fix
  - AI 自己产生的'洞察' (必须由用户消息中信号或 AI 自己的 wrong-turn 触发, 不是凭空"我学到了"性质)

- **Anti-loop 三条防护**:
  - 同 turn 最多自调 1 次
  - 同 session 同 outcome 不重复 (若 user_dismissed, 本会话不再自调相同主题)
  - Phase 2.5 viability gate 兜底 (skill 内部仍跑 gate, AI 判错不会乱写 pending)

- **呈现模板** (turn 末尾插入, 两行: 先 marker 行供 Phase 1.5 检测, 再 user-facing 提示):
  \`\`\`
  self-archive policy triggered by signal: <User-driven normative|Wrong-turn-and-revert>
  顺手归档: 注意到你说 \`<触发短语>\`, 已调用 fabric-archive 抓 N 条候选 → 当前 write store 的 knowledge/pending/...
  若不该记, 答 '撤销' 我会调 fab_review reject。
  \`\`\`
  第一行是 Phase 1.5 Trigger Gate 识别 E3 入口的 structured marker (verbatim 字符串 \`self-archive policy triggered by signal\`, 后接冒号 + 触发信号名)。第二行起是给用户看的中文提示。两行都必须出现; 缺 marker 行 Phase 1.5 无法路由到 E3_ai_self_trigger。

  Backward compat: Phase 1.5 entry-point regex 同时识别老 4 个信号名 (Normative / Wrong-turn-and-revert / Decision confirmation / Explicit dismissal) 与新 2 大类名, 旧 session marker 仍能正确路由。

## Cite policy (v2.1 ⑤ recall-based: 自动记账优先, 首行 KB: 可选 override)

- **核心 (recall-first 自动记账)**: 改任何文件前先 \`fab_recall(paths=[<被改文件>])\`。系统按"本 session 近期 recall 命中的 path 与编辑目标重叠"自动把召回的 KB 关联为该次 edit 的引用 —— **无需手写回复首行**。PreToolUse hook 在检测不到相关 recall 时给一条软 nudge(nudge 非 gate,守 KT-DEC-0007);改前 recall 过(或已手写 cite)即静默。为什么不再逼首行:先想后说,recall 才是引用发生的真实信号,手写首行违背 CoT 且 \`KB: none\` 逃逸使旧规则形同虚设。
- **可选 override (首行 KB:)**: 仍可在回复首行手写 \`KB: <id> (<≤8字 用法>) [applied|dismissed:<reason>]\` 或 \`KB: none [<reason>]\` 来显式标注/精确化引用;cite-line 解析器保留(向后兼容),旧习惯不破。
- **\`[applied]\` 验证义务**: 引用任何 id(自动或手写)的前提是先用 fab_recall (或两步 fab_plan_context → fab_get_knowledge_sections) 实际抓 KB body, 防止编造 id。验证不通过 = 不能 cite。
- **store 前缀 (v2.1, 多 store)**: 当 read-set 含多个 store 且同一 local id 在多 store 间 shadow 时,cite 必须 store-qualified: \`KB: <store-alias>:<id> ...\`(如 \`KB: team:KT-DEC-0001 (auth) [applied]\`);alias 用户自定/canonical,底层 UUID。单 store 或无歧义时裸 \`KB: <id>\` 仍 valid。personal-only 条目 cite 进团队产物=强 warning(接 P2 写路径防泄漏 R5#3)。
- **contract 语法**: decisions/pitfalls 类 \`[applied]\` cite 尾段加 contract: \`→ <operator> [<operator> ...]\`,operator ∈ {\`edit:<glob>\` \`!edit:<glob>\` \`require:<symbol>\` \`forbid:<symbol>\` \`skip:<reason>\`}。例:\`KB: K-001 (auth) [applied] → edit:src/auth/**/*.ts !edit:src/legacy/**\`。
- **skip reason 词典**: \`sequencing | conditional | semantic | aesthetic | architectural | other:<text>\`。
- **type 路由**: models 类引用为 reference cite,不需要 contract;guidelines/processes 类暂不强制,推后 LLM-judge。
- **用户口头提规则没给 id**: 先调 \`fab_recall(paths)\` 或 \`fab_extract_knowledge\` 反查。
- **dismissed reason**: 枚举 \`scope-mismatch | outdated | not-applicable | other:<text>\`。
- **\`KB: none\` sentinel**: 枚举两种合规理由——\`[no-relevant]\` 已调 \`fab_recall\` / \`fab_plan_context\`(或 hook 输出可见)但无可用条目;\`[not-applicable]\` 当前动作不在 cite 范围(纯探索 / Bash 只读 / 用户问答)。裸 \`KB: none\`(无后缀)仍然 valid,归类为 \`[unspecified]\`(legacy 兼容,鼓励后续补注)。
- **稽核**: \`fabric doctor --cite-coverage [--since=7d] [--client=cc|codex|all]\` 输出 cite 覆盖率,含 \`KB: none\` sentinel 拆分。本规则不阻断你工作,只记录。
- **Clean-slate (无 backward compat)**: 解析器只认 \`applied\` / \`dismissed\` / \`none\` 三态;任何无法识别的老 tag (\`planned\` / \`recalled\` / \`chained-from <id>\`) 一律降级为 \`none\`(\`chained-from\` 的内嵌 id 仍被抢救为 sibling cite_id)。旧 session 留下的 legacy cite 以 \`none\` 计入 cite-coverage。
- **完整参考下沉** (v2.2 SK5): contract operator / skip·dismissed 词典 / 类型路由 / 稽核口径 / **裁决阶梯** (AI自决 → 多-LLM 含零上下文冷评 → 非阻塞队列) 的权威详参在 \`fabric-review\` skill 的 \`ref/cite-contract.md\` —— bootstrap 只留可执行 core,治理细节归 ref 不再撑大 bootstrap。
`;

/**
 * Canonical bootstrap body (en) — the English parallel of
 * {@link BOOTSTRAP_CANONICAL_ZH}. Structurally parallel (same H2 section count,
 * same protected tokens: command names, `fab_*` calls, `KB:` syntax, marker
 * literals, file paths, skill names, enum values) per the content-layer parity
 * gate (G-PARITY) and KT-GLD-0002 (translate prose, keep routing keys / tokens
 * in English). Byte-locked: a zh-CN machine never sees this body and an en
 * machine never sees the ZH one, but both are install/doctor contracts.
 */
export const BOOTSTRAP_CANONICAL_EN = `# Fabric Bootstrap

This project uses Fabric to manage cross-client AI knowledge and behavior rules. This file is synced into the managed block on both clients by \`fabric install\` — **do not hand-edit the block on any client**; edit here + re-run \`fabric install\`.

## For Developers

This file is the **AI client's policy & convention config**, not dev onboarding. You don't need to read the Self-archive / Cite / Phase 0.4 details.
As a dev you only need to: run \`fabric install\` once per repo, use \`fabric store bind <alias>\` / \`fabric store switch-write <alias>\` to wire up a write store, and run \`fabric doctor\` when something breaks.
**Never hand-edit \`.fabric/agents.meta.json\`** — derived state is rebuilt by the engine.

## Dev Quickstart

**What Fabric is**: a cross-client (Claude Code / Codex CLI) AI knowledge layer. Store the team/project **decisions / pitfalls / guidelines / models / processes** as markdown; hooks surface them to the AI automatically so it doesn't re-learn every time.

**What you DO** vs **what the engine does (DON'T hand-edit)**:

| You DO | You DON'T |
| --- | --- |
| Run \`fabric install\` once per repo | Hand-edit \`.fabric/agents.meta.json\` |
| Run \`fabric doctor\` (--fix self-heals) on trouble | Hand-edit \`.cjs\` under \`.claude/hooks/\` |
| Use \`fabric-archive\` / \`fabric-review\` / \`fabric store ...\` to manage store-backed knowledge | Hand-write any non-store knowledge root |
| \`npm install -g @fenglimg/fabric-cli@latest\` to upgrade | Memorize the 35 doctor lint codes |

**4-step loop**: \`fabric install\` (once) → bind and pick a write store → AI works normally (hook on session start + edit) → the AI writes pending entries into the current write store via MCP and returns a \`pending_path\` → review with the \`fabric-review\` skill.

**Real example**: a sprite black-edge root cause was the \`atlas.premultiplyAlpha\` flag being inverted — once archived into the store's \`knowledge/pitfalls/\`, the AI auto-references it next time a similar issue shows up.

See \`docs/USER-QUICKSTART.md\` for the full maintainer version.

## Behavior Rules
- **Before modifying any file**: prefer the one-step \`fab_recall(paths=[<file-being-edited>])\` —— a single call returns all relevant KB bodies directly (rc.37+ default path, no manual id-picking). **Only when the one-step bodies are too large and overload the context** go two-step: first \`fab_plan_context(paths=[...])\` for a \`selection_token\` + top-level \`candidates[]\` (pick from \`candidates[].stable_id\`), then \`fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>...] })\` for the bodies.
- **Never hand-edit \`.fabric/agents.meta.json\`**; the engine syncs derived state automatically — run \`fabric doctor --fix\` for an explicit reconcile.

## Knowledge Base (KB)
- **Discovery**: the SessionStart hook lists broad-scoped entries (including personal-layer \`KP-*\` entries, referenced the same way); editing a file may trigger a narrow hint via the PreToolUse hook.
- **Usage**: normally go one-step \`fab_recall(paths=[...])\` to fetch the relevant KB bodies in one call. Only when the one-step bodies are too large and overload the context go two-step: \`fab_plan_context(paths=[...])\` returns a \`selection_token\` + top-level \`candidates[]\`, then \`fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<picked from candidates[].stable_id>...] })\` fetches the full bodies; the \`selection_token\` MUST come from the most recent \`fab_plan_context\` — never fabricate one.
- **session_id**: when calling \`fab_recall\` / \`fab_plan_context\`, always pass the current client session id as the \`session_id\` argument (Claude Code's session id is in the stdin payload; Codex's corresponding identifier likewise). This lets \`fabric doctor --archive-history\` and the \`fabric-hint.cjs\` Stop hook track cross-session debt accurately.
- **Skills (7)**: write flow \`fabric-archive\` / \`fabric-review\` / \`fabric-import\`; store flow \`fabric-store\` / \`fabric-sync\` / \`fabric-connect\`; diagnostics \`fabric-audit\`.
- **Language**: rendered per the \`fabric_language\` field in \`.fabric/fabric-config.json\`.
- **Archive cadence nudge** (rc.36): after each batch of edits (default ~20, matching the Stop hook threshold config \`archive_edit_threshold\`) / a significant decision, proactively propose the \`fabric-archive\` skill at a suitable turn — without an archive cadence the KB slowly dies.
- **Review backlog nudge** (rc.36): to judge the pending backlog, go through \`fab_review action="list"\` or the \`pending_path\` returned by \`fabric-review\`; don't glob the project-local \`.fabric/knowledge/pending\`. When the visible pending count exceeds 10, proactively propose the \`fabric-review\` skill at a suitable turn to batch-review and avoid draft deadlock.

## Self-archive policy (v2.0.0-rc.37 NEW-2: simplified 4 signals → 2 classes)

- **Trigger** (when any of the following signals appears this session, autonomously invoke the \`fabric-archive\` skill at the end of that turn, via the AI self-trigger entry E3_ai_self_trigger):
  1. **User-driven normative** — the user's message explicitly expresses normative intent: \`以后\` / \`always\` / \`never\` / \`from now on\` / \`下次注意\` / \`记一下\` / \`永远不要\`, OR the user locks a direction with rationale after weighing ≥2 candidates, OR the user rejects a suggestion **and** states a reason (the rejection reason itself is knowledge)
  2. **Wrong-turn-and-revert** — the AI tries path X, then after reflection switches to path Y (especially when path X is a non-obvious pitfall); covers technical-decision reversals + tool/paradigm switches + failed retries. Anchor: there is always a two-step "negate + replace" structure, not mere exploratory failure

  The old 4-state set (Normative / Decision-confirmation / Explicit-dismissal / Wrong-turn) is now merged: the first 3 are all "explicitly expressed in the user's message" and fold into 1 class; the 4th is "the AI's own reflective path" and stands alone as 1 class. Each class's underlying test is unchanged; the trigger surface did not narrow.

- **Anti-trigger** (explicitly does NOT trigger):
  - Pure user questions (no normative expression)
  - Simple refactor / typo fix
  - AI's own 'insights' (must be triggered by a signal in the user's message or the AI's own wrong-turn, not a baseless "I learned something")

- **Anti-loop, 3 guards**:
  - At most 1 self-invocation per turn
  - No repeat for the same outcome in the same session (if user_dismissed, don't self-invoke the same topic again this session)
  - Phase 2.5 viability gate as backstop (the skill still runs the gate internally, so a misjudgment won't write junk pending)

- **Presentation template** (insert at the end of the turn, two lines: first the marker line for Phase 1.5 detection, then the user-facing prompt):
  \`\`\`
  self-archive policy triggered by signal: <User-driven normative|Wrong-turn-and-revert>
  Archived along the way: noticed you said \`<trigger phrase>\`, invoked fabric-archive to capture N candidates → the current write store's knowledge/pending/...
  If this shouldn't be recorded, reply 'undo' and I'll call fab_review reject.
  \`\`\`
  The first line is the structured marker the Phase 1.5 Trigger Gate uses to route the E3 entry (verbatim string \`self-archive policy triggered by signal\`, followed by a colon + the trigger signal name). From the second line on it's the user-facing prompt. Both lines MUST appear; without the marker line Phase 1.5 cannot route to E3_ai_self_trigger.

  Backward compat: the Phase 1.5 entry-point regex recognises both the old 4 signal names (Normative / Wrong-turn-and-revert / Decision confirmation / Explicit dismissal) and the new 2 class names, so markers from old sessions still route correctly.

## Cite policy (v2.1 ⑤ recall-based: auto-accounting first, optional first-line KB: override)

- **Core (recall-first auto-accounting)**: before changing any file, run \`fab_recall(paths=[<file-being-edited>])\` first. The system auto-associates the recalled KB as that edit's citation by "paths recall-hit recently this session overlap the edit target" —— **no need to hand-write a first reply line**. The PreToolUse hook gives a soft nudge when it detects no relevant recall (nudge, not a gate, per KT-DEC-0007); having recalled before the edit (or already hand-written a cite) keeps it silent. Why no longer force a first line: think-then-speak, recall is the real signal that a citation happened, hand-writing a first line violates CoT and the \`KB: none\` escape hatch made the old rule toothless.
- **Optional override (first-line KB:)**: you may still hand-write \`KB: <id> (<≤8-char usage>) [applied|dismissed:<reason>]\` or \`KB: none [<reason>]\` as the first reply line to explicitly annotate/refine the citation; the cite-line parser is retained (backward compatible), old habits aren't broken.
- **\`[applied]\` verification duty**: citing any id (auto or hand-written) requires first actually fetching the KB body via fab_recall (or two-step fab_plan_context → fab_get_knowledge_sections), to prevent fabricated ids. Verification failing = you cannot cite.
- **store prefix (v2.1, multi-store)**: when the read-set spans multiple stores and the same local id is shadowed across stores, the cite MUST be store-qualified: \`KB: <store-alias>:<id> ...\` (e.g. \`KB: team:KT-DEC-0001 (auth) [applied]\`); the alias is user-defined/canonical, the underlying id a UUID. A bare \`KB: <id>\` is still valid for a single store or no ambiguity. Citing a personal-only entry into a team artifact = strong warning (ties into the P2 write-path leak guard R5#3).
- **contract syntax**: for decisions/pitfalls-type \`[applied]\` cites, append a contract tail: \`→ <operator> [<operator> ...]\`, operator ∈ {\`edit:<glob>\` \`!edit:<glob>\` \`require:<symbol>\` \`forbid:<symbol>\` \`skip:<reason>\`}. E.g. \`KB: K-001 (auth) [applied] → edit:src/auth/**/*.ts !edit:src/legacy/**\`.
- **skip reason dictionary**: \`sequencing | conditional | semantic | aesthetic | architectural | other:<text>\`.
- **type routing**: a models-type citation is a reference cite, no contract needed; guidelines/processes types are not yet enforced, deferred to an LLM-judge.
- **user mentions a rule verbally without an id**: first call \`fab_recall(paths)\` or \`fab_extract_knowledge\` to look it up.
- **dismissed reason**: enum \`scope-mismatch | outdated | not-applicable | other:<text>\`.
- **\`KB: none\` sentinel**: two compliant reasons —— \`[no-relevant]\` you called \`fab_recall\` / \`fab_plan_context\` (or hook output is visible) but no usable entry; \`[not-applicable]\` the current action is not in cite scope (pure exploration / read-only Bash / user Q&A). A bare \`KB: none\` (no suffix) is still valid, classified as \`[unspecified]\` (legacy compatible, annotating later is encouraged).
- **audit**: \`fabric doctor --cite-coverage [--since=7d] [--client=cc|codex|all]\` reports cite coverage, including the \`KB: none\` sentinel breakdown. This rule does not block your work, it only records.
- **Clean-slate (no backward compat)**: the parser recognises only the three states \`applied\` / \`dismissed\` / \`none\`; any unrecognised legacy tag (\`planned\` / \`recalled\` / \`chained-from <id>\`) degrades to \`none\` (\`chained-from\`'s embedded id is still rescued as a sibling cite_id). Legacy cites left by old sessions count toward cite-coverage as \`none\`.
- **Full reference offloaded** (v2.2 SK5): the authoritative details for contract operators / skip·dismissed dictionaries / type routing / audit semantics / **adjudication ladder** (AI self-decide → multi-LLM incl. zero-context cold review → non-blocking queue) live in the \`fabric-review\` skill's \`ref/cite-contract.md\` —— bootstrap keeps only the executable core, governance detail goes to ref so it doesn't bloat bootstrap.
`;

/**
 * Locale-keyed canonical bodies. The single content-layer source consumers
 * (install writer, doctor drift comparator) select from via
 * {@link resolveBootstrapCanonical}.
 */
export const BOOTSTRAP_CANONICAL_BY_LOCALE: Record<Locale, string> = {
  "zh-CN": BOOTSTRAP_CANONICAL_ZH,
  en: BOOTSTRAP_CANONICAL_EN,
};

/**
 * Resolve the locale-appropriate canonical bootstrap body. Defaults to the
 * machine-wide language flow ({@link resolveGlobalLocale}); pass an explicit
 * locale only when the caller already resolved one (e.g. an install pipeline
 * stage that resolved it once and threads it down).
 */
export function resolveBootstrapCanonical(locale?: Locale): string {
  return BOOTSTRAP_CANONICAL_BY_LOCALE[locale ?? resolveGlobalLocale()];
}

/**
 * If `body` byte-equals some locale's canonical bootstrap body, return that
 * locale; otherwise null. Used by the doctor drift comparator to distinguish a
 * locale-switched-but-otherwise-canonical snapshot (suggest reinstall) from a
 * genuinely hand-edited / stale one (fixable drift) — see G-PARITY C2.
 */
export function matchBootstrapCanonicalLocale(body: string): Locale | null {
  for (const locale of Object.keys(BOOTSTRAP_CANONICAL_BY_LOCALE) as Locale[]) {
    if (BOOTSTRAP_CANONICAL_BY_LOCALE[locale] === body) {
      return locale;
    }
  }
  return null;
}
