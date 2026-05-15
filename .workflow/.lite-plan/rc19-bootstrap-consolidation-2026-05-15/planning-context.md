# Planning Context: rc.19 Bootstrap Consolidation

## Source Evidence

### From `exploration-install-flow.json`
- `packages/cli/templates/bootstrap/{CLAUDE.md, codex-AGENTS-header.md, cursor-fabric-bootstrap.mdc}` — ORPHANED templates, zero refs from `packages/cli/src/`
- `packages/cli/templates/agents-md/AGENTS.md.template` — ORPHANED, contains dead pointer `.fabric/bootstrap/README.md` at L18
- `packages/cli/src/install/skills-and-hooks.ts:224` — `SECTION_TARGETS` literal `["CLAUDE.md", "AGENTS.md", join(".cursor", "rules")]` (note: `.cursor/rules` is treated as FILE, not directory — pre-existing drift bug)
- `packages/cli/src/install/skills-and-hooks.ts:235-236` — `FABRIC_SECTION_BEGIN_MARKER` / `FABRIC_SECTION_END_MARKER` HTML-comment literals to be renamed
- `packages/cli/src/install/skills-and-hooks.ts:245-246` — `FABRIC_SECTION_REGEX` non-greedy region matcher
- `packages/cli/src/install/skills-and-hooks.ts:291-304` — `buildFabricKnowledgeBaseSection` — content builder to be DELETED (canonical moves to shared)
- `packages/cli/src/install/skills-and-hooks.ts:638-705` — `addFabricKnowledgeBaseSection` to be SPLIT into snapshot writer + three per-client thin-shell writers
- `packages/cli/src/commands/install.ts:1042-1043` — install pipeline insertion point for new orchestration
- `packages/cli/src/install/hooks-orchestrator.ts:113-114` — mirror call site (parity required)
- `packages/cli/src/install/uninstall-skills-and-hooks.ts:278, 295-358` — strip logic must extend to delete `.fabric/AGENTS.md` snapshot + remove `@.fabric/AGENTS.md` import line

### From `exploration-doctor-flow.json`
- `packages/server/src/services/doctor.ts:704-891` — `runDoctorReport` — append two new `createXCheck` calls (L1 + L2 drift)
- `packages/server/src/services/doctor.ts:893-987` — `runDoctorFix` dispatcher — add three new if-blocks: marker migration FIRST, L1 fix, L2 fix
- `packages/server/src/services/doctor.ts:1779-1808` — existing `inspectBootstrapAnchor` / `createBootstrapAnchorCheck` (existence-only today)
- `packages/server/src/services/doctor.ts:696-702` — `TARGET_FILE_PATHS` — append `.fabric/AGENTS.md` + `.fabric/project-rules.md`
- `packages/server/src/services/doctor.ts:1974-1995` — `issueCheck` / `okCheck` constructor pattern
- `packages/server/src/services/doctor.ts:4395-4435` — `fixMcpConfigInWrongFile` — gold-standard pattern for one-time migration + ledger event
- `packages/shared/src/schemas/event-ledger.ts:115` — `mcp_config_migrated` schema literal as template for new event types
- **CRITICAL CROSS-PACKAGE GAP**: `packages/server` has zero dep on `packages/cli` — canonical bootstrap template + marker constants MUST live in `packages/shared`

### From `exploration-bootstrap-templates.json`
- Dead-pointer `.fabric/bootstrap/README.md` occurrences:
  - `packages/cli/src/config/resolver.ts:105, 122, 135, 148` — unused `bootstrapTargetPath` field (no consumer)
  - `packages/shared/src/schemas/agents-meta.ts:223, 249` — dead special-case branches in `deriveAgentsMetaStableId` / `deriveAgentsMetaLayer`
  - `packages/shared/src/i18n/locales/en.ts:375` — `cli.scan.recommendation.init` user-visible string
  - `packages/shared/src/i18n/locales/zh-CN.ts:369` — mirror locale
  - `docs/SPEC_INTERNAL.md:9, 251`, `docs/getting-started.md:50`, `docs/RULE_REGISTRY.md:17, 87-89`, `docs/test-seed/server.md:14`
- Cursor `.mdc` front-matter pattern: `---\nalwaysApply: true\ndescription: <text>\n---` required BEFORE managed block
- Current repo `AGENTS.md:10-21` carries the live `fabric:knowledge-base` managed block — this is the canonical example

### From `exploration-test-patterns.json`
- Test runner: vitest 3.2.4 (all packages)
- Canonical install test mirror: `packages/cli/__tests__/integration/install-skills-and-hooks.test.ts:442-574` — four-axis matrix (presence × idempotency × in-place-replace × overwrite)
- Marker-migration test mirror: `packages/cli/__tests__/integration/codex-mcp-install.test.ts:146-171` — legacy→new migration with regex occurrence assertions
- Drift test mirror: `packages/cli/__tests__/integration/install-diff-mode.test.ts` (byte-mutate + abort) + `packages/cli/__tests__/integration/init-guard.test.ts:56-80` (thrown-error assertion idiom)
- Service-layer doctor test mirror: `packages/server/src/services/doctor.test.ts:20-40` — mandatory `FABRIC_HOME` isolation beforeEach
- CLI doctor test mirror: `packages/cli/__tests__/doctor.test.ts` — `vi.doMock('@fenglimg/fabric-server')` + dynamic import + captureStdout
- Test helpers reused: `createWerewolfFixtureRoot`, `runInit`, `snapshotTree`, `seedDriftedFile`, `writeFixtureFile` from `packages/cli/__tests__/helpers/init-test-utils.ts`
- Codex nested-AGENTS.md NOT testable in vitest → docs-only deliverable

## Understanding

### Current State
Three orphaned bootstrap templates ship in `packages/cli/templates/bootstrap/` and one in `packages/cli/templates/agents-md/`, none consumed by CLI source. Actual install path uses an inline string builder (`buildFabricKnowledgeBaseSection`) that writes a single managed block with marker `fabric:knowledge-base:begin/end` into three SECTION_TARGETS files (CLAUDE.md / AGENTS.md / .cursor/rules — last as flat file, not directory). Doctor has an existence-only `inspectBootstrapAnchor` and no two-layer drift detection.

### Problem
Three drifted "bootstrap" entry points with no single source of truth; orphaned templates contain dead pointers (`.fabric/bootstrap/README.md` was removed in v2.0); marker name `fabric:knowledge-base` is misleading (block contains behavior rules + KB section); doctor cannot detect downstream drift between bootstrap source and propagated managed blocks; Cursor target path is a single file instead of proper `.cursor/rules/<name>.mdc` directory rule.

### Approach
**Single source consolidation with two-layer byte-level drift detection**:
1. Hoist canonical bootstrap content to `packages/shared/src/templates/bootstrap-canonical.ts` (TS const export) — both CLI install and server doctor import from one place (resolves cross-package gap)
2. `fab install` writes `.fabric/AGENTS.md` from canonical (L1 snapshot)
3. `fab install` propagates to three ends via managed blocks (L2):
   - Claude: `CLAUDE.md` thin shell with `@.fabric/AGENTS.md` import (+ optional `@.fabric/project-rules.md`)
   - Codex: root `AGENTS.md` managed block = byte copy of `.fabric/AGENTS.md` (+ `\n---\n` + `.fabric/project-rules.md` if exists)
   - Cursor: `.cursor/rules/fabric-bootstrap.mdc` managed block + YAML front-matter (`alwaysApply: true`)
4. Marker rename `fabric:knowledge-base` → `fabric:bootstrap` with one-time migration under `fab doctor --fix` only
5. `fab doctor` adds two-layer drift detection:
   - L1: canonical ↔ `.fabric/AGENTS.md` (byte-level)
   - L2: `.fabric/AGENTS.md` + `.fabric/project-rules.md` concat ↔ three-end managed blocks (byte-level)
   - Drift → abort; `--fix` overwrites (consistent with "drift→abort 不要 --force" DNA)
6. Clean-slate deletion of 4 orphaned templates + all dead-pointer references
7. Self-host: run `fab install` on this repo so bootstrap files are written and committed

## Key Decisions

- **Decision**: Canonical lives in `packages/shared/src/templates/bootstrap-canonical.ts` as TS const export | **Rationale**: `packages/server` cannot import `packages/cli`; shared is the only common dep; mirrors rc.18 banner-i18n pattern | **Evidence**: `exploration-doctor-flow.json` dependencies block — "packages/server has NO dependency on packages/cli"
- **Decision**: `.fabric/project-rules.md` only-if-exists (no install scaffold) | **Rationale**: Cleaner fresh installs; user opts in; reduces idempotent-or-preserve binary | **Evidence**: User clarification round, locked
- **Decision**: Canonical is fixed zh-CN-hybrid (no `{{fabric_language}}` interpolation) | **Rationale**: The locked text IS the canonical; rc.18 banner-i18n stays independent for runtime banners | **Evidence**: User clarification round, locked
- **Decision**: Cursor migrates to `.cursor/rules/fabric-bootstrap.mdc` directory rule | **Rationale**: Proper Cursor convention; pre-user clean-slate (no migration shim) | **Evidence**: Exploration `bootstrap-templates` constraint (6), user clarification, memory `feedback_clean_slate.md`
- **Decision**: Marker rename via `fab doctor --fix` only (not auto in install) | **Rationale**: Operator visibility + ledger event for audit; mirrors `mcp_config_migrated` pattern | **Evidence**: `exploration-doctor-flow.json:L4395-L4435` fixMcpConfigInWrongFile reference
- **Decision**: Test split — service-layer drift tests in `packages/server/src/services/doctor.test.ts`, install-side propagation tests in `packages/cli/__tests__/integration/install-skills-and-hooks.test.ts` | **Rationale**: rc.15 onwards convention; mocked-CLI tests don't catch real service regressions | **Evidence**: `exploration-test-patterns.json` test_concerns "Mocked-server tests don't catch real server-side regressions" (high severity)
- **Decision**: Self-host (TASK-07) commits regenerated bootstrap files for this repo | **Rationale**: Dogfood the new pipeline + give doctor a golden state to compare against in CI | **Evidence**: User task brief explicit step

## Dependencies

- **TASK-01 (shared canonical) blocks**: TASK-02 (snapshot uses canonical), TASK-03 (propagation uses snapshot content), TASK-04 (marker migration uses shared marker constants), TASK-05 (doctor L1 diff against canonical), TASK-06 (cleanup needs to know what's replaced)
- **TASK-02 (snapshot writer) blocks**: TASK-03 (propagation reads snapshot)
- **TASK-03 (propagation) blocks**: TASK-07 (self-host runs the new pipeline), TASK-08 (install-side tests)
- **TASK-04 (marker migration) blocks**: TASK-05 (L2 drift must recognize migration done first), TASK-09 (doctor tests assert migration event)
- **TASK-05 (doctor drift) blocks**: TASK-07 (self-host validates via doctor), TASK-09 (doctor tests)
- **Parallel after TASK-05**: TASK-06 (cleanup), TASK-07 (self-host), TASK-08 (install tests), TASK-09 (doctor tests)
