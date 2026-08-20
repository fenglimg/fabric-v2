import { z } from "zod";

import {
  auditModeSchema,
  defaultLayerFilterSchema,
  fabricConfigSchema,
  fabricLanguageSchema,
  hintDismissSignalSchema,
  nudgeModeSchema,
} from "./fabric-config.js";

// rc.16 TASK-005 (F1-introspect): schema-introspection helper that exposes
// metadata for the `fabric config` clack TUI panel (Group A locale + Group B
// hint thresholds + Group C audit). Single source of truth — adding a panel
// field requires one entry here, NOT a parallel edit in commands/config.ts.
//
// Group B count reconciliation (user spec said 8, schema audit found 8):
//   Per the user's enumerated list in TASK-005.json, Group B contains 7
//   keys: archive_hint_hours, archive_hint_cooldown_hours,
//   underseed_node_threshold, review_hint_pending_count,
//   review_hint_pending_age_days, maintenance_hint_days,
//   maintenance_hint_cooldown_days. Reading fabric-config.ts:86 end-to-end
//   surfaces an 8th hint-threshold key — `archive_edit_threshold` — whose
//   docstring identifies it as the Signal A edit-count cutoff (a fabric-hint
//   threshold equivalent in shape and intent to the other 7). It is included
//   here to honor the user spec's stated count of 8 and to give the panel
//   parity coverage of every fabric-hint Stop-hook tunable.
//
//   The remaining `import_*`, `archive_max_*`, `archive_digest_*`,
//   `review_topic_*`, `review_stale_*` keys are Group D (skill-internal
//   tuning, 10 keys) and explicitly out of panel scope: power users edit the
//   JSON directly rather than going through the panel.
//
// Group C: only `audit_mode` is panel-scoped. The remaining schema fields
// (`clientPaths`, `scanIgnores`, `mcpPayloadLimits`)
// are Group E plumbing — also out of panel scope.

// Use the inferred schema type (NOT the FabricConfig interface in
// types/config.ts, which is incomplete and lacks the Group B threshold keys).
// This guarantees `keyof PanelFieldKey` stays in lockstep with the schema.
export type FabricConfigSchemaShape = z.infer<typeof fabricConfigSchema>;

// grill-6fixes (D1): `fabric_language` is no longer a project-config key but is
// still surfaced as a panel field (config.ts routes its read/write to the
// global config). Panel keys are therefore schema keys plus that one virtual
// global-routed key.
export type PanelFieldKey = keyof FabricConfigSchemaShape | "fabric_language";

export type PanelFieldGroup = "A_locale" | "B_hint_threshold" | "C_audit" | "D_behavior";

/**
 * config-single-home W6 — WHERE this field's value actually lives.
 *
 * The panel used to write every field into `.fabric/fabric-config.json`. Since
 * W5 made the repo config identity-only, nothing reads a policy key from there:
 * a panel edit was persisted and then silently ignored. Carrying the home in the
 * field metadata is what lets one read/write router send each key to the single
 * place its readers look at.
 *
 *   global_root — a top-level key of `~/.fabric/fabric-global.json` (language).
 *   preference  — `projects[<project_id>]` ?? `defaults` in the global config.
 *   corpus      — `store-config.json` at the bound team store root; the key must
 *                 also be declared in `storeConfigSchema` (schemas/store.ts).
 */
export type PanelFieldHome = "global_root" | "preference" | "corpus";

export type ValidateResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface PanelFieldMeta {
  /** Schema key this field edits (plus the virtual global-routed `fabric_language`). */
  readonly key: PanelFieldKey;
  /** Logical grouping for panel section headers. */
  readonly group: PanelFieldGroup;
  /** The single config home this field is read from and written to (W6). */
  readonly home: PanelFieldHome;
  /**
   * JSON value type of the stored config value. Drives non-interactive
   * `fabric config --get/--set/--list` coercion + display; orthogonal to
   * `widget` (UI presentation) and `enum_values` (allowed set).
   */
  readonly type: "boolean" | "number" | "string" | "string[]";
  /**
   * Widget hint — `select` for enums, `text` for free-form numbers,
   * `multiselect` for a SET drawn from `enum_values`.
   *
   * `multiselect` values cross the `validate` / `format_for_display` boundary as
   * a comma-joined string, because that boundary is `(raw: string) => value` for
   * every field and a second shape there would fork every caller. The stored
   * value is still the array the schema declares — `validate` returns it.
   */
  readonly widget: "select" | "text" | "multiselect";
  /** i18n key for the field label; strings landed in TASK-006. */
  readonly label_i18n_key: string;
  /** i18n key for the field's description / help text. */
  readonly description_i18n_key: string;
  /**
   * Default value pulled from the Zod schema's `.default(...)`, in the field's
   * OWN JSON type. W6 widened this to include `boolean`: `--list` / `--get` fall
   * back to it when no layer set the key, and a stringified `"true"` there reads
   * as a string value rather than the boolean the config actually holds.
   */
  readonly default: string | number | boolean;
  /** Enum options for `select` widgets, derived from the Zod enum schema. */
  readonly enum_values?: readonly string[];
  /** Validates raw user input from the TUI prompt. */
  validate(raw: string): ValidateResult;
  /** Renders a stored value back to the panel display string. */
  format_for_display(value: unknown): string;
}

// Positive-integer validator shared by all Group B threshold fields.
// Uses `z.coerce.number().int().positive()` to mirror the schema constraint.
const positiveIntSchema = z.coerce.number().int().positive();

function makePositiveIntField(
  key: keyof FabricConfigSchemaShape,
  defaultValue: number,
  home: PanelFieldHome = "preference",
): PanelFieldMeta {
  return {
    key,
    group: "B_hint_threshold",
    home,
    type: "number",
    widget: "text",
    label_i18n_key: `cli.config.fields.${key}.label`,
    description_i18n_key: `cli.config.fields.${key}.description`,
    default: defaultValue,
    validate(raw: string): ValidateResult {
      const trimmed = raw.trim();
      if (trimmed === "") {
        return { ok: false, error: "Value is required (positive integer)." };
      }
      const parsed = positiveIntSchema.safeParse(trimmed);
      if (!parsed.success) {
        return {
          ok: false,
          error: "Must be a positive integer (e.g. 1, 12, 24).",
        };
      }
      return { ok: true, value: parsed.data };
    },
    format_for_display(value: unknown): string {
      if (typeof value === "number") return String(value);
      if (value === undefined || value === null) return String(defaultValue);
      return String(value);
    },
  };
}

function makeEnumField(
  key: PanelFieldKey,
  group: PanelFieldGroup,
  enumValues: readonly string[],
  defaultValue: string,
  home: PanelFieldHome = "preference",
): PanelFieldMeta {
  return {
    key,
    group,
    home,
    type: "string",
    widget: "select",
    label_i18n_key: `cli.config.fields.${key}.label`,
    description_i18n_key: `cli.config.fields.${key}.description`,
    default: defaultValue,
    enum_values: enumValues,
    validate(raw: string): ValidateResult {
      const trimmed = raw.trim();
      if (!enumValues.includes(trimmed)) {
        return {
          ok: false,
          error: `Must be one of: ${enumValues.join(", ")}.`,
        };
      }
      return { ok: true, value: trimmed };
    },
    format_for_display(value: unknown): string {
      if (typeof value === "string" && enumValues.includes(value)) return value;
      if (value === undefined || value === null) return defaultValue;
      return String(value);
    },
  };
}

// Boolean field rendered as a true/false select. Config values are stored as
// real JSON booleans; the widget speaks "true"/"false" strings and validate()
// maps them back to the boolean the schema expects.
function makeBooleanField(key: keyof FabricConfigSchemaShape, defaultValue: boolean): PanelFieldMeta {
  return {
    key,
    group: "D_behavior",
    home: "preference",
    type: "boolean",
    widget: "select",
    label_i18n_key: `cli.config.fields.${key}.label`,
    description_i18n_key: `cli.config.fields.${key}.description`,
    default: defaultValue,
    enum_values: ["true", "false"],
    validate(raw: string): ValidateResult {
      const trimmed = raw.trim();
      if (trimmed === "true") return { ok: true, value: true };
      if (trimmed === "false") return { ok: true, value: false };
      return { ok: false, error: "Must be one of: true, false." };
    },
    format_for_display(value: unknown): string {
      if (typeof value === "boolean") return String(value);
      if (value === undefined || value === null) return String(defaultValue);
      return String(value);
    },
  };
}

/**
 * A field holding a SET of enum values (currently only `hint_dismiss_signals`).
 *
 * The wire form across `validate` / `format_for_display` is a comma-joined
 * string — the panel boundary is `(raw: string) => value` for every field, and
 * a second shape there would fork every caller for one field's benefit. What
 * gets STORED is the array the schema declares.
 *
 * `default` is the empty string rather than `[]`: `PanelFieldMeta.default` is
 * the DISPLAY default (`--get` / `--list` fall back to it), and it is typed to
 * the scalar the field renders as. An empty set renders as nothing selected.
 */
function makeMultiSelectField(
  key: keyof FabricConfigSchemaShape,
  group: PanelFieldGroup,
  allowed: readonly string[],
): PanelFieldMeta {
  return {
    key,
    group,
    home: "preference",
    type: "string[]",
    widget: "multiselect",
    label_i18n_key: `cli.config.fields.${key}.label`,
    description_i18n_key: `cli.config.fields.${key}.description`,
    default: "",
    enum_values: allowed,
    validate(raw: string): ValidateResult {
      // An empty input is "select nothing", a legitimate value — not an error.
      // Refusing it would leave no way back from a dismissal except a reset.
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      const unknown = parts.filter((p) => !allowed.includes(p));
      if (unknown.length > 0) {
        return { ok: false, error: `Unknown value(s): ${unknown.join(", ")}.` };
      }
      // De-duplicated and ordered by the enum, so the stored array is a set and
      // two equivalent selections cannot produce two different files.
      return { ok: true, value: allowed.filter((a) => parts.includes(a)) };
    },
    format_for_display(value: unknown): string {
      return Array.isArray(value) ? value.map(String).join(",") : "";
    },
  };
}

/**
 * A numeric field whose allowed values are a small fixed set (currently only
 * `fabric_event_retention_days`, locked to 7/30/90). Rendered as a picker like
 * an enum, but stored — and reported by `--get`/`--list` — as a real number, so
 * the config file never grows a `"30"` string a numeric reader would reject.
 */
function makeNumericEnumField(
  key: keyof FabricConfigSchemaShape,
  group: PanelFieldGroup,
  allowed: readonly number[],
  defaultValue: number,
): PanelFieldMeta {
  const labels = allowed.map(String);
  return {
    key,
    group,
    home: "preference",
    type: "number",
    widget: "select",
    label_i18n_key: `cli.config.fields.${key}.label`,
    description_i18n_key: `cli.config.fields.${key}.description`,
    default: defaultValue,
    enum_values: labels,
    validate(raw: string): ValidateResult {
      const n = Number(raw.trim());
      if (!allowed.includes(n)) {
        return { ok: false, error: `Must be one of: ${labels.join(", ")}.` };
      }
      return { ok: true, value: n };
    },
    format_for_display(value: unknown): string {
      return typeof value === "number" && allowed.includes(value)
        ? String(value)
        : String(defaultValue);
    },
  };
}

// Defaults are read from the Zod schema's parse output to guarantee parity:
// any future change to fabric-config.ts `.default(...)` flows through here
// without a manual edit. We parse `{}` once at module load — Zod fills in
// every defaulted optional field.
const SCHEMA_DEFAULTS = fabricConfigSchema.parse({}) as FabricConfigSchemaShape;

function pickNumberDefault(key: keyof FabricConfigSchemaShape): number {
  const v = SCHEMA_DEFAULTS[key];
  if (typeof v !== "number") {
    throw new Error(
      `fabric-config-introspect: expected numeric default for ${String(key)}, got ${typeof v}`,
    );
  }
  return v;
}

function pickStringDefault(key: keyof FabricConfigSchemaShape): string {
  const v = SCHEMA_DEFAULTS[key];
  if (typeof v !== "string") {
    throw new Error(
      `fabric-config-introspect: expected string default for ${String(key)}, got ${typeof v}`,
    );
  }
  return v;
}

// Audit mode has no `.default(...)` in the schema (it's plain `.optional()`).
// Panel default falls back to "warn" — the safest middle-ground choice when
// a user opens the panel for an audit_mode-less config.
const AUDIT_MODE_PANEL_DEFAULT = "warn";

/**
 * Returns the per-field metadata array driving the `fabric config` clack panel.
 * Group A (2) + Group B (9) + Group C (1) + Group D (7) = 19 entries.
 */
export function getPanelFields(): readonly PanelFieldMeta[] {
  return PANEL_FIELDS;
}

/**
 * Lookup a single panel field by its config key. Returns `undefined` if the
 * key is not panel-scoped (e.g. Group D/E plumbing).
 */
export function getPanelFieldByKey(
  key: string,
): PanelFieldMeta | undefined {
  return PANEL_FIELDS.find((f) => f.key === key);
}

const PANEL_FIELDS: readonly PanelFieldMeta[] = [
  // --- Group A: Locale (2) ---
  // grill-6fixes (D1): `fabric_language` is no longer a project-config field —
  // it is the single machine-wide tone in `~/.fabric/fabric-global.json`. The
  // panel still surfaces it (the `fabric config` language entry), but config.ts
  // special-cases this key to read/write the GLOBAL config instead of the
  // project file. Default is a literal "en" since there is no project-schema
  // default to derive from.
  makeEnumField("fabric_language", "A_locale", fabricLanguageSchema.options, "en", "global_root"),
  makeEnumField(
    "default_layer_filter",
    "A_locale",
    defaultLayerFilterSchema.options,
    pickStringDefault("default_layer_filter"),
  ),

  // --- Group B: Hint thresholds (8 — see leading docstring for the
  //     7-vs-8 reconciliation; archive_edit_threshold is the 8th key) ---
  makePositiveIntField("archive_hint_hours", pickNumberDefault("archive_hint_hours")),
  makePositiveIntField(
    "archive_hint_cooldown_hours",
    pickNumberDefault("archive_hint_cooldown_hours"),
  ),
  makePositiveIntField(
    "archive_edit_threshold",
    pickNumberDefault("archive_edit_threshold"),
  ),
  // W6: a CORPUS knob — `storeConfigSchema` owns it, so it is read from (and
  // written to) the bound team store's store-config.json, never the global
  // policy segments. "how many entries make a seeded KB" is a property of the
  // knowledge base, not of the person using it.
  makePositiveIntField(
    "underseed_node_threshold",
    pickNumberDefault("underseed_node_threshold"),
    "corpus",
  ),
  makePositiveIntField(
    "review_hint_pending_count",
    pickNumberDefault("review_hint_pending_count"),
  ),
  makePositiveIntField(
    "review_hint_pending_age_days",
    pickNumberDefault("review_hint_pending_age_days"),
  ),
  makePositiveIntField(
    "maintenance_hint_days",
    pickNumberDefault("maintenance_hint_days"),
  ),
  makePositiveIntField(
    "maintenance_hint_cooldown_days",
    pickNumberDefault("maintenance_hint_cooldown_days"),
  ),

  // --- Group C: Audit (1) ---
  makeEnumField(
    "audit_mode",
    "C_audit",
    auditModeSchema.options,
    AUDIT_MODE_PANEL_DEFAULT,
  ),

  // --- Group D: Behavior / features (2) ---
  // nudge_mode — the master switch for the human-visible nudge experience
  // (the most user-facing runtime knob, previously JSON-only). embed_enabled —
  // vector semantic recall, panel-editable now that config lives in `.fabric`
  // (A1). TASK-004: default ON (fastembed is an optionalDependency, degrade-safe
  // when absent) — this introspection default mirrors the runtime read in
  // config-loader.ts so the panel never shows a default that contradicts behavior.
  makeEnumField("nudge_mode", "D_behavior", nudgeModeSchema.options, "normal"),
  makeBooleanField("embed_enabled", true),
  // config-single-home W8: five knobs that a person genuinely decides but that
  // were JSON-only until now — the two behavior policies, the recall nudge, how
  // long the activity ledger is kept, and when review calls a pending entry
  // stale. They are added here (not left to "power users edit JSON") because
  // each answers a question a user actually has; the retrieval-tuning and
  // plumbing keys stay out, since a panel entry you cannot judge is noise.
  makeBooleanField("cite_policy_enabled", true),
  makeBooleanField("self_archive_policy_enabled", true),
  makeBooleanField("cite_recall_nudge", true),
  makeNumericEnumField("fabric_event_retention_days", "D_behavior", [7, 30, 90], 30),
  makePositiveIntField(
    "review_stale_pending_days",
    pickNumberDefault("review_stale_pending_days"),
  ),
  // P1 recall-engine-refactor (follow-up): the content-channel fusion strategy,
  // panel-editable so it sits next to embed_enabled (the two go together — rrf
  // only pays off when embeddings are on). 'auto' is the safe adaptive default.
  makeEnumField("fusion", "D_behavior", ["additive", "rrf", "auto"], "auto"),
  // The escape hatch for "stop telling me about this". It was JSON-only, which
  // is a contradiction the nudge text itself made visible: the message that
  // offers to be silenced pointed at a file the user had to hand-edit. Options
  // come from the schema enum rather than a copy, so a nudge surface added later
  // becomes silenceable without a second edit here.
  makeMultiSelectField("hint_dismiss_signals", "D_behavior", hintDismissSignalSchema.options),
];
