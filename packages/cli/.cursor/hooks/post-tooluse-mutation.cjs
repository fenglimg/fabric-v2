#!/usr/bin/env node
/**
 * lifecycle-refactor W2-T3 — PostToolUse mutation marker hook (previously
 * dormant). Closes the mutation env opened by the PreToolUse narrow hint.
 *
 * PostToolUse fires AFTER an Edit/Write/MultiEdit tool call completes. This
 * hook appends one `file_mutated` event per edited path to
 * `.fabric/events.jsonl`, carrying the `tool_call_id` so doctor can pair the
 * Pre (intent) and Post (mutation) halves of a single tool call — the per-call
 * key also guards against parallel-fire races (two concurrent edits never
 * collapse to one ledger key).
 *
 * Design (lifecycle-concept-final.md §1 FROZEN invariants + §5 row7):
 *   - LOW compute: extract paths + tool_call_id, append; the hook never reads
 *     or aggregates the ledger, never runs `git diff`. ALL mutation_pool /
 *     attribution work is doctor-side (offline, §5 row7).
 *   - hook = nudge/marker, never a gate (KT-DEC-0007): every error path ends
 *     in a silent exit 0; we never throw upward.
 *   - Front-stage O(1) per path: advisory-locked append, no traversal.
 *   - Per-event session_id: threaded from the REAL payload when present
 *     (omitted when the client omits it — the marker is still useful for the
 *     tool_call_id pairing even without a session).
 *   - Hooks never require() the server package — only co-located lib/*.cjs.
 *
 * Each emitted line matches `fileMutatedEventSchema`
 * (packages/shared/src/schemas/event-ledger.ts):
 *   { kind:"fabric-event", id, ts, schema_version:1, session_id?,
 *     event_type:"file_mutated", path, tool_call_id, tool_name? }
 *
 * Stdout/stderr are intentionally empty — PostToolUse is observation-only and
 * never blocks the host's tool pipeline.
 */

const { randomUUID } = require("node:crypto");
const { existsSync } = require("node:fs");
const { isAbsolute, join, relative } = require("node:path");

// W1-01 (ISS-011) parity: route every shared-ledger append through the
// advisory-lock primitive so concurrent PostToolUse fires (multi-window /
// parallel edits) never interleave a partial line. Best-effort, drop-on-
// contention — same primitive the narrow/broad hooks use.
const { appendLockedLine } = require("./lib/injection-log.cjs");

const FABRIC_DIR_REL = ".fabric";
const EVENTS_LEDGER_FILE = "events.jsonl";

// Tool names that trigger the mutation marker. PostToolUse fires on many tool
// names across clients; we only react to the file-edit tools (matches the
// PreToolUse narrow hint's EDIT_TOOL_NAMES so Pre/Post pair on the same set).
const EDIT_TOOL_NAMES = new Set(["Edit", "Write", "MultiEdit"]);

/**
 * Read stdin (or a test-supplied raw string) as JSON. Returns null on any
 * parse failure — the hook stays silent rather than crashing the tool pipeline.
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
 * Extract the tool name. Mirrors the narrow hint's probe:
 *   - Claude Code / Codex: { tool_name, ... }
 *   - Cursor (legacy):      { tool, ... }
 */
function extractToolName(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.tool_name === "string") return payload.tool_name;
  if (typeof payload.tool === "string") return payload.tool;
  return null;
}

/**
 * Extract the tool_input object, accepting both the `tool_input`
 * (Claude/Codex) and `input` (Cursor) conventions.
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
 * Pull file paths out of a tool_input object. Same three shapes the narrow
 * hint handles (single file_path / array file_paths / MultiEdit edits[]).
 * Returns a deduped array of strings — empty when none recognizable.
 */
function extractPaths(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return [];
  const collected = [];

  if (typeof toolInput.file_path === "string" && toolInput.file_path.length > 0) {
    collected.push(toolInput.file_path);
  }
  if (Array.isArray(toolInput.file_paths)) {
    for (const p of toolInput.file_paths) {
      if (typeof p === "string" && p.length > 0) collected.push(p);
    }
  }
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

  const seen = new Set();
  const out = [];
  for (const p of collected) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Extract the per-call id. Claude Code's PostToolUse payload carries the id of
 * the originating tool_use block as `tool_use_id`; older drafts / other clients
 * variously used `tool_call_id` / `call_id` / `id`. We probe in that order.
 *
 * Returns null when none is present — the caller then synthesizes a best-effort
 * fallback key so the marker still lands (per W2-T3: "缺失则用 best-effort
 * fallback key 但仍 append"). A fallback key cannot pair with the Pre half but
 * still records the mutation, which is strictly better than dropping it.
 */
function extractToolCallId(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = ["tool_use_id", "tool_call_id", "call_id", "id"];
  for (const key of candidates) {
    const v = payload[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/**
 * Normalize a path to a project-relative, forward-slash form. Drops paths that
 * escape the project tree (mirrors appendEditIntentToLedger in the narrow
 * hook). Returns null for out-of-tree / empty.
 */
function normalizePath(projectRoot, p) {
  if (typeof p !== "string" || p.length === 0) return null;
  let rel;
  if (isAbsolute(p)) {
    rel = relative(projectRoot, p);
    if (rel.startsWith("..")) return null;
  } else {
    if (p.startsWith("..")) return null;
    rel = p;
  }
  const slashed = rel.split(/[\\/]/).join("/");
  return slashed.length > 0 ? slashed : null;
}

/**
 * Append one `file_mutated` marker per edited path to `.fabric/events.jsonl`.
 * Best-effort:
 *   - Skips silently when `.fabric/` does not exist (project not init'd).
 *   - Skips silently when there are no in-tree paths.
 *   - ANY error (append, JSON throw) is swallowed — never blocks the pipeline.
 *
 * One JSON line per path (PIPE_BUF-atomic). The per-path lines share a single
 * tool_call_id so doctor can group them as one tool call.
 */
function appendFileMutated(projectRoot, now, paths, toolCallId, toolName, sessionId) {
  try {
    const fabricDir = join(projectRoot, FABRIC_DIR_REL);
    if (!existsSync(fabricDir)) return;
    const pathList = Array.isArray(paths)
      ? paths.map((p) => normalizePath(projectRoot, p)).filter((p) => p !== null)
      : [];
    if (pathList.length === 0) return;
    const tsMs = now instanceof Date ? now.getTime() : Number(now);
    // Best-effort fallback key when the client omits the tool-call id: the
    // mutation is still recorded (can't pair with the Pre half, but the path
    // signal is preserved). Per-fire UUID keeps parallel fires distinct.
    const callId =
      typeof toolCallId === "string" && toolCallId.length > 0
        ? toolCallId
        : `fallback:${randomUUID()}`;
    const validSessionId =
      typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
    const validToolName =
      typeof toolName === "string" && toolName.length > 0 ? toolName : null;
    const lines =
      pathList
        .map((p) =>
          JSON.stringify({
            kind: "fabric-event",
            id: `event:${randomUUID()}`,
            ts: tsMs,
            schema_version: 1,
            ...(validSessionId ? { session_id: validSessionId } : {}),
            event_type: "file_mutated",
            path: p,
            tool_call_id: callId,
            ...(validToolName ? { tool_name: validToolName } : {}),
          }),
        )
        .join("\n") + "\n";
    appendLockedLine(join(fabricDir, EVENTS_LEDGER_FILE), lines);
  } catch {
    // Silent — marker failure must never block the tool pipeline.
  }
}

// -----------------------------------------------------------------------------
// Main — invoked as a CLI (require.main === module) and in-process by tests.
// Wraps the entire flow in try/catch: ANY error → silent exit 0.
// -----------------------------------------------------------------------------

function main(env) {
  try {
    const cwd = (env && env.cwd) || process.cwd();
    const now = (env && env.now) || new Date();
    const payload =
      env && env.payload !== undefined ? env.payload : readPayload(env && env.stdin);
    if (payload === null || payload === undefined) return;

    const toolName = extractToolName(payload);
    if (!toolName || !EDIT_TOOL_NAMES.has(toolName)) return;

    const toolInput = extractToolInput(payload);
    const paths = extractPaths(toolInput);
    if (paths.length === 0) return;

    const toolCallId = extractToolCallId(payload);
    const sessionId =
      payload && typeof payload === "object" && typeof payload.session_id === "string"
        ? payload.session_id
        : null;

    appendFileMutated(cwd, now, paths, toolCallId, toolName, sessionId);
  } catch {
    // Silent — never block the tool pipeline on hook failure.
  }
}

module.exports = {
  main,
  readPayload,
  extractToolName,
  extractToolInput,
  extractPaths,
  extractToolCallId,
  normalizePath,
  appendFileMutated,
  CONSTANTS: {
    FABRIC_DIR_REL,
    EVENTS_LEDGER_FILE,
    EDIT_TOOL_NAMES,
  },
};

if (require.main === module) {
  // Read stdin synchronously (small hook payloads, no concurrency concerns).
  let stdinRaw = "";
  try {
    stdinRaw = require("node:fs").readFileSync(0, "utf8");
  } catch {
    // No stdin — proceed with empty payload (E*: no append without paths).
  }
  main({ cwd: process.cwd(), now: new Date(), stdin: stdinRaw });
  process.exit(0);
}
