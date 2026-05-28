#!/usr/bin/env node
/**
 * v2.0.0-rc.34 TASK-06 — cite-policy long-session evict sidecar.
 *
 * UserPromptSubmit hook (Claude Code only). Drives periodic cite-policy
 * reminder injection in long sessions where attention decay erodes contract
 * adherence (rc.32 Batch 1: 3.1% cite coverage baseline).
 *
 * Strategy: **turn-count window** (locked decision per rc.34 plan 2026-05-26;
 * time-based and token-budget strategies pushed to rc.35). The hook maintains
 * a per-session counter in `.fabric/.cache/cite-evict-state.json`; on each
 * UserPromptSubmit, increment the counter and — when
 * `turn_count % cite_evict_interval == 0` AND `cite_evict_interval > 0` —
 * emit a compact cite-contract reminder via Claude Code's stdout JSON
 * envelope (hookSpecificOutput.additionalContext, same channel as rc.33 W2
 * knowledge-hint-broad reminder-to-context).
 *
 * Config: `cite_evict_interval` (number, default 0 = OFF, opt-in). Recommend
 * 10-20 for active sessions; 5 for high-contract-criticality projects.
 *
 * State sidecar shape:
 *   { session_id: string, turn_count: number }
 *
 * Session-boundary semantics: when incoming `session_id` (read from stdin
 * payload) differs from sidecar's `session_id`, the counter resets to 1 (new
 * session always starts at 1, never 0 — first turn is "turn 1" not "turn 0").
 *
 * Failure invariant: any error path (sidecar I/O failure, stdin parse error,
 * config read failure) MUST end in silent exit 0. The hook never blocks user
 * prompt submission on its own malfunction.
 *
 * Cross-client scope: Claude Code only (relies on hookSpecificOutput contract
 * + UserPromptSubmit event registration). Codex CLI and Cursor don't have an
 * equivalent event hook; cite-coverage telemetry there relies on Stop-hook
 * fabric-hint and SessionStart knowledge-hint-broad (rc.33 W2 channel).
 */

// v2.0.0-rc.37 NEW-19: config + sidecar I/O now flow through shared libs so
// the read-config-or-default and read/write-sidecar boilerplate lives in one
// canonical place. Unguarded require mirrors knowledge-hint-broad's
// banner-i18n import — the installer copies every lib/*.cjs alongside the hook.
const { readConfigNumber } = require("./lib/config-cache.cjs");
const { readJsonState, writeJsonState } = require("./lib/state-store.cjs");
// v2.0.0-rc.37 NEW-30: client detect + stdin + channel-aware emit now flow
// through the shared adapter (Claude Code stdout envelope vs Codex/Cursor
// stderr). Replaces the local isClaudeCode + readStdinJson + inline emits.
const { isClaudeCode, readStdinJson, emitContext } = require("./lib/client-adapter.cjs");

// Sidecar basename resolved under .fabric/.cache/ by state-store.
const EVICT_STATE_FILE_NAME = "cite-evict-state.json";

// Default OFF (opt-in). Mirrors hint_broad_cooldown_hours and
// archive_hint_cooldown_hours convention of "feature exists but inert until
// user enables it." Schema in packages/shared/src/schemas/fabric-config.ts
// caps at sensible bounds (positive int).
// v2.0.0-rc.37 NEW-18: default flipped 0 (opt-in OFF) → 10 (default ON every
// 10 turns) so users get cite-policy nudges out-of-the-box. Operators on
// short / scripted sessions can still set `cite_evict_interval: 0` in
// .fabric/fabric-config.json to opt back out. Per-NEW-1 reminder body now
// uses the simplified 2-state vocabulary ([applied] / [dismissed:<reason>]).
const DEFAULT_CITE_EVICT_INTERVAL = 10;

/**
 * Read .fabric/fabric-config.json#cite_evict_interval. Returns the parsed
 * positive integer OR DEFAULT_CITE_EVICT_INTERVAL on any failure path
 * (missing file, parse error, non-numeric value, negative). Mirrors the
 * defensive config-read pattern in knowledge-hint-broad.cjs readBroadCooldownHours.
 */
function readEvictInterval(cwd) {
  return readConfigNumber(cwd, "cite_evict_interval", DEFAULT_CITE_EVICT_INTERVAL, {
    min: 0,
    integer: true,
  });
}

/**
 * Read prior state sidecar. Returns `null` on first-run or any failure;
 * callers treat null as "no prior state" (caller will write fresh state
 * with turn_count=1).
 */
function readEvictState(cwd) {
  return readJsonState(
    cwd,
    EVICT_STATE_FILE_NAME,
    (parsed) =>
      parsed &&
      typeof parsed.session_id === "string" &&
      typeof parsed.turn_count === "number" &&
      Number.isInteger(parsed.turn_count) &&
      parsed.turn_count >= 0,
  );
}

function writeEvictState(cwd, sessionId, turnCount) {
  // best-effort — counter loss is acceptable, hook never blocks
  writeJsonState(cwd, EVICT_STATE_FILE_NAME, { session_id: sessionId, turn_count: turnCount });
}

/**
 * Pure helper for unit-testing. Given current `turnCount` (post-increment)
 * and `interval`, decide whether to emit the reminder.
 *
 * Contract:
 *   - interval <= 0 → never emit (feature off)
 *   - turnCount <= 0 → never emit (guard against bogus state)
 *   - emit iff turnCount % interval === 0
 *
 * Examples:
 *   evaluateCiteEvict(10, 10) → true  (10 % 10 === 0)
 *   evaluateCiteEvict(20, 10) → true
 *   evaluateCiteEvict(15, 10) → false
 *   evaluateCiteEvict(5, 0)   → false (off)
 *   evaluateCiteEvict(0, 10)  → false (no turns yet)
 */
function evaluateCiteEvict(turnCount, interval) {
  if (typeof interval !== "number" || interval <= 0) return false;
  if (typeof turnCount !== "number" || turnCount <= 0) return false;
  return turnCount % interval === 0;
}

/**
 * Build the cite-contract reminder body. Compact — under 10 lines. The
 * fully-specified contract lives in `.fabric/AGENTS.md` Cite policy section;
 * the reminder is a tactical re-anchor, not the canonical reference.
 *
 * Returns a multi-line string ready for hookSpecificOutput.additionalContext.
 */
function renderReminder(turnCount, interval) {
  // v2.0.0-rc.37 NEW-1: cite policy simplified 4-state → 2-state.
  // [applied] consolidates planned/recalled/chained-from; dismissed:<reason>
  // unchanged. Old tags still parse for back-compat.
  return [
    `[fabric cite-evict] long-session reminder (turn ${turnCount}, interval ${interval}):`,
    "Before edit / decide / propose plan, write KB: <id> (<≤8字 用法>) [applied|dismissed:<reason>] OR KB: none [<reason>].",
    "Verify [applied] by actually fetching KB body via fab_recall(paths) or fab_plan_context → fab_get_knowledge_sections (no fabricated ids).",
    "decisions/pitfalls [applied] cite MUST end with contract: → <operator> [<operator>...] where operator ∈ {edit:<glob> !edit:<glob> require:<symbol> forbid:<symbol> skip:<reason>}.",
    "skip reasons: sequencing | conditional | semantic | aesthetic | architectural | other:<text>.",
    "KB: none sentinels: [no-relevant] (queried but nothing matched) | [not-applicable] (pure exploration / read-only / user Q&A).",
    "Audit: fabric doctor --cite-coverage — this rule does not block work, only records.",
  ].join("\n");
}

async function main(env) {
  try {
    const cwd =
      (env && typeof env.cwd === "string" && env.cwd) ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd();

    const interval = readEvictInterval(cwd);
    if (interval <= 0) {
      return; // feature off — silent exit
    }

    // Read stdin payload (Claude Code passes hook_event_name; Codex/Cursor
    // SessionStart payloads are smaller but still JSON). Tests inject
    // env.payload to bypass the stdin read.
    const payload = env && env.payload !== undefined ? env.payload : await readStdinJson();

    // v2.0.0-rc.37 NEW-21: SessionStart-mode parity for Codex/Cursor.
    // When the hook fires on SessionStart (instead of UserPromptSubmit),
    // emit ONE unconditional cite-policy reminder to stderr. This gives
    // Codex/Cursor users the cite-contract nudge at session boot — lower
    // cadence than Claude Code's per-prompt UserPromptSubmit window, but
    // strictly better than 0 (rc.32 cite-coverage baseline 3.1% measured
    // when Codex/Cursor had no cite-reminder surface at all).
    const eventName =
      payload && typeof payload.hook_event_name === "string"
        ? payload.hook_event_name
        : null;
    const sessionStartMode =
      (env && env.forceSessionStart === true) || eventName === "SessionStart";

    const streams = (env && env.stdio) || {};

    if (sessionStartMode) {
      // One-shot stderr emit (knowledge-hint-broad convention). forceStderr
      // pins stderr even on Claude Code — Codex/Cursor parse stderr; CC
      // SessionStart also surfaces stderr to the user.
      emitContext(renderReminder(/* turnCount = */ 0, interval), {
        forceStderr: true,
        streams,
      });
      return;
    }

    // Claude Code UserPromptSubmit path (unchanged from rc.34 TASK-06).
    // Skip Claude Code-specific stdout envelope on Codex/Cursor when not
    // in SessionStart mode (no UserPromptSubmit event registration there).
    if (!isClaudeCode() && !(env && env.forceClaudeCode === true)) {
      return;
    }

    const sessionId =
      payload && typeof payload.session_id === "string" && payload.session_id.length > 0
        ? payload.session_id
        : "anonymous";

    const prior = readEvictState(cwd);
    const turnCount = prior && prior.session_id === sessionId ? prior.turn_count + 1 : 1;
    writeEvictState(cwd, sessionId, turnCount);

    if (!evaluateCiteEvict(turnCount, interval)) {
      return; // not on a window boundary — silent
    }

    // Claude Code UserPromptSubmit: stdout JSON envelope. client:'cc' forces
    // the envelope since the isClaudeCode/forceClaudeCode gate above already
    // confirmed this is the Claude Code path.
    emitContext(renderReminder(turnCount, interval), {
      client: "cc",
      eventName: "UserPromptSubmit",
      streams,
    });
  } catch {
    // Silent — never block user prompt on hook failure.
  }
}

module.exports = {
  main,
  evaluateCiteEvict,
  renderReminder,
  readEvictInterval,
  readEvictState,
  writeEvictState,
};

if (require.main === module) {
  main();
}
