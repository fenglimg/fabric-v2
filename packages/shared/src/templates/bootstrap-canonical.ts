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
 * IMPORTANT: the {@link BOOTSTRAP_CANONICAL} body is byte-locked. Do not edit
 * casually — downstream drift detection asserts byte-identical equality, and
 * the published-package version becomes the contract between Fabric CLI and
 * any Fabric server.
 */

/**
 * HTML-comment marker pair delimiting the managed Fabric bootstrap section.
 * Both writer (idempotent in-place replace) and uninstall helper match these
 * as plain substrings — keep byte-identical.
 */
export const BOOTSTRAP_MARKER_BEGIN = "<!-- fabric:bootstrap:begin -->";
export const BOOTSTRAP_MARKER_END = "<!-- fabric:bootstrap:end -->";

/**
 * Legacy marker pair from rc.12-rc.18 era (when the managed section was
 * branded "Fabric Knowledge Base"). Retained here for one-time migration
 * detection only: rc.19 install path scans for legacy markers, strips the
 * legacy region, and rewrites with the new bootstrap markers.
 */
export const LEGACY_KB_MARKER_BEGIN = "<!-- fabric:knowledge-base:begin -->";
export const LEGACY_KB_MARKER_END = "<!-- fabric:knowledge-base:end -->";

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
 * Legacy-marker variant used for one-time migration detection during rc.19
 * install — same shape as {@link BOOTSTRAP_REGEX} but targets the older
 * `knowledge-base` marker pair.
 */
export const LEGACY_KB_REGEX =
  /(?:\r?\n){0,2}<!-- fabric:knowledge-base:begin -->[\s\S]*?<!-- fabric:knowledge-base:end -->/;

/**
 * Canonical bootstrap body — byte-locked per rc.19 locked clarification 3.
 * Rendered into the managed block between {@link BOOTSTRAP_MARKER_BEGIN} and
 * {@link BOOTSTRAP_MARKER_END} by `fabric install` across all three supported
 * clients (Claude Code, Cursor, Codex CLI).
 *
 * Length guarantee: ≥ 800 bytes (rc.24: grew from ≥400 with cite-contract syntax).
 */
export const BOOTSTRAP_CANONICAL = `# Fabric Bootstrap

本项目使用 Fabric 管理跨客户端 AI 知识与行为规则。本文件由 \`fabric install\` 同步到三端 managed block,**不要手动编辑三端的 block**,只改这里 + 重跑 \`fabric install\`。

## For Developers

这个文件是 **AI 客户端的策略与规约配置**,不是 dev onboarding。你不需要读 Self-archive / Cite / Phase 0.4 等细节。
作为 dev 你只需要:在每个 repo 跑一次 \`fabric install\`,出问题跑 \`fabric doctor\`,在 \`.fabric/knowledge/<type>/\` 下写 markdown。
**严禁手动编辑 \`.fabric/agents.meta.json\`** — 派生状态由 engine 重建。

## 5 分钟上手 (Dev Quickstart)

**Fabric 是什么**:跨客户端(Claude Code / Codex CLI / Cursor)的 AI 知识层。把团队/项目的 **decisions / pitfalls / guidelines / models / processes** 存为 markdown,hook 自动 surface 给 AI,让 AI 不用每次重学。

**你要做的 (DO)** vs **engine 自动的 (DON'T 手动)**:

| 你 DO | 你 DON'T |
| --- | --- |
| 每个 repo 跑一次 \`fabric install\` | 手编 \`.fabric/agents.meta.json\` |
| 异常时跑 \`fabric doctor\` (--fix 自愈) | 手编 \`.claude/hooks/\` 下 \`.cjs\` |
| 在 \`.fabric/knowledge/<type>/\` 下写 markdown | 操心 Phase 0.4 / E3 / cite policy |
| \`npm install -g @fenglimg/fabric-cli@latest\` 升级 | 背 35 条 doctor lint 代码 |

**4 步循环**: \`fabric install\` (一次) → AI 正常工作 (hook on session start + edit) → AI 提议条目入 \`.fabric/knowledge/pending/\` → 用 \`fabric-review\` skill 或 \`fabric doctor --fix\` 审核归档。

**真例**:某 sprite 黑边 root cause 是 \`atlas.premultiplyAlpha\` flag 反向 — 写进 \`.fabric/knowledge/pitfalls/\` 后,下次同类问题 AI 自动 reference。

完整 maintainer 版见 \`docs/USER-QUICKSTART.md\`。

## 行为规则
- **修改任何文件前**:优先单步 \`fab_recall(paths=[<被改文件>])\` —— 一次调用直接拿回所有相关 KB 正文(rc.37+ 默认路径,省掉手动挑 id 的环节)。**仅当单步拉回的正文过多、导致上下文过载需精确裁剪噪音时**才走两步:先 \`fab_plan_context(paths=[...])\` 拿 \`selection_token\` + 顶层 \`candidates[]\`(从 \`candidates[].stable_id\` 挑),再 \`fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>...] })\` 取正文。
- **\`.fabric/agents.meta.json\` 严禁手动编辑**;engine 会自动同步派生状态,显式 reconcile 跑 \`fabric doctor --fix\`。

## 知识库(KB)
- **Discovery**:SessionStart hook 列 broad-scoped 条目(含 personal layer \`KP-*\` 条目,引用方式相同);edit 文件时 PreToolUse hook 可能触发 narrow hint。
- **Usage**:常态走单步 \`fab_recall(paths=[...])\` 一次拿回相关 KB 正文。仅当单步正文过多致上下文过载、需精确裁剪噪音时才两步:\`fab_plan_context(paths=[...])\` 返回 \`selection_token\` + 顶层 \`candidates[]\`,再 \`fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<从 candidates[].stable_id 挑>...] })\` 拉全文;\`selection_token\` 必须来自最近一次 \`fab_plan_context\`,不可凭空编造。
- **session_id**: 调用 \`fab_recall\` / \`fab_plan_context\` 时, 务必把当前 client session id 作为 \`session_id\` 参数传入(Claude Code 的 session id 在 stdin payload 中, Codex 的对应 identifier 同理)。这能让 \`fabric doctor --archive-history\` 与 archive-hint hook 准确识别跨会话 debt 状态。
- **Write flows**:\`fabric-archive\` / \`fabric-review\` / \`fabric-import\` 三个 Skills。
- **Language**:渲染按 \`.fabric/fabric-config.json\` 的 \`fabric_language\` 字段。
- **Archive cadence nudge** (rc.36): 每完成 5+ 次 Edit / 显著 decision 后,在合适回合主动 propose 调 \`fabric-archive\` skill — archive 没建立频率会让 KB 慢速死掉。
- **Review backlog nudge** (rc.36): \`.fabric/knowledge/pending/\` 累积 >10 条时,在合适回合主动 propose 调 \`fabric-review\` skill 批量审,避免 draft 卡死。

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
  顺手归档: 注意到你说 \`<触发短语>\`, 已调用 fabric-archive 抓 N 条候选 → .fabric/knowledge/pending/...
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
- **Backward compat**: 解析器同时接受老 4-state tags (\`planned\` / \`recalled\` / \`chained-from <id>\`) — 都映射到 \`[applied]\` 语义,gradually 迁到新简化形态即可,旧 session 留下的 cite 仍然计入 cite-coverage。
- **完整参考下沉** (v2.2 SK5): contract operator / skip·dismissed 词典 / 类型路由 / 稽核口径 / **裁决阶梯** (AI自决 → 多-LLM 含零上下文冷评 → 非阻塞队列) 的权威详参在 \`fabric-review\` skill 的 \`ref/cite-contract.md\` —— bootstrap 只留可执行 core,治理细节归 ref 不再撑大 bootstrap。
`;
