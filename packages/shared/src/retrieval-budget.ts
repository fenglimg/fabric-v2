// v2.2 C5-budget (W2-T3): layered retrieval budget strategy. Until now each rung
// of the truncation chain carried its OWN independent default — plan_context_top_k
// (count, MCP layer), mcpPayloadLimits.{warn,hard}Bytes (bytes, MCP layer),
// hint_broad_budget_chars (chars, injection layer). There was no single place
// that related them, so scaling "how much knowledge Fabric surfaces" meant tuning
// four numbers in different units and hoping they stayed coherent.
//
// This module adds the missing STRATEGY layer: a `retrieval_budget_profile`
// (conservative | balanced | generous) that provides coherent defaults across
// BOTH layers at once. Per-field config overrides still win — the profile only
// fills the values the operator did not pin explicitly. The `balanced` profile
// reproduces the historical per-knob defaults exactly, so the default behavior is
// unchanged (zero regression); `conservative` / `generous` scale the whole chain
// up or down together.

export type RetrievalBudgetProfile = "conservative" | "balanced" | "generous";

export interface ResolvedRetrievalBudget {
  /** MCP layer — max candidates returned by fab_plan_context (count). */
  topK: number;
  /** MCP layer — payload soft-warn threshold (bytes). */
  payloadWarnBytes: number;
  /** MCP layer — payload hard trim ceiling (bytes). */
  payloadHardBytes: number;
  /** Injection layer — SessionStart broad-menu body char budget. */
  injectionChars: number;
  // grill-report C-009 (body-tier): fab_recall returns DESCRIPTIONS for every
  // top_k candidate but full BODIES only for the highest-ranked few — accumulate
  // body bytes in rank order, stop at this budget, the rest stay description-only
  // (fetchable on demand via fab_get_knowledge_sections). Deliberately an
  // INDEPENDENT small budget, NOT payloadWarnBytes (~16KB ≈ 8 bodies = too fat):
  // description = discovery layer (cheap, always shown), body = application layer
  // (a permanent per-recall context tax). A missed body is one cheap on-demand
  // fetch (recoverable); an eager body is paid on every recall (not). So this
  // leans lean — typically 1~3 bodies. Scales with the profile like every other
  // rung.
  bodyBudgetBytes: number;
}

// `balanced` MUST equal the pre-C5 per-knob defaults (PLAN_CONTEXT_TOP_K_DEFAULT
// = 24, PAYLOAD_LIMIT_DEFAULT_{WARN,HARD}_BYTES = 16384/65536,
// DEFAULT_HINT_BROAD_BUDGET_CHARS = 2000) so flipping the default profile on is a
// no-op. conservative ≈ half, generous ≈ double — coherent across every layer.
const PROFILES: Record<RetrievalBudgetProfile, ResolvedRetrievalBudget> = {
  conservative: {
    topK: 12,
    payloadWarnBytes: 8192,
    payloadHardBytes: 32768,
    injectionChars: 1000,
    bodyBudgetBytes: 2048,
  },
  balanced: {
    topK: 24,
    payloadWarnBytes: 16384,
    payloadHardBytes: 65536,
    injectionChars: 2000,
    // grill-report C-009: ~4KB ≈ 1~3 typical bodies. Independent of the 16KB
    // payloadWarnBytes (the response cap), small on purpose — see field doc.
    bodyBudgetBytes: 4096,
  },
  generous: {
    topK: 48,
    payloadWarnBytes: 32768,
    payloadHardBytes: 131072,
    injectionChars: 4000,
    bodyBudgetBytes: 8192,
  },
};

export const DEFAULT_RETRIEVAL_BUDGET_PROFILE: RetrievalBudgetProfile = "balanced";

/** The per-field overrides that, when present, take precedence over the profile. */
export interface RetrievalBudgetOverrides {
  profile?: RetrievalBudgetProfile;
  topK?: number;
  payloadWarnBytes?: number;
  payloadHardBytes?: number;
  injectionChars?: number;
  // grill-report R2/R5 mitigation knob: an operator who finds the lean default
  // drops too many bodies (AI not following up with fab_get_knowledge_sections)
  // can dial this up to make recall eager again, without changing the profile.
  bodyBudgetBytes?: number;
}

/**
 * Resolve the layered retrieval budget: start from the named profile (default
 * `balanced`), then let any explicitly-supplied per-field override win. Each
 * field is resolved independently, so an operator can pin a single knob (e.g.
 * payloadHardBytes) while the rest follow the chosen profile.
 */
export function resolveRetrievalBudget(overrides?: RetrievalBudgetOverrides): ResolvedRetrievalBudget {
  const base = PROFILES[overrides?.profile ?? DEFAULT_RETRIEVAL_BUDGET_PROFILE];
  return {
    topK: overrides?.topK ?? base.topK,
    payloadWarnBytes: overrides?.payloadWarnBytes ?? base.payloadWarnBytes,
    payloadHardBytes: overrides?.payloadHardBytes ?? base.payloadHardBytes,
    injectionChars: overrides?.injectionChars ?? base.injectionChars,
    bodyBudgetBytes: overrides?.bodyBudgetBytes ?? base.bodyBudgetBytes,
  };
}

/** Exposed for tests / introspection — the raw profile table. */
export function retrievalBudgetProfile(profile: RetrievalBudgetProfile): ResolvedRetrievalBudget {
  return PROFILES[profile];
}
