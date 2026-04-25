# TDD Implementation Plan: Fabric-v2 Cognitive Alignment Refactor

**Session**: WFS-fabric-v2-cognitive-alignment-tdd  
**Workflow**: TDD planning only  
**Source analysis**: `.workflow/.analysis/ANL-2026-04-25-fabric-v2核心认知对齐方案/`

## 1. Requirements Summary

Refactor Fabric-v2 to match the locked cognitive alignment protocol:

- New rule content lives under `.fabric/rules/`.
- `stable_id` is the only rule identity; `RuleDescription` must not define `id`.
- `fabric init` writes Markdown-only `.fabric/INITIAL_TAXONOMY.md`.
- `fab_plan_context` returns a neutral L0/L1/L2 `description_index`, lightweight `requirement_profile`, `required_stable_ids`, `ai_selectable_stable_ids`, and `selection_token`.
- `fab_plan_context` must not return L1 `score`, `confidence`, `match_reasons`, `negative_reasons`, or `matched_profile_fields`.
- `fab_get_rule_sections` replaces `fab_get_rules`.
- `selection_token` v1 uses in-memory cache + TTL.
- Invalid L1 selections and missing/incomplete `ai_selection_reasons` are hard errors.
- `fab_get_rule_sections` merges required L0/L2 with AI-selected L1 and appends `rule_selection` events to `.fabric/audit.jsonl`.
- Missing requested sections return empty section + warning diagnostic; never fallback to full content.
- Cross-layer precedence is fixed: `L2 > L1 > L0`; `priority` only sorts within the same layer.

## 2. Test Strategy

Framework: Vitest.

Current test command caveat:

- Root has `pnpm -r --if-present test`.
- `packages/cli` has `vitest run`.
- `packages/server`, `packages/shared`, and `packages/dashboard` contain tests but do not expose package-level test scripts. Red tests should use direct `pnpm exec vitest run <paths>` unless adding package scripts is included in a task.

Coverage goals:

- Shared schema: positive/negative tests for registry-first node shape and stable_id-only identity.
- CLI init: taxonomy scaffold tests in plan and execution paths.
- Server plan context: neutral output contract and selection token issuance.
- Server sections: parser, token validation, merge, missing-section diagnostics, precedence.
- Audit: `rule_selection` append/read tests.
- Tools/index: MCP registration and tool schema validation.
- Docs/dashboard follow-up: contract alignment after core service tests pass.

## 3. Task Breakdown with Red-Green-Refactor Cycles

### IMPL-1: Shared Registry Schema and Stable Identity

Goal: Define the new registry-first shape around `.fabric/rules/`, structured descriptions, `content_ref`, explicit levels, and stable_id-only identity.

Red:

- Add failing shared schema tests for `RuleDescription` without `id`.
- Add failing tests for explicit `level`, `content_ref`, `.fabric/rules/` rule nodes, and minimal `RuleDescriptionIndexItem`.
- Add negative test that `description.id` is rejected or stripped according to chosen schema strictness.

Green:

- Extend shared types/schemas with `RuleDescription`, `RuleDescriptionIndexItem`, and registry-first node fields.
- Ensure `stable_id` remains node-level identity.
- Remove path-depth derivation from new-node semantics.

Refactor:

- Keep schema helpers small and explicit.
- Preserve only the compatibility needed by tests that still characterize existing code until downstream tasks migrate it.

### IMPL-2: Init Taxonomy Artifact

Goal: Make `fabric init` generate Markdown-only `.fabric/INITIAL_TAXONOMY.md`.

Red:

- Add failing `buildInitFabricPlan` test for `taxonomyPath`, `taxonomyAction`, and `taxonomyContent`.
- Add failing execution test that writes `.fabric/INITIAL_TAXONOMY.md`.
- Assert Markdown contains L0/L1/L2 definitions, initial L1 bucket guidance, and evolution guide.

Green:

- Extend init plan/result types and scaffold writer.
- Generate deterministic Markdown from forensic/init context.

Refactor:

- Keep taxonomy generation isolated in helper(s), not embedded in large init flow branches.

### IMPL-3: Neutral `fab_plan_context` and Selection Token Issuance

Goal: Replace old plan-context shared bundle output with neutral profile/index/token planning output.

Red:

- Add failing tests for `selection_token`.
- Add failing tests for lightweight `requirement_profile` without L1 judgment fields.
- Add failing tests for `description_index` with `stable_id`, `level`, `required`, `selectable`, `description`.
- Add negative tests ensuring L1 output has no `score`, `confidence`, `match_reasons`, `negative_reasons`, or `matched_profile_fields`.
- Assert L0/L2 are required and L1 is AI-selectable.

Green:

- Implement deterministic requirement profile generation.
- Build unified description index from registry nodes.
- Add in-memory selection token cache with TTL.
- Update tool schema.

Refactor:

- Extract registry/index helpers so `plan-context` no longer depends on full `get-rules` payload builders.

### IMPL-4: Rule Section Parser and `fab_get_rule_sections`

Goal: Implement section-based rule retrieval and replace the old full-rule `fab_get_rules` workflow.

Red:

- Add parser tests for `[MANDATORY_INJECTION]`, `[CONTEXT_INFO]`, missing section, duplicate/nested headings, and ordering.
- Add service tests for token lookup, final stable id merge, and empty section + warning for missing sections.
- Add hard-error tests for missing/expired token, invalid L1 stable id, and missing/incomplete AI selection reasons.
- Add tool schema tests for `selection_token`, `ai_selected_stable_ids`, `ai_selection_reasons`, and section enums.

Green:

- Implement parser and section service.
- Implement `fab_get_rule_sections` tool.
- Register new tool and remove/stop registering `fab_get_rules` after replacement tests pass.

Refactor:

- Keep parser independent from MCP/tool code.
- Keep token validation and section loading separated for testability.

### IMPL-5: Rule Selection Audit Telemetry

Goal: Append `rule_selection` events to `.fabric/audit.jsonl` when sections are resolved.

Red:

- Add failing audit-log tests for `rule_selection` event append/read.
- Assert required ids, AI-selectable ids, AI-selected ids, final ids, selection reasons, rejected/ignored ids, and target paths.
- Add section-service test proving successful resolution appends telemetry.

Green:

- Extend audit-log entry union and append helper.
- Call helper from section service after token resolution.

Refactor:

- Preserve existing get_rules/edit_intent audit behavior.
- Keep telemetry append best-effort only if that remains the project-wide audit principle; otherwise document the exception.

### IMPL-6: Precedence, Priority, and Final Section Ordering

Goal: Encode fixed cross-layer precedence and same-layer priority ordering.

Red:

- Add tests showing final section payload includes L0/L1/L2 rules but reports precedence `L2 > L1 > L0`.
- Add tests showing `priority` sorts only within a layer.
- Add tests proving AI cannot select L0/L2 manually.

Green:

- Add precedence metadata to section output.
- Sort same-layer selected rules by priority.
- Keep server-side merge authoritative.

Refactor:

- Centralize ordering logic in one helper used by section service and future dashboard/API consumers.

### IMPL-7: Documentation and Consumer Alignment

Goal: Align docs and consumer surfaces with the new protocol.

Red:

- Add doc/contract checks if available, or explicit review checklist in task acceptance criteria.
- Add tests for tool registration showing `fab_get_rule_sections` exists and `fab_get_rules` no longer registers.
- Add dashboard/API follow-up tests only if the dashboard remains a consumer of rule context in this cycle.

Green:

- Update `docs/SPEC_INTERNAL.md`, `docs/initialization.md`, `docs/getting-started.md`, and `docs/RULE_REGISTRY.md`.
- Update server index/tool registration.
- Update or defer dashboard REST/UI behavior explicitly.

Refactor:

- Remove stale wording about description stubs, path-depth L1 derivation, and old full-rule fetch.

## 4. Implementation Strategy

Recommended execution order:

1. IMPL-1 shared schema.
2. IMPL-2 init taxonomy.
3. IMPL-3 neutral plan context and token.
4. IMPL-4 section parser/tool.
5. IMPL-5 audit telemetry.
6. IMPL-6 precedence/order.
7. IMPL-7 docs/consumers.

This order keeps shared contracts ahead of server behavior and keeps new section retrieval passing before removing the old tool.

## 5. Risk Assessment

Conflict risk: medium.

Known risks:

- Existing uncommitted WIP must not be overwritten: `.fabric/audit.jsonl`, `.intent-ledger.jsonl`, `packages/cli/src/scanner/tree-sitter-probe.ts`.
- `plan-context` currently reuses `get-rules`; refactor behind tests before deleting old behavior.
- Root test script does not guarantee server/shared/dashboard tests. Use direct Vitest paths or add package scripts.
- Removing `fab_get_rules` can break dashboard/HTTP docs if not sequenced after `fab_get_rule_sections`.

Quality gate:

- Do not start Green implementation for any task until its Red tests fail for the expected reason.
- Each task must preserve existing relevant tests unless the task explicitly replaces a contract and updates tests accordingly.
