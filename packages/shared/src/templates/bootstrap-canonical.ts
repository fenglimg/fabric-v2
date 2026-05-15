/**
 * Canonical Fabric bootstrap content + marker constants — single source of truth
 * consumed by both `fab install` (writer) and the server-side doctor (drift
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
 * {@link BOOTSTRAP_MARKER_END} by `fab install` across all three supported
 * clients (Claude Code, Cursor, Codex CLI).
 *
 * Length guarantee: ≥ 400 bytes.
 */
export const BOOTSTRAP_CANONICAL = `# Fabric Bootstrap

本项目使用 Fabric 管理跨客户端 AI 知识与行为规则。本文件由 \`fab install\` 同步到三端 managed block,**不要手动编辑三端的 block**,只改这里 + 重跑 \`fab install\`。

## 行为规则
- **修改任何文件前**:必须先调 \`fab_plan_context(paths=[<被改文件>])\`,再调 \`fab_get_knowledge_sections\` 取相关规则段落。
- **\`.fabric/agents.meta.json\` 严禁手动编辑**:baseline 变更只能通过 \`fabric doctor --fix\` 接受。

## 知识库(KB)
- **Discovery**:SessionStart hook 列 broad-scoped 条目;edit 文件时 PreToolUse hook 可能触发 narrow hint。
- **Usage**:用 \`fab_get_knowledge_sections(id=...)\` 按 id 取条目全文。
- **Write flows**:\`fabric-archive\` / \`fabric-review\` / \`fabric-import\` 三个 Skills。
- **Language**:渲染按 \`.fabric/fabric-config.json\` 的 \`fabric_language\` 字段。
`;
