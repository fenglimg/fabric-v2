#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

// W1-01 (ISS-012): Stop / SessionStart hooks append to shared, non-session-scoped
// ledgers (events.jsonl, metrics.jsonl). Under multi-window concurrency a bare
// appendFileSync can interleave a partial write; route through the advisory-lock
// primitive (drop-on-contention, best-effort — matches injection-log).
const { appendLockedLine } = require("./lib/injection-log.cjs");

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

// v2.0.0-rc.16 TASK-002 (F2-apply): banner-i18n lib for the 5 Signal
// banners (A/B/C/D-never/D-aged). Resolved ONCE per main() invocation and
// threaded into decide() / evaluateMaintenanceSignal() via the existing
// thresholds object. Lib is required at module load; failure to load is
// fatal-here-but-silent: the require itself can't throw without the .cjs
// being missing entirely (a packaging bug we'd want to surface during
// install integration tests, not silently swallow).
const { renderBanner, readFabricLanguage } = require("./lib/banner-i18n.cjs");

// v2.0.0-rc.24 TASK-04: shared cite-line parser (CJS twin of
// packages/shared/src/cite-line-parser.ts, byte-shipped via installHookLibs).
// Provides `parseCiteLine(raw)` → { cite_ids, cite_tags, cite_commitments }.
// Hook runtime has no node_modules access; the twin is hand-synced and
// behavior-parity-tested against the TS source.
let citeLineParser = null;
try {
  citeLineParser = require("./lib/cite-line-parser.cjs");
} catch {
  // Helper module missing — degrade silently. parseKbLine falls back to a
  // legacy in-file regex when the lib is unavailable (e.g. mid-upgrade where
  // hook script lands before lib is copied). New cite_commitments output is
  // empty in degraded mode.
  citeLineParser = null;
}

// v2.0.0-rc.24 TASK-05: L1 enforcement layer — soft Stop hook reminder for
// [recalled] cites of decision/pitfall types that arrived without operator
// contract or skip:<reason>. Reads .fabric/agents.meta.json (via
// lib/cite-contract-reminder.cjs#readKnowledgeTypeMap) to type-route cite
// ids per B6 lock; emits one
//   ⚠ KB: <id> cited as [recalled] but missing contract; add → edit:<glob>
//     or → skip:<reason> next turn
// line to stderr per offending id. Non-blocking, never throws.
let citeContractReminder = null;
try {
  citeContractReminder = require("./lib/cite-contract-reminder.cjs");
} catch {
  // Helper module missing — soft reminder simply doesn't fire. Audit-side
  // doctor (TASK-08) still catches contract violations at the next run.
  citeContractReminder = null;
}

// v2.0.0-rc.37 NEW-30: shared client-protocol adapter. Guarded require (this
// hook runs in arbitrary user repos); detectClient delegates the 3-tier
// detection to the lib, falling back to env-only when the lib is absent.
let clientAdapter = null;
try {
  clientAdapter = require("./lib/client-adapter.cjs");
} catch {
  clientAdapter = null;
}

// v2.0.0-rc.37 NEW-16: shared config + sidecar I/O for the per-signal dismiss
// feature (config-level durable opt-out + session-scoped sidecar). Guarded
// require (house style); dismiss simply doesn't fire if the lib is absent.
let configCache = null;
let stateStore = null;
try {
  configCache = require("./lib/config-cache.cjs");
} catch {
  configCache = null;
}
try {
  stateStore = require("./lib/state-store.cjs");
} catch {
  stateStore = null;
}

// v2.1.0-rc.1 P4 (F4/S63): hook-side reader for the CLI pre-generated
// resolved-bindings snapshot. The Stop hint surfaces the read-set stores
// (per-store, NOT aggregated into one pile) without re-resolving / walking
// store trees. Best-effort — a missing lib/snapshot omits the store line.
let bindingsSnapshotReader = null;
try {
  bindingsSnapshotReader = require("./lib/bindings-snapshot-reader.cjs");
} catch {
  bindingsSnapshotReader = null;
}

// Read the workspace binding id (snapshot key) from project config. Standard
// repos default to project_id; worktrees can set workspace_binding_id to isolate
// hook/runtime state without changing project identity.
function readWorkspaceBindingId(cwd) {
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, ".fabric", "fabric-config.json"), "utf8"));
    if (typeof parsed.workspace_binding_id === "string") return parsed.workspace_binding_id;
    return typeof parsed.project_id === "string" ? parsed.project_id : null;
  } catch {
    return null;
  }
}

function readSnapshotKnowledgeStats(projectRoot, now) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const empty = { pendingCount: 0, oldestPendingAgeMs: null, canonicalCount: 0 };
  if (bindingsSnapshotReader === null) {
    return null;
  }
  const bindingId = readWorkspaceBindingId(projectRoot);
  if (bindingId === null) {
    return null;
  }
  try {
    const snapshot = bindingsSnapshotReader.readBindingsSnapshot(bindingId);
    const stats = snapshot && snapshot.knowledge_stats;
    if (!stats || typeof stats !== "object") {
      return empty;
    }
    const pendingCount =
      Number.isFinite(stats.pending_count) && stats.pending_count > 0
        ? Math.floor(stats.pending_count)
        : 0;
    const canonicalCount =
      Number.isFinite(stats.canonical_count) && stats.canonical_count > 0
        ? Math.floor(stats.canonical_count)
        : 0;
    const oldestPendingAgeMs =
      pendingCount > 0 &&
      Number.isFinite(stats.oldest_pending_mtime_ms) &&
      stats.oldest_pending_mtime_ms > 0
        ? Math.max(0, nowMs - stats.oldest_pending_mtime_ms)
        : null;
    return { pendingCount, oldestPendingAgeMs, canonicalCount };
  } catch {
    return empty;
  }
}

function readLegacyPendingStats(projectRoot, now) {
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

function countLegacyCanonicalNodes(projectRoot) {
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

// CONSTANTS — duplicated from packages/server/src/services/_shared.ts.
// DRY violation accepted: this hook script runs in user repos WITHOUT
// node_modules access, so it cannot import from @fenglimg/fabric-server.
const FABRIC_DIR = ".fabric";
const EVENT_LEDGER_FILE = "events.jsonl";
// v2.0.0-rc.39 (P1 emit-fold): high-frequency empty-shell assistant_turn_observed
// turns (kb_line_raw=null AND no cite_ids AND no cite_commitments) carry zero
// cite-audit signal, so emitting one events.jsonl line each is pure bloat. They
// are folded at the emit source into a single per-Stop metrics.jsonl counter row
// `{ counters: { assistant_turn_observed[:<client>]: N } }`. The cite-coverage /
// emit-cadence readers add this counter back into total_turns so the metric is
// byte-for-byte invariant (the fold preserves count semantics, incl. the legacy
// per-Stop re-emission, exactly). Mirrors packages/server/src/services/metrics.ts
// row shape; written directly (the .cjs hook cannot import the TS service).
const METRICS_LEDGER_FILE = "metrics.jsonl";
const EVENT_TYPE_PROPOSED = "knowledge_proposed";
const EVENT_TYPE_INIT_SCAN_COMPLETED = "init_scan_completed";
// v2.0.0-rc.7 T10: doctor_run event drives Signal D (maintenance hint).
const EVENT_TYPE_DOCTOR_RUN = "doctor_run";
// v2.0.0-rc.20 TASK-03: per-turn cite-policy observation event. Emitted by
// extractAndWriteAssistantTurnsBestEffort() after the Stop hook parses each
// assistant envelope's first non-empty line for a `KB:` prefix. Schema
// registered in packages/shared/src/schemas/event-ledger.ts (rc.20 TASK-02).
const EVENT_TYPE_ASSISTANT_TURN_OBSERVED = "assistant_turn_observed";
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

// v2.0.0-rc.8 (TASK-002): in-flight import gate for Signal B.
// fabric-import skill writes `.fabric/.import-state.json` checkpoints after
// every successful sub-step (P1/P2/P3 — see fabric-import/SKILL.md). The
// Stop hook reads this file as a soft signal to know that an import is
// mid-run, so we can silence Signal B (review hint at pending count >= 10)
// to avoid interrupting the import while it accumulates pending entries.
//
// Gate is intentionally narrow: ONLY Signal B is suppressed. Signals A
// (archive), C (import recommendation), D (maintenance) retain their
// pre-existing behaviour byte-for-byte. The 24h TTL on `last_checkpoint_at`
// guards against stale state files that would otherwise permanently
// silence Signal B if a user abandoned an import without completing.
const IMPORT_STATE_FILE_REL = join(".fabric", ".import-state.json");
const IMPORT_IN_FLIGHT_MAX_AGE_HOURS = 24;

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
 * Read pending counts from the CLI-generated resolved-bindings snapshot.
 *
 * Returns { count, oldestAgeMs } where:
 *   - count: total .md file count across all type subdirs
 *   - oldestAgeMs: (nowMs - oldestMtimeMs) when count>0, else null
 *
 * Store-only cutover: hooks must not walk project-local .fabric/knowledge or
 * store trees. Missing snapshot stats degrade to zero (KT-DEC-0007).
 */
function readPendingStats(projectRoot, now) {
  const stats = readSnapshotKnowledgeStats(projectRoot, now);
  if (stats !== null) {
    return { count: stats.pendingCount, oldestAgeMs: stats.oldestPendingAgeMs };
  }
  return readLegacyPendingStats(projectRoot, now);
}

/**
 * Count canonical knowledge entries from the CLI-generated resolved-bindings
 * snapshot. Hooks do not walk project-local .fabric/knowledge or store trees.
 */
function countCanonicalNodes(projectRoot) {
  const stats = readSnapshotKnowledgeStats(projectRoot);
  return stats === null ? countLegacyCanonicalNodes(projectRoot) : stats.canonicalCount;
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
 * v2.0.0-rc.8 (TASK-002): detect whether a fabric-import skill run is
 * currently in flight, used to gate Signal B (review hint) so the Stop
 * hook does not interrupt an active import when its pending pile crosses
 * the review threshold.
 *
 * Truth table — returns false (i.e. NOT in flight, do not gate) on:
 *   - `.fabric/.import-state.json` missing (no import has ever started or
 *     state file was deleted)
 *   - JSON.parse failure (malformed state file — never-block invariant
 *     forbids permanently silencing Signal B due to corruption)
 *   - `phase === "complete"` (import finished — see fabric-import SKILL.md
 *     Phase 3.4)
 *   - `last_checkpoint_at` missing OR older than IMPORT_IN_FLIGHT_MAX_AGE_HOURS
 *     (stale state — user likely abandoned the import; do not let a forever
 *     orphaned state file silence Signal B forever)
 *   - any unexpected throw (defensive — never-block invariant)
 *
 * Returns true ONLY when state file exists, parses, has a non-"complete"
 * phase, and a fresh `last_checkpoint_at` (< 24h ago). Field names
 * (`phase`, `last_checkpoint_at`) verified against fabric-import SKILL.md
 * § Checkpoint Logic.
 *
 * `now` is optional — defaults to `new Date()`. Tests can inject a fixed
 * Date for determinism; production callers may omit it.
 */
function isImportInFlight(projectRoot, now) {
  try {
    const p = join(projectRoot, IMPORT_STATE_FILE_REL);
    if (!existsSync(p)) return false;
    let raw;
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      return false;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    if (parsed === null || typeof parsed !== "object") return false;
    if (parsed.phase === "complete") return false;
    const ts = parsed.last_checkpoint_at;
    if (typeof ts !== "string" || ts.length === 0) return false;
    const ms = Date.parse(ts);
    if (!Number.isFinite(ms)) return false;
    const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
    const ageHours = (nowMs - ms) / MS_PER_HOUR;
    if (ageHours > IMPORT_IN_FLIGHT_MAX_AGE_HOURS) return false;
    return true;
  } catch {
    return false;
  }
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
      //
      // v2.0.0-rc.27 TASK-005 (audit §2.8 leak surface): absolute paths
      // already accumulated in legacy sidecars start with `/`. We strip
      // the leading slash and also reject buckets that resolve to user-home
      // segments (`Users/<name>/...`, `home/<name>/...`) so historical
      // pollution from absolute-path writes doesn't surface the user's
      // $HOME in the archive banner. The rc.27 appendEditCounter no longer
      // writes such paths, but the sidecar is append-only so old lines
      // persist until rotation.
      let norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
      // Strip leading `/` so a stale absolute entry doesn't generate a leak.
      while (norm.startsWith("/")) norm = norm.slice(1);
      const segs = norm.split("/").filter((s) => s.length > 0);
      // Reject any bucket whose top segments look like a host-system home
      // prefix. The pattern is `<top>/<user>/...` where top ∈ Users|home|root.
      // This silently drops legacy absolute-path entries from $HOME without
      // mangling the buckets for legitimate project-relative `Users/...`
      // (unlikely but possible) — the heuristic favours $HOME leak prevention
      // over false-positive bucketing of project paths named after Unix
      // conventions.
      if (segs.length >= 2 && (segs[0] === "Users" || segs[0] === "home" || segs[0] === "root")) {
        continue;
      }
      // v2.0.0-rc.27 TASK-005 (audit §2.8 file-as-dir): when segs[1] looks
      // like a file (contains a dot-extension at the end), surface segs[0]
      // alone instead of `segs[0]/segs[1]/` — a 2-seg path of the form
      // `assets/foo.ts` would otherwise render as "assets/foo.ts/" which
      // misleads the operator about whether they're seeing a file or a
      // directory. The extension regex is permissive: any `.X` where X is
      // 1-8 alphanumerics counts. README.md / package.json / foo.ts all
      // match; "v1.2" or "dotted.module" do too — acceptable false-positive
      // rate, since the worst outcome is over-aggregation to the parent.
      const looksLikeFile = (segment) => /\.[A-Za-z0-9]{1,8}$/u.test(segment);
      let bucket;
      if (segs.length >= 2) {
        if (looksLikeFile(segs[1])) {
          bucket = `${segs[0]}/`;
        } else {
          // Leading 2 segments: "packages/cli", "docs/decisions", etc. We
          // trail with "/" so the banner reads "packages/cli/" — clearly a
          // directory rather than a file basename.
          bucket = `${segs[0]}/${segs[1]}/`;
        }
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
function decide(events, now, pendingStats, underseedStats, editCounterStats, thresholds, banner, importInFlight) {
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
  // rc.16 TASK-002: banner variant for the i18n lib. Defaults to 'zh-CN' so
  // existing test callers (which never pass thresholds.variant) get the rc.15
  // byte-identical Chinese output. main() always supplies the resolved variant.
  const variant = typeof cfg.variant === "string" ? cfg.variant : "zh-CN";

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
    // v2.0.0-rc.27 TASK-005 (audit §2.17): parts now assembled per-variant
    // via banner-i18n's archivePartsHours / archivePartsEdits so en mode
    // gets fully-English fragments instead of mixed-language output. zh-CN
    // / zh-CN-hybrid still render the original substring contract verbatim.
    const parts = [];
    if (triggerByHours) {
      parts.push(
        renderBanner("archivePartsHours", variant, {
          hoursFixed: hoursElapsed.toFixed(1),
          threshold: archiveHintHours,
        }),
      );
    }
    if (triggerByEdits) {
      parts.push(
        renderBanner("archivePartsEdits", variant, {
          count: editStats.editsSinceLastProposed,
          threshold: editStats.threshold,
        }),
      );
    }
    // rc.16 TASK-002: 5-banner i18n via lib/banner-i18n.cjs. Substring
    // contracts ('25.0h', '阈值 N', 'fabric-archive') preserved by the lib's
    // zh-CN templates — see lib header for the full contract.
    const line1 = renderBanner("archiveLine1", variant, { parts: parts.join(" / ") });
    const activity = banner && typeof banner.activityOverview === "string"
      ? banner.activityOverview
      : "";
    const line2 = activity.length > 0
      ? renderBanner("archiveActivity", variant, { activity })
      : "";
    const line3 = renderBanner("archiveCta", variant, {});
    const reason = [line1, line2, line3].filter((l) => l.length > 0).join("\n");
    return {
      decision: "block",
      reason,
      signal: "archive",
      recommended_skill: "fabric-archive",
      // v2.1 NEW-N-3: surface the firing sub-signal's numbers for the
      // hook_signal_emitted ledger row main() writes. Dual trigger (24h OR
      // N-edits): report the hours pair when it fired, else the edit-count pair.
      threshold: triggerByHours ? archiveHintHours : editStats.threshold,
      actual_value: triggerByHours ? hoursElapsed : editStats.editsSinceLastProposed,
    };
  }

  // ---- Review signal (rc.3 TASK-004) ---------------------------------------
  const triggerByPendingCount = stats.count >= reviewHintPendingCount;
  const triggerByPendingAge =
    stats.oldestAgeMs !== null && stats.oldestAgeMs / MS_PER_DAY >= reviewHintPendingAgeDays;

  // v2.0.0-rc.8 (TASK-002): suppress ONLY Signal B while a fabric-import
  // skill run is in flight (read from .fabric/.import-state.json by main()
  // and threaded in as `importInFlight`). Signals A, C, D are unaffected.
  // We fall through to Signal C evaluation rather than returning null —
  // review backlog should not pre-empt import-recommendation evaluation
  // when import is mid-run.
  if ((triggerByPendingCount || triggerByPendingAge) && importInFlight !== true) {
    // rc.7 T4: 人-first banner reformat for Signal B. Keeps the pending
    // count and age substrings (`${count} 条`, `${days} 天`) so existing
    // tests pass; drops the Agent-jussive "建议调用 ... skill ..." for a
    // polite question framing aimed at the human reader.
    const ageSuffix =
      stats.oldestAgeMs !== null
        ? ` / 最早一条 ${(stats.oldestAgeMs / MS_PER_DAY).toFixed(1)} 天前`
        : "";
    // rc.16 TASK-002: i18n via lib. Substrings ('${count} 条', 'fabric-review')
    // preserved by the lib's zh-CN templates.
    const line1 = renderBanner("reviewLine1", variant, {
      count: stats.count,
      ageSuffix,
    });
    const line2 = renderBanner("reviewCta", variant, {});
    const reason = `${line1}\n${line2}`;
    return {
      decision: "block",
      reason,
      signal: "review",
      recommended_skill: "fabric-review",
      // v2.1 NEW-N-3: dual trigger (pending-count OR oldest-age). Report the
      // count pair when it fired, else the oldest-age-in-days pair.
      threshold: triggerByPendingCount ? reviewHintPendingCount : reviewHintPendingAgeDays,
      actual_value: triggerByPendingCount ? stats.count : stats.oldestAgeMs / MS_PER_DAY,
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
    // rc.16 TASK-002: i18n via lib. Substrings ('${nodeCount}/${threshold}',
    // 'fabric-import', '${hoursSinceInit}h') preserved by the lib's zh-CN
    // templates. Note: hoursSinceInit is passed as already-toFixed(1) string
    // to keep the lib pure (no number formatting in render path).
    const line1 = renderBanner("importLine1", variant, {
      nodeCount: underseed.nodeCount,
      threshold: underseed.threshold,
      hoursSinceInit: hoursSinceInit.toFixed(1),
    });
    const line2 = renderBanner("importCta", variant, {});
    const reason = `${line1}\n${line2}`;
    return {
      decision: "block",
      reason,
      signal: "import",
      recommended_skill: "fabric-import",
      // v2.1 NEW-N-3: underseed corpus trigger — node-count vs threshold. The
      // "import" signal collapses to schema signal_type "other" in main().
      threshold: underseed.threshold,
      actual_value: underseed.nodeCount,
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

// F13 (ISS-20260531-038): the reminder cooldown sidecars were process-global
// (one file per project, no session key), so in concurrent multi-window sessions
// one window firing a nudge wrote the cooldown and silenced that nudge in EVERY
// other window. Scope the sidecar filename by sessionId — mirrors the already-
// session-scoped dismiss sidecar (sessionDismissFileName). Backward-compatible:
// a null/absent sessionId falls back to the legacy non-scoped path (upgrade +
// pre-session-id callers), so existing on-disk state and tests are unaffected;
// the Stop hook always passes the real session_id from its stdin payload.
function resolveHookSessionId(payload) {
  return payload && typeof payload.session_id === "string" && payload.session_id.length > 0
    ? payload.session_id
    : null;
}

function sessionScopedCacheFile(baseRelPath, sessionId) {
  if (sessionId === undefined || sessionId === null || String(sessionId).length === 0) {
    return baseRelPath;
  }
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, "-");
  const lastSlash = baseRelPath.lastIndexOf("/");
  const dot = baseRelPath.lastIndexOf(".");
  return dot > lastSlash
    ? `${baseRelPath.slice(0, dot)}-${safe}${baseRelPath.slice(dot)}`
    : `${baseRelPath}-${safe}`;
}

function readShownCache(projectRoot, sessionId) {
  const cachePath = join(projectRoot, sessionScopedCacheFile(SHOWN_CACHE_FILE, sessionId));
  if (!existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeShownCache(projectRoot, cache, sessionId) {
  const cachePath = join(projectRoot, sessionScopedCacheFile(SHOWN_CACHE_FILE, sessionId));
  try {
    // ISS-016: atomic tmp+rename so a crash never leaves a truncated shown-cache.
    // Falls back to a plain write only if the shared lib failed to load.
    if (stateStore && typeof stateStore.atomicWrite === "function") {
      stateStore.atomicWrite(cachePath, JSON.stringify(cache));
    } else {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify(cache));
    }
  } catch {
    // Silent — cache failure must never block the hook.
  }
}

// -----------------------------------------------------------------------------
// v2.0.0-rc.37 NEW-16 — per-signal dismiss.
//
// Two suppression levers, both honoured at emit time (a chosen signal whose
// type is dismissed exits silently, exactly like a cooldown hit):
//   1. Durable opt-out — fabric-config.json#hint_dismiss_signals: string[].
//      Mirrors the cite_evict_interval=0 opt-out convention; survives across
//      sessions. The concrete user-actionable lever surfaced in the nudge.
//   2. Session-scoped — .fabric/.cache/hint-dismiss-{sessionId}.json
//      { dismissed: string[] }. Ephemeral; written by the agent when the user
//      asks to silence a nudge type for the current session (Fabric's
//      AI-driven write convention — no new CLI surface).
//
// The four signal types ('archive' / 'review' / 'import' / 'maintenance')
// each have an independent cooldown ALREADY (signal-keyed SHOWN_CACHE for
// A/B/C + the maintenance day-cooldown sidecar), so dismiss layers cleanly on
// top of per-signal cadence without a physical 4-hook split (which would 4×
// the per-Stop process spawn and break the deliberate single-nudge-per-turn
// precedence model — KT-DEC-0007 anti-nag spirit).
// -----------------------------------------------------------------------------

const DISMISSABLE_SIGNALS = ["archive", "review", "import", "maintenance"];

function sessionDismissFileName(sessionId) {
  const safe = String(sessionId || "anonymous").replace(/[^A-Za-z0-9_.-]/g, "-");
  return `hint-dismiss-${safe}.json`;
}

// Returns a Set of dismissed signal types (config-durable ∪ session sidecar).
// Never throws — degrades to an empty set when libs are absent.
function readDismissedSignals(projectRoot, sessionId) {
  const dismissed = new Set();
  try {
    if (configCache && typeof configCache.readConfig === "function") {
      const cfg = configCache.readConfig(projectRoot);
      const list = cfg && cfg.hint_dismiss_signals;
      if (Array.isArray(list)) {
        for (const s of list) {
          if (DISMISSABLE_SIGNALS.includes(s)) dismissed.add(s);
        }
      }
    }
  } catch {
    // defensive
  }
  try {
    if (stateStore && typeof stateStore.readJsonState === "function" && sessionId) {
      const sidecar = stateStore.readJsonState(
        projectRoot,
        sessionDismissFileName(sessionId),
        (p) => p && typeof p === "object" && Array.isArray(p.dismissed),
      );
      if (sidecar) {
        for (const s of sidecar.dismissed) {
          if (DISMISSABLE_SIGNALS.includes(s)) dismissed.add(s);
        }
      }
    }
  } catch {
    // defensive
  }
  return dismissed;
}

// Persist a session-scoped dismiss set (additive merge). Exposed for the
// agent-driven write path + tests; not auto-invoked by the hook. Never throws.
function writeSessionDismiss(projectRoot, sessionId, signals) {
  if (!stateStore || typeof stateStore.writeJsonState !== "function") return;
  const fileName = sessionDismissFileName(sessionId);
  const prior = stateStore.readJsonState(
    projectRoot,
    fileName,
    (p) => p && typeof p === "object" && Array.isArray(p.dismissed),
  );
  const merged = new Set(prior && Array.isArray(prior.dismissed) ? prior.dismissed : []);
  for (const s of Array.isArray(signals) ? signals : []) {
    if (DISMISSABLE_SIGNALS.includes(s)) merged.add(s);
  }
  stateStore.writeJsonState(projectRoot, fileName, { dismissed: [...merged] });
}

// Bilingual one-line dismiss hint appended to every nudge so the user knows
// the lever exists. Variant fold mirrors banner-i18n: zh-CN / zh-CN-hybrid →
// Chinese; en / match-existing / unknown → English.
function renderDismissOption(signal, variant) {
  const zh = variant === "zh-CN" || variant === "zh-CN-hybrid";
  return zh
    ? `  (不想再看到此类提醒？在 .fabric/fabric-config.json 设 "hint_dismiss_signals": ["${signal}"]，或让我本会话关闭 ${signal} 提醒)`
    : `  (Silence this nudge? Set "hint_dismiss_signals": ["${signal}"] in .fabric/fabric-config.json, or ask me to dismiss ${signal} for this session)`;
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
function readMaintenanceLastEmit(projectRoot, sessionId) {
  const p = join(projectRoot, sessionScopedCacheFile(MAINTENANCE_HINT_LAST_EMIT_FILE, sessionId));
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

function writeMaintenanceLastEmit(projectRoot, nowMs, sessionId) {
  const p = join(projectRoot, sessionScopedCacheFile(MAINTENANCE_HINT_LAST_EMIT_FILE, sessionId));
  try {
    // ISS-016: atomic tmp+rename (see writeShownCache).
    if (stateStore && typeof stateStore.atomicWrite === "function") {
      stateStore.atomicWrite(p, new Date(nowMs).toISOString());
    } else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, new Date(nowMs).toISOString());
    }
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
  // rc.16 TASK-002: banner variant for the i18n lib. Defaults to 'zh-CN' so
  // existing rc.7 T10 test fixtures (which never set thresholds.variant) get
  // the byte-identical Chinese maintenance banner.
  const variant = typeof cfg.variant === "string" ? cfg.variant : "zh-CN";

  if (canonicalCount < MAINTENANCE_HINT_MIN_CANONICAL) {
    return null;
  }

  // Cooldown gate — short-circuit when we just nagged.
  // rc.34 TASK-01 + review-fix (Gemini P1): future-stamped lastEmit (backward
  // clock skew) bypasses cooldown — treats sidecar as "expired" so the gate
  // heals on the next invocation instead of waiting (cooldown + |skew|).
  if (
    typeof lastEmitMs === "number" &&
    Number.isFinite(lastEmitMs) &&
    nowMs >= lastEmitMs &&
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

  // rc.16 TASK-002: i18n via lib. Substrings ('从未运行 lint 检查',
  // '已 N 天未跑 lint', 'fabric doctor --lint') preserved by the lib's
  // zh-CN templates. ageDays passed as already-toFixed(1) string to keep
  // the lib pure (no number formatting in render path).
  const line2 = renderBanner("maintenanceLine2", variant, {});
  const line1 = lastDoctorTs === null
    ? renderBanner("maintenanceLine1Never", variant, {})
    : renderBanner("maintenanceLine1Aged", variant, {
        days,
        ageDays: ageDays.toFixed(1),
      });
  const reason = `${line1}\n${line2}`;

  return {
    decision: "block",
    reason,
    signal: "maintenance",
    // CLI recommendation rather than Skill — doctor is a CLI surface.
    recommended_skill: null,
    // v2.1 NEW-N-3: staleness trigger. threshold=days; actual=ageDays. When
    // lint was NEVER run ageDays is null — main() skips the signal emit rather
    // than fabricate a number (honest gap over fake telemetry).
    threshold: days,
    actual_value: ageDays,
  };
}

// lifecycle-refactor W3-A2 (§7 graph generation signal): after a successful
// archive the Stop hook REQUESTS edge extraction by emitting one
// graph_edge_candidate_requested{stable_id, store?}. The hook never PRODUCES
// edges (that is the archive/import skill's or doctor co-occurrence's job,
// KT-DEC-0007) — it only flags "this entry just landed; someone should extract
// its `related` edges". FROZEN-safe: O(1) tail scan, best-effort silent, single
// advisory-locked appendLockedLine (same primitive the rest of this hook uses).
//
// HONEST stable_id sourcing — the deliberate limitation: pending entries (the
// fabric-archive → extractKnowledge path) carry NO canonical stable_id (id is
// late-bound at fab_review approve), so their knowledge_proposed event omits
// stable_id (or sets the `pending:<key>` sentinel). A graph edge between
// id-less pending drafts is meaningless, so we DO NOT fabricate one. We emit
// ONLY when the most-recent knowledge_proposed event carries a real
// K[TP]-XXX-NNNN stable_id (the approve/promote path) — i.e. an entry that
// actually has a canonical node to attach edges to. When the latest proposed
// is id-less we honestly skip; the request will fire on the approve event that
// allocates the id. A session-scoped sidecar de-dupes so repeated Stop fires in
// one session don't re-request the same id.
const STABLE_ID_RE = /^K[TP]-[A-Z]{3}-\d{4}$/;
const GRAPH_EDGE_REQUESTED_SIDECAR = ".fabric/.cache/graph-edge-requested";

function emitGraphEdgeCandidateBestEffort(cwd, events, sessionId) {
  try {
    if (!Array.isArray(events) || events.length === 0) return;
    const fabricDir = join(cwd, FABRIC_DIR);
    if (!existsSync(fabricDir)) return;

    // O(1)-amortized tail scan for the newest knowledge_proposed carrying a
    // real (non-sentinel) stable_id. Stop at the first knowledge_proposed we
    // see — if the latest archive is id-less, we honestly skip rather than
    // reaching back to an older approved entry (that older entry's edges were
    // already requested when IT landed).
    let stableId = null;
    let store;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev || ev.event_type !== EVENT_TYPE_PROPOSED) continue;
      const candidate = typeof ev.stable_id === "string" ? ev.stable_id : null;
      if (candidate && STABLE_ID_RE.test(candidate)) {
        stableId = candidate;
        if (typeof ev.store === "string" && ev.store.length > 0) store = ev.store;
      }
      // First knowledge_proposed encountered (newest) decides; do not walk past
      // it to an older one.
      break;
    }
    if (stableId === null) return;

    // Session-scoped de-dup: skip if we already requested edges for this exact
    // stable_id this session. Sidecar is a single line holding the last id.
    const sidecarPath = join(cwd, sessionScopedCacheFile(GRAPH_EDGE_REQUESTED_SIDECAR, sessionId));
    try {
      if (existsSync(sidecarPath)) {
        const prev = readFileSync(sidecarPath, "utf8").trim();
        if (prev === stableId) return;
      }
    } catch {
      // unreadable sidecar → fall through and (re)emit; de-dup is best-effort.
    }

    let idSuffix;
    try {
      idSuffix = require("node:crypto").randomUUID();
    } catch {
      idSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    const event = {
      kind: "fabric-event",
      id: `event:${idSuffix}`,
      ts: Date.now(),
      schema_version: 1,
      event_type: "graph_edge_candidate_requested",
      stable_id: stableId,
    };
    if (store !== undefined) event.store = store;
    if (typeof sessionId === "string" && sessionId.length > 0) event.session_id = sessionId;
    appendLockedLine(join(fabricDir, EVENT_LEDGER_FILE), JSON.stringify(event) + "\n");

    // Record the de-dup marker (best-effort; atomic when state-store lib loaded).
    try {
      if (stateStore && typeof stateStore.atomicWrite === "function") {
        stateStore.atomicWrite(sidecarPath, stableId);
      } else {
        mkdirSync(dirname(sidecarPath), { recursive: true });
        writeFileSync(sidecarPath, stableId);
      }
    } catch {
      // de-dup marker write failed — at worst we re-request next Stop; harmless.
    }
  } catch {
    // best-effort §7 signal — never block the Stop hook (KT-DEC-0007).
  }
}

// v2.1 NEW-N-3 (ADJ-NEWN-3): hook_signal_emitted instrumentation. Writes ONE
// best-effort ledger row at the point a nudge is actually delivered (post-
// cooldown), so the join key measures nudge-trigger logic (which signal fired,
// at what threshold vs. actual). Emitted at delivery rather than at
// threshold-cross so it inherits the cooldown gate — a fired-but-cooled signal
// does not spam the ledger every session. Skips silently when threshold /
// actual_value are not finite numbers (e.g. maintenance "never run" → null
// age). Never blocks the hook (KT-DEC-0007).
const SIGNAL_TYPE_ENUM = new Set(["archive", "review", "maintenance", "other"]);
function emitSignalFiredEvent(cwd, sessionId, result) {
  try {
    if (!result || typeof result.signal !== "string") return;
    const threshold = result.threshold;
    const actualValue = result.actual_value;
    if (
      typeof threshold !== "number" ||
      !Number.isFinite(threshold) ||
      typeof actualValue !== "number" ||
      !Number.isFinite(actualValue)
    ) {
      return;
    }
    const fabricDir = join(cwd, FABRIC_DIR);
    if (!existsSync(fabricDir)) return;
    // "import" / any non-canonical signal collapses to schema's catch-all "other".
    const signalType = SIGNAL_TYPE_ENUM.has(result.signal) ? result.signal : "other";
    let idSuffix;
    try {
      idSuffix = require("node:crypto").randomUUID();
    } catch {
      idSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    const event = {
      kind: "fabric-event",
      id: `event:${idSuffix}`,
      ts: Date.now(),
      schema_version: 1,
      event_type: "hook_signal_emitted",
      signal_type: signalType,
      threshold,
      actual_value: actualValue,
      fired: true,
    };
    if (typeof sessionId === "string" && sessionId.length > 0) event.session_id = sessionId;
    appendLockedLine(join(fabricDir, EVENT_LEDGER_FILE), JSON.stringify(event) + "\n");
  } catch {
    // best-effort telemetry — never block the hook
  }
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
  } catch (e) {
    // v2.0.0-rc.29 TASK-008 (BUG-L1): hook used to silent-swallow JSON.parse
    // errors which masked real client-side payload bugs (e.g. CLI hosts that
    // stopped emitting Stop-hook JSON envelopes). Log a single best-effort
    // diagnostic line so operators see WHY the hook went quiet; keep returning
    // null so downstream behaviour (graceful exit 0, no rule render) is
    // unchanged.
    try {
      const message = (e && typeof e === "object" && "message" in e) ? String(e.message) : String(e);
      process.stderr.write(`[fabric-hint] malformed input: ${message}\n`);
    } catch {
      // stderr write failed (very unusual — sandbox / closed fd). The
      // hook contract still requires we never throw upward.
    }
    return null;
  }
}

/**
 * v2.0.0-rc.20 TASK-03 → v2.0.0-rc.24 TASK-04: legacy shim signature for
 * parsing the raw text that follows the `KB:` prefix on the first non-empty
 * line of an assistant turn. As of rc.24 the implementation delegates to the
 * shared `parseCiteLine` (inline-shipped via lib/cite-line-parser.cjs) to
 * eliminate per-client regex drift.
 *
 * Contract (rc.24 strict mode — superset of rc.20):
 *   - Sentinel `none` (incl. `[no-relevant]` / `[not-applicable]` tail)
 *     → cite_ids=[], cite_tags=["none"], cite_commitments=[]
 *   - `KT-DEC-0001 [planned]` → cite_ids=["KT-DEC-0001"], cite_tags=["planned"],
 *     cite_commitments=[{operators:[], skip_reason:null}]
 *   - `KT-DEC-0001 [recalled] → edit:foo.ts` → cite_commitments=[{operators:
 *     [{kind:"edit", target:"foo.ts"}], skip_reason:null}]
 *   - `KT-DEC-0001 [recalled] → skip:sequencing` → cite_commitments=[{operators:
 *     [], skip_reason:"sequencing"}]
 *   - Id form is now strict `K[TP]-[A-Z]+-\d+` (rc.20 lax form `KP-001`
 *     without letter-prefix is rejected — see TASK-03 schema).
 *
 * Argument is the post-`KB:` substring (matches the rc.20 call site). Returns
 * { cite_ids, cite_tags, cite_commitments }; cite_commitments was added in
 * rc.24 and is always present (empty array when no cite-line found).
 *
 * Never throws.
 */
function parseKbLine(raw) {
  // Compose the full `KB: <raw>` line because the shared parser anchors on
  // the `KB:` prefix. Handles the legacy `none` / `<sentinel>` inputs naturally
  // because parseCiteLine's SENTINEL_RE matches the composed line.
  if (typeof raw !== "string") {
    return { cite_ids: [], cite_tags: [], cite_commitments: [] };
  }
  const composed = `KB: ${raw}`;
  if (citeLineParser && typeof citeLineParser.parseCiteLine === "function") {
    return citeLineParser.parseCiteLine(composed);
  }
  // Degraded fallback: lib missing (e.g. partial install). Emit empty result
  // so downstream consumers see the cite-line as unobservable rather than
  // mis-parsed. The Stop-hook contract is best-effort, never blocking.
  return { cite_ids: [], cite_tags: [], cite_commitments: [] };
}

/**
 * v2.0.0-rc.20 TASK-03: detect which client surface invoked the hook so the
 * emitted assistant_turn_observed event can carry a `client` discriminator
 * without having to inspect the transcript shape.
 *
 * Resolution order (first match wins):
 *   1. `FABRIC_HINT_CLIENT` env var — explicit override, set by the per-
 *      client install pipeline when the hook-config schema supports env
 *      injection.
 *   2. Path heuristic against `__dirname` — `.claude/` → "cc", `.codex/` →
 *      "codex". Covers the dominant deployment shape (hook script lives
 *      under the client's per-repo dir).
 *
 * Returns `undefined` when neither signal fires (e.g. Cursor — deferred to
 * rc.21 — or a custom deployment). The Zod schema marks `client` optional,
 * so omitting it leaves the event valid.
 */
function detectClient() {
  // Delegate the full 3-tier detection (env → CLAUDE_PROJECT_DIR → path
  // heuristic, incl. .cursor) to the shared adapter. __dirname is passed so
  // the path heuristic reflects THIS hook's location.
  if (clientAdapter && typeof clientAdapter.detectClient === "function") {
    return clientAdapter.detectClient(__dirname);
  }
  // Fallback (adapter lib absent): env override only.
  const envClient = process.env.FABRIC_HINT_CLIENT;
  if (typeof envClient === "string" && envClient.length > 0) {
    const normalised = envClient.trim().toLowerCase();
    if (normalised === "cc" || normalised === "codex" || normalised === "cursor") {
      return normalised;
    }
  }
  return undefined;
}

/**
 * v2.0.0-rc.20 TASK-03: emit one `assistant_turn_observed` event per
 * assistant envelope harvested from the transcript. Wrapped in try/catch
 * (best-effort, never throws — Stop hook MUST stay non-blocking on any
 * failure here). The event shape mirrors
 * assistantTurnObservedEventSchema in
 * packages/shared/src/schemas/event-ledger.ts (registered in rc.20 TASK-02).
 *
 * Call site sits immediately AFTER writeSessionDigestBestEffort so both
 * digest + per-turn events derive from the same transcript snapshot.
 *
 * `id` mirrors the server's convention (`event:<uuid>`) using
 * crypto.randomUUID when available — falls back to a timestamp+counter
 * tuple on older Node where randomUUID is missing (cjs hook tooling
 * defensively targets Node 18+, but the fallback keeps it event-shaped).
 */
function extractAndWriteAssistantTurnsBestEffort(cwd, stdinPayload) {
  if (stdinPayload === null || typeof stdinPayload !== "object") return;
  try {
    const sessionId = stdinPayload.session_id;
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    const transcript = summarizeTranscript(stdinPayload.transcript_path);
    const turns = transcript.assistant_turns;
    if (!Array.isArray(turns) || turns.length === 0) return;

    // Resolve event-ledger path. Caller already validated cwd shape.
    const fabricDir = join(cwd, FABRIC_DIR);
    if (!existsSync(fabricDir)) {
      // No .fabric/ → workspace is uninitialised. Silently skip; the digest
      // writer applies the same guard via its own internal check.
      return;
    }
    const ledgerPath = join(fabricDir, EVENT_LEDGER_FILE);
    const client = detectClient();
    let randomUUID;
    try {
      ({ randomUUID } = require("node:crypto"));
    } catch {
      randomUUID = null;
    }

    // v2.0.0-rc.39 (P1 emit-fold): empty-shell turns (no KB: line, no cites)
    // do not get an events.jsonl line — they are tallied and folded into one
    // metrics.jsonl counter row at the end of this batch. This zeroes the 99%
    // empty-shell bloat at the source while keeping cite-bearing turns as
    // discrete audit events. Count carries per-Stop re-emission exactly (we
    // tally every empty turn the transcript presents, not just new ones), so
    // the reader-side counter merge reconstructs total_turns byte-for-byte.
    let emptyShellCount = 0;
    for (const turn of turns) {
      try {
        const citeIds = Array.isArray(turn.cite_ids) ? turn.cite_ids : [];
        const citeCommitments = Array.isArray(turn.cite_commitments)
          ? turn.cite_commitments
          : [];
        const isEmptyShell =
          (turn.kb_line_raw === null || turn.kb_line_raw === undefined) &&
          citeIds.length === 0 &&
          citeCommitments.length === 0;
        if (isEmptyShell) {
          emptyShellCount += 1;
          continue;
        }
        const idSuffix = typeof randomUUID === "function"
          ? randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const event = {
          kind: "fabric-event",
          id: `event:${idSuffix}`,
          ts: Date.now(),
          schema_version: 1,
          session_id: sessionId,
          event_type: EVENT_TYPE_ASSISTANT_TURN_OBSERVED,
          kb_line_raw: turn.kb_line_raw,
          cite_ids: citeIds,
          cite_tags: Array.isArray(turn.cite_tags) ? turn.cite_tags : [],
          // rc.24 TASK-04: cite_commitments parallel array (assistantTurn
          // ObservedEventSchema gained this slot in rc.24 TASK-01). Empty
          // array for legacy turns or when the parser lib is unavailable —
          // the schema defaults `.default([])` so omitting it would also be
          // valid, but emitting an explicit `[]` keeps the on-disk shape
          // uniform across rc.24+ events.
          cite_commitments: citeCommitments,
          turn_id: `${sessionId}-${turn.envelope_index}`,
          envelope_index: turn.envelope_index,
          timestamp: new Date().toISOString(),
        };
        if (client !== undefined) event.client = client;
        appendLockedLine(ledgerPath, JSON.stringify(event) + "\n");
      } catch {
        // Per-turn failure must not abort the remaining turns; the Stop hook
        // contract is "never block on hook failure". Best-effort continues.
      }
    }

    // rc.39 emit-fold: write one metrics.jsonl counter row for the folded
    // empty-shell turns. Best-effort — a failure here must never block the
    // Stop hook (KT-DEC-0007). The counter key is namespaced by client so the
    // reader's per_client total_turns breakdown stays invariant; an undefined
    // client (adapter lib absent) folds into the bare `assistant_turn_observed`
    // key, mirroring how such turns omit the event-side `client` discriminator.
    if (emptyShellCount > 0) {
      try {
        const counterKey =
          client !== undefined
            ? `${EVENT_TYPE_ASSISTANT_TURN_OBSERVED}:${client}`
            : EVENT_TYPE_ASSISTANT_TURN_OBSERVED;
        const metricsRow = {
          timestamp: new Date().toISOString(),
          window: "stop",
          counters: { [counterKey]: emptyShellCount },
        };
        const metricsPath = join(fabricDir, METRICS_LEDGER_FILE);
        appendLockedLine(metricsPath, JSON.stringify(metricsRow) + "\n");
      } catch {
        // metrics fold is observability-only; never block the hook on failure.
      }
    }
  } catch {
    // Outer guard — never throw. Hook continues silently.
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
 *
 * v2.0.0-rc.20 TASK-03: additionally collects `assistant_turns[]` — one
 * entry per assistant envelope with the parsed KB-line cite metadata. Field
 * is additive; existing callers (writeSessionDigestBestEffort) ignore it.
 */
function summarizeTranscript(transcriptPath) {
  // rc.20 TASK-03: additive `assistant_turns` array — one entry per assistant
  // envelope, regardless of whether the first line matched KB:. Downstream
  // consumers (extractAndWriteAssistantTurnsBestEffort) emit one
  // assistant_turn_observed event per element; `kb_line_raw=null` when no
  // KB: line was found.
  const out = { user_messages: [], edit_paths: [], title: "", assistant_turns: [] };
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) return out;
  if (!existsSync(transcriptPath)) return out;
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return out;
  }
  const lines = raw.split(/\r?\n/);
  let envelopeIndex = -1;
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
    envelopeIndex += 1;

    // v2.0.0-rc.27 TASK-009 (audit §2.16): Codex CLI uses a different
    // envelope shape — { type:"response_item", payload:{ type:"message",
    // role, content:[{type:"input_text"|"output_text", text}] } } — vs Claude
    // Code's { type:"user", message:{ role, content } }. Resolve role +
    // content from whichever shape is present; without this, every Codex
    // session's digest came out empty (audit §2.16 — fixed here).
    const role =
      envelope.role ||
      (envelope.message && envelope.message.role) ||
      (envelope.payload && envelope.payload.role);
    if (role === "user") {
      const content =
        envelope.content ||
        (envelope.message && envelope.message.content) ||
        (envelope.payload && envelope.payload.content);
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

    // rc.20 TASK-03: assistant envelope — capture first non-empty line of the
    // first text block and parse for `KB:` prefix. We push ONE assistant_turns
    // entry per assistant envelope (even when no KB: line) so downstream can
    // distinguish "turn observed, no KB" (kb_line_raw=null) from "no turn".
    if (role === "assistant") {
      const content =
        envelope.content ||
        (envelope.message && envelope.message.content) ||
        (envelope.payload && envelope.payload.content);
      let firstText = null;
      if (typeof content === "string") {
        firstText = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
            firstText = block.text;
            break;
          }
        }
      }
      let kbLineRaw = null;
      let citeIds = [];
      let citeTags = [];
      // rc.24 TASK-04: parallel `cite_commitments` array, populated by the
      // shared cite-line parser. One entry per non-sentinel cite (index-aligned
      // with cite_ids). Sentinel `KB: none` contributes a `cite_tags=["none"]`
      // entry but no commitment — matches the parseCiteLine index contract.
      let citeCommitments = [];
      // v2.0.0-rc.27 TASK-009: Codex assistant blocks carry text under
      // `type:"output_text"` (not `type:"text"`). Fall back when no text-typed
      // block matched but a typed output_text block exists.
      if (firstText === null && Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && block.type === "output_text" && typeof block.text === "string") {
            firstText = block.text;
            break;
          }
        }
      }
      if (typeof firstText === "string" && firstText.length > 0) {
        // First non-empty line.
        const linesOfText = firstText.split(/\r?\n/);
        let firstNonEmpty = "";
        for (const l of linesOfText) {
          if (l.trim().length > 0) {
            firstNonEmpty = l.trim();
            break;
          }
        }
        if (firstNonEmpty.length > 0) {
          // rc.24 TASK-04: route the FULL `KB: ...` line to the shared parser.
          // parseCiteLine handles sentinels (`KB: none [<reason>]`) AND full
          // cite form including contract tail (`KB: KT-DEC-0001 [recalled] →
          // edit:foo.ts`) uniformly. The sentinel's `[<reason>]` tail stays in
          // `kb_line_raw` for doctor's downstream histogram parse; cite_tags
          // still emits the bare `none` token (schema enum-bound).
          if (/^KB:\s*/i.test(firstNonEmpty)) {
            kbLineRaw = firstNonEmpty;
            if (citeLineParser && typeof citeLineParser.parseCiteLine === "function") {
              const parsed = citeLineParser.parseCiteLine(firstNonEmpty);
              citeIds = parsed.cite_ids;
              citeTags = parsed.cite_tags;
              citeCommitments = parsed.cite_commitments;
            }
            // Degraded mode (lib missing) → keep kbLineRaw but emit empty
            // arrays; doctor downstream treats this as "turn observed, parse
            // unavailable" without crashing.
          }
        }
      }
      out.assistant_turns.push({
        envelope_index: envelopeIndex,
        kb_line_raw: kbLineRaw,
        cite_ids: citeIds,
        cite_tags: citeTags,
        cite_commitments: citeCommitments,
      });
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

    // v2.0.0-rc.27 TASK-009 (audit §2.16): Codex apply_patch path. Codex
    // emits one response_item envelope per file-edit invocation with payload
    // shape { type:"custom_tool_call", name:"apply_patch", input:<patch
    // string> }. The patch body lists target files via `*** Update File:`,
    // `*** Add File:`, `*** Delete File:` directives — harvest those.
    if (
      envelope.type === "response_item" &&
      envelope.payload &&
      envelope.payload.type === "custom_tool_call" &&
      envelope.payload.name === "apply_patch" &&
      typeof envelope.payload.input === "string"
    ) {
      const patchInput = envelope.payload.input;
      const fileDirectiveRe = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+?)\s*$/gm;
      let m;
      while ((m = fileDirectiveRe.exec(patchInput)) !== null) {
        const fp = m[1].trim();
        if (fp.length > 0) out.edit_paths.push(fp);
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
 * v2.0.0-rc.24 TASK-05: emit soft L1 reminder to stderr when assistant turns
 * cited a decision/pitfall id with [recalled] but no operator contract and no
 * skip:<reason>. Reads agents.meta.json once per invocation; aggregated per
 * turn (one line per offending id). Non-blocking — never throws, always
 * returns the array of emitted reminder strings (for unit tests + callers
 * that want to observe what was written).
 *
 * The reminder writes go to stderr (the hook contract: stdout is structured
 * banner JSON consumed by the harness; stderr is free-text system message
 * that surfaces back to the model on the next turn in cc / codex / cursor).
 */
function emitCiteContractRemindersBestEffort(cwd, stdinPayload, stderr) {
  if (citeContractReminder === null) return [];
  if (stdinPayload === null || typeof stdinPayload !== "object") return [];
  try {
    const transcript = summarizeTranscript(stdinPayload.transcript_path);
    const turns = transcript.assistant_turns;
    if (!Array.isArray(turns) || turns.length === 0) return [];

    const idTypeMap = citeContractReminder.readKnowledgeTypeMap(cwd);
    if (!(idTypeMap instanceof Map) || idTypeMap.size === 0) return [];

    const reminders = citeContractReminder.formatContractMissingReminders({
      assistant_turns: turns,
      idTypeMap,
    });
    if (!Array.isArray(reminders) || reminders.length === 0) return [];

    const sink = stderr || process.stderr;
    for (const line of reminders) {
      try {
        sink.write(line + "\n");
      } catch {
        // Sink write failure must not abort emission of remaining reminders.
      }
    }
    return reminders;
  } catch {
    // Outer guard — never throw. Hook continues silently.
    return [];
  }
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
    // v2.0.0-rc.20 TASK-03: per-turn cite-policy observation events. Same
    // best-effort contract as the digest writer — never throws, never blocks
    // the Stop hook on failure. Shares the transcript snapshot read by
    // writeSessionDigestBestEffort (each call re-reads independently; the
    // transcript file is small in practice and re-parse cost is dwarfed by
    // the hook's other I/O).
    extractAndWriteAssistantTurnsBestEffort(cwd, stdinPayload);

    // v2.0.0-rc.24 TASK-05: L1 soft reminder layer. Surfaces ⚠ KB:<id> lines
    // to stderr when decision/pitfall cites arrived with [recalled] tag but
    // empty contract. Non-blocking, never throws; doctor (TASK-08) catches
    // any contract violation the model ignored.
    emitCiteContractRemindersBestEffort(
      cwd,
      stdinPayload,
      stdio && stdio.stderr,
    );

    const events = readLedger(cwd);

    // lifecycle-refactor W3-A2 (§7): request graph-edge extraction for a freshly
    // archived canonical entry. Runs UNCONDITIONALLY here (before the nudge
    // cooldown/dismiss early-returns) so the §7 signal is independent of whether
    // a reminder banner is shown this Stop. Best-effort, never throws.
    try {
      emitGraphEdgeCandidateBestEffort(cwd, events, resolveHookSessionId(stdinPayload));
    } catch {
      // never block the Stop hook
    }

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
    //
    // rc.16 TASK-002 (F2-apply): resolve `fabric_language` ONCE per main()
    // invocation via the banner-i18n lib. The result threads through
    // `thresholds.variant` into both decide() and evaluateMaintenanceSignal()
    // so we read the config file at most once, not five times. Lib reader
    // is never-throw; defensive try/catch is belt-and-suspenders.
    let variant = "zh-CN";
    try {
      variant = readFabricLanguage(cwd);
    } catch {
      variant = "zh-CN";
    }

    let thresholds;
    try {
      thresholds = {
        archiveHintHours: readArchiveHintHours(cwd),
        reviewHintPendingCount: readReviewHintPendingCount(cwd),
        reviewHintPendingAgeDays: readReviewHintPendingAgeDays(cwd),
        maintenanceHintDays: readMaintenanceHintDays(cwd),
        maintenanceHintCooldownDays: readMaintenanceHintCooldownDays(cwd),
        variant,
      };
    } catch {
      thresholds = {
        archiveHintHours: DEFAULT_ARCHIVE_HINT_HOURS,
        reviewHintPendingCount: DEFAULT_REVIEW_HINT_PENDING_COUNT,
        reviewHintPendingAgeDays: DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS,
        maintenanceHintDays: DEFAULT_MAINTENANCE_HINT_DAYS,
        maintenanceHintCooldownDays: DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS,
        variant,
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

    // v2.0.0-rc.8 (TASK-002): probe `.fabric/.import-state.json` to
    // determine whether a fabric-import skill run is currently in flight.
    // Threaded into decide() so Signal B (review hint) is suppressed for
    // the duration of an active import — preventing the Stop hook from
    // interrupting the import when its pending pile crosses the review
    // threshold. See isImportInFlight() docstring for the full truth table.
    let importInFlight = false;
    try {
      importInFlight = isImportInFlight(cwd, now);
    } catch {
      importInFlight = false;
    }

    let result = decide(
      events,
      now,
      pendingStats,
      underseedStats,
      editCounterStats,
      thresholds,
      { activityOverview },
      importInFlight,
    );

    // v2.0.0-rc.7 T10: Signal D — maintenance hint. Evaluated AFTER A/B/C
    // because the existing three signals carry higher urgency (in-flight
    // archive backlog > review backlog > sparse corpus > stale lint). The
    // maintenance prompt only surfaces when none of the in-flight signals
    // fire and the corpus has had time to accumulate enough lint surface
    // for the prompt to be actionable.
    if (result === null) {
      try {
        const lastEmit = readMaintenanceLastEmit(cwd, resolveHookSessionId(stdinPayload));
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

    // v2.0.0-rc.37 NEW-16: per-signal dismiss. A chosen signal whose type the
    // user dismissed (config-durable or session sidecar) exits silently —
    // same shape as a cooldown hit. Covers BOTH maintenance and A/B/C paths.
    const sessionId =
      stdinPayload && typeof stdinPayload.session_id === "string"
        ? stdinPayload.session_id
        : null;
    if (readDismissedSignals(cwd, sessionId).has(result.signal)) {
      return;
    }
    // Append the bilingual dismiss-option line so the lever is discoverable.
    if (typeof result.reason === "string") {
      result.reason = `${result.reason}\n${renderDismissOption(result.signal, variant)}`;
    }

    // v2.1.0-rc.1 P4 (F4/S63): surface the read-set stores on the Stop hint so
    // backlog/maintenance nudges are read per-store, not as one undifferentiated
    // pile. Best-effort; missing snapshot / single-store omits the line.
    if (bindingsSnapshotReader !== null && typeof result.reason === "string") {
      try {
        const bindingId = readWorkspaceBindingId(cwd);
        if (bindingId) {
          const label = bindingsSnapshotReader.formatStoreLabels(
            bindingsSnapshotReader.readBindingsSnapshot(bindingId),
          );
          if (label) {
            result.reason = `${result.reason}\n${label}`;
          }
        }
      } catch {
        // store label is decorative provenance — never crash the hook
      }
    }

    // v2.0.0-rc.7 T10: Signal D uses its own cooldown sidecar (day-based,
    // see MAINTENANCE_HINT_LAST_EMIT_FILE). The A/B/C shared cooldown cache
    // uses hours, so we branch here to avoid mixing semantics.
    if (result.signal === "maintenance") {
      emitSignalFiredEvent(cwd, sessionId, result);
      delete result.threshold;
      delete result.actual_value;
      out.write(JSON.stringify(result));
      writeMaintenanceLastEmit(cwd, nowMs, resolveHookSessionId(stdinPayload));
      return;
    }

    // Cooldown throttle: once a signal fires, stay silent for
    // archive_hint_cooldown_hours (default 12h) regardless of state drift.
    // Pure reminder-noise reduction; the underlying trigger logic is unchanged.
    const cooldownMs = readCooldownHours(cwd) * MS_PER_HOUR;
    const cache = readShownCache(cwd, resolveHookSessionId(stdinPayload));
    const lastShown = cache[result.signal];
    // rc.34 TASK-01 + review-fix (Gemini P1): future-stamped lastShown
    // (backward clock skew) bypasses cooldown — sidecar treated as expired.
    if (
      typeof lastShown === "number" &&
      nowMs >= lastShown &&
      nowMs - lastShown < cooldownMs
    ) {
      return; // Still in cooldown — silent.
    }

    emitSignalFiredEvent(cwd, sessionId, result);
    delete result.threshold;
    delete result.actual_value;
    out.write(JSON.stringify(result));
    cache[result.signal] = nowMs;
    writeShownCache(cwd, cache, resolveHookSessionId(stdinPayload));
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
  // v2.0.0-rc.8 (TASK-002): in-flight import gate for Signal B (exported
  // for unit testing of the truth table).
  isImportInFlight,
  decide,
  readCooldownHours,
  readUnderseedThreshold,
  readArchiveEditThreshold,
  // v2.0.0-rc.37 NEW-16: per-signal dismiss helpers (exported for tests +
  // the agent-driven session-dismiss write path).
  readDismissedSignals,
  writeSessionDismiss,
  sessionDismissFileName,
  renderDismissOption,
  DISMISSABLE_SIGNALS,
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
  // v2.0.0-rc.20 TASK-03 / TASK-09: cite-policy parsing + per-turn emission
  // helpers (exported for unit testing of the parse + emit contract).
  parseKbLine,
  detectClient,
  extractAndWriteAssistantTurnsBestEffort,
  // v2.0.0-rc.24 TASK-05: L1 soft reminder helpers (exported for unit testing
  // of the contract-missing emission contract). The lib module itself is
  // also exported indirectly via the reminder helper.
  emitCiteContractRemindersBestEffort,
  // lifecycle-refactor W3-A2 (§7): graph-edge-candidate request emitter
  // (exported for unit testing of the honest stable_id-gating + de-dup).
  emitGraphEdgeCandidateBestEffort,
  CONSTANTS: {
    FABRIC_DIR,
    EVENT_LEDGER_FILE,
    METRICS_LEDGER_FILE,
    EVENT_TYPE_ASSISTANT_TURN_OBSERVED,
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
    // v2.0.0-rc.8 (TASK-002): in-flight import gate for Signal B.
    IMPORT_STATE_FILE_REL,
    IMPORT_IN_FLIGHT_MAX_AGE_HOURS,
    // lifecycle-refactor W3-A2 (§7): graph-edge-request de-dup sidecar.
    GRAPH_EDGE_REQUESTED_SIDECAR,
  },
};

if (require.main === module) {
  main({ cwd: process.cwd(), now: new Date() }, { stdout: process.stdout });
  process.exit(0);
}
