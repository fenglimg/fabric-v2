import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { selectionTokenTtlMsSchema, planContextTopKSchema } from "@fenglimg/fabric-shared";
import type { FabricConfig, McpPayloadLimits } from "@fenglimg/fabric-shared";

// v2.2 A-INFRA-3 (W1-T3-TOPK): library default for the plan_context candidate
// cap when fabric.config.json omits `plan_context_top_k`. Mirrors the
// SELECTION_TOKEN_TTL_DEFAULT pattern — the schema's `.default(24)` only
// applies on a full fabricConfigSchema parse, but the hot read path validates
// the single field, so the default lives here too.
export const PLAN_CONTEXT_TOP_K_DEFAULT = 24;

/**
 * Reads fabric.config.json from the project root.
 * Returns an empty config object when the file is absent.
 * Throws if the file content is not a JSON object.
 */
function readFabricConfig(projectRoot: string): FabricConfig {
  const configPath = join(projectRoot, "fabric.config.json");
  if (!existsSync(configPath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected object in ${configPath}`);
  }

  return parsed as FabricConfig;
}

/**
 * Returns the mcpPayloadLimits block from fabric.config.json, or undefined
 * when absent so call sites fall back to the guard's built-in defaults.
 */
export function readPayloadLimits(projectRoot: string): McpPayloadLimits | undefined {
  return readFabricConfig(projectRoot).mcpPayloadLimits;
}

/**
 * v2.0.0-rc.29 TASK-008 (BUG-F3): returns the selection_token_ttl_ms override
 * from fabric.config.json, or undefined when absent so the caller (plan-context.ts)
 * falls back to its 5-minute default. Best-effort: any parse failure returns
 * undefined rather than throwing — plan_context is on the hot read path and
 * must not crash on a corrupt config file.
 *
 * v2.0.0-rc.29 REVIEW (codex HIGH-3): the raw JSON read previously bypassed
 * schema validation via `readFabricConfig`'s cast, so a string / negative /
 * out-of-range value would propagate into `plan-context.ts`'s
 * `expires_at = now + ttlMs` and produce a bogus expiry. Now: read raw, then
 * `selectionTokenTtlMsSchema.safeParse` — failure returns undefined and the
 * caller falls back to the library default.
 */
export function readSelectionTokenTtlMs(projectRoot: string): number | undefined {
  try {
    const raw = readFabricConfig(projectRoot).selection_token_ttl_ms;
    if (raw === undefined) return undefined;
    const parsed = selectionTokenTtlMsSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * v2.2 A-INFRA-3 (W1-T3-TOPK): returns the `plan_context_top_k` override from
 * fabric.config.json, or PLAN_CONTEXT_TOP_K_DEFAULT when absent / invalid.
 * Best-effort and hot-path safe: any read/parse failure returns the default so
 * plan_context never crashes on a corrupt config file. Validates the single
 * field (planContextTopKSchema) rather than the whole config so an unrelated
 * corrupt field stays isolated.
 */
export function readPlanContextTopK(projectRoot: string): number {
  try {
    const raw = readFabricConfig(projectRoot).plan_context_top_k;
    if (raw === undefined) return PLAN_CONTEXT_TOP_K_DEFAULT;
    const parsed = planContextTopKSchema.safeParse(raw);
    return parsed.success ? parsed.data : PLAN_CONTEXT_TOP_K_DEFAULT;
  } catch {
    return PLAN_CONTEXT_TOP_K_DEFAULT;
  }
}

/**
 * v2.0.0-rc.33 W4-B3 (T5 P2): per-maturity orphan_demote thresholds. Returns
 * the override Map keyed by maturity ("stable"|"endorsed"|"draft") so doctor's
 * orphan_demote inspect can spread it over the hardcoded defaults. Absent keys
 * fall through. Best-effort: any read/parse failure returns an empty map.
 *
 * Validation rule mirrors the schema: integer in [1, 3650] (one day to ten
 * years). Out-of-range or non-numeric values are silently dropped so a
 * partial override file does not nuke the hardcoded defaults wholesale.
 */
export function readOrphanDemoteThresholdDays(projectRoot: string): Partial<Record<"stable" | "endorsed" | "draft", number>> {
  try {
    const cfg = readFabricConfig(projectRoot) as Partial<
      Record<"orphan_demote_stable_days" | "orphan_demote_endorsed_days" | "orphan_demote_draft_days", unknown>
    >;
    const out: Partial<Record<"stable" | "endorsed" | "draft", number>> = {};
    const validate = (v: unknown): number | undefined => {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 3650 || !Number.isInteger(v)) {
        return undefined;
      }
      return v;
    };
    const s = validate(cfg.orphan_demote_stable_days);
    if (s !== undefined) out.stable = s;
    const e = validate(cfg.orphan_demote_endorsed_days);
    if (e !== undefined) out.endorsed = e;
    const d = validate(cfg.orphan_demote_draft_days);
    if (d !== undefined) out.draft = d;
    return out;
  } catch {
    return {};
  }
}
