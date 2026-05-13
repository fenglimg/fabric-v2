# Fabric v2.0.0 — rc.5 & rc.6 Scope Definition

**Source**: `/grill-me` follow-up session on 2026-05-12
**Parent ANL**: `ANL-2026-05-10-fabric-knowledge-pivot/` (v2.0 design pivot)
**Versioning**: `v2.0.0-rc.5` … `v2.0.0-rc.N` → `v2.0.0` stable
**Context**: v2.0.0 commit 9356cd3 tagged stable locally but never published (no npm registry release / no public announcement). Per durable user preference (clean-slate while pre-user), the v2.0.0 release line is treated as still in RC pipeline — rc.5+ continues the existing rc.1-rc.4 chain rather than starting a v2.0.1 patch line.

---

## 1. Why rc.5 + rc.6 exist

Post-v2.0 grill uncovered three categories of work the original pivot left unresolved:

1. **v1.x logic still mixed with v2.0 wire** — `fab_get_rule_sections` MCP name, `L0/L1/L2` protocol fields, `intent-ledger` compliance regime, hard-coded Cocos signals, dashboard package, etc.
2. **Functional boundaries fuzzy** — pending root location (team/personal split), stale-pending ownership (hook B / lint #21 / review reject overlap), hook script naming, onboarding underseed signal absent.
3. **Article-vs-Fabric differentiation incomplete** — knowledge consumption tracking absent (article's `last_referenced` loop), no active injection layer (article's workflow-phase injection equivalent), README narrative didn't surface 8 real differentiators.

rc.5 closes (1) + (2) + half of (3) — consumption tracking. rc.6 closes the remaining half — active injection via SessionStart + PreToolUse hooks with path-aware narrow filtering.

---

## 2. rc.5 scope (17 items)

### A. v1.x residue removal (4 items)

- **A1**: Retire `L0/L1/L2` protocol layer. Rename MCP tool `fab_get_rule_sections` → `fab_get_knowledge_sections`. Delete from agents.meta nodes 5 dead fields (`level`, `layer`, `deps`, `topology_type`, `priority`). Drop `selection_policy`, `required_stable_ids`, `ai_selectable_stable_ids`, `initial_selected_stable_ids` from `plan_context` output. Batch-rename server files `rule-*` → `knowledge-*` (rule-meta-builder, rule-sections, rule-sync, get-rules, api/rules*, tools/rule-sections). Rename MCP server name `fabric-context-server` → `fabric-knowledge-server`. Update three Skill templates (fabric-archive/review/import) to use new MCP tool name.

- **A2**: Delete intent-ledger compliance regime (zero adoption signal: 31/31 `audit.jsonl` entries have `matched_get_rules_ts: null`). Remove `services/annotate-intent.ts`, `services/human-lock-or-equivalent.ts`, `services/audit-log.ts`, `api/intent.ts`, `api/events.ts` forensic-loading code path, `.fabric/audit.jsonl` and `.fabric/forensic.json` files. **Keep** `serve-lock`, `in-flight-tracker`, `rehydrate-state`, `read-ledger` — these are server lifecycle infra, not v1.x compliance features. Audit `read-ledger` callers; if only consumed by deleted modules, delete it too.

- **A3**: Plan-context.ts refactor. Strip Cocos hardcoding (`inferDomains` UI/Gameplay/Asset, `tokenizeIntent` 性能/drawcall/卡顿/图集, `inferImpactHints`). Drop `requirement_profile.inferred_domain` and `intent_tokens` and `impact_hints`. Drop `include_deprecated` no-op placeholder. Drop dead L2 branch in `shouldIncludeIndexItemForPath`. Add candidate-count threshold: when description_index ≤ 30 entries, return full content inline (single-stage degenerate mode); when > 30, retain two-stage selection_token + fetch protocol.

- **A4**: Delete physical dead weight. `packages/dashboard/` entire package (v1.x rules-explain SPA, 31 hits of L0/L1/L2/topology in views, zero v2.0 knowledge awareness). `packages/server/src/api/static.ts` + `http.ts` `registerDashboardStatic` wiring + `dashboardDistPath` option. Root `templates/` directory (CLI source has zero references; authoritative copy is `packages/cli/templates/`). Root `思路.md` (AGENTS.md-era pre-pivot concept). `examples/werewolf-minigame-stub/` (v1.x Cocos demo target). `docs/contributing.md` lines referencing dashboard build.

### B. Boundary fixes (4 items)

- **B1**: Dual pending root. `fab_extract_knowledge` writes to `~/.fabric/knowledge/pending/<type>/` when archive Skill classifies layer as `personal`, otherwise `.fabric/knowledge/pending/<type>/`. `fab_review.list` enumerates from both. Approve target = `~/.fabric/knowledge/<type>/` or `.fabric/knowledge/<type>/` per frontmatter layer. `PENDING_BASE` constant in `services/extract-knowledge.ts` becomes a function `pendingBase(layer)`.

- **B2**: Doctor `--apply-lint` adds pending auto-archive. Pending entries (in either root) with mtime > 30 days → `git mv` to `.fabric/.archive/pending/<type>/` (team) or `~/.fabric/.archive/pending/<type>/` (personal). Emit new event `pending_auto_archived` with `pending_path`, `archived_to`, `reason`. Lint check counted as #21 (existing) but with auto-archive action gated to `--apply-lint`.

- **B3**: `fabric-hint.cjs` (renamed from `archive-hint.cjs`) adds Signal C: `nodes < 10 AND time_since_last_fabric_init >= 24h AND no knowledge_proposed event in last 24h` → recommend `fabric-import` skill. Threshold tunable via `fabric-config.json` field `underseed_node_threshold` (default 10). New lint check #22 `underseeded`. Output JSON gains `recommended_skill` field (values: `fabric-archive` / `fabric-review` / `fabric-import`).

- **B4**: Complete cross-client hook configs. `packages/cli/templates/hooks/configs/codex-hooks.json` and `cursor-hooks.json` currently empty/missing → fill with valid Stop hook + (later, rc.6) SessionStart + PreToolUse hook registrations. CLI `fabric hooks install` validates all three clients can resolve hook paths.

### C. narrow schema + consumption (7 items)

- **C1**: Frontmatter schema additions. New fields `relevance_scope: "narrow" | "broad"` and `relevance_paths: string[]`. agents.meta node schema mirrors. `rule-meta-builder.ts` frontmatter parser recognizes both fields. Default if absent = `broad` + `[]` (graceful for existing 16 entries).

- **C2**: archive Skill update. Add **Phase 0.5 viability gate** before Phase 1: scan user_messages_summary + recent_paths against archive-signal list (≥1 of: "always/never" / "记一下" / "下次注意" / wrong-turn-and-revert / >15min diagnostic / new dependency-or-pattern / decision confirmation / explicit dismissal-with-reason). If none hit → Stop Skill with "本次会话为常规执行，无新知识可归档" message and escape clue. Anti-archive signals (typo-only / pure-refactor / narrow-rename-request / duplicate-of-existing) also checked. User-explicit invocation bypasses gate. Add **Phase 1.5 subjective scope decision**: rule block in SKILL.md tells Agent how to choose narrow vs broad (default broad, narrow requires explicit single-module evidence). User can inline-edit `[scope=...]` during Phase 1 review. **edit_paths single-signal generation of relevance_paths**: scan transcript for `tool_use.name ∈ {Edit, Write, MultiEdit}`, dedupe paths, public-prefix generalize with depth ≤ 2 and minGroupSize=2, apply glob blacklist (`**/*.<ext>`, repo-root single files like `README.md`/`package.json`). Read-only paths go to markdown `## Evidence` block, never to `relevance_paths`.

- **C3**: `plan_context` filter logic. Returns `broad` entries unconditionally + `narrow` entries whose `relevance_paths` any glob matches the input path. When no path arg, returns all (broad + narrow). `fab_review.modify` action extended to canonical entries (not only pending) with explicit support for `relevance_paths` / `relevance_scope` changes. Detect layer flip in modify: if `narrow team → personal` → auto-degrade scope to `broad`, clear `relevance_paths`, emit `knowledge_scope_degraded` event with `reason: "personal-implies-broad"`.

- **C4**: Doctor lint additions (3 new checks).
  - **#23 `narrow_no_paths`**: narrow entries with `relevance_paths: []` → warning only.
  - **#24 `relevance_paths_dangling`**: expand each glob via fast-glob, count matches. Dangling glob = zero matches. `--apply-lint` removes glob; if entry's `relevance_paths` becomes empty, auto-degrade scope narrow→broad. Emit `knowledge_path_dangled` event + (when triggered) `knowledge_scope_degraded` event.
  - **#25 `relevance_paths_drift`**: `git log --diff-filter=R --name-status --since="30 days ago"` finds renames; cross-reference against narrow `relevance_paths`. Report only (rename heuristic too noisy for auto-mutation). Suggests `fab_review.modify` invocation in report text.

- **C5**: Consumption signal closure. `fab_get_knowledge_sections` service writes `knowledge_consumed` event per call (one event per fetched stable_id, dedupe within same request). Event fields: `stable_id`, `session_id`, `client_hash`, `consumed_at`. `last_consumed_at` derived state computed by replaying events.jsonl. Lint orphan_demote (existing #16) switches from `last_referenced` to `last_consumed_at` as decay signal.

- **C6**: fabric-hint Signal A. Currently `5 plan_context OR 24h`. rc.5 changes to **pure 24h since last knowledge_proposed event** (drop plan_context count entirely — auto-fired by future hooks makes count unreliable; Edit count requires transcript scan or sidecar, deferred to rc.6 when PreToolUse hook produces sidecar naturally).

- **C7**: `computeRevision` schema fix in `rule-meta-builder.ts:640`. Current implementation includes `pending/` directory nodes in revision hash (line 309 `KNOWLEDGE_SUBDIRS` literal). rc.5 excludes pending from revision computation: revision_hash = sha256 of sorted canonical nodes only. Pending additions/modifications no longer perturb revision_hash. Required for rc.6 cache invalidation correctness.

### D. CLI + documentation (2 items)

- **D1**: New CLI subcommand `fabric plan-context-hint --paths <p1,p2,...> | --all`. Thin wrapper that imports `planContext()` from server. Outputs **structured JSON to stdout** (versioned schema: `{version: 1, revision_hash, target_paths, narrow: [...], broad_count}`). Stderr empty (renderer is hook's job). Used by rc.6 hooks; in rc.5 only the CLI subcommand ships, no hook consumers yet. fabric-import skill consumes JSON for default-broad pending creation (per Q-1 resolution: import produces `relevance_scope: broad, relevance_paths: []`, narrowing deferred to review).

- **D2**: README "Why Fabric" rewrite. Section structure:
  - Pain point opening (cross-client knowledge sustainment)
  - **8 真特色 enumeration**: cross-client MCP-first / harness-agnostic / two-stage cold-start / async-review primitive / path-decoupled stable_id + layer-flip audit / cross-client hook reminder layer / doctor unified lifecycle engine / filesystem-edit fallback
  - **4 deliberately not done**: 5-layer storage (we do 2) / independent team-knowledge.git repo (v2.1) / 16-stage workflow injection (we're harness-agnostic) / remote control (IDE infra problem)
  - MCP vs CLI adapter clarification: `planContext()` is the engine, MCP and CLI are adapters for different callers (Agent vs hook scripts) — not redundancy
  - Position vs the Tencent article: shared genes (5 types, 3 maturity, lint discipline), distinct architecture (harness-agnostic, MCP-first, in-repo + personal dual root)

---

## 3. rc.6 scope (6 items)

- **E1**: SessionStart hook `knowledge-hint-broad.cjs`. Invokes `fabric plan-context-hint --all`, parses stdout JSON, renders human-readable summary to stderr. ≤30 entries → full listing (one line per entry, grouped by type). >30 entries → grouped truncation (per type: list `proven` headers + `verified` id list + `draft` count only). Renders for SessionStart event across Claude Code / Cursor / Codex.

- **E2**: PreToolUse hook `knowledge-hint-narrow.cjs`. Triggers on `Edit`, `Write`, `MultiEdit` tool calls. Reads `tool_input.file_path` (or `tool_input.edits[].file_path` for MultiEdit, deduplicated). Invokes `fabric plan-context-hint --paths <path>`, parses JSON. Output rule:
  - narrow match count > 0 → emit titles list + one-line footer `(如需重读 broad 决策，调 fab_plan_context 或 fabric plan-context-hint --all)`. No broad ID enumeration in footer.
  - narrow match count = 0 → complete silence (exit 0, no stderr output).

- **E3**: Session-hints cache `.fabric/.cache/session-hints-{session_id}.json`. Keyed by `(revision_hash, path)`. Tracks: `hinted_paths` (set of paths already emitted in this session), `last_emitted_index_hash` (sha256 of last emitted description_index subset). PreToolUse skips if path already hinted OR if matched-narrow index hash matches last emission. Cache invalidated wholesale when `revision_hash` changes (rc.5 C7 ensures pending changes don't invalidate spuriously). Cleanup: session-hints files older than 7 days deleted by doctor on next run.

- **E4**: PreToolUse hook side-effect: append timestamp to `.fabric/.cache/edit-counter` per invocation (one line per Edit/Write/MultiEdit). Sidecar file purpose = cross-client edit count source.

- **E5**: fabric-hint Signal A upgrade. Reads `.fabric/.cache/edit-counter`, counts lines since last `knowledge_proposed` event ts. Trigger condition: **20 lines OR 24h elapsed since last knowledge_proposed event**, whichever first. Threshold `archive_edit_threshold` configurable in fabric-config.json.

- **E6**: New lint check #26 `narrow_too_few`. If `count(narrow_with_paths) / count(total) < 0.20` AND total ≥ 10 → report "narrow ratio degraded, consider re-running fabric-import for path-binding refresh". Hint-silence-counter telemetry: PreToolUse hook increments counter when matched-narrow = 0; if silence rate > 95% for 30 days, doctor reports same recommendation.

---

## 4. Boundary lines (what's in vs out)

**In rc.5:**
- All wire/schema/file rename (A1-A4)
- All boundary fixes (B1-B4)
- All narrow schema + lint + consumption tracking (C1-C7)
- CLI subcommand `plan-context-hint` and README rewrite (D1-D2)

**In rc.6:**
- Active injection layer (SessionStart + PreToolUse hooks)
- Edit-counter sidecar + Signal A upgrade
- KB health lint #26 + silence telemetry

**Deferred to rc.7+ (not in this scope):**
- Symbol-based binding (`relevance_symbols`) as second axis to `relevance_paths`
- Tag-based binding for path-resistant association
- body_referenced_paths as secondary signal in archive Skill
- LLM-driven monthly relevance_paths refresh in doctor

**Deferred to v2.1+ (not in this scope):**
- Independent team-knowledge.git repository
- 3-role permission model (maintainer / contributor / reader)
- Cross-team knowledge federation

**Out of Fabric scope entirely:**
- 5-layer storage taxonomy (rejected as non-moat; Fabric stays 2-layer)
- 16-stage workflow state machine (Fabric is harness-agnostic)
- Remote control / cross-device handoff (IDE / harness vendor problem)

---

## 5. New event ledger types (rc.5)

| Event | Trigger | Fields |
|---|---|---|
| `knowledge_consumed` | `fab_get_knowledge_sections` per stable_id fetched | `stable_id`, `session_id`, `client_hash`, `consumed_at` |
| `pending_auto_archived` | doctor `--apply-lint` #21 pending >30d | `pending_path`, `archived_to`, `reason` |
| `knowledge_path_dangled` | doctor `--apply-lint` #24 glob expansion empty | `stable_id`, `removed_glob` |
| `knowledge_scope_degraded` | doctor #24 all paths dangling, OR `fab_review.modify` layer flip | `stable_id`, `from_scope`, `to_scope`, `reason` |

No new event types in rc.6.

---

## 6. Lint check inventory after rc.5+rc.6

Existing (rc.4): #1-#21 (21 checks)

rc.5 additions:
- #22 `underseeded` (Signal C source)
- #23 `narrow_no_paths` (warning)
- #24 `relevance_paths_dangling` (auto-degrade with --apply-lint)
- #25 `relevance_paths_drift` (report only)

rc.6 additions:
- #26 `narrow_too_few` (KB health)

Total after rc.6: 26 lint checks.

---

## 7. Open questions explicitly resolved during 2026-05-12 grill

| # | Question | Resolution |
|---|---|---|
| 1 | L0/L1/L2 layer protocol — keep or retire? | Retire (data has collapsed to all L1; selection_policy is dead protocol) |
| 2 | Intent-ledger compliance regime fate? | Delete; zero adoption (31/31 audit entries unmatched); keep only server lifecycle infra |
| 3 | plan-context Cocos hardcoding? | Delete inferDomains / tokenizeIntent / inferImpactHints |
| 4 | dashboard package fate? | Delete entirely; v2.0 narrative has no UI |
| 5 | Pending root location? | Dual root by layer; personal pending in `~/.fabric/`, team in repo `.fabric/` |
| 6 | Stale pending ownership? | doctor `--apply-lint` auto-archives >30d to `.archive/pending/` |
| 7 | Onboarding signal? | Hook Signal C; lint #22; both gated by 24h post-init cooldown |
| 8 | Hook script naming? | `archive-hint.cjs` → `fabric-hint.cjs`, structured JSON output |
| 9 | fab_plan_context vs CLI hint redundancy? | Same engine (`planContext()`), different adapters (MCP for Agent, CLI for hooks) |
| 10 | MCP→CLI replacement viable? | No — MCP-first is differentiation; CLI fills hook gap |
| 11 | archive trigger signal? | 24h time-only in rc.5; upgrades to 24h OR 20 edits in rc.6 |
| 12 | PreToolUse output format? | narrow titles + one-line footer; silent on zero match |
| 13 | narrow ↔ file association mechanism? | Single signal: edit_paths from session transcript; public-prefix generalized |
| 14 | scope determination algorithm? | Agent subjective via SKILL Phase 1.5 rules; default broad |
| 15 | layer flip vs scope coupling? | narrow team → personal flip auto-degrades scope to broad |
| 16 | CLI hint output schema? | Versioned JSON to stdout; hook renders stderr |
| 17 | revision_hash include pending? | No — `computeRevision` rc.5 fix excludes pending dir |
| 18 | viability gate false-negative escape? | User-explicit invocation bypasses gate; gate emits explanation message |
| 19 | Edit count cross-client source? | rc.5 skips Edit count (24h only); rc.6 uses PreToolUse sidecar |
| 20 | fabric-import path generation? | All imports produce broad + empty paths; narrowing deferred to review |
| 21 | Version naming convention? | `v2.0.0-rc.5..N` continuation → `v2.0.0` stable (v2.0.0 never published) |
| 22 | Signal C fires immediately after init? | Add 24h cooldown after fabric init |

---

## 8. Implementation ordering hint for lite-plan

Suggested wave structure (lite-plan will refine):

**Wave 1 — Foundations (no behavior change visible to Agent yet)**
- A2 (intent-ledger removal) → independent, low risk
- A4 (physical residue deletion) → independent, low risk
- C7 (`computeRevision` exclude pending) → required for rc.6 cache correctness
- D1 (CLI `plan-context-hint`) → infrastructure, used by later items

**Wave 2 — Wire + schema (breaking)**
- A1 (L0/L1/L2 retire + tool/file rename) → coordinate with Skill template updates
- C1 (frontmatter `relevance_scope` + `relevance_paths`)
- A3 (plan-context refactor + ≤30 degenerate mode)

**Wave 3 — Boundaries + lifecycle**
- B1 (dual pending root) → depends on C1
- B2 (pending auto-archive) → depends on B1
- B3 + B4 (Signal C + hook configs) → mostly independent
- C2 (archive Skill: viability gate + scope rule + edit_paths generation) → depends on C1
- C3 (plan_context filter + modify layer-flip) → depends on C1
- C4 (lint #23-#25) → depends on C1 + C3
- C5 (consumed event) → depends on A1 rename (knowledge_sections naming)
- C6 (Signal A 24h-only) → independent

**Wave 4 — Docs**
- D2 (README rewrite) → last; references everything

**Coverage gate**: Add `scripts/rc5-coverage-gate.mjs` mirroring rc.4 pattern.

rc.6 ordering: E1 first (SessionStart needs no edit-counter), then E4+E2 together (sidecar + PreToolUse), then E5 (Signal A upgrade), then E3 (cache), then E6 (lint #26 + telemetry).
