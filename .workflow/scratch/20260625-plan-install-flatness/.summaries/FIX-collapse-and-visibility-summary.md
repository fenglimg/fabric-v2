# FIX: collapse-counting & slot-visibility (TASK-004 follow-up)

Branch: `fix/install-collapse-counting-and-slot-visibility`
Commit: `1631a8a`

## Bugs fixed
- **Bug A** — collapse never fires: `allIdempotent` keyed off `installed.length`, but
  validate/env/mcp push already-present artifacts into `installed[]` for display, so any
  configured repo reported installed>0 every run → health-check collapse card unreachable.
- **Bug B** — slot status hidden at prompt time + collapse unreachable on interactive re-install:
  buffered renderer hid slot status behind the clack prompt; team slot always prompted even when
  settled.

## Files modified (12)
Source:
- `packages/cli/src/install/pipeline/types.ts` — `StageResult.changed?: boolean`; `InstallContext.flushRenderBuffer?`.
- `packages/cli/src/install/pipeline/pipeline.ts` — `stageRan` 5th param `changed=false`; `stageSkipped`/`stageFailed` set `changed:false`; `allIdempotent` now `every(r => r.disposition !== "failed" && r.changed !== true)`; `RecordingRenderer` gains `passthrough`/`flushed` getter/`flushTo`; `execute()` wires `context.flushRenderBuffer`; collapse condition adds `!buffer.flushed`; `flushBuffer` guards double-replay when flushed.
- `packages/cli/src/install/pipeline/env.stage.ts` — `executeScaffold` returns `{scaffold, materialChange}`; write helpers return booleans; material = new config/events/.gitignore OR agentsMd created; forensic snapshot excluded.
- `packages/cli/src/install/pipeline/validate.stage.ts` — present artifacts → `skipped[]` (installed stays empty); `changed=false`.
- `packages/cli/src/install/pipeline/mcp.stage.ts` — `changed = result.changed.length > 0`.
- `packages/cli/src/install/pipeline/hooks.stage.ts` — `changed = installed.length > 0`.
- `packages/cli/src/install/pipeline/store.stage.ts` — non-interactive nudge `changed=false`; `--url` `changed=true`; wizard path computes `actionable`; not-actionable → no prompt, render status, `changed=false`; actionable → `flushRenderBuffer?.()` before prompt, `changed = outcome !== null`.
- `packages/cli/src/commands/config.ts` — `InstallMcpClientsResult.changed: ClientKind[]`; `installMcpClients` reads target file before/after write, records client when content differs; `readFileIfExists` helper.

Tests:
- `packages/cli/__tests__/install-v2-pipeline-render.test.ts` — updated old "installed>0 → no collapse" test to use `changed=true`; added Bug-A (installed>0 + changed=false → collapse), Bug-B (mid-run flush abandons collapse), flushTo (replay-in-order + passthrough, no dup).
- `packages/cli/__tests__/store.stage.dualslot.test.ts` — added settled-wizard-no-prompt (d) and actionable-wizard-flush (e).
- `packages/cli/__tests__/validate.stage.test.ts` (new) — present files in skipped[], installed empty, changed=false (f).
- `packages/cli/__tests__/mcp-changed-detection.test.ts` (new) — first write → changed contains client; idempotent re-run → changed empty (g).

## Convergence gates (pass/fail with numbers)
- shared build: N/A (shared not touched) — SKIPPED per spec.
- `packages/cli` `tsc --noEmit`: **PASS** (exit 0).
- `packages/shared` `tsc --noEmit`: **PASS** (exit 0).
- `packages/cli` build (`pnpm build`): **PASS** (build success).
- Target test files (`vitest run`): **PASS** — 12 files / 75 tests green:
  install-v2-pipeline (12), install-v2-pipeline-render (8), install-v2-dry-run, store.stage.dualslot (7), validate.stage (1), mcp-changed-detection (1), mcp-config-merge, config-install, config-panel, hooks-install-validate, integration/install-skills-and-hooks, integration/codex-mcp-install.
- Isolated run of the 5 core files: 29/29 PASS.

## New test list + results
- (a) re-install all changed=false + no prompt → single health-check card — PASS (existing test, still green).
- (b) re-install one stage changed=true → standard summary, no collapse — PASS (updated test).
- (c) flushTo replays in order then passes through; flushed===true; no collapse after — PASS (new).
- (d) settled wizard → no select called, personal slot rendered, changed=false — PASS (new).
- (e) actionable wizard → flushRenderBuffer invoked before prompt — PASS (new).
- (f) validate present files in skipped[], changed=false — PASS (new).
- (g) mcp idempotent re-run → result.changed empty → stage changed=false — PASS (new).
- Bug-A explicit (installed>0 + changed=false collapses) — PASS (new).
- Bug-B explicit (mid-run flush abandons collapse) — PASS (new).

## Deviations + rationale
1. **Pre-existing unrelated WIP in tree**: `packages/cli/src/commands/uninstall.ts` (588-line diff),
   `uninstall.test.ts`, `src/install/uninstall-store.ts`, and `packages/shared/src/i18n/locales/{en,zh-CN}.ts`
   were already modified in the working tree before this task (not mine). Their 2 uninstall test
   failures reproduce with my source changes stashed out, proving they are independent. I did NOT
   touch or commit those files; commit `1631a8a` contains exactly my 12 files.
2. **Test framework**: used `npx vitest run <files>` for isolation because `pnpm test -- <pattern>`
   runs the full suite (substring filter is loose). Full-suite run shows only the pre-existing
   uninstall failures, all my groups green.
3. **(g) mcp test** placed in a new dedicated file `mcp-changed-detection.test.ts` using an explicit
   `clientPaths.codexCLI` + `clients: ["CodexCLI"]` filter for determinism (avoids dependence on a
   real `~/.codex` / `~/.claude` on the test machine). config-install.test.ts only covers the TOML
   writer, so a new file was the cleaner home.
4. **env `materialChange`**: AGENTS.md is classified `created` at plan time but actually written in
   the hooks stage; on a settled re-run it already exists → `preserved`, so the env material-change
   signal is correct for the no-change case (does not false-positive the collapse).
