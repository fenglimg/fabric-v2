# TASK-011: Release + batch review (rc.23 closeout)

## Changes
- `CHANGELOG.md`: Added `## [2.0.0-rc.23] - 2026-05-18` section grouping all 12 scopes (F1, F2/F3/F4, F5, F6, a-B, a-C1, a-C2, c, d, e, F8a, F8b, F8c) with Added / Changed / Removed / Verification / Migration subsections.
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/project_rc23_shipped.md`: New SHIPPED memory file mirroring `project_rc22_shipped.md` structure — covers 12 scopes + test counts + Gemini verdict + ship date + werewolf-minigame deferred status.
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/MEMORY.md`: Replaced the `rc.23 PLANNED` index line with `rc.23 SHIPPED` pointer to the new memory file (≤150 chars + summary).
- `.workflow/.lite-plan/rc-23-combined-2026-05-18/cite-coverage-snapshot.txt`: Output of `node packages/cli/dist/index.js doctor --cite-coverage --since=7d --client=all` (rebuilt CLI from rc.23 source first).
- `.workflow/.lite-plan/rc-23-combined-2026-05-18/gemini-review.md`: Full Gemini batch review verdict + cross-scope risk summary + key findings + compliance/logic/security/performance assessment.
- `.workflow/.lite-plan/rc-23-combined-2026-05-18/plan.json`: `_metadata.quality_check` updated — `executed: true`, `tool: "gemini"`, `result: "SHIP IT"`, `session_id: "gem-193541-bed4"`, `dimensions_passed: [compliance, logic, security, performance]`, note summary.
- `.workflow/.lite-plan/rc-23-combined-2026-05-18/.task/TASK-011.json`: Added top-level `status: "completed"`.

## Verification
- [x] **Gemini batch review verdict captured** — `gemini-review.md` records "SHIP IT" verdict. Gemini exec `gem-193541-bed4` succeeded after one transient 429 mid-stream retry; zero blockers, zero violations.
- [x] **Cite-coverage report archived** — `cite-coverage-snapshot.txt` exists at the convergence path; reports `总回合数: 7113`, `未注明: 321` since rc.20 activation marker (2026-05-15T09:34:37Z).
- [x] **CHANGELOG.md rc.23 section present** — All 12 scopes documented in `## [2.0.0-rc.23] - 2026-05-18` block.
- [x] **`project_rc23_shipped.md` memory file exists** — 12-scope SHIPPED template, mirrors rc.22 format.
- [x] **MEMORY.md index updated** — Old PLANNED line replaced with SHIPPED pointer.
- [x] **Final test counts ≥ rc.22 baseline** — 354 shared + 524 (+1 skipped) server + 578 CLI = **1456 passing**, matching wave-6 baseline.

## Tests
- [x] `pnpm -F @fenglimg/fabric-shared test`: **354/354 passing**.
- [x] `pnpm -F @fenglimg/fabric-server test`: **524 passing + 1 skipped (525 total)**.
- [x] `pnpm -F @fenglimg/fabric-cli test`: **578/578 passing**.
- [x] `pnpm -F @fenglimg/fabric-cli build`: rebuild succeeded so cite-coverage runs against rc.23 source.
- [x] `node packages/cli/dist/index.js doctor --cite-coverage --since=7d --client=all`: clean exit, snapshot captured.

## Deviations
- **Gemini 429 mid-stream**: Gemini-cli auto-retried and succeeded; Claude fallback not needed.
- **`pnpm -r test` first attempt truncated by `tail -80`**: re-ran each package's tests individually with explicit grep — full counts captured. No test failures, baseline confirmed.
- **Werewolf-minigame regression**: not run (out of pcf scope per TASK constraint); deferred to post-tag manual sample in consumer repo. Memory file + CHANGELOG note this explicitly.

## Notes for next task (release-rc skill)
- Working tree has 66 uncommitted files (rc.23 implementation) — user retains commit control per TASK constraint.
- Release-rc skill should bump `version` from `2.0.0-rc.22` → `2.0.0-rc.23` across root + workspaces (`packages/shared`, `packages/server`, `packages/cli`).
- Gemini verdict + 1456-test baseline argue strongly for direct ship; no fix-forward cycle expected.
- Post-tag: validate werewolf-minigame golden sample in the consumer repo before npm publish (note: rc.18+ in soak window — no publishes since).
