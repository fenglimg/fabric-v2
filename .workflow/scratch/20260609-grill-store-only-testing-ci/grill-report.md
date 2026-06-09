# Grill Report: store-only testing and CI/CD strategy

**Session**: GRL-20260609-store-only-testing-ci
**Depth**: standard (5 branches)
**Date**: 2026-06-09T18:50:36+08:00
**Upstream**: user request in current session

## Discovery Summary

### Project Context

The current architecture is store-only: runtime knowledge lives in mounted
stores under the global Fabric home, not in project-local `.fabric/knowledge`.
The prior store-only grill locked a surface-alignment gate: CLI, server, MCP,
hooks, skills, docs, tests, i18n, doctor, and sync must all be validated
against the same store-only contract before release.

Knowledge search found existing backlog signals:

- `ISS-20260609-006`: onboard-coverage tests do not exercise the mounted-store
  user workflow.
- `ISS-20260609-030`: perf benchmark uses a legacy minimal fixture instead of
  a mounted-store workflow.
- `ISS-20260609-040`: release workflow omits the CI perf benchmark gate before
  publish.
- `ISS-20260609-049`: Windows smoke bypasses the published CLI bin and promised
  `--help` coverage.

### Codebase Surface

- Root scripts run build, recursive tests, coverage, rc gates, lint, and
  typecheck. Reference: `package.json`.
- Main CI runs build, typecheck, knip, package coverage, protected-token lint,
  NO_COLOR CLI tests, perf benchmark, and a Windows smoke job. Reference:
  `.github/workflows/ci.yml:36`.
- Release CI repeats build/typecheck/lint/coverage/protected-token/NO_COLOR but
  does not run the perf benchmark or Windows smoke before publish. Reference:
  `.github/workflows/release.yml:36`.
- Coverage thresholds are uneven by package: shared 85 percent,
  server 75 percent, CLI 70 percent. Reference:
  `packages/shared/vitest.config.ts:17`,
  `packages/server/vitest.config.ts:16`,
  `packages/cli/vitest.config.ts:35`.
- A real-fs store test wall exists: isolated `FABRIC_HOME`, global store root,
  fake bare Git remote, clone/push helpers, and three-client config fixtures.
  Reference: `packages/shared/test/helpers/test-wall.ts:7`.
- Resolver golden tests encode read-set/write-target expected values and legacy
  negative store recognition. Reference:
  `packages/shared/test/resolver/golden-redsuite.test.ts:19`.
- Cross-store write tests assert active/default/route write behavior, personal
  routing, hard failure without a target, and no project dual-root fallback.
  Reference: `packages/server/src/services/cross-store-write.test.ts:144`.

### Assessment Summary

The strategy is not weak, but it is not yet strong enough for a store-only
architecture. Unit and integration coverage are broad, and some TDD-style
red-to-green ratchets exist. The gap is that CI/CD still treats store-only as
a set of package tests plus generic gates, rather than as a release-level user
workflow contract.

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | Scope & Boundaries | Complete | 3 | 1 |
| 2 | Data Model & State | Complete | 3 | 1 |
| 3 | Edge Cases & Failure Modes | Complete | 3 | 1 |
| 4 | Integration & Dependencies | Complete | 3 | 1 |
| 5 | Scale & Performance | Complete | 2 | 1 |

---

## Branch 1: Scope & Boundaries

### Q1.1: Is the current testing strategy enough for store-only?

**Answer**: No. It is adequate for many package-level contracts, but not enough
as a release-level store-only assurance model.

**Evidence**: Existing test wall and cross-store write tests cover key logic,
but backlog issues show important user workflows still use weak fixtures or
incomplete gate surfaces.

**Decision**: locked

**Constraint**: CI MUST include at least one first-class mounted-store workflow
gate that starts from an installed/built CLI, creates or mounts stores, binds a
project, writes pending knowledge, reviews/promotes it, recalls it, and proves
no project-local `.fabric/knowledge` runtime dependency is used.

### Q1.2: Should the upgrade replace existing unit/integration tests?

**Answer**: No. The upgrade should add a store-only acceptance layer above the
existing package suites.

**Evidence**: Current package suites already cover resolver, schema, doctor,
MCP contracts, write routing, hook logic, i18n, and snapshots. Replacing them
would lose useful localized fault isolation.

**Decision**: locked

**Constraint**: Store-only CI SHOULD be additive: keep package tests and add
contract/E2E gates for final architecture invariants.

### Q1.3: What is out of scope for this upgrade?

**Answer**: Browser/UI testing and experimental HTTP server full release gating
remain out of scope unless that package is restored to the main release surface.

**Evidence**: `docs/TESTING.md:22` marks `packages/server-http-experimental/`
as quarantined and outside the main release gate unless explicitly restored.

**Decision**: locked

**Constraint**: The store-only gate MAY include HTTP only when HTTP is promoted
back into the release surface.

---

## Branch 2: Data Model & State

### Q2.1: Which state invariants need red tests?

**Answer**: The core red tests are source-of-truth, routing, and provenance.

**Evidence**: `cross-store-write.test.ts` asserts no project dual-root fallback
for pending writes; `mcp-store-contracts.test.ts` asserts store-aware MCP
contracts; `write-scope-meta.test.ts` and doctor-scope tests cover
`semantic_scope` and `visibility_store`.

**Decision**: locked

**Constraint**: Red tests MUST fail if writes land in project-local
`.fabric/knowledge`, if route-less multi-shared writes silently choose a store,
or if surfaced entries lose store provenance.

### Q2.2: Is "coverage percent" the right primary quality signal?

**Answer**: No. Coverage percent is necessary but secondary for store-only.

**Evidence**: Package thresholds differ and can pass while user workflow gates
remain incomplete. The known issues are about fixture realism and omitted gates,
not low line coverage.

**Decision**: locked

**Constraint**: Store-only readiness MUST be measured by invariant gates in
addition to line/statement thresholds.

### Q2.3: Is current red-suite practice sufficiently explicit?

**Answer**: Partially. Resolver tests document a TDD ratchet, but the practice
is not generalized across all store-only surfaces.

**Evidence**: `golden-redsuite.test.ts` references a previous `it.fails` red
suite and golden expected values, while many other surfaces have normal green
tests without a visible failing-first contract package.

**Decision**: open

**Constraint**: New store-only work SHOULD start with a named failing contract
case, but the repo still needs a standard convention for where those red cases
live and how they are promoted.

---

## Branch 3: Edge Cases & Failure Modes

### Q3.1: What failure would current CI most likely miss?

**Answer**: A release artifact can pass tests while a real installed user path
breaks because the gate bypasses the package bin, uses minimal fixtures, or
does not exercise mounted stores.

**Evidence**: CI Windows smoke runs `node packages/cli/dist/index.js --version`
rather than the published `fabric` bin path; perf benchmark creates only a
minimal `.fabric/agents.meta.json` and `events.jsonl` fixture.

**Decision**: locked

**Constraint**: CI MUST test the packaged CLI/bin entry and at least one
mounted-store flow, not only source-level imports or dist index invocation.

### Q3.2: What should fail hard instead of warning?

**Answer**: Privacy leaks, route/read-set mismatch, missing write target,
invalid mounted-store identity, and resurrected project-local knowledge paths.

**Evidence**: Existing tests already hard-fail missing write target and
route-less multi-shared semantic writes; doctor/sync still need release-level
hard gates for every final store-only violation.

**Decision**: locked

**Constraint**: Store-only CI MUST include negative tests for these failures
and assert non-zero exit or rejected promise, not just diagnostic text.

### Q3.3: Which drift is most dangerous?

**Answer**: Generated/runtime surface drift: docs, skills, hooks, and release
workflow can lag behind source contracts.

**Evidence**: Existing issues mention stale bootstraps/skills, partial CLI
surface help coverage, and release workflow gate drift.

**Decision**: locked

**Constraint**: CI SHOULD include a surface matrix drift gate covering CLI help,
MCP schemas, hooks, packaged skills, bootstrap text, and docs for retired
dual-root references.

---

## Branch 4: Integration & Dependencies

### Q4.1: Does CI match release CI?

**Answer**: No. Release omits at least the perf benchmark and Windows smoke
job that normal CI has.

**Evidence**: CI runs perf at `.github/workflows/ci.yml:58` and Windows smoke
at `.github/workflows/ci.yml:73`; release has no matching steps before publish.

**Decision**: locked

**Constraint**: Release CI MUST run all gates required to protect the published
artifact, or call a shared reusable workflow so release cannot drift.

### Q4.2: Should store-only E2E run on every PR?

**Answer**: A minimal deterministic E2E should run on every PR; heavier
multi-client or perf variants can be scheduled or release-only.

**Evidence**: The test wall already uses local temp dirs and fake remotes, so a
short mounted-store E2E can be deterministic and network-free.

**Decision**: locked

**Constraint**: PR CI SHOULD run one fast local store-only E2E; release CI MUST
run the full publish-artifact gate.

### Q4.3: Should pre-commit enforce store-only?

**Answer**: Not broadly. Current pre-commit only runs stdio lint; adding heavy
store E2E would slow local iteration.

**Evidence**: `lefthook.yml` has a single `stdio-lint` command.

**Decision**: open

**Constraint**: Pre-commit MAY add cheap static forbidden-pattern checks, but
store-only E2E belongs in CI or an explicit local gate.

---

## Branch 5: Scale & Performance

### Q5.1: Is current perf benchmark aligned with store-only?

**Answer**: Not enough. It measures cold start, but its fixture does not model
mounted-store read/write state.

**Evidence**: `scripts/perf-benchmark.mjs` `setupCliFixture()` creates only a
minimal project `.fabric` directory with `agents.meta.json` and `events.jsonl`.

**Decision**: locked

**Constraint**: Perf gates SHOULD include a mounted-store fixture with at least
one personal store, one shared store, binding snapshot/state, and enough
canonical entries to exercise real read-set discovery.

### Q5.2: Should perf be a hard release gate?

**Answer**: Yes, for the interactive cold-start budgets already used by CI;
store-size stress can be trend/alert first.

**Evidence**: CI already treats CLI and hook p95 as hard gates. Release not
running the gate is a release-process gap, not a question of test value.

**Decision**: locked

**Constraint**: Release MUST run the same cold-start perf gate as CI before
publish.

### Q5.3: What scale case remains open?

**Answer**: The exact corpus size for mounted-store perf fixtures is not yet
locked.

**Evidence**: Current perf budget is cold-start oriented and does not define
store entry count, multi-store count, or candidate volume.

**Decision**: open

**Constraint**: A follow-up analyze pass SHOULD set representative small,
medium, and stress corpus sizes.

---

## Synthesis

### Decision Summary

| # | Decision | Status | Branch | RFC 2119 |
|---|----------|--------|--------|----------|
| D1 | Add a first-class mounted-store workflow gate | locked | Scope | MUST |
| D2 | Keep package tests; add store-only acceptance layer | locked | Scope | SHOULD |
| D3 | HTTP remains outside main release gate unless restored | locked | Scope | MAY |
| D4 | Red tests target source-of-truth, routing, provenance | locked | State | MUST |
| D5 | Coverage percent is secondary to invariant gates | locked | State | MUST |
| D6 | Standard red-suite convention is still needed | open | State | SHOULD |
| D7 | Test packaged CLI/bin and mounted-store workflow | locked | Failure | MUST |
| D8 | Hard-fail privacy, routing, identity, and dual-root resurrection | locked | Failure | MUST |
| D9 | Add surface matrix drift gate | locked | Failure | SHOULD |
| D10 | Release CI must not be weaker than CI | locked | Integration | MUST |
| D11 | Run fast local mounted-store E2E on PRs | locked | Integration | SHOULD |
| D12 | Keep heavy checks out of pre-commit | open | Integration | MAY |
| D13 | Upgrade perf fixture to mounted-store | locked | Performance | SHOULD |
| D14 | Release must run cold-start perf | locked | Performance | MUST |

### Verified Constraints

- Store-only readiness is not just line coverage. It requires invariant tests
  that fail on retired project-local knowledge paths, missing route hard-fails,
  provenance loss, privacy leaks, and packaged CLI/bin drift.
- Normal CI is stronger than release CI today; release must inherit or reuse the
  same gate set before publish.
- Existing test-wall and golden resolver tests are the right foundation for a
  more explicit TDD workflow.

### Open Questions

- Where should the repo standardize new red tests: dedicated
  `*.red.test.ts`, golden fixture deltas, `it.fails` ratchets, or issue-linked
  contract tests?
- What mounted-store corpus sizes should perf fixtures use?
- Should cheap static forbidden-pattern checks move into pre-commit or remain
  CI-only?

### Risk Register

| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | Release publishes artifact without perf/Windows/store-only E2E | Integration | high | Reuse CI workflow in release or duplicate required gates |
| R2 | Tests pass but user workflow fails because fixtures are legacy/minimal | Failure | high | Add packaged CLI mounted-store E2E |
| R3 | Line coverage hides missing architecture invariants | State | medium | Add invariant matrix gate |
| R4 | Red-test discipline remains local to a few suites | State | medium | Define a red-suite convention and require it for store-only issues |
| R5 | Perf benchmark misses mounted-store read-set costs | Performance | medium | Upgrade perf fixture to mounted-store |

### Recommended Next Step

Use `$maestro-analyze` to turn this grill into a concrete CI/CD upgrade plan:
which workflow files, test files, fixtures, and scripts should change first.

