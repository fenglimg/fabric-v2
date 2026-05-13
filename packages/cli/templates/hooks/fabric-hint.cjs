#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

// v2.0.0-rc.7 T5: session-digest writer. Best-effort (never blocks Stop hook
// on failure — see contract in lib/session-digest-writer.cjs).
let sessionDigestWriter = null;
try {
  sessionDigestWriter = require("./lib/session-digest-writer.cjs");
} catch {
  // Helper module missing — degrade silently. Digest writing is opt-in
  // observability; the rest of fabric-hint must still function.
  sessionDigestWriter = null;
}

// CONSTANTS — duplicated from packages/server/src/services/_shared.ts.
// DRY violation accepted: this hook script runs in user repos WITHOUT
// node_modules access, so it cannot import from @fenglimg/fabric-server.
const FABRIC_DIR = ".fabric";
const EVENT_LEDGER_FILE = "events.jsonl";
const EVENT_TYPE_PROPOSED = "knowledge_proposed";
const EVENT_TYPE_INIT_SCAN_COMPLETED = "init_scan_completed";
// v2.0.0-rc.7 T10: doctor_run event drives Signal D (maintenance hint).
const EVENT_TYPE_DOCTOR_RUN = "doctor_run";
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
// rc.7 T7: archive_hint_hours, review_hint_pending_count, and
// review_hint_pending_age_days are now read from .fabric/fabric-config.json.
// The DEFAULT_ constants below carry the documented fallback when the config
// file is missing, malformed, or the field is absent. Call sites use the
// readArchiveHintHours / readReviewHintPendingCount /
// readReviewHintPendingAgeDays helpers — see docs/configuration.md.
const DEFAULT_ARCHIVE_HINT_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;
const EDIT_COUNTER_FILE_REL = join(".fabric", ".cache", "edit-counter");
const DEFAULT_ARCHIVE_EDIT_THRESHOLD = 20;

// rc.3 TASK-004: second signal — pending-overflow → review skill recommendation.
const PENDING_DIR = "knowledge/pending";
const PENDING_TYPES = ["decisions", "pitfalls", "guidelines", "models", "processes"];
const DEFAULT_REVIEW_HINT_PENDING_COUNT = 10;
const DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// rc.7 T7 / T10 pre-wiring: Signal D (maintenance hint) thresholds. T10 will
// consume these to decide when a "run fabric doctor" reminder fires; T7 only
// surfaces them on the config-loader surface so T10 doesn't have to bump the
// config schema in a second commit. Defaults: 14d since last doctor invoke
// triggers; 7d cooldown between repeats.
const DEFAULT_MAINTENANCE_HINT_DAYS = 14;
const DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS = 7;

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

// v2.0.0-rc.7 T10: dedicated Signal-D cooldown sidecar. The shared
// SHOWN_CACHE_FILE above is signal-keyed (archive/review/import) and uses
// hours-based cooldown; the maintenance signal uses a day-based threshold
// (default 7d) so we keep it in its own sidecar to avoid mixing semantics.
const MAINTENANCE_HINT_LAST_EMIT_FILE = ".fabric/.cache/maintenance-hint-last-emit";
// Signal-D gate: only nag when canonical corpus has at least this many
// entries. A fresh-init workspace shouldn't be reminded to run lint when
// there's barely anything TO lint.
const MAINTENANCE_HINT_MIN_CANONICAL = 5;

// rc.7 T1: cross-surface sentinel from `fabric init` Y-confirm. Empty file
// at `.fabric/.import-requested`. Stop hook reads it to bypass the Signal C
// cooldown and emit the import recommendation regardless of underseed or
// 24h-since-last-emit gates. SessionStart hook (knowledge-hint-broad.cjs)
// has its own mirror of this pickup logic. The fabric-import Skill's
// Phase 3.4 clears the sentinel; until then it remains and continues to
// surface the recommendation.
const IMPORT_REQUESTED_SENTINEL_FILE = join(".fabric", ".import-requested");

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
    // rc.7 T4: support both line shapes —
    //   legacy (rc.6): bare ISO-8601 timestamp per line
    //   new (rc.7):    {"ts":"<iso>","paths":[...]} JSON per line
    let ms = Number.NaN;
    if (trimmed.charCodeAt(0) === 123 /* '{' */) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === "object" && typeof obj.ts === "string") {
          ms = Date.parse(obj.ts);
        }
      } catch {
        // fall through — malformed JSON, skip line
      }
    } else {
      ms = Date.parse(trimmed);
    }
    if (!Number.isFinite(ms)) continue; // malformed → skip
    if (anchorTs === null || ms > anchorTs) {
      count += 1;
    }
  }
  return count;
}

/**
 * rc.7 T1: detect the `.fabric/.import-requested` sentinel. Best-effort
 * presence check — returns false on any I/O error so a hostile filesystem
 * never blocks the Stop hook on this branch.
 */
function isImportRequestedSentinelPresent(projectRoot) {
  try {
    return existsSync(join(projectRoot, IMPORT_REQUESTED_SENTINEL_FILE));
  } catch {
    return false;
  }
}

/**
 * rc.7 T1: build the import-recommendation result that the Stop hook emits
 * when the sentinel is present. Reuses the existing Signal C shape so
 * downstream consumers (Cursor `followup_message`, etc.) need no schema
 * change. The reason text reuses the rc.7 T4 人-first banner style.
 */
function makeImportSentinelResult() {
  const line1 =
    "📋 Fabric: 检测到 fabric init 提示要回灌知识 — 是否调 /fabric-import 从 git 历史和现有文档抽取?";
  return {
    decision: "block",
    reason: line1,
    signal: "import",
    recommended_skill: "fabric-import",
  };
}

/**
 * rc.7 T4: read the edit-counter sidecar and return the top-N most-edited
 * directories (grouped by the leading 2 path segments) since `anchorTs`.
 *
 * Output shape: an ordered array (desc by count) of
 *   { dir: "packages/cli", count: 12 }
 * objects, truncated to `topN`. Empty array when no aggregable lines are
 * present (file missing, all lines bare-ISO legacy, all paths bare basenames,
 * unreadable file, etc.). The Signal A banner uses this to render a
 * 人-first "最近活动集中在: ..." overview honest to the hook's actual
 * awareness (PreToolUse paths only — no content/diff peek).
 *
 * Safe-degrade contract:
 *   - File missing / unreadable → return []
 *   - Line malformed / non-JSON → skip; other lines still aggregate
 *   - paths field missing or empty → skip (no signal to add)
 *   - Single-segment paths (e.g. "README.md") → grouped under the literal
 *     filename so the user still gets *some* signal; multi-segment paths
 *     are bucketed by their leading two segments (".fabric/.cache" /
 *     "packages/cli" etc.).
 *   - anchorTs === null → aggregate over the entire file (matches the
 *     fire-counter's "no anchor" branch behaviour).
 *
 * NEVER throws — best-effort.
 */
function getTopEditedDirectories(projectRoot, topN, anchorTs) {
  const n = typeof topN === "number" && Number.isFinite(topN) && topN > 0
    ? Math.floor(topN)
    : 3;
  const filePath = join(projectRoot, EDIT_COUNTER_FILE_REL);
  if (!existsSync(filePath)) return [];
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  const counts = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Only the JSON-line shape carries paths. Bare ISO lines (legacy rc.6
    // sidecar) cannot contribute to the activity overview.
    if (trimmed.charCodeAt(0) !== 123 /* '{' */) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    // anchor gating mirrors countEditsSince() — strictly newer than anchor.
    if (typeof obj.ts === "string") {
      const ms = Date.parse(obj.ts);
      if (anchorTs !== null && Number.isFinite(ms) && ms <= anchorTs) continue;
      if (anchorTs !== null && !Number.isFinite(ms)) continue;
    } else if (anchorTs !== null) {
      // No parseable ts and an anchor was requested → can't decide, skip.
      continue;
    }
    const paths = Array.isArray(obj.paths) ? obj.paths : [];
    // Within one hook fire we dedupe the same directory bucket so a
    // MultiEdit that touched 5 files under packages/cli/ contributes 1 to
    // the bucket, not 5. The fire-cadence semantic stays consistent.
    const fireBuckets = new Set();
    for (const p of paths) {
      if (typeof p !== "string" || p.length === 0) continue;
      // Normalise to forward-slash for cross-platform stability and strip
      // any leading "./". POSIX-style only — the hook ships under POSIX
      // path conventions even on Windows (the project doesn't currently
      // ship a CRLF/backslash test matrix for the sidecar).
      const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
      const segs = norm.split("/").filter((s) => s.length > 0);
      let bucket;
      if (segs.length >= 2) {
        // Leading 2 segments: "packages/cli", "docs/decisions", etc. We
        // trail with "/" so the banner reads "packages/cli/" — clearly a
        // directory rather than a file basename.
        bucket = `${segs[0]}/${segs[1]}/`;
      } else if (segs.length === 1) {
        // Single segment — treat the basename as its own bucket. Bare
        // root-level files (README.md, package.json) get some signal too.
        bucket = segs[0];
      } else {
        continue;
      }
      fireBuckets.add(bucket);
    }
    for (const b of fireBuckets) {
      counts.set(b, (counts.get(b) || 0) + 1);
    }
  }
  if (counts.size === 0) return [];
  const sorted = Array.from(counts.entries()).map(([dir, count]) => ({ dir, count }));
  // Sort desc by count; tie-break alphabetically so output is deterministic.
  sorted.sort((a, b) => (b.count - a.count) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return sorted.slice(0, n);
}

/**
 * rc.7 T4: format the "最近活动集中在: <dir1> (N edits), <dir2> (M edits)"
 * fragment used by the Signal A banner. Returns empty string when there is
 * no aggregable activity (so the banner caller can skip the line entirely).
 */
function formatActivityOverview(projectRoot, anchorTs) {
  const top = getTopEditedDirectories(projectRoot, 3, anchorTs);
  if (top.length === 0) return "";
  return top.map((e) => `${e.dir} (${e.count} edits)`).join(", ");
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
// rc.7 T7: thresholds is the externalized-config view passed in by main().
// The shape mirrors the DEFAULT_ constants 1:1 so tests can synthesize it
// without touching the filesystem. Omitting the arg falls back to documented
// defaults so existing in-process callers (tests that pre-date T7) still
// pass without modification — they implicitly exercise the default path.
function decide(events, now, pendingStats, underseedStats, editCounterStats, thresholds, banner) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const stats = pendingStats || { count: 0, oldestAgeMs: null };
  const underseed =
    underseedStats || { nodeCount: 0, threshold: DEFAULT_UNDERSEED_NODE_THRESHOLD };
  const editStats =
    editCounterStats || {
      editsSinceLastProposed: 0,
      threshold: DEFAULT_ARCHIVE_EDIT_THRESHOLD,
    };
  const cfg = thresholds || {};
  const archiveHintHours =
    typeof cfg.archiveHintHours === "number" && cfg.archiveHintHours > 0
      ? cfg.archiveHintHours
      : DEFAULT_ARCHIVE_HINT_HOURS;
  const reviewHintPendingCount =
    typeof cfg.reviewHintPendingCount === "number" && cfg.reviewHintPendingCount > 0
      ? cfg.reviewHintPendingCount
      : DEFAULT_REVIEW_HINT_PENDING_COUNT;
  const reviewHintPendingAgeDays =
    typeof cfg.reviewHintPendingAgeDays === "number" && cfg.reviewHintPendingAgeDays > 0
      ? cfg.reviewHintPendingAgeDays
      : DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS;

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
    hoursElapsed !== null && hoursElapsed >= archiveHintHours;
  const triggerByEdits =
    lastProposedTs !== null &&
    editStats.editsSinceLastProposed >= editStats.threshold;

  // PRECEDENCE: archive wins when Signal A fires, regardless of review/import
  // state. The user gets the archive reminder first; other reminders wait
  // until after archive happens.
  if (triggerByHours || triggerByEdits) {
    // rc.7 T4: 人-first banner — the first reader is the human user in the
    // AI client UI, Agent reads incidentally (Q-13). We DROP the prior
    // Agent-jussive imperative ("建议调用 fabric-archive skill ...") in
    // favour of a polite question framing and an honest activity overview
    // from the edit-counter sidecar (Q-6: the hook has zero content
    // awareness, only file-fire awareness — no fabricated "N candidates
    // detected" framing).
    //
    // The activity overview is injected by the caller (main() supplies it
    // via the `banner` arg) so decide() stays pure / filesystem-free for
    // tests. When omitted (legacy callers / tests pre-T4) the overview
    // line is skipped — the banner remains valid 3-or-2 lines depending
    // on data availability.
    //
    // Substring contract preserved for existing tests:
    //   - "<hoursElapsed.toFixed(1)>h" (e.g. "25.0h")
    //   - "<editCount> 次编辑"
    //   - "阈值 <N>"
    //   - "fabric-archive"
    const parts = [];
    if (triggerByHours) {
      parts.push(`已过 ${hoursElapsed.toFixed(1)}h（阈值 ${archiveHintHours}h）`);
    }
    if (triggerByEdits) {
      parts.push(
        `累计 ${editStats.editsSinceLastProposed} 次编辑（阈值 ${editStats.threshold}）`,
      );
    }
    const line1 = `📋 Fabric: 距上次归档 ${parts.join(" / ")}。`;
    const activity = banner && typeof banner.activityOverview === "string"
      ? banner.activityOverview
      : "";
    const line2 = activity.length > 0
      ? `   最近活动集中在: ${activity}。`
      : "";
    const line3 = "   是否调 /fabric-archive 检查值得归档的决策/踩坑/复用?";
    const reason = [line1, line2, line3].filter((l) => l.length > 0).join("\n");
    return {
      decision: "block",
      reason,
      signal: "archive",
      recommended_skill: "fabric-archive",
    };
  }

  // ---- Review signal (rc.3 TASK-004) ---------------------------------------
  const triggerByPendingCount = stats.count >= reviewHintPendingCount;
  const triggerByPendingAge =
    stats.oldestAgeMs !== null && stats.oldestAgeMs / MS_PER_DAY >= reviewHintPendingAgeDays;

  if (triggerByPendingCount || triggerByPendingAge) {
    // rc.7 T4: 人-first banner reformat for Signal B. Keeps the pending
    // count and age substrings (`${count} 条`, `${days} 天`) so existing
    // tests pass; drops the Agent-jussive "建议调用 ... skill ..." for a
    // polite question framing aimed at the human reader.
    const ageSuffix =
      stats.oldestAgeMs !== null
        ? ` / 最早一条 ${(stats.oldestAgeMs / MS_PER_DAY).toFixed(1)} 天前`
        : "";
    const line1 = `📋 Fabric: 已积累 ${stats.count} 条待审核知识${ageSuffix}。`;
    const line2 = "   是否调 /fabric-review 审核 pending/ 条目?";
    const reason = `${line1}\n${line2}`;
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
    // rc.7 T4: 人-first banner reformat for Signal C. Preserves the
    // `${nodeCount}/${threshold}` substring (e.g. "3/10") that existing
    // tests assert against; drops Agent-jussive phrasing.
    const line1 =
      `📋 Fabric: 知识库节点数 ${underseed.nodeCount}/${underseed.threshold}，距 init_scan_completed ${hoursSinceInit.toFixed(1)}h。`;
    const line2 = "   是否调 /fabric-import 从 git 历史与现有文档回灌知识?";
    const reason = `${line1}\n${line2}`;
    return {
      decision: "block",
      reason,
      signal: "import",
      recommended_skill: "fabric-import",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// rc.7 T7: config readers for the three externalized thresholds + two new
// maintenance_hint_* fields. All readers share the same contract as the
// pre-existing readers in this file: synchronous fs read, missing file or
// malformed JSON → return the documented default, never throw. Caching is
// not done at the reader layer because each main() invocation reads at
// most once per field and the file is <1KB.
// ---------------------------------------------------------------------------

function _readConfigNumber(projectRoot, fieldName, defaultValue) {
  const configPath = join(projectRoot, FABRIC_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) return defaultValue;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const v = parsed && parsed[fieldName];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  } catch {
    // fall through to default
  }
  return defaultValue;
}

function readArchiveHintHours(projectRoot) {
  return _readConfigNumber(projectRoot, "archive_hint_hours", DEFAULT_ARCHIVE_HINT_HOURS);
}

function readReviewHintPendingCount(projectRoot) {
  return _readConfigNumber(
    projectRoot,
    "review_hint_pending_count",
    DEFAULT_REVIEW_HINT_PENDING_COUNT,
  );
}

function readReviewHintPendingAgeDays(projectRoot) {
  return _readConfigNumber(
    projectRoot,
    "review_hint_pending_age_days",
    DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS,
  );
}

function readMaintenanceHintDays(projectRoot) {
  return _readConfigNumber(projectRoot, "maintenance_hint_days", DEFAULT_MAINTENANCE_HINT_DAYS);
}

function readMaintenanceHintCooldownDays(projectRoot) {
  return _readConfigNumber(
    projectRoot,
    "maintenance_hint_cooldown_days",
    DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS,
  );
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
 * v2.0.0-rc.7 T10: find the most recent doctor_run event ts in the ledger.
 * Returns the ts (epoch ms) of the newest doctor_run event, or null if none
 * has ever fired. Walks the events array tail-first for efficiency (early-out
 * on first match).
 */
function findLastDoctorRunTs(events) {
  if (!Array.isArray(events)) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev && ev.event_type === EVENT_TYPE_DOCTOR_RUN && typeof ev.ts === "number") {
      return ev.ts;
    }
  }
  return null;
}

/**
 * v2.0.0-rc.7 T10: read the Signal-D cooldown sidecar timestamp (epoch ms).
 * Missing file / parse failure → null (allow signal to fire).
 */
function readMaintenanceLastEmit(projectRoot) {
  const p = join(projectRoot, MAINTENANCE_HINT_LAST_EMIT_FILE);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8").trim();
    if (raw.length === 0) return null;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
  } catch {
    // ignore
  }
  return null;
}

function writeMaintenanceLastEmit(projectRoot, nowMs) {
  const p = join(projectRoot, MAINTENANCE_HINT_LAST_EMIT_FILE);
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, new Date(nowMs).toISOString());
  } catch {
    // Silent — sidecar failure must never block the hook.
  }
}

/**
 * v2.0.0-rc.7 T10: Signal D — maintenance hint.
 *
 * Trigger when ALL of the following hold:
 *   1. No doctor_run event has fired in the last `maintenance_hint_days`
 *      (default 14), OR no doctor_run event has ever fired.
 *   2. Canonical node count >= MAINTENANCE_HINT_MIN_CANONICAL (default 5).
 *      A fresh workspace with no knowledge has nothing to lint.
 *   3. Cooldown: not within `maintenance_hint_cooldown_days` (default 7) of
 *      the previous Signal-D emit. Tracked via dedicated sidecar
 *      `.fabric/.cache/maintenance-hint-last-emit`.
 *
 * Returns one of:
 *   - { decision: 'block', reason, signal: 'maintenance', recommended_skill: null }
 *   - null on no trigger
 *
 * `recommended_skill` is intentionally null — the maintenance prompt
 * recommends a CLI invocation (`fabric doctor --lint`), not a Skill, because
 * doctor is a CLI surface (Q-13 boundary). The hook payload still shapes the
 * `recommended_skill` key so consumers can branch on it.
 */
function evaluateMaintenanceSignal(events, now, canonicalCount, lastEmitMs, thresholds) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const cfg = thresholds || {};
  const days =
    typeof cfg.maintenanceHintDays === "number" && cfg.maintenanceHintDays > 0
      ? cfg.maintenanceHintDays
      : DEFAULT_MAINTENANCE_HINT_DAYS;
  const cooldownDays =
    typeof cfg.maintenanceHintCooldownDays === "number" && cfg.maintenanceHintCooldownDays > 0
      ? cfg.maintenanceHintCooldownDays
      : DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS;

  if (canonicalCount < MAINTENANCE_HINT_MIN_CANONICAL) {
    return null;
  }

  // Cooldown gate — short-circuit when we just nagged.
  if (
    typeof lastEmitMs === "number" &&
    Number.isFinite(lastEmitMs) &&
    nowMs - lastEmitMs < cooldownDays * MS_PER_DAY
  ) {
    return null;
  }

  const lastDoctorTs = findLastDoctorRunTs(events);
  // Build a reason line tailored to the "never" vs "stale" branch so the
  // user sees an honest diagnosis. The Chinese phrasing is contract-locked
  // (T10 spec) — keep it stable across rc.7 patches.
  let ageDays = null;
  if (lastDoctorTs !== null) {
    ageDays = (nowMs - lastDoctorTs) / MS_PER_DAY;
    if (ageDays < days) return null; // doctor ran recently, no nag.
  }

  // rc.7 T4: keep the existing T10 banner shape (already 人-first with the
  // 📋 prefix), but split the action-prompt onto its own line for visual
  // consistency with Signals A/B/C. Substrings ("从未运行 lint 检查",
  // "已 N 天未跑 lint", "fabric doctor --lint") preserved for the T10 tests.
  const line2 = "   是否调 `fabric doctor --lint` 看看知识库健康度?";
  const reason = lastDoctorTs === null
    ? `📋 Fabric: 从未运行 lint 检查。\n${line2}`
    : `📋 Fabric: 已 ${days} 天未跑 lint 检查（实际 ${ageDays.toFixed(1)}d）。\n${line2}`;

  return {
    decision: "block",
    reason,
    signal: "maintenance",
    // CLI recommendation rather than Skill — doctor is a CLI surface.
    recommended_skill: null,
  };
}

/**
 * v2.0.0-rc.7 T5: best-effort sync stdin reader for the Stop hook.
 *
 * Claude Code passes a JSON payload via stdin on Stop hook fire (session_id,
 * transcript_path, hook_event_name, etc.). We try to read it synchronously so
 * we can derive a session digest. On any failure (closed stdin, non-TTY where
 * fd 0 is not readable, parse error, foreign client) we degrade silently.
 *
 * Returns the parsed JSON object on success, or null on any error. NEVER
 * throws.
 */
function tryReadStdinJson() {
  try {
    // Skip the read entirely when stdin is a TTY (interactive invocation, no
    // payload). readFileSync on fd 0 would block forever in that case.
    if (process.stdin.isTTY === true) return null;
    const buf = readFileSync(0, "utf8");
    if (typeof buf !== "string" || buf.trim().length === 0) return null;
    const parsed = JSON.parse(buf);
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * v2.0.0-rc.7 T5: extract user_messages + edit_paths + 1-line title from the
 * transcript JSONL referenced by the hook's stdin payload. Best-effort, never
 * throws.
 *
 * Claude Code's transcript_path points at a JSONL where each line is a
 * message envelope. We sniff for `role: "user"` lines (text content) and
 * for tool-use entries naming Edit / Write / MultiEdit to harvest file_path.
 */
function summarizeTranscript(transcriptPath) {
  const out = { user_messages: [], edit_paths: [], title: "" };
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) return out;
  if (!existsSync(transcriptPath)) return out;
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return out;
  }
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let envelope;
    try {
      envelope = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (envelope === null || typeof envelope !== "object") continue;

    // User text message — Claude Code shape: { role: "user", content: [...] }
    // OR nested under `message.role`. Be generous.
    const role = envelope.role || (envelope.message && envelope.message.role);
    if (role === "user") {
      const content = envelope.content || (envelope.message && envelope.message.content);
      if (typeof content === "string") {
        out.user_messages.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && typeof block.text === "string") {
            out.user_messages.push(block.text);
          }
        }
      }
    }

    // Tool use — look for Edit / Write / MultiEdit and harvest file_path.
    const candidates = [];
    if (envelope.type === "tool_use") candidates.push(envelope);
    const msgContent = envelope.message && envelope.message.content;
    if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        if (block && block.type === "tool_use") candidates.push(block);
      }
    }
    for (const tu of candidates) {
      const name = tu.name;
      if (name === "Edit" || name === "Write" || name === "MultiEdit") {
        const input = tu.input || tu.parameters || {};
        const fp = input.file_path || input.filePath || input.path;
        if (typeof fp === "string" && fp.length > 0) {
          out.edit_paths.push(fp);
        }
        if (name === "MultiEdit" && Array.isArray(input.edits)) {
          for (const e of input.edits) {
            const f = e && (e.file_path || e.filePath || e.path);
            if (typeof f === "string" && f.length > 0) out.edit_paths.push(f);
          }
        }
      }
    }
  }
  // 1-line title = first non-empty user message (trimmed). Falls back to "".
  if (out.user_messages.length > 0) {
    const first = out.user_messages[0].replace(/\s+/g, " ").trim();
    out.title = first.slice(0, 80);
  }
  // Dedup edit_paths preserving order.
  const seen = new Set();
  out.edit_paths = out.edit_paths.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  return out;
}

/**
 * v2.0.0-rc.7 T5: writeSessionDigestBestEffort — non-blocking digest fan-out.
 * Called from main() before the existing decide() flow. Failure is silently
 * swallowed; the Stop hook contract remains "never block on hook failure".
 */
function writeSessionDigestBestEffort(projectRoot, stdinPayload) {
  if (sessionDigestWriter === null) return;
  if (stdinPayload === null) return;
  try {
    const sessionId = stdinPayload.session_id;
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    const transcript = summarizeTranscript(stdinPayload.transcript_path);
    sessionDigestWriter.writeDigest({
      projectRoot,
      session_id: sessionId,
      title: transcript.title,
      user_messages: transcript.user_messages,
      edit_paths: transcript.edit_paths,
    });
  } catch {
    // Best-effort. Stop hook continues.
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

    // v2.0.0-rc.7 T5: session-digest write (best-effort). Tests can inject
    // a pre-parsed stdin payload via env.stdin_payload so the digest path
    // is exercised without needing a real stdin pipe.
    const stdinPayload =
      (env && env.stdin_payload) !== undefined
        ? env.stdin_payload
        : tryReadStdinJson();
    writeSessionDigestBestEffort(cwd, stdinPayload);

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

    // rc.7 T7: read the externalized thresholds and pass them into decide.
    // Reader failures degrade silently to documented defaults — fabric-hint
    // must never block on config errors (see hook contract above).
    let thresholds;
    try {
      thresholds = {
        archiveHintHours: readArchiveHintHours(cwd),
        reviewHintPendingCount: readReviewHintPendingCount(cwd),
        reviewHintPendingAgeDays: readReviewHintPendingAgeDays(cwd),
        maintenanceHintDays: readMaintenanceHintDays(cwd),
        maintenanceHintCooldownDays: readMaintenanceHintCooldownDays(cwd),
      };
    } catch {
      thresholds = {
        archiveHintHours: DEFAULT_ARCHIVE_HINT_HOURS,
        reviewHintPendingCount: DEFAULT_REVIEW_HINT_PENDING_COUNT,
        reviewHintPendingAgeDays: DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS,
        maintenanceHintDays: DEFAULT_MAINTENANCE_HINT_DAYS,
        maintenanceHintCooldownDays: DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS,
      };
    }

    // rc.7 T4: build the 人-first banner activity overview from the
    // edit-counter sidecar. Anchored at the last knowledge_proposed event
    // so the overview matches Signal A's "since last archive" semantics.
    // Failure (missing sidecar, malformed lines, etc.) degrades silently
    // to an empty string — the banner just omits the activity line.
    let activityOverview = "";
    try {
      let anchorTs = null;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i];
        if (ev && ev.event_type === EVENT_TYPE_PROPOSED && typeof ev.ts === "number") {
          anchorTs = ev.ts;
          break;
        }
      }
      activityOverview = formatActivityOverview(cwd, anchorTs);
    } catch {
      activityOverview = "";
    }

    // rc.7 T1: sentinel-priority pickup. The `.fabric/.import-requested`
    // file is the cross-surface signal from `fabric init` Y-confirm. When
    // present, the Stop hook emits a Signal C "import" result regardless of
    // underseed thresholds, cooldown sidecar state, or precedence with
    // other signals. This branch sits BEFORE decide() so the import
    // recommendation always wins until the fabric-import Skill clears the
    // sentinel in its Phase 3.4. Cooldown sidecar IS bypassed (the
    // recommendation surface area is intentionally aggressive — the user
    // explicitly asked for it at init time).
    const sentinelPresent = isImportRequestedSentinelPresent(cwd);

    let result = sentinelPresent
      ? makeImportSentinelResult()
      : decide(
          events,
          now,
          pendingStats,
          underseedStats,
          editCounterStats,
          thresholds,
          { activityOverview },
        );

    // v2.0.0-rc.7 T10: Signal D — maintenance hint. Evaluated AFTER A/B/C
    // because the existing three signals carry higher urgency (in-flight
    // archive backlog > review backlog > sparse corpus > stale lint). The
    // maintenance prompt only surfaces when none of the in-flight signals
    // fire and the corpus has had time to accumulate enough lint surface
    // for the prompt to be actionable.
    if (result === null) {
      try {
        const lastEmit = readMaintenanceLastEmit(cwd);
        result = evaluateMaintenanceSignal(
          events,
          now,
          underseedStats.nodeCount,
          lastEmit,
          thresholds,
        );
      } catch {
        result = null;
      }
    }

    if (result === null) return;

    // v2.0.0-rc.7 T10: Signal D uses its own cooldown sidecar (day-based,
    // see MAINTENANCE_HINT_LAST_EMIT_FILE). The A/B/C shared cooldown cache
    // uses hours, so we branch here to avoid mixing semantics.
    if (result.signal === "maintenance") {
      out.write(JSON.stringify(result));
      writeMaintenanceLastEmit(cwd, nowMs);
      return;
    }

    // rc.7 T1: sentinel-driven results bypass the cooldown sidecar entirely.
    // The user explicitly asked at init time for the import recommendation
    // to surface; the cooldown is a noise-throttle for organic signals,
    // not for explicit user-driven hand-offs. We also do NOT bump the
    // cooldown cache when the sentinel fires — that would silence the
    // *next* organic Signal C unnecessarily.
    if (sentinelPresent) {
      out.write(JSON.stringify(result));
      return;
    }

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
  // rc.7 T4: top-edited-directories aggregator + banner overview formatter.
  getTopEditedDirectories,
  formatActivityOverview,
  // rc.7 T1: cross-surface sentinel pickup helpers (exported for testing).
  isImportRequestedSentinelPresent,
  makeImportSentinelResult,
  decide,
  readCooldownHours,
  readUnderseedThreshold,
  readArchiveEditThreshold,
  // v2.0.0-rc.7 T5: session digest helpers (exported for unit testing).
  tryReadStdinJson,
  summarizeTranscript,
  writeSessionDigestBestEffort,
  // v2.0.0-rc.7 T10: Signal D helpers (exported for unit testing).
  evaluateMaintenanceSignal,
  findLastDoctorRunTs,
  readMaintenanceLastEmit,
  writeMaintenanceLastEmit,
  // rc.7 T7: externalized-threshold readers (3 moved + 2 new for T10).
  readArchiveHintHours,
  readReviewHintPendingCount,
  readReviewHintPendingAgeDays,
  readMaintenanceHintDays,
  readMaintenanceHintCooldownDays,
  readShownCache,
  writeShownCache,
  CONSTANTS: {
    FABRIC_DIR,
    EVENT_LEDGER_FILE,
    EVENT_TYPE_PROPOSED,
    EVENT_TYPE_INIT_SCAN_COMPLETED,
    // rc.7 T7: legacy aliases kept for back-compat with the existing test
    // CONSTANTS surface. They point at the same documented defaults the
    // readers return when the config file is absent — never branch on these
    // in production code, always go through the readers so a config
    // override is honored.
    THRESHOLD_HOURS: DEFAULT_ARCHIVE_HINT_HOURS,
    THRESHOLD_PENDING_COUNT: DEFAULT_REVIEW_HINT_PENDING_COUNT,
    THRESHOLD_PENDING_AGE_DAYS: DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS,
    DEFAULT_ARCHIVE_HINT_HOURS,
    DEFAULT_REVIEW_HINT_PENDING_COUNT,
    DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS,
    DEFAULT_MAINTENANCE_HINT_DAYS,
    DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS,
    PENDING_DIR,
    PENDING_TYPES,
    KNOWLEDGE_CANONICAL_TYPES,
    DEFAULT_UNDERSEED_NODE_THRESHOLD,
    UNDERSEED_POST_INIT_QUIET_HOURS,
    UNDERSEED_NO_PROPOSED_HOURS,
    CONFIG_FILE,
    DEFAULT_COOLDOWN_HOURS,
    SHOWN_CACHE_FILE,
    EDIT_COUNTER_FILE_REL,
    DEFAULT_ARCHIVE_EDIT_THRESHOLD,
    EVENT_TYPE_DOCTOR_RUN,
    MAINTENANCE_HINT_LAST_EMIT_FILE,
    MAINTENANCE_HINT_MIN_CANONICAL,
    // rc.7 T1: cross-surface sentinel for `fabric init` → import-skill hand-off.
    IMPORT_REQUESTED_SENTINEL_FILE,
  },
};

if (require.main === module) {
  main({ cwd: process.cwd(), now: new Date() }, { stdout: process.stdout });
  process.exit(0);
}
