# Test-Fix Implementation Plan: Fabric cognitive protocol against oops-framework

**Session**: `WFS-test-fabric-cognitive-oops-e2e`  
**Workflow**: `workflow-test-fix-cycle`  
**Implementation repo**: `/mnt/c/Project/fabric-v2`  
**Target repo**: `/mnt/c/Project/oops-framework`

## 1. Goal

Validate all target-facing functionality changed by commits `c4d957a`, `c7b1988`, and `383fefc` by using a locally built Fabric against `/mnt/c/Project/oops-framework` without modifying production source files in either repo.

The plan must prove 4 layers:

1. `L0` read-only safety and static contract validation in the original dirty repo.
2. `L1` focused Fabric confidence checks in `fabric-v2`.
3. `L2` disposable-copy scaffold and service smoke E2E.
4. `L3` rule-section, audit, doctor, and blocker-fix execution with a max of `10` iterations.

## 2. Locked Constraints

- Only write workflow artifacts under `/mnt/c/Project/fabric-v2/.workflow/active/WFS-test-fabric-cognitive-oops-e2e`.
- Do not modify production source files.
- Keep `/mnt/c/Project/oops-framework` read-only for `git status --short` and `fabric init --plan`.
- Run `fabric init --yes` and all write-heavy protocol E2E only in a disposable filesystem copy of `/mnt/c/Project/oops-framework`.
- Trust current code-and-test reality over stale planning assumptions; existing coverage for the new protocol already lands in Vitest.
- Treat commit `916d3fe` as workflow evidence only, not as a runtime contract driver.

## 3. Evidence Base

Changed functionality that must be validated:

- `c4d957a`: init taxonomy generation and shared `stable_id` schema.
- `c7b1988`: `fab_plan_context`, `fab_get_rule_sections`, `rule_selection` audit, `fabric doctor --audit`, and tool registration.
- `383fefc`: docs/runtime contract alignment for the two-step protocol.

Confirmed local validation commands:

```bash
pnpm -r build
pnpm --filter @fenglimg/fabric-cli test
pnpm --filter @fenglimg/fabric-server exec vitest run src/index.test.ts src/services/plan-context.test.ts src/services/rule-sections.test.ts src/services/audit-log.test.ts src/services/doctor.test.ts src/tools/rule-sections.test.ts
pnpm --filter @fenglimg/fabric-shared exec vitest run test/agents-meta.test.ts
```

Required external validation commands:

```bash
git status --short
fabric init --plan
fabric init --yes
fabric doctor --audit
```

Required server smoke surface:

- Import built server services and call `planContext`.
- Import built server services and call `getRuleSections`.
- Validate representative paths:
  - `README.md`
  - `assets/script/Main.ts`
  - `assets/script/game/initialize/Initialize.ts`
  - `assets/script/game/common/config/GameUIConfig.ts`
  - `doc/using.md`

## 4. Task Breakdown

### IMPL-001: Test harness and disposable-copy execution design

Purpose: generate the reusable test harness, command wrappers, and execution notes needed to validate `L0-L3` safely.

Scope:

- Define `6` command groups: `[build, cli-vitest, server-vitest, shared-vitest, read-only-preflight, disposable-copy-e2e]`.
- Define `5` representative target paths: `[README.md, assets/script/Main.ts, assets/script/game/initialize/Initialize.ts, assets/script/game/common/config/GameUIConfig.ts, doc/using.md]`.
- Define `4` artifact checks in the disposable copy: `[.fabric/INITIAL_TAXONOMY.md, .fabric/bootstrap/README.md, .fabric/agents.meta.json, .fabric/forensic.json]`.
- Define `2` server API entry points to invoke from built output: `[planContext, getRuleSections]`.

Deliverables:

- Harness-oriented task JSON with quantified requirements and measurable acceptance.
- Explicit test commands for build, focused Vitest, type checks, read-only `init --plan`, disposable-copy `init --yes`, server service import, and audit verification.

### IMPL-001.3: L0 static validation and AI issue scan

Purpose: verify the implementation surface is coherent before live E2E and scan for test blind spots or protocol drift.

Scope:

- Validate `4` contract groups: `[commit coverage mapping, tool exposure, docs/runtime agreement, target-repo safety assumptions]`.
- Run `4` analysis classes: `[static command review, changed-surface verification, AI issue scan, execution blocker classification]`.
- Produce `3` blocker severities: `[must-fix-before-e2e, can-fix-during-IMPL-002, informational]`.

### IMPL-001.5: Quality gate

Purpose: enforce a go/no-go gate before disposable-copy E2E execution.

Scope:

- Gate `4` layers: `[L0, L1, L2 entry readiness, L3 entry readiness]`.
- Check `5` must-pass items: `[build command present, focused Vitest commands present, read-only safety preserved, disposable-copy strategy documented, max_iterations=10 recorded]`.

### IMPL-002: Execute E2E flow and fix blockers

Purpose: run the disposable-copy flow, validate the protocol end-to-end, and fix test blockers within the workflow cycle limit.

Scope:

- Execute `8` ordered E2E phases from the context package candidate flow.
- Validate `15` named scenarios from the test analysis.
- Allow up to `10` fix iterations with summaries under `.summaries/iteration-summaries/`.

## 5. Dependency And Execution Strategy

Execution order:

1. `IMPL-001`
2. `IMPL-001.3`
3. `IMPL-001.5`
4. `IMPL-002`

CLI continuity:

- `IMPL-001` starts a new execution thread.
- `IMPL-001.3` resumes from `IMPL-001`.
- `IMPL-001.5` resumes from `IMPL-001.3`.
- `IMPL-002` resumes from `IMPL-001.5`.

This keeps all test-fix reasoning in one continuous session while still separating harness design, static validation, quality gate, and live execution.

## 6. Acceptance Criteria

The session is ready for execution when all of the following are true:

- The plan references the required commands: `pnpm -r build`, focused Vitest commands, `fabric init --plan`, `fabric init --yes`, built-service calls for `planContext` and `getRuleSections`, and `fabric doctor --audit`.
- The original `/mnt/c/Project/oops-framework` is explicitly limited to read-only checks.
- The disposable-copy strategy is the only allowed path for write-heavy E2E.
- `IMPL-002` states `max_iterations = 10`.
- Every task JSON contains quantified requirements, concrete focus paths, and measurable acceptance checks.

## 7. Risks

- The root test shortcut `pnpm -r --if-present test` is insufficient because server and shared tests are not guaranteed to run from package scripts.
- The target repo has a heavy dirty state, so any accidental direct write would corrupt unrelated user work.
- `selection_token` is in-memory state; token-expiry checks must run against the same live server process.
- A shallow bootstrap-only init pass is not enough; the disposable copy needs enough project rule material to make `L1` and `L2` sections meaningful.

## 8. N+1 Context

### Decisions

| Decision | Rationale | Revisit? |
|----------|-----------|----------|
| Original `oops-framework` stays read-only for this session | Dirty working tree is high risk | No |
| Disposable copy is required for `fabric init --yes` and protocol E2E | Plain copy preserves current dirty state safely | No |
| Execution plan uses one linear CLI thread across `IMPL-001` → `IMPL-002` | Preserves blocker context and iteration history | No |
| Focus validation on `c4d957a`, `c7b1988`, `383fefc` | `916d3fe` is workflow evidence only | No |

### Deferred

- [ ] Add an automated disposable-copy helper script if repeated E2E cycles become noisy in later sessions.
- [ ] Add machine-readable pass-rate aggregation once the first execution cycle produces real result artifacts.
