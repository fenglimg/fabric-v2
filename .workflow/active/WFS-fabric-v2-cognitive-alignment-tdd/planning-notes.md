# TDD Planning Notes

## User Intent

TDD: Fabric-v2 cognitive alignment refactor

GOAL: Generate a planning-only TDD implementation plan for refactoring Fabric-v2 to match the locked cognitive alignment protocol.

SCOPE:
- Planning only. Do not modify production code in this workflow.
- Generate Red-Green-Refactor task breakdowns.
- Use the analysis artifacts from `.workflow/.analysis/ANL-2026-04-25-fabric-v2核心认知对齐方案/` as authoritative protocol input.

CONTEXT:
- The current project drifted from the user's intended model.
- The user wants TDD before implementation.
- Compatibility with legacy `.fabric/agents/` is not required.
- Existing uncommitted changes in `.fabric/audit.jsonl`, `.intent-ledger.jsonl`, and `packages/cli/src/scanner/tree-sitter-probe.ts` must be treated as unrelated work-in-progress and not overwritten.

TEST_FOCUS:
- Shared schema negative and positive tests.
- CLI init taxonomy tests.
- Server service/tool contract tests.
- Rule section parser tests.
- Audit telemetry tests.
- TDD checks that production changes follow Red-Green-Refactor.

## Locked Protocol Inputs

- Analysis session: `.workflow/.analysis/ANL-2026-04-25-fabric-v2核心认知对齐方案/`
- Decision locks: `decision-locks.md`
- Requirement profile design: `requirement-profile-design.md`
- Selection token protocol: `selection-token-protocol.md`
- TDD entry decisions: `tdd-entry-decisions.md`
- Preflight concerns: `tdd-preflight-concerns.md`

## TDD Principles

- NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
- Every implementation task must start with Red tests.
- Green phase must implement the minimum code to pass.
- Refactor phase must preserve passing tests.
- Test-fix-cycle max iterations: 3.
