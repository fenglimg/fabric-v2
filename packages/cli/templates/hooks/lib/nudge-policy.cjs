/**
 * v2.2 dual-sink (Goal A / D4): nudge_mode + observe.* resolver for hook scripts.
 *
 * This lib answers ONE question for the human-facing sink: given the configured
 * nudge_mode preset, the per-event observe.* overrides, and the event's
 * structural gate (PreToolUse hit / Stop value), should this lifecycle event
 * emit a human-facing `systemMessage`, and at what verbosity?
 *
 * CORE INVARIANT (D5 / KT-DEC-0007): this resolver governs ONLY the human sink.
 * It has NO say over the AI sink (`hookSpecificOutput.additionalContext`). The
 * model receives the same knowledge regardless of how quiet the human channel
 * is — flow ⊥ observation. There is deliberately no `emitAi()` here; callers
 * always compute and emit the AI payload unconditionally, then ask this resolver
 * whether to additionally surface a human breadcrumb. The dedicated invariant
 * test asserts that no nudge_mode / observe combination changes the AI branch.
 *
 * Resolution order for `resolveHumanSink(projectRoot, event, gate)`:
 *   1. observe.<event> === false      → suppress (explicit per-event mute wins)
 *   2. structural gate fails           → suppress (PreToolUse miss / Stop low-value:
 *      nothing meaningful to show the human, mode-independent per C5/D2/D6)
 *   3. observe.<event> === true        → emit (explicit per-event opt-in)
 *   4. nudge_mode === "silent"         → suppress (global human-channel mute)
 *   5. otherwise                       → emit at the preset's verbosity
 *
 * `verbosity` (minimal | normal | verbose) is forwarded to the renderer so it
 * can scale the human breadcrumb's detail; it never affects the AI payload.
 *
 * Never-throw contract: any read/parse failure degrades to the "normal" preset
 * with the structural gate respected — a malfunctioning config must not silence
 * the human channel by surprise (it falls back to the historical visible
 * behavior), nor block the hook.
 */

const { readConfig } = require("./config-cache.cjs");
const { readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join: pathJoin } = require("node:path");

const NUDGE_MODES = ["silent", "minimal", "normal", "verbose"];
// G2 (GRL-STOPHOOK-AIONLY-20260709) boundary decision:
//   DEFAULT stays "normal" — flipping to "silent" would mute existing users'
//   SessionStart / PreToolUse hooks whose fabric-config.json lacks the
//   nudge_mode field (old installs), and boundary_contract out_of_scope
//   explicitly forbids SessionStart / PreToolUse silent-defaulting (Q(open-3)
//   independent evaluation). NEW installs still get silent by G1
//   install-scaffold writing nudge_mode: "silent" into fabric-config.json.
//   Deviates from TASK-002 GREEN step 3 ("DEFAULT_NUDGE_MODE = 'silent'") —
//   documented caveat: boundary trumps plan text.
const DEFAULT_NUDGE_MODE = "normal";
// The three observe.* event keys, mirroring observeConfigSchema in
// packages/shared/src/schemas/fabric-config.ts. Hooks pass the matching key.
const OBSERVE_EVENTS = ["session_start", "pre_tool_use", "stop"];

/**
 * Resolve the configured nudge_mode preset with 4-layer priority (highest first):
 *   1. env `FABRIC_NUDGE_MODE`             — opt-in override, no repo edits
 *   2. project `.fabric/fabric-config.json` — per-repo setting (existing)
 *   3. global `~/.fabric/fabric-global.json` — machine-wide preference
 *   4. default `"silent"`                    — G1 human-mute alignment
 *
 * Any layer whose value is missing / not-a-string / not in NUDGE_MODES silently
 * falls through to the next. Never throws — a broken config MUST NOT block hooks
 * (see file-header Never-throw contract).
 */
function readNudgeMode(projectRoot) {
  // Layer 1: env var. Highest priority — an ergonomic override no repo edit.
  const envMode = process.env.FABRIC_NUDGE_MODE;
  if (typeof envMode === "string" && NUDGE_MODES.includes(envMode)) {
    return envMode;
  }
  // Layer 2: project config (existing behaviour). Uses readConfig cache.
  try {
    const projectMode = readConfig(projectRoot).nudge_mode;
    if (typeof projectMode === "string" && NUDGE_MODES.includes(projectMode)) {
      return projectMode;
    }
  } catch {
    // fall through
  }
  // Layer 3: global config at ~/.fabric/fabric-global.json. Read raw (no cache
  // for now — cheap, rarely hit hot path). Never-throw on any I/O or JSON error.
  try {
    const globalPath = pathJoin(homedir(), ".fabric", "fabric-global.json");
    const raw = readFileSync(globalPath, "utf8");
    const parsed = JSON.parse(raw);
    const globalMode = parsed && parsed.nudge_mode;
    if (typeof globalMode === "string" && NUDGE_MODES.includes(globalMode)) {
      return globalMode;
    }
  } catch {
    // fall through
  }
  // Layer 4: hard default (DEFAULT_NUDGE_MODE = "normal" per G2 boundary caveat —
  // see JSDoc at DEFAULT_NUDGE_MODE for why not "silent").
  return DEFAULT_NUDGE_MODE;
}

/**
 * Resolve the per-event observe.* override for one event. Returns a strict
 * boolean when explicitly set, otherwise undefined (preset decides). Tolerant of
 * a malformed observe value (non-object → undefined).
 */
function readObserveOverride(projectRoot, event) {
  try {
    const observe = readConfig(projectRoot).observe;
    if (!observe || typeof observe !== "object") return undefined;
    const v = observe[event];
    return typeof v === "boolean" ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decide whether `event` should emit a human-facing systemMessage, and at what
 * verbosity. `gate` carries the event's structural signal:
 *   - { hit: boolean }       for pre_tool_use (false = narrow miss → suppress)
 *   - { highValue: boolean } for stop         (false = no high-value archive
 *                                              candidate → suppress, D6 value-gate)
 *   - {}                     for session_start (no structural gate)
 * Omitting a gate field means "gate passes" (e.g. session_start never gates).
 *
 * Returns { emitHuman: boolean, verbosity: "minimal"|"normal"|"verbose", mode }.
 */
function resolveHumanSink(projectRoot, event, gate) {
  const mode = readNudgeMode(projectRoot);
  const verbosity = mode === "silent" ? "minimal" : mode;
  const override = OBSERVE_EVENTS.includes(event)
    ? readObserveOverride(projectRoot, event)
    : undefined;

  // 1. explicit per-event mute wins over everything (even a hit).
  if (override === false) return { emitHuman: false, verbosity, mode };

  // 2. structural gate (mode-independent, C5/D2/D6): nothing to show → mute.
  const g = gate || {};
  if (event === "pre_tool_use" && g.hit === false) {
    return { emitHuman: false, verbosity, mode };
  }
  if (event === "stop" && g.highValue === false) {
    return { emitHuman: false, verbosity, mode };
  }

  // 3. explicit per-event opt-in (gate already passed above).
  if (override === true) return { emitHuman: true, verbosity, mode };

  // 4. global human-channel mute.
  if (mode === "silent") return { emitHuman: false, verbosity, mode };

  // 4b. v2.2 C1 (W5): the `stop` human nudge (archive cadence) defaults to QUIET.
  // The edit-count / session signal already lives in the events.jsonl ledger as
  // queryable telemetry (KT-DEC-0030), so the Stop hook should NOT carry a
  // real-time human-observation UI that interrupts execution flow — find the
  // specific session after the fact instead (user directive 2026-06-22). It stays
  // OBSERVE-only by default; opt back in explicitly via observe.stop=true (handled
  // at step 3) or the verbose preset. SessionStart / pre_tool_use are unaffected.
  if (event === "stop" && mode !== "verbose") {
    return { emitHuman: false, verbosity, mode };
  }

  // 5. preset default — emit at the preset's verbosity.
  return { emitHuman: true, verbosity, mode };
}

module.exports = {
  readNudgeMode,
  readObserveOverride,
  resolveHumanSink,
  NUDGE_MODES,
  DEFAULT_NUDGE_MODE,
  OBSERVE_EVENTS,
};
