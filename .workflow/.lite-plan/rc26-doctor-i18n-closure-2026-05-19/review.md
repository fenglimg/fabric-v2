# rc.26 Doctor i18n Closure — Batch Code Review

**Reviewer**: Gemini CLI (gemini-3.1-pro-preview) + operator triage (Claude)
**Date**: 2026-05-20
**Commit range**: `48e9f4c~1..HEAD` (7 commits: 48e9f4c, bf67e24, 1d703df, 7dc2335, 848ca69, ef11194, b10168e)
**Verdict (Gemini)**: CONDITIONAL PASS — required zh-CN remediation translation gap closure.
**Verdict (post-triage)**: BLOCKED until High #1 + Low #3 + Nit #4 are remediated in TASK-06.

---

## Reviewed Files

- `packages/server/src/services/doctor.ts` — 35 check functions migrated, translator wired at `runDoctorReport` L813
- `packages/server/src/services/doctor-i18n.test.ts` — 2-locale snapshot verification (NEW)
- `packages/server/src/services/doctor.test.ts` — FAB_LANG=en pin in beforeEach (TASK-02a follow-up)
- `packages/cli/src/commands/doctor.ts` — γ-pattern runtime translator rebinding
- `packages/cli/src/i18n.ts` — getDoctorTranslator(projectRoot) factory (TASK-01)
- `packages/shared/src/i18n/locales/en.ts` — ~280 new keys
- `packages/shared/src/i18n/locales/zh-CN.ts` — ~280 new keys

---

## Findings

### High

**H1. Un-translated remediation strings in zh-CN** — `packages/shared/src/i18n/locales/zh-CN.ts:249-585`

Over 30 `doctor.check.*.remediation*` keys in zh-CN retain English wrapper text around the shell-command protected tokens. Example:
```
"doctor.check.bootstrap_marker_migration.remediation":
  "Run \`fab doctor --fix\` to migrate to fabric:bootstrap marker"
```
Should be:
```
"doctor.check.bootstrap_marker_migration.remediation":
  "运行 \`fab doctor --fix\` 迁移到 fabric:bootstrap marker"
```

Protected-token rule applies to **shell commands**, **file paths**, **schema field names**, **stable_id prefixes**, **marker names**, and **event-type names** — NOT to the natural-language wrapper around them. Codex was over-conservative.

Violates acceptance criterion: `fab doctor in fabric_language: "zh-CN" outputs Chinese for all check names + messages + remediations`.

**Remediation**: Sweep zh-CN.ts to translate the wrapper text in every `*.remediation*` key. Keep `fab <command>` invocations, `.fabric/...` paths, `mcpServers.fabric`, `BOOTSTRAP_CANONICAL`, marker names, and stable_id prefixes verbatim English.

**Owner**: TASK-06 closure (folded into same commit as dogfood + CHANGELOG)

---

### Medium

**M1. Dropped `actionHint` in CLI Reporting** — `packages/server/src/services/doctor.ts:2723-2731` (`collectIssues`)

The `actionHint` (remediation) field is stored on `DoctorCheck` but discarded by the `collectIssues` mapper when building `DoctorIssue` arrays (fixable_errors / manual_errors / warnings / infos). The CLI's `writeIssueSection` printer therefore never sees the localized remediation text — even though the report includes it.

**Triage**: PRE-EXISTING (introduced by commit `6386a4e feat(server): make doctor own derived fabric state`, unrelated to rc.26). The rc.26 i18n migration faithfully translates the remediation strings; this is a separate CLI rendering gap.

**Disposition**: OUT OF SCOPE for rc.26. File as a follow-up RC ("doctor CLI to render actionHint inline with each issue") for a future closure.

---

### Low

**L1. English terminology leakage in translated messages** — `packages/shared/src/i18n/locales/zh-CN.ts:502` (and similar)

Some zh-CN messages aggressively retain English non-protected terms. Example: `doctor.check.underseeded.message.singular` keeps `"Knowledge corpus"` and `"plan_context retrieval surface"` untranslated. `Knowledge corpus` should become `知识库`; `retrieval surface` should become `检索面` or similar.

**Remediation**: Same sweep as H1; replace non-protected English phrases with Chinese equivalents.

**Owner**: TASK-06 closure.

---

### Nit

**N1. "entry point" not localized** — `packages/shared/src/i18n/locales/zh-CN.ts:300`

`doctor.check.forensic.message.missing.*` uses `共有 {count} 个 entry point`. The dashboard translations elsewhere in the same file localize it as `入口点`. Inconsistent.

**Owner**: TASK-06 closure (low cost; folds into the same sweep).

**N2. Redundant .singular/.plural in zh-CN** — `packages/shared/src/i18n/locales/zh-CN.ts:389-404` (and many similar)

Chinese doesn't pluralize, so `.singular` and `.plural` values are identical. Structurally required by planning-context D2 (KISS — no ICU parser). Acceptable redundancy.

**Disposition**: NOT A DEFECT. Documented in CHANGELOG out-of-scope note.

---

## Verified-Good Dimensions

Gemini explicitly confirmed (no findings) in these areas:

- **Locale resolution & γ-pattern**: `cli/i18n.ts` correctly retains module-level `t` for non-doctor commands; `getDoctorTranslator(projectRoot)` factory cleanly scopes the doctor-only locale upgrade.
- **Translator construction discipline**: `const t = createTranslator(resolveFabricLocale(projectRoot))` runs ONCE at `runDoctorReport` L813; passed positionally to each check function. No per-check translator construction.
- **`code:` field invariance**: All 84 issueCheck `code:` arguments preserve their pre-rc.26 machine-readable identifiers. No locale-coupling in machine contracts.
- **Plural pair completeness**: Every `.singular` key has a matching `.plural` in both locales. Callers consistently pick via `count === 1 ? 'singular' : 'plural'` ternary.
- **English verbatim invariance**: en.ts strings byte-match the pre-rc.26 doctor.ts literals; `doctor.test.ts` FAB_LANG=en pin keeps existing string-equality assertions green.
- **Snapshot test discipline**: `doctor-i18n.test.ts` writes `fabric-config.json` per-test to drive locale (independent of dev-env `LANG`); structured projection truncates strings to avoid runtime-noise pollution.

---

## Closure Plan

1. **Sweep zh-CN.ts remediation/message translations** (H1 + L1 + N1) — delegate codex/write.
2. Run `pnpm test --filter @fenglimg/fabric-server --filter @fenglimg/fabric-shared` to refresh the bilingual snapshot.
3. Verify `pnpm typecheck` green.
4. Commit TASK-06 atomically:
   ```
   feat(rc26): TASK-06 — closure (dogfood + CHANGELOG + review.md + zh-CN remediation sweep)
   ```
5. Leave M1 (collectIssues actionHint drop) as a separate follow-up RC.

---

## Acceptance Criteria Re-Map (Post-Sweep)

| Criterion | Status |
|---|---|
| `fab doctor` in `fabric_language: "zh-CN"` outputs Chinese for all check names + messages + remediations | ⏳ Pending H1+L1+N1 sweep |
| `fab doctor` in `fabric_language: "en"` outputs English (snapshot stable) | ✅ |
| `code` field unchanged across locales | ✅ |
| All existing doctor tests pass; new snapshot test added with both locales | ✅ |
| `pnpm typecheck && pnpm lint && pnpm test` all green | ✅ (will re-verify post-sweep) |
| Dogfood: pcf `.fabric/fabric-config.json: zh-CN`, `fab doctor` capture demonstrates Chinese output | ✅ (see dogfood-evidence.md) |
| Batch Gemini review pass (review.md committed) | ⏳ (this file) |
| CHANGELOG entry added under `## v2.0.0-rc.26 (Unreleased)` | ✅ |
