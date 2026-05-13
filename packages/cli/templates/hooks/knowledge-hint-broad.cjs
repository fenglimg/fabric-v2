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
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

// -----------------------------------------------------------------------------
// rc.7 T8: SessionStart revision_hash gating.
//
// Q-14 problem: every SessionStart re-dumped the full broad knowledge list,
// causing banner blindness. Solution: hash-of-canonical-graph gating — record
// the last-emitted `payload.revision_hash` to a sidecar; on subsequent
// SessionStart fires, compare. Match → silent exit 0 (no re-dump). Mismatch
// (canonical/ corpus changed → planContext bumps revision_hash) → emit AND
// update sidecar.
//
// The revision_hash is supplied by `fabric plan-context-hint --all`'s JSON
// payload (carried in payload.revision_hash since rc.5). Reusing the existing
// hash primitive keeps the gating predicate exactly aligned with the "is the
// knowledge graph different from last time?" question — no second hashing
// scheme to maintain. computeRevisionHash() is not needed at this layer; we
// compare the strings the CLI hands us.
//
// rc.7 T1 (sentinel hand-off) overrides this gate: a `.fabric/.import-requested`
// sentinel forces emission regardless of revision_hash, because the user has
// asked (via `fabric init` Y-confirm) for the import recommendation to surface
// on next SessionStart. That branch is layered on top in main() — see T1
// implementation.
// -----------------------------------------------------------------------------

const FABRIC_DIR_REL = ".fabric";
const SESSIONSTART_HASH_CACHE_FILE = join(".fabric", ".cache", "sessionstart-last-hash");

/**
 * Read the previously-emitted revision_hash from
 * `.fabric/.cache/sessionstart-last-hash`. Missing file / read failure /
 * empty file → null (treat as "no prior emit", forces re-emit).
 *
 * NEVER throws — best-effort read.
 */
function readSessionStartLastHash(projectRoot) {
  try {
    const p = join(projectRoot, SESSIONSTART_HASH_CACHE_FILE);
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Write `hash` to `.fabric/.cache/sessionstart-last-hash` so subsequent
 * SessionStart fires can compare. Creates the directory if missing.
 * Best-effort: any write failure is swallowed so a read-only .fabric/
 * never blocks session start.
 */
function writeSessionStartLastHash(projectRoot, hash) {
  try {
    if (typeof hash !== "string" || hash.length === 0) return;
    const p = join(projectRoot, SESSIONSTART_HASH_CACHE_FILE);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, hash, "utf8");
  } catch {
    // Silent — sidecar failure must never block session start.
  }
}

/**
 * rc.7 T1 sentinel pickup: `.fabric/.import-requested` is an empty marker
 * file written by `fabric init` (clack.confirm Y answer) signalling that
 * the user wants the next SessionStart to recommend `fabric-import`.
 *
 * When the sentinel is present, the gate is overridden — the broad-injection
 * banner is appended with the import recommendation line and the
 * revision_hash gate is bypassed entirely (we always want to surface the
 * recommendation until the import Skill clears the sentinel).
 *
 * Best-effort presence check. NEVER throws.
 */
function isImportRequestedSentinelPresent(projectRoot) {
  try {
    return existsSync(join(projectRoot, FABRIC_DIR_REL, ".import-requested"));
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
  const narrow = Array.isArray(payload && payload.narrow) ? payload.narrow : [];
  if (narrow.length === 0) return [];

  const truncated = narrow.length > TRUNCATION_THRESHOLD;
  const banner = truncated
    ? `[fabric] Session start — ${narrow.length} broad-scoped knowledge entries available (truncated):`
    : `[fabric] Session start — ${narrow.length} broad-scoped knowledge entries available:`;

  const body = truncated ? renderTruncated(narrow) : renderFull(narrow);

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

    // rc.7 T1: sentinel-override gate. When `.fabric/.import-requested` is
    // present, the import-recommendation banner ALWAYS surfaces regardless
    // of revision_hash equality — the user asked for it on init Y-confirm
    // and the fabric-import Skill is responsible for clearing the sentinel
    // when its Phase 3 completes. The override sits BEFORE the gate so the
    // revision_hash cache is not updated either (we want the
    // recommendation to keep surfacing on subsequent boots until the user
    // actually runs import).
    const sentinelPresent = isImportRequestedSentinelPresent(cwd);

    // rc.7 T8: revision_hash gate. If the CLI payload carries a stable
    // revision_hash and it matches the previously-emitted hash recorded in
    // the sidecar, the knowledge graph is unchanged since last session →
    // silent exit 0 (no re-dump). The sentinel override above takes
    // precedence and bypasses this gate.
    const currentHash =
      typeof payload.revision_hash === "string" ? payload.revision_hash : "";
    if (!sentinelPresent && currentHash.length > 0) {
      const lastHash = readSessionStartLastHash(cwd);
      if (lastHash !== null && lastHash === currentHash) {
        // Same canonical graph as last session — banner blindness mitigation.
        return;
      }
    }

    const lines = renderSummary(payload);

    // rc.7 T1: when the sentinel is present, append the import-recommendation
    // banner. This line is appended whether or not the broad summary had
    // entries — even an empty knowledge graph benefits from the prompt.
    if (sentinelPresent) {
      lines.push(
        "  📋 Fabric: 检测到 fabric init 提示要回灌知识 — 是否调 /fabric-import 从 git 历史和现有文档抽取?",
      );
    }

    if (lines.length === 0) return; // empty narrow set + no sentinel — silent

    for (const line of lines) {
      err.write(`${line}\n`);
    }

    // Update sidecar AFTER successful emit. We only persist the hash when
    // the gate actually let the dump through (i.e. when not sentinel-only).
    // Sentinel-only emits don't bump the cache so the next non-sentinel
    // SessionStart still gets to compare the prior session's true hash.
    if (!sentinelPresent && currentHash.length > 0) {
      writeSessionStartLastHash(cwd, currentHash);
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
  // rc.7 T8: revision_hash gating sidecar helpers (exported for unit testing).
  readSessionStartLastHash,
  writeSessionStartLastHash,
  // rc.7 T1: sentinel-override pickup (exported for unit testing).
  isImportRequestedSentinelPresent,
  CONSTANTS: {
    TRUNCATION_THRESHOLD,
    CLI_TIMEOUT_MS,
    SUMMARY_MAX_LEN,
    CANONICAL_TYPE_ORDER,
    MATURITY_PROVEN,
    MATURITY_VERIFIED,
    MATURITY_DRAFT,
    SESSIONSTART_HASH_CACHE_FILE,
  },
};

if (require.main === module) {
  main({ cwd: process.cwd() }, { stderr: process.stderr });
  process.exit(0);
}
