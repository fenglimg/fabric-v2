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
 *     Use `fab_get_knowledge_sections` to fetch full content.
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
 *     Use `fab_get_knowledge_sections` to fetch full content.
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
const {
  existsSync,
  readdirSync,
  readFileSync,
} = require("node:fs");
const { join } = require("node:path");

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
const FABRIC_CONFIG_FILE = "fabric-config.json";
const AGENTS_META_FILE = "agents.meta.json";
const IMPORT_STATE_FILE = ".import-state.json";
const KNOWLEDGE_CANONICAL_TYPES = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
];
const DEFAULT_UNDERSEED_NODE_THRESHOLD = 10;

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
  const knowledgeRoot = join(projectRoot, FABRIC_DIR_REL, "knowledge");
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
 * Resolve the underseed-node threshold from .fabric/fabric-config.json
 * (underseed_node_threshold), falling back to DEFAULT_UNDERSEED_NODE_THRESHOLD.
 * Any read/parse failure → default (never block on config errors).
 */
function readUnderseedThreshold(projectRoot) {
  const configPath = join(projectRoot, FABRIC_DIR_REL, FABRIC_CONFIG_FILE);
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
 *   1. `.fabric/agents.meta.json` exists
 *      (workspace has been `fabric init`-ed; otherwise the recommendation
 *       is meaningless — `fabric-import` requires init's baseline scan).
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
    const metaPath = join(projectRoot, FABRIC_DIR_REL, AGENTS_META_FILE);
    if (!existsSync(metaPath)) return false;

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

// Per-type truncation triggers when total narrow entries > 30. The threshold
// was originally aligned with the rc.5 plan-context degenerate-mode cutoff,
// which is now retired (rc.7 T9 — see docs/decisions/rc5-a3-superseded.md).
// We keep 30 here as a stable rendering boundary independent of that protocol
// change: it's a UI-density choice, not a wire-shape one.
const TRUNCATION_THRESHOLD = 30;

// `fabric plan-context-hint` is a thin wrapper over planContext(); on a
// well-seeded repo it returns in ~100ms. Two-second cap is defensive — any
// pathological hang must not stall session start.
const CLI_TIMEOUT_MS = 2000;

// Maximum summary length per entry. Keeps each line bounded so stderr does
// not blow up terminal width with multi-paragraph summaries from sloppy
// pending entries. Truncation appends an ellipsis.
const SUMMARY_MAX_LEN = 80;

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

// rc.8 underseed self-check banner text. Single line, mirrors the emoji-prefix
// style of other Fabric banners (cf. fabric-hint.cjs Signal C `📋 Fabric:`).
const IMPORT_RECOMMENDATION_BANNER =
  "  📋 Fabric: 知识库稀疏，是否调 /fabric-import 从 git 历史与现有文档回灌知识?";

// -----------------------------------------------------------------------------
// CLI invocation
// -----------------------------------------------------------------------------

/**
 * Spawn `fabric plan-context-hint --all` and return parsed JSON. Returns
 * null on any failure (ENOENT, non-zero exit, malformed JSON). Never throws.
 *
 * spawn strategy: try `fabric` first (user-PATH install) then `fab` (the
 * alternate bin name shipped by @fenglimg/fabric-cli). If neither is on PATH,
 * return null — the hook stays silent rather than nagging about install state.
 */
function invokePlanContextHint(cwd) {
  const candidates = ["fabric", "fab"];
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
    // ENOENT surfaces as error on the result object.
    if (res.error || res.status === null || res.status !== 0) continue;
    const raw = (res.stdout || "").trim();
    if (raw.length === 0) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // malformed JSON — try next bin (unlikely to differ, but no harm)
    }
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

function truncateSummary(raw) {
  const s = typeof raw === "string" ? raw : "";
  // Collapse newlines / runs of whitespace so each entry fits one line.
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= SUMMARY_MAX_LEN) return flat;
  return `${flat.slice(0, SUMMARY_MAX_LEN - 1)}…`;
}

function formatEntryLine(entry) {
  const id = entry.id || "(no-id)";
  const summary = truncateSummary(entry.summary);
  return summary.length > 0 ? `    - ${id} · ${summary}` : `    - ${id}`;
}

/**
 * Render full per-type listing — used when total narrow entries <= 30.
 * Each entry gets one line: `    - <id> · <summary>`. Type/maturity headers
 * group the listing.
 */
function renderFull(narrow) {
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
        lines.push(formatEntryLine(entry));
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
function renderTruncated(narrow) {
  const { typeOrder, byType } = groupEntries(narrow);
  const lines = [];
  for (const type of typeOrder) {
    const maturityMap = byType.get(type);

    // Proven: full per-line listing.
    const proven = maturityMap.get(MATURITY_PROVEN);
    if (proven && proven.length > 0) {
      lines.push(`  [${type}] proven (${proven.length}):`);
      for (const entry of proven) {
        lines.push(formatEntryLine(entry));
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
 * (empty narrow set) so callers know to stay silent.
 */
function renderSummary(payload) {
  // Local rebind: `payload.narrow` in `--all` mode degenerates to the full
  // shared index (every broad-scoped entry), so the field name `narrow` is
  // misleading at this rendering layer. We rename the local variable to
  // `entries` to avoid name confusion when reading renderSummary in isolation.
  // The CLI protocol field name (`payload.narrow`) is unchanged — a wire-shape
  // rename is a deferred independent task.
  const entries = Array.isArray(payload && payload.narrow) ? payload.narrow : [];
  if (entries.length === 0) return [];

  const truncated = entries.length > TRUNCATION_THRESHOLD;
  const banner = truncated
    ? `[fabric] Session start — ${entries.length} broad-scoped knowledge entries available (truncated):`
    : `[fabric] Session start — ${entries.length} broad-scoped knowledge entries available:`;

  const body = truncated ? renderTruncated(entries) : renderFull(entries);

  const lines = [banner, ...body];
  const revHash = typeof payload.revision_hash === "string" ? payload.revision_hash : null;
  if (revHash !== null && revHash.length > 0) {
    lines.push(`  revision_hash: ${revHash}`);
  }
  lines.push("  Use `fab_get_knowledge_sections` to fetch full content.");
  return lines;
}

// -----------------------------------------------------------------------------
// Main entry — invoked both as a CLI (require.main === module) and in-process
// by tests. Wraps the entire flow in try/catch: ANY error → silent exit 0.
// -----------------------------------------------------------------------------

function main(env, stdio) {
  try {
    const cwd = (env && env.cwd) || process.cwd();
    const err = (stdio && stdio.stderr) || process.stderr;

    // Test seam: env.payload short-circuits the CLI spawn so unit tests can
    // feed canned plan-context-hint JSON without depending on a built CLI.
    const payload =
      env && env.payload !== undefined ? env.payload : invokePlanContextHint(cwd);
    if (payload === null || payload === undefined) return; // silent

    // rc.8 underseed self-check: decide whether to surface the one-line
    // `/fabric-import` recommendation banner alongside the broad summary.
    const recommendImport = shouldRecommendImport(cwd);

    // rc.12: broad-summary body is unconditionally rendered on every
    // SessionStart fire (Skill-style progressive disclosure). The prior
    // revision_hash cooldown gate (rc.7 T8 — rc.11) was removed because
    // compact/clear-triggered SessionStart re-fires must re-inject the menu
    // for the agent's working memory.
    const lines = renderSummary(payload);

    if (recommendImport) {
      lines.push(IMPORT_RECOMMENDATION_BANNER);
    }

    if (lines.length === 0) return; // nothing to say — silent exit

    for (const line of lines) {
      err.write(`${line}\n`);
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
  CONSTANTS: {
    TRUNCATION_THRESHOLD,
    CLI_TIMEOUT_MS,
    SUMMARY_MAX_LEN,
    CANONICAL_TYPE_ORDER,
    MATURITY_PROVEN,
    MATURITY_VERIFIED,
    MATURITY_DRAFT,
    DEFAULT_UNDERSEED_NODE_THRESHOLD,
    KNOWLEDGE_CANONICAL_TYPES,
    IMPORT_RECOMMENDATION_BANNER,
  },
};

if (require.main === module) {
  main({ cwd: process.cwd() }, { stderr: process.stderr });
  process.exit(0);
}
