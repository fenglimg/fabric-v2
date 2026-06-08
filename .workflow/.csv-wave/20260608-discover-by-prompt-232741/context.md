# Issue Discovery Report

## Summary
- Session: DBP-20260608-232741
- Mode: by-prompt
- Perspectives: 5
- Raw findings: 11
- Unique issues: 11

## Breakdown by Perspective
| Perspective | Findings | Critical | High | Medium | Low |
|-------------|----------|----------|------|--------|-----|
| release-version-package-drift | 3 | 0 | 0 | 2 | 1 |
| generated-managed-artifact-drift | 3 | 0 | 0 | 2 | 1 |
| tests-snapshots-runtime-drift | 2 | 0 | 0 | 0 | 2 |
| config-schema-doc-i18n-drift | 1 | 0 | 0 | 1 | 0 |
| knowledge-store-migration-tail-drift | 2 | 0 | 0 | 2 | 0 |

## Severity Distribution
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 7 |
| Low | 4 |

## Perspective Details
### release-version-package-drift
Found 3 new release/package drift issues: current 2.2.0-rc.5 manifests lack matching changelog/status, shared package is omitted from npm verification, and tag-version tooling rewrites quarantined private package versions.

**Top Issues:**
- (medium) Current 2.2.0-rc.5 manifests have no matching release notes or README status — package.json:4
- (medium) Release checklist omits @fenglimg/fabric-shared from post-publish npm verification — RELEASING.md:51
- (low) apply-tag-version rewrites quarantined private package versions unlike sync-versions — scripts/apply-tag-version.mjs:50

### generated-managed-artifact-drift
Found 3 new managed-artifact drift issues: root AGENTS managed block stale, Codex/Cursor hook config order drift, and docs still saying Cursor hooks are pending.

**Top Issues:**
- (medium) Root AGENTS managed bootstrap block is stale relative to BOOTSTRAP_CANONICAL — AGENTS.md:13; packages/shared/src/templates/bootstrap-canonical.ts:63; packages/cli/__tests__/integration/install-skills-and-hooks.test.ts:764
- (low) Checked-in Codex and Cursor hook configs reverse the template PreToolUse hook order — .codex/hooks.json:14; .cursor/hooks.json:14; packages/cli/templates/hooks/configs/codex-hooks.json:13; packages/cli/templates/hooks/configs/cursor-hooks.json:10
- (medium) Docs still describe Cursor hook support as pending even though installer and checked-in configs install Cursor hooks — docs/initialization.md:25; docs/initialization.md:222; docs/roadmap.md:113; packages/cli/src/install/skills-and-hooks.ts:186; .cursor/hooks.json:4

### tests-snapshots-runtime-drift
Found 2 new low-severity shared test-seed/runtime drift issues; skipped existing command/server/bootstrap drift duplicates already registered as ISS-20260608-001..049.

**Top Issues:**
- (low) Shared test seed reverses MCP payload guard boundary semantics — docs/test-seed/shared.md:49
- (low) Shared test seed still advertises retired bootstrap-guide export and rule-test-index schema — docs/test-seed/shared.md:16

### config-schema-doc-i18n-drift
Found one new config-schema drift: the checked-in JSON Schema still models a retired config surface and rejects current keys used by the repo/runtime.

**Top Issues:**
- (medium) Checked-in fabric-config JSON Schema still describes retired config surface — schemas/fabric-config.json:7; fabric.config.json:2; packages/shared/src/schemas/fabric-config.ts:7; packages/shared/src/schemas/fabric-config.ts:441; packages/cli/src/dev-mode.ts:30; docs/configuration.md:282

### knowledge-store-migration-tail-drift
Found 2 new medium tail-drift issues: active docs still teach project-local .fabric/knowledge as source of truth, and --fix-knowledge still advertises demote/archive git-mv repairs that store cutover currently disables.

**Top Issues:**
- (medium) User and schema docs still teach project-local .fabric/knowledge as the knowledge source after store-only cutover — docs/USER-QUICKSTART.md:10
- (medium) doctor --fix-knowledge advertises demote/archive git-mv repairs that store cutover currently no-ops — packages/cli/src/commands/doctor.ts:93

## Issues Created
- ISS-20260608-050 (medium) Current 2.2.0-rc.5 manifests have no matching release notes or README status — package.json:4
- ISS-20260608-051 (medium) Release checklist omits @fenglimg/fabric-shared from post-publish npm verification — RELEASING.md:51
- ISS-20260608-052 (low) apply-tag-version rewrites quarantined private package versions unlike sync-versions — scripts/apply-tag-version.mjs:50
- ISS-20260608-053 (medium) Root AGENTS managed bootstrap block is stale relative to BOOTSTRAP_CANONICAL — AGENTS.md:13; packages/shared/src/templates/bootstrap-canonical.ts:63; packages/cli/__tests__/integration/install-skills-and-hooks.test.ts:764
- ISS-20260608-054 (low) Checked-in Codex and Cursor hook configs reverse the template PreToolUse hook order — .codex/hooks.json:14; .cursor/hooks.json:14; packages/cli/templates/hooks/configs/codex-hooks.json:13; packages/cli/templates/hooks/configs/cursor-hooks.json:10
- ISS-20260608-055 (medium) Docs still describe Cursor hook support as pending even though installer and checked-in configs install Cursor hooks — docs/initialization.md:25; docs/initialization.md:222; docs/roadmap.md:113; packages/cli/src/install/skills-and-hooks.ts:186; .cursor/hooks.json:4
- ISS-20260608-056 (low) Shared test seed reverses MCP payload guard boundary semantics — docs/test-seed/shared.md:49
- ISS-20260608-057 (low) Shared test seed still advertises retired bootstrap-guide export and rule-test-index schema — docs/test-seed/shared.md:16
- ISS-20260608-058 (medium) Checked-in fabric-config JSON Schema still describes retired config surface — schemas/fabric-config.json:7; fabric.config.json:2; packages/shared/src/schemas/fabric-config.ts:7; packages/shared/src/schemas/fabric-config.ts:441; packages/cli/src/dev-mode.ts:30; docs/configuration.md:282
- ISS-20260608-059 (medium) User and schema docs still teach project-local .fabric/knowledge as the knowledge source after store-only cutover — docs/USER-QUICKSTART.md:10
- ISS-20260608-060 (medium) doctor --fix-knowledge advertises demote/archive git-mv repairs that store cutover currently no-ops — packages/cli/src/commands/doctor.ts:93
