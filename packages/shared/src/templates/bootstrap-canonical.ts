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
- **修改任何文件前**:先 \`fab_recall(paths=[<被改文件>])\` —— 一次调用拿回相关 KB 的描述 + 原生读取路径(\`entries[].read_path\`)。\`fab_recall\` 不再投递正文;需要某条正文时直接对其 \`entries[].read_path\` 做原生 Read(\`Read <store>/knowledge/<type>/<id>--*.md\`),这会被 PostToolUse hook 记为 \`knowledge_body_read\`。lean 默认:描述+索引已够发现条目,正文按需读一次,不每轮重灌(KT-GLD-0005)。
- **\`.fabric/agents.meta.json\` 严禁手动编辑**;engine 会自动同步派生状态,显式 reconcile 跑 \`fabric doctor --fix\`。

## 知识库(KB)
- **Discovery**:SessionStart hook 列 broad-scoped 条目(条目按 \`semantic_scope\` 分三层:\`team\` 团队通用 / \`project:<id>\` 本项目专属(仅在绑定该项目的仓库浮现)/ \`personal\` 个人 \`KP-*\`,三者引用方式相同);edit 文件时 PreToolUse hook 可能触发 narrow hint。
- **Scope 三轴(为什么没浮现)** (KT-MOD-0001):一条知识是否浮现由三个**正交**轴决定 —— ① \`semantic_scope\` 受众(\`team\` / \`project:<id>\` / \`personal\`;绑错项目则不显)② \`relevance_scope\` 时机(\`broad\` 常驻 / \`narrow\` 仅编辑匹配文件时浮现)③ \`store\` 物理库(没 \`fabric store bind\` 就不读)。三轴名字会撞("team" 既是受众值也可是 store 别名),所以困惑"为什么这条没浮现"时跑 \`fabric audit why-not-surfaced <id>\` 逐因诊断(store 没绑 / scope 不匹配 / narrow 时机)。
- **Usage**:走单步 \`fab_recall(paths=[...])\` 一次拿回相关 KB 的描述 + 读取路径;需要某条正文时对其 \`entries[].read_path\` 做原生 Read 取回(不再走 MCP 二次取正文)。
- **session_id**: 调用 \`fab_recall\` 时, 务必把当前 client session id 作为 \`session_id\` 参数传入(Claude Code 的 session id 在 stdin payload 中, Codex 的对应 identifier 同理)。这能让 \`fabric doctor --archive-history\` 与 \`fabric-hint.cjs\` Stop hook 准确识别跨会话 debt 状态。
- **Skills (4)**:写流程 \`fabric-archive\`(含 source mode 冷启动从 git/docs 回灌)/ \`fabric-review\`(含 retire 语义淘汰 + relate 关联建边 子流程);store 运维 \`fabric-store\` / \`fabric-sync\`。
- **Language**:渲染按 \`~/.fabric/fabric-global.json\` 的 \`language\` 字段(machine-wide tone)。
- **Archive cadence nudge** (rc.36): 每完成一批 Edit(默认 ~20 次, 与 Stop hook 阈值 config \`archive_edit_threshold\` 一致)/ 显著 decision 后,在合适回合主动 propose 调 \`fabric-archive\` skill — archive 没建立频率会让 KB 慢速死掉。
- **Review backlog nudge** (rc.36): 需要判断 pending backlog 时走 \`fab_review action="list"\` 或 \`fabric-review\` 返回的 \`pending_path\`;不要 glob 项目本地 \`.fabric/knowledge/pending\`。当可见 pending 累积 >10 条时,在合适回合主动 propose 调 \`fabric-review\` skill 批量审,避免 draft 卡死。

## Self-archive policy (v2.2 C1: 精简说明书)

出现明确归档信号时, 于该 turn 末尾自主调用 \`fabric-archive\` skill(AI 自触发入口 E3):

- **触发** (二选一): ① **User-driven normative** — 用户说 \`以后\` / \`always\` / \`never\` / \`下次\` / \`记一下\`, 或在 ≥2 候选间权衡后锁定方向, 或拒了建议并给了理由(理由即知识); ② **Wrong-turn-and-revert** — 你试了 path X 反思后改走 path Y("否定+替代"两步结构, 非单纯探索失败)。
- **不触发**: 用户纯询问 / 简单 refactor·typo / 凭空"我学到了"的洞察。
- **防 loop**: 同 turn 最多自调 1 次; 同 session 同 outcome 不重复; skill 内 Phase 2.5 viability gate 兜底。
- **回执 (marker-free)**: 直接自调 \`fabric-archive\` skill 即可, 无需打印任何暗号字符串 —— skill 默认把 AI 自调识别为 E3(确定性 else 路由, 不再依赖 AI 输出精确字符串)。skill 落 pending 后返回 \`pending_path\`, 不该记就回 \`undo\`(我调 fab_review reject)。

## Cite policy (v2.2 C1: recall 自动记账, 零首行负担)

- **核心 (recall-first 自动记账)**: 改任何文件前先 \`fab_recall(paths=[<被改文件>])\`。系统按"本 session recall 命中的 path 与编辑目标重叠"自动把召回的 KB 记为该次 edit 的引用 —— **无需手写任何回复首行**(C1 删除首行 \`KB:\` contract 八股:先想后说,recall 才是引用发生的真实信号)。PreToolUse 检测不到相关 recall 时给一条软 nudge(nudge 非 gate,守 KT-DEC-0007)。
- **唯一要开口的时候 (dismissed / override)**: 你判断某召回 KB 不该应用时,说一句 \`dismissed: <id> (<reason>)\`;reason 枚举 \`scope-mismatch | outdated | not-applicable | other:<text>\`。需精确标注仍可用首行 \`KB: <id> [applied|dismissed]\`(解析器保留,向后兼容)。
- **\`[applied]\` 验证义务**: 引用任何 id(自动或手写)前必须先 fab_recall 实际抓回 KB(按需对正文路径做原生 Read),防止编造 id。验证不通过 = 不能 cite。
- **稽核与完整规约**: \`fabric audit cite\` 输出覆盖率(不阻断工作,只记录);contract operator / store 前缀 / skip·dismissed 词典 / 类型路由 / 裁决阶梯等完整规约权威详参 \`fabric-review\` skill 的 \`ref/cite-contract.md\` —— bootstrap 只留可执行 core。
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
- **Before modifying any file**: first \`fab_recall(paths=[<file-being-edited>])\` —— a single call returns the relevant KB descriptions + native read paths (\`entries[].read_path\`). \`fab_recall\` no longer delivers bodies; when you need a body, do a native Read of its \`entries[].read_path\` (\`Read <store>/knowledge/<type>/<id>--*.md\`), which the PostToolUse hook records as \`knowledge_body_read\`. Lean default: descriptions + index already suffice to discover entries; read a body once on demand, don't re-inject it every turn (KT-GLD-0005).
- **Never hand-edit \`.fabric/agents.meta.json\`**; the engine syncs derived state automatically — run \`fabric doctor --fix\` for an explicit reconcile.

## Knowledge Base (KB)
- **Discovery**: the SessionStart hook lists broad-scoped entries (scoped by \`semantic_scope\` across three tiers: \`team\` team-wide / \`project:<id>\` this-project-only (surfaces only in repos bound to that project) / \`personal\` \`KP-*\`, all three referenced the same way); editing a file may trigger a narrow hint via the PreToolUse hook.
- **Scope's 3 axes (why something isn't surfacing)** (KT-MOD-0001): whether an entry surfaces is decided by three **orthogonal** axes — ① \`semantic_scope\` audience (\`team\` / \`project:<id>\` / \`personal\`; the wrong project binding hides it) ② \`relevance_scope\` timing (\`broad\` always-on / \`narrow\` only when you edit a matching file) ③ \`store\` physical lib (not read without \`fabric store bind\`). The axis names collide ("team" is both an audience value and a possible store alias), so when puzzled about "why isn't this surfacing" run \`fabric audit why-not-surfaced <id>\` for a per-cause diagnosis (store unbound / scope mismatch / narrow timing).
- **Usage**: go one-step \`fab_recall(paths=[...])\` to fetch the relevant KB descriptions + read paths in one call; when you need a body, do a native Read of its \`entries[].read_path\` (no second MCP round-trip for the body).
- **session_id**: when calling \`fab_recall\`, always pass the current client session id as the \`session_id\` argument (Claude Code's session id is in the stdin payload; Codex's corresponding identifier likewise). This lets \`fabric doctor --archive-history\` and the \`fabric-hint.cjs\` Stop hook track cross-session debt accurately.
- **Skills (4)**: write flow \`fabric-archive\` (with source-mode cold-start backfill from git/docs) / \`fabric-review\` (with retire-deprecation + relate-edge sub-flows); store ops \`fabric-store\` / \`fabric-sync\`.
- **Language**: rendered per the \`language\` field in \`~/.fabric/fabric-global.json\` (machine-wide tone).
- **Archive cadence nudge** (rc.36): after each batch of edits (default ~20, matching the Stop hook threshold config \`archive_edit_threshold\`) / a significant decision, proactively propose the \`fabric-archive\` skill at a suitable turn — without an archive cadence the KB slowly dies.
- **Review backlog nudge** (rc.36): to judge the pending backlog, go through \`fab_review action="list"\` or the \`pending_path\` returned by \`fabric-review\`; don't glob the project-local \`.fabric/knowledge/pending\`. When the visible pending count exceeds 10, proactively propose the \`fabric-review\` skill at a suitable turn to batch-review and avoid draft deadlock.

## Self-archive policy (v2.2 C1: lean spec)

When a clear archival signal appears, autonomously invoke the \`fabric-archive\` skill at the end of that turn (AI self-trigger entry E3):

- **Trigger** (either): ① **User-driven normative** — the user says \`以后\` / \`always\` / \`never\` / \`下次\` / \`记一下\`, or locks a direction with rationale after weighing ≥2 candidates, or rejects a suggestion and states a reason (the reason is knowledge); ② **Wrong-turn-and-revert** — you tried path X, then after reflection switched to path Y (a two-step "negate + replace" structure, not mere exploratory failure).
- **Does NOT trigger**: pure user questions / simple refactor·typo / a baseless "I learned something" insight.
- **Anti-loop**: at most 1 self-invocation per turn; no repeat for the same outcome in the same session; the skill's Phase 2.5 viability gate is the backstop.
- **Receipt (marker-free)**: just invoke the \`fabric-archive\` skill directly — no marker string to print: the skill routes an AI self-invocation to E3 by default (deterministic else-branch, no longer dependent on the AI emitting an exact string). The skill returns \`pending_path\` after writing pending — reply \`undo\` if it shouldn't be recorded (I'll call fab_review reject).

## Cite policy (v2.2 C1: recall auto-accounting, zero first-line burden)

- **Core (recall-first auto-accounting)**: before changing any file, run \`fab_recall(paths=[<file-being-edited>])\` first. The system auto-accounts the recalled KB as that edit's citation by "paths recall-hit this session overlap the edit target" —— **no hand-written first reply line needed** (C1 removes the first-line \`KB:\` contract boilerplate: think-then-speak, recall is the real signal that a citation happened). The PreToolUse hook gives a soft nudge when it detects no relevant recall (nudge, not a gate, per KT-DEC-0007).
- **The only time to speak up (dismissed / override)**: when you judge a recalled KB should NOT apply, say one line \`dismissed: <id> (<reason>)\`; reason enum \`scope-mismatch | outdated | not-applicable | other:<text>\`. For precise annotation you may still use a first-line \`KB: <id> [applied|dismissed]\` (parser retained, backward compatible).
- **\`[applied]\` verification duty**: citing any id (auto or hand-written) requires first fetching the KB via fab_recall (a native Read of its body path when needed) to prevent fabricated ids. Verification failing = you cannot cite.
- **Audit & full spec**: \`fabric audit cite\` reports coverage (does not block your work, only records); the full spec (contract operators / store prefix / skip·dismissed dictionaries / type routing / adjudication ladder) lives authoritatively in the \`fabric-review\` skill's \`ref/cite-contract.md\` —— bootstrap keeps only the executable core.
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
