#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

// CONSTANTS — duplicated from packages/server/src/services/_shared.ts.
// DRY violation accepted: this hook script runs in user repos WITHOUT
// node_modules access, so it cannot import from @fenglimg/fabric-server.
const FABRIC_DIR = ".fabric";
const EVENT_LEDGER_FILE = "events.jsonl";
const EVENT_TYPE_PROPOSED = "knowledge_proposed";
const EVENT_TYPE_INIT_SCAN_COMPLETED = "init_scan_completed";
// rc.6 TASK-022 (E5): Signal A is now `24h OR N-edits since last
// knowledge_proposed`. The edit-count branch reads
// `.fabric/.cache/edit-counter` (one ISO-8601 line per PreToolUse fire,
// populated by rc.6 TASK-020 / E4). Filters lines with ts > last
// knowledge_proposed event ts; fires when the count reaches
// archive_edit_threshold (default 20, configurable via fabric-config.json).
//
// rc.5 TASK-015 (C6) had reduced Signal A to pure 24h-only because the prior
// `5 plan_contexts since last archive` branch was unreliable (rc.5+ hooks
// auto-fire plan_context events, inflating the count). The edit-counter
// sidecar fixes that: PreToolUse fires correlate with real Edit/Write/MultiEdit
// activity, not tooling chatter.
//
// Safe-degrade contract: if `.fabric/.cache/edit-counter` is missing or every
// line malformed, the edit branch contributes 0 and Signal A reverts to
// 24h-only — matching the rc.5 contract. If no knowledge_proposed event has
// ever fired, Signal A stays silent regardless of edit count (an
// "anchor"-less workspace is Signal C's domain).
const THRESHOLD_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;
const EDIT_COUNTER_FILE_REL = join(".fabric", ".cache", "edit-counter");
const DEFAULT_ARCHIVE_EDIT_THRESHOLD = 20;

// rc.3 TASK-004: second signal — pending-overflow → review skill recommendation.
const PENDING_DIR = "knowledge/pending";
const PENDING_TYPES = ["decisions", "pitfalls", "guidelines", "models", "processes"];
const THRESHOLD_PENDING_COUNT = 10;
const THRESHOLD_PENDING_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// rc.5 TASK-010: third signal — underseeded knowledge corpus → fabric-import skill.
// Triggers when (a) canonical node count is below the underseed threshold AND
// (b) the workspace has had a successful init_scan_completed event at least 24h
// ago (so we don't nag during the immediate post-init window) AND (c) no
// knowledge_proposed event has fired in the last 24h (so we don't nag while
// the user is actively archiving).
const KNOWLEDGE_CANONICAL_TYPES = PENDING_TYPES; // same five canonical type dirs
const DEFAULT_UNDERSEED_NODE_THRESHOLD = 10;
const UNDERSEED_POST_INIT_QUIET_HOURS = 24;
const UNDERSEED_NO_PROPOSED_HOURS = 24;

// Cooldown throttle. After the hook surfaces a reminder, it stays silent for
// this many hours — purely a reminder-noise throttle, not a state machine.
// Override via .fabric/fabric-config.json#archive_hint_cooldown_hours.
const CONFIG_FILE = "fabric-config.json";
const DEFAULT_COOLDOWN_HOURS = 12;
// Cache file path retains the historical `archive-hint-shown.json` name so an
// in-place rename does not flush a user's existing cooldown state on first run
// post-upgrade. The schema is signal-keyed (archive/review/import) so the new
// import signal slot lives alongside the existing two.
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
 * Count canonical knowledge entries across the five canonical type subdirs
 * (decisions / pitfalls / guidelines / models / processes). Pending entries
 * are NOT counted — they are proposals, not seeded knowledge.
 *
 * Returns the integer count. ENOENT / unreadable subdir → silently treated as
 * zero (preserves never-block-on-failure invariant). Filters on `.md` suffix
 * only; the more-precise canonical filename pattern check is owned by
 * doctor.ts (the hook is a coarse signal, not a lint).
 */
function countCanonicalNodes(projectRoot) {
  const knowledgeRoot = join(projectRoot, FABRIC_DIR, "knowledge");
  if (!existsSync(knowledgeRoot)) {
    return 0;
  }
  let count = 0;
  for (const type of KNOWLEDGE_CANONICAL_TYPES) {
    const typeDir = join(knowledgeRoot, type);
    if (!existsSync(typeDir)) continue;
    let entries;
    try {
      entries = readdirSync(typeDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".md")) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Count edit-counter lines (timestamps) with ts strictly greater than the
 * given anchor ts. Each line in `.fabric/.cache/edit-counter` is one
 * ISO-8601 timestamp written by the rc.6 PreToolUse hook
 * (TASK-020 / E4) per Edit/Write/MultiEdit fire.
 *
 * Safe-degrade contract:
 *   - File missing → return 0 (Signal A reverts to 24h-only behaviour)
 *   - Line malformed (non-parseable as Date) → skip; other lines still count
 *   - Read failure (permission, race) → return 0
 *   - anchorTs is null → caller has no anchor event; we still parse but the
 *     caller will already short-circuit before invoking us. Returning the
 *     full count here is documented behaviour and used by the never-anchor
 *     edge case test.
 *
 * NEVER throws — the hook's overarching never-block invariant requires every
 * helper to return a sane value on any I/O or parse error.
 */
function countEditsSince(projectRoot, anchorTs) {
  const filePath = join(projectRoot, EDIT_COUNTER_FILE_REL);
  if (!existsSync(filePath)) return 0;
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return 0;
  }
  const lines = raw.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const ms = Date.parse(trimmed);
    if (!Number.isFinite(ms)) continue; // malformed → skip
    if (anchorTs === null || ms > anchorTs) {
      count += 1;
    }
  }
  return count;
}

/**
 * Resolve the archive_edit_threshold from .fabric/fabric-config.json,
 * falling back to DEFAULT_ARCHIVE_EDIT_THRESHOLD (20). Any read/parse failure
 * or non-positive value → default. Mirrors readUnderseedThreshold's contract.
 */
function readArchiveEditThreshold(projectRoot) {
  const configPath = join(projectRoot, FABRIC_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) return DEFAULT_ARCHIVE_EDIT_THRESHOLD;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const v = parsed && parsed.archive_edit_threshold;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  } catch {
    // fall through to default
  }
  return DEFAULT_ARCHIVE_EDIT_THRESHOLD;
}

/**
 * Decide whether to emit a hook reminder.
 *
 * rc.6 archive signal (TASK-022 / E5 — Signal A, 24h-OR-N-edits):
 *   - Trigger when EITHER (a) hours since last knowledge_proposed >= 24,
 *     OR (b) edit-counter lines with ts > last-knowledge_proposed >= threshold
 *     (default 20).
 *   - If no knowledge_proposed event has ever been recorded, Signal A stays
 *     silent regardless of edit count (a never-archived workspace is handled
 *     by Signal C / import; Signal A needs an anchor event to count from).
 *   - The edit-count branch was dropped in rc.5 (TASK-015) because the prior
 *     `5 plan_contexts` proxy was inflated by hook auto-fires. rc.6 (TASK-022)
 *     reintroduces it on a reliable substrate: the PreToolUse sidecar
 *     written by TASK-020 / E4. Missing/malformed edit-counter degrades
 *     safely to the 24h-only path.
 *
 * rc.3 review signal (TASK-004 — Signal B):
 *   - Trigger when (pending count >= 10) OR (oldest pending mtime age >= 7 days).
 *
 * rc.5 import signal (TASK-010 — Signal C):
 *   - Trigger when canonical node count < underseed threshold AND an
 *     init_scan_completed event has fired at least 24h ago AND no
 *     knowledge_proposed event has fired in the last 24h.
 *
 * Precedence: archive > review > import. Archive wins when both archive AND
 * any other signal fire — recent in-session work is the most urgent reminder.
 * Review wins over import because pending overflow is a sharper backlog signal
 * than a sparse corpus.
 *
 * The `editCounterStats` parameter is the parsed edit-counter view used by
 * the new Signal A edit branch:
 *   { editsSinceLastProposed: number, threshold: number }
 * Defaults to { editsSinceLastProposed: 0, threshold: DEFAULT_ARCHIVE_EDIT_THRESHOLD }
 * when omitted — preserves existing tests that don't populate it.
 *
 * Returns one of:
 *   - { decision: 'block', reason, signal: 'archive', recommended_skill: 'fabric-archive' }
 *   - { decision: 'block', reason, signal: 'review', recommended_skill: 'fabric-review' }
 *   - { decision: 'block', reason, signal: 'import', recommended_skill: 'fabric-import' }
 *   - null on no trigger
 */
function decide(events, now, pendingStats, underseedStats, editCounterStats) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const stats = pendingStats || { count: 0, oldestAgeMs: null };
  const underseed =
    underseedStats || { nodeCount: 0, threshold: DEFAULT_UNDERSEED_NODE_THRESHOLD };
  const editStats =
    editCounterStats || {
      editsSinceLastProposed: 0,
      threshold: DEFAULT_ARCHIVE_EDIT_THRESHOLD,
    };

  // ---- Archive signal (rc.6 TASK-022 — Signal A, 24h-OR-N-edits) -----------
  // Locate the most-recent knowledge_proposed event. If none exists, Signal A
  // stays silent — a never-archived workspace is the import signal's domain.
  // Edit count without an anchor is meaningless and intentionally ignored.
  let lastProposedTs = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev && ev.event_type === EVENT_TYPE_PROPOSED && typeof ev.ts === "number") {
      lastProposedTs = ev.ts;
      break;
    }
  }

  const hoursElapsed =
    lastProposedTs === null ? null : (nowMs - lastProposedTs) / MS_PER_HOUR;

  const triggerByHours =
    hoursElapsed !== null && hoursElapsed >= THRESHOLD_HOURS;
  const triggerByEdits =
    lastProposedTs !== null &&
    editStats.editsSinceLastProposed >= editStats.threshold;

  // PRECEDENCE: archive wins when Signal A fires, regardless of review/import
  // state. The user gets the archive reminder first; other reminders wait
  // until after archive happens.
  if (triggerByHours || triggerByEdits) {
    // Build a reason string that names which branch fired. When both fire,
    // mention both so the user understands the urgency.
    const parts = [];
    if (triggerByHours) {
      parts.push(`距上次 knowledge_proposed ${hoursElapsed.toFixed(1)}h（阈值 ${THRESHOLD_HOURS}h）`);
    }
    if (triggerByEdits) {
      parts.push(`自上次归档已发生 ${editStats.editsSinceLastProposed} 次编辑（阈值 ${editStats.threshold}）`);
    }
    const reason =
      `${parts.join("；")} — 建议调用 fabric-archive skill 抽取近期会话的知识。`;
    return {
      decision: "block",
      reason,
      signal: "archive",
      recommended_skill: "fabric-archive",
    };
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
    return {
      decision: "block",
      reason,
      signal: "review",
      recommended_skill: "fabric-review",
    };
  }

  // ---- Import signal (rc.5 TASK-010) — underseeded corpus -------------------
  // All three conditions must hold (logical AND):
  //  1. node count < threshold (sparse corpus)
  //  2. init_scan_completed event >= 24h ago (workspace has been initialized
  //     for at least a day — we don't nag during the immediate post-init
  //     window when the user is still authoring baseline knowledge)
  //  3. no knowledge_proposed event in last 24h (user isn't actively
  //     archiving — if they were, the archive signal would have fired anyway,
  //     but we keep this guard explicit per spec)
  let lastInitScanTs = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (
      ev &&
      ev.event_type === EVENT_TYPE_INIT_SCAN_COMPLETED &&
      typeof ev.ts === "number"
    ) {
      lastInitScanTs = ev.ts;
      break;
    }
  }
  const hoursSinceInit =
    lastInitScanTs === null ? null : (nowMs - lastInitScanTs) / MS_PER_HOUR;
  const hoursSinceProposed = hoursElapsed; // reuse archive-signal calc above
  const triggerUnderseed =
    underseed.nodeCount < underseed.threshold &&
    hoursSinceInit !== null &&
    hoursSinceInit >= UNDERSEED_POST_INIT_QUIET_HOURS &&
    (hoursSinceProposed === null || hoursSinceProposed >= UNDERSEED_NO_PROPOSED_HOURS);

  if (triggerUnderseed) {
    const reason =
      `知识库节点数 ${underseed.nodeCount}/${underseed.threshold}，距 init_scan_completed ${hoursSinceInit.toFixed(1)}h` +
      " — 建议调用 fabric-import skill 从 git 历史与现有文档回灌知识。";
    return {
      decision: "block",
      reason,
      signal: "import",
      recommended_skill: "fabric-import",
    };
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

/**
 * Resolve the underseed-node threshold from .fabric/fabric-config.json
 * (underseed_node_threshold), falling back to DEFAULT_UNDERSEED_NODE_THRESHOLD.
 * Any read/parse failure → default (never block on config errors).
 */
function readUnderseedThreshold(projectRoot) {
  const configPath = join(projectRoot, FABRIC_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) return DEFAULT_UNDERSEED_NODE_THRESHOLD;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const v = parsed && parsed.underseed_node_threshold;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  } catch {
    // fall through to default
  }
  return DEFAULT_UNDERSEED_NODE_THRESHOLD;
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
    let underseedStats;
    try {
      underseedStats = {
        nodeCount: countCanonicalNodes(cwd),
        threshold: readUnderseedThreshold(cwd),
      };
    } catch {
      underseedStats = { nodeCount: 0, threshold: DEFAULT_UNDERSEED_NODE_THRESHOLD };
    }

    // Edit-counter view (rc.6 TASK-022 / E5). We need the last knowledge_proposed
    // ts to anchor the count; rather than rescanning events here, we mirror
    // decide()'s scan locally to keep the helper pure. The threshold comes
    // from fabric-config.json (archive_edit_threshold, default 20).
    let editCounterStats;
    try {
      let anchorTs = null;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i];
        if (ev && ev.event_type === EVENT_TYPE_PROPOSED && typeof ev.ts === "number") {
          anchorTs = ev.ts;
          break;
        }
      }
      editCounterStats = {
        editsSinceLastProposed: countEditsSince(cwd, anchorTs),
        threshold: readArchiveEditThreshold(cwd),
      };
    } catch {
      editCounterStats = {
        editsSinceLastProposed: 0,
        threshold: DEFAULT_ARCHIVE_EDIT_THRESHOLD,
      };
    }

    const result = decide(events, now, pendingStats, underseedStats, editCounterStats);
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
  countCanonicalNodes,
  countEditsSince,
  decide,
  readCooldownHours,
  readUnderseedThreshold,
  readArchiveEditThreshold,
  readShownCache,
  writeShownCache,
  CONSTANTS: {
    FABRIC_DIR,
    EVENT_LEDGER_FILE,
    EVENT_TYPE_PROPOSED,
    EVENT_TYPE_INIT_SCAN_COMPLETED,
    THRESHOLD_HOURS,
    PENDING_DIR,
    PENDING_TYPES,
    THRESHOLD_PENDING_COUNT,
    THRESHOLD_PENDING_AGE_DAYS,
    KNOWLEDGE_CANONICAL_TYPES,
    DEFAULT_UNDERSEED_NODE_THRESHOLD,
    UNDERSEED_POST_INIT_QUIET_HOURS,
    UNDERSEED_NO_PROPOSED_HOURS,
    CONFIG_FILE,
    DEFAULT_COOLDOWN_HOURS,
    SHOWN_CACHE_FILE,
    EDIT_COUNTER_FILE_REL,
    DEFAULT_ARCHIVE_EDIT_THRESHOLD,
  },
};

if (require.main === module) {
  main({ cwd: process.cwd(), now: new Date() }, { stdout: process.stdout });
  process.exit(0);
}
