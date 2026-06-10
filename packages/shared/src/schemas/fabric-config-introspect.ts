import { z } from "zod";

import {
  auditModeSchema,
  defaultLayerFilterSchema,
  fabricConfigSchema,
  fabricLanguageSchema,
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
//   tuning, 10 keys) and explicitly out of panel scope per
//   .workflow/.lite-plan/rc16-config-i18n-closure-2026-05-15/planning-context.md
//   ("Anti-scope: Group D / Group E config keys in panel — power users edit JSON").
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

export type PanelFieldGroup = "A_locale" | "B_hint_threshold" | "C_audit";

export type ValidateResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface PanelFieldMeta {
  /** Schema key this field edits (plus the virtual global-routed `fabric_language`). */
  readonly key: PanelFieldKey;
  /** Logical grouping for panel section headers. */
  readonly group: PanelFieldGroup;
  /** Clack widget hint — `select` for enums, `text` for free-form numbers. */
  readonly widget: "select" | "text";
  /** i18n key for the field label; strings landed in TASK-006. */
  readonly label_i18n_key: string;
  /** i18n key for the field's description / help text. */
  readonly description_i18n_key: string;
  /** Default value pulled from the Zod schema's `.default(...)`. */
  readonly default: string | number;
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
): PanelFieldMeta {
  return {
    key,
    group: "B_hint_threshold",
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
): PanelFieldMeta {
  return {
    key,
    group,
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
 * Group A (2) + Group B (8) + Group C (1) = 11 entries.
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
  makeEnumField("fabric_language", "A_locale", fabricLanguageSchema.options, "en"),
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
  makePositiveIntField(
    "underseed_node_threshold",
    pickNumberDefault("underseed_node_threshold"),
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
];
