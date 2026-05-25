#!/usr/bin/env node
/**
 * rc.6 TASK-020 (E2 + E4) — PreToolUse narrow-injection hook + edit-counter sidecar.
 * rc.6 TASK-021 (E3) — Session-hints cache emit gate (extends TASK-020).
 * rc.6 TASK-023 (E6) — Hint-silence-counter telemetry (companion to E4).
 *
 * Three coupled responsibilities behind a single PreToolUse trigger
 * (Edit / Write / MultiEdit):
 *
 *   E2 — Narrow knowledge hint
 *     Read the tool_input payload, extract the file path(s) the user is
 *     about to edit, dedupe within the request, then invoke
 *     `fabric plan-context-hint --paths p1,p2,...` and render any matching
 *     narrow-scoped knowledge entries to stderr so the Agent sees relevant
 *     decisions/pitfalls/guidelines *before* the edit lands.
 *
 *     Output contract (stderr only) when narrow.length > 0:
 *       [fabric] N narrow-scoped knowledge entries match your edit targets:
 *         [<id>] (<type>/<maturity>) <summary-line>
 *         [<id>] (<type>/<maturity>) <summary-line>
 *         ...
 *       (如需重读 broad 决策，调 fab_plan_context 或 fabric plan-context-hint --all)
 *
 *     When narrow.length === 0: complete silence (exit 0, no stderr).
 *
 *   E3 — Session-hints cache (per-session dedupe)
 *     Read `.fabric/.cache/session-hints-{session_id}.json` BEFORE rendering.
 *     Cache shape:
 *       { session_id, revision_hash, hinted_paths: string[],
 *         hinted_stable_ids: string[], last_emitted_index_hash: string }
 *
 *     Emit-gate decision (in order):
 *       1. If cache.revision_hash !== current revision_hash → drop cache
 *          wholesale (treat as fresh; re-emit allowed).
 *       2. Compute current_index_hash = sha256(JSON.stringify(narrow ids));
 *          if it equals cache.last_emitted_index_hash → SKIP emit (silent).
 *       3. Filter narrow entries: drop any whose stable_id is already in
 *          cache.hinted_stable_ids. Also drop the request entirely if every
 *          target path is already in cache.hinted_paths.
 *       4. If filtered narrow set is non-empty → emit + update cache (append
 *          new paths + stable_ids, set last_emitted_index_hash).
 *
 *     session_id resolution: payload.session_id → env FABRIC_SESSION_ID →
 *     synthetic per-process UUID (degenerates to process-lifetime dedupe).
 *     Cache files are per-session; concurrent sessions never collide.
 *
 *   E4 — Edit-counter sidecar
 *     Unconditionally append one ISO-8601 timestamp line to
 *     `.fabric/.cache/edit-counter` per PreToolUse fire. This sidecar is
 *     consumed by TASK-022 (rc.6 E5) to upgrade Signal A from
 *     "hours-since-last-knowledge_proposed" to "edits-since-last-archive".
 *
 *     Runs BEFORE the CLI invocation so a CLI failure does not lose the
 *     counter signal. One line per fire, regardless of how many paths the
 *     request touched (the timestamp is per-invocation, not per-path).
 *
 * Stdout is intentionally empty. PreToolUse hooks may pollute stdout to
 * signal `decision:block`, but this hook is informational only — it never
 * blocks tool execution.
 *
 * Failure invariant: any error path (spawn failure, ENOENT, timeout,
 * JSON.parse throw, sidecar/cache write failure) MUST end in silent exit 0.
 * The hook never blocks Edit/Write/MultiEdit on its own malfunction.
 */

const { spawnSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} = require("node:fs");
const { dirname, join } = require("node:path");

// -----------------------------------------------------------------------------
// CONSTANTS
// -----------------------------------------------------------------------------

// `fabric plan-context-hint` is a thin wrapper over planContext(); on a
// well-seeded repo it returns in ~100ms. Two-second cap mirrors
// knowledge-hint-broad.cjs — any pathological hang must not stall edits.
const CLI_TIMEOUT_MS = 2000;

// Maximum summary length per entry. Bounds each stderr line so a sloppy
// pending entry can't blow up terminal width. Truncation appends an ellipsis.
const SUMMARY_MAX_LEN = 80;

// Edit-counter sidecar — workspace-relative path. Process-local file; no
// network. TASK-022 will read this back to compute edits-since-archive.
const EDIT_COUNTER_DIR_REL = join(".fabric", ".cache");
const EDIT_COUNTER_FILE = "edit-counter";

// rc.6 TASK-023 (E6): hint-silence-counter sidecar — companion to the
// edit-counter above. Where edit-counter records every PreToolUse fire
// (numerator-agnostic), the silence-counter records only those fires that
// produced no narrow stderr emission (matched-narrow == 0 OR emit-gate
// returned render=false). Doctor lint #26 reads both files to derive a
// silence rate over a 30d window; a sustained >95% rate is a usage-pattern
// signal that narrow scope has drifted from where edits actually happen.
//
// Lives in the same .fabric/.cache/ directory so a single doctor cleanup
// pass can reason about both files together.
const HINT_SILENCE_COUNTER_DIR_REL = join(".fabric", ".cache");
const HINT_SILENCE_COUNTER_FILE = "hint-silence-counter";

// rc.6 TASK-021 (E3): session-hints cache lives alongside the edit-counter
// in .fabric/.cache/. One file per session, named session-hints-{id}.json.
// File-name prefix is referenced by the doctor lint #27 cleanup pass that
// deletes files with mtime older than 7 days.
const SESSION_HINTS_DIR_REL = join(".fabric", ".cache");
const SESSION_HINTS_FILE_PREFIX = "session-hints-";
const SESSION_HINTS_FILE_SUFFIX = ".json";

// Synthetic session id used when neither payload.session_id nor
// FABRIC_SESSION_ID is available. Generated once per process so a single
// hook invocation lifetime acts like a degenerate session (dedupes within
// the process; degrades back to per-fire renders on next spawn). This is
// the documented fallback chain — clients that want robust dedupe should
// pass session_id through the hook payload.
let SYNTHETIC_SESSION_ID = null;

// Tool names that trigger the narrow-injection branch. PreToolUse fires on
// many tool names across clients; we only react to file-edit tools.
const EDIT_TOOL_NAMES = new Set(["Edit", "Write", "MultiEdit"]);

// -----------------------------------------------------------------------------
// Payload parsing
// -----------------------------------------------------------------------------

/**
 * Read stdin (or a test-supplied raw string) as JSON. Returns null on any
 * parse failure — the hook stays silent rather than crashing the edit.
 */
function readPayload(rawStdin) {
  if (typeof rawStdin !== "string" || rawStdin.length === 0) return null;
  try {
    const parsed = JSON.parse(rawStdin);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch (e) {
    // v2.0.0-rc.29 REVIEW (codex LOW-1): apply BUG-L1's malformed-input
    // diagnostic uniformly across hook scripts. fabric-hint.cjs got the stderr
    // trace in TASK-008; without this matching write here, a broken Codex /
    // Cursor host payload silently kills the narrow hint with no operator
    // signal at all. Best-effort: a failed stderr write must not throw upward
    // (hook contract — never crash the host's edit pipeline).
    try {
      const message = (e && typeof e === "object" && "message" in e) ? String(e.message) : String(e);
      process.stderr.write(`[fabric-knowledge-hint-narrow] malformed input: ${message}\n`);
    } catch {
      // stderr write itself failed (sandbox / closed fd) — accept silence.
    }
    return null;
  }
}

/**
 * Extract the tool name from a hook payload. Clients differ in casing /
 * field placement; we probe the conventional shapes:
 *   - Claude Code:  { tool_name, tool_input: { ... } }
 *   - Codex CLI:    { tool_name, tool_input: { ... } } (mirrors Claude)
 *   - Cursor:       { tool, input: { ... } } (legacy variant)
 * Returns null when no recognizable shape is present.
 */
function extractToolName(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.tool_name === "string") return payload.tool_name;
  if (typeof payload.tool === "string") return payload.tool;
  return null;
}

/**
 * Extract the tool_input object from a hook payload, accepting both the
 * `tool_input` (Claude/Codex) and `input` (Cursor) conventions.
 */
function extractToolInput(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.tool_input && typeof payload.tool_input === "object") {
    return payload.tool_input;
  }
  if (payload.input && typeof payload.input === "object") {
    return payload.input;
  }
  return null;
}

/**
 * Pull file paths out of a tool_input object. Handles three shapes:
 *   - single Edit/Write: { file_path: "src/foo.ts", ... }
 *   - bulk variant:      { file_paths: ["src/foo.ts", "src/bar.ts"] }
 *   - MultiEdit:         { file_path: "...", edits: [{file_path?, ...}, ...] }
 *     (Claude Code's MultiEdit currently issues per-edit operations against
 *     a single `file_path`; older drafts and Cursor's variant carried
 *     per-edit `file_path`. We accept both to be defensive.)
 *
 * Returns a deduped array of strings — empty when no path is recognizable.
 * Order: first occurrence wins (stable across re-renders of the same payload).
 */
function extractPaths(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return [];
  const collected = [];

  // Shape 1: scalar file_path
  if (typeof toolInput.file_path === "string" && toolInput.file_path.length > 0) {
    collected.push(toolInput.file_path);
  }

  // Shape 2: array file_paths
  if (Array.isArray(toolInput.file_paths)) {
    for (const p of toolInput.file_paths) {
      if (typeof p === "string" && p.length > 0) collected.push(p);
    }
  }

  // Shape 3: MultiEdit edits[] — each entry may carry its own file_path
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (
        edit &&
        typeof edit === "object" &&
        typeof edit.file_path === "string" &&
        edit.file_path.length > 0
      ) {
        collected.push(edit.file_path);
      }
    }
  }

  // Dedupe preserving first-occurrence order.
  const seen = new Set();
  const out = [];
  for (const p of collected) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Edit-counter sidecar (E4)
// -----------------------------------------------------------------------------

/**
 * Append a single line to .fabric/.cache/edit-counter recording a PreToolUse
 * fire. Creates the directory if missing. Best-effort: any write failure is
 * swallowed so a read-only .fabric/ never blocks the edit.
 *
 * Per TASK-020 convergence: ONE LINE per PreToolUse fire, regardless of how
 * many paths the request touched (the timestamp is per-invocation, not
 * per-path). TASK-022 (rc.6 E5) counts fires, not paths.
 *
 * rc.7 T4 upgrade — the line is now a JSON object:
 *   {"ts":"<ISO-8601>","paths":["a/b/c.ts","d/e.ts"]}
 * so the Stop hook can derive a "top edited directories" activity overview
 * for the 人-first reminder banner (Signal A).
 *
 * Back-compat:
 *   - countEditsSince() reads each line by extracting the first ISO-8601
 *     substring it sees (works on both JSON-line and legacy plain-ISO files).
 *   - Existing sidecars from rc.6 (plain ISO per line) continue to count
 *     correctly; the activity-overview helper simply skips lines with no
 *     `paths` array.
 *   - When the caller cannot supply paths (e.g. unrecognized tool, payload
 *     parse failure) we still write the JSON line with an empty `paths`
 *     array. The fire-count signal is preserved; the activity overview
 *     just contributes nothing from those lines.
 */
function appendEditCounter(projectRoot, now, paths) {
  try {
    const dir = join(projectRoot, EDIT_COUNTER_DIR_REL);
    const file = join(dir, EDIT_COUNTER_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const iso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    // v2.0.0-rc.27 TASK-005 (audit §2.8): normalize every path to a
    // project-relative form BEFORE persistence. rc.26 wrote whatever the
    // tool_input handed in — frequently absolute paths like
    // `/Users/wepie/.../foo.ts` — which then leaked into the archive banner's
    // "recent activity centered on: Users/wepie/" prose (the dirname pass
    // stripped the leading `/` but produced a $HOME-prefix surface). The
    // normalize-on-write keeps the sidecar containing only project-internal
    // paths so downstream banner rendering can't accidentally surface
    // host-system paths.
    //
    // Strategy: for each path, attempt path.relative(projectRoot, abs). When
    // the result starts with `..` (path is outside the project tree) we
    // silently drop the entry — out-of-tree edits are not meaningful
    // activity for THIS project's banner. Bare relative paths (already in
    // canonical form) round-trip through relative() unchanged.
    const { isAbsolute: pathIsAbsolute, relative: pathRelative } = require("node:path");
    const pathList = Array.isArray(paths)
      ? paths
          .filter((p) => typeof p === "string" && p.length > 0)
          .map((p) => {
            if (pathIsAbsolute(p)) {
              const rel = pathRelative(projectRoot, p);
              // path.relative returns `..` segments when p escapes projectRoot.
              return rel.startsWith("..") ? null : rel;
            }
            return p;
          })
          .filter((p) => typeof p === "string" && p.length > 0)
      : [];
    const line = JSON.stringify({ ts: iso, paths: pathList });
    appendFileSync(file, `${line}\n`, "utf8");
  } catch {
    // Silent — sidecar failure must never block the edit.
  }
}

/**
 * rc.6 TASK-023 (E6): append one ISO-8601 timestamp line to
 * `.fabric/.cache/hint-silence-counter`. Called from main() on every silent
 * fire path — i.e. when the hook completes without emitting any narrow
 * stderr lines. This includes:
 *
 *   - matched-narrow == 0 (CLI returned an empty narrow set)
 *   - emit-gate render === false (session-hints dedupe filtered everything
 *     out)
 *
 * Together with appendEditCounter (E4), this lets doctor lint #26 compute a
 * silence rate: silence_count / total_fires over a rolling window. The
 * write semantics mirror appendEditCounter exactly — single timestamp line
 * per silent fire, best-effort (failures swallowed), directory created if
 * missing.
 */
function appendHintSilenceCounter(projectRoot, now) {
  try {
    const dir = join(projectRoot, HINT_SILENCE_COUNTER_DIR_REL);
    const file = join(dir, HINT_SILENCE_COUNTER_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const iso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    appendFileSync(file, `${iso}\n`, "utf8");
  } catch {
    // Silent — sidecar failure must never block the edit.
  }
}

// -----------------------------------------------------------------------------
// Session-hints cache (E3) — per-session emit-gate
// -----------------------------------------------------------------------------

/**
 * Resolve the session id used to key the cache file. Priority:
 *   1. payload.session_id (string, non-empty) — preferred; threads through
 *      from the client hook payload (Claude Code / Codex CLI / Cursor).
 *   2. process.env.FABRIC_SESSION_ID — environment fallback.
 *   3. SYNTHETIC_SESSION_ID — a process-lifetime UUID, generated lazily so
 *      tests can stub it (see resetSyntheticSessionId).
 *
 * The synthetic id keeps the emit-gate honest even when no upstream id is
 * available: a single hook spawn won't re-render the same hint twice within
 * its process lifetime, but a fresh spawn starts a new "session" — which is
 * the documented degradation for clients that don't pass session_id.
 */
function resolveSessionId(payload, env) {
  if (payload && typeof payload === "object") {
    const fromPayload = payload.session_id;
    if (typeof fromPayload === "string" && fromPayload.length > 0) {
      return fromPayload;
    }
  }
  const envBag = (env && env.processEnv) || process.env;
  const fromEnv = envBag && envBag.FABRIC_SESSION_ID;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }
  if (SYNTHETIC_SESSION_ID === null) {
    try {
      SYNTHETIC_SESSION_ID = randomUUID();
    } catch {
      // randomUUID is available on Node >= 14.17 / 16; if it ever throws,
      // fall back to a coarse pid/time stamp so the cache still keys on
      // something stable for the process lifetime.
      SYNTHETIC_SESSION_ID = `pid-${process.pid}-${Date.now()}`;
    }
  }
  return SYNTHETIC_SESSION_ID;
}

/**
 * Test seam: reset the synthetic session id cache. Lets unit tests verify
 * the fallback chain independently per case.
 */
function resetSyntheticSessionId() {
  SYNTHETIC_SESSION_ID = null;
}

/**
 * Compute the absolute path to a session-hints cache file. Exposed as a
 * helper so the doctor cleanup pass and tests share the same naming
 * convention.
 */
function sessionHintsCachePath(projectRoot, sessionId) {
  return join(
    projectRoot,
    SESSION_HINTS_DIR_REL,
    `${SESSION_HINTS_FILE_PREFIX}${sessionId}${SESSION_HINTS_FILE_SUFFIX}`,
  );
}

/**
 * Load + parse the session-hints cache for `sessionId`. Returns null on
 * any failure (missing file, parse error, shape mismatch). Never throws —
 * cache miss falls through to a fresh emit.
 */
function readSessionHintsCache(projectRoot, sessionId) {
  try {
    const file = sessionHintsCachePath(projectRoot, sessionId);
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf8");
    if (raw.length === 0) return null;
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    // Defensive shape coercion: missing fields default to safe empties so
    // downstream code can treat the result as a fully-shaped cache.
    return {
      session_id:
        typeof parsed.session_id === "string" ? parsed.session_id : sessionId,
      revision_hash:
        typeof parsed.revision_hash === "string" ? parsed.revision_hash : "",
      hinted_paths: Array.isArray(parsed.hinted_paths)
        ? parsed.hinted_paths.filter((p) => typeof p === "string" && p.length > 0)
        : [],
      hinted_stable_ids: Array.isArray(parsed.hinted_stable_ids)
        ? parsed.hinted_stable_ids.filter(
            (id) => typeof id === "string" && id.length > 0,
          )
        : [],
      last_emitted_index_hash:
        typeof parsed.last_emitted_index_hash === "string"
          ? parsed.last_emitted_index_hash
          : "",
    };
  } catch {
    return null;
  }
}

/**
 * Atomically write the session-hints cache. Writes to a sibling tmp file
 * and renames into place — keeps observers from reading a half-written
 * JSON document. Silent on any failure (read-only fs, ENOSPC, etc).
 */
function writeSessionHintsCache(projectRoot, cache) {
  try {
    const dir = join(projectRoot, SESSION_HINTS_DIR_REL);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const file = sessionHintsCachePath(projectRoot, cache.session_id);
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
    renameSync(tmp, file);
  } catch {
    // Silent — cache write must never block the edit.
  }
}

/**
 * Compute a stable index hash for the narrow set. Sorted stable_ids are
 * concatenated so two calls with the same id set (regardless of CLI output
 * order) hash identically. Returns "" for an empty narrow set so the
 * emit-gate never accidentally short-circuits on empty input (the empty
 * branch is handled earlier in main()).
 */
function computeIndexHash(narrow) {
  if (!Array.isArray(narrow) || narrow.length === 0) return "";
  const ids = narrow
    .map((entry) => (entry && typeof entry.id === "string" ? entry.id : ""))
    .filter((id) => id.length > 0)
    .slice()
    .sort();
  if (ids.length === 0) return "";
  return createHash("sha256").update(JSON.stringify(ids)).digest("hex");
}

/**
 * Apply the emit-gate. Returns `{ render, narrow, cache }`:
 *   render: boolean — true if the caller should render to stderr
 *   narrow: NarrowEntry[] — filtered set (drops already-hinted stable_ids)
 *   cache:  the merged cache object to persist if render === true
 *
 * Semantics (mirror the file header):
 *   1. revision_hash mismatch (or empty cache.revision_hash, or no existing
 *      cache) → treat as fresh. Filter is identity on input.
 *   2. revision_hash matches AND every target path is in cache.hinted_paths
 *      → skip emit silently (returns render=false).
 *   3. revision_hash matches AND current_index_hash equals
 *      cache.last_emitted_index_hash → skip (returns render=false).
 *   4. Otherwise filter narrow by hinted_stable_ids; if the filtered set is
 *      empty → skip (render=false). Else render the filtered set.
 *
 * The caller (main) commits the cache via writeSessionHintsCache only when
 * render === true — keeps cache writes coupled to actual stderr emissions.
 */
function applyEmitGate(cache, narrow, targetPaths, currentRevisionHash) {
  // Branch 1: no cache or stale revision_hash → fresh emit.
  const isFresh =
    cache === null ||
    typeof cache.revision_hash !== "string" ||
    cache.revision_hash.length === 0 ||
    cache.revision_hash !== currentRevisionHash;

  const currentIndexHash = computeIndexHash(narrow);

  // Effective cache view for the merge step. Fresh runs start from an empty
  // baseline; non-fresh inherit the prior session's accumulation.
  const baseline = isFresh
    ? {
        session_id: cache && typeof cache.session_id === "string" ? cache.session_id : "",
        revision_hash: currentRevisionHash,
        hinted_paths: [],
        hinted_stable_ids: [],
        last_emitted_index_hash: "",
      }
    : cache;

  if (!isFresh) {
    // Branch 2: every target path already hinted.
    const allPathsKnown =
      targetPaths.length > 0 &&
      targetPaths.every((p) => baseline.hinted_paths.includes(p));
    if (allPathsKnown) {
      return { render: false, narrow: [], cache: baseline };
    }

    // Branch 3: index hash matches the last emission verbatim.
    if (
      currentIndexHash.length > 0 &&
      currentIndexHash === baseline.last_emitted_index_hash
    ) {
      return { render: false, narrow: [], cache: baseline };
    }
  }

  // Branch 4: filter narrow entries whose stable_id is already known.
  const knownIds = new Set(baseline.hinted_stable_ids);
  const filtered = narrow.filter(
    (entry) => !(entry && typeof entry.id === "string" && knownIds.has(entry.id)),
  );
  if (filtered.length === 0) {
    return { render: false, narrow: [], cache: baseline };
  }

  // Build the to-persist cache. Append new paths + stable_ids, refresh
  // index hash. Use Set-based merge to preserve uniqueness without
  // allocating a Set on every emit.
  const mergedPaths = mergeUnique(baseline.hinted_paths, targetPaths);
  const newIds = filtered
    .map((e) => (e && typeof e.id === "string" ? e.id : ""))
    .filter((id) => id.length > 0);
  const mergedIds = mergeUnique(baseline.hinted_stable_ids, newIds);

  return {
    render: true,
    narrow: filtered,
    cache: {
      session_id: baseline.session_id,
      revision_hash: currentRevisionHash,
      hinted_paths: mergedPaths,
      hinted_stable_ids: mergedIds,
      last_emitted_index_hash: currentIndexHash,
    },
  };
}

// Order-preserving dedupe merge — extracted because both hinted_paths and
// hinted_stable_ids share the same merge semantics.
function mergeUnique(existing, incoming) {
  const seen = new Set(existing);
  const out = existing.slice();
  for (const item of incoming) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// -----------------------------------------------------------------------------
// CLI invocation (E2)
// -----------------------------------------------------------------------------

/**
 * Spawn `fabric plan-context-hint --paths p1,p2,...` and return parsed JSON.
 * Returns null on any failure (ENOENT, non-zero exit, malformed JSON,
 * timeout). Never throws.
 *
 * Spawn strategy mirrors knowledge-hint-broad.cjs: try `fabric` first, then
 * `fab`. If neither is on PATH, return null — the hook stays silent.
 */
function invokePlanContextHint(cwd, paths) {
  if (!Array.isArray(paths) || paths.length === 0) return null;
  const pathsArg = paths.join(",");
  const candidates = ["fabric", "fab"];
  for (const bin of candidates) {
    let res;
    try {
      res = spawnSync(bin, ["plan-context-hint", "--paths", pathsArg], {
        cwd,
        encoding: "utf8",
        timeout: CLI_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      continue;
    }
    if (res.error || res.status === null || res.status !== 0) continue;
    const raw = (res.stdout || "").trim();
    if (raw.length === 0) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // malformed JSON — try next bin
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function truncateSummary(raw) {
  const s = typeof raw === "string" ? raw : "";
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= SUMMARY_MAX_LEN) return flat;
  return `${flat.slice(0, SUMMARY_MAX_LEN - 1)}…`;
}

function formatEntryLine(entry) {
  const id = entry.id || "(no-id)";
  const type = entry.type || "unknown";
  const maturity = entry.maturity || "unknown";
  const summary = truncateSummary(entry.summary);
  const tail = summary.length > 0 ? ` ${summary}` : "";
  return `  [${id}] (${type}/${maturity})${tail}`;
}

/**
 * Render the narrow-match block to an array of stderr lines. Returns []
 * when there is nothing to render (empty entries set). Callers stay silent
 * on empty output.
 *
 * Protocol gate (rc.18): only `payload.version === 2` payloads are
 * rendered. Anything else returns []. When the payload exists but carries
 * a mismatched (non-undefined) version, a one-line stderr breadcrumb is
 * emitted as a debug aid — see `_protocol-v2-decisions.md` (Decision 2,
 * "silent-skip + one-line stderr breadcrumb"). The wire field is
 * `payload.entries` (renamed from `payload.narrow` in protocol v2,
 * Decision 1).
 *
 * Output shape:
 *   [fabric] N narrow-scoped knowledge entries match your edit targets:
 *     [<id>] (<type>/<maturity>) <summary>
 *     ...
 *   (如需重读 broad 决策，调 fab_plan_context 或 fabric plan-context-hint --all)
 */
function renderSummary(payload) {
  if (!payload || payload.version !== 2) {
    if (payload && payload.version !== undefined) {
      // breadcrumb only if payload exists but version mismatches (avoid
      // spam on null). Best-effort write — silent-on-failure honors the
      // hook's "never block edits" contract.
      try {
        process.stderr.write(
          `[fabric] hint payload version=${payload.version} unsupported (expected 2), skipping\n`,
        );
      } catch {
        // ignore — stderr unavailable, silent-skip still applies
      }
    }
    return [];
  }
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  if (entries.length === 0) return [];

  const lines = [
    `[fabric] ${entries.length} narrow-scoped knowledge entries match your edit targets:`,
  ];
  for (const entry of entries) {
    lines.push(formatEntryLine(entry));
  }
  lines.push("  (如需重读 broad 决策，调 fab_plan_context 或 fabric plan-context-hint --all)");
  return lines;
}

// -----------------------------------------------------------------------------
// Main — invoked as a CLI (require.main === module) and in-process by tests
// -----------------------------------------------------------------------------

function main(env, stdio) {
  try {
    const cwd = (env && env.cwd) || process.cwd();
    const now = (env && env.now) || new Date();
    const err = (stdio && stdio.stderr) || process.stderr;

    // Parse hook payload. Test seam: env.payload short-circuits stdin so
    // unit tests don't need to muck with process.stdin.
    const payload =
      env && env.payload !== undefined ? env.payload : readPayload(env && env.stdin);

    // E4 runs UNCONDITIONALLY — append a line even when payload is null or
    // the tool is unrecognized. The counter signal measures hook fires, not
    // successful renders (TASK-022 wants the raw edit-attempt cadence).
    //
    // rc.7 T4: best-effort path extraction is done BEFORE the counter write
    // so the JSON line can carry the touched paths for the Stop hook's
    // 人-first activity-overview banner. Failure to extract paths (null
    // payload, unrecognized tool, etc.) yields an empty paths array — the
    // fire-count signal is preserved.
    //
    // Test seam: env.skipCounter disables the side-effect for tests that
    // want to assert rendering behaviour without touching the filesystem.
    let toolName = null;
    let toolInput = null;
    let paths = [];
    if (payload !== null && payload !== undefined) {
      try {
        toolName = extractToolName(payload);
        if (toolName && EDIT_TOOL_NAMES.has(toolName)) {
          toolInput = extractToolInput(payload);
          paths = extractPaths(toolInput);
        }
      } catch {
        // Defensive — extractors already swallow most failures, but the
        // counter write must not be lost if a future extractor throws.
        toolName = null;
        paths = [];
      }
    }
    if (!(env && env.skipCounter === true)) {
      appendEditCounter(cwd, now, paths);
    }

    // E2 path is conditional on a recognized tool + extractable paths.
    if (payload === null || payload === undefined) return;
    if (!toolName || !EDIT_TOOL_NAMES.has(toolName)) return;
    if (paths.length === 0) return;

    // Test seam: env.cliResult short-circuits the CLI spawn so unit tests
    // can feed canned plan-context-hint JSON without a built CLI binary.
    const cliPayload =
      env && env.cliResult !== undefined
        ? env.cliResult
        : invokePlanContextHint(cwd, paths);
    if (cliPayload === null || cliPayload === undefined) return;

    // Protocol v2 (rc.18 TASK-005): wire field is `entries`, no v1 shim.
    //
    // v2.0.0-rc.27 TASK-005 (audit §2.5/§2.7): filter to entries whose
    // `relevance_scope === "narrow"` so broad cross-cutting entries do NOT
    // pollute the PreToolUse banner. rc.26 emitted broad + narrow as a
    // single list — every Edit fired a hint even for paths the entry never
    // anchored against (audit §2.5 reproduction). Broad entries are already
    // surfaced once per session by the SessionStart hook so the PreToolUse
    // surface should be narrow-only by design.
    //
    // Defensive default: when the CLI omits `relevance_scope` (older server
    // / malformed item) we treat it as broad and skip — pre-rc.27 entries
    // without the field are exactly the broad-leak surface §2.5 calls out.
    const allEntries = Array.isArray(cliPayload.entries) ? cliPayload.entries : [];
    const narrow = allEntries.filter((entry) => entry && entry.relevance_scope === "narrow");
    if (narrow.length === 0) {
      // rc.6 TASK-023 (E6): silence-counter — matched-narrow == 0. The CLI
      // had a chance to match against the extracted paths but came back
      // empty. Test seam env.skipSilenceCounter mirrors env.skipCounter.
      if (!(env && env.skipSilenceCounter === true)) {
        appendHintSilenceCounter(cwd, now);
      }
      return;
    }

    // -------------------------------------------------------------------------
    // E3 emit-gate (TASK-021) — session-hints cache.
    //
    // Sits between the CLI result and the renderSummary() call. The gate
    // decides whether to emit at all (silence on duplicate) and may also
    // narrow the entries we render (skip individual stable_ids that we've
    // already shown earlier in the same session).
    //
    // NOTE for TASK-023 (E6 silence-counter): the "skip emit" branch is
    // the natural anchor for the matched-narrow == 0 silence counter — by
    // the time we reach this comment the CLI has returned a non-empty
    // narrow set, so an "all-skipped" gate decision is equivalent to a
    // matched-narrow == 0 outcome from the user's perspective. TASK-023
    // can add the counter increment either here (before the early return)
    // or inside applyEmitGate when render === false.
    // -------------------------------------------------------------------------
    const sessionId = resolveSessionId(payload, env);
    const currentRevisionHash =
      typeof cliPayload.revision_hash === "string" ? cliPayload.revision_hash : "";
    // Test seam: env.cacheSeed short-circuits the on-disk cache read so unit
    // tests can preload a known cache state without touching the filesystem.
    const cache =
      env && env.cacheSeed !== undefined
        ? env.cacheSeed
        : readSessionHintsCache(cwd, sessionId);
    const gateDecision = applyEmitGate(cache, narrow, paths, currentRevisionHash);
    if (!gateDecision.render) {
      // rc.6 TASK-023 (E6): silence-counter — emit-gate filtered everything
      // out. From the user's perspective this is indistinguishable from
      // matched-narrow == 0: the CLI had matches, but session-hints dedupe
      // suppressed the render. Counted as silence so doctor lint #26 sees
      // narrow-scope drift even when dedupe is masking the matches.
      if (!(env && env.skipSilenceCounter === true)) {
        appendHintSilenceCounter(cwd, now);
      }
      return;
    }

    // Persist the cache BEFORE rendering. If the render itself throws (e.g.
    // stderr write errors), the cache update still reflects the intent —
    // the alternative (post-render write) could leave us in a state where
    // the user saw the hint but the cache says "not yet shown", causing a
    // double-emit on the next fire. We prefer the silent-but-recorded
    // outcome to the double-emit one.
    //
    // Test seam: env.skipCacheWrite disables the on-disk write so tests
    // can assert the gate decision without filesystem side effects.
    if (!(env && env.skipCacheWrite === true)) {
      writeSessionHintsCache(cwd, {
        ...gateDecision.cache,
        session_id: sessionId,
      });
    }

    const lines = renderSummary({ ...cliPayload, entries: gateDecision.narrow });
    if (lines.length === 0) return;
    for (const line of lines) {
      err.write(`${line}\n`);
    }
  } catch {
    // Silent — never block edits on hook failure.
  }
}

module.exports = {
  main,
  readPayload,
  extractToolName,
  extractToolInput,
  extractPaths,
  appendEditCounter,
  appendHintSilenceCounter,
  invokePlanContextHint,
  renderSummary,
  truncateSummary,
  formatEntryLine,
  // rc.6 TASK-021 (E3) — session-hints cache exports for tests / future
  // consumers (TASK-023 silence-counter telemetry will reuse the same
  // session-id resolution + cache shape).
  resolveSessionId,
  resetSyntheticSessionId,
  sessionHintsCachePath,
  readSessionHintsCache,
  writeSessionHintsCache,
  computeIndexHash,
  applyEmitGate,
  CONSTANTS: {
    CLI_TIMEOUT_MS,
    SUMMARY_MAX_LEN,
    EDIT_COUNTER_DIR_REL,
    EDIT_COUNTER_FILE,
    HINT_SILENCE_COUNTER_DIR_REL,
    HINT_SILENCE_COUNTER_FILE,
    EDIT_TOOL_NAMES,
    SESSION_HINTS_DIR_REL,
    SESSION_HINTS_FILE_PREFIX,
    SESSION_HINTS_FILE_SUFFIX,
  },
};

if (require.main === module) {
  // Read stdin synchronously (small hook payloads, no concurrency concerns).
  let stdinRaw = "";
  try {
    stdinRaw = require("node:fs").readFileSync(0, "utf8");
  } catch {
    // No stdin — proceed with empty payload (E4 still runs).
  }
  main(
    { cwd: process.cwd(), now: new Date(), stdin: stdinRaw },
    { stderr: process.stderr },
  );
  process.exit(0);
}
