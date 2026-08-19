// ---------------------------------------------------------------------------
// Which runtime behaviour each shipped hook is, and which config keys tune it.
//
// The console's settings page derives its field list from the schema and needs
// no table at all. This page needs one, because "which hook reads this key" is
// not a fact any schema carries — it is a fact about seven `.cjs` files. So the
// table is hand-written, and every hand-written thing here is fenced by a test
// that checks it against the live registries (KT-DEC-0035): every id must be a
// real hook script, every key a real panel key, and the three buckets below must
// between them account for EVERY project-scoped panel key.
//
// That last fence is the point. Without it, a key added to the schema would
// simply not appear here, and nobody would notice — which is how the four keys
// in UNWIRED_BEHAVIOR_KEYS got to where they are.
// ---------------------------------------------------------------------------

export interface BehaviorSpec {
  /** Hook script basename without `.cjs` — must exist in HOOK_SCRIPT_DESTINATIONS. */
  id: string;
  /**
   * Panel keys this hook (or a lib it requires) actually reads. Attribution is
   * by the require graph, not by theme: `hint_dismiss_signals` sits on four
   * behaviours because four scripts read it, and showing it on only one would
   * make turning it off look narrower than it is.
   */
  keys: readonly string[];
}

export const BEHAVIORS: readonly BehaviorSpec[] = [
  {
    // Stop — the end-of-turn reminder to archive / review / do maintenance.
    id: "fabric-hint",
    keys: [
      "nudge_mode",
      "hint_dismiss_signals",
      "archive_hint_hours",
      "archive_hint_cooldown_hours",
      "archive_edit_threshold",
      "review_hint_pending_count",
      "review_hint_pending_age_days",
      "maintenance_hint_days",
      "maintenance_hint_cooldown_days",
    ],
  },
  {
    // SessionStart — the always-active knowledge index injected at boot.
    id: "knowledge-hint-broad",
    keys: ["nudge_mode", "hint_dismiss_signals", "maintenance_hint_days", "review_hint_pending_age_days"],
  },
  {
    // PreToolUse — the "you are about to edit this file, here is what is known
    // about it" nudge. Reads its knobs through lib/knowledge-hint-narrow.cjs.
    id: "knowledge-pretooluse",
    keys: ["nudge_mode", "hint_dismiss_signals"],
  },
  {
    // SubagentStart — a sub-agent inherits nothing, so it gets its own injection.
    id: "knowledge-hint-subagent",
    keys: [],
  },
  {
    // Cite accounting reminder (Claude Code: per prompt; Codex: once per boot).
    id: "cite-policy-evict",
    keys: ["cite_recall_nudge", "hint_dismiss_signals"],
  },
  {
    // PostToolUse — records that a file was edited, or a knowledge body read.
    // No knobs: it is the measurement the other behaviours are computed from,
    // and a switch here would silently disable them.
    id: "post-tooluse-mutation",
    keys: [],
  },
  {
    // SessionEnd — one append so the next session knows this one ended.
    id: "session-end-marker",
    keys: [],
  },
];

/**
 * Panel keys read by the server or the CLI rather than by a hook.
 *
 * They are real settings with real consumers; they are simply not behaviours
 * this page can report on, because nothing in the project tree implements them.
 * The settings page is where they belong.
 */
export const NON_HOOK_KEYS: readonly string[] = [
  "fabric_language", // machine-wide render locale, read by every surface
  "default_layer_filter", // server: which layers recall searches
  "embed_enabled", // server: vector channel (the settings page reports its state)
  "fusion", // server: how lexical and vector scores combine
  "fabric_event_retention_days", // server: event-ledger rotation window
];

/**
 * Panel keys that NOTHING reads.
 *
 * Each is declared in the schema, rendered by the settings page as a working
 * control, and consumed by zero code — verified by a full-repo census, and by
 * the fact that no producer→consumer test covers any of them (the only tests
 * they have are schema round-trips, which pass whether or not anyone reads the
 * value: KT-PIT-0065, capability built but never wired).
 *
 * They are listed rather than fixed because wiring or retiring each one is a
 * product decision about the feature behind it, not a console change. Listing
 * them does two things a comment could not: it keeps them OFF this page (a
 * behaviour row for a switch that does nothing would be the exact lie the page
 * exists to prevent), and it makes the partition fence below total, so the next
 * key to lose its last consumer has to be added here deliberately.
 *
 * `review_stale_pending_days` is the sharpest of the four: the settings page's
 * preset cards WRITE it three different values, so a user picking a preset is
 * told they changed a threshold that no code consults.
 */
export const UNWIRED_BEHAVIOR_KEYS: readonly string[] = [
  "audit_mode",
  "cite_policy_enabled",
  "self_archive_policy_enabled",
  "review_stale_pending_days",
];
