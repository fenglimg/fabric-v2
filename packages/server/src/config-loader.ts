import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { selectionTokenTtlMsSchema, planContextTopKSchema, resolveRetrievalBudget } from "@fenglimg/fabric-shared";
import type { FabricConfig, McpPayloadLimits, RetrievalBudgetProfile } from "@fenglimg/fabric-shared";

// v2.2 C5-budget (W2-T3): the valid retrieval budget profiles. Kept as a const
// tuple so the per-field reader can validate the config value without pulling in
// the whole fabricConfigSchema on the hot read path.
const RETRIEVAL_BUDGET_PROFILES: readonly RetrievalBudgetProfile[] = ["conservative", "balanced", "generous"];

function readRetrievalBudgetProfile(config: FabricConfig): RetrievalBudgetProfile | undefined {
  const raw = config.retrieval_budget_profile;
  return typeof raw === "string" && (RETRIEVAL_BUDGET_PROFILES as readonly string[]).includes(raw)
    ? (raw as RetrievalBudgetProfile)
    : undefined;
}

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
 * Returns the effective MCP payload byte limits, or undefined when no budget
 * strategy is in play so call sites fall back to the guard's built-in defaults.
 *
 * v2.2 C5-budget (W2-T3): the limits now derive from the layered retrieval
 * budget — explicit `mcpPayloadLimits.{warn,hard}Bytes` win, else the
 * `retrieval_budget_profile` provides them. When NEITHER is set we still return
 * undefined (not the balanced numbers) so the historical "fall through to the
 * guard defaults" path — and doctor's `source: "default"` rendering — is byte-
 * identical. A conservative/generous profile (or any explicit limit) makes this
 * return concrete bytes, binding the payload rung to the chosen strategy.
 */
export function readPayloadLimits(projectRoot: string): McpPayloadLimits | undefined {
  const config = readFabricConfig(projectRoot);
  const explicit = config.mcpPayloadLimits;
  const profile = readRetrievalBudgetProfile(config);
  if (profile === undefined && explicit === undefined) {
    return undefined;
  }
  const resolved = resolveRetrievalBudget({
    profile,
    payloadWarnBytes: explicit?.warnBytes,
    payloadHardBytes: explicit?.hardBytes,
  });
  return { warnBytes: resolved.payloadWarnBytes, hardBytes: resolved.payloadHardBytes };
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
    const config = readFabricConfig(projectRoot);
    // Explicit per-field knob wins over the profile.
    const raw = config.plan_context_top_k;
    if (raw !== undefined) {
      const parsed = planContextTopKSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
    // v2.2 C5-budget (W2-T3): else derive from the retrieval budget profile.
    // `balanced` (and the absent-profile default) resolves to 24 ===
    // PLAN_CONTEXT_TOP_K_DEFAULT, so the no-config behavior is unchanged.
    return resolveRetrievalBudget({ profile: readRetrievalBudgetProfile(config) }).topK;
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
