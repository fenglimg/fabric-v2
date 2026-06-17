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
 * Reads the project config from `.fabric/fabric-config.json` — the single source
 * of truth for project config (A1; KT-DEC-0003 dual-root `~/.fabric` + `<repo>/.fabric`).
 * Returns an empty config object when the file is absent.
 * Throws if the file content is not a JSON object.
 */
function readFabricConfig(projectRoot: string): FabricConfig {
  const configPath = join(projectRoot, ".fabric", "fabric-config.json");
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
 * Returns the explicit MCP payload byte limits from `mcpPayloadLimits`, or
 * undefined when absent so call sites fall back to the payload guard's built-in
 * fixed guardrail (PAYLOAD_LIMIT_DEFAULT_{WARN,HARD}_BYTES).
 *
 * KT-DEC-0037: the `retrieval_budget_profile` enum was deleted, so the payload
 * limits are no longer profile-scaled — `payloadHardBytes` is a fixed 413 safety
 * guardrail (the guard default) unless the operator pins an explicit override.
 * Any missing sub-field of an explicit override is filled by the guard default
 * at the call site.
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
/**
 * v2.2 C2-vector (W2-T7): resolve the optional embedding settings. `enabled`
 * defaults to false (`--no-embed` baseline); `weight` defaults to 30. Best-effort
 * and hot-path safe — any read/parse failure returns the safe text-only default
 * (enabled:false) so plan_context never crashes on a corrupt config.
 */
// v2.1 ③ vector-chinese-model (P3): supported fastembed@2.x EmbeddingModel enum
// VALUES (the strings init() consumes). Mirrors the schema enum in
// fabric-config.ts. Default is the light Chinese model — the whole point of ③:
// the prior code pinned fastembed's English default (bge-small-en) which mis-
// embeds the Chinese-heavy KB.
export const DEFAULT_EMBED_MODEL = "fast-bge-small-zh-v1.5";
const SUPPORTED_EMBED_MODELS = new Set<string>([
  "fast-bge-small-zh-v1.5",
  "fast-multilingual-e5-large",
  "fast-bge-small-en-v1.5",
  "fast-bge-small-en",
  "fast-bge-base-en-v1.5",
  "fast-bge-base-en",
  "fast-all-MiniLM-L6-v2",
]);

export function readEmbedConfig(projectRoot: string): { enabled: boolean; weight: number; model: string } {
  try {
    const config = readFabricConfig(projectRoot);
    const enabled = config.embed_enabled === true;
    const rawWeight = config.embed_weight;
    // Cap at 49 (< BM25_WEIGHT 50) — enforces the supplement-not-override
    // invariant; out-of-range / non-integer / non-finite all fall to 30.
    const weight = typeof rawWeight === "number" && Number.isInteger(rawWeight) && rawWeight >= 0 && rawWeight <= 49
      ? rawWeight
      : 30;
    // v2.1 ③: pin the embedding model. An unknown / non-string value falls back
    // to the light Chinese default rather than fastembed's English baseline.
    const rawModel = (config as { embed_model?: unknown }).embed_model;
    const model = typeof rawModel === "string" && SUPPORTED_EMBED_MODELS.has(rawModel)
      ? rawModel
      : DEFAULT_EMBED_MODEL;
    return { enabled, weight, model };
  } catch {
    return { enabled: false, weight: 30, model: DEFAULT_EMBED_MODEL };
  }
}

// F54 (ISS-20260531-090): resolve the effective knowledge-layer filter for
// recall / plan_context when the call omits an explicit `layer_filter`. Mirrors
// the schema default (`default_layer_filter` → "both" = no filtering). Returns
// "both" on any read/parse failure so a corrupt config never narrows results.
export function readDefaultLayerFilter(projectRoot: string): "team" | "personal" | "both" {
  try {
    const config = readFabricConfig(projectRoot);
    const raw = (config as { default_layer_filter?: unknown }).default_layer_filter;
    return raw === "team" || raw === "personal" ? raw : "both";
  } catch {
    return "both";
  }
}

export function readPlanContextTopK(projectRoot: string): number {
  try {
    // KT-DEC-0037: top_k is the sole retrieval knob — the profile enum is gone.
    const raw = readFabricConfig(projectRoot).plan_context_top_k;
    if (raw !== undefined) {
      const parsed = planContextTopKSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
    return PLAN_CONTEXT_TOP_K_DEFAULT;
  } catch {
    return PLAN_CONTEXT_TOP_K_DEFAULT;
  }
}

/**
 * v2.0.0-rc.33 W4-B3 (T5 P2): per-maturity orphan_demote thresholds. Returns
 * the override Map keyed by the doctor's internal LintMaturity ladder
 * (proven|verified|draft) so doctor's orphan_demote inspect can spread it
 * over the hardcoded defaults. Absent keys fall through. Best-effort: any
 * read/parse failure returns an empty map.
 *
 * v2.2 Goal B (G-VOCAB / ADJ-2): the doctor's LintMaturity ladder now speaks
 * the CANONICAL maturity enum (draft/verified/proven, KT-DEC-0005) directly —
 * the legacy stable/endorsed remap is retired. This loader reads the canonical
 * config keys (`orphan_demote_proven_days` / `orphan_demote_verified_days` /
 * `orphan_demote_draft_days`) and returns them under matching canonical keys.
 *
 * Validation rule mirrors the schema: integer in [1, 3650] (one day to ten
 * years). Out-of-range or non-numeric values are silently dropped so a
 * partial override file does not nuke the hardcoded defaults wholesale.
 */
export function readOrphanDemoteThresholdDays(projectRoot: string): Partial<Record<"proven" | "verified" | "draft", number>> {
  try {
    const cfg = readFabricConfig(projectRoot) as Partial<
      Record<
        | "orphan_demote_proven_days"
        | "orphan_demote_verified_days"
        | "orphan_demote_draft_days",
        unknown
      >
    >;
    const out: Partial<Record<"proven" | "verified" | "draft", number>> = {};
    const validate = (v: unknown): number | undefined => {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 3650 || !Number.isInteger(v)) {
        return undefined;
      }
      return v;
    };
    const proven = validate(cfg.orphan_demote_proven_days);
    if (proven !== undefined) out.proven = proven;
    const verified = validate(cfg.orphan_demote_verified_days);
    if (verified !== undefined) out.verified = verified;
    const d = validate(cfg.orphan_demote_draft_days);
    if (d !== undefined) out.draft = d;
    return out;
  } catch {
    return {};
  }
}

// v2.1 ④ conflict-detection (P4): bm25 similarity floor for the knowledge-
// conflict lint. Reads `.fabric/fabric-config.json` (the schema-described,
// hook-facing config file) — NOT the root `fabric.config.json` that
// readFabricConfig targets. Returns the configured value when it is a valid
// [0,1] number, else undefined (caller falls back to the lint default).
export function readConflictLintThreshold(projectRoot: string): number | undefined {
  try {
    const cfgPath = join(projectRoot, ".fabric", "fabric-config.json");
    if (!existsSync(cfgPath)) return undefined;
    const parsed = JSON.parse(readFileSync(cfgPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const v = (parsed as Record<string, unknown>).conflict_lint_similarity_threshold;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) {
      return v;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
