# Changelog

All notable changes to Fabric will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0-rc.34] - Unreleased

rc.34 战术收尾 release: 全部 rc.33 7 项 P2 deferred + W1 SKILL.md token 二轮还债。无新功能方向、无 schema 重构、无新 doctor lint。8 TASK 串行执行,per-task 独立 commit,Gemini batch review 末尾一次,新增 52 单测,gates 全绿。战略线 ([[kb-candidate-pool-master]] Part A 21 个候选概念) 全部 out-of-scope,推到 rc.34 ship + 完整测评后单独立项。

### Added
- `unarchiveKnowledge(projectRoot, archivePathRel, options)` (`packages/server/src/services/unarchive-knowledge.ts`) — reverse-archive 原语:把已归档 entry 从 `.fabric/.archive/<type>/` 移回 `.fabric/knowledge/<layer>/<type>/`。layer 从 stable_id prefix 派生 (KT-* team, KP-* personal),可 `options.targetLayer` 覆盖。dry-run 支持,clobber-protect,EXDEV 跨文件系统 fallback,ledger 失败时 rollback。每次成功 restore 写一条 `knowledge_unarchived` event
- `knowledgeUnarchivedEventSchema` (`packages/shared/src/schemas/event-ledger.ts`) — 新 ledger event_type 含 `stable_id` / `archive_path` / `restored_to` / `reason`
- `cite-policy-evict.cjs` (`packages/cli/templates/hooks/`) — Claude Code 专属 UserPromptSubmit 钩子,turn-count 窗口周期注入 cite 契约 reminder (rc.32 Batch 1 cite 遵循率 3.1% 痛点的延迟修)。复用 rc.33 W2 stdout JSON envelope channel;Codex/Cursor 不支持该事件,跳过安装
- `estimateSkillTokens` / `validateSkillCanonicalSize` / `inspectStaleInstall` (`packages/cli/src/install/skills-and-hooks.ts`) — 3 个 install-time helper。`validateSkillCanonicalSize` 在 source >10K tok 抛 (drift→abort);`inspectStaleInstall` 在 installed >1.5× canonical 时通过 `InstallStepResult.message` 标 `stale-replaced (X tok → Y tok canonical)`,让操作员看见为何 copyTextIdempotent 触发重写
- `cite_evict_interval` config 字段 (number, default 0=OFF, opt-in;`packages/shared/src/schemas/fabric-config.ts`)
- `reverse_unarchive_enabled` + `reverse_unarchive_dry_run` config 字段 (both boolean, default false=opt-in)
- `ref/dry-run-scope.md` 新增到 `fabric-archive/ref/` — 6 行 dry-run 写操作表完整外移
- 5 个新 ref 文件加到 `fabric-review/ref/`: `per-mode-flows.md` (4 mode 完整 step-by-step + 全部 bilingual 渲染代码块) / `semantic-check.md` (LLM 主观判断三类细化) / `modify-flow.md` (Layer-flip 4-step server transaction + narrowing imported flow) / `askuserquestion-policy.md` (完整 DO/DO NOT + 双语 phrasing template) / `output-contract.md` (bilingual rollup + events.jsonl per-field self-truncate)
- 52 新单测分布: TASK-01 +1 (cooldown skew gate), TASK-02 +14 (skill-size-validator math/边界/smoke), TASK-05 +9 (unarchive dry-run/apply/defensive), TASK-06 +28 (cite-evict pure helper/config/sidecar/render/main e2e/JSON envelope)
- 2 个 rc.35 决策 memo 在 `.workflow/scratch/`: `rc34-cite-evict-design.md` (8 节, 含 rollout plan + 失败模式 + rc.35 候选 strategy) / `rc34-cohort-decay-memo.md` (8 节, 推荐 rc.35 **不实施** cohort decay)

### Changed
- `packages/cli/templates/skills/fabric-archive/SKILL.md` rewritten as **phase navigator + ref pointer**: 9056 tok → 4145 tok (-54%)。Hard Rules DISPLAY/WRITE 33 条 MUST/NEVER **verbatim 保留** (contract-locked, trim 等同协议违反)。Phase 0/0.5/1/1.5/2/2.5/3/3.5/4/4.5 每段缩到 skip 条件 + 1 句目的 + `Read ref/phase-X.md` 指针;细节迁回早已存在 (rc.33 W1) 的 12 个 ref 文件
- `packages/cli/templates/skills/fabric-review/SKILL.md` 同模式拆分: 9508 tok → 4249 tok (-55%)。Hard Rules verbatim, Mode Inference 3-step + keyword 表保留 (LLM dispatch 必读), Per-Mode Flow 每 mode 1-2 行 navigator, bilingual 渲染块 + DO/DON'T 模板 + Layer-Flip + 输出 contract 全部外移到 5 个新 ref
- `packages/cli/templates/hooks/knowledge-hint-broad.cjs` line 711 cooldown gate 加 `Math.max(0, nowMs - lastEmitMs)` 守护 backward 时钟漂移 (NTP 同步 / 笔记本休眠唤醒 / 跨时区)
- `packages/cli/templates/hooks/fabric-hint.cjs` lines 1024 + 1736 同样 `Math.max(0, …)` 守护 (maintenance signal-D + A/B/C 共享 cooldown)
- `installFabricArchiveSkill` / `installFabricReviewSkill` / `installFabricImportSkill` (`skills-and-hooks.ts`) 复制前调 `validateSkillCanonicalSize` + 每 target 调 `inspectStaleInstall`;stale 注解写进 `InstallStepResult.message`。预检失败 **block install** (per [[cli-design]] drift→abort)
- `hooks-orchestrator.ts` 加 `installCitePolicyEvictHook` 步骤 (在 narrow + lib 之间)
- `claude-code.json` 注册 `UserPromptSubmit` 事件指向 `cite-policy-evict.cjs`
- `EventLedgerEvent` discriminated union + type alias 加入 `KnowledgeUnarchivedEvent`

### Fixed
- 时钟回拨 (backward clock skew) 不再让 fabric-hint Signal A/B/C/D 静默时长 = (cooldown + |skew|);现 bounded 到 cooldown 单窗 — 用户在 NTP 矫正后不再要等额外 |skew| 才能看到下一次 reminder

### Migration
- 已有用户升级透明: 三个新 config 字段 (`cite_evict_interval` / `reverse_unarchive_enabled` / `reverse_unarchive_dry_run`) 默认 OFF, 行为零变化
- 想试 cite-policy 长会话 reminder: `.fabric/fabric-config.json` 加 `"cite_evict_interval": 10` (推荐 active session 10-20, 高契约严格度 5)
- `fab install` 现会自动检测 installed SKILL.md 是否 >1.5× canonical (即 stale install), 自动从 canonical 重写;`InstallStepResult.message` 含 `stale-replaced (X tok → Y tok canonical)` 注解
- 改 `packages/shared/src/schemas/` 后必须 `pnpm --filter @fenglimg/fabric-shared build` 才能让 server 测试看见新 schema (rc.34 TASK-05 dist 漂移 precedent)

### Out of scope (rc.35+ candidates)
- fabric-import SKILL.md 拆分 (当前 7252 tok WARN, 跟 TASK-03/04 同模式可机械应用)
- reverse-unarchive **自动检测** ghost-cited archived entries (本 release 只 ship 原语;auto-detect 落 rc.35 配合 doctor lint pass)
- cite-policy evict 其他 strategy (time-based, token-budget) — turn-count 数据先跑一段
- cohort-based 衰减 — TASK-07 memo 显式推荐 **不做** (信号与 last_consumed_at 共线 + corpus 规模不足验证)
- doctor 'N entries unarchived in last 7d' hint — 跟 auto-detect 一起做 (单独加 hint 无 trigger 时永远 0 条无价值)
- cite-coverage 双窗 (7d + 30d) — 单窗已锁定本 release;若 dogfood 发现噪音再 hotfix

## [2.0.0-rc.26] - Unreleased

`fab doctor` now respects the `fabric_language` field in `.fabric/fabric-config.json`. The long-standing gap between `KT-DEC-9004` (which defined `fabric_language` as the authoritative locale source) and runtime is closed: with `fabric_language: "zh-CN"`, doctor output (check names, messages, remediations) renders in Simplified Chinese; with `"en"` (or no field), English is preserved unchanged. Machine-readable `code` fields, file paths, schema field names, and shell commands stay English in both locales. Wave breakdown: locale resolver foundation (TASK-01) → doctor.ts migration across 35 check functions in 4 sequential batches (TASK-02a, TASK-02b, TASK-03, TASK-04) → CLI runtime translator rewire + bilingual snapshot test (TASK-05) → closure (TASK-06).

### Added
- `resolveFabricLocale(projectRoot)` shared helper — reads `.fabric/fabric-config.json::fabric_language`, falls back to `detectNodeLocale()` then `"en"`; never throws (every failure path degrades silently)
- `getDoctorTranslator(projectRoot)` CLI factory — γ-pattern projectRoot-aware translator used by the `fab doctor` command; module-level `t` retained for help/banner contexts where projectRoot is unknown
- `packages/server/src/services/doctor-i18n.test.ts` — 2-locale snapshot test verifying en + zh-CN structural alignment (identical check ordering, severity, and `code` field across locales)
- ~280 new i18n keys per locale (en + zh-CN) under the `doctor.check.<inspect_name>.{name|ok|message[.arm|.singular|.plural]|remediation[.arm]}` namespace

### Changed
- `packages/server/src/services/doctor.ts` — all 84 `okCheck()` / `issueCheck()` call sites across 35 check functions now consume `t: Translator` (built once per `runDoctorReport` from `resolveFabricLocale(projectRoot)`); literal English strings replaced with translation keys
- `packages/cli/src/commands/doctor.ts` — runtime messages emitted after `resolveDevMode()` rebind to `getDoctorTranslator(resolution.target)` so error/status output respects `fabric_language`; help text + arg descriptions remain on the module-level translator
- `packages/server/src/services/serve-lock.ts` — already consumed `resolveFabricLocale` since TASK-01 (no rc.26 churn beyond that)

### Fixed
- `DoctorIssue` now forwards `actionHint` from the underlying `DoctorCheck`; the CLI renders the localized remediation on an indented `→` line under each issue. Previously `collectIssues` dropped this field, so the i18n-migrated remediation strings were never surfaced inline with the fixable/manual/warning sections.

### Migration
- Existing users: upgrade is transparent if your config has no `fabric_language` field — locale detection falls through to `detectNodeLocale()` (`FAB_LANG` → `LANG` → `"en"`), preserving current behavior
- zh-CN users: set `fabric_language: "zh-CN"` in `.fabric/fabric-config.json` (either by re-running `fab init` or hand-editing). Existing `fab init` runs eager-resolve this field per `KT-DEC-9004`
- Pre-rc.26 doctor test snapshots may need regeneration if they captured English strings: accept with `pnpm test -- -u`

### Out of Scope (Deferred)
- i18n for other CLI commands (`install`, `config`, `serve`, `uninstall`) — those still use the module-level `detectNodeLocale()`-driven translator; can be unified in a future sweep
- ICU plural syntax — current `.singular`/`.plural` two-key approach is sufficient for en + zh-CN; future Russian/Arabic support would require parser extension

## [2.0.0-rc.25] - 2026-05-19

### Added
- `fab doctor --archive-history [--since=Nd]` — session-by-session archive attempt audit
- `session_archive_attempted` event type in events.jsonl — tracks per-session archive outcomes (proposed | viability_failed | user_dismissed | skipped_no_signal)
- fabric-archive Phase -0.5 Range Resolution — natural-language parsing for '今日复盘' / '上周' / 'rc.20' style invocations
- AGENTS.md Self-archive policy — AI E3 self-trigger via 4 normative signals
- E5 周期触发 documentation — /loop + OS cron samples in SKILL.md appendix

### Changed
- archive-hint.cjs reason copy — now communicates cross-session count + project-level debt nature
- fabric-archive Phase 0.0 — outcome-based re-scan filter with 12h anti-loop
- fabric-archive Phase 0.4 — onboard trigger gate (E2-only execution)
- fabric-archive Phase 0.5 — silent-skip path for E1/E3/E5 contexts

### Migration
- Run `fab install` after upgrade to sync new AGENTS.md Self-archive policy to all client managed blocks
- Old events.jsonl without session_archive_attempted entries — natural cold-start, no migration needed

## [2.0.0-rc.24] - 2026-05-19

Cite contract policy. The rc.20 cite policy answered "did the AI cite a KB id?" — rc.24 answers "did the AI honour the rule it cited?" by adding a 5-operator commitment syntax on `KB:` lines for decisions/pitfalls類 entries and wiring `fab doctor --cite-coverage` to cross-check committed operators against the session's actual edit diff. Bootstrap drift gates marker activation so the contract policy never partially fires during the rc.24 upgrade window. Wave breakdown: schema + bootstrap (TASK-01, TASK-02) → shared parser + hook templates (TASK-03, TASK-04, TASK-05) → doctor service (TASK-06, TASK-07, TASK-08) → shared schema + i18n + CLI (TASK-09, TASK-10, TASK-11) → release (TASK-12).

### Added

- **Cite contract syntax (5 operators)** — `KB:` lines for `decision`/`pitfall` type entries may now append `→ <operator> [<operator> ...]` where operator ∈ {`edit:<glob>` / `!edit:<glob>` / `require:<symbol>` / `forbid:<symbol>` / `skip:<reason>`}. The 6-value skip-reason dictionary (`sequencing` / `conditional` / `semantic` / `aesthetic` / `architectural` / `other:<text>`) is documented in `BOOTSTRAP_CANONICAL`. Operators are author-extensible at the doctor level (`skip_count` keys data-drive vocabulary growth — TASK-02, TASK-03).
- **`cite_commitments` parallel array on `assistant_turn_observed` events** — index-aligned with `cite_ids`; each element is `{ operators: Array<{kind, target}>, skip_reason: string | null }` with `kind ∈ {edit, not_edit, require, forbid}`. Defaults to `[]` so rc.20-rc.23 ledger events parse unchanged (TASK-01).
- **`cite_contract_policy_activated` marker event** — pure marker (no payload beyond envelope) emitted once by `ensureCiteContractPolicyActivatedMarker` after the bootstrap-drift gate clears. Anchors an independent audit window separate from the rc.20 `cite_policy_activated` marker (TASK-01, TASK-06).
- **Shared cite-line parser** — `packages/shared/src/cite-line-parser.ts` (zero-dep, 4.4KB) exports `parseCiteLine(raw)` returning `{ cite_ids, cite_tags, cite_commitments }`. Forward-compatible: unknown operator tokens silently drop so rc.25+ vocab additions degrade gracefully on rc.24-installed hooks (TASK-03).
- **Hand-authored CJS twin** at `packages/cli/templates/hooks/lib/cite-line-parser.cjs` — auto-ships to all three clients via the existing `installHookLibs` glob (Claude Code / Codex / Cursor). Parity to the TS source guarded by `cite-line-parser-parity.test.ts` (29-input corpus + null/undefined tolerance) so any future drift fails CI before commit (TASK-04).
- **Stop hook L1 soft reminder** — `cite-contract-reminder.cjs` lib + `emitCiteContractRemindersBestEffort` in `fabric-hint.cjs`. When the hook detects a `[recalled]` cite on a decision/pitfall whose `cite_commitments[i]` is empty (no operators AND no skip_reason), it writes a `⚠ KB:` line to stderr. Best-effort, never blocks the Stop hook (TASK-05).
- **`loadKbIdTypeMap` knowledge-meta loader** — `packages/server/src/services/knowledge-meta-builder.ts` exports `loadKbIdTypeMap(projectRoot): Promise<Map<stable_id, KnowledgeType>>` reading `.fabric/agents.meta.json` directly. Returns the SINGULAR `KnowledgeType` enum (`model` / `decision` / `guideline` / `pitfall` / `process`) verbatim — no plural translation at any boundary. Handles missing/malformed/legacy meta gracefully (TASK-07).
- **`runDoctorCiteCoverage` contract metrics + type routing + cross-tab** — new optional `layer?: "team" | "personal" | "all"` parameter (defaults `"all"`). Report extension is purely additive over rc.20:
  - `contract_metrics_status: "ok" | "skipped:bootstrap_drift" | "awaiting_marker"` discriminator.
  - `contract_metrics: { decisions_cited, pitfalls_cited, contract_with, contract_missing, hard_violated, cite_id_unresolved, skip_count: Record<string, number> }`.
  - `per_layer_type: { team, personal: Record<knowledge_type | "unresolved", number> }` — 6 buckets per layer.
  - `contract_marker_ts` pass-through for two-window rendering.
  - Operator comparator: `edit:<glob>` minimatch over session edit paths; `not_edit:<glob>` violates on any match; `require:<symbol>` / `forbid:<symbol>` substring-match changed file paths (NOT diff content — strict downgrade documented inline pending an `edit_intent_checked` schema widening) (TASK-08).
- **`citeCoverageReportSchema` + `CiteContractMetrics` + `CiteLayerTypeBreakdown` Zod schemas** in `@fenglimg/fabric-shared` — mirror the TASK-08 runtime types verbatim with all rc.24 additions optional to preserve rc.20 wire-compat (TASK-09).
- **27 bilingual i18n keys under `cite-coverage.*`** — header / counter labels / 3-value status enum / 6 singular type labels / 2 layer labels (+ `team — review` / `personal — fyi` suffix) / 6 skip-reason labels. zh-CN ↔ en parity guarded by `api-contracts.test.ts` superset-equality test (TASK-09).
- **`fab doctor --cite-coverage --layer=<team|personal|all>` CLI flag** — string-typed citty arg with `default: "all"` and `valueHint: "team|personal|all"`. Explicitly rejects `"both"` (the rc.20 plan-context vocabulary) to keep the two filter semantics from leaking. New `cli.doctor.errors.invalid-layer` + `cli.doctor.args.layer.description` i18n keys (TASK-10).
- **Bilingual contract-report renderer** — `appendContractSection` helper in `renderCiteCoverageReport`. Emits `### Contract check` block when `status === 'ok'`, drift-warning line when `'skipped:bootstrap_drift'`, fully suppresses when `'awaiting_marker'` + all counts zero. `hard_violated` line carries `[team — review]` / `[personal — fyi]` layer suffix; per-layer × type cross-tab + `skip_count` histogram + tail `⚠ Unresolved cite IDs: N` line all conditionally rendered (TASK-10).
- **`docs/test-seed/cli.md` `--layer` row** — curated public-flag list updated with rc.24 inline annotation (TASK-11).

### Changed

- **`BOOTSTRAP_CANONICAL` grew from ~1.4KB to ~2.9KB** — adds three new `## Cite policy` bullets (contract syntax with `→ edit:` example, 6-value skip-reason dictionary, type-routing rule that models class is reference-cite-only and guidelines/processes are deferred to rc.25 LLM-judge). Discovery bullet now mentions personal-layer `KP-*` entries explicitly. The byte-length guarantee comment bumps from `≥ 400 bytes` to `≥ 800 bytes` (TASK-02).
- **`parseKbLine` in `fabric-hint.cjs` is now a thin shim** over the inlined CJS parser — the 65-LOC inline regex/bracket/paren extractor is gone. Legacy lax id forms (e.g. `KP-001` without the letter-middle segment) no longer match — strict grammar is `K[TP]-[A-Z]+-\d+`. Two rc.20 test cases that exercised the lax form are now legitimate rejects (TASK-04).
- **`extractAndWriteAssistantTurnsBestEffort`** writes `cite_commitments` into every emitted `assistant_turn_observed` event (explicit `[]` when empty so the on-disk shape is uniform across rc.20-rc.24 events) (TASK-04).
- **`CLI surface snapshot`** regenerated for the `--layer` arg addition — exact 7-line citty-descriptor block inserted at the `json`→`since` alphabetical position. Snapshots for `install` / `serve` / `uninstall` / `config` are byte-identical to rc.23 (TASK-11).

### Fixed

- **`packages/server/src/services/event-ledger.test.ts` strict-typecheck regression** — two test fixtures at L74 + L112 omitted `cite_commitments`, which Zod accepts at parse-time via `.default([])` but the TypeScript *input* type requires explicitly (same rc.21 shape: `.default()` does not relax `z.input` types). Both fixtures now include `cite_commitments: []`. Caught by the release-rc skill's Phase 3 `pnpm typecheck` gate before tag — this is exactly the rc.21 hotfix pattern the gate was designed to surface.

### Breaking (require `fab install` rerun)

- **`BOOTSTRAP_CANONICAL` byte content changed** — the existing three-end managed blocks (`AGENTS.md` for Claude Code / Codex, `CLAUDE.md` for Cursor) are now out of sync with the canonical source. Running `fab install` will overwrite them with the new contract-policy section. The drift gate at `inspectL1BootstrapSnapshotDrift` will report `status: "drift"` until the install completes.
- **Hook template `fabric-hint.cjs` updated** — emits `cite_commitments` on every assistant turn, requires the new `lib/cite-line-parser.cjs` + `lib/cite-contract-reminder.cjs` files. Existing rc.23-installed hooks will continue to function (graceful degrade: degraded mode emits `cite_commitments: []` if the parser lib is missing) but won't surface the new soft-reminder. `fab install` reships all three.

### Migration

After upgrade, run `fab uninstall && fab install` to sync `BOOTSTRAP_CANONICAL` + hook templates + parser libs across all three clients (Claude Code / Codex CLI / Cursor). Until reinstall completes:

- `fab doctor --cite-coverage` will render `contract_check: skipped (bootstrap drift — run \`fab install\`)` in place of the contract-metrics block — this is the **B5-α drift gate** behaving correctly (refuses to activate the contract policy while the toolchain is partially upgraded).
- The Stop-hook soft reminder will not fire on rc.23-era installed hooks (degraded mode: no `cite_commitments` parsed → no offenders detected).

Post-install, the first `fab doctor --cite-coverage` invocation emits the `cite_contract_policy_activated` marker and opens the contract audit window. The rc.20 marker (`cite_policy_activated`) is independent — it does not need to be re-activated.

### Deferred to rc.25+

- **LLM-judge path for `guideline` / `process` types** — these knowledge types currently fall into the `deferred_llm_judge` bucket (cross-tab only, no contract enforcement). Semantic rules need natural-language interpretation that the rc.24 operator vocabulary intentionally avoids (B1 grill-me lock).
- **User-level cite-policy override (`~/.fabric/AGENTS.md`)** — global policy customization across multiple projects. Bootstrap-canonical is currently project-scoped only.
- **Operator vocabulary expansion** — `sequencing` / `conditional` / `aspectual` operators (e.g. `before:<symbol>`, `if:<condition>`). Data-driven from `skip_count[reason]` frequency in real-world deployments; ratio of `skip:other:<text>` to enumerated reasons determines which slot to promote next.
- **`require:` / `forbid:` over diff content** (currently file-path substring only) — gated on `edit_intent_checked` schema widening to carry diff text. Operator surface unchanged; only comparator semantics tighten.
- **Per-layer `hard_violated` split** — currently aggregated at `contract_metrics.hard_violated` with the report's `layer_filter` deciding the line suffix. A split view would require the inner cross-tab to grow a 7th bucket per layer.

### Tasks

12 tasks across 4 waves (single commit per task per release-rc convention):

- **Wave 1 — schema + bootstrap**: TASK-01 (event-ledger `cite_commitments` + marker schema), TASK-02 (`BOOTSTRAP_CANONICAL` contract syntax + personal layer mention).
- **Wave 2 — hooks**: TASK-03 (shared cite-line parser), TASK-04 (CJS twin + hook inline-bundle + parity test), TASK-05 (Stop hook soft reminder lib).
- **Wave 3 — doctor**: TASK-06 (marker emitter with drift gate), TASK-07 (`loadKbIdTypeMap` server-side loader), TASK-08 (`runDoctorCiteCoverage` contract metrics + type routing + comparator).
- **Wave 4 — surface + release**: TASK-09 (shared `citeCoverageReportSchema` + 27 i18n keys), TASK-10 (`--layer` CLI flag + bilingual renderer), TASK-11 (CLI surface snapshot regen), TASK-12 (version bump + CHANGELOG + tag).

### Verification

- **Tests**: 396 shared + 553 server (+ 1 pre-existing skip) + 619 CLI = **1568 passing**, zero failures.
- **typecheck**: clean (after TASK-12 fix-forward of the two pre-existing `event-ledger.test.ts` `cite_commitments`-missing fixtures — rc.21 precedent).
- **lint** (`knip --strict`): clean.
- **CLI surface snapshot**: single new `--layer` arg block in `'doctor' surface`; no other commands' snapshots touched.
- **Cite coverage on this repo**: rc.24 self-host run pending the post-tag `fab install` step (drift gate refuses to activate the contract window until the new BOOTSTRAP_CANONICAL is propagated).

### Notes

- The CJS twin pattern at `templates/hooks/lib/cite-line-parser.cjs` carries a parity-test guard. Future edits to either the TS source or the CJS mirror MUST keep `cite-line-parser-parity.test.ts` green.
- `KnowledgeTypeSchema` (`packages/shared/src/schemas/api-contracts.ts`) remains SINGULAR — the TASK-05 hook-side `CONTRACT_REQUIRED_TYPES` defensively accepts both singular + plural for forward-compat, but no boundary in the rc.24 codebase actually emits plural.
- `werewolf-minigame` consumer-repo regression deferred to post-tag manual verification, matching rc.23 precedent.

## [2.0.0-rc.23] - 2026-05-18

Combined 12-scope release. Bootstrap + AGENTS.md realigned to the actual two-step API, api-contracts.ts taken through a schema sweep, read-side description auto-heal mirrored from rc.22 D2 pattern, cite policy widened with two new sentinels, MCP startup made non-blocking with a 5s handler gate, stale serve-lock surfaced as a doctor advisory, and the rc.5-era `fab scan` baseline mechanism + sections-enum tuple fully removed in favor of a clean-state KB that fills from the Skill onboarding phase. Two new tracks added during in-session grill: F8a/F8b clean-state demolition + F8c onboard-phase mechanism (S5 slot enum + onboard-coverage CLI + `onboard_slot` frontmatter + dismiss/reset). Gemini batch review verdict captured in TASK-011.

### Added

- **F8c — onboard phase + S5 slot mechanism** — `fabric-archive` SKILL.md grows a first-run onboard phase that proposes entries for the five "tone" slots (`tech-stack-decision` / `architecture-pattern` / `code-style-tone` / `build-system-idiom` / `domain-vocabulary`). New `fab onboard-coverage` CLI command + `onboard_slot` frontmatter field on knowledge entries + `onboard_slots_opted_out: string[]` in `fabric-config.json` for explicit dismiss. `fab doctor` surfaces an advisory when slots are missing and not dismissed. Closes the "新装 fabric KB 空白怎么补基调" gap left by F8a's removal of baseline-scan.
- **a-C1 — `FabExtractKnowledge*Schema` 4 optional fields** — `intent_clues` / `tech_stack` / `impact` / `must_read_if` (all `z.string().optional()`) added to extract-knowledge input + output schemas. Carry-through to frontmatter assembly in `extract-knowledge.ts`. Backward-compatible: existing entries without these fields parse unchanged.
- **a-C2 — `fab doctor --enrich-descriptions`** — new doctor sub-flag that scans `.fabric/knowledge/**/*.md`, identifies entries missing the rc.23 fields, and back-fills them (stub-on-`--auto`, interactive prompt otherwise). Uses `atomicWriteText` for safe frontmatter rewrites. Audit events written to `events.jsonl`.
- **c — Cite sentinel enums** — `KB: none [no-relevant]` and `KB: none [not-applicable]` join the existing `[planned|recalled|chained-from|dismissed:<reason>]` enum. `KB: none` (bare) maps to `[unspecified]` for historical event-stream compatibility. `parseKbLine` extended (5-branch parser); `renderCiteCoverageReport` gains a breakdown column for the two new sentinels. Bootstrap text updated to teach the new enums.
- **d — Non-blocking MCP startup + 5s handler gate** — `startStdioServer` now calls `server.connect` first and kicks off `reconcileKnowledge` as a fire-and-forget promise stored on `serverContext`. Each tool handler entry-point awaits the promise with a 5s timeout via `awaitWithTimeout`. On timeout, response includes `reconcile_pending: true` warning + fresh `meta_stale_at_handler` event. First-call latency budget < 100ms in the warm path.
- **e — Stale `.serve.lock` advisory** — `fab doctor` now reports a stale `.serve.lock` (pid dead or `>24h` old) as an advisory line. `fab doctor --fix` unlinks the file and emits a `serve_lock_cleared` event. Never auto-cleaned — matches rc.22 "demote-to-warning" precedent.

### Changed

- **F1 — Bootstrap real-API alignment** — `bootstrap-canonical.ts` + project `.fabric/AGENTS.md` updated to describe the actual two-step KB-fetch API (`fab_plan_context` → `fab_get_knowledge_sections`). Prior single-step `fab_get_rules`-style hint removed (it never matched runtime). Three-end managed blocks propagate via `fab install`.
- **F2/F3/F4 — `api-contracts.ts` schema sweep** — `.describe()` strings tightened across all MCP-tool input/output schemas (one-line role descriptions, no historical baggage). `precedence` field marked `deprecated` in JSDoc. Dead exports removed: `getKnowledgeInput` / `getKnowledgeOutput` / `getKnowledgeAnnotations` / `fab_get_rules` tool registration. Hard delete, no transition period — pre-user clean-slate.
- **F5 — `source_session` (singular) removed** — only `source_sessions: string[]` survives on `FabExtractKnowledgeInput`. `superRefine` simplified.
- **F6 — `fab_get_knowledge_sections` self-describes** — MCP tool description now contains the full usage contract (input shape + output shape + invariants). F8b later simplified this further by removing the `sections: enum[]` input parameter — body is returned as a single string.
- **a-B — `description===undefined` read-side auto-heal** — `buildPreflightDiagnostics` in `plan-context.ts` detects entries where the active meta record is missing `description`, triggers `reconcileKnowledge({trigger: 'auto-heal-description'})`, and returns `auto_healed: true` + `previous_revision_hash` on the response. Matches rc.22 D2 read-side auto-heal pattern.
- **F8a — `fab scan` baseline mechanism removed** — `packages/cli/src/commands/scan.ts` deleted; `fab scan` subcommand unregistered; 4 baseline `.md` files removed from `.fabric/knowledge/` (`KT-MOD-0001..3`, `KT-PRO-0001`); `install.ts` no longer seeds baselines; `doctor.ts` no longer lints baseline filenames. Rationale: dogfood data showed all 5 baseline entries were `selectable: false` in plan_context — zero LLM contribution. KB is now seeded exclusively via the `fabric-archive` / `fabric-import` / `fabric-review` Skill paths.
- **F8b — `KNOWLEDGE_SECTION_NAMES_TUPLE` + `sections:` input removed** — `fab_get_knowledge_sections` now takes only `id` and returns `body: string` (full entry body) instead of `rules[].sections`. The A-set `## [BRACKET]` heading convention is gone; only the B-set `## <PlainTitle>` form survives. `knowledge-meta-builder.ts` parser updated. `fabric-archive` / `fabric-import` / `fabric-review` SKILL.md text re-flowed to drop sections-enum demonstrations.

### Removed

- `packages/cli/src/commands/scan.ts` (F8a)
- 4 baseline `.md` files under `.fabric/knowledge/models/` + `.fabric/knowledge/processes/` (F8a)
- `KNOWLEDGE_SECTION_NAMES_TUPLE` export from `@fenglimg/fabric-shared` (F8b)
- `sections: enum[]` input on `fab_get_knowledge_sections` (F8b)
- `getKnowledgeInput` / `getKnowledgeOutput` / `getKnowledgeAnnotations` exports (F4)
- `fab_get_rules` MCP tool registration (F4)
- `source_session` (singular) field on extract-knowledge schemas (F5)
- `__tests__/integration/scan-init.test.ts` + `__tests__/scan-builders.test.ts` (F8a)

### Verification

- **Tests**: 354 shared + 524 server (+ 1 skipped) + 578 CLI = **1456 passing**, zero failures.
- **Cite coverage**: `fab doctor --cite-coverage --since=7d --client=all` reports cleanly from the rc.20 activation-marker floor; new sentinel breakdown column renders for `[no-relevant]` / `[not-applicable]`.
- **Dogfood**: rc.23 cumulative diff cuts ~722 net lines (3440 ins / 4162 del) via clean-state demolition of `fab scan` + baseline KB + sections-enum.
- **Werewolf-minigame regression**: deferred — to be verified post-tag in the consumer repo.

### Migration

**None.** Pre-user clean-slate. Existing repos run `fab install` + `fab doctor --fix` to refresh three-end managed blocks. The 4 baseline `.md` files removed from this repo are pre-existing fabric-scan outputs — consumer repos that haven't run `fab scan` are unaffected. KB onboarding now flows through the `fabric-archive` first-run prompt or `fab onboard-coverage` advisory; no manual back-fill required.

### Notes

- `release-rc` skill handles version bump (root + workspaces) + tag + push. This CHANGELOG entry is preparatory.
- Cite policy from rc.20 remains active; new sentinels are additive.
- Next: post-tag werewolf-minigame regression sample + monitor `fab doctor --enrich-descriptions` adoption.

## [2.0.0-rc.21] - 2026-05-15

Hotfix for rc.20 CI breakage. rc.20 tag landed with two strict-typecheck regressions that local `pnpm -r build` (tsup DTS, not workspace-wide `tsc --noEmit`) failed to catch.

### Fixed

- **`packages/server/src/services/event-ledger.test.ts:106`** — TASK-02's `kb_line_raw: null` roundtrip test built an `assistant_turn_observed` event missing `cite_ids: []` + `cite_tags: []`. zod's `.default([])` applies at parse-time but the TS *input* type still requires both fields. Added explicit empty-array literals to satisfy `EventLedgerEventInput`.
- **`packages/cli/src/commands/config.ts:251`** — pre-existing `field.validate(raw)` call where `raw` is `string | undefined` from clack's `text()` validate callback. Changed to `field.validate(raw ?? "")` for type safety; runtime behavior unchanged (empty string fails the validator's positive-integer check, same as undefined would have).

### Added

- **`typecheck` script at root** (`pnpm typecheck` → `pnpm -r exec tsc --noEmit`) — closes the gap where release-rc skill's Phase 3 gate had nothing to call. Local + CI now share a single typecheck command.

### Notes

- `v2.0.0-rc.20` tag remains on GitHub for historical record. Cite policy implementation is correct end-to-end; only the CI gate failed. Consumers should clone `v2.0.0-rc.21` or later.
- Cite policy features (TASK-01..TASK-12 from rc.20) are unchanged in rc.21.
- Deferred to rc.22: Cursor capture + `cite_tags` schema widening (`dismissed_reason` field) + `renderCiteCoverageReport` unit tests.

## [2.0.0-rc.20] - 2026-05-15

Cite policy. Closes the "KB 是否真的被用了" audit loop. AI agents working on this repo MUST write a first-line `KB: <id> (<≤8字 用法>) [planned|recalled|chained-from <id>|dismissed:<reason>]` or `KB: none` directive before every edit / decide / propose-plan action. `fab doctor --cite-coverage` reads the resulting `assistant_turn_observed` events from `.fabric/events.jsonl` and reports cite coverage with denominators computed from `agents.meta.json` `relevance_paths`. Policy text lives in `BOOTSTRAP_CANONICAL` (added in rc.19), so the three-end managed block writers automatically propagate it. **rc.20 scope: Claude Code first-class + Codex assume-and-test; Cursor capture deferred to rc.21** (Cursor PreToolUse hook only sees `tool_input`, not assistant reply text — needs PostToolUse or journal scan, separate RC).

### Added

- **`## Cite policy` section in `BOOTSTRAP_CANONICAL`** — extends the rc.19 single-source canonical with 5 locked bullets: 触发 / `[recalled]` 验证 / id 反查 / dismissed reason enum / 稽核 hook. Propagates to all three end blocks via existing `fab install` writers; no new install plumbing.
- **Two event ledger variants** in `@fenglimg/fabric-shared`:
  - `assistant_turn_observed` — captures per-turn `KB:` line emission with `kb_line_raw`, `cite_ids[]`, `cite_tags[]` (enum: planned / recalled / chained-from / dismissed / none), `client` (cc/codex/cursor, optional), `turn_id`, `envelope_index`, `timestamp`.
  - `cite_policy_activated` — idempotent marker emitted on first `fab doctor --cite-coverage` invocation to establish the ts-floor for downstream coverage queries.
- **`fabric-hint.cjs` capture surface** — extends `summarizeTranscript` to harvest `role:'assistant'` envelopes + first-line `KB:` regex. New helpers: `parseKbLine(raw)` (tolerant parser handling multi-cite + nested tags + `dismissed:<reason>` + `KB: none`), `detectClient()` (env-var override + `__dirname` path heuristic), `extractAndWriteAssistantTurnsBestEffort(cwd, stdinPayload)` (best-effort emit, never throws). Wired right after `writeSessionDigestBestEffort` in `main()`.
- **`fab doctor --cite-coverage` flag + `runDoctorCiteCoverage` server entry** — three new flags (`--cite-coverage` / `--since` / `--client`) on `fab doctor` with mutex validation against `--fix` / `--fix-knowledge`. Fast-path branch skips the 28-check inspection pipeline. `parseSinceDuration` handles `Nd` / `Nh` / `Nm` / epoch-ms; `--client` enum validation (cc|codex|cursor|all).
- **Single-pass cite coverage algorithm** — one `readEventLedger` pass partitions events into assistant_turns / edits / fetches; joins against `agents.meta.json` `relevance_paths` to compute narrow denominators (minimatch glob) vs broad denominators (total edit count); session-correlated `recalled_unverified` detection (±60s window); `expected_but_missed` for narrow KBs with no matching cite; `per_client` breakdown when `--client=all`; `dismissed_reason_histogram` (current schema buckets all dismisseds under `unspecified`; per-reason buckets land when TASK-09-followup schema widens).
- **Bilingual cite coverage report formatter** — 16 new i18n keys symmetric in en + zh-CN under `doctor.cite.*` namespace. Locked zh-CN metric names preserved verbatim: `Edit 触达数 / 合格 cite / recalled 但未验证 / 应查没查 / 总回合数`. Conditional sections for per-client and dismissed reasons. `marker_emitted_now` warning prepended on first invocation.
- **29 new tests** — 14 server-side (`doctor.test.ts`: empty-ledger, narrow/broad denominator, recalled verification, dismissed histogram, per-client split, since/client filters, expected_but_missed, performance 10k events <2s) + 15 hook-side (`fabric-hint-cite.test.ts`: parseKbLine all tag enum + multi-cite + Zod roundtrip + 3 never-throws + client detection).

### Changed

- **`BOOTSTRAP_CANONICAL`** — grows from ~885 to ~1200+ bytes (adds 5-bullet cite policy section). All three end-block files re-propagated via self-host run.
- **`fabric-hint.cjs`** — Stop-hook now emits one `assistant_turn_observed` event per assistant envelope (in addition to existing session digest). Hook config files (claude-code.json / codex-hooks.json) untouched; `__dirname` path heuristic identifies client.
- **`event-ledger.ts` discriminated union** — gains two new variants; `EventLedgerEvent` TS union extended.

### Deferred to rc.21

- **Cursor capture** — Cursor PreToolUse hook only sees `tool_input`, not the assistant reply text. Needs different mechanism (PostToolUse or journal scan). `detectClient()` already supports `'cursor'` enum value; algorithm gracefully ignores absent Cursor data.
- **Cite tags colon-suffix schema** — Current `cite_tags` enum is `{planned|recalled|chained-from|dismissed|none}` (bare literals). `dismissed:scope-mismatch` etc. get bucketed under `unspecified`. rc.21 schema widening adds `dismissed_reason` as a separate field with the locked enum.
- **Doctor-run ledger event for cite-coverage mode** — `doctorRunEventSchema.mode` is currently `z.enum(['lint', 'fix-knowledge'])`. Extending the enum is a separate schema migration belonging in a later task.

### Migration

**None.** Pre-user clean-slate. Existing repos need only `fab install` + `fab doctor --fix` to refresh their three-end managed blocks with the new `## Cite policy` section. First `fab doctor --cite-coverage` invocation emits the activation marker; subsequent runs report coverage normally.

### Notes

- AI agents working on this repo from rc.20 onward MUST follow the cite policy. The policy text in the managed block IS the source of truth — AI consults it on every session start via SessionStart hook.
- `fab doctor --cite-coverage` runs in fast-path mode (zero of the 28 standard checks). Read-only. Safe to run frequently.
- Performance budget: 10k events processed in <200ms locally (single-pass O(N) replay).
- Memory `project_cite_policy.md` locked the 6 scenarios + 8 details that drove this RC. Cursor + dismissed_reason follow-ups noted under "Deferred to rc.21".

## [2.0.0-rc.19] - 2026-05-15

Bootstrap consolidation. Collapses the three-end client bootstrap surfaces (Claude `CLAUDE.md` / Codex root `AGENTS.md` / Cursor `.cursor/rules/*.mdc`) into a single canonical source at `.fabric/AGENTS.md`, hoisted via `packages/shared/src/templates/bootstrap-canonical.ts` so both CLI install (writer) and server doctor (drift comparator) consume from one place. Resolves the cross-package boundary cleanly (server has zero new dep on cli).

### Added

- **`@fenglimg/fabric-shared` canonical exports** — `BOOTSTRAP_CANONICAL` (zh-CN-hybrid locked body), `BOOTSTRAP_MARKER_BEGIN/END`, `LEGACY_KB_MARKER_BEGIN/END`, `BOOTSTRAP_REGEX`, `LEGACY_KB_REGEX`. Re-exported via root barrel + `./templates/bootstrap-canonical` subpath.
- **`fab install` four-step bootstrap stage** — `bootstrap-snapshot` writes `.fabric/AGENTS.md` from canonical, then per-client `bootstrap-claude` / `bootstrap-codex` / `bootstrap-cursor` writers propagate to the three ends. Claude uses real `@-import` (no managed block); Codex + Cursor get byte-copy managed blocks with new `fabric:bootstrap` marker. Cursor target migrates from legacy single-file `.cursor/rules` to `.cursor/rules/fabric-bootstrap.mdc` directory rule with `alwaysApply: true` front-matter. `.fabric/project-rules.md` is only-if-exists: when present, concatenated into Codex + Cursor managed blocks via `\n---\n` separator and surfaced as an additional `@-import` in CLAUDE.md.
- **`fab doctor` two-layer drift detection** — L1 byte-compares `BOOTSTRAP_CANONICAL` ↔ `.fabric/AGENTS.md` (`bootstrap_snapshot_drift`); L2 byte-compares expected body (snapshot + optional project-rules concat) ↔ each three-end managed block (`managed_block_drift`). Zero normalization: CRLF differences trigger drift. Skips L2 inspection on files in legacy-marker-only state (handled by marker migration check first).
- **`fab doctor --fix` one-time marker migration** — Detects legacy `fabric:knowledge-base` markers across CLAUDE.md / AGENTS.md / `.cursor/rules` / `.cursor/rules/fabric-bootstrap.mdc`; rewrites to `fabric:bootstrap` and emits one `bootstrap_marker_migrated` ledger event per migrated file. Migration runs FIRST in dispatcher; L1 fix and L2 fix follow in order.
- **23 new tests** — 11 in `packages/shared/test/templates/bootstrap-canonical.test.ts`, 14 in `packages/server/src/services/doctor.test.ts` (L1 drift / L2 drift incl. CRLF regression guards on both AGENTS.md and Cursor mdc / marker migration with ledger-event assertion), 9 in `packages/cli/__tests__/integration/{install-skills-and-hooks, bootstrap-snapshot, uninstall-skills-and-hooks}.test.ts`.

### Changed (Breaking — bootstrap surface)

- **Marker token**: `<!-- fabric:knowledge-base:begin/end -->` → `<!-- fabric:bootstrap:begin/end -->`. One-time migration runs under `fab doctor --fix` only; install's clean-slate strip also rewrites if encountered. No compat shim.
- **Cursor target path**: `.cursor/rules` flat-file → `.cursor/rules/fabric-bootstrap.mdc` directory rule. Install clean-slate deletes the legacy flat-file when present.
- **Root `AGENTS.md` ownership**: scaffold-stage no longer writes `AGENTS_MD_DEFAULT_CONTENT`; bootstrap-stage owns the file end-to-end via `writeCodexBootstrapManagedBlock`.
- **`CLAUDE.md`**: minimal thin shell — `# Project Knowledge\n\n@.fabric/AGENTS.md` (no managed block).
- **`packages/shared` exports surface**: adds `BOOTSTRAP_*` constants + `bootstrap_marker_migrated` event-ledger variant.

### Removed

- **Four orphan templates** — `packages/cli/templates/bootstrap/{CLAUDE.md, codex-AGENTS-header.md, cursor-fabric-bootstrap.mdc}` + `packages/cli/templates/agents-md/AGENTS.md.template`. Zero source refs verified before deletion; content replaced by `BOOTSTRAP_CANONICAL` shared export.
- **`DetectedClientSupport.bootstrapTargetPath`** field — v1 dead pointer to `.fabric/bootstrap/README.md`, no readers project-wide.
- **`agents-meta.ts` dead branches** — special-case paths for the v1 README dead pointer.
- **`AGENTS_MD_DEFAULT_CONTENT` + scaffold AGENTS.md write** in `install.ts`.
- **`buildFabricKnowledgeBaseSection` + `addFabricKnowledgeBaseSection` + `SECTION_TARGETS`** — superseded by the three per-client writers.

### Migration

**None for users.** Existing repos with legacy `fabric:knowledge-base` markers will see `fab doctor` report `bootstrap_marker_migration_required` as a fixable error; running `fab doctor --fix` migrates in place + emits ledger events. Re-running `fab install` thereafter is idempotent. Pre-user clean-slate: no shim.

### Notes

- Cross-package boundary preserved — `packages/server` has zero new dep on `packages/cli`. The ~40 LOC of managed-block-write logic in `rewriteThreeEndManagedBlocks` is deliberately duplicated inline in `doctor.ts` rather than imported across the boundary.
- Self-host validated end-to-end on this repo (Codex MCP TOML, Cursor mdc front-matter, Claude `@-import` idempotency, CRLF byte-compare guard).
- Unblocks rc.20 (Cite policy) — bootstrap managed block now exists as the host for `KB: <id>` first-line policy text.

## [2.0.0-rc.18] - 2026-05-15

Phase 5 of the post-grill 5-phase backlog: **Protocol v2**. Hard cut of the `plan-context-hint` JSON wire contract — bump `version: 1 → 2`, rename `payload.narrow → payload.entries`. Pre-user clean-slate: NO v1 compatibility shim. Largest blast radius — ships solo. Closes the 5-phase backlog.

### Changed (Breaking — wire protocol)

- **`plan-context-hint` emitter** (`packages/cli/src/commands/plan-context-hint.ts`) — `version: 1 → 2`; field `payload.narrow → payload.entries`. The exported TS type `PlanContextHintNarrowEntry` renamed to `PlanContextHintEntry`. Three sites updated: docstring example (line 18), output type (line 49-62), runtime emission (line 157-169).
- **Hook consumers** (`packages/cli/templates/hooks/knowledge-hint-narrow.cjs` + `knowledge-hint-broad.cjs`) — both now read `payload.entries` and gate on `version === 2`. v1 (or any other version) payload is silent-skipped with a single stderr breadcrumb (`[fabric] hint payload version=N unsupported (expected 2), skipping`). Null payload is silent-skipped with no stderr write (avoids spam on the common no-data path).

### Added

- **v1-receipt stance test coverage**: 6 new test cases (3 per consumer suite) asserting silent-skip + breadcrumb-fires + no-spam-on-null + version-matches-but-entries-missing-still-silent.
- **Decision record** (`.workflow/.lite-plan/rc18-protocol-v2-2026-05-15/_protocol-v2-decisions.md`) — documents the two locked decisions (field name choice + v1-receipt stance) with rejected alternatives + rationale, for future-archeology readers.

### Rationale

- **`entries` over `narrow`**: the consumer-side already had a local rebind (`knowledge-hint-broad.cjs:443`) precisely because the maintainer found `narrow` misleading at the rendering layer. The deferred-task comment at lines 437-441 is now closed by adopting the rebind name as the wire name. Mode-agnostic — fits both `--paths` and `--all` modes equally.
- **Silent-skip + breadcrumb**: aligns with the existing hook contract (`knowledge-hint-broad.cjs:464` wraps everything in try/catch with silent-exit-0). Upgrade-safe — a `fab` binary update before re-running `fab install` won't crash SessionStart. The single-line stderr breadcrumb gives diagnose-ability without source-diving.

### Migration

**None.** Pre-user clean-slate. Anyone with a stale hook installation should re-run `fab install` to refresh the templates. The new emitter unconditionally produces v2; old v1 hooks (now impossible after `fab install`) would silent-skip with a breadcrumb if they somehow received a v2 payload (no — wait, it's the opposite: new v2 emitter + new v2 hooks; the silent-skip protects against the cross-version scenario where user ran a partial upgrade).

### Tests

- shared 307/307 + server 409/410 + CLI 556 → 562 = **1278 passed**, 0 regressions.
- 6 new test cases for v1-receipt stance.
- No snapshot regeneration required.

### 5-phase backlog: COMPLETE

| Phase | Tag | Theme |
|---|---|---|
| 1 | rc.14 | Stop the bleeding (P0 fixes) |
| 2 | rc.15 | CLI surface contraction (35→20 flags) |
| 3 | rc.16 | Config + i18n closure |
| 4 | rc.17 | Polish (--help, target chain, serve warning, Bug Y) |
| 5 | rc.18 | Protocol v2 (this release) |

Next steps are open — possible directions: v2.0.0 stable cut, or new feature work.

## [2.0.0-rc.17] - 2026-05-15

Phase 4 of the post-grill 5-phase backlog: **Polish**. Four parallel tracks landed: H (`--help` rewrite + 装/配/跑 mental model), R (drop `externalFixturePath` config field), S (`serve --host` warning rewrite), Y (Codex MCP regression test — bug confirmed non-reproducible).

### Added

- **装/配/跑 mental-model intro** at root help (`cli.main.description`) — three lines explaining the three-entry CLI model (install / config / serve+doctor). Bilingual (en + zh-CN). Root help is now wired through `t()` instead of a hardcoded English string.
- **Examples blocks** appended to root + 5 visible commands (install / doctor / serve / uninstall / config) via multiline string concatenation in the description (`citty` v0.2.2 doesn't expose `meta.examples`). Bilingual.
- **Codex MCP TOML write regression test** (`packages/cli/__tests__/integration/codex-mcp-install.test.ts`) — 4 scenarios: block presence after `write()`, preserves all original sections + top-level keys, idempotent (write twice → byte-equal), legacy `[mcp.servers.fabric]` (dot-spelling) migrates to `[mcp_servers.fabric]` (underscore).

### Changed

- **`serve --host` security warning** (`cli.serve.warning.host-fallback`) rewritten to be actionable — names `FABRIC_AUTH_TOKEN` verbatim, explains the 127.0.0.1 fallback, shows the exact override command. Bilingual. No `serve.ts` code change (logic unchanged, i18n value only).
- **Resolution-chain wording** in 7 `cli.*.args.target.description` keys — dropped `fabric.config.json` from the documented chain (now matches the actual code path: CLI / env / cwd). Coordinated with R-cut.
- **Help-text tightening**: `doctor.args.fix-knowledge.description` lost `knowledge_demoted/knowledge_archived` event jargon; `doctor.args.fix.description` collapsed the 4-item list; `serve.description` dropped duplicated `FABRIC_AUTH_TOKEN` sentence (canonical home is `serve.args.host.description`).

### Removed (Breaking)

- **`externalFixturePath` config field** deleted from `fabric.config.json` schema, type mirror, sole production reader (`packages/cli/src/dev-mode.ts`), and 4 test fixtures across 3 test files. Pre-user clean-slate — no migration shim. Use the `EXTERNAL_FIXTURE_PATH` environment variable for dev/test fixture paths.
- **`DevModeSource` enum** narrowed: `cli | env | config | cwd` → `cli | env | cwd`.

### Fixed

- **Bug Y (parked since rc.14)**: confirmed **not reproducible**. TASK-006 diagnosis ran a real `fab install --dry-run` against the user's `~/.codex/config.toml` — the writer correctly appends `[mcp_servers.fabric]` while preserving all 8 pre-existing sections (`features`, `notice`, multiple `projects."<path>"` blocks, top-level `model = ...`, etc.). Most likely original-report cause: stale binary or legacy `[mcp.servers.fabric]` (dot-spelling) that pre-dated the migration logic. The new regression test guards against future repro.

### Tests

- Tests: shared 307/307 + server 409/409+1 skip + CLI 552 → 556 = **1272 passed**, 0 regressions.
- Snapshot updates accepted: 7 entries in `i18n.test.ts.snap`, 4 lines in `cli-surface.test.ts.snap` (all cosmetic, expected from i18n value rewrites).

### Cross-phase

- 22 hidden-command i18n keys (approve / bootstrap / hooks / human-lint / ledger-append / pre-commit / scan / update / sync-meta) intentionally NOT removed in this rc — deferred cleanup pass (some may be load-bearing in unexpected places).
- Dev-mode `readFabricConfig` export retained — still consumed by `commands/scan.ts` (reads `fabric_language`) and `packages/server/src/config-loader.ts` (reads `mcpPayloadLimits`).

### Coming in rc.18 / v2.1 (Phase 5)

- **Protocol v2** — hard cut of the `plan-context-hint` JSON wire contract: bump `version: 1 → 2`, rename `payload.narrow → payload.entries`, lockstep update to both `.cjs` consumers + test fixtures. Pre-user clean-slate (no v1 shim). Largest blast radius — ships solo.

## [2.0.0-rc.16] - 2026-05-15

Phase 3 of the post-grill 5-phase backlog: **Config + i18n closure**. F2 (banner i18n) lands first to give every Stop-hook banner four-language rendering; F1 (`fab config` clack TUI panel) replaces the rc.15 placeholder with a schema-driven menu loop.

### Added

- **Banner i18n library** (`packages/cli/templates/hooks/lib/banner-i18n.cjs`) — shared `.cjs` lib exposing `readFabricLanguage(projectRoot)` + `renderBanner(key, variant, params)` + 11-key × 4-variant string table (`zh-CN` / `en` / `zh-CN-hybrid` / `match-existing`). Default-on-unset is `zh-CN` to preserve rc.15 user-visible behavior; explicit `match-existing` folds to `en` per the UX i18n Policy class 1 rule. Protected tokens (slash-command names, `` `fabric doctor --lint` ``) preserved verbatim across all variants.
- **Schema introspection helper** (`packages/shared/src/schemas/fabric-config-introspect.ts`) — exports `getPanelFields()` / `getPanelFieldByKey(key)` returning typed metadata for the 11 Group A+B+C fields (2 locale + 8 hint thresholds + 1 audit). Single source of truth for the panel — adding a defaulted field requires only one new entry.
- **`fab config` clack TUI panel** (`packages/cli/src/commands/config.ts`) — interactive menu loop replacing the rc.15 placeholder. Iterates `getPanelFields()`, branches on widget type (`select` for enums, `text` for positive integers), atomic-writes to `.fabric/fabric-config.json` (tmp + rename, no lock check), re-renders after each save. Top-level CLI surface: `--target` only (per "能交互选的就别做 flag"). Uninit workspace → exitCode 1 with `fab install` hint.
- **Install pipeline copies hook libs** — `installHooks()` (in `packages/cli/src/install/hooks-orchestrator.ts` + `skills-and-hooks.ts`) now ships the entire `templates/hooks/lib/` directory (banner-i18n.cjs + session-digest-writer.cjs) into all three client install targets (Claude / Cursor / Codex). Symmetric uninstall cascade-prunes empty `lib/` dirs.
- **i18n keys** — 40 new `cli.config.*` keys across both `en.ts` and `zh-CN.ts` (parity verified): panel intro/outro, menu prompts, per-field labels + descriptions, validation messages, write success/failure, value display formatters.

### Changed

- **`fab config` placeholder** (rc.15) → full clack panel. The placeholder string `cli.config.placeholder` is removed. `installMcpClients` named export is preserved verbatim — `install.ts` re-imports it during the MCP install stage.
- **5 hardcoded zh-CN banner blocks** in `fabric-hint.cjs` (Signals A/B/C/D) → `renderBanner()` calls. Existing test-asserted substrings (`${count} 条`, `${days} 天`, `阈值 ${threshold}`, `从未运行 lint 检查`, `已 N 天未跑 lint`, `` `fabric doctor --lint` ``) preserved by the lib's zh-CN variant.
- **1 hardcoded zh-CN banner constant** (`IMPORT_RECOMMENDATION_BANNER`) in `knowledge-hint-broad.cjs` → `renderBanner()` call. Constant declaration removed.

### Tests

- 55 new banner-i18n unit tests (4-variant × 11-key matrix + readFabricLanguage edge cases + protected-token verbatim assertions).
- 8 new `fab config` panel scenarios (uninit gate ×2, exit path, Group A enum roundtrip, Group B int roundtrip, validator rejection ×2, installMcpClients export contract).
- Integration tests asserting hook libs ship to all 3 clients + symmetric uninstall cascade-prunes.
- CLI test suite: 478 → 552 passed (no regressions).

### Cross-phase

- Group D (skill-internal tuning, 10 keys) + Group E (plumbing, 5 keys) intentionally NOT in panel — power users edit JSON directly.
- 7-vs-8 Group B count discrepancy resolved: `archive_edit_threshold` (Signal A edit-count cutoff) was the missing 8th key.
- Pre-user clean-slate: no migration shim, no v1 compat — direct rename + introspection wiring.

### Coming in rc.17 (Phase 4)

- `--help` content rewrite + 装/配/跑 mental model intro
- Target resolution chain consolidation (drop `externalFixturePath` config field)
- `serve --host` security warning rewrite
- Bug Y (Codex MCP wiring re-diagnosis)

## [2.0.0-rc.15] - 2026-05-14

### Changed (Breaking — CLI surface contraction)

**`fab install` flags** 12 → 4:
- Killed: `--force`, `--reapply`, `--interactive`, `--no-bootstrap`, `--no-mcp`, `--no-hooks`, `--mcp-install`, `--scope`
- Renamed: `--plan` → `--dry-run`
- Final: `--target`, `--debug`, `--yes`, `--dry-run`
- All killed flags had interactive prompts in the install flow (rc.14 wizard); CLI surface now matches "能交互选的就别做 flag" principle (memory/feedback_cli_design.md)

**`fab uninstall` flags** 11 → 4:
- Killed: `--force`, `--interactive`, `--no-bootstrap`, `--no-mcp`, `--no-scaffold`, `--purge`, `--clean-empties`
- Renamed: `--plan` → `--dry-run`
- `--clean-empties` behavior is now always-on default (option deleted entirely, no preservation toggle)
- `--purge` removal makes `.fabric/knowledge/` unconditionally preserved
- Final flags symmetric with install: `--target`, `--debug`, `--yes`, `--dry-run`

**`fab doctor` flags**:
- Killed: `--force` (lock conflict aborts unconditionally per drift→abort principle)
- Renamed: `--apply-lint` → `--fix-knowledge` (parallel naming with `--fix`)
- Added: `--rescan` (composable: rescan → mutations → report single-pass)
- CLI flag rename + doctor.ts local identifier renames; server-side `runDoctorApplyLint` kept (minimize blast radius)

**`fab serve` flags**:
- Killed: `--force` (lock conflict aborts per drift→abort principle)

### Changed (Breaking — Command tree pruning)

- **Deleted**: top-level `fab hooks` command. `installHooks` + `validateHookPaths` helpers moved to NEW `packages/cli/src/install/hooks-orchestrator.ts` (convention match with `skills-and-hooks.ts`)
- **Deleted**: top-level `fab scan` command. Use `fab doctor --rescan` instead. Legacy v1 scan helpers (`createScanReport`, `walkFiles`, `buildRecommendations`, etc.) removed; `runInitScan` preserved as internal export
- **Stripped**: `fab config install` and `fab config hooks` subcommands. `fab config` becomes a rc.16 placeholder pointing at the upcoming TUI panel
- **Hidden**: `fab plan-context-hint` from `fab --help` (via citty `meta.hidden: true` — still callable by hook scripts)
- **Visible commands**: `fab --help` now lists exactly 5 — `install`, `doctor`, `serve`, `uninstall`, `config` (three-entry mental model: 装 / 配 / 跑 per memory/feedback_cli_design.md)

### Changed (UX)
- `ServeLockHeldError` message rewritten via `cli.serve.lock-held.action-hint` i18n key. New message includes target PID and concrete stop guidance (Ctrl-C in that terminal or `kill PID`). Drops the now-defunct `--force to override` suggestion.

### Changed (Schema)
- `fabric-config.json` schema deduped: dropped duplicate `auditMode` (camelCase) field; only `audit_mode` (snake_case) remains. Convention parity with sibling keys (`archive_hint_hours`, `review_hint_pending_count`, `fabric_language`, etc.). Schema is non-strict — external configs carrying old camelCase key will silently drop the setting at parse time.

### Migration

For users on rc.14: the deprecation warnings for `--force` and `--reapply` (added in rc.14) signaled this rc.15 removal. Drift recovery is now exclusively `fab uninstall && fab install` (no flag override path). Run `fab install --dry-run` (renamed from `--plan`) to preview before applying.

For configs with legacy keys: any `fabric-config.json` declaring `auditMode` should rename to `audit_mode`. No automatic migration shim.

### Stats
- ~35 flags → ~20 flags (-43%)
- 7 commands → 5 visible + 1 hidden
- 54 file changes across 5 refactor commits + this version bump

## [2.0.0-rc.14] - 2026-05-14

### Fixed
- **Cursor hooks.json schema** (Bug X) — rc.13 shipped an incorrect Cursor hook
  config envelope (`{events: {Stop, SessionStart, PreToolUse}}`) which Cursor
  rejected with "Config version must be a number; Config hooks must be an
  object". Now ships the correct schema per
  [Cursor official docs](https://cursor.com/cn/docs/hooks):
  top-level `{version: 1, hooks: {stop, sessionStart, preToolUse}}` with
  camelCase event names and flat per-entry shape. No migration shim per
  clean-slate policy — re-run `fab install` to refresh.
- **`fab install` idempotency + dry-run on existing workspace** (Bug V + Z) —
  `fab install` is now naturally idempotent via diff-mode. Re-running on a
  canonical workspace prints `Workspace already canonical (N files verified)`
  and exits 0. Missing pieces auto-apply (e.g., MCP for a newly-installed
  client). Drift triggers abort with helpful message pointing to `fab doctor`
  (inspect) or `fab uninstall && fab install` (reset). `--dry-run` now works
  on any workspace state. New `install_diff_applied` ledger event emitted for
  diff-mode runs.

### Deprecated
- `fab install --force` and `fab install --reapply` — slated for removal in
  rc.15 (Phase 2 CLI surface contraction). Deprecation warning now printed
  on use. The new diff-mode default behavior (`fab install` with no flags)
  replaces both: missing pieces auto-apply, drift aborts with reset guidance.

### Deferred
- **Codex MCP write to `~/.codex/config.toml`** (Bug Y) — diagnosis parked
  until end of Phase 4 per design decision in 2026-05-14 grilling. Users who
  need fabric MCP in Codex should manually add the `[mcp_servers.fabric]`
  block until then.

### Coming in rc.15 (Phase 2: CLI surface contraction)
- `fab install` flag count 12 → 4 (kill `--force`, `--reapply`, `--interactive`,
  `--no-bootstrap`, `--no-mcp`, `--no-hooks`, `--mcp-install`, `--scope`;
  rename `--plan` → `--dry-run`)
- `fab uninstall` flag count 11 → 4 (symmetric kills + `--clean-empties`
  becomes default behavior)
- Remove `fab hooks` command, `fab config install/hooks` subcommands
- Fold `fab scan` into `fab doctor --rescan`
- See `.workflow/.lite-plan/rc14-stop-the-bleeding-2026-05-14/` artifacts for
  the full 5-phase backlog.

## [2.0.0-rc.13] — 2026-05-14

**rc.12 CI follow-up.** Lint-only patch: extend knip ignore list to
`.cursor/hooks/**` (counterpart of `.claude/hooks/**` / `.codex/hooks/**`,
which the rc.12 dogfood install began populating) and migrate the stale
`packages/cli/src/commands/init.ts` entry in `ignoreIssues` to
`packages/cli/src/commands/install.ts` after the rc.12 rename. No
source/runtime changes; rc.12 tag remains as a historical marker of the
failed publish.

## [2.0.0-rc.12] — 2026-05-14

**Broad gate + fabric_language naming alignment.** Four breaking renames
land in a single rc: the `fab init` command becomes `fab install`, the
`knowledge_language` config field becomes `fabric_language`, the
SessionStart `revision_hash` gate is removed in favour of the
managed-section header, and the legacy `POINTER_LINE` mechanism migrates
to managed-section everywhere it appeared. All four are hard cuts with
no aliases or compatibility shims (clean-slate per zero-user-period
preference).

### Changed

- **`fab init` → `fab install` hard rename**: the command, file
  (`packages/cli/src/commands/install.ts`), citty `meta.name`, exported
  `installCommand` symbol, dispatch table entry, ~30 `cli.install.*`
  i18n keys (renamed from `cli.init.*` in `en.ts` + `zh-CN.ts`), help
  text values ("Initialize Fabric" → "Install Fabric"; "初始化 Fabric"
  → "安装 Fabric"), six doctor / meta-reader / api `action_hint`
  strings, and 15+ docs / README references all switch to the install
  verb. Legacy `fab init` invocations now emit citty's "unknown
  command" error — no deprecation message, no alias. Snapshots
  (`cli-surface.test.ts.snap` + `i18n.test.ts.snap`) regenerated to
  match.
- **`knowledge_language` → `fabric_language` schema rename** (TASK-003):
  fabric-config.json field renamed end-to-end (Zod schema, defaults,
  CLI writer, SKILL.md readers, doctor lints, dashboard surface). New
  `zh-CN-hybrid` enum value preserves English technical terms in
  Chinese narrative prose. Existing `knowledge_language` values are
  not migrated — fresh installs only.
- **SessionStart `revision_hash` gate removed** (TASK-001): the
  knowledge-hint-broad SessionStart hook no longer reads or compares
  the rule-set `revision_hash` before injecting the broad knowledge
  digest. The check was a no-op safeguard against an unrealised
  drift case and added latency on every session start.
- **`POINTER_LINE` → managed-section migration** (TASK-006):
  pointer-line bootstrap anchoring (the single-line `<!-- fabric:pointer -->`
  marker) is replaced with the existing managed-section block protocol
  (`<!-- fabric:managed -->` ... `<!-- /fabric:managed -->`). All
  bootstrap anchors (AGENTS.md, CLAUDE.md, `.cursor/rules/*.md`) now
  use the multi-line managed-section format uniformly.

## [2.0.0-rc.10] — 2026-05-13

**Fabric UX dogfood fixes.** Resolves three first-time-user pain points
surfaced during dogfooding plus the upstream MCP SDK misuse bug they
exposed. The `.fabric/.import-requested` sentinel mechanism is retired
entirely (clean-slate per zero-user-period preference) in favour of a
deterministic SessionStart self-check.

### Fixed

- **`fab_review` MCP tool fully broken on every action**
  (`Cannot read properties of undefined (reading '_zod')`): both
  `inputSchema` and `outputSchema` were passed to `registerTool` as
  `z.discriminatedUnion(...)`, but `@modelcontextprotocol/sdk@1.29.0`'s
  `validateToolOutput` path requires a `z.object()`-shaped raw shape and
  crashes on `schema._zod` access otherwise; the published JSON Schema
  also degraded to empty `properties: {}` so `tools/list` clients could
  not introspect any field. Fixed by splitting the schema into a flat
  `ZodRawShape` (`FabReviewInputShape` / `FabReviewOutputShape`) for SDK
  registration while keeping the existing `discriminatedUnion`
  (`FabReviewInputSchema` / `FabReviewOutputSchema`) as the internal
  authoritative contract used inside the handler via
  `FabReviewInputSchema.parse(input)` for runtime cross-field strictness.
  Adds a drift-guard unit test asserting the flat shape keys cover the
  union of branch keys. Implemented in
  `packages/shared/src/schemas/api-contracts.ts` and
  `packages/server/src/tools/review.ts`.

### Changed

- **`fabric-import` no longer interrupted at pending count ≥ 10**:
  `packages/cli/templates/hooks/fabric-hint.cjs` Signal B (review-hint
  on pending overflow) now consults `isImportInFlight(cwd)` before
  emitting `decision: "block"`. The helper reads
  `.fabric/.import-state.json` and treats the project as in-flight when
  `phase !== "complete"` and `last_checkpoint_at` is within
  `IMPORT_IN_FLIGHT_MAX_AGE_HOURS` (= 24, hard-coded). Stale states
  beyond 24h fall back to the previous behaviour. Signals A, C, D are
  unchanged.
- **`fabric init` now scaffolds a discoverable `.fabric/fabric-config.json`**:
  `packages/cli/src/commands/init.ts` adds `writeDefaultFabricConfig()`
  which writes every reader-consumed field
  (`knowledge_language`, `archive_hint_hours`,
  `archive_hint_cooldown_hours`, `review_hint_pending_count`,
  `review_hint_pending_age_days`, `maintenance_hint_days`,
  `maintenance_hint_cooldown_days`, `archive_edit_threshold`,
  `underseed_node_threshold`) with documented defaults — idempotent on
  re-run and `--reapply` (never overwrites user edits). Users no
  longer have to grep source to discover available config knobs.
- **`/fabric-import` recommendation now deterministic on first
  SessionStart of a sparse-knowledge fresh init**:
  `packages/cli/templates/hooks/knowledge-hint-broad.cjs` adds a
  `shouldRecommendImport()` self-check (agents.meta.json present +
  canonical count < `underseed_node_threshold` + `.import-state.json`
  absent). When true, the banner bypasses the existing `revision_hash`
  gate per-line so unchanged knowledge graphs still surface the hint;
  the broad-summary body remains hash-gated. Replaces the sentinel
  mechanism whose write was bypassed by every non-interactive
  `fabric init` path (CI, `-y`, piped input, `--plan`,
  `FABRIC_NONINTERACTIVE=1`, TTY-detection failures).

### Removed

- **`.fabric/.import-requested` sentinel mechanism (full retirement)**:
  removed `IMPORT_REQUESTED_SENTINEL_FILE`,
  `isImportRequestedSentinelPresent()`, `makeImportSentinelResult()`,
  the `sentinelPresent` short-circuit in `main()`, and all related
  exports / `CONSTANTS` keys from
  `packages/cli/templates/hooks/fabric-hint.cjs` and
  `packages/cli/templates/hooks/knowledge-hint-broad.cjs`. Removed
  `maybeWriteImportSentinel` + its clack confirm prompt from
  `packages/cli/src/commands/init.ts`. Removed the Phase 0 "Sentinel
  Contract (rc.7 T1)" block and the Phase 3.4 "rc.7 T1 sentinel clear"
  step from `packages/cli/templates/skills/fabric-import/SKILL.md`
  (replaced with a 2-line retirement note pointing at the new
  SessionStart self-check).
- **`scripts/rc7-coverage-gate.mjs`**: one-shot historic lint script
  (not in CI / `npm test`) whose post-conditions referenced the now-
  removed sentinel identifiers. Its rc.7 closure purpose is complete.

## [2.0.0-rc.9] — 2026-05-13

**`fab uninstall` command.** Symmetric inverse of `fab init` — removes
Fabric-managed artifacts across the same three stages (scaffold → bootstrap
→ MCP) without touching post-init user content. Defaults preserve
`.fabric/knowledge/` and state files (`events.jsonl`, `agents.meta.json`,
`forensic.json`); `~/.fabric/knowledge/` (personal root) is never touched
under any flag. Idempotent: re-running on an already-uninstalled project
exits 0 with all step statuses `skipped`.

### Added

- **`fab uninstall` command**: full inverse of `fab init`'s three-stage
  pipeline with citty `defineCommand` orchestrator and per-stage opt-out.
  Flags: `--plan`, `--force`, `--yes`, `--no-bootstrap`, `--no-mcp`,
  `--no-scaffold`, `--target`, `--interactive`, `--purge`, `--clean-empties`.
  `--purge` extends scaffold removal into `.fabric/knowledge/<subdir>/`
  contents (team root only); `--clean-empties` cascade-removes empty
  containers left behind by the conservative un-merge default. Implemented
  in `packages/cli/src/commands/uninstall.ts` (orchestrator + scaffold +
  MCP stages) and `packages/cli/src/install/uninstall-skills-and-hooks.ts`
  (10 bootstrap helpers + `uninstallBootstrapStage` orchestrator for
  Skills, hook scripts, deep-merged hook-config un-merge, and pointer-line
  strip).
- **Shared destination-path constants**: hard-coded install destinations
  extracted into 5 exported const tables (`SKILL_DESTINATIONS`,
  `HOOK_SCRIPT_DESTINATIONS`, `HOOK_CONFIG_TARGETS`,
  `HOOK_CONFIG_ARRAY_PATHS`, `FABRIC_HOOK_COMMAND_PATHS`) plus
  `POINTER_*` exports in `packages/cli/src/install/skills-and-hooks.ts`.
  Foundation for symmetric install/uninstall — install paths and
  uninstall removal paths now share a single source of truth at
  compile time. Install behavior unchanged.
- **Per-client MCP unregistration**: `ClientWriter.remove(serverName)`
  added to the writer abstraction; preserves all non-fabric server
  entries verbatim while detaching only the `fabric` key. Implemented
  for Claude Code / Cursor (JSON) and Codex CLI (TOML) in
  `packages/cli/src/config/writer.ts`,
  `packages/cli/src/config/json.ts`,
  `packages/cli/src/config/toml.ts`, and
  `packages/cli/src/config/claude-code.ts`. Called from
  `uninstallMcpClients()` in `packages/cli/src/commands/uninstall.ts`
  in the same loop shape as `installMcpClients`.

## [2.0.0-rc.8] — 2026-05-13

**Release-pipeline fix.** First RC actually published to npm since `2.0.0-rc.1`.
Bundles all rc.2 → rc.7 work that was tagged locally but never reached npm
because the CI publish step did not bump `package.json` to match the git tag.

### Fixed

- **Tag/version drift in release workflow**: `.github/workflows/release.yml`
  now derives the published version from `GITHUB_REF_NAME` via the new
  `scripts/apply-tag-version.mjs`, applied in the `publish` job after
  `pnpm install` and before `pnpm -r build`. Workspace `workspace:*`
  references resolve against the rewritten manifests at publish time.
- **Tag/version coherence guard**: `scripts/sync-versions.mjs` accepts an
  optional `--tag` flag; the `ci` job now invokes it as
  `node scripts/sync-versions.mjs --tag "${GITHUB_REF_NAME}"` so a mismatch
  between the committed `package.json` and the pushed tag fails the build
  before the publish job runs (defense in depth alongside `apply-tag-version.mjs`).

### Included from rc.2 → rc.7

All previously tagged but unpublished rc.2 → rc.7 work ships here. Notable
items: `fab_extract_knowledge` + `fab_review` MCP tools, `fabric-archive` /
`fabric-review` / `fabric-import` skills, `fabric doctor` 21-check surface
with `--apply-lint`, `fabric-hint` Signal D + edit-counter overview, T01–T11
rc.7 scope (CLI ↔ Skill init handover, scan-time path anchoring, threshold
externalization, `fab_plan_context` degenerate-mode removal), workspace
typecheck + lint + coverage stabilization. See git history `v2.0.0-rc.1..v2.0.0-rc.8`
for the full set.

## [2.0.0] — 2026-05-10

**Major release.** Knowledge sustainment protocol — a clean break from the
v1.x AGENTS.md/rules sync paradigm. Cross-client (Claude Code / Cursor /
Codex CLI) MCP-first protocol for capturing, reviewing, and sustaining
project knowledge as living artifacts under `.fabric/knowledge/`.

### Headline deliverables (aggregated rc.1 → rc.4)

- **MCP tools (4)**: `fab_plan_context`, `fab_get_rule_sections`,
  `fab_extract_knowledge` (rc.2), `fab_review` (rc.3 — 6 actions: list,
  approve, reject, modify, search, defer).
- **Skills (3)**: `fabric-archive` (rc.2 — 5-type extraction), `fabric-review`
  (rc.3 — mode inference), `fabric-import` (rc.4 — 3-phase pipeline with
  `.import-state.json` checkpoint for resumable cold-start enrichment).
- **Stop hooks**: Claude Code + Codex CLI (`archive-hint.cjs`, single .cjs
  serves both clients via identical `{decision:"block",reason:"..."}` JSON
  contract). Cursor: skills only (no Stop-hook surface as of 2026-05;
  tracked in v2.1 roadmap).
- **`fabric doctor`**: 21 deterministic checks (rc.4 added 6: `orphan_demote`,
  `stale_archive`, `pending_overdue`, `stable_id_duplicate`, `layer_mismatch`,
  `index_drift`) plus `--apply-lint` mutations (orphan-demote rewrite,
  stale-archive `fs.rename`, index-drift counter sync). All apply-lint
  mutations now roll back the filesystem change if the audit-trail event
  ledger append fails (TASK-010 Gemini-review HIGH fix).
- **Schema**: 5 knowledge types (decisions / pitfalls / guidelines / models /
  processes) × 3 maturity tiers (draft / endorsed / stable) × 2 layers
  (personal / team). Path-decoupled `stable_id`: `K[PT]-(MOD|DEC|GLD|PIT|PRO)-NNNN`
  with monotonic counter envelope in `agents.meta.json`.
- **Storage**: dual-root layout — personal at `~/.fabric/`, team at
  `<repo>/.fabric/`. v2 frontmatter is 7 flat scalar fields
  (`id`, `type`, `maturity`, `layer`, `layer_reason`, `created_at`, `tags`).
- **Lifecycle**: `propose → review → promote → demote → archive` with full
  audit trail in `events.jsonl` (15 typed event shapes). Server-side
  primitives ensure atomic 5-step approve flow with rollback at each step.
- **Hardening**: path-traversal sandbox in `fab_review.{approve,modify}`
  (rc.3 Critical fix); multiline-safe YAML frontmatter writer (rc.4);
  slug-prefix collision detection in `fab_extract_knowledge` (rc.4);
  rollback-on-ledger-failure in apply-lint mutations (rc.4 Gemini fix).

### Migration from v1.x

**Clean break — no migration path provided.** Fabric had zero users at the
v2.0.0 release point (per planning decision in MEMORY.md
`feedback_clean_slate`). v1.x repositories should be re-initialized; the
v1 `.fabric/rules/` layout is incompatible with the v2 `knowledge/`
schema. v1.x users should:

1. Back up any handcrafted `.fabric/rules/*.md` content.
2. Delete the v1 `.fabric/` directory.
3. Run `fabric init` (v2.0.0) — produces a v2 `.fabric/knowledge/` skeleton.
4. Use the new `fabric-import` Skill (rc.4) to mine prior project artifacts
   (`git log`, `docs/*.md`) into v2 pending knowledge entries.
5. Use `fabric-review` Skill to triage pending entries into the canonical
   knowledge tree.

### Fixed (rc.4 final-gate Gemini review)

- **Audit-trail rollback in apply-lint mutations.** When
  `appendEventLedgerEvent` fails after a successful filesystem mutation
  (`atomicWriteText` for orphan-demote, `fs.rename` for stale-archive),
  the mutation is now rolled back to keep canonical disk state in sync
  with the (absent) ledger entry. Best-effort rollback: if the rollback
  itself fails (extremely rare double-failure), the resulting error
  message names both faults so the user can recover manually. Surfaces as
  `applied: false` with descriptive `error` field on the mutation report.

### Acknowledged tradeoffs

- `filesystem-edit-fallback` (rc.3 doctor check #15) synthesizes a fresh
  `knowledge_promoted` event for canonical files lacking provenance in the
  ledger. This zeros out lint age on first observation, so manually
  written canonical files do not register as orphan-demote candidates
  until they accumulate inactivity from the synthesis point. Documented
  in `docs/initialization.md`. Workaround: emit a backdated
  `knowledge_promoted` event before manual writes (rc.4 dogfood pattern).
- `fabric doctor --apply-lint` and `--fix` share a single CLI exit code.
  When `--apply-lint` finishes successfully but `agents_meta_stale` /
  `knowledge_dir_unindexed` (owned by `--fix`) still register as fixable
  errors, the resulting non-zero exit can read as "apply-lint failed".
  Distinct exit codes deferred to v2.0.x per Q5 release-scope decision.

### Out of scope for v2.0.0 (deferred to v2.1)

- Cursor Stop-hook surface (Cursor adds Stop hooks in a future release).
- API rename `fab_review.modify.pending_path` → `target_path` (current name
  leaks `pending/` implementation detail; stable for v2.0).
- `knowledge_layer_change_started` paired event (crash-recovery tracking
  for layer flips; current `knowledge_layer_changed` is point-in-time only).
- Schema unlocks (current `api-contracts.ts` / `event-ledger.ts` are
  pre-locked at the rc.1 freeze point).

## [2.0.0-rc.4] — 2026-05-10

**Theme:** *Lint moat + import enrichment + documentation surface*

rc.4 closes the v2.0 RC cycle: deterministic lint with a filesystem-edit
fallback, the LLM-driven `fabric-import` Skill for baseline enrichment, a
full README rewrite, and the public docs surface
(`docs/knowledge-types.md`, `docs/initialization.md`, `docs/roadmap.md`).

### Added

- `fabric doctor --lint` — 6 deterministic checks covering knowledge tree
  health: `orphan_demote`, `stale_archive`, `stable_id_duplicate`,
  `layer_mismatch`, `index_drift`, `pending_overdue`.
- `fabric doctor --apply-lint` — applies fixes and emits
  `knowledge_demoted` and `knowledge_archived` events to the ledger.
- `fabric-import` Skill template — 3-phase pipeline (extract → classify
  → batch-write) with `.import-state.json` checkpoint for resumable runs.
  Installs into `.claude/skills/` and `.codex/skills/` alongside
  `fabric-archive` and `fabric-review`.
- `docs/knowledge-types.md` — canonical 5-type semantic reference with
  worth-archive / skip-it signals, concrete examples, and a decision tree.
- `docs/initialization.md` — full v2.0 init flow rewrite (replaces v1.x
  narrative): scan → install Skills → install Stop hooks → scaffold.
- `docs/roadmap.md` — three-tier structure: v2.0 (Released), v2.1
  (Planned), v2.x (Exploration), with explicit Out-of-Scope list.
- README rewrite — v2.0 narrative aligned with knowledge-sustainment
  positioning; cross-links to the new docs surface.

### Fixed

- Multiline-safe `quoteIfNeeded` in YAML frontmatter writer (rc.3
  deferred). Previously, multi-line `layer_reason` fields could break
  the regex frontmatter parser; now wrapped in YAML block-scalar style
  when newlines are present.
- Slug-prefix collision detection in `fab_extract_knowledge` (rc.3
  deferred). Two slugs sharing a 5-character prefix are flagged in the
  proposal step rather than silently colliding at filesystem write.

## [2.0.0-rc.3] — 2026-05-10

**Theme:** *Review loop end-to-end*

rc.3 lands the second half of the archive→review cycle: the
`fab_review` MCP tool with all 6 actions, the `fabric-review` Skill
with mode inference, a filesystem-edit fallback for orphan canonical
files, and a path-traversal sandbox.

### Added

- `fab_review` MCP tool — 6 actions: `list`, `approve`, `reject`,
  `modify`, `search`, `defer`. All actions emit typed events to
  `events.jsonl`; `approve` runs the 5-step atomic flow
  (counter++ → frontmatter inject → `git mv` → meta rebuild →
  event append) with rollback at each step.
- `fabric-review` Skill template — mode inference (single-entry edit
  vs batch review based on backlog size); per-mode flow with
  semantic-consistency check before approve; tag-filtered search.
- Stop-hook second signal — `archive-hint.cjs` now also fires when
  `.fabric/knowledge/pending/` accumulates ≥10 entries, recommending
  `fabric-review` Skill instead of (or in addition to) archive prompt.
- `fabric doctor` filesystem-edit fallback — synthesizes a
  `knowledge_promoted` event for canonical knowledge files lacking
  provenance in the event ledger (e.g. files moved by hand). Surfaces
  the synthesis as a `doctor` warning so users know what was inferred.
- Per-file ≥90% coverage gate — wired into the pre-release check; rc.3
  is the first RC to enforce it across `packages/server/`,
  `packages/cli/`, `packages/shared/`.

### Fixed

- **Critical: path-traversal sandbox in `fab_review.approve` and
  `fab_review.modify`.** Without sandboxing, a malicious or
  malformed `pending_path` argument could escape `.fabric/knowledge/`
  and write anywhere on the filesystem. Now: every path is resolved
  with `path.resolve` and verified to live under
  `<repo>/.fabric/knowledge/` before any I/O.

### Deferred to rc.4

- Multiline-safe `quoteIfNeeded` (frontmatter writer edge case).
- Slug-prefix collision detection (UX improvement, not a correctness
  bug).
- API rename `pending_path` → `target_path` in `fab_review.modify`
  (deferred to v2.1; current name leaks pending/ implementation
  detail).
- `knowledge_layer_change_started` event (paired with existing
  `knowledge_layer_changed` for crash recovery; deferred to v2.1).

## [2.0.0-rc.2] — 2026-05-10

**Theme:** *Archive loop foundation*

rc.2 lands the first half of the cycle: the `fab_extract_knowledge`
MCP tool, the `fabric-archive` Skill, the Stop-hook trigger, and the
hook-config install pipeline.

### Added

- `fab_extract_knowledge` MCP tool — writes proposed knowledge entries
  to `.fabric/knowledge/pending/<type>/`. Idempotency key is
  `sha256(source_session, type, slug)`; on duplicate, evidence is
  appended to the existing entry as `## Evidence (call N)` rather
  than creating a duplicate file. Emits `knowledge_proposed` event.
- `fabric-archive` Skill template — 5-type extraction prompt with
  layer classification heuristic (strong-team / strong-personal /
  default-team) and 5-rule slug naming. Single batch review
  presented to user; one MCP call per confirmed candidate.
- `archive-hint.cjs` Stop hook — fires when `events.jsonl` shows ≥5
  `plan_context` entries since last `knowledge_proposed`, OR ≥24h
  elapsed since last archive. Stdout JSON shape
  `{"decision":"block","reason":"..."}` is identical across Claude
  Code and Codex CLI, so a single `.cjs` script serves both clients.
- Hook config templates — `claude-code.json` (`hooks.Stop[]` array)
  and `codex-hooks.json` (`events.Stop[]` array). Cursor: no
  Stop-hook surface as of 2026-05; tracked in v2.1 roadmap.
- Install pipeline — `fabric init` bootstrap stage now wires hook
  install; new `fabric hooks` command re-applies hook install only
  (e.g. after upgrading the package). Hook config merge preserves
  user customizations: indexes `hooks.Stop[]` by command path, no-ops
  if Fabric's entry is already present, appends if absent.

### Fixed

- (none — first release of these features)

## 2.0.0-rc.1 (2026-05-10)

**BREAKING — Knowledge sustainment protocol pivot.** Fabric repositioned from
"MCP-first AGENTS.md sync" to "MCP-first knowledge sustainment". This is a
clean break from v1.x; no migration path — existing v1.x repos must re-init.

### BREAKING
- Removed v1.x `.fabric/rules/` directory layout — replaced by `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes,pending}/`
- Removed support for Windsurf, Roo Code, Gemini CLI clients (Fabric scope: Claude Code, Cursor, Codex CLI only)
- `fabric-config.ts` now uses `.strict()` Zod schema — unknown client keys hard-fail with ZodError (was silently preserved via `.passthrough()`)
- Renamed event types in event ledger: `rule_*` → `knowledge_*` (4 renames); deleted 3 obsolete: `rule_baseline_accepted`, `baseline_synced`, `legacy_client_path_present`
- Deleted `INITIAL_TAXONOMY.md` (v1 structural topology — replaced by `docs/schema.md` + AGENTS.md guidance)
- Deleted `fab bootstrap` standalone command (folded into `fab init` 4-stage pipeline)
- Deleted `fabric-init` skill three-piece (claude-skills, codex-skills, skill-source) — v2 init pipeline is turnkey, LLM enrichment moved to `fabric-import` skill in rc.4
- Deleted `husky/pre-commit` template (v1 sync gate; v2 model is async-review via `pending/` + `fabric-review` skill in rc.3)

### Removed (v1.x dead code)
- `packages/cli/src/commands/bootstrap.ts`
- `packages/shared/src/node/bootstrap-guide.ts`
- `packages/cli/templates/agents-md/variants/{vite,next,cocos}.md` (v1 framework presets — v2 init-scan auto-detects from forensic.json)
- 13 v1-coupled test files (rule-sync, tool-rule-freshness, init-nondestructive, etc.)
- 3 v1 doctor lint checks (`legacy_v1_artifacts_present`, `rule_sections_invalid`, fabric-init skill checks)

### Added
- `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes,pending}/` 6-subdir layout
- Dual-root: personal at `~/.fabric/`, team at `<repo>/.fabric/`
- Path-decoupled `stable_id` format: `K[PT]-(MOD|DEC|GLD|PIT|PRO)-NNNN` with monotonic counter envelope in `agents.meta.json`
- v2 frontmatter schema (7 fields, flat scalars): `id`, `type`, `maturity`, `layer`, `layer_reason`, `created_at`, `tags`
- `tags` field on knowledge entries — flat YAML flow-style array; populated by init-scan from forensic tech stack; consumed by rc.3 review skill's tag-filter search
- Init-time deterministic scan producing baseline knowledge entries (KT-MOD, KT-GLD, KT-PRO from forensic.json)
- `docs/schema.md` — 1-page contract for frontmatter + 15 event types + stable_id format + counters envelope
- Self-repo dogfood: `.fabric/knowledge/decisions/` seeded with 8 KT-DEC entries capturing v2.0 architectural decisions

### Fixed
- `doctor --fix` `counter_desync` now actually persists counters to `agents.meta.json` after `reconcileRules` (was silently skipped — surfaced during dogfood)

### Coming next
- **rc.2**: `fab_extract_knowledge` MCP tool + `fabric-archive` skill + Stop hooks for 3 clients (Claude Code/Cursor/Codex)
- **rc.3**: `fab_review` MCP tool + `fabric-review` skill (mode-inferred review loop)
- **rc.4**: `doctor --lint` (6 deterministic checks) + `fabric-import` skill (LLM-driven enrichment) + full README rewrite + `docs/{knowledge-types,initialization,roadmap}.md`
- **2.0.0 stable**: npm publish to `latest` dist-tag (rc.x stays GitHub-only)

## [1.8.0-rc.3] - 2026-05-09

### Fixed

- Codex CLI repo skill installed to the wrong path. Prior releases wrote `.agents/skills/fabric-init/SKILL.md`, but Codex CLI discovers repo skills under `.codex/skills/<name>/SKILL.md` (mirroring its `~/.codex/skills/` global layout). Result: every existing Fabric init since the Codex follow-up was added shipped a Codex skill that Codex never read, silently breaking the Codex follow-up flow. `init` now writes to `.codex/skills/fabric-init/SKILL.md`; both Codex hook reason texts (zh + en) and the `cli.init.reason-message.codex-body` / `multi-body` i18n strings point at the new path.

### Added

- Doctor check `codex_skill_legacy_path` (fixable): detects `.agents/skills/fabric-init/SKILL.md` left over from prior installs. `--fix` moves it to `.codex/skills/fabric-init/SKILL.md` (preserving user edits), removes empty parent dirs, and emits a `codex_skill_path_migrated` ledger event.

## [1.8.0-rc.2] - 2026-05-09

### Changed

- Claude reminder hook fully renamed to match the unified skill name: `agents-md-init-reminder.cjs` → `fabric-init-reminder.cjs`. The Stop-hook reason text now says "调用 fabric-init skill" (and the equivalent English copy in `cli.init.reason-message`). Skill frontmatter `name:` and i18n strings are aligned to `fabric-init`.
- `init.ts` Stop-hook filter recognizes both old (`agents-md-init-reminder.cjs`) and new (`fabric-init-reminder.cjs`) names, so re-running `fab init` on an existing project cleanly replaces the legacy entry.

### Added

- Doctor check `claude_hook_legacy_path` (fixable): detects `.claude/hooks/agents-md-init-reminder.cjs` left over from prior installs (file or `.claude/settings.json` reference). `--fix` renames the file to `fabric-init-reminder.cjs`, rewrites the settings command path, and emits a `claude_hook_path_migrated` ledger event.

## [1.8.0] - 2026-05-07

### Added

- Atomic write helper (`@fenglimg/fabric-shared/node/atomic-write`) — tmp+rename pattern with optional fsync; used by all config and scaffold writers.
- FabricError taxonomy with 5 sub-trees: `ConfigError` / `RuleError` / `IOFabricError` / `MCPError` / `InitError`; replaces ad-hoc string-prefix error matching throughout server.
- Per-path ledger write queue (poison-resistant, in-process serialization) — concurrent `fab_append_intent` calls for the same path are serialized without data loss.
- SIGINT / SIGTERM / SIGHUP handlers with in-flight request drain (up to 5 s) + `fsync` on the event ledger before process exit (closes Claude Code #15945 zombie pattern).
- Cross-process serve lockfile (`.fabric/.serve.lock`) with PID liveness check — stale locks auto-recover, live locks block with `--force` override.
- rule-sync orchestrator (`ensureRulesFresh` / `reconcileRules`) — single source of truth for rule freshness; wired into all three MCP tool handlers with warnings surfaced in `response.warnings`.
- Startup full rule consistency scan — rules added to `rules/` while the server was offline are visible immediately on next start.
- Chokidar watcher extended to `.fabric/rules/` for cache invalidation (no writes, invalidate-only).
- MCP payload guard: 16 KB warn threshold / 64 KB hard limit (`MCP_PAYLOAD_TOO_LARGE`); both thresholds configurable via `fabric.config.json mcpPayloadLimits`.
- Tool schemas exported to `@fenglimg/fabric-shared/schemas/api-contracts` with per-tool annotations and golden contract snapshots (drift detection on CI).
- Doctor checks: `mcp_config_in_wrong_file`, `event_ledger_partial_write`, `meta_manually_diverged`, `rules_dir_unindexed`, `stable_id_collision`, `claude_skill_legacy_path`, `preexisting_root_claude_md` (info-level), `legacy_client_path_present`.
- Knip dead-code detector with zero baseline integrated into `pnpm lint`.
- Per-client config golden snapshots (drift detection guards against unintended init output changes).
- `fab init --scope project|user` flag — controls whether Claude MCP config is written to `.mcp.json` (project, default) or `~/.claude.json` (user).

### Changed

- Claude MCP config now written to `.mcp.json` (project scope) or `~/.claude.json` (user scope) — no longer `.claude/settings.json`, which per Claude Code spec is reserved for hooks and permissions only.
- MCP config writer uses hand-rolled deep-merge to preserve other `mcpServers` entries (no new runtime dependencies).
- Client SKILL files unified under `fabric-init/SKILL.md` (previously `agents-md-init/SKILL.md`).
- Doctor's conceptual role reframed from "baseline promoter" to "consistency repairer" — `--fix` calls `reconcileRules` to bring disk state in sync rather than purely promoting state.
- All user-facing config writes (JSON configs, TOML configs, Husky hooks, init scaffold files) use atomic tmp+rename primitives.
- `ensureRulesFresh` wired into all three MCP tool handlers (`fab_get_rules`, `fab_append_intent`, `fab_plan_context`); rule freshness warnings flow through to `response.warnings`.
- `--reapply` no longer truncates `events.jsonl`; existing byte content is fully preserved.
- `--reapply` preserves `agents.meta.json` when `.fabric/rules/` contains at least one `.md` file (protects AI-built rule trees); regenerates only when `rules/` is empty.
- `readEventLedger` no longer silently drops trailing partial lines — emits a `LedgerWarning` entry instead; doctor `event_ledger_partial_write --fix` truncates the partial line cleanly.
- HTTP error codes preserved across FabricError migration: PathEscape errors stay 403, ledger/lock errors stay 404.
- `ensureRulesFresh` I/O storm under high-frequency MCP polling mitigated by 500 ms global cooldown combined with watcher-based cache invalidation.

### Deprecated

- Clients `windsurf`, `rooCode`, `geminiCLI` are deprecated and removed in the same release. The doctor `legacy_client_path_present` check fires on first run after upgrade so users can clean their `fabric.config.json` via `fab doctor --fix` before the legacy keys become inert.

### Removed

- Client support: `windsurf`, `rooCode`, `geminiCLI` — Fabric now targets exactly three clients: Claude Code (CLI + Desktop), Codex CLI, and Cursor.
- Dead code: 5 unused init helper functions and the orphan `fab_get_rules` tool registration removed by Knip audit.
- Old SKILL path: `.claude/skills/agents-md-init/` — doctor check `claude_skill_legacy_path --fix` migrates to `.agents/skills/fabric-init/`.

### Fixed

- `--reapply` no longer truncates `events.jsonl` — byte-level ledger preservation on every reapply.
- `--reapply` preserves AI-built `agents.meta.json` when `rules/` directory has content.
- HTTP error codes (403, 404) preserved correctly after FabricError taxonomy migration.
- `readEventLedger` emits a `LedgerWarning` instead of silently dropping trailing partial lines caused by interrupted writes.
- `ensureRulesFresh` I/O storm under high-frequency MCP polling (500 ms global cooldown + watcher invalidate).

### Security

- Hand-rolled deep-merge in MCP config writer — no new third-party dependency introduced for config patching.
- Tmp file cleanup on atomic write failure — no orphan `.tmp` files left on disk if the rename step errors.

## [1.6.0] - 2026-04-25

### Added

- Added the L0/L1/L2 cognitive alignment protocol with structured rule descriptions, `.fabric/rules/` rule bodies, and `.fabric/INITIAL_TAXONOMY.md` initialization notes.
- Added `fab_get_rule_sections` for sectioned rule retrieval with AI-selected L1 IDs, required L0/L2 inclusion, selection-token validation, and `rule_selection` audit events.
- Added neutral `fab_plan_context` planning output that returns required/selectable rule descriptions and a lightweight requirement profile without server-side L1 ranking details.

### Changed

- `agents.meta.json` now uses `stable_id` as the unified rule identity and indexes level, required/selectable flags, and description metadata.
- `fabric doctor --audit` accepts the new `rule_selection` telemetry while keeping legacy audit compatibility.
- Replaced the public editing loop around `fab_get_rules` with `fab_plan_context` plus `fab_get_rule_sections`.

### Fixed

- Hardened initial taxonomy generation against incomplete forensic reports from tests and minimal target projects.
- Updated CLI snapshots for the new taxonomy output and relaxed the slow pre-commit update test timeout for local CI variance.

### Tests

- Added and validated the full cognitive rule-selection flow against the real `/mnt/c/Project/oops-framework` repository using the locally built CLI and MCP server.
- Verified build, CLI tests, focused server tests, shared metadata tests, and `fabric doctor --audit`.

## [1.5.2] - 2026-04-24

### Added

- Added stable `stable_id` precompilation for rule nodes plus validation coverage, so rule bundles can reference deterministic English anchors instead of path-derived fallbacks.
- Added `docs/tooling-manifest.json` and `docs/tooling-manifest.md` as the explicit tooling knowledge layer for script contracts and review anchors.

### Changed

- Moved the canonical intent ledger path to `.fabric/.intent-ledger.jsonl`, keeping the legacy root path read-compatible until `fabric doctor --fix` performs an explicit migration.
- `fabric doctor` now detects legacy ledger placement and can migrate it only under `--fix`, avoiding silent file moves during normal reads.
- `fab_plan_context` now returns a shared resolved bundle shape so one planning pass can serve multiple edit targets without repeating the same directory-level rule resolution work.
- Updated onboarding and initialization docs to point to the new ledger location and tooling manifest entry points.

### Tests

- Added coverage for ledger-path compatibility, doctor-led migration, stable rule ID extraction, protected-token linting, and shared plan-context bundle resolution.

## [1.5.1] - 2026-04-23

### Changed

- Refined zh-CN wording across CLI copy, Dashboard labels, and initialization-related prompts to reduce translationese and internal jargon in the main user path.
- Updated first-read onboarding docs, including `README.md`, `packages/cli/README.md`, `docs/quickstart.md`, `docs/getting-started.md`, and `docs/initialization.md`, so install and follow-up guidance read as direct Chinese-first instructions.
- Tightened AI-facing follow-up copy in the Codex initialization skill and related hook text so repository initialization reminders are easier for clients to act on.

### Documentation

- Added `docs/chinese-localization.md` as the terminology baseline for future zh-CN wording changes.
- Rewrote `docs/dashboard-tour.md`, `docs/launch-story.md`, and `docs/brand.md` to align public storytelling with the new localized terminology.

### Tests

- Refreshed CLI i18n snapshots and init surface assertions to match the new wording, with CLI init/i18n tests and dashboard build verification passing.

## [1.5.0] - 2026-04-23

### Added

- Added the `fabric approve` command for approving drifted human-lock entries from the CLI, with `--all` and interactive approval modes.
- Added lazy `web-tree-sitter` probing to the CLI build so forensic analysis can validate AST parsing feasibility without adding startup cost.
- Added `activation.tier` metadata for rule nodes (`always`, `path`, `description`) and surfaced description-only rules as stubs in `fab_get_rules` payloads.
- Added `/api/rules/context` for the Dashboard to inspect the same resolved rule context returned by `fab_get_rules`.
- Added the Dashboard Rule Topology module with a coverage heatmap, hit-reason panel, new module navigation, and placeholders for the next read-only modules.

### Changed

- `scan`, `bootstrap`, and `init` planning now use async scanner paths so future AST-backed forensic work can share the same detection pipeline.
- Framework detection now returns a richer `TechProfile` shape with confidence, framework identity, co-package evidence, and reserved AST evidence fields.
- The HTTP server now exports human-lock approval/read services for CLI reuse and registers the rules-context API beside the existing rules endpoint.

### Documentation

- Updated release-facing docs to describe v1.5.0, the new approve workflow, rule activation tiers, the rules-context API, and Dashboard topology inspection.

### Tests

- Added coverage for `fabric approve`, tree-sitter probing, rule activation metadata, rules context resolution, Dashboard coverage heatmap, and hit-reason rendering.

## [1.4.0] - 2026-04-22

### Added

- Added first-class Codex follow-up assets during `fabric init`, including the repo skill at `.agents/skills/fabric-init/SKILL.md`, `SessionStart` / `Stop` hook templates under `.codex/hooks/`, and repo-level `.codex/hooks.json` wiring that works with `features.codex_hooks = true`.
- Added a default `@clack/prompts`-based TTY wizard for `fabric init`, plus adapter-level test coverage that locks intro / grouped planning / cancel / outro behavior.

### Changed

- Reframed `fabric init` around a canonical plan model: `fabric init` now launches the TTY wizard by default, `fabric init --yes` is the non-interactive execution path, `fabric init --plan` is the dry-run preview path, and `fabric init --reapply --yes` is the managed reapply path for existing setups.
- The wizard now groups stage selection and MCP install scope into one planning interaction, and `--plan` / `--reapply` flows now render explicit mode banners instead of relying on implicit output cues.
- Init planning/execution was split into reusable plan and executor primitives so scaffold generation, stage execution order, and wizard rewrites all flow through one typed model.

### Documentation

- Updated `README.md`, `docs/getting-started.md`, and `docs/initialization.md` to present the new `fabric init` mental model, including TTY wizard guidance, non-interactive variants, dry-run usage, and reapply semantics.

### Tests

- Expanded init acceptance coverage for plan-only, reapply, MCP install scope, non-destructive planning, and real `@clack/prompts` adapter mocking.

## [1.3.1] - 2026-04-22

### Changed

- `fabric init` and `fabric bootstrap install` now keep the bootstrap source of truth inside `.fabric/bootstrap/README.md`; the bootstrap stage no longer emits root-level `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.
- `sync-meta` now treats `.fabric/bootstrap/README.md` as the canonical L0 bootstrap node while still accepting legacy root `AGENTS.md` metadata as a migration input.

### Fixed

- Resolved the CLI typecheck regression in `packages/cli/src/commands/bootstrap.ts` caused by a stray `ensureTrailingNewline` reference after the bootstrap internalization refactor.
- Normalized bootstrap and skill template line endings to LF so `scripts/lint-protected-tokens.ts` passes consistently in GitHub Actions and tag-triggered release builds.

### Documentation

- Merged the Day 6 bootstrap notes into `docs/initialization.md`, retired the temporary Day 2/4/5/7 runbooks, and refreshed `README.md`, `docs/getting-started.md`, `packages/cli/README.md`, and `RELEASING.md` to match the stable `v1.3.1` release flow.

## [1.3.0] - 2026-04-21

### Added

- **ContextCache**: unified hot-path cache for agents.meta.json, GetRulesContext, and audit.jsonl sliding-window byte-offset cursor. TTL-based with eager invalidation on meta writes and file-watch events.
- **AGENTS.md MCP resource** (`fabric://agents-md`): clients can now read project-level L0 rules directly via MCP resource protocol.
- **File-watch notifications**: chokidar watches `agents.meta.json` and `AGENTS.md`, invalidates cache, and sends debounced `tools/list_changed` / `resource_updated` MCP notifications to all active sessions.
- **SSE ring buffer + reconnect**: server-side 50-entry ring buffer enables `Last-Event-ID`-based replay for reconnecting clients. Dashboard SSE client rewritten with fetch-based streaming, exponential-backoff reconnect, and event ID tracking.
- **`fabric update` CLI command**: refreshes MCP host configuration and git hooks without re-creating Fabric files — useful after CLI upgrades.
- **Pre-commit fast-path**: hook now reads staged files and skips all checks when none match any fabric-managed `scope_glob`, `AGENTS.md`, or ledger files.
- **`EditIntentComplianceResult`**: `appendEditIntentAuditEvents` returns structured compliance data (compliant, matched_get_rules_ts, window_ms) alongside audit entries.

### Changed

- All four MCP tools (`fab_append_intent`, `fab_get_rules`, `fab_plan_context`, `fab_update_registry`) migrated from `server.tool()` to `server.registerTool()` with typed `outputSchema` definitions.
- Audit log reads use byte-offset cursor tracking — consecutive calls never re-read already-seen bytes.
- Service layer (`get-rules`, `update-registry`, `append-intent`) uses ContextCache for meta and context lookups.
- Auth middleware now covers `/mcp` endpoint in addition to `/api` and `/events`.
- `bootstrap` and `config` subcommands unhidden from CLI help output.

## [1.2.0] - 2026-04-20

### Added

- **One-shot `fabric init`**: streamlined initialization flow.
- **`fabric` binary alias**: the CLI can now be invoked as `fabric` in addition to `fab`.

## [1.1.0] - 2026-04-19

### Added

- **Shadow Mirroring architecture**: all AI rules now live under `.fabric/agents/` as a 1:1 mirror of the source tree plus a `_cross/` subtree for cross-cutting concerns; business directories (`src/`, `packages/`, etc.) contain zero rule files.
- **Check-not-Ask fab init flow**: the `agents-md-init` Claude Skill is rewritten as Phase 0 active reconnaissance (≤15 files × 100 lines budget) → Phase 1 single-screen Architecture Review batch Check with file:line evidence anchors → Phase 2 auto-construct into `.fabric/agents/`. HIGH-confidence assertions are implicit-accept, MEDIUM/LOW require explicit acceptance.
- **`ForensicAssertion[]` data contract** (shared): structured assertions with `type`, `statement`, `confidence`, `evidence[]`, `coverage`, optional `proposed_rule`, and `alternatives`. Adds `CandidateFileEntry[]` grouped by family (`entry`/`component`/`config`/`test`/`domain`) with a top-3-per-family cap of 12, plus `sampling_budget {max_files:15, max_lines_per_file:100}`.
- **`fab_plan_context(paths[])` MCP tool** (server): batch multi-path rule query that aggregates `fab_get_rules` output across several candidate files in a single call, designed for the planning/exploration phase.
- **`fab doctor --audit` compliance check** (cli + server): records every file edit with or without a preceding `fab_get_rules` call into `.fabric/audit.jsonl`, with `off` / `warn` / `strict` modes.
- **`topology_type` and `layer` metadata** (shared + cli): `AgentsMetaNode` now carries `layer: L0|L1|L2` and `topology_type: mirror|cross-cutting`, with `z.preprocess` backward compatibility for legacy meta files. `sync-meta` derives both from `.fabric/agents/` path depth and the `_cross/` prefix.
- **`confidence_snapshot` on `InitContextInvariant`** and `topology_type` + `target_path` on `InitContextDomainGroup`; interview trail records Architecture Review presentation and user corrections.

### Changed

- **Bootstrap templates** (6 files) now mandate `MUST: Before ANY code reading, architecture planning, or logic modification, call fab_get_rules(path=<target file>)` and `NEVER: Reason about or modify code before obtaining local shadow context via MCP`. Protected-token list extended to cover `shadow constraints`, `Shadow Mirroring`, `.fabric/agents/`, `.fabric/agents/_cross/`.
- **Root `AGENTS.md` templates** (including the cocos/next/vite variants and `packages/cli/templates` mirrors) degrade to a Bootstrap Protocol stub; child documentation is no longer linked via `@import` or `<!-- fab:index -->`. Cross-repository references resolve dynamically through `fab_get_rules`.
- **`sync-meta`** scans only `.fabric/agents/**/*.md` and stops walking colocated `AGENTS.md` or `.claude/rules/` trees.
- **`forensic.ts`** emits structured assertions plus candidate files alongside (deprecated) `recommendations_for_skill` during a one-version migration window.
- **Werewolf fixture** (`examples/werewolf-minigame-stub`) migrated to Shadow Mirroring; root `AGENTS.md` shrinks to Bootstrap Protocol, rules move under `.fabric/agents/` including `_cross/role-balance.md`.
- **Docs**: `docs/initialization.md` adds four chapters — Matcha interaction, confidence tiers, Shadow Mirroring architecture, Client Compatibility & Migration (explicit "Fabric requires an MCP-capable client" matrix). `README.md`, brand/roadmap/quickstart/getting-started/launch-story/contributing/dashboard-tour/smoke-v1.0 and Day-N smoke-test guides localised to zh-CN while preserving English hard-rule tokens.
- Release readiness is now governed by `RELEASING.md`, `scripts/sync-versions.mjs`, and GitHub Actions workflows instead of ad hoc manual checks.

### Deprecated

- `ForensicReport.recommendations_for_skill: string[]` — kept for one version, will be removed in v1.2. Consumers should migrate to `ForensicReport.assertions: ForensicAssertion[]`.
- `<!-- fab:index -->` index markers and `@import` lines inside `AGENTS.md` — Shadow Mirroring resolves rules through `fab_get_rules` instead.

### Migration Notes

- Fabric v1.1 requires an **MCP-capable AI client** (Claude Code, Cursor with MCP, Codex, Gemini CLI). Clients without MCP can no longer see sub-directory rules.
- To migrate a v1.0 repository: move every colocated `packages/X/AGENTS.md` into `.fabric/agents/packages/X/index.md`, delete the original, run `fab sync-meta`, and verify `fab_get_rules` returns the expected rules for each path.

## [1.0.0] - 2026-04-19

### Added

- Published the monorepo under the public `@fenglimg/fabric-*` scope with a unified `1.0.0` version for the root workspace and all release-track packages.
- Standardized package naming for `@fenglimg/fabric-cli`, `@fenglimg/fabric-server`, `@fenglimg/fabric-dashboard`, and `@fenglimg/fabric-shared`, and updated bootstrap templates to stop emitting legacy `@fenglimg/*` references.
- Shipped the Fabric CLI as the canonical maintainer entry point with `fab init`, `fab serve`, `fab scan`, `fab bootstrap`, `fab hooks`, `fab config`, `fab human-lint`, `fab ledger-append`, `fab sync-meta`, and related workflows.
- Added the first public local control-plane loop: install Fabric, initialize a repository, configure clients, start the HTTP control plane, and inspect state through the packaged Dashboard.
- Added the packaged MCP server runtime with stdio and HTTP transports, including the `fab_get_rules`, `fab_append_intent`, and `fab_update_registry` tool surfaces.
- Added the Fabric Dashboard for rules inspection, human lock review, intent timeline playback, history replay, and doctor diagnostics within one local session.
- Added shared type exports for cross-package contracts so CLI, server, and dashboard code can consume one source of truth for config and state structures.
- Added shared i18n infrastructure with locale normalization, Node locale detection, translator creation, protected token handling, and locale bundles for `en` and `zh-CN`.
- Added first-class localized UX across the CLI and Dashboard, including bilingual navigation labels in the Dashboard and locale-aware command descriptions and status output in the CLI.
- Added semantic CLI color utilities aligned with Dashboard brand tokens, plus `NO_COLOR=1` handling and CJK-safe padding for terminal output.
- Added npm-facing onboarding and contributor documentation for the v1.0 product line, including the canonical getting-started path, initialization deep dive, roadmap, and release-sensitive validation notes.
- Added release governance artifacts for public distribution: this changelog, a documented manual release checklist, a workspace version-sync validator, CI automation, tag-driven publish automation, and a post-publish smoke checklist.

### Changed

- Reframed Fabric v1.0 as a publishable public product instead of an internal prototype, with release gates centered on npm installability, scope isolation, and real end-to-end smoke verification.
- Tightened release and distribution expectations so version drift, protected token regressions, and snapshot color noise are checked before a public tag is pushed.

### Fixed

- Removed legacy package scope references that would block npm publication under the `@fenglimg/fabric-*` namespace.
- Closed release-path gaps where version mismatches or undocumented manual steps could have produced an incomplete or non-reproducible v1.0 launch.

[Unreleased]: https://github.com/fenglimg/fabric-v2/compare/v2.0.0-rc.4...HEAD
[2.0.0-rc.4]: https://github.com/fenglimg/fabric-v2/compare/v2.0.0-rc.3...v2.0.0-rc.4
[2.0.0-rc.3]: https://github.com/fenglimg/fabric-v2/compare/v2.0.0-rc.2...v2.0.0-rc.3
[2.0.0-rc.2]: https://github.com/fenglimg/fabric-v2/compare/v2.0.0-rc.1...v2.0.0-rc.2
[2.0.0-rc.1]: https://github.com/fenglimg/fabric-v2/releases/tag/v2.0.0-rc.1
