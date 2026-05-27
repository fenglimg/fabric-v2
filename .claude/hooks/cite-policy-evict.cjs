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

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const FABRIC_DIR_REL = ".fabric";
const FABRIC_CONFIG_FILE = "fabric-config.json";
const EVICT_STATE_FILE = join(".fabric", ".cache", "cite-evict-state.json");

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
  const configPath = join(cwd, FABRIC_DIR_REL, FABRIC_CONFIG_FILE);
  if (!existsSync(configPath)) return DEFAULT_CITE_EVICT_INTERVAL;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const v = parsed && parsed.cite_evict_interval;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
      return v;
    }
  } catch {
    // ignore — defensive default
  }
  return DEFAULT_CITE_EVICT_INTERVAL;
}

/**
 * Read prior state sidecar. Returns `null` on first-run or any failure;
 * callers treat null as "no prior state" (caller will write fresh state
 * with turn_count=1).
 */
function readEvictState(cwd) {
  const path = join(cwd, EVICT_STATE_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (
      parsed &&
      typeof parsed.session_id === "string" &&
      typeof parsed.turn_count === "number" &&
      Number.isInteger(parsed.turn_count) &&
      parsed.turn_count >= 0
    ) {
      return parsed;
    }
  } catch {
    // ignore — corrupted sidecar is treated as no prior state
  }
  return null;
}

function writeEvictState(cwd, sessionId, turnCount) {
  const path = join(cwd, EVICT_STATE_FILE);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ session_id: sessionId, turn_count: turnCount }));
  } catch {
    // best-effort — counter loss is acceptable, hook never blocks
  }
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

/**
 * Detect Claude Code via CLAUDE_PROJECT_DIR env. Same single-bit signal used
 * by knowledge-hint-broad.cjs rc.33 W4 review-fix (Gemini High-1). Codex /
 * Cursor don't set this var.
 */
function isClaudeCode() {
  return (
    typeof process.env.CLAUDE_PROJECT_DIR === "string" &&
    process.env.CLAUDE_PROJECT_DIR.length > 0
  );
}

async function readStdinJson() {
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(buffer));
      } catch {
        resolve(null);
      }
    });
    process.stdin.on("error", () => resolve(null));
    // Defensive timeout: if stdin never closes (host bug), give up after 1s.
    setTimeout(() => resolve(null), 1000).unref();
  });
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

    // Skip Claude Code-specific stdout envelope on Codex/Cursor. Counter
    // bookkeeping also skipped — there's no fire path on those clients.
    if (!isClaudeCode() && !(env && env.forceClaudeCode === true)) {
      return;
    }

    // Read stdin payload to learn session_id. Tests inject env.payload to
    // bypass the stdin read; production reads JSON envelope from stdin.
    const payload = env && env.payload !== undefined ? env.payload : await readStdinJson();
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

    const reminder = renderReminder(turnCount, interval);
    const out = (env && env.stdio && env.stdio.stdout) || process.stdout;
    try {
      const envelope = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: reminder,
        },
      };
      out.write(`${JSON.stringify(envelope)}\n`);
    } catch {
      // best-effort
    }
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
