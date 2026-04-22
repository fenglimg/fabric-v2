# Lite Planex Execution Report

**Session**: wpp-20260422-codex适配实现
**Requirement**: Implement Codex adaptation phase 1 for Fabric init: capability matrix correction plus repo-scoped Codex init skill, while avoiding conflicts with existing dirty template files.
**Completed**: 2026-04-22T21:37:00+08:00
**Waves**: 2 | **Concurrency**: 1

---

## Summary

| Metric | Count |
|--------|-------|
| Explore Angles | 3 |
| Total Tasks | 2 |
| Completed | 2 |
| Failed | 0 |
| Skipped | 0 |
| Waves | 2 |

---

## Exploration Results

### E1: capabilities (completed)
`detectClientSupports()` modeled Codex as detected but with `hook=false` and `skill=false`, which forced init to render Codex as manual-only even though Codex officially supports both capabilities. Key files: `packages/cli/src/config/resolver.ts`, `packages/cli/src/commands/init.ts`, `packages/shared/src/i18n/locales/en.ts`, `packages/shared/src/i18n/locales/zh-CN.ts`, `packages/cli/__tests__/init-mcp-scope.test.ts`, `packages/cli/__tests__/config-install.test.ts`

### E2: init-assets (completed)
`initFabric()` already installed Claude-only follow-up assets and template lookup preferred repo-root `templates/**`, which means dirty template files would be consumed by init. Key files: `packages/cli/src/commands/init.ts`, `packages/cli/src/bootstrap-guide.ts`, `packages/cli/src/config/resolver.ts`, `packages/cli/src/commands/bootstrap.ts`, `templates/bootstrap/codex-AGENTS-header.md`, `templates/claude-skills/agents-md-init/SKILL.md`

### E3: testing (completed)
The smallest safe regression surface was already present in `init-mcp-scope`, `init-claude-install`, `init-nondestructive`, and `init-force`, so the implementation extended those files instead of adding new harnesses. Key files: `packages/cli/__tests__/helpers/init-test-utils.ts`, `packages/cli/__tests__/init-claude-install.test.ts`, `packages/cli/__tests__/init-mcp-scope.test.ts`, `packages/cli/__tests__/init-nondestructive.test.ts`, `packages/cli/__tests__/init-force.test.ts`

---

## Task Results

### T1: Refactor Codex capability reporting (completed)

| Field | Value |
|-------|-------|
| Wave | 1 |
| Scope | packages/cli/src/config/**;packages/cli/src/commands/init.ts;packages/shared/src/i18n/locales/**;packages/cli/__tests__/init-mcp-scope.test.ts;packages/cli/__tests__/config-install.test.ts |
| Dependencies | none |
| Context From | E1;E3 |
| Tests Passed | true |
| Acceptance Met | Capability table shows Codex support without implying installation; reason message now uses installable follow-up wording; Codex MCP config tests still pass |
| Error | none |

**Findings**: Codex capability reporting now distinguishes supported vs installed for hook/skill. Init reason/follow-up messaging no longer presents Codex as unsupported.

**Files Modified**: `packages/cli/src/config/resolver.ts`, `packages/cli/src/commands/init.ts`, `packages/shared/src/i18n/locales/en.ts`, `packages/shared/src/i18n/locales/zh-CN.ts`, `packages/cli/__tests__/init-mcp-scope.test.ts`

### T2: Add Codex repo-skill install path (completed)

| Field | Value |
|-------|-------|
| Wave | 2 |
| Scope | packages/cli/src/commands/init.ts;packages/cli/__tests__/init-claude-install.test.ts;packages/cli/__tests__/init-nondestructive.test.ts;packages/cli/__tests__/init-force.test.ts;packages/cli/__tests__/helpers/**;templates/codex*/** |
| Dependencies | T1 |
| Context From | E2;E3;T1 |
| Tests Passed | true |
| Acceptance Met | Codex repo skill now installs on init; rerun without force preserves custom Codex skill; force overwrites Codex skill with template; no dirty template file was modified |
| Error | none |

**Findings**: Added a new Codex repo-skill install path under `.agents/skills/fabric-init/SKILL.md`, backed by new Codex-only templates in both root and packaged template directories.

**Files Modified**: `packages/cli/src/commands/init.ts`, `packages/cli/__tests__/init-claude-install.test.ts`, `packages/cli/__tests__/init-nondestructive.test.ts`, `packages/cli/__tests__/init-force.test.ts`, `templates/codex-skills/fabric-init/SKILL.md`, `packages/cli/templates/codex-skills/fabric-init/SKILL.md`

---

## Verification

- `pnpm --filter @fenglimg/fabric-cli test -- __tests__/init-mcp-scope.test.ts __tests__/config-install.test.ts`
- `pnpm --filter @fenglimg/fabric-cli test -- __tests__/init-claude-install.test.ts __tests__/init-nondestructive.test.ts __tests__/init-force.test.ts`

Both commands passed.

---

## Next Step

The remaining planned phase is Codex hooks integration. That work was intentionally excluded from this run because:
- the first phase needed a stable capability model first
- Codex hooks are feature-flagged and should be introduced with separate docs/output changes
- the current repository already had dirty template files, so phase 1 stayed isolated from those conflict areas
