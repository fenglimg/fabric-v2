import { z } from "zod";

// ---------------------------------------------------------------------------
// config-single-home W8 — cadence profiles.
//
// After W7 folded the six presentation knobs into `nudge_mode`, what is left for
// a person to decide is still spread across four keys: how loud Fabric is, how
// eagerly it asks to archive, and how long a review backlog may sit. Those move
// TOGETHER — a user who wants Fabric to nag less wants all four relaxed, not one
// of them — so the useful unit of choice is a profile, not a key.
//
// A profile is a plain preset written into the SAME home the individual keys
// live in (`~/.fabric/fabric-global.json` → `defaults`, or `projects[<id>]`).
// It is NOT a new layer and it is NOT recorded anywhere: applying one writes the
// keys and then gets out of the way, so a later single-key edit simply wins with
// no "profile vs override" precedence to reason about. `detectProfile` exists
// only to LABEL a config that happens to match a preset exactly.
//
//   quiet    — Fabric stays out of the way; you drive archiving yourself.
//   standard — the shipped cadence (matches GLOBAL_POLICY_DEFAULTS).
//   coach    — for a young knowledge base: asks often, so the corpus grows.
// ---------------------------------------------------------------------------

export const CONFIG_PROFILE_NAMES = ["quiet", "standard", "coach"] as const;
export type ConfigProfileName = (typeof CONFIG_PROFILE_NAMES)[number];

export const configProfileNameSchema = z.enum(CONFIG_PROFILE_NAMES);

/**
 * The keys a profile owns. Anything outside this set is untouched when a profile
 * is applied — a profile is a cadence preset, not a config reset.
 */
export const CONFIG_PROFILE_KEYS = [
  "nudge_mode",
  "archive_edit_threshold",
  "archive_hint_hours",
  "review_hint_pending_count",
] as const;

export const CONFIG_PROFILES: Readonly<
  Record<ConfigProfileName, Readonly<Record<(typeof CONFIG_PROFILE_KEYS)[number], string | number>>>
> = {
  quiet: {
    nudge_mode: "silent",
    // ~2× the standard cadence: you archive when you decide to, not when nudged.
    archive_edit_threshold: 40,
    archive_hint_hours: 48,
    review_hint_pending_count: 20,
  },
  standard: {
    // Value-for-value the shipped defaults (GLOBAL_POLICY_DEFAULTS + the schema
    // defaults for the other three), so "apply standard" and "never configured"
    // are the same workspace.
    nudge_mode: "minimal",
    archive_edit_threshold: 20,
    archive_hint_hours: 24,
    review_hint_pending_count: 10,
  },
  coach: {
    nudge_mode: "verbose",
    // Half the standard cadence. A knowledge base only becomes useful once it
    // has entries, and the first weeks are when knowledge is most often lost.
    archive_edit_threshold: 10,
    archive_hint_hours: 8,
    review_hint_pending_count: 5,
  },
};

/**
 * The profile whose every key matches `config`, or null when the values are a
 * mix (the common case once someone tunes one knob). Purely a display aid —
 * nothing branches on it.
 */
export function detectProfile(config: Record<string, unknown>): ConfigProfileName | null {
  for (const name of CONFIG_PROFILE_NAMES) {
    const preset = CONFIG_PROFILES[name];
    if (CONFIG_PROFILE_KEYS.every((key) => config[key] === preset[key])) {
      return name;
    }
  }
  return null;
}
