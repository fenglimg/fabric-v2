# rc.14 Code Review — Gemini Batch Review

**Date**: 2026-05-14
**Range**: `abbc706..HEAD` (3 commits, 18 files, +1011/-188 lines)
**Reviewer**: Gemini CLI (`rc14-stop-the-bleeding-2026-05-14-code-review`)
**Verdict**: **FAIL — NOT release-ready**

## Findings

### Finding 1 — HIGH: `.fabric` as regular file crashes drift gate
- **File**: `packages/cli/src/commands/install.ts` (drift-abort gate in `executeInitExecutionPlan`)
- **Description**: If user has `.fabric` as a regular file (not directory), `existsSync(".fabric/agents.meta.json")` returns false → classifier marks all 3 inner files as `missing` → drift gate bypassed → `mkdirSync(plan.fabricDir)` raises native `ENOTDIR`/`EEXIST`. User sees stack trace instead of friendly drift-abort message.
- **Violation**: Grilling design principle "drift→abort with helpful message, don't crash"
- **Fix**: Add pre-check in `executeInitExecutionPlan`:
  ```ts
  if (existsSync(plan.scaffold.fabricDir) && !statSync(plan.scaffold.fabricDir).isDirectory()) {
    throw new Error(t("cli.install.errors.drift-abort", { path: plan.scaffold.fabricDir }));
  }
  ```

### Finding 2 — MEDIUM: `events.jsonl` as directory + `--force` → EISDIR
- **File**: `packages/cli/src/commands/install.ts` (`executeInitFabricPlan` events.jsonl branch)
- **Description**: If `events.jsonl` is a directory and user runs `--force`, classifier returns `user-modified`, but the `events.jsonl` write branch doesn't have the force-overwrite cleanup that `agents.meta.json` does. `appendFileSync` on a directory throws `EISDIR`.
- **Asymmetry**: `metaPath` branch handles `force + user-modified` via `rmSync(..., {recursive: true, force: true})` cleanup. Same pattern missing for `eventsPath`.
- **Fix**: Add symmetric cleanup:
  ```ts
  else if (force && plan.eventsState === "user-modified") {
    rmSync(plan.eventsPath, { recursive: true, force: true });
    // ... continue normal write
  }
  ```

### Finding 3 — LOW: Uninstall tests skip `.cursor` snapshot
- **File**: `packages/cli/__tests__/integration/uninstall-skills-and-hooks.test.ts`
- **Description**: T1/T2 scenarios snapshot `.claude` and `.codex` trees but not `.cursor`. Uninstall logic for Cursor is correct but lacks closed-loop test assertion. Parallel to the install-side `.cursor` parity gap we filled in TASK-002.
- **Fix**: Extend existing scenarios to snapshot `.cursor` tree alongside `.claude` / `.codex`.

## Summary

| Severity | Count | Action |
|---|---|---|
| Critical | 0 | — |
| High | 1 | Fix before release |
| Medium | 1 | Fix before release |
| Low | 1 | Nice-to-have |

**Note**: Both High and Medium are pathological-state edge cases (user manually creating `.fabric` as a file, or `events.jsonl` as a directory). Real-world likelihood is very low. But the **friendly-error-message contract** is part of the rc.14 design — crashes with native stack traces violate it.
