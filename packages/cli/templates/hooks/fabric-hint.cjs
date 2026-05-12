#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require("node:fs");
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

// rc.3 TASK-004: second signal — pending-overflow → review skill recommendation.
const PENDING_DIR = "knowledge/pending";
const PENDING_TYPES = ["decisions", "pitfalls", "guidelines", "models", "processes"];
const THRESHOLD_PENDING_COUNT = 10;
const THRESHOLD_PENDING_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Cooldown throttle. After the hook surfaces a reminder, it stays silent for
// this many hours — purely a reminder-noise throttle, not a state machine.
// Override via .fabric/fabric-config.json#archive_hint_cooldown_hours.
const CONFIG_FILE = "fabric-config.json";
const DEFAULT_COOLDOWN_HOURS = 12;
const SHOWN_CACHE_FILE = ".fabric/.cache/archive-hint-shown.json";

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
 * Walk <projectRoot>/.fabric/knowledge/pending/<type>/*.md across all
 * PENDING_TYPES subdirs, collecting count and oldest mtime.
 *
 * Returns { count, oldestAgeMs } where:
 *   - count: total .md file count across all type subdirs
 *   - oldestAgeMs: (nowMs - oldestMtimeMs) when count>0, else null
 *
 * ENOENT / unreadable subdir / unstat-able file → silently skipped
 * (preserves the hook's never-block-on-failure invariant).
 */
function readPendingStats(projectRoot, now) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const baseDir = join(projectRoot, FABRIC_DIR, PENDING_DIR);

  let count = 0;
  let oldestMtime = null;

  if (!existsSync(baseDir)) {
    return { count: 0, oldestAgeMs: null };
  }

  for (const type of PENDING_TYPES) {
    const typeDir = join(baseDir, type);
    if (!existsSync(typeDir)) continue;

    let entries;
    try {
      entries = readdirSync(typeDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const filePath = join(typeDir, entry);
      let mtime;
      try {
        mtime = statSync(filePath).mtimeMs;
      } catch {
        continue;
      }
      count += 1;
      if (oldestMtime === null || mtime < oldestMtime) {
        oldestMtime = mtime;
      }
    }
  }

  return {
    count,
    oldestAgeMs: count > 0 && oldestMtime !== null ? nowMs - oldestMtime : null,
  };
}

/**
 * Decide whether to emit a hook reminder.
 *
 * rc.2 archive signal (per discussion.md L355-L362):
 *   - Trigger when (plan_context count since last knowledge_proposed >= 5)
 *     OR (hours since last knowledge_proposed >= 24).
 *   - If no knowledge_proposed event has ever been recorded, count ALL
 *     plan_context events and treat hours-elapsed as Infinity.
 *
 * rc.3 review signal (TASK-004):
 *   - Trigger when (pending count >= 10) OR (oldest pending mtime age >= 7 days).
 *
 * Precedence: archive > review. When BOTH fire, archive wins — returning to
 * recent in-session work is more urgent than long-tail review.
 *
 * Returns one of:
 *   - { decision: 'block', reason, signal: 'archive' } on archive trigger
 *   - { decision: 'block', reason, signal: 'review' } on review-only trigger
 *   - null on no trigger
 */
function decide(events, now, pendingStats) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const stats = pendingStats || { count: 0, oldestAgeMs: null };

  // ---- Archive signal (rc.2 logic, unchanged) -------------------------------
  let lastProposedTs = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev && ev.event_type === EVENT_TYPE_PROPOSED && typeof ev.ts === "number") {
      lastProposedTs = ev.ts;
      break;
    }
  }

  let planContextCount = 0;
  for (const ev of events) {
    if (!ev || ev.event_type !== EVENT_TYPE_PLAN_CONTEXT) continue;
    if (typeof ev.ts !== "number") continue;
    if (lastProposedTs === null || ev.ts > lastProposedTs) {
      planContextCount += 1;
    }
  }

  const hoursElapsed =
    lastProposedTs === null ? null : (nowMs - lastProposedTs) / MS_PER_HOUR;

  const triggerByCount = planContextCount >= THRESHOLD_PLAN_CONTEXTS;
  // Hours threshold only applies when a previous knowledge_proposed exists AND
  // at least one plan_context has happened since (otherwise the user has been
  // idle, no knowledge to archive).
  const triggerByHours =
    hoursElapsed !== null && hoursElapsed >= THRESHOLD_HOURS && planContextCount > 0;

  // PRECEDENCE: archive wins if either archive trigger fires, regardless of
  // review state. The user gets the archive reminder first; review reminder
  // waits until after archive happens.
  if (triggerByCount || triggerByHours) {
    const hoursDisplay = hoursElapsed === null ? "尚未归档" : `${hoursElapsed.toFixed(1)}h`;
    const reason =
      `已积累 ${planContextCount} 次 plan_context 调用且距上次 knowledge_proposed ${hoursDisplay}` +
      " — 建议调用 fabric-archive skill 抽取本次会话的知识。";
    return { decision: "block", reason, signal: "archive" };
  }

  // ---- Review signal (rc.3 TASK-004) ---------------------------------------
  const triggerByPendingCount = stats.count >= THRESHOLD_PENDING_COUNT;
  const triggerByPendingAge =
    stats.oldestAgeMs !== null && stats.oldestAgeMs / MS_PER_DAY >= THRESHOLD_PENDING_AGE_DAYS;

  if (triggerByPendingCount || triggerByPendingAge) {
    const ageSuffix =
      stats.oldestAgeMs !== null
        ? `，最早一条距今 ${(stats.oldestAgeMs / MS_PER_DAY).toFixed(1)} 天`
        : "";
    const reason =
      `已积累 ${stats.count} 条待审核知识${ageSuffix}` +
      " — 建议调用 fabric-review skill 审核 pending/ 条目。";
    return { decision: "block", reason, signal: "review" };
  }

  return null;
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
    let pendingStats;
    try {
      pendingStats = readPendingStats(cwd, now);
    } catch {
      // Defensive — readPendingStats already silences ENOENT/stat errors,
      // but a defense-in-depth try/catch keeps the never-block invariant.
      pendingStats = { count: 0, oldestAgeMs: null };
    }
    const result = decide(events, now, pendingStats);
    if (result === null) return;

    // Cooldown throttle: once a signal fires, stay silent for
    // archive_hint_cooldown_hours (default 12h) regardless of state drift.
    // Pure reminder-noise reduction; the underlying trigger logic is unchanged.
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
  readPendingStats,
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
    PENDING_DIR,
    PENDING_TYPES,
    THRESHOLD_PENDING_COUNT,
    THRESHOLD_PENDING_AGE_DAYS,
    CONFIG_FILE,
    DEFAULT_COOLDOWN_HOURS,
    SHOWN_CACHE_FILE,
  },
};

if (require.main === module) {
  main({ cwd: process.cwd(), now: new Date() }, { stdout: process.stdout });
  process.exit(0);
}
