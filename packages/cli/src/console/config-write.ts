// ---------------------------------------------------------------------------
// `POST /api/config` — change one config value from the console.
//
// The closed-set discipline from `/api/open` applies again, one level up: the
// request names a PANEL KEY, and anything outside `getPanelFields()` is refused.
// Accepting an arbitrary config key would make this endpoint a general-purpose
// writer into `~/.fabric/fabric-global.json`, where a typo'd key lands silently
// and a well-chosen one (`stores`, `uid`) corrupts machine-wide state. A closed
// set has nothing to get wrong.
//
// Values are not trusted either: they go through the field's own `validate()`,
// and what gets persisted is validate's RETURN value, not the request's. That is
// how `"42"` from an HTML input becomes the number 42 the readers expect —
// writing the string back would produce a config a numeric reader rejects, i.e.
// a value the page shows and nothing honours.
// ---------------------------------------------------------------------------

import { envOverrideFor, getPanelFieldByKey } from "@fenglimg/fabric-shared";

import { t } from "../i18n.js";
import { loadPanelContext, resolveEffective, writeFieldValue } from "./config-resolve.js";

export type ConfigWriteResult =
  | { ok: true; target: string }
  | { ok: false; status: number; error: string };

export interface ConfigWriteRequest {
  key?: unknown;
  value?: unknown;
  /** Which preference segment to write. Ignored for corpus / global_root keys. */
  scope?: unknown;
}

export async function applyConfigEdit(
  projectRoot: string,
  body: ConfigWriteRequest | null | undefined,
): Promise<ConfigWriteResult> {
  const key = body?.key;
  if (typeof key !== "string" || key.length === 0) {
    return { ok: false, status: 400, error: "key is required" };
  }
  const field = getPanelFieldByKey(key);
  if (field === undefined) {
    return { ok: false, status: 400, error: `not a configurable key: ${key}` };
  }

  const ctx = loadPanelContext(projectRoot);

  // Refusing here is the point of the whole page. Persisting a value that an
  // environment variable then overrides produces exactly the "the value you see
  // is not the value in effect" state this surface exists to eliminate — and the
  // user would have every reason to believe the change took.
  const { source } = resolveEffective(field, ctx);
  if (source === "env") {
    return {
      ok: false,
      status: 409,
      error: t("cli.console.config.env-locked", {
        name: envOverrideFor(key) ?? "an environment variable",
      }),
    };
  }

  const raw = body?.value;
  const validated = field.validate(typeof raw === "string" ? raw : String(raw));
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }

  // Only `preference` keys have two possible segments; the other homes have
  // exactly one target, so scope is meaningless there rather than defaulted.
  const preferProjectScope = field.home === "preference" && body?.scope === "project";

  try {
    const target = await writeFieldValue(field, validated.value, ctx, preferProjectScope);
    return { ok: true, target };
  } catch (error) {
    // writeFieldValue throws with actionable text for the two structural misses
    // (no bound store for a corpus key, no project_id for a per-project write).
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
