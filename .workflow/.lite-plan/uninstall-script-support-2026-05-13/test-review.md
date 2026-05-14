# Test Review — fab uninstall (v2.0.0-rc.9)

**Session**: `uninstall-script-support-2026-05-13`
**User ask**: 当前似乎没有支持卸载脚本呢？
**Plan summary**: Add `fab uninstall` command — symmetric inverse of `fab init` across scaffold + bootstrap + MCP stages.
**Framework**: vitest (`pnpm --filter @fenglimg/fabric-cli test`)
**Generated**: 2026-05-13 (UTC+8)
**Overall verdict**: **PASS**

## Task Verdicts

| Task | Status | Convergence (met/total) | Coverage |
|------|--------|-------------------------|----------|
| TASK-001 destination-path constants | PASS | 3/3 | n/a (refactor) |
| TASK-002 core uninstall + ClientWriter.remove | PASS | 4/4 | uninstall.ts 70.04% |
| TASK-003 bootstrap helpers | PASS | 3/3 | uninstall-skills-and-hooks.ts 77.48% |
| TASK-004 i18n keys (en + zh-CN) | PARTIAL | 3/3 (1 cosmetic deviation) | n/a |
| TASK-005 test suite | PASS | 5/5 | 452/452 tests |
| TASK-006 docs + CHANGELOG | PASS | 5/5 (1 cosmetic deviation) | n/a |

## Cosmetic Deviations (non-blocking)

- **TASK-004**: spec suggested `cli.uninstall.args.<flag>.negativeDescription` for boolean flag negative help; impl uses `cli.uninstall.flags.no-<flag>`. Functionally equivalent — citty consumes either.
- **TASK-006**: spec suggested `Iuninstall1-3` / `Tuninstall1-2` prefixes for new invariants; impl uses `I11/I12/I13` and `T6/T7` matching the file's existing numeric convention. Semantically identical pins to the right test files.

## Test Execution

```
pnpm --filter @fenglimg/fabric-cli test
Test Files  36 passed (36)
Tests       452 passed (452)
Duration    2.74s
```

3 consecutive runs, zero flakiness. `knip --strict` exit 0.

## Code Review (Gemini CLI — verdict WARN → fixed)

| Severity | Finding | Status |
|----------|---------|--------|
| High | T4 personal-root guard test was false-positive (sibling tmpdirs never overlapped) | **FIXED** — test now points HOME at the project itself, asserts `--purge` plan excludes `.fabric/knowledge/*` paths |
| Medium | Missing `cli.shared.error` i18n key | **FIXED** — added to en.ts ("Error") and zh-CN.ts ("错误") |
| Low | Symlink bypass on personal-root guard (`path.resolve` doesn't follow symlinks) | **DEFERRED** to follow-up issue |

## Test Gaps

None blocking. The pre-existing `pnpm rc6:gate` failure on the rc.5 anchor (`plan-context.ts candidates_full_content`) is **unrelated** to this work; that gate scans for the rc.5 refactor anchor and is orthogonal to docs/code shipped here.

## Follow-up Issue Candidates

- **Symlink-aware personal-root guard**: wrap `isInsidePersonalRoot` candidate path in `fs.realpathSync` (try/catch ENOENT) before the relative-prefix check, OR check both lexical AND real paths. Low priority — symlink attacks require local write access, out-of-threat-model for rc.9.
- **`fab init --uninstall` shorthand** (optional UX sugar): some users may expect uninstall via init flag; current design is a separate top-level command (clarified during planning).
- **End-to-end binary-spawn test**: would catch packaging/bundling regressions analogous to the i18n `import.meta.resolve` bug; deferred per planning decision (clarification #6).
