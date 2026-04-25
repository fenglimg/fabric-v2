# Selection Token Protocol

**Session**: ANL-2026-04-25-fabric-v2核心认知对齐方案  
**Date**: 2026-04-25  
**Status**: User-approved protocol refinement.

## Core Decision

`fab_plan_context` should return a unified description index for L0/L1/L2, but AI should only make semantic decisions for L1.

Layer responsibilities:

- **L0**: required automatically.
- **L2**: required automatically based on target path/resource locality.
- **L1**: AI-selectable from the description index after inspecting involved files.

Final rule section fetch must include both:

```text
required_stable_ids + ai_selected_l1_stable_ids
```

The client should not be responsible for manually re-adding L0/L2. The server should enforce this through a `selection_token`.

## `fab_plan_context` Output

Recommended shape:

```ts
type PlanContextResult = {
  revision_hash: string;
  stale: boolean;
  selection_token: string;
  entries: Array<{
    path: string;
    requirement_profile: RequirementProfile;
    description_index: RuleDescriptionIndexItem[];
    required_stable_ids: string[]; // L0 + L2
    ai_selectable_stable_ids: string[]; // L1
    initial_selected_stable_ids: string[]; // same as required_stable_ids
    selection_policy: {
      required_levels: ["L0", "L2"];
      ai_selectable_levels: ["L1"];
      final_fetch_rule: "required_stable_ids + ai_selected_l1_stable_ids";
    };
  }>;
  shared: {
    required_stable_ids: string[];
    ai_selectable_stable_ids: string[];
    description_index: RuleDescriptionIndexItem[];
    preflight_diagnostics: Diagnostic[];
  };
};
```

`description_index` includes L0/L1/L2 descriptions so the AI can see the whole context map, but only L1 ids are eligible for AI selection.

## AI Selection Output

AI should produce only L1 selections:

```ts
type AiRuleSelection = {
  selection_token: string;
  ai_selected_stable_ids: string[];
  selection_reasons: Array<{
    stable_id: string;
    confidence: "low" | "medium" | "high";
    evidence: string[];
    reason: string;
    matched_profile_fields: Array<
      "target_path" | "inferred_domain" | "known_tech" | "intent_tokens" | "impact_hints" | "detected_entities"
    >;
    rejected_alternatives?: Array<{
      stable_id: string;
      reason: string;
    }>;
  }>;
};
```

AI must not select L0/L2 manually. If it does, the server may ignore, warn, or reject depending on strictness mode.

## L1 Selection Reason Contract

L1 selection reasons are first-class protocol data, but they should not be returned by `fab_plan_context`.

`fab_plan_context` should provide only the structured description index and selection policy. It should avoid returning `score`, `confidence`, `match_reasons`, `negative_reasons`, or `matched_profile_fields` for L1 candidates, because those fields can bias the AI's own semantic judgment.

For each AI-selected L1 rule, `fab_get_rule_sections` input should carry:

```ts
type AiSelectionReason = {
  stable_id: string;
  confidence: "low" | "medium" | "high";
  evidence: string[];
  reason: string;
  matched_profile_fields: Array<
    "target_path" | "inferred_domain" | "known_tech" | "intent_tokens" | "impact_hints" | "detected_entities"
  >;
  rejected_alternatives?: Array<{
    stable_id: string;
    reason: string;
  }>;
};
```

This makes L1 selection auditable and gives later tooling data to improve description quality, keyword coverage, and ranking thresholds.

## `fab_get_rule_sections` Input

Recommended shape:

```ts
type GetRuleSectionsInput = {
  selection_token: string;
  ai_selected_stable_ids?: string[];
  ai_selection_reasons?: AiSelectionReason[];
  sections: Array<"MANDATORY_INJECTION" | "CONTEXT_INFO" | "EXAMPLES">;
};
```

The server resolves:

```text
final_stable_ids = token.required_stable_ids + ai_selected_stable_ids
```

Then returns sections for all final stable ids.

## Guardrails

1. First version stores `selection_token` in an in-memory cache with TTL.
2. If `selection_token` is missing or expired, return a deterministic hard error.
3. If an `ai_selected_stable_id` is not in the token's `ai_selectable_stable_ids`, return a hard error.
4. If `ai_selected_stable_ids` is non-empty but `ai_selection_reasons` is missing or incomplete, return a hard error.
5. L0/L2 required ids are always included by server-side merge.
6. Cross-layer precedence remains fixed: `L2 > L1 > L0`.
7. Same-layer `priority` only sorts rules inside each layer.

## Telemetry and Improvement Loop

The server should append a structured audit event when `fab_get_rule_sections` resolves a token:

```ts
type RuleSelectionAuditEvent = {
  type: "rule_selection";
  selection_token: string;
  target_paths: string[];
  required_stable_ids: string[];
  ai_selectable_stable_ids: string[];
  ai_selected_stable_ids: string[];
  final_stable_ids: string[];
  selection_reasons: AiSelectionReason[];
  rejected_or_ignored_ids: Array<{
    stable_id: string;
    reason: string;
  }>;
  timestamp: string;
};
```

Audit destination: `.fabric/audit.jsonl`.

The audit stream should support later quality analysis:

- Which L1 rules are frequently selected?
- Which L1 rules are frequently visible but never selected?
- Which selected rules lack strong evidence?
- Which descriptions produce low-confidence selections?
- Which `intent_clues` or `tech_stack` terms correlate with correct selection?
- Which rules should add `negative_clues` because they are often over-selected?

This creates the feedback loop needed to improve L1 descriptions and ranking without guessing.

## Why This Is Better

This protocol prevents three failure modes:

1. AI forgetting L0/L2 required rules.
2. AI overreaching into layers it should not decide.
3. The section API receiving an incomplete stable_id set.

It also preserves AI's useful role: semantic L1 selection from structured descriptions after inspecting involved files.
