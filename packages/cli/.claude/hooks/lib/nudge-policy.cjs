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

const NUDGE_MODES = ["silent", "minimal", "normal", "verbose"];
const DEFAULT_NUDGE_MODE = "normal";
// The three observe.* event keys, mirroring observeConfigSchema in
// packages/shared/src/schemas/fabric-config.ts. Hooks pass the matching key.
const OBSERVE_EVENTS = ["session_start", "pre_tool_use", "stop"];

/**
 * Resolve the configured nudge_mode preset. Unknown / absent → "normal".
 */
function readNudgeMode(projectRoot) {
  try {
    const v = readConfig(projectRoot).nudge_mode;
    return typeof v === "string" && NUDGE_MODES.includes(v) ? v : DEFAULT_NUDGE_MODE;
  } catch {
    return DEFAULT_NUDGE_MODE;
  }
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
