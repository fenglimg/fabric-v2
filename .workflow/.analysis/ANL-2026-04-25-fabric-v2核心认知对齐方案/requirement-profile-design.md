# Requirement Profile Design

**Session**: ANL-2026-04-25-fabric-v2核心认知对齐方案  
**Date**: 2026-04-25  
**Purpose**: Define how `fab_plan_context` should construct and use Requirement Profiles for L1/L2 rule candidate ranking.

## Intended Role

Requirement Profile is not a user-facing document. It is a server-generated, deterministic matching object used by `fab_plan_context` to rank rule descriptions before any mandatory rule sections are fetched.

Its job is to answer:

> Given this target path and this user intent, which L1/L2 rule descriptions are likely relevant enough to show or select before editing?

It should not load full rule bodies. It should not inject `[MANDATORY_INJECTION]`. That belongs to `fab_get_rule_sections`.

After the selection-token refinement, Requirement Profile feeds a broader selection protocol:

- L0 and L2 descriptions are included in the index for visibility.
- L0 and L2 stable ids are automatically required.
- L1 descriptions are AI-selectable.
- `fab_get_rule_sections` receives a `selection_token` plus AI-selected L1 ids and server-side merges the final stable id set.

## Input Shape

`fab_plan_context` should accept:

```ts
type PlanContextInput = {
  paths: string[];
  intent?: string;
  known_tech?: string[];
  detected_entities?: Record<string, string[]>;
  client_hash?: string;
};
```

Field intent:

- `paths`: candidate target files.
- `intent`: raw user request, for example "优化战斗界面的渲染性能"。
- `known_tech`: optional client/user hints, for example `["Cocos Creator", "TypeScript"]`。
- `detected_entities`: optional hints if the caller already inspected files, for example `{ "assets/scripts/ui/BattleView.ts": ["cc.Label", "SpriteAtlas", "Layout"] }`。
- `client_hash`: stale detection.

## Generated Profile Shape

For each path, server generates:

```ts
type RequirementProfile = {
  target_path: string;
  path_segments: string[];
  extension: string;
  inferred_domain: string[];
  known_tech: string[];
  user_intent: string;
  intent_tokens: string[];
  impact_hints: string[];
  detected_entities: string[];
  confidence: "low" | "medium" | "high";
};
```

Example:

```json
{
  "target_path": "assets/scripts/ui/BattleView.ts",
  "path_segments": ["assets", "scripts", "ui", "BattleView.ts"],
  "extension": ".ts",
  "inferred_domain": ["UI", "Gameplay"],
  "known_tech": ["Cocos Creator", "TypeScript"],
  "user_intent": "我想优化战斗界面的渲染性能",
  "intent_tokens": ["优化", "战斗界面", "渲染", "性能"],
  "impact_hints": ["Performance"],
  "detected_entities": ["cc.Label", "SpriteAtlas", "Layout"],
  "confidence": "medium"
}
```

## Profile Generation Rules

### 1. Path-derived hints

Use deterministic path heuristics:

- `assets/scripts/ui/**` -> `UI`
- `assets/scripts/**` -> `Gameplay`
- `assets/resources/**`, `resources/**` -> `Asset`
- file names containing `Manager`, `Controller`, `Service` -> possible L2 complexity hint
- `.ts` -> `TypeScript`

These heuristics should be small, transparent, and test-covered.

### 2. Intent tokenization

Use simple keyword extraction, not LLM inference.

Initial Chinese/English keyword map:

- performance: `性能`, `优化`, `drawcall`, `渲染`, `卡顿`, `闪烁`, `batch`
- UI: `界面`, `UI`, `Label`, `Sprite`, `Layout`, `节点`
- asset: `资源`, `图集`, `Prefab`, `SpriteAtlas`, `resources.load`
- lifecycle: `销毁`, `onDestroy`, `初始化`, `init`

This should stay deterministic so tests can assert exact matches.

### 3. Known tech merge

Merge sources in this order:

1. explicit `known_tech`
2. project forensic/init taxonomy tech hints
3. path/extension hints

Deduplicate by normalized lowercase key, but preserve display casing.

### 4. Detected entities

First version should not require AST/tree-sitter.

Use only:

- caller-provided `detected_entities`
- optional lightweight regex scan if the server already has file content available in a later phase

Do not make entity detection a blocker for ranking.

## Rule Description Shape

Rule descriptions in `agents.meta.json` should be structured:

```ts
type RuleDescription = {
  summary: string;
  intent_clues: string[];
  tech_stack: string[];
  impact: string[];
  must_read_if: string;
  entities?: string[];
};
```

`RuleDescription` intentionally does not include `id`. Description is matching metadata only.

Identity remains on the node:

```ts
type RuleNode = {
  stable_id: string;
  level: "L0" | "L1" | "L2";
  priority: "high" | "medium" | "low";
  content_ref: string;
  description: RuleDescription;
};
```

## Selection Model

`fab_plan_context` should not return server-side L1 scores or match reasons in the normal output. The goal is to give AI a clean description index so it can make its own semantic decision after inspecting involved files.

Suggested behavior:

- L0 is always included as baseline metadata, not ranked the same way.
- L1 starts in a global AI-selectable candidate pool.
- L2 should strongly prefer path/resource locality.
- Same-layer `priority` only affects section ordering after final selection.
- Cross-layer precedence remains `L2 > L1 > L0`.

Requirement Profile remains useful as internal context for building the description index and token state, but not as a visible server judgment that biases L1 selection.

## Output Shape

`fab_plan_context` should return:

```ts
type PlanContextResult = {
  revision_hash: string;
  stale: boolean;
  selection_token: string;
  entries: Array<{
    path: string;
    requirement_profile: RequirementProfile;
    description_index: Array<{
      stable_id: string;
      level: "L0" | "L1" | "L2";
      selectable: boolean;
      required: boolean;
      description: RuleDescription;
    }>;
    required_stable_ids: string[];
    ai_selectable_stable_ids: string[];
  }>;
  shared: {
    required_stable_ids: string[];
    ai_selectable_stable_ids: string[];
    description_index: RuleDescriptionIndexItem[];
    preflight_diagnostics: Array<{
      code: string;
      severity: "info" | "warn";
      message: string;
      stable_ids?: string[];
      path?: string;
    }>;
  };
};
```

The returned `requirement_profile` is allowed because it describes the current target. It must remain neutral: no L1 score, confidence, match reason, negative reason, or selected suggestion.

## Missing Section Behavior

If `fab_get_rule_sections` requests a section that a selected rule does not contain:

- return an empty section for that stable id / section name
- include a warning diagnostic
- do not fallback to full rule content

This preserves the structured injection boundary.

## Example

Input:

```json
{
  "paths": ["assets/scripts/ui/BattleView.ts"],
  "intent": "我想优化战斗界面的渲染性能",
  "known_tech": ["Cocos Creator", "TypeScript"],
  "detected_entities": {
    "assets/scripts/ui/BattleView.ts": ["cc.Label", "SpriteAtlas", "Layout"]
  }
}
```

Candidate:

```json
{
  "stable_id": "ui-batch-rendering",
  "level": "L1",
  "selectable": true,
  "required": false,
  "description": {
    "summary": "UI 批处理渲染规范",
    "intent_clues": ["优化 drawcall", "Label 闪烁", "图集失效"],
    "tech_stack": ["Cocos", "UI"],
    "impact": ["Performance"],
    "must_read_if": "修改多个 UI 节点的层级、混合模式、Label/Sprite 渲染路径时"
  }
}
```

## TDD Acceptance Tests

1. Builds a profile from path + intent + known tech.
2. Merges caller-provided detected entities into the profile.
3. Returns a unified description index for L0/L1/L2.
4. Marks L0/L2 as required.
5. Marks L1 as AI-selectable.
6. Does not expose L1 score/confidence/match_reasons in normal plan output.
7. Uses `priority` only as same-layer ordering after final selection.
8. Keeps cross-layer precedence independent from AI selection.
9. Does not require AST/tree-sitter to pass.
