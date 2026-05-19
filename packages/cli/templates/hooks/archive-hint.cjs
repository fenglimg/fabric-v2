#!/usr/bin/env node
/**
 * v2.0.0-rc.25 TASK-03: archive-hint hook — Signal A (archive reminder).
 *
 * Standalone Signal A archive hook re-established from the rc.2 design.
 * fabric-hint.cjs continues to ship the merged archive/review/import flow for
 * existing installs; archive-hint.cjs is the rc.25-redesigned variant whose
 * reason copy explicitly communicates that the plan_context backlog is
 * project-level cross-session debt rather than current-session activity.
 *
 * Behaviour (compared to the rc.2 baseline):
 *   1. Bilingual reason copy. zh-CN: "跨 N 个会话累计 M 次 plan_context · 距上次归档 …
 *      — 这是项目级长期欠债, 不一定来自本会话。若本会话有产出, 可调用 fabric-archive;
 *      否则可忽略, 12h 后再提醒。" English mirror references "project-level long-term
 *      debt" so callers can grep either side. Language driven by
 *      `.fabric/fabric-config.json#fabric_language` via readFabricLanguage().
 *   2. Distinct-session count via `countDistinctSessions(events, lastProposedTs)`.
 *      When ≥50% of plan_context events since the watermark carry a `session_id`
 *      field, the wording reads "跨 N 个会话累计"; otherwise it degrades to
 *      "跨多个会话累计" (transitional period before TASK-02 fully lands).
 *   3. Watermark fallback. When the workspace has never recorded a
 *      knowledge_proposed event (or rotation cut off the historical watermark),
 *      decide() uses events[0]?.ts as a virtual watermark and appends a
 *      "(watermark 已被 rotation 清理)" suffix so operators understand why the
 *      hours-elapsed display is approximate.
 *
 * Invariants preserved:
 *   - stdout JSON shape: { decision: "block", reason, signal: "archive" }
 *   - Cooldown throttle via `.fabric/.cache/archive-hint-shown.json`
 *   - Fail-silent: any error → silent exit, NEVER blocks the Stop hook.
 */
"use strict";

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

// CONSTANTS — duplicated from packages/server/src/services/_shared.ts.
// DRY violation accepted: this hook script runs in user repos WITHOUT
// node_modules access, so it cannot import from @fenglimg/fabric-server.
const FABRIC_DIR = ".fabric";
const EVENT_LEDGER_FILE = "events.jsonl";
const EVENT_TYPE_PROPOSED = "knowledge_proposed";
const EVENT_TYPE_PLAN_CONTEXT = "knowledge_context_planned";
const THRESHOLD_PLAN_CONTEXTS = 5;
const THRESHOLD_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;

// Cooldown throttle. After the hook surfaces a reminder, it stays silent for
// this many hours — purely a reminder-noise throttle, not a state machine.
// Override via .fabric/fabric-config.json#archive_hint_cooldown_hours.
const CONFIG_FILE = "fabric-config.json";
const DEFAULT_COOLDOWN_HOURS = 12;
const SHOWN_CACHE_FILE = ".fabric/.cache/archive-hint-shown.json";

// rc.25 TASK-03: session-id coverage threshold. When ≥50% of plan_context
// events since the watermark carry a session_id, surface the distinct-session
// count ("跨 N 个会话"); below that, degrade to "跨多个会话" to avoid lying
// about a partial count during the transitional period before TASK-02 fully
// lands AI session_id propagation.
const SESSION_COVERAGE_THRESHOLD = 0.5;
// rc.25 TASK-03: i18n field name + language enum. Mirrors banner-i18n.cjs's
// readFabricLanguage contract; kept local so this hook stays self-contained.
const FABRIC_LANGUAGE_FIELD = "fabric_language";
const DEFAULT_LANGUAGE = "en";
const VALID_LANGUAGES = ["zh-CN", "en", "zh-CN-hybrid", "match-existing"];

/**
 * Read the events.jsonl ledger from <projectRoot>/.fabric/events.jsonl.
 * Mirrors the semantics of readEventLedger in packages/server/src/services/event-ledger.ts:
 *   - ENOENT → return [] (fabric not initialized)
 *   - split on /\r?\n/
 *   - drop final fragment if file lacks trailing newline (partial-tail tolerance)
 *   - JSON.parse per line, swallow per-line errors (corrupt-line tolerance)
 */
function readLedger(projectRoot) {
  const eventPath = join(projectRoot, FABRIC_DIR, EVENT_LEDGER_FILE);
  if (!existsSync(eventPath)) {
    return [];
  }

  let raw;
  try {
    raw = readFileSync(eventPath, "utf8");
  } catch {
    return [];
  }

  const lines = raw.split(/\r?\n/);
  const hasTrailingNewline = raw.endsWith("\n");
  if (!hasTrailingNewline && lines.length > 0) {
    lines.pop();
  }

  const events = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        events.push(parsed);
      }
    } catch {
      // corrupt JSON line — drop silently
    }
  }
  return events;
}

/**
 * Count distinct session_id values among knowledge_context_planned events that
 * happened AFTER the lastProposedTs watermark (or all such events when the
 * watermark is null).
 *
 * Returns { count, coverage_ratio, total } where:
 *   - count = number of distinct non-empty session_id strings observed
 *   - total = number of plan_context events considered
 *   - coverage_ratio = (events with session_id field) / total, in [0, 1].
 *     Used by decide() to choose between "跨 N 个会话" (high coverage) and
 *     "跨多个会话" (degraded — most events lack session_id).
 *
 * When `total === 0` returns { count: 0, coverage_ratio: 0, total: 0 } — the
 * caller is responsible for not invoking the wording in that case.
 */
function countDistinctSessions(events, lastProposedTs) {
  const sessions = new Set();
  let totalConsidered = 0;
  let withSessionId = 0;
  for (const ev of events) {
    if (!ev || ev.event_type !== EVENT_TYPE_PLAN_CONTEXT) continue;
    if (typeof ev.ts !== "number") continue;
    if (lastProposedTs !== null && ev.ts <= lastProposedTs) continue;
    totalConsidered += 1;
    if (typeof ev.session_id === "string" && ev.session_id.length > 0) {
      withSessionId += 1;
      sessions.add(ev.session_id);
    }
  }
  return {
    count: sessions.size,
    coverage_ratio: totalConsidered === 0 ? 0 : withSessionId / totalConsidered,
    total: totalConsidered,
  };
}

/**
 * Read `fabric_language` from <projectRoot>/.fabric/fabric-config.json.
 * Mirrors lib/banner-i18n.cjs#readFabricLanguage's never-throw contract.
 * Missing file / malformed JSON / missing field / unknown variant →
 * DEFAULT_LANGUAGE ('en' per rc.25 TASK-03 spec — en is the safe default for
 * non-Chinese users; explicit zh-CN config opts in to Chinese copy).
 */
function readFabricLanguage(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return DEFAULT_LANGUAGE;
  }
  const configPath = join(projectRoot, FABRIC_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) return DEFAULT_LANGUAGE;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const v = parsed && parsed[FABRIC_LANGUAGE_FIELD];
    if (typeof v === "string" && VALID_LANGUAGES.indexOf(v) !== -1) {
      // Fold zh-CN-hybrid → zh-CN for this hook's two-variant copy (the rc.25
      // spec defines zh-CN and en; hybrid uses zh-CN narrative with protected
      // tokens, which matches our copy already). match-existing → en per
      // UX i18n Policy class 1.
      if (v === "zh-CN" || v === "zh-CN-hybrid") return "zh-CN";
      if (v === "en") return "en";
      return DEFAULT_LANGUAGE; // match-existing
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Render the bilingual two-line reason for an archive-signal trigger.
 *
 * Inputs:
 *   - language: 'zh-CN' | 'en' (caller resolves via readFabricLanguage).
 *   - sessionCount: integer ≥ 1 when distinct-session count is reliable; the
 *     `useDistinctCount` flag controls whether to render the number or the
 *     "跨多个会话累计" / "across multiple sessions" degraded phrase.
 *   - planContextCount: total plan_context events since the watermark.
 *   - hoursDisplay: pre-formatted hours-elapsed string (e.g. "24.2h" or
 *     "尚未归档" — caller chooses).
 *   - useDistinctCount: when true, embed `sessionCount`; when false, use the
 *     degraded "多个" / "multiple" phrase.
 *   - watermarkSuffix: optional suffix string ("(watermark 已被 rotation 清理)"
 *     in zh-CN, "(watermark cleaned by rotation)" in en) appended when the
 *     historical watermark was rotated away.
 */
function buildReason({
  language,
  sessionCount,
  planContextCount,
  hoursDisplay,
  useDistinctCount,
  watermarkSuffix,
}) {
  const suffix = watermarkSuffix ? ` ${watermarkSuffix}` : "";
  if (language === "zh-CN") {
    const sessionPhrase = useDistinctCount
      ? `跨 ${sessionCount} 个会话累计`
      : "跨多个会话累计";
    return (
      `${sessionPhrase} ${planContextCount} 次 plan_context · 距上次归档 ${hoursDisplay}${suffix} — 这是项目级长期欠债, 不一定来自本会话。\n` +
      `若本会话有产出, 可调用 fabric-archive; 否则可忽略, 12h 后再提醒。`
    );
  }
  // English variant. Preserves the "project-level long-term debt" substring
  // so convergence checks can grep either side of the bilingual split.
  const sessionPhrase = useDistinctCount
    ? `Across ${sessionCount} sessions`
    : "Across multiple sessions";
  return (
    `${sessionPhrase}, ${planContextCount} plan_context calls accumulated · ${hoursDisplay} since last archive${suffix} — this is project-level long-term debt, not necessarily from the current session.\n` +
    `If the current session produced something, run fabric-archive; otherwise feel free to ignore — next reminder in 12h.`
  );
}

/**
 * Decide whether to emit a hook reminder.
 *
 * Trigger logic (UNCHANGED from rc.2):
 *   - Trigger when (plan_context count since last knowledge_proposed >= 5)
 *     OR (hours since last knowledge_proposed >= 24).
 *   - If no knowledge_proposed event has ever been recorded, count ALL
 *     plan_context events and use events[0]?.ts as the virtual watermark
 *     (rc.25 TASK-03 — fixes the Q3.8 gap where rotation-cut workspaces
 *     reported `null` hours-elapsed forever).
 *
 * Returns one of:
 *   - { decision: 'block', reason, signal: 'archive' } on archive trigger
 *   - null on no trigger
 */
function decide(events, now, language) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const lang = language === "zh-CN" || language === "en" ? language : DEFAULT_LANGUAGE;

  // Locate the most-recent knowledge_proposed watermark.
  let lastProposedTs = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev && ev.event_type === EVENT_TYPE_PROPOSED && typeof ev.ts === "number") {
      lastProposedTs = ev.ts;
      break;
    }
  }

  // Count plan_context events since the watermark (or all when null).
  let planContextCount = 0;
  for (const ev of events) {
    if (!ev || ev.event_type !== EVENT_TYPE_PLAN_CONTEXT) continue;
    if (typeof ev.ts !== "number") continue;
    if (lastProposedTs === null || ev.ts > lastProposedTs) {
      planContextCount += 1;
    }
  }

  // rc.25 TASK-03: watermark fallback. When the workspace has never
  // recorded knowledge_proposed (or rotation cut it off), use events[0]?.ts
  // as the virtual watermark so hoursElapsed is meaningful instead of null.
  // We track whether the fallback fired so the reason copy can append a
  // breadcrumb explaining the approximation.
  let watermarkFallbackFired = false;
  let effectiveWatermarkTs = lastProposedTs;
  if (lastProposedTs === null) {
    const firstEventTs =
      events.length > 0 && typeof events[0]?.ts === "number" ? events[0].ts : null;
    if (firstEventTs !== null) {
      effectiveWatermarkTs = firstEventTs;
      watermarkFallbackFired = true;
    }
  }

  const hoursElapsed =
    effectiveWatermarkTs === null
      ? null
      : (nowMs - effectiveWatermarkTs) / MS_PER_HOUR;

  const triggerByCount = planContextCount >= THRESHOLD_PLAN_CONTEXTS;
  // Hours threshold only applies when a watermark exists AND at least one
  // plan_context has happened since (otherwise the user has been idle — no
  // knowledge to archive).
  const triggerByHours =
    hoursElapsed !== null && hoursElapsed >= THRESHOLD_HOURS && planContextCount > 0;

  if (!triggerByCount && !triggerByHours) return null;

  // rc.25 TASK-03: distinct-session count + coverage degrade.
  const sessionStats = countDistinctSessions(events, lastProposedTs);
  const useDistinctCount =
    sessionStats.total > 0 &&
    sessionStats.coverage_ratio >= SESSION_COVERAGE_THRESHOLD &&
    sessionStats.count > 0;

  const hoursDisplay =
    hoursElapsed === null
      ? lang === "zh-CN"
        ? "尚未归档"
        : "never archived"
      : `${hoursElapsed.toFixed(1)}h`;

  const watermarkSuffix = watermarkFallbackFired
    ? lang === "zh-CN"
      ? "(watermark 已被 rotation 清理)"
      : "(watermark cleaned by rotation)"
    : "";

  const reason = buildReason({
    language: lang,
    sessionCount: sessionStats.count,
    planContextCount,
    hoursDisplay,
    useDistinctCount,
    watermarkSuffix,
  });

  return { decision: "block", reason, signal: "archive" };
}

/**
 * Resolve the cooldown setting from .fabric/fabric-config.json
 * (archive_hint_cooldown_hours), falling back to DEFAULT_COOLDOWN_HOURS.
 * Any read/parse failure → default (never block on config errors).
 */
function readCooldownHours(projectRoot) {
  const configPath = join(projectRoot, FABRIC_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) return DEFAULT_COOLDOWN_HOURS;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const v = parsed && parsed.archive_hint_cooldown_hours;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  } catch {
    // fall through to default
  }
  return DEFAULT_COOLDOWN_HOURS;
}

function readShownCache(projectRoot) {
  const cachePath = join(projectRoot, SHOWN_CACHE_FILE);
  if (!existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeShownCache(projectRoot, cache) {
  const cachePath = join(projectRoot, SHOWN_CACHE_FILE);
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache));
  } catch {
    // Silent — cache failure must never block the hook.
  }
}

/**
 * Main entry — invoked both as a CLI (require.main === module) and in-process by tests.
 *
 * Wraps the entire flow in try/catch: ANY error → silent exit 0. The hook MUST NEVER
 * block tool execution on its own failure (per existing fabric-*-reminder.cjs precedent).
 */
function main(env, stdio) {
  try {
    const cwd = (env && env.cwd) || process.cwd();
    const now = (env && env.now) || new Date();
    const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
    const out = (stdio && stdio.stdout) || process.stdout;

    const events = readLedger(cwd);
    const language = readFabricLanguage(cwd);
    const result = decide(events, now, language);
    if (result === null) return;

    // Cooldown throttle: once a signal fires, stay silent for
    // archive_hint_cooldown_hours (default 12h) regardless of state drift.
    const cooldownMs = readCooldownHours(cwd) * MS_PER_HOUR;
    const cache = readShownCache(cwd);
    const lastShown = cache[result.signal];
    if (typeof lastShown === "number" && nowMs - lastShown < cooldownMs) {
      return; // Still in cooldown — silent.
    }

    out.write(JSON.stringify(result));
    cache[result.signal] = nowMs;
    writeShownCache(cwd, cache);
  } catch {
    // Silent — never block on hook failure.
  }
}

module.exports = {
  main,
  readLedger,
  countDistinctSessions,
  readFabricLanguage,
  buildReason,
  decide,
  readCooldownHours,
  readShownCache,
  writeShownCache,
  CONSTANTS: {
    FABRIC_DIR,
    EVENT_LEDGER_FILE,
    EVENT_TYPE_PROPOSED,
    EVENT_TYPE_PLAN_CONTEXT,
    THRESHOLD_PLAN_CONTEXTS,
    THRESHOLD_HOURS,
    CONFIG_FILE,
    DEFAULT_COOLDOWN_HOURS,
    SHOWN_CACHE_FILE,
    SESSION_COVERAGE_THRESHOLD,
    DEFAULT_LANGUAGE,
  },
};

if (require.main === module) {
  main({ cwd: process.cwd(), now: new Date() }, { stdout: process.stdout });
  process.exit(0);
}
