#!/usr/bin/env node
/**
 * rc.6 TASK-020 (E2 + E4) — PreToolUse narrow-injection hook + edit-counter sidecar.
 *
 * Two coupled responsibilities behind a single PreToolUse trigger
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
 * JSON.parse throw, sidecar write failure) MUST end in silent exit 0. The
 * hook never blocks Edit/Write/MultiEdit on its own malfunction.
 */

const { spawnSync } = require("node:child_process");
const {
  appendFileSync,
  existsSync,
  mkdirSync,
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
  } catch {
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
 * Append a single ISO-8601 timestamp line to .fabric/.cache/edit-counter.
 * Creates the directory if missing. Best-effort: any write failure is
 * swallowed so a read-only .fabric/ never blocks the edit.
 *
 * Per spec (TASK-020 convergence): one line per PreToolUse fire, regardless
 * of path count. The downstream TASK-022 signal upgrade counts FIRES, not
 * paths.
 */
function appendEditCounter(projectRoot, now) {
  try {
    const dir = join(projectRoot, EDIT_COUNTER_DIR_REL);
    const file = join(dir, EDIT_COUNTER_FILE);
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
 * when there is nothing to render (empty narrow set). Callers stay silent
 * on empty output.
 *
 * Output shape:
 *   [fabric] N narrow-scoped knowledge entries match your edit targets:
 *     [<id>] (<type>/<maturity>) <summary>
 *     ...
 *   (如需重读 broad 决策，调 fab_plan_context 或 fabric plan-context-hint --all)
 */
function renderSummary(payload) {
  const narrow = Array.isArray(payload && payload.narrow) ? payload.narrow : [];
  if (narrow.length === 0) return [];

  const lines = [
    `[fabric] ${narrow.length} narrow-scoped knowledge entries match your edit targets:`,
  ];
  for (const entry of narrow) {
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

    // E4 runs UNCONDITIONALLY — append timestamp even when payload is null
    // or the tool is unrecognized. The counter signal measures hook fires,
    // not successful renders. This is intentional: TASK-022 wants the raw
    // edit-attempt cadence.
    //
    // Test seam: env.skipCounter disables the side-effect for tests that
    // want to assert rendering behaviour without touching the filesystem.
    if (!(env && env.skipCounter === true)) {
      appendEditCounter(cwd, now);
    }

    // E2 path is conditional on a recognized tool + extractable paths.
    if (payload === null || payload === undefined) return;
    const toolName = extractToolName(payload);
    if (!toolName || !EDIT_TOOL_NAMES.has(toolName)) return;
    const toolInput = extractToolInput(payload);
    const paths = extractPaths(toolInput);
    if (paths.length === 0) return;

    // Test seam: env.cliResult short-circuits the CLI spawn so unit tests
    // can feed canned plan-context-hint JSON without a built CLI binary.
    const cliPayload =
      env && env.cliResult !== undefined
        ? env.cliResult
        : invokePlanContextHint(cwd, paths);
    if (cliPayload === null || cliPayload === undefined) return;

    const lines = renderSummary(cliPayload);
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
  invokePlanContextHint,
  renderSummary,
  truncateSummary,
  formatEntryLine,
  CONSTANTS: {
    CLI_TIMEOUT_MS,
    SUMMARY_MAX_LEN,
    EDIT_COUNTER_DIR_REL,
    EDIT_COUNTER_FILE,
    EDIT_TOOL_NAMES,
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
