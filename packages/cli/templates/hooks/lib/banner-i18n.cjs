/**
 * v2.0.0-rc.16 TASK-001 (F2-prep): shared banner-i18n library for hook scripts.
 *
 * Provides:
 *   - readFabricLanguage(projectRoot) → 'zh-CN' | 'en' | 'zh-CN-hybrid' | 'match-existing'
 *     Synchronously reads `fabric_language` from `.fabric/fabric-config.json`.
 *     Mirrors the never-throw contract of the existing config readers in
 *     fabric-hint.cjs (readReviewHintPendingCount, readMaintenanceHintDays, etc.):
 *     missing file / parse error / missing field → returns 'zh-CN' (the
 *     documented BACKWARD-COMPAT default — preserves rc.15 hard-coded zh-CN
 *     hook output when fabric_language was never a configurable key).
 *
 *     'match-existing' is ONLY returned when explicitly set in config; per UX
 *     i18n Policy class 1, renderBanner then folds 'match-existing' (and any
 *     unknown variant) down to 'en'.
 *
 *     RC.16 TASK-002 NOTE: this default was originally 'match-existing' in
 *     TASK-001 but was tightened to 'zh-CN' here so that the existing rc.7+
 *     fabric-hint test fixtures (which never set fabric_language and expect
 *     zh-CN substrings byte-identically) continue passing without modification.
 *     Pre-user clean-slate policy: no shim, but back-compat for in-tree tests
 *     is the right line — they encode the rc.15 user-visible contract.
 *
 *   - renderBanner(key, variant, params) → string
 *     Renders one of the 11 banner fragments for the requested variant.
 *     Variant fallback: STRINGS[key][variant] ?? STRINGS[key]['en'].
 *     Unknown / 'match-existing' / missing → 'en' table.
 *
 *   - STRINGS — exported for test introspection only (read-only by convention).
 *
 * Banner keys (11 total):
 *   Signal A (archive):     archiveLine1, archiveActivity, archiveCta
 *   Signal B (review):      reviewLine1, reviewCta
 *   Signal C (import):      importLine1, importCta
 *   Signal D (maintenance): maintenanceLine1Never, maintenanceLine1Aged, maintenanceLine2
 *   Broad hook:             broadImportBanner
 *
 * Protected tokens — NEVER translated, kept verbatim across all 4 variants:
 *   - Slash commands: /fabric-archive, /fabric-review, /fabric-import
 *   - CLI commands:   `fabric doctor --lint`
 *   - Numeric / template substrings the existing tests assert on:
 *       "${hoursElapsed.toFixed(1)}h" (e.g. "25.0h"), "阈值 ${N}h",
 *       "${count} 条", "${nodeCount}/${threshold}", "${days} 天"
 *   - 📋 Fabric: emoji prefix
 *
 * zh-CN-hybrid policy: Chinese narrative prose with English protected tokens
 * preserved verbatim. In practice this matches zh-CN exactly because the
 * banners already inline slash commands + CLI commands without translation;
 * we keep the variant entries explicit anyway for forward-compat (future copy
 * may diverge, e.g. mixing English connector words).
 *
 * match-existing policy: per UX i18n Policy class 1, falls back to 'en' at
 * render time. The fallback decision is centralized in renderBanner; only an
 * EXPLICIT `fabric_language: "match-existing"` in config triggers the en
 * fallback. Unset / missing config defaults to 'zh-CN' (rc.15 back-compat).
 *
 * Pattern reference:
 *   - Never-throw fs read: fabric-hint.cjs `_readConfigNumber`,
 *     `readReviewHintPendingCount` (lines 720-743)
 *   - hooks/lib/*.cjs precedent: session-digest-writer.cjs
 */
"use strict";

const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const FABRIC_DIR = ".fabric";
const CONFIG_FILE = "fabric-config.json";

const VALID_LANGUAGES = ["zh-CN", "en", "zh-CN-hybrid", "match-existing"];
// rc.16 TASK-002: backward-compat default. rc.15 and earlier hardcoded
// zh-CN in the hook scripts; preserving zh-CN as the unset-default keeps
// the rc.7+ fabric-hint test fixtures (which assert Chinese substrings
// without ever setting fabric_language) green and matches the user-visible
// contract real workspaces have observed since rc.7.
const DEFAULT_LANGUAGE = "zh-CN";
const RENDER_FALLBACK_VARIANT = "en";

/**
 * Read `fabric_language` from <projectRoot>/.fabric/fabric-config.json.
 *
 * Returns one of the four valid language codes. Missing file, malformed JSON,
 * missing/unknown field value → DEFAULT_LANGUAGE ('zh-CN' — see comment on
 * the constant for the back-compat rationale). NEVER throws — config-read
 * failure must not block any hook.
 */
function readFabricLanguage(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return DEFAULT_LANGUAGE;
  }
  const configPath = join(projectRoot, FABRIC_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) return DEFAULT_LANGUAGE;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const v = parsed && parsed.fabric_language;
    if (typeof v === "string" && VALID_LANGUAGES.indexOf(v) !== -1) {
      return v;
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_LANGUAGE;
}

// ---------------------------------------------------------------------------
// String table
// ---------------------------------------------------------------------------
//
// Each key maps variant -> (params) => string. Templates intentionally use
// the same parameter names across all four variants so call sites pass one
// shape. Substring contracts (see file header) are preserved verbatim across
// translations; only narrative connector words shift.
// ---------------------------------------------------------------------------

const STRINGS = {
  // ---- Signal A: archive ----------------------------------------------------
  // Source (zh-CN): fabric-hint.cjs:614  `📋 Fabric: 距上次归档 ${parts}。`
  // params: { parts } where parts is pre-joined `已过 25.0h（阈值 24h）` etc.
  //
  // v2.0.0-rc.27 TASK-005 (audit §2.17): `parts` is now constructed by the
  // sibling archivePartsHours / archivePartsEdits keys (also per-variant) so
  // the caller never hardcodes Chinese into the en banner. The substring
  // contract on "25.0h" / "阈值 N" / "次编辑" is preserved per-variant but
  // each variant gets a coherent monolingual rendering — pre-rc.27 produced
  // mixed-language output like `📋 Fabric: 已过 25.0h since last archive.`
  // (audit §2.17 reproduction).
  archiveLine1: {
    "zh-CN": (p) => `📋 Fabric: 距上次归档 ${p.parts}。`,
    en: (p) => `📋 Fabric: ${p.parts} since last archive.`,
    "zh-CN-hybrid": (p) => `📋 Fabric: 距上次归档 ${p.parts}。`,
  },

  // v2.0.0-rc.27 TASK-005 (audit §2.17): per-variant assembly of the
  // hours-trigger fragment. zh-CN tightens to the original substring
  // contract (`已过 25.0h（阈值 24h）`); en variant translates the prose
  // while preserving the numeric tokens; hybrid mirrors zh-CN.
  // params: { hoursFixed: string (already toFixed(1)), threshold: number }
  archivePartsHours: {
    "zh-CN": (p) => `已过 ${p.hoursFixed}h（阈值 ${p.threshold}h）`,
    en: (p) => `${p.hoursFixed}h elapsed (threshold ${p.threshold}h)`,
    "zh-CN-hybrid": (p) => `已过 ${p.hoursFixed}h（阈值 ${p.threshold}h）`,
  },

  // v2.0.0-rc.27 TASK-005 (audit §2.17): edits-trigger fragment.
  // params: { count: number, threshold: number }
  archivePartsEdits: {
    "zh-CN": (p) => `累计 ${p.count} 次编辑（阈值 ${p.threshold}）`,
    en: (p) => `${p.count} edits since last archive (threshold ${p.threshold})`,
    "zh-CN-hybrid": (p) => `累计 ${p.count} 次编辑（阈值 ${p.threshold}）`,
  },

  // Source (zh-CN): fabric-hint.cjs:619  `   最近活动集中在: ${activity}。`
  // params: { activity }
  archiveActivity: {
    "zh-CN": (p) => `   最近活动集中在: ${p.activity}。`,
    en: (p) => `   Recent activity centered on: ${p.activity}.`,
    "zh-CN-hybrid": (p) => `   最近活动集中在: ${p.activity}。`,
  },

  // Source (zh-CN): fabric-hint.cjs:621  `   是否调 /fabric-archive 检查值得归档的决策/踩坑/复用?`
  // params: {} — protected token /fabric-archive verbatim across all variants.
  archiveCta: {
    "zh-CN": () => "   是否调 /fabric-archive 检查值得归档的决策/踩坑/复用?",
    en: () => "   Run /fabric-archive to review decisions/pitfalls/reusables worth archiving?",
    "zh-CN-hybrid": () => "   是否调 /fabric-archive 检查值得归档的决策/踩坑/复用?",
  },

  // ---- Signal B: review -----------------------------------------------------
  // Source (zh-CN): fabric-hint.cjs:651  `📋 Fabric: 已积累 ${stats.count} 条待审核知识${ageSuffix}。`
  // params: { count, ageSuffix } — ageSuffix is " / 最早一条 N.N 天前" or "" (zh-CN only)
  // For en variant we shape the suffix inline to keep substring "${count}" addressable.
  reviewLine1: {
    "zh-CN": (p) => `📋 Fabric: 已积累 ${p.count} 条待审核知识${p.ageSuffix || ""}。`,
    en: (p) => {
      const suffix =
        p.ageSuffix && p.ageSuffix.length > 0
          ? p.ageSuffix
              .replace(" / 最早一条 ", " / oldest is ")
              .replace(" 天前", "d old")
          : "";
      return `📋 Fabric: ${p.count} pending knowledge entries accumulated${suffix}.`;
    },
    "zh-CN-hybrid": (p) => `📋 Fabric: 已积累 ${p.count} 条待审核知识${p.ageSuffix || ""}。`,
  },

  // Source (zh-CN): fabric-hint.cjs:652  `   是否调 /fabric-review 审核 pending/ 条目?`
  // params: {} — protected token /fabric-review verbatim across all variants.
  reviewCta: {
    "zh-CN": () => "   是否调 /fabric-review 审核 pending/ 条目?",
    en: () => "   Run /fabric-review to triage pending/ entries?",
    "zh-CN-hybrid": () => "   是否调 /fabric-review 审核 pending/ 条目?",
  },

  // ---- Signal C: import (underseed) ----------------------------------------
  // Source (zh-CN): fabric-hint.cjs:697  `📋 Fabric: 知识库节点数 ${nodeCount}/${threshold}，距 init_scan_completed ${hoursSinceInit.toFixed(1)}h。`
  // params: { nodeCount, threshold, hoursSinceInit } — caller supplies hoursSinceInit
  //         already toFixed(1)'d (i.e. as string "24.5") to keep all rendering pure.
  importLine1: {
    "zh-CN": (p) =>
      `📋 Fabric: 知识库节点数 ${p.nodeCount}/${p.threshold}，距 init_scan_completed ${p.hoursSinceInit}h。`,
    en: (p) =>
      `📋 Fabric: knowledge node count ${p.nodeCount}/${p.threshold}, ${p.hoursSinceInit}h since init_scan_completed.`,
    "zh-CN-hybrid": (p) =>
      `📋 Fabric: 知识库节点数 ${p.nodeCount}/${p.threshold}，距 init_scan_completed ${p.hoursSinceInit}h。`,
  },

  // Source (zh-CN): fabric-hint.cjs:698  `   是否调 /fabric-import 从 git 历史与现有文档回灌知识?`
  // params: {} — protected token /fabric-import verbatim across all variants.
  importCta: {
    "zh-CN": () => "   是否调 /fabric-import 从 git 历史与现有文档回灌知识?",
    en: () => "   Run /fabric-import to backfill knowledge from git history and existing docs?",
    "zh-CN-hybrid": () => "   是否调 /fabric-import 从 git 历史与现有文档回灌知识?",
  },

  // ---- Signal D: maintenance -----------------------------------------------
  // Source (zh-CN): fabric-hint.cjs:931  `📋 Fabric: 从未运行 lint 检查。`
  // params: {} — substring "从未运行 lint 检查" is test-asserted (zh-CN test).
  maintenanceLine1Never: {
    "zh-CN": () => "📋 Fabric: 从未运行 lint 检查。",
    en: () => "📋 Fabric: lint check has never been run.",
    "zh-CN-hybrid": () => "📋 Fabric: 从未运行 lint 检查。",
  },

  // Source (zh-CN): fabric-hint.cjs:932  `📋 Fabric: 已 ${days} 天未跑 lint 检查（实际 ${ageDays.toFixed(1)}d）。`
  // params: { days, ageDays } — ageDays caller-supplied as already-toFixed(1) string.
  // Substring "已 N 天未跑 lint" is test-asserted (zh-CN test).
  maintenanceLine1Aged: {
    "zh-CN": (p) => `📋 Fabric: 已 ${p.days} 天未跑 lint 检查（实际 ${p.ageDays}d）。`,
    en: (p) => `📋 Fabric: ${p.days} days since the last lint check (actual ${p.ageDays}d).`,
    "zh-CN-hybrid": (p) => `📋 Fabric: 已 ${p.days} 天未跑 lint 检查（实际 ${p.ageDays}d）。`,
  },

  // Source (zh-CN): fabric-hint.cjs:929  `   是否调 \`fabric doctor --lint\` 看看知识库健康度?`
  // params: {} — protected token `fabric doctor --lint` (with backticks) verbatim.
  maintenanceLine2: {
    "zh-CN": () => "   是否调 `fabric doctor --lint` 看看知识库健康度?",
    en: () => "   Run `fabric doctor --lint` to check knowledge-base health?",
    "zh-CN-hybrid": () => "   是否调 `fabric doctor --lint` 看看知识库健康度?",
  },

  // ---- Stop hook: session-activity status (human trust anchor) -------------
  // Observability grill (a): a no-signal Stop currently returns SILENT — the
  // human only ever hears from Fabric when there is a nudge to act on, never a
  // "here is what I did" status, which reads as "Fabric does nothing". This line
  // is the trust anchor: session-scoped counts from events.jsonl (edits +
  // knowledge pulls by the AI + pending backlog). Cadence is gated by nudge_mode
  // (silent=never, normal=once/session, verbose=every turn) at the call site.
  // params: { edits, consumed, pending } — all numbers.
  statusLine: {
    "zh-CN": (p) =>
      `📋 Fabric 本会话 · 改 ${p.edits} 文件 · AI 取用知识 ${p.consumed} 次 · 待审 ${p.pending} 条`,
    en: (p) =>
      `📋 Fabric this session · ${p.edits} files edited · ${p.consumed} KB pulls by AI · ${p.pending} pending`,
    "zh-CN-hybrid": (p) =>
      `📋 Fabric 本会话 · 改 ${p.edits} 文件 · AI 取用知识 ${p.consumed} 次 · 待审 ${p.pending} 条`,
  },

  // ---- Stop hook: nudge_mode tier guidance (discoverability) ---------------
  // Observability grill (Q4): users did not know the human-channel volume knob
  // (nudge_mode) exists, so they assumed the hooks never surface to humans. This
  // line names the current tier and the levers. params: { mode } — current
  // nudge_mode. Protected token: nudge_mode + the config path verbatim.
  statusTier: {
    "zh-CN": (p) =>
      `   音量 ${p.mode}:verbose=每步可见 / silent=静音(.fabric/fabric-config.json nudge_mode)`,
    en: (p) =>
      `   volume ${p.mode}: verbose=show every step / silent=mute (.fabric/fabric-config.json nudge_mode)`,
    "zh-CN-hybrid": (p) =>
      `   音量 ${p.mode}:verbose=每步可见 / silent=静音(.fabric/fabric-config.json nudge_mode)`,
  },

  // ---- Broad hook: import recommendation ------------------------------------
  // Source (zh-CN): knowledge-hint-broad.cjs:262
  //   "  📋 Fabric: 知识库稀疏，是否调 /fabric-import 从 git 历史与现有文档回灌知识?"
  // Note: leading two spaces are intentional (existing banner indent).
  // params: {} — protected token /fabric-import verbatim.
  broadImportBanner: {
    "zh-CN": () => "  📋 Fabric: 知识库稀疏，是否调 /fabric-import 从 git 历史与现有文档回灌知识?",
    en: () =>
      "  📋 Fabric: knowledge base is sparse — run /fabric-import to backfill from git history and existing docs?",
    "zh-CN-hybrid": () =>
      "  📋 Fabric: 知识库稀疏，是否调 /fabric-import 从 git 历史与现有文档回灌知识?",
  },

  // ---- Broad hook: meta auto-refresh breadcrumb (rc.22 Scope D T-D4) -------
  // Surfaced ONLY when planContext() detected meta drift and rebuilt the meta
  // in-place (server emits `auto_healed: true` in plan-context-hint payload).
  // Single informational line — operators need a breadcrumb when meta auto-
  // heals so a "why did revision change?" question has a paper trail.
  //
  // Two render shapes:
  //   - metaAutoRefreshedBanner: full transition with prev → cur 8-char hash
  //     prefixes. Used when both previous_revision_hash + revision_hash present.
  //   - metaAutoRefreshedBannerGeneric: defensive fallback when the server
  //     emitted `auto_healed: true` but did not include previous_revision_hash
  //     (T10 noted this edge case). No hash transition shown.
  //
  // Note: 🔄 emoji prefix is intentional (matches the project's general "no
  // emoji" rule's exception for explicit user request — see TASK-011 description).
  // params: { prev, cur } — both already 8-char hex strings, caller-supplied.
  metaAutoRefreshedBanner: {
    "zh-CN": (p) => `  🔄 Fabric: 元数据已自动刷新(sha ${p.prev} → ${p.cur})`,
    en: (p) => `  🔄 Fabric: meta auto-refreshed (sha ${p.prev} → ${p.cur})`,
    "zh-CN-hybrid": (p) => `  🔄 Fabric: 元数据已自动刷新(sha ${p.prev} → ${p.cur})`,
  },

  // Generic variant — no hash transition. Used when auto_healed:true but
  // previous_revision_hash is missing from the payload.
  metaAutoRefreshedBannerGeneric: {
    "zh-CN": () => "  🔄 Fabric: 元数据已自动刷新",
    en: () => "  🔄 Fabric: meta auto-refreshed",
    "zh-CN-hybrid": () => "  🔄 Fabric: 元数据已自动刷新",
  },
};

/**
 * Render a banner fragment for the requested variant.
 *
 * Variant resolution:
 *   1. If STRINGS[key][variant] exists → use it.
 *   2. Else fall back to STRINGS[key][RENDER_FALLBACK_VARIANT] ('en').
 *   3. If key itself is unknown → returns "" (defensive; never throws).
 *
 * 'match-existing' is intentionally NOT in the STRINGS table so it folds
 * down to the 'en' fallback per UX i18n Policy class 1.
 */
function renderBanner(key, variant, params) {
  const entry = STRINGS[key];
  if (!entry) return "";
  const tmpl = entry[variant] || entry[RENDER_FALLBACK_VARIANT];
  if (typeof tmpl !== "function") return "";
  try {
    return tmpl(params || {});
  } catch {
    // Defensive: a missing param shouldn't crash the hook.
    return "";
  }
}

module.exports = { readFabricLanguage, renderBanner, STRINGS };
