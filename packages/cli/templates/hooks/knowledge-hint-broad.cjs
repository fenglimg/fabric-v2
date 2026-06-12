#!/usr/bin/env node
/**
 * rc.6 TASK-019 (E1) — SessionStart broad-injection hook.
 *
 * Stateless ambient-awareness hook: on every SessionStart event, invokes
 * `fabric plan-context-hint --all` to fetch the workspace's broad-scoped
 * knowledge index, then renders a human-readable summary to stderr so the
 * Agent's session opens with passive awareness of what knowledge exists.
 *
 * No state file. No fingerprint dedup. No cooldown. SessionStart fires once
 * per session boot — the rendering cost is paid exactly that often. The
 * narrow-injection sibling (E2, knowledge-hint-narrow.cjs) handles
 * per-Edit/Write hints with a session-hints cache.
 *
 * Output contract (stderr only):
 *
 *   When narrow count <= 30 (full per-type listing mode):
 *     [fabric] Session start — N broad-scoped knowledge entries available:
 *       [decision] (proven)
 *         - <id> · <summary>
 *       [pitfall] (verified)
 *         - <id> · <summary>
 *       ...
 *     revision_hash: <hash>
 *     Load full content: `fab_recall(paths)`, or `fab_plan_context` -> `fab_get_knowledge_sections` to trim first.
 *
 *   When narrow count > 30 (grouped-truncation mode, per type):
 *     [fabric] Session start — N broad-scoped knowledge entries available (truncated):
 *       [decision] proven (3):
 *         - <id> · <summary>
 *         - ...
 *       [decision] verified (12): <id1>, <id2>, ...
 *       [decision] draft: 7 entries
 *       ...
 *     revision_hash: <hash>
 *     Load full content: `fab_recall(paths)`, or `fab_plan_context` -> `fab_get_knowledge_sections` to trim first.
 *
 *   When 0 entries / CLI unavailable / CLI error / parse failure:
 *     (no output — silent exit 0)
 *
 * Stdout is intentionally empty: Stop hooks may pollute stdout to signal
 * `decision:block`, but SessionStart is informational, never blocking.
 *
 * Failure invariant: any error path (spawn failure, ENOENT, timeout,
 * JSON.parse throw) MUST end in silent exit 0. The hook never blocks
 * session start on its own malfunction.
 */

const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

// W1-01 (ISS-012): the SessionStart broad hook appends a hook_surface_emitted
// event to the shared events.jsonl. Under multi-window concurrency a bare
// appendFileSync can interleave a partial write; route through the advisory-lock
// primitive (drop-on-contention, best-effort — matches injection-log).
const { appendLockedLine } = require("./lib/injection-log.cjs");

// rc.16 TASK-003: shared banner-i18n lib (resolves fabric_language config and
// renders localized banner text). Mirror of the wiring in fabric-hint.cjs
// (TASK-002). Variant is resolved ONCE per main() invocation via
// readFabricLanguage(cwd) and threaded into renderBanner — no fs in render path.
const { renderBanner, readFabricLanguage } = require("./lib/banner-i18n.cjs");
const { resolveOpaqueSummaries } = require("./lib/summary-fallback.cjs");
// v2.0.0-rc.37 NEW-19: shared fabric-config reader + sidecar I/O. Replaces the
// five per-key readFileSync+parse config readers (one parse per fire now) and
// the bespoke last-emit sidecar helpers. The L78 "refactor into lib/ if a
// third hook needs it" note is now realised.
const {
  readConfigNumber,
  readConfigBoolean,
  readConfigString,
} = require("./lib/config-cache.cjs");
const { readTextState, writeTextState } = require("./lib/state-store.cjs");
// v2.0.0-rc.37 NEW-30: shared client detection (replaces the inline
// CLAUDE_PROJECT_DIR single-bit check below).
// v2.2 dual-sink (Goal A): + emitDualSink (two-channel SessionStart emit).
const { isClaudeCode, detectClient, emitDualSink } = require("./lib/client-adapter.cjs");
// v2.2 dual-sink (Goal A / D4): human-output gate (nudge_mode + observe.*). Only
// governs the human systemMessage — the AI additionalContext is emitted
// regardless (flow ⊥ observation). Optional require so an old install lacking the
// lib degrades to "always emit human" (the pre-dual-sink default).
let nudgePolicy = null;
try {
  nudgePolicy = require("./lib/nudge-policy.cjs");
} catch {
  // Lib missing (old install) — human sink always emits (legacy behavior).
}
// v2.1.0-rc.1 P4 (F4/S63): hook-side reader for the CLI pre-generated
// resolved-bindings snapshot. The hook NEVER re-resolves stores or walks store
// trees — it only echoes the read-set the CLI already computed. Best-effort.
let bindingsSnapshotReader = null;
try {
  bindingsSnapshotReader = require("./lib/bindings-snapshot-reader.cjs");
} catch {
  // Lib missing (old install) — store labels degrade to silent absence.
}
// v2.2 HK3-telemetry (W3-T1): injection-side per-inject logger. Optional require
// so an old install lacking the lib degrades to silent absence (no telemetry,
// hook still works).
let injectionLog = null;
try {
  injectionLog = require("./lib/injection-log.cjs");
} catch {
  // Lib missing (old install) — injection telemetry degrades to silent absence.
}

// Read the workspace binding id from `.fabric/fabric-config.json` (the snapshot
// key). Defaults to project_id when workspace_binding_id is absent.
function readWorkspaceBindingId(cwd) {
  try {
    const raw = readFileSync(join(cwd, ".fabric", "fabric-config.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.workspace_binding_id === "string") return parsed.workspace_binding_id;
    return typeof parsed.project_id === "string" ? parsed.project_id : null;
  } catch {
    return null;
  }
}

function readSnapshotCanonicalCount(projectRoot) {
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
    if (
      stats &&
      typeof stats === "object" &&
      Number.isFinite(stats.canonical_count) &&
      stats.canonical_count > 0
    ) {
      return Math.floor(stats.canonical_count);
    }
  } catch {
    // best-effort hint stats only
  }
  return 0;
}


// -----------------------------------------------------------------------------
// rc.12: SessionStart broad-menu is now unconditionally emitted on every
// SessionStart fire (matching Skill-style progressive disclosure). Prior
// versions (rc.5-rc.11) wrote `.fabric/.cache/sessionstart-last-hash` as a
// revision_hash cooldown sidecar to suppress re-emission on unchanged
// knowledge graphs; that gate was removed in rc.12. Orphaned sidecar files
// on existing dogfood repos are harmless dead state and are intentionally
// NOT cleaned up (zero-user clean-slate — no migration logic needed).
// -----------------------------------------------------------------------------

const FABRIC_DIR_REL = ".fabric";

// rc.8 underseed self-check constants (mirror fabric-hint.cjs ~line 76 / 83).
// Intentionally duplicated inline — hooks are independent .cjs files and
// cannot `require` each other. If a third hook ever needs the same logic,
// refactor into packages/cli/templates/hooks/lib/. Keep these values in sync
// with packages/cli/templates/hooks/fabric-hint.cjs.
const IMPORT_STATE_FILE = ".import-state.json";
const KNOWLEDGE_CANONICAL_TYPES = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
];
const DEFAULT_UNDERSEED_NODE_THRESHOLD = 10;

// v2.0.0-rc.33 W2-1 (P0-9): TopK upper bound on broad-scoped entries surfaced
// per SessionStart fire. Keeps the banner inside ~1 screenful so the agent
// actually reads the top-priority entries instead of triaging a wall of text.
// Overridable via fabric-config.json#hint_broad_top_k (range 1..50).
const DEFAULT_HINT_BROAD_TOP_K = 8;

// v2.0.0-rc.33 W2-5 (P1-8): cooldown (in hours) between broad-hint re-emits.
// Default 0 preserves rc.32 behavior — every SessionStart re-fires the banner.
// Cache key uses a separate sidecar from the fabric-hint Signal A/B/C cache
// so the two cooldowns don't interfere.
const DEFAULT_HINT_BROAD_COOLDOWN_HOURS = 0;
const MS_PER_HOUR = 60 * 60 * 1000;
// v2.0.0-rc.37 NEW-19: state-store resolves this basename under .fabric/.cache/.
const HINT_BROAD_LAST_EMIT_FILE_NAME = "knowledge-hint-broad-last-emit";

// v2.0.0-rc.33 W2-6 (P0-7): when true, emit banner as
// hookSpecificOutput.additionalContext JSON on stdout (Claude Code PreToolUse
// contract) so the model receives the reminder in-context. Stderr remains the
// human-facing channel for logs / breadcrumbs.
const DEFAULT_HINT_REMINDER_TO_CONTEXT = true;

// -----------------------------------------------------------------------------
// rc.8 underseed self-check helpers.
//
// These three helpers (countCanonicalNodes / readUnderseedThreshold /
// isImportTouched) are inline copies of the equivalent logic in
// packages/cli/templates/hooks/fabric-hint.cjs (~lines 218 / 749). Hooks
// cannot `require` each other (each .cjs is rendered as a standalone template
// at init time), so duplication is the documented convention. Cross-reference:
// keep both copies in sync; if a third hook needs the same logic, extract to
// packages/cli/templates/hooks/lib/.
// -----------------------------------------------------------------------------

/**
 * Count canonical knowledge entries from the CLI-generated resolved-bindings
 * snapshot. Store-only: hooks never walk project-local knowledge or store
 * trees — a missing snapshot degrades to zero (KT-DEC-0007).
 */
function countCanonicalNodes(projectRoot) {
  const snapshotCount = readSnapshotCanonicalCount(projectRoot);
  return snapshotCount === null ? 0 : snapshotCount;
}

/**
 * Resolve the underseed-node threshold from .fabric/fabric-config.json
 * (underseed_node_threshold), falling back to DEFAULT_UNDERSEED_NODE_THRESHOLD.
 * Any read/parse failure → default (never block on config errors).
 */
function readUnderseedThreshold(projectRoot) {
  // > 0 guard via min: Number.MIN_VALUE (any positive). config-cache returns
  // the parsed number when finite & in-range, else the default.
  return readConfigNumber(projectRoot, "underseed_node_threshold", DEFAULT_UNDERSEED_NODE_THRESHOLD, {
    min: Number.MIN_VALUE,
  });
}

/**
 * v2.0.0-rc.33 W2-1: resolve hint_broad_top_k from fabric-config.json. Slices
 * the broad entry list to TopK before group/truncation render. Validates the
 * schema's 1..50 range inline so a malformed config silently falls back.
 */
function readBroadTopK(projectRoot) {
  return readConfigNumber(projectRoot, "hint_broad_top_k", DEFAULT_HINT_BROAD_TOP_K, {
    min: 1,
    max: 50,
    floor: true,
  });
}

/**
 * v2.0.0-rc.33 W2-5: resolve hint_broad_cooldown_hours. Schema clamps 0..168;
 * 0 means "no cooldown" (re-emit on every SessionStart, rc.32 behavior).
 */
function readBroadCooldownHours(projectRoot) {
  return readConfigNumber(projectRoot, "hint_broad_cooldown_hours", DEFAULT_HINT_BROAD_COOLDOWN_HOURS, {
    min: 0,
    max: 168,
  });
}

/**
 * v2.0.0-rc.33 W2-6: resolve hint_reminder_to_context. Boolean flag — when
 * true (default) the hook writes a Claude-Code-shaped JSON envelope to stdout
 * carrying the banner under hookSpecificOutput.additionalContext so the model
 * receives the reminder in-context. Stderr stays informational either way.
 */
function readReminderToContext(projectRoot) {
  return readConfigBoolean(projectRoot, "hint_reminder_to_context", DEFAULT_HINT_REMINDER_TO_CONTEXT);
}

/**
 * v2.0.0-rc.33 W2-5: read/write the broad-hint last-emit timestamp sidecar.
 * Distinct from fabric-hint's shown-cache so signal cooldowns stay isolated.
 * Returns epoch ms or null when missing/unreadable.
 */
function readBroadLastEmit(projectRoot) {
  const raw = readTextState(projectRoot, HINT_BROAD_LAST_EMIT_FILE_NAME);
  if (raw === null || raw.length === 0) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 0) return asNum;
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return ms;
  return null;
}

function writeBroadLastEmit(projectRoot, nowMs) {
  // Silent — sidecar failure must never block session start.
  writeTextState(projectRoot, HINT_BROAD_LAST_EMIT_FILE_NAME, String(nowMs));
}

/**
 * Classify the on-disk import lifecycle by reading
 * `.fabric/.import-state.json`. Returns one of:
 *   - 'absent'      — state file missing → user has NEVER started import
 *   - 'in_progress' — file present, phase is anything that is not 'complete'
 *                     (covers 'P1-done', 'P2-done', 'phase 1', 'in_progress',
 *                     '1', and any other live-import marker)
 *   - 'complete'    — file present and phase === 'complete'
 *   - 'error'       — file present but unreadable / unparseable JSON
 *
 * Recommendation rule (see shouldRecommendImport): only 'absent' triggers a
 * banner — both 'in_progress' (user is actively importing) and 'complete'
 * (user already imported) suppress the banner. 'error' also suppresses
 * (defensive: do not nag when state is unreadable, the user has clearly
 * touched the file).
 */
function isImportTouched(projectRoot) {
  const statePath = join(projectRoot, FABRIC_DIR_REL, IMPORT_STATE_FILE);
  if (!existsSync(statePath)) return "absent";
  let raw;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch {
    return "error";
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "error";
  }
  if (!parsed || typeof parsed !== "object") return "error";
  return parsed.phase === "complete" ? "complete" : "in_progress";
}

/**
 * rc.8 underseed self-check: determine whether the SessionStart hook should
 * surface the one-line `/fabric-import` recommendation banner.
 *
 * Three-condition truth table (ALL must hold to return true):
 *   1. the workspace is fabric-bound — readWorkspaceBindingId(cwd) !== null
 *      (a resolved binding id in fabric-config.json; otherwise the
 *       recommendation is meaningless — `fabric-import` requires a bound
 *       workspace. Store-only: replaces the legacy derived-index-file
 *       existence probe.)
 *   2. countCanonicalNodes(cwd) < readUnderseedThreshold(cwd)
 *      (knowledge graph is sparse — import would meaningfully enrich it).
 *   3. isImportTouched(cwd) === 'absent'
 *      (.import-state.json is missing entirely; user has neither started
 *       nor completed an import. ANY phase value — including 'in_progress'
 *       and 'complete' — returns false because the user has either started
 *       or finished.)
 *
 * Best-effort: any unexpected error → return false (do not nag on faults).
 */
function shouldRecommendImport(projectRoot) {
  try {
    if (readWorkspaceBindingId(projectRoot) === null) return false;

    const threshold = readUnderseedThreshold(projectRoot);
    const nodeCount = countCanonicalNodes(projectRoot);
    if (nodeCount >= threshold) return false;

    if (isImportTouched(projectRoot) !== "absent") return false;

    return true;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// CONSTANTS
// -----------------------------------------------------------------------------

// Per-type truncation triggers when total broad-scope entries > N.
// v2.0.0-rc.29 TASK-007 (BUG-F1): lowered from 30 → 12. SessionStart hint
// should bias toward "is there anything relevant?" rather than "exhaustive
// index" — at 30, the banner consumed several terminal screens on
// well-seeded repos and operators reported scroll fatigue. 12 keeps a
// dense-enough scan (still fits "top hits per type" in 1-2 screenfuls)
// without prompting the user to mentally truncate themselves. The constant
// stays a stable rendering boundary; downstream consumers (banner-i18n.cjs,
// truncation summary lines) consume it as a single source of truth.
const TRUNCATION_THRESHOLD = 12;

// `fabric plan-context-hint` is a thin wrapper over planContext(); on a
// well-seeded repo it returns in ~100ms. Two-second cap is defensive — any
// pathological hang must not stall session start.
const CLI_TIMEOUT_MS = 2000;

// Maximum summary length per entry. Keeps each line bounded so stderr does
// not blow up terminal width with multi-paragraph summaries from sloppy
// pending entries. Truncation appends an ellipsis. v2.0.0-rc.33 W4-A3:
// `hint_summary_max_len` in fabric-config overrides this default (range 40..240).
const DEFAULT_SUMMARY_MAX_LEN = 80;

// v2.2 HK2-degrade (W2-T2): char budget for the rendered broad-menu BODY. The
// hook already degrades by COUNT (hint_broad_top_k slice + TRUNCATION_THRESHOLD
// grouped mode), but nothing bounded the total rendered SIZE — a corpus with
// many types or long (near-maxLen) summaries could still emit a wall of text
// that displaces the agent's working memory. Borrowing the maestro
// context-budget idea, this is the final rung of the degradation ladder: once
// the body exceeds the budget, the tail collapses to a single "N more omitted"
// marker. Default 2000 chars ≈ one screenful. Overridable via
// fabric-config.json#hint_broad_budget_chars (range 200..20000); 0 disables.
const DEFAULT_HINT_BROAD_BUDGET_CHARS = 2000;

// v2.2 C5-budget (W2-T3): bind the injection char budget to the layered retrieval
// budget profile. Mirrors the injectionChars column of shared/retrieval-budget.ts
// PROFILES (kept in sync — the hook cannot require the TS resolver). The explicit
// `hint_broad_budget_chars` knob still wins; the profile only supplies the
// default. `balanced` (and an absent/unknown profile) keeps the historical 2000.
const RETRIEVAL_BUDGET_INJECTION_CHARS = {
  conservative: 1000,
  balanced: 2000,
  generous: 4000,
};

function readBroadBudgetChars(projectRoot) {
  const profile = readConfigString(projectRoot, "retrieval_budget_profile", "balanced");
  const profileDefault =
    RETRIEVAL_BUDGET_INJECTION_CHARS[profile] ?? DEFAULT_HINT_BROAD_BUDGET_CHARS;
  return readConfigNumber(projectRoot, "hint_broad_budget_chars", profileDefault, {
    min: 0,
    max: 20000,
    floor: true,
  });
}

// v2.2 HK2-degrade (W2-T2): cap the rendered body to `budgetChars`, collapsing
// the overflow tail into one marker line. Structural lines (banner, revision_hash,
// footer) are appended by renderSummary AFTER this pass, so they always survive —
// only entry/group body lines are subject to the budget. `budgetChars` of 0 or
// undefined is a no-op (preserves the pre-HK2 unbounded behavior and all
// existing snapshot tests).
function capBodyToBudget(body, budgetChars) {
  if (!budgetChars || budgetChars <= 0) return body;
  const kept = [];
  let total = 0;
  for (let i = 0; i < body.length; i += 1) {
    const line = body[i];
    // +1 for the newline each line costs once joined.
    if (kept.length > 0 && total + line.length + 1 > budgetChars) {
      const remaining = body.length - i;
      kept.push(
        `  … ${remaining} more entr${remaining === 1 ? "y" : "ies"} omitted (injection budget ${budgetChars} chars; raise hint_broad_budget_chars or narrow scope)`,
      );
      return kept;
    }
    kept.push(line);
    total += line.length + 1;
  }
  return kept;
}

function readSummaryMaxLen(projectRoot) {
  return readConfigNumber(projectRoot, "hint_summary_max_len", DEFAULT_SUMMARY_MAX_LEN, {
    min: 40,
    max: 240,
    floor: true,
  });
}

// Canonical type order — render groups in this sequence so output is stable
// across runs (Object.keys iteration order is insertion order, but the JSON
// payload may shuffle if planContext's internal sort changes). Unknown types
// are appended after canonical types in encounter order.
const CANONICAL_TYPE_ORDER = [
  "decision",
  "pitfall",
  "guideline",
  "model",
  "process",
];

// Canonical maturity order for truncation rendering. proven is the highest-
// signal tier so it gets full per-line treatment; verified gets id-list; draft
// gets count-only. Unknown maturities fall through to the verified bucket.
const MATURITY_PROVEN = "proven";
const MATURITY_VERIFIED = "verified";
const MATURITY_DRAFT = "draft";

// rc.8 underseed self-check banner: single line, emoji-prefixed (cf.
// fabric-hint.cjs Signal C `📋 Fabric:`). rc.16 TASK-003 routed the literal
// through the banner-i18n lib (key: 'broadImportBanner') — see main() below
// for the renderBanner call site. Substring contracts preserved across all
// variants: leading two-space indent, `📋 Fabric:` prefix, `/fabric-import`
// verbatim token (asserted by knowledge-hint-broad.test.ts).

// -----------------------------------------------------------------------------
// CLI invocation
// -----------------------------------------------------------------------------

/**
 * Spawn `fabric plan-context-hint --all` and return parsed JSON. Returns
 * null on any failure (ENOENT, non-zero exit, malformed JSON). Never throws.
 *
 * If `fabric` is not on PATH, return null — the hook stays silent rather
 * than nagging about install state.
 */
function invokePlanContextHint(cwd) {
  const candidates = ["fabric"];
  // rc.31 NEW-6: capture the last meaningful failure so we can surface it on
  // stderr before fail-open. Without this, hook silently swallows backend
  // crashes (e.g. agents_meta_invalid → plan-context-hint exits with stderr
  // payload and the AI / user never sees KB chain is dead).
  let lastFailure = null;
  for (const bin of candidates) {
    let res;
    try {
      res = spawnSync(bin, ["plan-context-hint", "--all"], {
        cwd,
        encoding: "utf8",
        timeout: CLI_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      continue; // spawn throw (extremely rare) — try next candidate
    }
    // ENOENT surfaces as error on the result object. Skip silently for ENOENT
    // (bin not installed is the only legitimate reason to bail).
    if (res.error) {
      if (res.error.code !== "ENOENT") {
        lastFailure = { bin, reason: String(res.error.message || res.error.code || res.error) };
      }
      continue;
    }
    if (res.status === null || res.status !== 0) {
      const stderrSnip = (res.stderr || "").trim().slice(0, 240);
      if (stderrSnip.length > 0) {
        lastFailure = { bin, reason: stderrSnip };
      }
      continue;
    }
    const raw = (res.stdout || "").trim();
    if (raw.length === 0) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (err) {
      lastFailure = { bin, reason: `malformed JSON from plan-context-hint: ${String(err && err.message || err)}` };
    }
  }
  if (lastFailure !== null) {
    // Single warning line — never throws, never blocks the hook. Lets users /
    // AI notice that the KB chain is degraded instead of being silently empty.
    process.stderr.write(
      `[fabric-hint] plan-context-hint (${lastFailure.bin}) failed: ${lastFailure.reason.replace(/\n/g, " ")}\n`,
    );
  }
  return null;
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

/**
 * Group narrow entries by type (preserving canonical order), then by maturity
 * within each type. Returns { typeOrder: string[], byType: Map<type, Map<maturity, entries[]>> }.
 */
function groupEntries(narrow) {
  const byType = new Map();
  const encounterOrder = [];

  for (const entry of narrow) {
    const type = entry.type || "unknown";
    if (!byType.has(type)) {
      byType.set(type, new Map());
      encounterOrder.push(type);
    }
    const maturity = entry.maturity || "unknown";
    const maturityMap = byType.get(type);
    if (!maturityMap.has(maturity)) maturityMap.set(maturity, []);
    maturityMap.get(maturity).push(entry);
  }

  // Stable type order: canonical types first (when present), then anything
  // else in encounter order.
  const typeOrder = [];
  for (const t of CANONICAL_TYPE_ORDER) {
    if (byType.has(t)) typeOrder.push(t);
  }
  for (const t of encounterOrder) {
    if (!CANONICAL_TYPE_ORDER.includes(t)) typeOrder.push(t);
  }

  return { typeOrder, byType };
}

// v2.0.0-rc.33 W4-A3: maxLen is now caller-supplied (sourced from
// fabric-config#hint_summary_max_len in main; tests + ad-hoc callers may
// omit to fall back to DEFAULT_SUMMARY_MAX_LEN).
function truncateSummary(raw, maxLen) {
  const s = typeof raw === "string" ? raw : "";
  // Collapse newlines / runs of whitespace so each entry fits one line.
  const flat = s.replace(/\s+/g, " ").trim();
  const cap = typeof maxLen === "number" && maxLen > 0 ? maxLen : DEFAULT_SUMMARY_MAX_LEN;
  if (flat.length <= cap) return flat;
  return `${flat.slice(0, cap - 1)}…`;
}

function formatEntryLine(entry, maxLen) {
  const id = entry.id || "(no-id)";
  const summary = truncateSummary(entry.summary, maxLen);
  // lifecycle-refactor W3-T2 (§7 图谱消费 / §5 hook 沿 related 二阶召回): when this
  // entry was pulled in by following a surfaced entry's `related` graph edge,
  // tag the line with its provenance so the agent knows it arrived via the graph,
  // not its own ranking. Omitted entirely for ordinarily-ranked entries — no fake
  // "related" annotation is ever synthesized (graph-empty honesty).
  const provenance =
    typeof entry.related_to === "string" && entry.related_to.length > 0
      ? ` (related-to-${entry.related_to})`
      : "";
  return summary.length > 0
    ? `    - ${id} · ${summary}${provenance}`
    : `    - ${id}${provenance}`;
}

/**
 * Render full per-type listing — used when total narrow entries <= 30.
 * Each entry gets one line: `    - <id> · <summary>`. Type/maturity headers
 * group the listing.
 */
function renderFull(narrow, maxLen) {
  const { typeOrder, byType } = groupEntries(narrow);
  const lines = [];
  for (const type of typeOrder) {
    const maturityMap = byType.get(type);
    // Within each type, render maturity buckets in proven > verified > draft
    // > unknown order so the most-trusted entries surface first.
    const maturities = [];
    for (const m of [MATURITY_PROVEN, MATURITY_VERIFIED, MATURITY_DRAFT]) {
      if (maturityMap.has(m)) maturities.push(m);
    }
    for (const m of maturityMap.keys()) {
      if (![MATURITY_PROVEN, MATURITY_VERIFIED, MATURITY_DRAFT].includes(m)) {
        maturities.push(m);
      }
    }
    for (const maturity of maturities) {
      lines.push(`  [${type}] (${maturity}):`);
      for (const entry of maturityMap.get(maturity)) {
        lines.push(formatEntryLine(entry, maxLen));
      }
    }
  }
  return lines;
}

/**
 * Render grouped truncation — used when total narrow entries > 30. Per the
 * task spec: proven entries get full per-line treatment; verified entries get
 * an inline id list (no summary); draft (and unknown) buckets collapse to a
 * count.
 */
function renderTruncated(narrow, maxLen) {
  const { typeOrder, byType } = groupEntries(narrow);
  const lines = [];
  for (const type of typeOrder) {
    const maturityMap = byType.get(type);

    // Proven: full per-line listing.
    const proven = maturityMap.get(MATURITY_PROVEN);
    if (proven && proven.length > 0) {
      lines.push(`  [${type}] proven (${proven.length}):`);
      for (const entry of proven) {
        lines.push(formatEntryLine(entry, maxLen));
      }
    }

    // Verified: inline id list.
    const verified = maturityMap.get(MATURITY_VERIFIED);
    if (verified && verified.length > 0) {
      const ids = verified.map((e) => e.id || "(no-id)").join(", ");
      lines.push(`  [${type}] verified (${verified.length}): ${ids}`);
    }

    // Draft + any unknown maturity: count-only.
    let countOnly = 0;
    for (const [maturity, entries] of maturityMap.entries()) {
      if (maturity === MATURITY_PROVEN || maturity === MATURITY_VERIFIED) continue;
      countOnly += entries.length;
    }
    if (countOnly > 0) {
      lines.push(`  [${type}] draft: ${countOnly} entries`);
    }
  }
  return lines;
}

/**
 * Top-level rendering — picks the mode based on entry count and prepends the
 * session-start banner + appends the revision_hash and usage hint footers.
 *
 * Returns an array of lines (one stderr write per line keeps the formatter
 * trivial and testable). Returns [] when there is nothing meaningful to say
 * (empty entries set) so callers know to stay silent.
 *
 * Protocol v2 gate (rc.18): payloads must carry `version: 2`. A null/missing
 * payload returns [] silently; a payload with a mismatched `version` returns []
 * after writing exactly one stderr breadcrumb so operators grepping a stuck-
 * banner report can diagnose the version drift without source-diving.
 */
function renderSummary(payload, maxLen, budgetChars) {
  if (!payload || payload.version !== 2) {
    if (payload && payload.version !== undefined) {
      try {
        process.stderr.write(
          `[fabric] hint payload version=${payload.version} unsupported (expected 2), skipping\n`,
        );
      } catch {}
    }
    return [];
  }
  // Protocol v2 (rc.18): the wire field is now `payload.entries`, matching what
  // this renderer always called it locally. The historical `narrow` name (which
  // degenerated in --all mode) has been retired without a compat shim per
  // pre-user clean-slate policy.
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  if (entries.length === 0) return [];

  const truncated = entries.length > TRUNCATION_THRESHOLD;
  const banner = truncated
    ? `[fabric] Session start — ${entries.length} broad-scoped knowledge entries available (truncated):`
    : `[fabric] Session start — ${entries.length} broad-scoped knowledge entries available:`;

  const renderedBody = truncated ? renderTruncated(entries, maxLen) : renderFull(entries, maxLen);
  // v2.2 HK2-degrade (W2-T2): final budget rung — cap the body's rendered size.
  const body = capBodyToBudget(renderedBody, budgetChars);

  const lines = [banner, ...body];
  const revHash = typeof payload.revision_hash === "string" ? payload.revision_hash : null;
  if (revHash !== null && revHash.length > 0) {
    lines.push(`  revision_hash: ${revHash}`);
  }

  // rc.22 Scope D T-D4 (TASK-011): meta auto-refresh breadcrumb. Emitted ONLY
  // when the server's planContext() detected meta drift and rebuilt the meta
  // in-place (auto_healed === true). One informational line — operators need
  // a paper trail when revision_hash flips mid-session.
  //
  // Variant resolution:
  //   - Both hashes present → full transition line (`sha PREV → CUR`) with
  //     8-char hex prefixes stripped of the `sha256:` scheme prefix.
  //   - auto_healed:true but previous_revision_hash missing → generic line
  //     (T10 noted the server may emit `auto_healed:true` alone if it lost
  //     the prior hash for any reason). Stays informational.
  //
  // i18n: routed through renderBanner so zh-CN / en / zh-CN-hybrid variants
  // share one call site. fabric_language is resolved via readFabricLanguage()
  // ONLY when the line is actually emitted (keeps the no-banner path free of
  // the extra config read, matching the broadImportBanner site below).
  if (payload.auto_healed === true) {
    const variant = readFabricLanguage(process.cwd());
    const prevRaw =
      typeof payload.previous_revision_hash === "string"
        ? payload.previous_revision_hash
        : null;
    const curRaw =
      typeof payload.revision_hash === "string" ? payload.revision_hash : null;
    if (prevRaw && curRaw) {
      // Strip optional `sha256:` scheme prefix, then take first 8 hex chars.
      const stripScheme = (h) =>
        h.startsWith("sha256:") ? h.slice("sha256:".length) : h;
      const prev = stripScheme(prevRaw).slice(0, 8);
      const cur = stripScheme(curRaw).slice(0, 8);
      lines.push(
        renderBanner("metaAutoRefreshedBanner", variant, { prev, cur }),
      );
    } else {
      // Defensive: auto_healed:true but no usable previous hash → generic line.
      lines.push(renderBanner("metaAutoRefreshedBannerGeneric", variant, {}));
    }
  }

  // v2.2 MC3-fix-guidance (W1-T5): unify the footer with the canonical recall
  // flow. The prior text ("Use `fab_get_knowledge_sections` to fetch full
  // content.") told the agent to call a tool that REQUIRES a selection_token it
  // does not yet have — directly contradicting the bilingual next-step nudge
  // (and AGENTS.md) which leads with `fab_recall`. Footer now states the same
  // two-path model: single-step `fab_recall`, or `fab_plan_context` →
  // `fab_get_knowledge_sections` when the bodies must be trimmed first. Keeps
  // the `fab_get_knowledge_sections` token (downstream substring contracts) but
  // sequences it correctly behind the token-issuing `fab_plan_context`.
  lines.push(
    "  Load full content: `fab_recall(paths)` (one step), or `fab_plan_context` → `fab_get_knowledge_sections` to trim first.",
  );
  return lines;
}

// -----------------------------------------------------------------------------
// v2.2 dual-sink (Goal A): two-sink SessionStart rendering.
//
// HUMAN sink (systemMessage): a grouped census (§3 / D8) — always-loaded vs
// on-demand split + [team]/[personal] + ✗ dropped-other-project. Count-summary
// form (not a per-entry wall of text); the verbose nudge_mode appends the legacy
// per-entry renderSummary listing on top.
//
// AI sink (additionalContext): the always-active (guideline/model) BODIES (§3 /
// D9), bounded by the injection char budget with overflow degrading to summary +
// a recall pointer, followed by on-demand category counts. Replaces the legacy
// top_k=8 id-list that used to be the AI payload.
// -----------------------------------------------------------------------------

// Singular display label for a plural knowledge_type.
const TYPE_SINGULAR = {
  decisions: "decision",
  pitfalls: "pitfall",
  guidelines: "guideline",
  models: "model",
  processes: "process",
};

const ALWAYS_TYPES = ["guidelines", "models"];
const ONDEMAND_TYPES = ["decisions", "pitfalls", "processes"];

// Normalize a knowledge_type to its canonical PLURAL form. Frontmatter / entries
// may carry the singular ("decision") while the census keys on the plural enum
// ("decisions"); fold both so counting + display stay consistent.
const TYPE_TO_PLURAL = {
  decision: "decisions",
  pitfall: "pitfalls",
  guideline: "guidelines",
  model: "models",
  process: "processes",
};
function toPluralType(type) {
  return TYPE_TO_PLURAL[type] || type;
}

// Fallback census when payload.census is absent (old CLI / unit-test payloads):
// count the (possibly sliced) entries by knowledge_type so the human banner still
// has something to group. Production payloads always carry the unsliced census.
function deriveCensusFromEntries(entries) {
  const census = { by_type: {}, by_layer: { team: 0, personal: 0 }, dropped_other_project: 0, total: 0 };
  if (!Array.isArray(entries)) return census;
  for (const e of entries) {
    const type = e && typeof e.type === "string" ? toPluralType(e.type) : null;
    if (type === null) continue;
    census.by_type[type] = (census.by_type[type] || 0) + 1;
    census.total += 1;
  }
  return census;
}

// Render the human-facing grouped census (§3). `lang` is "zh-CN" | other (en).
// Returns an array of lines (may be empty when the census is empty).
function renderHumanCensus(census, opts) {
  const { lang } = opts || {};
  const c = census || {};
  const byType = c.by_type || {};
  const total = typeof c.total === "number" ? c.total : 0;
  if (total === 0 && (c.dropped_other_project || 0) === 0) return [];
  const zh = lang === "zh-CN";

  const typeCounts = (types) =>
    types
      .filter((t) => (byType[t] || 0) > 0)
      .map((t) => `${TYPE_SINGULAR[t] || t} ${byType[t]}`)
      .join(" · ");

  const lines = [];
  lines.push(`▸ [fabric] SessionStart (${total} KB)`);
  const alwaysCounts = typeCounts(ALWAYS_TYPES);
  lines.push(zh ? "  ─ always-loaded(AI 也收到正文)─" : "  ─ always-loaded (AI also gets bodies) ─");
  lines.push(`   ${alwaysCounts.length > 0 ? alwaysCounts : zh ? "(无)" : "(none)"}`);
  const ondemandCounts = typeCounts(ONDEMAND_TYPES);
  lines.push(zh ? "  ─ on-demand(改文件时 fab_recall)─" : "  ─ on-demand (fab_recall when editing) ─");
  lines.push(`   ${ondemandCounts.length > 0 ? ondemandCounts : zh ? "(无)" : "(none)"}`);
  const layer = c.by_layer || {};
  if ((layer.team || 0) > 0 || (layer.personal || 0) > 0) {
    lines.push(`  [team] ${layer.team || 0} · [personal] ${layer.personal || 0}`);
  }
  const dropped = c.dropped_other_project || 0;
  if (dropped > 0) {
    lines.push(zh ? `  ✗ 已剔除他项目 ${dropped} 条` : `  ✗ dropped ${dropped} other-project entr${dropped === 1 ? "y" : "ies"}`);
  }
  return lines;
}

// Render the AI-facing sink (§3): always-active bodies (bounded by budgetChars,
// overflow degrading to summary + recall pointer) + on-demand category counts.
// `alwaysBodies` is the plan-context-hint always_bodies[] ({id,type,layer,summary,body}).
function renderAiSink(opts) {
  const { census, alwaysBodies, storeLabel, budgetChars, lang } = opts || {};
  const zh = lang === "zh-CN";
  const bodies = Array.isArray(alwaysBodies) ? alwaysBodies : [];
  const byTypeAll = (census && census.by_type) || {};
  const ondemandTotal = ONDEMAND_TYPES.reduce((n, t) => n + (byTypeAll[t] || 0), 0);
  // Nothing to inject (no always-active bodies AND no on-demand knowledge) →
  // empty so main() stays silent on an empty knowledge base.
  if (bodies.length === 0 && ondemandTotal === 0) return "";
  const lines = [];
  lines.push(`[fabric:SessionStart] ${storeLabel || "store"}`);

  // ALWAYS-ACTIVE RULES — inject bodies up to the budget, degrade the tail.
  lines.push(zh ? "ALWAYS-ACTIVE RULES (无需再 recall):" : "ALWAYS-ACTIVE RULES (no recall needed):");
  if (bodies.length === 0) {
    lines.push(zh ? "  (无 always-active 条目)" : "  (none)");
  } else {
    const budget = typeof budgetChars === "number" && budgetChars > 0 ? budgetChars : 0;
    let used = 0;
    let degraded = false;
    for (const b of bodies) {
      const label = `[${TYPE_SINGULAR[b.type] || b.type}] ${b.id}`;
      const body = typeof b.body === "string" ? b.body.trim() : "";
      const summary = typeof b.summary === "string" ? b.summary : "";
      const fullCost = label.length + body.length + 2;
      if (!degraded && (budget === 0 || used + fullCost <= budget)) {
        lines.push(`  ${label}`);
        if (body.length > 0) lines.push(body);
        used += fullCost;
      } else {
        // Budget exceeded → degrade this + remaining to summary + recall pointer.
        degraded = true;
        lines.push(
          `  ${label} · ${summary}${zh ? " (超预算; fab_recall 取正文)" : " (over budget; fab_recall for body)"}`,
        );
      }
    }
  }

  // ON-DEMAND category counts.
  const byType = (census && census.by_type) || {};
  const ondemand = ONDEMAND_TYPES.filter((t) => (byType[t] || 0) > 0)
    .map((t) => `${t} ${byType[t]}`)
    .join(" · ");
  lines.push(
    zh
      ? `ON-DEMAND (改文件时 fab_recall(paths)): ${ondemand || "(无)"}`
      : `ON-DEMAND (fab_recall(paths) when editing): ${ondemand || "(none)"}`,
  );
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Main entry — invoked both as a CLI (require.main === module) and in-process
// by tests. Wraps the entire flow in try/catch: ANY error → silent exit 0.
// -----------------------------------------------------------------------------

function main(env, stdio) {
  try {
    const cwd = (env && env.cwd) || process.cwd();
    const now = (env && env.now) || new Date();
    const nowMs = now instanceof Date ? now.getTime() : Number(now);
    const err = (stdio && stdio.stderr) || process.stderr;
    const out = (stdio && stdio.stdout) || process.stdout;

    // v2.0.0-rc.33 W2-5 (P1-8): cooldown gate. When configured > 0 hours, the
    // broad banner stays silent for that many hours after a successful emit.
    // 0 (default) preserves rc.32 behavior — every SessionStart re-fires the
    // banner. Test seam env.skipCooldown bypasses for unit tests.
    const cooldownHours = readBroadCooldownHours(cwd);
    if (cooldownHours > 0 && !(env && env.skipCooldown === true)) {
      const lastEmitMs = readBroadLastEmit(cwd);
      if (
        typeof lastEmitMs === "number" &&
        // rc.34 TASK-01 + review-fix (Gemini P1): when lastEmit is in the
        // FUTURE relative to now (backward clock skew — NTP sync /
        // suspend-wake / TZ change), the gate fires immediately. Otherwise
        // standard cooldown check. Math.max(0, …) was a no-op (silent for
        // cooldown + |skew| under both formulations); this guard actually
        // heals the skew on the next invocation by treating future-stamped
        // sidecar as "expired."
        nowMs >= lastEmitMs &&
        nowMs - lastEmitMs < cooldownHours * MS_PER_HOUR
      ) {
        return; // still in cooldown — silent
      }
    }

    // Test seam: env.payload short-circuits the CLI spawn so unit tests can
    // feed canned plan-context-hint JSON without depending on a built CLI.
    const payload =
      env && env.payload !== undefined ? env.payload : invokePlanContextHint(cwd);
    if (payload === null || payload === undefined) return; // silent

    // v2.0.0-rc.33 W2-1 (P0-9): apply TopK slice BEFORE renderSummary so the
    // grouped/truncation rendering operates on the bounded set. Slicing here
    // (not inside renderSummary) keeps the formatter pure — it never has to
    // know about the cap.
    const topK = readBroadTopK(cwd);
    const slicedPayload =
      payload && Array.isArray(payload.entries) && payload.entries.length > topK
        ? { ...payload, entries: payload.entries.slice(0, topK) }
        : payload;

    // rc.35 TASK-06 (P0-10.b): summary-fallback substitution. Entries whose
    // description.summary equals stable_id render as "<id> · <id>" and the
    // AI skips fetching them; the fallback reads `## Summary` from the
    // entry's .md file and swaps in the first paragraph. Best-effort —
    // failure leaves the original opaque summary untouched.
    let resolvedPayload = slicedPayload;
    try {
      if (slicedPayload && Array.isArray(slicedPayload.entries)) {
        const resolvedEntries = resolveOpaqueSummaries(
          slicedPayload.entries,
          cwd,
          typeof slicedPayload.revision_hash === "string" ? slicedPayload.revision_hash : "",
        );
        resolvedPayload = { ...slicedPayload, entries: resolvedEntries };
      }
    } catch {
      // resolveOpaqueSummaries swallows its own errors; this catch is belt
      // + suspenders for any unexpected exception from the lib layer.
    }

    // rc.8 underseed self-check: decide whether to surface the one-line
    // `/fabric-import` recommendation banner alongside the broad summary.
    const recommendImport = shouldRecommendImport(cwd);

    // rc.12: broad-summary body is unconditionally rendered on every
    // SessionStart fire (Skill-style progressive disclosure). The prior
    // revision_hash cooldown gate (rc.7 T8 — rc.11) was removed because
    // compact/clear-triggered SessionStart re-fires must re-inject the menu
    // for the agent's working memory. rc.33 W2-5 reintroduces an opt-in
    // hours-based cooldown via fabric-config (see gate above).
    const summaryMaxLen = readSummaryMaxLen(cwd);
    // v2.2 HK2-degrade (W2-T2): thread the injection char-budget into the renderer.
    const broadBudgetChars = readBroadBudgetChars(cwd);

    // v2.0.0-rc.37 NEW-23: resolve fabric_language ONCE per emit path.
    const fabricLanguageForEmit = readFabricLanguage(cwd);

    // v2.2 dual-sink (Goal A): census drives the human grouped banner; always_bodies
    // drives the AI sink. Both come from the plan-context-hint payload; tests /
    // old CLIs lacking them fall back gracefully (census derived from entries).
    const census =
      env && env.census !== undefined
        ? env.census
        : payload && payload.census
          ? payload.census
          : deriveCensusFromEntries(resolvedPayload && resolvedPayload.entries);
    const alwaysBodies =
      env && env.alwaysBodies !== undefined
        ? env.alwaysBodies
        : payload && Array.isArray(payload.always_bodies)
          ? payload.always_bodies
          : [];

    // v2.2 dual-sink (Goal A / D4): resolve the human-output gate. nudge_mode only
    // adjusts the human systemMessage — the AI sink is emitted regardless (D5).
    const humanGate =
      nudgePolicy !== null
        ? nudgePolicy.resolveHumanSink(cwd, "session_start", {})
        : { emitHuman: true, verbosity: "normal" };

    // ---- HUMAN sink: §3 grouped census (+ verbose per-entry detail). ----
    const humanLines = renderHumanCensus(census, { lang: fabricLanguageForEmit });
    if (humanLines.length > 0 && humanGate.verbosity === "verbose") {
      // verbose nudge_mode: append the legacy per-entry listing under the census.
      const detail = renderSummary(resolvedPayload, summaryMaxLen, broadBudgetChars);
      humanLines.push(...detail);
    }
    // v2.1.0-rc.1 P4 (F4/S63): per-store read-set label (which stores are read /
    // where writes land). Best-effort; a missing snapshot omits the line.
    if (bindingsSnapshotReader !== null && humanLines.length > 0) {
      try {
        const bindingId = readWorkspaceBindingId(cwd);
        if (bindingId) {
          const label = bindingsSnapshotReader.formatStoreLabels(
            bindingsSnapshotReader.readBindingsSnapshot(bindingId),
          );
          if (label) humanLines.push(label);
        }
      } catch {
        // store labels are decorative provenance — never crash the hook
      }
    }
    // rc.8 underseed self-check: one-line `/fabric-import` recommendation banner.
    if (recommendImport && humanLines.length > 0 && fabricLanguageForEmit !== null) {
      humanLines.push(renderBanner("broadImportBanner", fabricLanguageForEmit, {}));
    }
    // v2.0.0-rc.37 NEW-23: SessionStart "next step" guidance.
    if (humanLines.length > 0) {
      humanLines.push(
        fabricLanguageForEmit === "zh-CN"
          ? "下一步: 调 fab_recall(paths) 拿 KB 相关条目;或调 fab_plan_context 先看候选描述(candidates)。"
          : "Next: call fab_recall(paths) to fetch related KB entries, or fab_plan_context to preview the candidate descriptions first.",
      );
    }

    // ---- AI sink: §3 always-active bodies + on-demand counts. ----
    const aiText = renderAiSink({
      census,
      alwaysBodies,
      budgetChars: broadBudgetChars,
      lang: fabricLanguageForEmit,
    });

    // Nothing to say at all → silent exit (preserves the empty-payload contract).
    if (humanLines.length === 0 && (!aiText || aiText.length === 0)) return;

    // v2.2 dual-sink (Goal A / D7): emit both channels in one render. The human
    // systemMessage is gated by nudge_mode (emitHuman); the AI additionalContext
    // is emitted regardless. emitDualSink shapes the protocol per client (CC/Codex
    // camelCase nested envelope; Cursor flat snake_case; unknown → stderr).
    const human = humanGate.emitHuman && humanLines.length > 0 ? humanLines.join("\n") : null;
    const reminderToContext = readReminderToContext(cwd);
    const ai = reminderToContext && aiText && aiText.length > 0 ? aiText : null;
    if (!(env && env.skipStdout === true)) {
      emitDualSink(
        { human, ai },
        { client: detectClient(), eventName: "SessionStart", streams: { stdout: out, stderr: err } },
      );
    } else if (human !== null) {
      // skipStdout test seam: still surface the human breadcrumb to stderr.
      err.write(`${human}\n`);
    }

    // v2.2 HK3-telemetry (W3-T1): record the injection side. We just OFFERED the
    // agent `resolvedPayload.entries` (the top_k-sliced broad menu); log their
    // ids so the true hit rate (consumed ÷ injected) is computable against the
    // consumption-side metrics.jsonl. Best-effort — never affects the emit.
    if (injectionLog !== null) {
      const injectedEntries = Array.isArray(resolvedPayload && resolvedPayload.entries)
        ? resolvedPayload.entries
        : [];
      injectionLog.logInjection(cwd, {
        surface: "broad",
        stableIds: injectedEntries.map((e) => (e && e.id) || "").filter(Boolean),
        count: injectedEntries.length,
        revisionHash:
          resolvedPayload && typeof resolvedPayload.revision_hash === "string"
            ? resolvedPayload.revision_hash
            : null,
        ts: nowMs,
      });
    }

    // v2.2 dual-sink (Goal A): the legacy rc.33 W2-6 stdout JSON envelope is
    // replaced by emitDualSink above (which carries BOTH the human systemMessage
    // and the AI additionalContext, shaped per client). hint_reminder_to_context
    // still gates whether the AI sink is populated (see `ai` above).

    // v2.1 NEW-N-3 (ADJ-NEWN-3): hook_surface_emitted instrumentation. One
    // best-effort ledger row recording WHICH broad-scoped ids were surfaced
    // into the session — the join key for measuring hook→behavior delta (did
    // the agent fab_recall what the hook surfaced?). SessionStart fires once
    // per session boot so this never bloats the ledger. Never blocks the hook
    // (KT-DEC-0007): any failure (no .fabric/, undetected client, write error)
    // degrades to silent skip. Client is omitted-by-skip when undetectable
    // because the schema's `client` enum admits only cc/codex/cursor.
    try {
      const surfaceClient = detectClient();
      const fabricDir = join(cwd, FABRIC_DIR_REL);
      if (surfaceClient !== undefined && existsSync(fabricDir)) {
        const renderedIds =
          resolvedPayload && Array.isArray(resolvedPayload.entries)
            ? resolvedPayload.entries
                .map((e) => (e && typeof e.id === "string" ? e.id : null))
                .filter((x) => x !== null)
            : [];
        let idSuffix;
        try {
          idSuffix = require("node:crypto").randomUUID();
        } catch {
          idSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        }
        const surfaceEvent = {
          kind: "fabric-event",
          id: `event:${idSuffix}`,
          ts: Date.now(),
          schema_version: 1,
          event_type: "hook_surface_emitted",
          hook_name: "knowledge-hint-broad",
          client: surfaceClient,
          target_channel: reminderToContext ? "stdout-additionalContext" : "stderr",
          rendered_ids: renderedIds,
          delivery_status: "delivered",
        };
        appendLockedLine(join(fabricDir, "events.jsonl"), JSON.stringify(surfaceEvent) + "\n");
      }
    } catch {
      // best-effort telemetry — never block session start
    }

    // v2.0.0-rc.33 W2-5 (P1-8): record successful emit timestamp for the
    // cooldown gate's next-invocation check. Skip when cooldown is disabled
    // (cooldownHours === 0) to avoid polluting the FS with a never-read
    // sidecar on rc.32-style "no cooldown" workspaces.
    if (cooldownHours > 0 && !(env && env.skipCooldownWrite === true)) {
      writeBroadLastEmit(cwd, nowMs);
    }
  } catch {
    // Silent — never block session start on hook failure.
  }
}

module.exports = {
  main,
  invokePlanContextHint,
  groupEntries,
  renderFull,
  renderTruncated,
  renderSummary,
  truncateSummary,
  // rc.8 underseed self-check helpers (exported for unit testing).
  countCanonicalNodes,
  readUnderseedThreshold,
  isImportTouched,
  shouldRecommendImport,
  // v2.0.0-rc.33 W2-1 / W2-5 / W2-6 helpers.
  readBroadTopK,
  readBroadCooldownHours,
  readReminderToContext,
  readBroadLastEmit,
  writeBroadLastEmit,
  readSummaryMaxLen,
  CONSTANTS: {
    TRUNCATION_THRESHOLD,
    CLI_TIMEOUT_MS,
    SUMMARY_MAX_LEN: DEFAULT_SUMMARY_MAX_LEN,
    DEFAULT_SUMMARY_MAX_LEN,
    CANONICAL_TYPE_ORDER,
    MATURITY_PROVEN,
    MATURITY_VERIFIED,
    MATURITY_DRAFT,
    DEFAULT_UNDERSEED_NODE_THRESHOLD,
    KNOWLEDGE_CANONICAL_TYPES,
    DEFAULT_HINT_BROAD_TOP_K,
    DEFAULT_HINT_BROAD_COOLDOWN_HOURS,
    DEFAULT_HINT_REMINDER_TO_CONTEXT,
    HINT_BROAD_LAST_EMIT_FILE_NAME,
  },
};

if (require.main === module) {
  main({ cwd: process.cwd() }, { stderr: process.stderr });
  process.exit(0);
}
