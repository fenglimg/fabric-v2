# Test Review — rc.20 Cite policy

**Session**: `rc20-cite-policy-2026-05-15`
**Summary**: AI 回复首行 `KB:` 闭环 + `fab doctor --cite-coverage` 算账。MEMORY project_cite_policy.md 6 scenarios + 8 details 落地。Claude Code first-class + Codex assume-and-test;Cursor 推 rc.21。
**Timestamp**: 2026-05-15T17:30:00+08:00
**Framework**: vitest 3.2.4 (monorepo: shared + server + cli)
**Convergence Tool**: Gemini CLI (analysis-review-code-quality, agentid rc20-cite-policy-2026-05-15-convergence-coverage)
**Overall Verdict**: ✅ **PASS**

---

## Task Verdicts (12/12 PASS)

| Task | Status | Criteria Met / Total |
|------|--------|----------------------|
| TASK-01 — Cite policy section in BOOTSTRAP_CANONICAL | ✅ PASS | 7/7 |
| TASK-02 — Event-ledger variants | ✅ PASS | 9/9 |
| TASK-03 — fabric-hint.cjs KB capture | ✅ PASS | 8/8 |
| TASK-04 — cite_policy_activated marker | ✅ PASS | 8/8 |
| TASK-05 — `--cite-coverage` CLI + server stub | ✅ PASS | 11/11 |
| TASK-06 — Single-pass replay algorithm | ✅ PASS | 11/11 |
| TASK-07 — Bilingual formatter + i18n | ✅ PASS | 10/10 |
| TASK-08 — Doctor service-layer tests | ✅ PASS | 10/10 |
| TASK-09 — fabric-hint capture tests | ✅ PASS | 9/9 |
| TASK-10 — Self-host refresh | ✅ PASS | 7/7 |
| TASK-11 — Bump v2.0.0-rc.20 + CHANGELOG | ✅ PASS | 8/8 |
| TASK-12 — HIGH fix (client filter pollution) | ✅ PASS | 1/1 |

**Overall**: 12/12 tasks PASS · 99/99 convergence criteria met

---

## Test Coverage Assessment

| Surface | Coverage | Verdict |
|---------|----------|---------|
| `parseKbLine` (hook) | 8 unit tests — all 5 cite_tags enum + multi-cite + edge cases | ✅ Adequate |
| `assistantTurnObservedEventSchema` Zod roundtrip | Covered in `fabric-hint-cite.test.ts` | ✅ Adequate |
| `runDoctorCiteCoverage` algorithm | 15 service-layer tests (TASK-08 + TASK-12 expansion) | ✅ Adequate |
| Client filter pollution (TASK-12 fix) | 2 tests (cc + codex mirror) verify denominator integrity | ✅ Adequate |
| `ensureCitePolicyActivatedMarker` | 3 tests (first-emit / idempotent / error-silent) | ✅ Adequate |
| `renderCiteCoverageReport` formatter | Implicit via self-host smoke + i18n snapshot; no dedicated unit tests | ⚠️ Gap (non-blocking) |
| `cite_tags` colon-suffix limitation | Tested as 'unspecified' bucket via current schema | ✅ Adequate (TASK-09 followup deferred) |
| Performance | 10k events <2s (TASK-08 ceiling; ~150-200ms observed locally) | ✅ Adequate |

---

## Coverage Gap (Non-Blocking)

**`renderCiteCoverageReport` formatter** lacks explicit unit tests. Coverage relies on:
- TASK-10 self-host run (verified bilingual output in human mode + structured JSON)
- TASK-07 i18n snapshot (cli-surface.test.ts.snap captures the new flags)
- Implicit via service-layer tests (the formatter's input is well-typed CiteCoverageReport)

**Risk if regression**: Formatter rendering bug surfaces only when running `fab doctor --cite-coverage` (not in unit tests). Mitigation: self-host catches gross errors before tag.

**Recommended follow-up**: Add `packages/cli/__tests__/doctor-cite-render.test.ts` covering:
- JSON mode passthrough
- skipped status branch
- marker_emitted_now warning conditional
- per_client subsection conditional (count > 1)
- dismissed_reason_histogram conditional (non-empty)
- bilingual label lookup (LANG=en + LANG=zh-CN)

Estimated ~15-20 min. **Punted to rc.21 prologue or skipped entirely** — non-regression.

---

## Test Execution

**Command**: `pnpm -r --if-present test`
**Result**: ✅ **PASS**

| Package | rc.19 baseline | rc.20 post-tag | Delta |
|---------|----------------|----------------|-------|
| shared  | 318            | 322            | +4 (TASK-01) |
| server  | 423            | 444            | +21 (TASK-02 +3, TASK-04 +3, TASK-06 +2 smoke, TASK-08 +12, TASK-12 +1 expanded; net 14→24 added across runDoctorCiteCoverage block including 1 net-new test #12b) |
| cli     | 570            | 585            | +15 (TASK-09 fabric-hint capture) |
| **Total** | **1311** | **1351** | **+40** |

(Numbers may vary slightly from individual task summaries due to inline smoke tests + snapshot updates.)

---

## Action Items

| Item | Severity | Status |
|------|----------|--------|
| HIGH cross-client denominator pollution (Gemini code review) | High | ✅ Fixed in TASK-12 |
| MEDIUM test gap (client filter denominator) | Medium | ✅ Fixed in TASK-12 |
| LOW dead code in categorizeCiteTag colon-suffix branch | Low | 🟢 KEEP — forward-compat documented |
| `renderCiteCoverageReport` formatter unit tests | Low | 🟡 Punted to rc.21 prologue |
| Cursor capture mechanism | — | 🟡 Deferred to rc.21 per locked scope |
| `cite_tags` schema widening (dismissed_reason field) | — | 🟡 Deferred to rc.21 |

---

## Ready For

- ✅ rc.20 already committed (12 commits 8f1b022..6f63da6)
- ✅ Tag `v2.0.0-rc.20` (continues v2.0.0-rc chain per `project_v2_rc_continuation.md`)
- ✅ Push to GitHub
- ✅ Soak window (no npm publish per `project_v2_rc_continuation.md`)
- ✅ Hand-off to rc.21 (Cursor capture + dismissed_reason schema widening + optional formatter tests)
