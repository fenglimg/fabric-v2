import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { STORE_LAYOUT, globalConfigPath, loadGlobalConfig, storeConfigSchema } from "@fenglimg/fabric-shared";
import type { FabricConfig, McpPayloadLimits, StoreConfig } from "@fenglimg/fabric-shared";

import { resolveWriteTargetStoreDir } from "./services/cross-store-write.js";

// v2.2 A-INFRA-3 (W1-T3-TOPK): library default for the plan_context candidate
// cap when fabric.config.json omits `plan_context_top_k`. Mirrors the
// SELECTION_TOKEN_TTL_DEFAULT pattern — the schema's `.default(24)` only
// applies on a full fabricConfigSchema parse, but the hot read path validates
// the single field, so the default lives here too.
export const PLAN_CONTEXT_TOP_K_DEFAULT = 24;

// KT-DEC-0038: default ratio-to-top relevance floor (α). After ranking, recall
// keeps only candidates whose fused score >= α × the top candidate's score.
// 0.25 self-normalizes against the current query's max so it is immune to BM25's
// uncalibrated cross-query scale. 0 disables the floor (keep all up to top_k).
export const RECALL_RELEVANCE_RATIO_DEFAULT = 0.25;

// ---------------------------------------------------------------------------
// config-layering W2 (TASK-002) — env > project > store > default cascade.
//
// KT-MOD-0002 (config 4-layer priority): the canonical override order for a
// Fabric config knob is env(FABRIC_<NAME>) > project(.fabric/fabric-config.json)
// > store(store-config.json) > code default. Any layer whose value is absent,
// malformed, or out-of-range SILENTLY FALLS THROUGH to the next layer and NEVER
// throws (KT-DEC-0048 write-strict/read-tolerant; the readers are on the hot
// recall path). Every layer runs the SAME single-field guard, so a corrupt
// value at ANY layer is skipped, not honored.
//
// STORE-LAYER SOURCE (C-006): the store layer is PINNED to the team/shared store
// only — `resolveWriteTargetStoreDir('team', projectRoot)` returns that store's
// ROOT (parallel to store.json), where `store-config.json` lives. Personal-only
// or unbound repos have no team write-target: the resolver throws → caught → {},
// so those repos get the library default (C-008 hot-path-safe). Machine-scoped
// secrets (the remote embedding endpoint/key) are NEVER read from the store
// layer — they stay on the machine layer (~/.fabric global config), KT-DEC-0063.
// ---------------------------------------------------------------------------

// Per-projectRoot memoized store config. Resolving the write-target store walks
// the global config + mounted-store registry; do it ONCE per root and reuse the
// parsed config across every knob read rather than re-resolving per knob.
// mtime-keyed for the same reason as globalPolicyCache: a long-lived server must
// observe a `store-config.json` edit (e.g. after `fabric sync` pulls a teammate's
// tuning) without a restart. Resolving the store ROOT is the expensive part and
// stays memoized; only the cheap stat() repeats.
const storeConfigCache = new Map<string, { mtime: number; value: StoreConfig }>();

function storeConfigMtime(projectRoot: string): number {
  try {
    const storeRoot = resolveWriteTargetStoreDir("team", projectRoot);
    return statSync(join(storeRoot, STORE_LAYOUT.configFile)).mtimeMs;
  } catch {
    return 0; // unbound repo / absent file — stable key meaning "nothing there"
  }
}

/**
 * Resolve the STORE-layer config (`store-config.json` at the team store root).
 * Returns `{}` — never throws — on any of: no team write-target resolves
 * (personal-only / unbound repo), the file is absent, or the JSON/root shape is
 * malformed. Known fields are parsed independently, so one invalid value cannot
 * erase valid siblings. An absent/invalid knob falls through to the next layer,
 * never injecting a schema default (the schema carries none). Memoized per root.
 */
export function resolveStoreConfig(projectRoot: string): StoreConfig {
  const mtime = storeConfigMtime(projectRoot);
  const cached = storeConfigCache.get(projectRoot);
  if (cached !== undefined && cached.mtime === mtime) {
    return cached.value;
  }
  const resolved = loadStoreConfigUncached(projectRoot);
  storeConfigCache.set(projectRoot, { mtime, value: resolved });
  return resolved;
}

function loadStoreConfigUncached(projectRoot: string): StoreConfig {
  try {
    // Store ROOT (parallel to store.json), NOT the knowledge dir — the store
    // config home is `<storeRoot>/store-config.json` (STORE_LAYOUT.configFile).
    const storeRoot = resolveWriteTargetStoreDir("team", projectRoot);
    const configPath = join(storeRoot, STORE_LAYOUT.configFile);
    if (!existsSync(configPath)) {
      return {};
    }
    const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const source = raw as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(storeConfigSchema.shape)) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        continue;
      }
      const parsed = schema.safeParse(source[key]);
      if (parsed.success) {
        result[key] = parsed.data;
      }
    }
    return result as StoreConfig;
  } catch {
    // resolveWriteTargetStoreDir throws when no team target resolves; a corrupt
    // file JSON.parse throws — either way fall through to the next cascade layer.
    return {};
  }
}

// Read a string env override (enum/model knobs), treating an unset OR blank
// value as "layer absent" so an empty `FABRIC_*=""` never wins the cascade.
function envRaw(name: string): unknown {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

// Read a NUMERIC env override, coercing the (always-string) env value to a
// finite number. Env is inherently string-typed, so ONLY this env-layer helper
// coerces — the project/store JSON layers stay type-strict (a JSON string is not
// a number). Unset/blank/non-numeric → undefined (layer absent).
function envNum(name: string): number | undefined {
  const value = envRaw(name);
  if (value === undefined) {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Single-field guards shared across the env(pre-coerced) + project + store
// layers. TYPE-STRICT: a non-number JSON value is rejected (not coerced), so a
// project/store `"20"` string falls through rather than being honored. Same
// guard per layer is the whole point: a corrupt value at any layer is skipped.
function intGuard(min: number, max: number): (v: unknown) => number | undefined {
  return (v) =>
    typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= min && v <= max
      ? v
      : undefined;
}

function floatGuard(min: number, max: number): (v: unknown) => number | undefined {
  return (v) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
}

// First layer whose guard accepts its value, in env > project > store order;
// undefined when every layer is absent/invalid (callers coalesce to a default
// or preserve the undefined-means-fallback contract).
function firstValidLayer<T>(
  layers: readonly unknown[],
  guard: (v: unknown) => T | undefined,
): T | undefined {
  for (const layer of layers) {
    if (layer === undefined || layer === null) {
      continue;
    }
    const valid = guard(layer);
    if (valid !== undefined) {
      return valid;
    }
  }
  return undefined;
}

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

// Read the project config as a raw key→unknown bag. Since config-single-home the
// repo file carries IDENTITY ONLY (project_id / required_stores / write_routes /
// active_project / active_write_store / default_write_store) — no policy knobs —
// so this is used to resolve `project_id`, not to supply cascade values.
// Best-effort: a missing/corrupt file yields `{}`.
function projectLayer(projectRoot: string): Record<string, unknown> {
  try {
    return readFabricConfig(projectRoot) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// config-single-home W2 — the GLOBAL policy layer (`~/.fabric/fabric-global.json`).
//
// `defaults` = the user's machine-wide defaults; `projects[<project_id>]` = this
// repo's exceptions, keyed by the project_id that stays in the repo config. Both
// are read once per projectRoot and memoized — resolving them walks the global
// config, so it must not repeat per knob on the recall hot path.
// ---------------------------------------------------------------------------
interface GlobalPolicy {
  /** `projects[<project_id>]` — per-project exceptions. Highest non-env layer. */
  project: Record<string, unknown>;
  /** `defaults` — machine-wide user defaults. Lowest layer above code default. */
  defaults: Record<string, unknown>;
}

const EMPTY_POLICY: GlobalPolicy = { project: {}, defaults: {} };

// mtime-keyed, mirroring the hook-side lib/config-cache.cjs contract. A cache
// that never expires would be wrong here: the MCP server is a LONG-LIVED
// process, so an operator editing ~/.fabric/fabric-global.json would not see the
// change until the server restarted. Keying on mtime keeps the hot path to one
// stat() while still picking up edits (and lets tests rewrite between asserts).
const globalPolicyCache = new Map<string, { mtime: number; value: GlobalPolicy }>();

function globalConfigMtime(): number {
  try {
    return statSync(globalConfigPath()).mtimeMs;
  } catch {
    return 0; // absent / unreadable — a stable key meaning "no config"
  }
}

export function resolveGlobalPolicy(projectRoot: string): GlobalPolicy {
  const mtime = globalConfigMtime();
  const cached = globalPolicyCache.get(projectRoot);
  if (cached !== undefined && cached.mtime === mtime) {
    return cached.value;
  }
  const resolved = loadGlobalPolicyUncached(projectRoot);
  globalPolicyCache.set(projectRoot, { mtime, value: resolved });
  return resolved;
}

function loadGlobalPolicyUncached(projectRoot: string): GlobalPolicy {
  try {
    const global = loadGlobalConfig() as Record<string, unknown> | null;
    if (global === null) {
      return EMPTY_POLICY;
    }
    const defaults = isPlainObject(global.defaults) ? global.defaults : {};
    const projects = isPlainObject(global.projects) ? global.projects : {};
    const projectId = projectLayer(projectRoot).project_id;
    const scoped =
      typeof projectId === "string" && projectId !== "" && isPlainObject(projects[projectId])
        ? (projects[projectId] as Record<string, unknown>)
        : {};
    return { project: scoped, defaults };
  } catch {
    // No global config, unreadable home, or the test-runtime resolveGlobalRoot
    // guard — degrade to code defaults rather than throwing on the hot path.
    return EMPTY_POLICY;
  }
}

/**
 * PREFERENCE-class knob: `env > projects[project_id] > defaults > code default`.
 * These describe how the USER wants Fabric to behave; they never live in a store.
 */
function resolvePreference<T>(
  envVal: unknown,
  key: string,
  projectRoot: string,
  def: T,
  validate: (v: unknown) => T | undefined,
): T {
  const policy = resolveGlobalPolicy(projectRoot);
  return firstValidLayer([envVal, policy.project[key], policy.defaults[key]], validate) ?? def;
}

/**
 * CORPUS-class knob: `env > store > code default`.
 * These describe what a KNOWLEDGE BASE is like (how fast its entries go stale,
 * how many it holds), so the store that owns the corpus is their only home —
 * a machine-wide default for them would be meaningless across differing stores.
 */
function resolveCorpus<T>(
  envVal: unknown,
  key: string,
  projectRoot: string,
  def: T,
  validate: (v: unknown) => T | undefined,
): T {
  const store = resolveStoreConfig(projectRoot) as Record<string, unknown>;
  return firstValidLayer([envVal, store[key]], validate) ?? def;
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
 * at the call site. NOT a store-overridable knob — repo/machine scoped only.
 */
export function readPayloadLimits(projectRoot: string): McpPayloadLimits | undefined {
  // config-single-home W2: preference-class (machine/transport scoped), so it
  // resolves from the global policy layers, never from a store.
  return resolvePreference<McpPayloadLimits | undefined>(
    undefined,
    "mcpPayloadLimits",
    projectRoot,
    undefined,
    (v) => {
      if (!isPlainObject(v)) return undefined;
      const warn = v.warnBytes;
      const hard = v.hardBytes;
      const ok = (n: unknown): boolean => n === undefined || (typeof n === "number" && Number.isInteger(n) && n > 0);
      if (!ok(warn) || !ok(hard)) return undefined;
      return {
        ...(typeof warn === "number" ? { warnBytes: warn } : {}),
        ...(typeof hard === "number" ? { hardBytes: hard } : {}),
      };
    },
  );
}

/**
 * v2.0.0-rc.29 TASK-008 (BUG-F3): returns the selection_token_ttl_ms override,
 * or undefined when absent so the caller (plan-context.ts) falls back to its
 * 5-minute default. config-layering W2 (TASK-002): now cascades
 * env(FABRIC_SELECTION_TOKEN_TTL_MS) > project > store, preserving the
 * undefined-means-fallback contract (no library default injected here). Range
 * 30s..1h; a value outside range at any layer falls through. Best-effort — any
 * parse failure returns undefined rather than throwing (hot read path).
 */
export function readSelectionTokenTtlMs(projectRoot: string): number | undefined {
  try {
    const policy = resolveGlobalPolicy(projectRoot);
    return firstValidLayer(
      [
        envNum("FABRIC_SELECTION_TOKEN_TTL_MS"),
        policy.project.selection_token_ttl_ms,
        policy.defaults.selection_token_ttl_ms,
      ],
      intGuard(30_000, 3_600_000),
    );
  } catch {
    return undefined;
  }
}

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

function modelGuard(v: unknown): string | undefined {
  return typeof v === "string" && SUPPORTED_EMBED_MODELS.has(v) ? v : undefined;
}

/**
 * The resolved embedding settings.
 *
 * `enabled` / `weight` / `model` shape the LOCAL fastembed channel; `model`
 * cascades env(FABRIC_EMBED_MODEL) > project > store > DEFAULT_EMBED_MODEL and
 * `weight` cascades project > store > 30 (both store-overridable knobs).
 *
 * `remoteEndpoint` / `remoteApiKey` drive the OPTIONAL remote embedding transport
 * and are MACHINE-layer only (KT-DEC-0063): env(FABRIC_EMBED_ENDPOINT /
 * FABRIC_EMBED_API_KEY) ?? the `~/.fabric` global config (embed_endpoint /
 * embed_api_key). The store-config path is NEVER consulted for these — a shared
 * store may not dictate a repo's remote transport or leak a secret. Omitted when
 * unset.
 */
export interface EmbedConfig {
  enabled: boolean;
  weight: number;
  model: string;
  remoteEndpoint?: string;
  remoteApiKey?: string;
}

/**
 * v2.2 C2-vector (W2-T7): resolve the optional embedding settings.
 *
 * `enabled` DEFAULTS TRUE (P1 recall-engine-refactor TASK-004; KT-PIT-0029 out
 * of scope for this cascade) — OFF only when the PROJECT config sets
 * `embed_enabled` explicitly to `false`. Best-effort and hot-path safe: any
 * read/parse failure returns the safe text-only default so plan_context never
 * crashes on a corrupt config.
 */
/**
 * config-single-home W2/D6 — resolve the remote embedding transport as ONE unit.
 *
 * `embed_remote: { endpoint, api_key?, model? }` in `~/.fabric/fabric-global.json`
 * is the canonical shape: presence of `endpoint` IS the remote-mode switch, and
 * `model` rides along inside it because the remote namespace (`BAAI/bge-m3`) and
 * the local fastembed enum are mutually unusable — they must move together.
 *
 * Also accepts the pre-W2 FLAT keys (`embed_endpoint` / `embed_api_key` /
 * `embed_model` at the global root) so an existing machine keeps working without
 * touching its config; the nested object wins when both are present. Env
 * overrides beat both. Returns undefined when no endpoint resolves (local mode).
 */
function resolveRemoteEmbed(): { endpoint: string; apiKey?: string; model?: string } | undefined {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v : undefined;
  let nested: Record<string, unknown> = {};
  let flat: Record<string, unknown> = {};
  try {
    const global = loadGlobalConfig() as Record<string, unknown> | null;
    if (global !== null) {
      flat = global;
      if (global.embed_remote !== null && typeof global.embed_remote === "object" && !Array.isArray(global.embed_remote)) {
        nested = global.embed_remote as Record<string, unknown>;
      }
    }
  } catch {
    // no global config / test-runtime guard — local mode
  }
  const endpoint =
    str(process.env.FABRIC_EMBED_ENDPOINT) ?? str(nested.endpoint) ?? str(flat.embed_endpoint);
  if (endpoint === undefined) {
    return undefined;
  }
  const apiKey =
    str(process.env.FABRIC_EMBED_API_KEY) ?? str(nested.api_key) ?? str(flat.embed_api_key);
  const model = str(process.env.FABRIC_EMBED_MODEL) ?? str(nested.model) ?? str(flat.embed_model);
  return {
    endpoint,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(model !== undefined ? { model } : {}),
  };
}

export function readEmbedConfig(projectRoot: string): EmbedConfig {
  try {
    // embed_enabled: default TRUE (KT-PIT-0029 — runtime default is ON and the
    // shared schema mirrors it). OFF only when a policy layer says exactly false.
    const enabledOverride = resolvePreference<boolean | undefined>(
      undefined,
      "embed_enabled",
      projectRoot,
      undefined,
      (v) => (typeof v === "boolean" ? v : undefined),
    );
    const enabled = enabledOverride !== false;

    // Cap at 49 (< BM25_WEIGHT 50) — enforces the supplement-not-override
    // invariant; out-of-range / non-integer / non-finite fall through the cascade.
    const weight = resolvePreference(
      envNum("FABRIC_EMBED_WEIGHT"),
      "embed_weight",
      projectRoot,
      30,
      intGuard(0, 49),
    );

    // D6: remote transport is machine-scoped and moves as a unit (KT-DEC-0063 —
    // secrets never come from a store). Resolved BEFORE model because the two
    // modes select DIFFERENT model homes rather than competing for one key.
    const remote = resolveRemoteEmbed();

    // Remote mode → the model that travels with the endpoint. Local mode → the
    // preference-class knob, validated against the fastembed enum. No single key
    // is writable in two places: `embed_remote.model` and `defaults.embed_model`
    // serve mutually exclusive modes.
    const model =
      remote !== undefined
        ? (remote.model ?? DEFAULT_EMBED_MODEL)
        : resolvePreference(
            envRaw("FABRIC_EMBED_MODEL"),
            "embed_model",
            projectRoot,
            DEFAULT_EMBED_MODEL,
            modelGuard,
          );

    return {
      enabled,
      weight,
      model,
      ...(remote !== undefined ? { remoteEndpoint: remote.endpoint } : {}),
      ...(remote?.apiKey !== undefined ? { remoteApiKey: remote.apiKey } : {}),
    };
  } catch {
    return { enabled: false, weight: 30, model: DEFAULT_EMBED_MODEL };
  }
}

// F54 (ISS-20260531-090): resolve the effective knowledge-layer filter for
// recall / plan_context when the call omits an explicit `layer_filter`. Mirrors
// the schema default (`default_layer_filter` → "both" = no filtering). Returns
// "both" on any read/parse failure so a corrupt config never narrows results.
// config-layering W2 (TASK-002): cascades env > project > store > "both".
function layerFilterGuard(v: unknown): "team" | "personal" | "both" | undefined {
  return v === "team" || v === "personal" || v === "both" ? v : undefined;
}

export function readDefaultLayerFilter(projectRoot: string): "team" | "personal" | "both" {
  try {
    return resolvePreference(
      envRaw("FABRIC_DEFAULT_LAYER_FILTER"),
      "default_layer_filter",
      projectRoot,
      "both",
      layerFilterGuard,
    );
  } catch {
    return "both";
  }
}

/**
 * v2.2 A-INFRA-3 (W1-T3-TOPK): returns the `plan_context_top_k` override, or
 * PLAN_CONTEXT_TOP_K_DEFAULT when absent / invalid. config-layering W2: cascades
 * env(FABRIC_PLAN_CONTEXT_TOP_K) > project > store > default. Best-effort and
 * hot-path safe — any failure returns the default. Validates the single field
 * (int 1..200) per layer so an unrelated corrupt field stays isolated.
 */
export function readPlanContextTopK(projectRoot: string): number {
  try {
    return resolvePreference(
      envNum("FABRIC_PLAN_CONTEXT_TOP_K"),
      "plan_context_top_k",
      projectRoot,
      PLAN_CONTEXT_TOP_K_DEFAULT,
      intGuard(1, 200),
    );
  } catch {
    return PLAN_CONTEXT_TOP_K_DEFAULT;
  }
}

/**
 * KT-DEC-0038: returns the `recall_relevance_ratio` override (α), or
 * RECALL_RELEVANCE_RATIO_DEFAULT (0.25) when absent / invalid. config-layering
 * W2: cascades env(FABRIC_RECALL_RELEVANCE_RATIO) > project > store > default.
 * Best-effort and hot-path safe. Valid range [0, 1]; 0 disables the floor.
 */
export function readRecallRelevanceRatio(projectRoot: string): number {
  try {
    return resolvePreference(
      envNum("FABRIC_RECALL_RELEVANCE_RATIO"),
      "recall_relevance_ratio",
      projectRoot,
      RECALL_RELEVANCE_RATIO_DEFAULT,
      floatGuard(0, 1),
    );
  } catch {
    return RECALL_RELEVANCE_RATIO_DEFAULT;
  }
}

// v2.2 C1 (processes/maturity-promotion-rubric-v1): default days a `broad` entry
// may go without a fab-review re-confirmation before doctor surfaces a RECHECK
// nudge. 180d (≈6 months) deliberately sits ABOVE the proven decay threshold
// (90d, KT-DEC-0008) — broad knowledge is the most stable/important, so its
// re-confirmation cadence is gentler than the usage-decay clock narrow entries
// run on. Non-blocking INFO nudge, never an auto-demote.
export const BROAD_REVIEW_RECHECK_DAYS_DEFAULT = 180;

/**
 * v2.2 C1: returns the `broad_review_recheck_days` override, or
 * BROAD_REVIEW_RECHECK_DAYS_DEFAULT (180) when absent / invalid. config-layering
 * W2: cascades env(FABRIC_BROAD_REVIEW_RECHECK_DAYS) > project > store > default.
 * Validation mirrors the orphan_demote keys: integer in [1, 3650].
 */
export function readBroadReviewRecheckThresholdDays(projectRoot: string): number {
  try {
    return resolveCorpus(
      envNum("FABRIC_BROAD_REVIEW_RECHECK_DAYS"),
      "broad_review_recheck_days",
      projectRoot,
      BROAD_REVIEW_RECHECK_DAYS_DEFAULT,
      intGuard(1, 3650),
    );
  } catch {
    return BROAD_REVIEW_RECHECK_DAYS_DEFAULT;
  }
}

// Per-maturity orphan_demote thresholds. Returns ONLY the keys with a valid
// override (Partial) so doctor spreads them over its hardcoded defaults; absent
// keys fall through. config-layering W2: each key cascades
// env > project > store; a key with no valid layer is omitted. Integer [1, 3650].
const ORPHAN_DEMOTE_KEYS = [
  ["proven", "orphan_demote_proven_days", "FABRIC_ORPHAN_DEMOTE_PROVEN_DAYS"],
  ["verified", "orphan_demote_verified_days", "FABRIC_ORPHAN_DEMOTE_VERIFIED_DAYS"],
  ["draft", "orphan_demote_draft_days", "FABRIC_ORPHAN_DEMOTE_DRAFT_DAYS"],
] as const;

export function readOrphanDemoteThresholdDays(
  projectRoot: string,
): Partial<Record<"proven" | "verified" | "draft", number>> {
  try {
    const store = resolveStoreConfig(projectRoot) as Record<string, unknown>;
    const guard = intGuard(1, 3650);
    const out: Partial<Record<"proven" | "verified" | "draft", number>> = {};
    for (const [maturity, field, env] of ORPHAN_DEMOTE_KEYS) {
      const value = firstValidLayer([envNum(env), store[field]], guard);
      if (value !== undefined) {
        out[maturity] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// PLN-004 F1 (credibility content-age decay): per-knowledge-type half-lives (days)
// driving the recall-scoring credibility multiplier. Returns a FULL record
// (default-filled) so the multiplier never handles undefined. config-layering W2:
// each type cascades env > project > store > default. Integer [1, 3650].
const CREDIBILITY_HALF_LIFE_KEYS = [
  ["decisions", "credibility_half_life_decisions_days", "FABRIC_CREDIBILITY_HALF_LIFE_DECISIONS_DAYS", 180],
  ["guidelines", "credibility_half_life_guidelines_days", "FABRIC_CREDIBILITY_HALF_LIFE_GUIDELINES_DAYS", 150],
  ["models", "credibility_half_life_models_days", "FABRIC_CREDIBILITY_HALF_LIFE_MODELS_DAYS", 150],
  ["pitfalls", "credibility_half_life_pitfalls_days", "FABRIC_CREDIBILITY_HALF_LIFE_PITFALLS_DAYS", 120],
  ["processes", "credibility_half_life_processes_days", "FABRIC_CREDIBILITY_HALF_LIFE_PROCESSES_DAYS", 120],
] as const;

export function readCredibilityHalfLives(
  projectRoot: string,
): Record<"decisions" | "guidelines" | "models" | "pitfalls" | "processes", number> {
  const defaults: Record<"decisions" | "guidelines" | "models" | "pitfalls" | "processes", number> = {
    decisions: 180,
    guidelines: 150,
    models: 150,
    pitfalls: 120,
    processes: 120,
  };
  try {
    const store = resolveStoreConfig(projectRoot) as Record<string, unknown>;
    const guard = intGuard(1, 3650);
    const out = { ...defaults };
    for (const [type, field, env, def] of CREDIBILITY_HALF_LIFE_KEYS) {
      out[type] = firstValidLayer([envNum(env), store[field]], guard) ?? def;
    }
    return out;
  } catch {
    return { ...defaults };
  }
}

// PLN-004 F1: per-maturity floor the credibility multiplier never decays below.
// Full record (default-filled). config-layering W2: each maturity cascades
// env > project > store > default. Range [0, 1]. Higher maturity → higher floor.
const CREDIBILITY_FLOOR_KEYS = [
  ["draft", "credibility_floor_draft", "FABRIC_CREDIBILITY_FLOOR_DRAFT", 0.4],
  ["verified", "credibility_floor_verified", "FABRIC_CREDIBILITY_FLOOR_VERIFIED", 0.55],
  ["proven", "credibility_floor_proven", "FABRIC_CREDIBILITY_FLOOR_PROVEN", 0.7],
] as const;

export function readCredibilityFloors(
  projectRoot: string,
): Record<"draft" | "verified" | "proven", number> {
  const defaults: Record<"draft" | "verified" | "proven", number> = {
    draft: 0.4,
    verified: 0.55,
    proven: 0.7,
  };
  try {
    const store = resolveStoreConfig(projectRoot) as Record<string, unknown>;
    const guard = floatGuard(0, 1);
    const out = { ...defaults };
    for (const [maturity, field, env, def] of CREDIBILITY_FLOOR_KEYS) {
      out[maturity] = firstValidLayer([envNum(env), store[field]], guard) ?? def;
    }
    return out;
  } catch {
    return { ...defaults };
  }
}

// P1 recall-engine-refactor (TASK-003): content-channel fusion strategy.
// 'auto' (DEFAULT) is adaptive — planContext resolves it to 'rrf' when the vector
// channel is actually scoring, else 'additive' (see resolveFusion at the recall
// site). 'additive' / 'rrf' force a mode. Best-effort and hot-path safe — any
// read/parse failure OR an unrecognized value returns 'auto', so a corrupt config
// gets the safe adaptive behavior, never a silently-forced degenerate ranking.
// config-layering W2: cascades env(FABRIC_FUSION) > project > store > 'auto'.
export const FUSION_DEFAULT: "additive" | "rrf" | "auto" = "auto";

function fusionGuard(v: unknown): "additive" | "rrf" | "auto" | undefined {
  return v === "additive" || v === "rrf" || v === "auto" ? v : undefined;
}

export function readFusion(projectRoot: string): "additive" | "rrf" | "auto" {
  try {
    return resolvePreference(
      envRaw("FABRIC_FUSION"),
      "fusion",
      projectRoot,
      FUSION_DEFAULT,
      fusionGuard,
    );
  } catch {
    return FUSION_DEFAULT;
  }
}

// v2.1 ④ conflict-detection (P4): bm25 similarity floor for the knowledge-
// conflict lint. Returns the configured value when it is a valid [0,1] number,
// else undefined (caller falls back to the lint default). config-layering W2:
// cascades env(FABRIC_CONFLICT_LINT_SIMILARITY_THRESHOLD) > project > store,
// preserving the undefined-means-fallback contract.
export function readConflictLintThreshold(projectRoot: string): number | undefined {
  try {
    const store = resolveStoreConfig(projectRoot) as Record<string, unknown>;
    return firstValidLayer(
      [envNum("FABRIC_CONFLICT_LINT_SIMILARITY_THRESHOLD"), store.conflict_lint_similarity_threshold],
      floatGuard(0, 1),
    );
  } catch {
    return undefined;
  }
}
