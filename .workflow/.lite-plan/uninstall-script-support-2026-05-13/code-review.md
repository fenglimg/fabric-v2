# Code Review — fab uninstall (v2.0.0-rc.9)

**Reviewer**: Gemini CLI (analysis mode)
**Session**: uninstall-script-support-2026-05-13
**Verdict**: **WARN** — code structure is sound; 2 actionable defects + 1 hardening recommendation.

## Findings

### [High] T4 personal-root guard test is a false positive
- **Location**: `packages/cli/__tests__/uninstall.test.ts:~430` (test `filters out any candidate path that resolves inside the personal fabric root`)
- **Issue**: Test sets `process.env.FABRIC_HOME = isolatedHome` but constructs `target` as a sibling tmpdir via `createWerewolfFixtureRoot(...)`. The two trees do not overlap, so `isInsidePersonalRoot()` always returns `false`. The guard branch is never exercised.
- **Fix**: Make `target` a subdirectory of `isolatedHome`, e.g. `const target = join(isolatedHome, "project")` (then init the fixture into it), so `.fabric/knowledge/` paths actually resolve inside the personal root.

### [Medium] Missing i18n key `cli.shared.error`
- **Location**: `packages/cli/src/commands/uninstall.ts:~482` (error banner: `paint.error(t("cli.shared.error"))`)
- **Issue**: Key not defined in `packages/shared/src/i18n/locales/en.ts` or `zh-CN.ts`. Resolver returns the raw key string at runtime.
- **Fix**: Add `"cli.shared.error": "Error"` to en.ts and `"cli.shared.error": "错误"` to zh-CN.ts.

### [Low] Symlink bypass on personal-root guard
- **Location**: `packages/cli/src/commands/uninstall.ts:~511` (`isInsidePersonalRoot`)
- **Issue**: Pure string-based path resolution; a symlink in `.fabric/knowledge/` pointing at `~/.fabric/knowledge/` would not be detected by `path.resolve` + `path.relative`. `--purge` could theoretically traverse into the global tree.
- **Fix (deferred)**: Wrap candidate path in `fs.realpathSync` (try/catch for ENOENT) before the relative-prefix check, OR check both the lexical path AND the realpath. Defer to a follow-up issue — symlink attacks require local write access and are out-of-threat-model for this rc.

## Strengths Noted
- `pruneArrayAtPath` cascade logic is rigorous and state-consistent.
- `runAndCollect` wrapping in `uninstallBootstrapStage` correctly contains all helper exceptions; orchestrator never throws.
- TOML `removeCodexServerBlock` uses regex replacement safely; no new dependencies introduced.
- Re-run idempotency confirmed via Test T5 + unit test (f).
- Best-effort semantics honored at every layer (per-client MCP loop, per-step bootstrap).

## Action Plan
1. **Now** — fix High + Medium findings (test correction + i18n key add).
2. **Follow-up issue** — Low finding: symlink-aware realpath check on personal-root guard.
