# rc.26 Doctor i18n Closure — Planning Context

**Slug**: rc26-doctor-i18n-closure-2026-05-19
**Created**: 2026-05-19
**Predecessor**: rc.25 (shipped 2026-05-19, theme: self-archive policy)

---

## Theme

Close the long-standing gap between `KT-DEC-9004` (fabric_language as authoritative locale source) and runtime — surfaced by user: 配 `fabric_language: zh-CN` 后 `fab doctor` 输出仍纯英文,延续 rc.12 grill-me 痛点"纯英文扑脸"。

---

## Verified Facts (P1 exploration, not assumptions)

### F1. `createTranslator` already supports placeholder substitution

`packages/shared/src/i18n/create-translator.ts:24` —

```ts
return Object.entries(vars).reduce((message, [name, value]) => {
  return message.replaceAll(`{${name}}`, value);
}, template);
```

→ `t('key', { count: '5', stable_id: 'KT-GLD-0010' })` works out-of-box.

**Implication**: TASK-01 does NOT need to extend the translator. Risk A (ICU placeholder support) dissolved.

### F2. Exact check site count

`grep -c "okCheck\(\|issueCheck\(" packages/server/src/services/doctor.ts` → **84** sites.

Distribution (from grep line numbers):

| Region | Line range | Approx count | Theme |
|--------|-----------|-------------|-------|
| Bootstrap/Foundation | L2087-3034 | ~26 | bootstrap_anchor, L1/L2 drift, baseline filename, forensic, meta, rule_content_refs, event_ledger, mcp config, meta_divergence, knowledge_dir_unindexed, stable_id_collision, counter_desync, preexisting_root_files |
| Filesystem-edit + Knowledge lint | L3793-3919 | ~10 | filesystem_edit_fallback (multi-arm), orphan_demote, stale_archive, pending_overdue |
| Stable_id / Layer / Index | L4234-4297 | ~9 | stable_id_duplicate, layer_mismatch, index_drift, underseeded |
| Relevance paths | L4555-4697 | ~10 | narrow_no_paths, relevance_paths_dangling, relevance_paths_drift, narrow_too_few |
| Skill / Onboard / Cite | L4836-5170 | ~29 | session_hints_stale, stale_serve_lock, relevance_fields_missing, skill_md_yaml, onboard_coverage, cite_coverage (multi-arm) |

### F3. `cli/src/i18n.ts` is trivial

```ts
import { createTranslator, detectNodeLocale } from "@fenglimg/fabric-shared";
export const locale = detectNodeLocale();
export const t = createTranslator(locale);
```

→ 2-line swap to use `resolveFabricLocale(projectRoot)`. The only catch: cli `i18n.ts` runs at module load (no `projectRoot` known), so `resolveFabricLocale` needs lazy semantics OR cli `i18n.ts` must be reshaped to `getT(projectRoot)` factory.

**Design decision pending P3**: factory pattern vs module-level lazy init.

### F4. `serve-lock.ts` uses `detectNodeLocale()` directly

`packages/server/src/services/serve-lock.ts:12` — `const t = createTranslator(detectNodeLocale());`

Same pattern — switch to `resolveFabricLocale(projectRoot)`. serve-lock is invoked per-server-start with a projectRoot already in scope, so factory pattern fits naturally.

### F5. Existing i18n keys already follow `doctor.cite.*` namespace (rc.20)

`packages/shared/src/i18n/locales/en.ts:152-169` already has cite-coverage subcommand keys. rc.26 expands to `doctor.check.<kind>.{name,message,ok,remediation}` namespace for the 84 check sites.

### F6. KT-DEC-9004 is the design anchor

> knowledge_language 应在 fab init 时通过 scan.ts:detectExistingLanguage 解算成具体值（zh-CN/en）回写 config

→ implications:
- `resolveFabricLocale` reads `fabric-config.json::fabric_language` (eager-resolved during init)
- Fallback chain: `fabric_language` (if `zh-CN` | `en`) → `detectNodeLocale()` → `"en"`
- `match-existing` value should NEVER appear in a post-init config (eager resolution invariant); if encountered, fall through to `detectNodeLocale()` and log warning

---

## Scope (3 Axes)

### Axis A — Locale resolution unification
- NEW helper: `packages/shared/src/i18n/resolve-fabric-locale.ts`
- API: `resolveFabricLocale(projectRoot: string): Locale`
- Switch sites: `packages/server/src/services/serve-lock.ts`, `packages/cli/src/i18n.ts`

### Axis B — Doctor message i18n migration
- 84 call sites in `packages/server/src/services/doctor.ts`
- Pattern: `okCheck('Name', 'Message')` → `okCheck(t('doctor.check.X.name'), t('doctor.check.X.ok', {...vars}))`
- Pattern: `issueCheck('Name', sev, kind, code, 'Message', 'Remediation')` → `issueCheck(t('doctor.check.X.name'), sev, kind, code, t('doctor.check.X.message.<arm>', {...vars}), t('doctor.check.X.remediation.<arm>'))`
- `code` field (e.g. `'knowledge_relevance_paths_dangling'`) stays unchanged — that's machine-readable contract
- New i18n keys: ~84 names + ~84 ok messages + ~84 issue messages (some with multiple arms) + ~84 remediations → estimate **~250-350 keys** per locale

### Axis C — CLI doctor adopt fabric_language
- `packages/cli/src/commands/doctor.ts` — replace `import { t }` static binding with `getDoctorTranslator(projectRoot)` factory call inside the command handler
- Same change applies to other CLI commands that run in a projectRoot context (config, install, uninstall, serve) — DEFER to follow-up rc if scope creep, OR include opportunistically if low-cost

---

## Task Decomposition (6 tasks, 3 waves)

### Wave 1 — Locale resolution foundation (TASK-01)
- TASK-01 — `resolveFabricLocale` helper + unit test + switch `serve-lock.ts` + reshape `cli/src/i18n.ts` to factory

### Wave 2 — Doctor message migration (TASK-02, TASK-03, TASK-04 parallel-eligible by line range)
- TASK-02 — Bootstrap/Foundation batch (L2087-3034, ~26 sites)
- TASK-03 — Knowledge lint batch (L3793-4697, ~29 sites)
- TASK-04 — Skill/Cite batch (L4836-5170, ~29 sites)

**Wave 2 parallel safety**: All 3 tasks write `doctor.ts` (collision). Plan as **sequential within Wave 2** — TASK-02 → TASK-03 → TASK-04. Locale file writes can interleave but doctor.ts diff merging is non-trivial.

**Revision**: Wave 2 = single executor sequential. Drop "parallel-eligible" framing.

### Wave 3 — Locale file completion + CLI rewire (TASK-05)
- TASK-05 — Backfill `en.ts` + `zh-CN.ts` with all new keys + 2-locale snapshot test + switch `cli/src/commands/doctor.ts` to factory translator

### Wave 4 — Closure (TASK-06)
- TASK-06 — dogfood evidence (中文 fab doctor screenshot) + batch Gemini review + CHANGELOG + (no version bump in this RC — separate `/release-rc` invocation)

---

## Key Design Decisions

### D1. Factory vs module-level translator

`cli/src/i18n.ts` currently exports `t` at module load. Switching to `resolveFabricLocale(projectRoot)` requires `projectRoot` — only known at command invocation.

**Option α**: Keep module export, lazy-init on first call using `process.cwd()` as projectRoot proxy.
**Option β**: Reshape to `export function getT(projectRoot): Translator`. All call sites must pass projectRoot.
**Option γ**: Module export remains `detectNodeLocale`-based for non-projectRoot contexts (banner, version, help); new `getDoctorTranslator(projectRoot)` for doctor command only.

**Chosen: γ** — minimize blast radius. Banner/version/help i18n via env (existing behavior); doctor uses projectRoot-aware translator. Future rc can sweep other commands. Aligns with feedback_clean_slate (no migrating every commands.ts).

### D2. Plural handling

English templates use ternary: `"${count} entr${count === 1 ? "y" : "ies"} have..."`. Chinese doesn't pluralize.

**Decision**: Keep English plural ternary INSIDE the i18n key body using two separate keys:
- `doctor.check.X.message.singular` (1 entry)
- `doctor.check.X.message.plural` (N entries)

Caller selects key. Chinese: both keys point to the same Chinese template (no plural distinction).

**Alternative considered**: ICU plural syntax `{count, plural, =1{entry} other{entries}}`. Rejected — current `createTranslator` only does `replaceAll`, would require parser extension. KISS.

### D3. Message decomposition for multi-arm checks

Several checks have multiple branches (e.g. `event_ledger` → missing / not_writable / invalid → different `issueCheck` calls). Each branch gets its own i18n key suffix:
- `doctor.check.event_ledger.message.missing`
- `doctor.check.event_ledger.message.not_writable`
- `doctor.check.event_ledger.message.invalid`

### D4. Snapshot test strategy

Use vitest snapshot. Run `runDoctorReport(projectRoot)` twice with manipulated config (force `fabric_language: 'en'` then `'zh-CN'`). Assert per-check output diff is non-empty AND structurally aligned (same check ordering, same severity, same code field).

### D5. Out of scope (deferred)

- Other CLI commands (`install`, `config`, `serve`, `uninstall`) — locale source remains `detectNodeLocale()` for now
- Hook output i18n (knowledge-hint-broad/narrow already bilingual via banner-i18n.cjs — separate mechanism)
- Skill template i18n (handled by `fab install` language-aware rendering, separate pipeline)

---

## Risk Register

| Risk | Mitigation | Owner Task |
|------|-----------|-----------|
| 84 sites migration introduces typo / wrong key | Snapshot test (TASK-05) catches structural regression; each batch ends with `pnpm test` gate | TASK-02/03/04 |
| Plural ternary scattered → maintenance burden | D2: explicit `.singular`/`.plural` key pair, document in TASK-05 locale file headers | TASK-05 |
| `cli/src/i18n.ts` reshape breaks existing 6 call sites (`install.ts`, `config.ts`, etc.) | D1 chose γ: keep module `t` for non-projectRoot use, NEW `getDoctorTranslator(projectRoot)` factory for doctor only — zero churn on other callers | TASK-01 |
| `runDoctorReport` snapshot test slow (full filesystem scan) | Use minimal in-memory fixture + mock projectRoot; reuse existing doctor test patterns | TASK-05 |
| LoC budget — 84 sites × ~3 lines = ~250 line diff in doctor.ts + ~250 keys × 2 locales = ~500 lines in locale files = total ~750 LoC | Within rc envelope (rc.23 = 1456 LoC); per-task commit grants bisect granularity | All |

---

## Acceptance Criteria

- [ ] `fab doctor` in `fabric_language: "zh-CN"` outputs Chinese for all check names + messages + remediations
- [ ] `fab doctor` in `fabric_language: "en"` outputs English (snapshot stable)
- [ ] `code` field (machine identifier) unchanged across locales
- [ ] All existing doctor tests pass; new snapshot test added with both locales
- [ ] `pnpm typecheck && pnpm lint && pnpm test` all green
- [ ] dogfood: pcf `.fabric/fabric-config.json` set to `zh-CN`, `fab doctor` capture demonstrates Chinese output
- [ ] Batch Gemini review pass (review.md committed)
- [ ] CHANGELOG entry added under `## v2.0.0-rc.26 (Unreleased)`

---

## Out-of-Plan References

- Memory: `feedback_review_batching` — Gemini review batched at end, not per-task
- Memory: `feedback_clean_slate` — no backward-compat shims; hard rename ok
- Memory: `project_rc25_shipped` — predecessor context
- Memory: `feedback_cli_design` — three-entry model, no flag for what can be interactive (informs D1 γ choice — avoid mandatory `--locale` flag on doctor)
- Decision: `KT-DEC-9004` — fabric_language eager-resolved in init, runtime reads as authoritative

---

## State After Plan Approval

- Plan dir: `.workflow/.lite-plan/rc26-doctor-i18n-closure-2026-05-19/`
- Execution: `/maestro-execute --dir .workflow/.lite-plan/rc26-doctor-i18n-closure-2026-05-19/` (after user approves)
- Tag target: `v2.0.0-rc.26` (separate release-rc skill invocation after TASK-06)
