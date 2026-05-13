# rc.7 Aggregate Code Review (Gemini)

**Reviewer**: Gemini CLI (`rc7-macro-closure-2026-05-13-code-review`)
**Date**: 2026-05-13
**Scope**: 12 commits, 11 tasks, ~5400 LOC across cli/server/shared
**Verdict**: ✅ **PASS — Ready for v2.0.0-rc.7 tag, smooth path to v2.0.0 stable**

---

## Headline Findings

Six high-risk areas were deep-reviewed; all pass:

### T09 — `plan-context.ts` degenerate mode removal
**Evidence**: `packages/server/src/services/plan-context.ts:135-138` — `candidates_full_content` field deleted from `PlanContextEntry`; selection_token always emitted; symmetric API restored. Agent forced to call `fab_get_knowledge_sections`, closing the silent consumption-signal escape.

### T05 — Cross-session digest writer failure isolation
**Evidence**: `packages/cli/templates/hooks/fabric-hint.cjs:697-712` — `writeSessionDigestBestEffort()` wraps every IO path in try/catch; falls through silently on writer-module load failure, stdin parse failure, or filesystem error. Stop hook **never** blocks on digest failure. "Never block" contract honored.

### T01 — Sentinel lifecycle race conditions
**Evidence**:
- Write: `init.ts:182-205` (gated on interactive + TTY + not `--plan` + not `FABRIC_NONINTERACTIVE`)
- Read: `fabric-hint.cjs:210-216` — `existsSync` probe wrapped in try/catch
- Clear: fabric-import SKILL.md Phase 3.4 `rm -f .fabric/.import-requested`

No locking required; lock-free atomic file-existence check immune to interleaved read/write/clear sequences.

### T11 — `doctor --apply-lint` bypass paths
**Evidence**: `doctor.ts:289-307` — bypass logic enforces explicit authorization. Non-TTY without `--yes` AND without `FABRIC_NONINTERACTIVE=1` → refuses mutation with clear stderr message + exit 1. CI environments cannot silently mutate knowledge assets.

### T07 — Config schema backward compat
**Evidence**: `fabric-hint.cjs:472-482` — `_readConfigNumber()` falls back to `DEFAULT_*` constants on any failure (missing file, parse error, missing field, wrong type). 100% backward compat preserved; users without `fabric-config.json` see identical behavior.

### T04 — `candidates detected` removal + activity overview
**Evidence**: `fabric-hint.cjs:348-356` — banner formatted as 3-line 问句 (interrogative) format. Zero "candidates detected" outside negative-assertion tests. Activity overview pulls real edit-counter data, no fabrication.

---

## Quality Checklist

- [x] **功能完整性**: 6 critical review items satisfied
- [x] **规范遵循**: Zero-dependency hook scripts; no node_modules contamination
- [x] **边界处理**: All IO has error handlers; corrupted/missing files degraded gracefully
- [x] **错误处理**: All hooks honor top-level "never block" silent-fail invariant
- [x] **向后兼容**: Missing `fabric-config.json` does not break defaults
- [x] **代码契约**: T09 degenerate mode fully purged; logical consistency restored

---

## Cross-Cutting Observations

- Test coverage averages >100 LOC of new tests per task
- Two breaking schema changes (T05 `source_sessions[]`, T06 required `proposed_reason`) landed cleanly via back-compat shims
- Coverage gate (post-`eec1c3c`) covers all critical invariants
- Pre-existing 43 CLI failures (werewolf-stub fixture, init-atomic forensic, i18n snapshot) untouched — same baseline as rc.6

---

## Recommendations

- **Immediate**: Tag `v2.0.0-rc.7` and proceed to dogfood.
- **Pre v2.0.0 stable**: Manual cross-client visibility verification (T08 marked NOT_VERIFIABLE in Agent convergence review — needs Cursor/Codex screenshots).
- **Deferred to v2.1**: Maturity progression mechanism (Grill #1), hook-injection consumption sidecar (Grill #2), canonical semantic dup/contradict (Grill #3). See `docs/v2.1-roadmap.md`.

**No blocking issues. No rework needed.**
