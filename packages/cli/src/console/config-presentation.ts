// ---------------------------------------------------------------------------
// The settings page's PRESENTATION registry — which keys are promoted to the
// front, and which numbers move together as one choice.
//
// Everything here is decoration over `getPanelFields()`. It must never become a
// second source of truth for what fields exist (KT-DEC-0035): the field list is
// derived from the zod schema by introspection precisely so that adding a knob
// cannot require remembering to update a hand-written list somewhere else.
//
// That is why the two lookups below are one-directional. `tierOf` only knows how
// to PROMOTE; a key it has never heard of falls to "advanced" and renders
// normally. The failure this shape rules out is the one a hand-written list
// produces: a new field silently vanishing from the page because nobody updated
// the registry, with every test still green because the tests read the same
// registry.
// ---------------------------------------------------------------------------

/** Where a field sits in the two-level page. */
export type FieldTier = "common" | "advanced";

/**
 * The keys promoted out of "advanced". Seven, and the ceiling is deliberate:
 * the page's whole complaint was nineteen equal-weight rows, and a "common"
 * section that grows past a screenful reproduces it one level down.
 *
 * The test each one passes: can a person who has never read Fabric's internals
 * decide it? Language, how loudly it interrupts, whether semantic search is on,
 * whether it reminds before edits, whether it proposes archives on its own, and
 * how long the activity log is kept — all yes. Every threshold ("remind after
 * how many hours") fails it, which is what the preset below exists for.
 */
const COMMON_KEYS: ReadonlySet<string> = new Set([
  "fabric_language",
  "nudge_mode",
  "embed_enabled",
  "cite_recall_nudge",
  "self_archive_policy_enabled",
  "fabric_event_retention_days",
]);

/**
 * Unknown keys are ADVANCED, never hidden.
 *
 * @see the module docstring — this default is the invariant, not a convenience.
 */
export function tierOf(key: string): FieldTier {
  return COMMON_KEYS.has(key) ? "common" : "advanced";
}

/**
 * The eight thresholds that together answer one question — "how often should
 * Fabric interrupt me" — and that nobody can answer one at a time.
 *
 * All eight are monotone in the same direction (larger = quieter), which is what
 * makes a single low/standard/high axis honest rather than a marketing label
 * over unrelated numbers. `underseed_node_threshold` is NOT here despite sitting
 * in the same schema group: it is a corpus knob describing the knowledge base
 * ("how many entries make it seeded"), shared by the whole team, and folding it
 * into a personal reminder-frequency choice would write to everyone's store.
 */
export const ARCHIVE_PRESET_KEYS: readonly string[] = [
  "archive_hint_hours",
  "archive_hint_cooldown_hours",
  "archive_edit_threshold",
  "review_hint_pending_count",
  "review_hint_pending_age_days",
  "maintenance_hint_days",
  "maintenance_hint_cooldown_days",
  "review_stale_pending_days",
];

export interface ArchivePreset {
  readonly id: "relaxed" | "standard" | "attentive";
  readonly values: Readonly<Record<string, number>>;
}

/**
 * `standard` is byte-for-byte the schema's own defaults.
 *
 * Not a coincidence and not decoration: it means a machine where nothing has
 * ever been set reads back as "standard" rather than "custom". A preset table
 * whose middle entry disagreed with the code defaults would tell every fresh
 * install that it is running a customised configuration it never chose.
 */
export const ARCHIVE_PRESETS: readonly ArchivePreset[] = [
  {
    id: "relaxed",
    values: {
      archive_hint_hours: 72,
      archive_hint_cooldown_hours: 24,
      archive_edit_threshold: 60,
      review_hint_pending_count: 30,
      review_hint_pending_age_days: 21,
      maintenance_hint_days: 30,
      maintenance_hint_cooldown_days: 21,
      review_stale_pending_days: 30,
    },
  },
  {
    id: "standard",
    values: {
      archive_hint_hours: 24,
      archive_hint_cooldown_hours: 12,
      archive_edit_threshold: 20,
      review_hint_pending_count: 10,
      review_hint_pending_age_days: 7,
      maintenance_hint_days: 14,
      maintenance_hint_cooldown_days: 7,
      review_stale_pending_days: 14,
    },
  },
  {
    id: "attentive",
    values: {
      archive_hint_hours: 8,
      archive_hint_cooldown_hours: 4,
      archive_edit_threshold: 8,
      review_hint_pending_count: 5,
      review_hint_pending_age_days: 3,
      maintenance_hint_days: 7,
      maintenance_hint_cooldown_days: 3,
      review_stale_pending_days: 7,
    },
  },
];

export function getArchivePreset(id: string): ArchivePreset | undefined {
  return ARCHIVE_PRESETS.find((p) => p.id === id);
}

/**
 * Which preset the CURRENT VALUES amount to, or null for "custom".
 *
 * Derived every read, from the effective values themselves. Nothing records
 * "the user picked standard" — a stored preset name is a second source of truth
 * that drifts the moment one of the eight keys is edited individually, and the
 * page would then keep claiming a preset the configuration no longer matches.
 *
 * Comparison is numeric rather than strict-equal because these values also reach
 * the file by hand: a `24` typed into JSON as `"24"` resolves to the same
 * behaviour everywhere else in the system, so reporting it as "custom" would be
 * the display inventing a difference.
 */
export function matchArchivePreset(effective: Readonly<Record<string, unknown>>): string | null {
  const found = ARCHIVE_PRESETS.find((preset) =>
    ARCHIVE_PRESET_KEYS.every((key) => Number(effective[key]) === preset.values[key]),
  );
  return found?.id ?? null;
}
