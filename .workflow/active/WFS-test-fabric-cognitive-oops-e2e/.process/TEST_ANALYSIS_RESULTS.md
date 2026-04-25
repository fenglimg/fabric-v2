# Test Analysis Results

Session: `WFS-test-fabric-cognitive-oops-e2e`  
Date: `2026-04-25`  
Mode: Read-only analysis

## Project Type Detection

- Fabric implementation repo: `pnpm` TypeScript monorepo with workspace packages under `packages/*`.
- Primary validation surfaces:
  - `packages/cli`: CLI init/serve/doctor behavior, Vitest wired via package script.
  - `packages/server`: MCP/HTTP server, protocol services, tool registration, doctor/audit logic, Vitest tests present but no package `test` script.
  - `packages/shared`: schema/types for `agents.meta`, Vitest tests present but no package `test` script.
- Target repo: `/mnt/c/Project/oops-framework`
  - Single-package Cocos Creator `3.8.7` TypeScript app.
  - No meaningful npm test/build scripts detected.
  - Heavy pre-existing dirty working tree.
  - `.fabric` directory exists but currently has no files on disk, so protocol validation cannot be done safely in-place beyond read-only checks.

## Coverage Assessment: Current vs Required

### Current Coverage Confirmed In Repo

- `c4d957a` init taxonomy surface:
  - Covered by `packages/cli/__tests__/init-nondestructive.test.ts`
  - Confirms `--plan` stays non-destructive and `.fabric/INITIAL_TAXONOMY.md` is written as Markdown-only.
- `c4d957a` schema surface:
  - Covered by `packages/shared/test/agents-meta.test.ts`
  - Confirms structured description schema, `stable_id`-only identity, registry-first nodes.
- `c7b1988` plan-context surface:
  - Covered by `packages/server/src/services/plan-context.test.ts`
  - Confirms neutral `requirement_profile`, `description_index`, `selection_token`, stale handling.
- `c7b1988` section retrieval surface:
  - Covered by `packages/server/src/services/rule-sections.test.ts`
  - Confirms required `L0/L2` + AI-selected `L1` merge, invalid selection hard errors, missing/expired token failure, missing-section warning behavior, precedence ordering.
- `c7b1988` tool registration surface:
  - Covered by `packages/server/src/tools/rule-sections.test.ts` and `packages/server/src/index.test.ts`
  - Confirms `fab_get_rule_sections` registration and `fab_get_rules` not registered as primary MCP tool.
- `c7b1988` audit/doctor compatibility:
  - Covered by `packages/server/src/services/audit-log.test.ts` and `packages/server/src/services/doctor.test.ts`
  - Confirms `rule_selection` audit events and doctor audit compatibility.

### Coverage Gaps That Still Matter

- External build/install gap:
  - No executed proof yet that a locally built Fabric binary works end-to-end against a real external repo.
- CLI to server integration gap:
  - No validation yet that `fabric init --plan`, `fabric init --yes` or `fabric serve` behave correctly against `oops-framework` topology.
- Real-project rule corpus gap:
  - Server tests use temp fixtures; they do not prove the protocol works with project-specific rules generated for a real Cocos app.
- Disposable-copy safety gap:
  - No validation yet of the required safe flow: read-only checks in the real repo, writes only in a filesystem copy.
- Docs-to-runtime gap:
  - `README.md`, `docs/getting-started.md`, `docs/initialization.md`, and `docs/SPEC_INTERNAL.md` describe the new two-step protocol, but there is no external E2E proof that the documented flow matches local runtime behavior.

### Coverage Conclusion

- Unit/integration coverage for the new protocol is stronger than the context package suggests.
- The main missing layer is not more service-level Vitest coverage; it is real local-build validation against a disposable copy of `/mnt/c/Project/oops-framework`.

## Test Framework And Commands

### Fabric Repo

- Framework: `Vitest`
- Build baseline:
```bash
pnpm install
pnpm -r build
```

- Root script:
```bash
pnpm -r --if-present test
```
Note: this is insufficient by itself because `packages/server` and `packages/shared` contain tests but no package-level `test` scripts.

- Required explicit validation commands:
```bash
pnpm --filter @fenglimg/fabric-cli test
pnpm --filter @fenglimg/fabric-server exec vitest run src/index.test.ts src/services/plan-context.test.ts src/services/rule-sections.test.ts src/services/audit-log.test.ts src/services/doctor.test.ts src/tools/rule-sections.test.ts
pnpm --filter @fenglimg/fabric-shared exec vitest run test/agents-meta.test.ts
```

### oops-framework Target Repo

- Framework shape: Cocos Creator app, not a Node test project.
- Safe read-only preflight commands:
```bash
git status --short
fabric init --plan
```

- Write validation must happen only in a disposable filesystem copy.

## L0-L3 Test Plan

### L0: Preflight / Safety / Static Contract

Goal: prove the target repo must remain read-only during initial validation.

- Record `git status --short` in `/mnt/c/Project/oops-framework`.
- Confirm `package.json` indicates Cocos Creator `3.8.7`.
- Confirm `.fabric` exists but is effectively uninitialized for this protocol.
- Confirm no Node test/build scripts exist that would substitute for protocol-level validation.
- Confirm docs and server registration agree on `fab_plan_context -> fab_get_rule_sections`.

Exit criteria:

- Original target repo remains unmodified.
- Disposable-copy strategy is required and documented.

### L1: Fabric Local Confidence

Goal: validate changed Fabric surfaces in the implementation repo.

- Run explicit Vitest commands for CLI, server, and shared packages.
- Treat failures in any of these as blockers before external E2E.
- Require direct evidence for:
  - taxonomy artifact generation
  - `stable_id`-only schema behavior
  - `selection_token`
  - `fab_get_rule_sections`
  - `rule_selection` audit
  - doctor audit compatibility

Exit criteria:

- All targeted test commands pass.
- No reliance on root `pnpm -r --if-present test` alone.

### L2: Disposable-Copy Smoke E2E

Goal: prove locally built Fabric works against a realistic copy of `oops-framework`.

- Create a plain filesystem copy of `/mnt/c/Project/oops-framework`.
- Build Fabric locally with `pnpm -r build`.
- In the copy:
  - run `fabric init --plan`
  - run `fabric init --yes` or `fabric init --reapply --yes` based on plan output
  - verify `.fabric/INITIAL_TAXONOMY.md`
  - verify `.fabric/bootstrap/README.md`
  - verify `.fabric/agents.meta.json`
  - verify `.fabric/forensic.json`
- Start `fabric serve` against the copy.
- Smoke-test plan-context for:
  - `README.md`
  - `assets/script/Main.ts`
  - `assets/script/game/initialize/Initialize.ts`
  - `assets/script/game/common/config/GameUIConfig.ts`
  - `doc/using.md`

Exit criteria:

- Local build runs successfully in the copied repo.
- Returned plan-context data includes `revision_hash`, `selection_token`, `required_stable_ids`, `ai_selectable_stable_ids`, and neutral `description_index`.

### L3: Full Protocol / Audit / Behavioral E2E

Goal: prove the new cognitive alignment loop works with real project rules.

- Continue project-rule completion in the disposable copy until meaningful `L1` and `L2` rules exist.
- Call `fab_get_rule_sections` with:
  - valid `L1` selections
  - `MANDATORY_INJECTION`
  - `CONTEXT_INFO`
- Verify warning-only handling for missing structured sections.
- Verify hard errors for:
  - missing/expired `selection_token`
  - invalid `L1` ids
  - selecting required-only ids as AI choices
  - missing `ai_selection_reasons`
- Confirm `.fabric/audit.jsonl` records `rule_selection`.
- Run `fabric doctor --audit` in the copy and confirm the new protocol is accepted.

Exit criteria:

- End-to-end protocol works without touching the original dirty repo.
- Audit and doctor flows accept `rule_selection` as the rule-access precursor.

## AI Code Issue Scan Risks

- Root test blind spot:
  - `pnpm -r --if-present test` does not guarantee server/shared test execution.
- Context drift risk:
  - The provided context package underreports the currently landed Vitest coverage; execution should trust code/test reality over stale planning assumptions.
- Legacy path confusion:
  - REST still exposes legacy read-only rules context while MCP editing now expects `fab_plan_context` + `fab_get_rule_sections`.
- Disposable-copy requirement:
  - The target repo is heavily dirty; any direct write validation risks overwriting unrelated user work.
- Partial Fabric state:
  - Empty `.fabric` and adjacent AI-tool directories may alter init/reapply branching.
- Shallow bootstrap false positive:
  - A bootstrap-only init pass is not enough; protocol validation requires project-specific rules so `L1` selection is meaningful.
- Token lifecycle risk:
  - `selection_token` is an in-memory runtime artifact, so E2E must keep the same live server process when testing expiry/missing-token behavior.
- Target-tooling mismatch:
  - `oops-framework` is not a normal npm-tested app, so success must be measured through protocol behavior and generated artifacts, not package scripts.

## E2E Scenario List For Local Fabric Build + oops-framework Copy

1. Read-only preflight in original repo
   - Capture dirty state and confirm in-place writes are disallowed.
2. Read-only init planning in original repo
   - Run `fabric init --plan` to understand whether Fabric sees the repo as first init or partial reapply.
3. Filesystem copy creation
   - Copy the full current working tree without stash/reset/worktree tricks.
4. Scaffold write validation in copy
   - Run init based on step 2 outcome and verify generated `.fabric` artifacts.
5. Tool exposure validation
   - Start `fabric serve` and verify MCP/server exposes `fab_plan_context` and `fab_get_rule_sections`.
6. Cocos entry-path plan-context scenario
   - Query `assets/script/Main.ts` and expect broad app-level required ids plus selectable domain rules.
7. Initialization-flow plan-context scenario
   - Query `assets/script/game/initialize/Initialize.ts` and expect initialization-specific routing.
8. UI/config plan-context scenario
   - Query `assets/script/game/common/config/GameUIConfig.ts` and expect UI/config domain candidates.
9. Docs-path plan-context scenario
   - Query `doc/using.md` and confirm non-code path support with neutral output.
10. Valid rule-section retrieval
   - Use selected `L1` ids plus requested sections and verify merged `L0/L1/L2` results.
11. Missing-section warning scenario
   - Request a section absent from one matched rule and verify empty string plus warning, never full fallback.
12. Invalid-selection failure scenario
   - Pass a non-selectable or required-only id and expect hard failure.
13. Missing-reason failure scenario
   - Omit `ai_selection_reasons` for a chosen `L1` id and expect hard failure.
14. Expired/missing-token failure scenario
   - Reuse an invalid token or restart the server and verify token rejection.
15. Audit/doctor compatibility scenario
   - After successful section fetch, verify `rule_selection` lands in `.fabric/audit.jsonl` and `fabric doctor --audit` accepts it.

## Acceptance Criteria And Pass-Rate Calculation

### Acceptance Criteria

- L0 passes:
  - Original `/mnt/c/Project/oops-framework` is never written during preflight.
- L1 passes:
  - Explicit CLI/server/shared Vitest commands pass.
- L2 passes:
  - Local Fabric build initializes a disposable copy and produces required `.fabric` artifacts.
  - `fabric serve` works against the copy.
  - `fab_plan_context` returns the documented protocol fields on representative target paths.
- L3 passes:
  - `fab_get_rule_sections` succeeds for valid choices.
  - Failure paths behave exactly as specified.
  - `rule_selection` is logged.
  - `fabric doctor --audit` remains compatible.

### Pass-Rate Formula

Use weighted pass rate to reflect risk:

- L0: `15%`
- L1: `25%`
- L2: `30%`
- L3: `30%`

For each layer:

- `pass_rate(layer) = passed_checks / total_checks`

Overall:

```text
overall = L0*0.15 + L1*0.25 + L2*0.30 + L3*0.30
```

Recommended quality gates:

- `>= 0.95`: ready to mark validated
- `0.80 - 0.94`: partial pass, fix required before sign-off
- `< 0.80`: fail

Hard-fail conditions regardless of weighted score:

- Any write performed in the original dirty `oops-framework` repo
- Any failed explicit L1 command
- Missing required `.fabric` artifacts after init in the copy
- Missing `selection_token` / `rule_selection` / doctor-audit compatibility in L3

## Recommended Next Execution Order

1. Run explicit L1 Vitest commands in `fabric-v2`.
2. Run read-only preflight plus `fabric init --plan` in original `oops-framework`.
3. Create disposable copy of `oops-framework`.
4. Run L2 scaffold validation in the copy.
5. Run L3 protocol and audit validation in the copy.

## Analysis Notes

- This result intentionally corrects one stale planning assumption: server-side protocol coverage already exists in the repo tests for `plan-context`, `rule-sections`, `audit-log`, `doctor`, and tool registration.
- The highest-value remaining work is disposable-copy E2E against `oops-framework`, not duplicating already-covered unit tests.
