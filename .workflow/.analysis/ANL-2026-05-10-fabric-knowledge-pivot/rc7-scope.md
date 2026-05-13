# Fabric v2.0.0 — rc.7 Scope Definition

**Source**: `/grill-me` macro-closure session on 2026-05-13
**Parent ANL**: `ANL-2026-05-10-fabric-knowledge-pivot/` (v2.0 design pivot)
**Predecessor**: `rc5-rc6-scope.md` (rc.5 wire/schema cleanup + rc.6 active injection)
**Versioning**: `v2.0.0-rc.7` continuing the existing rc chain → `v2.0.0` stable
**Context**: rc.6 closed the wire/schema/injection layers but left four user-experience perception gaps across the four interaction chains (A 冷启动 / B 归档 / C 消费 / D 维护). This RC closes those macro gaps so a fresh user can experience the full knowledge loop end-to-end.

---

## 1. Why rc.7 exists

8-round /grill-me walk through the design tree uncovered four classes of macro closure problems the rc.5+rc.6 work didn't address:

1. **Cold-start chain (A) perception breaks** — `fabric init` doesn't bridge to fabric-import skill; scan-time entries default broad+[] making PreToolUse hook silent on fresh repos.
2. **Archive chain (B) cross-session drop** — fabric-hint Stop hook fires by cross-session accumulation but archive Skill scope is single-session, so multi-session archive-worthy content silently lost; pending entries don't carry enough context for cross-session review.
3. **Consume chain (C) closure bug** — `fab_plan_context` degenerate mode at ≤30 entries bypasses `knowledge_consumed` event tracking, breaking rc.5 C5 consumption signal; SessionStart hook dumps full broad listing every session causing banner blindness.
4. **Maintenance chain (D) dormancy** — no hook surface recommends running `fabric doctor`; `--apply-lint` lacks safety prompt, so users won't run it confidently.

rc.7 closes all four with 11 concrete items.

---

## 2. rc.7 scope (11 items)

### A. Cold-start chain (3 items)

- **A1 (T1)**: CLI→Skill sentinel hand-off. `fabric init` ends with `clack.confirm` "下次开 AI 时让我从 git log 抽更多知识吗?" → Y writes `.fabric/.import-requested`. `knowledge-hint-broad.cjs` (SessionStart) AND `fabric-hint.cjs` (Stop) read sentinel; if present → recommend `fabric-import` skill regardless of cooldown / underseed-threshold. Skill clears sentinel on completion. Decouples "user installed fabric (terminal)" from "Agent loads import skill (AI client)" across the surface boundary.

- **A2 (T2)**: scan-time narrow path anchoring. Modify scan-builders to differentiate narrow vs broad output per builder type:
  - `tech-stack` → narrow, paths `["package.json", "pnpm-workspace.yaml"]`
  - `module-structure` → narrow, paths `["packages/**/package.json"]`
  - `build-config` → narrow, paths matching tsconfig/vite.config/build script locations
  - `code-style` → narrow, paths `[".prettierrc*", ".editorconfig", "eslint.config.*"]`
  - `CI config` → narrow, paths `[".github/workflows/**"]`
  - `readme-first-paragraph` → broad (single repo-root file by Phase 1.5 blacklist)

  Preserves Q-20 (LLM-import = broad+[]); only scan-time scope is auto-narrowed when path is mechanically known. Fixes PreToolUse silence on fresh repos.

- **A3 (T3)**: `docs/surfaces.md` + README "Three surfaces" section. Three-row table (CLI / Skill / MCP) + one-line decision rule ("does this action need no AI in the loop? → CLI; needs LLM judgment on conversation/code? → Skill; primitive write or query? → MCP"). README inserts compact 5-line version. `fabric init` stdout footer + each SKILL.md top cross-reference the doc. Closes the unstated surface-boundary confusion exposed in Grill #4.

### B. Archive chain (4 items)

- **B1 (T4)**: fabric-hint stderr 人-first banner. Replace existing block reason text with banner-style human-readable message designed for the AI client UI (not Agent jussive). Drop fabricated "3 candidates detected" framing (hook has no content awareness). Include real activity overview from `edit-counter` sidecar: top 2-3 most-edited directories since last archive. Format:
  ```
  📋 Fabric: 距上次归档已过 24h / 累计 22 次编辑。
     最近活动集中在: packages/server/services/ (12 edits), packages/cli/ (8 edits).
     是否调 /fabric-archive 检查值得归档的决策/踩坑/复用?
  ```

- **B2 (T5)**: archive Skill cross-session digest layer. Three sub-components:
  - **Digest writer**: Stop hook (or new SessionEnd hook if Claude Code supports) writes `.fabric/.cache/session-digests/<session_id>.md` per session — top 10 user messages + edit_paths + 1-line task title. Lightweight (~5KB), per-session.
  - **Schema change**: `fab_extract_knowledge` input `source_session: string` → `source_sessions: string[]` (single-string back-compat shim). Generated pending frontmatter `source_sessions: [a, b, c]`.
  - **archive SKILL Phase 0.0**: Before viability gate, read events.jsonl, find all session_ids since last `knowledge_proposed` event, load their digests, build cross-session context for Phase 0.5 + Phase 1.

  Fixes single-session vs cross-session-trigger impedance mismatch.

- **B3 (T6)**: pending entry self-containedness. Three additions:
  - Frontmatter: `proposed_reason: <enum>` (one of: `explicit-user-mark` / `diagnostic-then-fix` / `decision-confirmation` / `wrong-turn-revert` / `new-dependency-or-pattern` / `dismissal-with-reason`)
  - Body: `## Why proposed` (one-line enum explanation)
  - Body: `## Session context` (3-5 lines: session goal + key turning point)
  - `extract-knowledge.ts`: when same idempotency_key arrives, MERGE Evidence call notes rather than appending duplicated bodies (the current sample shows 3× identical "Notes" blocks).

  Makes future-self able to review past-self's pending without conversation transcript access.

- **B4 (T7)**: Hook threshold configuration externalization. Move 3 hardcoded constants in `fabric-hint.cjs` to `.fabric/fabric-config.json`:
  - `THRESHOLD_HOURS` (currently 24) → `archive_hint_hours`
  - `THRESHOLD_PENDING_COUNT` (currently 10) → `review_hint_pending_count`
  - `THRESHOLD_PENDING_AGE_DAYS` (currently 7) → `review_hint_pending_age_days`
  - Add new `maintenance_hint_days` (default 14) + `maintenance_hint_cooldown_days` (default 7) for T10.

  New `docs/configuration.md` enumerates all config fields with small/medium/large repo recommendations.

### C. Consume chain (2 items)

- **C1 (T8)**: SessionStart revision_hash gating + cross-client visibility verification.
  - `.fabric/.cache/sessionstart-last-hash` stores last-emitted revision_hash. SessionStart hook reads it; if matches current revision_hash → silent exit 0 (no re-dump). On any knowledge change → revision_hash differs → emit.
  - Manual verification round in Claude Code / Cursor (with `followup_message` field) / Codex CLI. Document where stderr renders in each UI (`docs/cross-client-visibility.md` with screenshots).

- **C2 (T9)**: Kill `fab_plan_context` degenerate mode.
  - Remove `candidates ≤ 30 → candidates_full_content` branch in `plan-context.ts`. Always return `description_index` + `selection_token`.
  - Update tool-contracts snapshot tests.
  - `docs/decisions/rc5-a3-superseded.md` records rationale: closes `knowledge_consumed` event silent bypass + Agent context economy + API symmetry.
  - Side effect: SessionStart hook's existing footer "Use `fab_get_knowledge_sections` to fetch full content" becomes accurate again (was misleading at ≤30 entries).

### D. Maintenance chain (2 items)

- **D1 (T10)**: fabric-hint Signal D + `doctor_run` event.
  - New event type `doctor_run` with fields `{mode: "lint"|"apply-lint", issues: number, ts}`. Doctor command writes one at end of every run.
  - `fabric-hint.cjs` adds `evaluateMaintenanceSignal()`: trigger when (no doctor_run in events.jsonl for ≥ `maintenance_hint_days` OR ever) AND (canonical node count ≥ 5). Cooldown `maintenance_hint_cooldown_days` (7 by default).
  - Banner text: `📋 Fabric: 已 14 天未跑 lint 检查。调 fabric doctor --lint 看看知识库健康度。`
  - JSON output gains `signal: "maintenance"` and `recommended_skill: null` (this is a CLI recommendation, not a Skill).

- **D2 (T11)**: `--apply-lint` safety. Before mutations, print mutation plan + clack.confirm "About to mutate N frontmatters + git mv M files. Proceed? [y/N]". Default N. Skip via `--yes` flag OR `FABRIC_NONINTERACTIVE=1` env var. Document in `docs/configuration.md`.

---

## 3. Wave ordering (for lite-plan)

**Wave 1 — Foundations (independent, low risk, ~2d)**
- T9 (kill degenerate mode) — early to surface knowledge_consumed gap
- T2 (scan narrow anchors) — builders refactor
- T11 (doctor confirm) — CLI safety
- T7 (thresholds config) — prerequisite for T4 + T10

**Wave 2 — Schema + infra (~3d)**
- T6 (pending self-contained) — new frontmatter fields, T5 depends on it
- T5 (cross-session digest) — depends on T6 (digest writes pending context too); schema source_sessions[]
- T10 (Signal D + doctor_run event) — depends on T7

**Wave 3 — Hook + UX surface (~2d)**
- T4 (hook 人-first banner) — depends on T7 + reads edit-counter
- T8 (SessionStart gating + visibility verify) — independent; visibility verify last
- T1 (init→skill sentinel) — same hook file as T4

**Wave 4 — Docs (~1d)**
- T3 (surfaces.md + README) — last; references all preceding work

**Coverage gate**: `scripts/rc7-coverage-gate.mjs` mirroring rc.5/rc.6 pattern. Cover:
- 3 hook thresholds readable from fabric-config.json
- plan_context never returns candidates_full_content
- sentinel file lifecycle (write/read/clear)
- doctor_run event emission
- --apply-lint exits 1 without --yes on non-tty stdin

---

## 4. Boundary lines (what's in vs out)

**In rc.7:**
- All cold-start hand-off (A1-A3)
- All archive chain perception fixes (B1-B4)
- All consume chain closure fixes (C1-C2)
- All maintenance chain awakening (D1-D2)

**Explicitly deferred to v2.1+ (not in this scope, recorded in `docs/v2.1-roadmap.md`):**
- **Maturity progression mechanism** (Grill #1 — lint #27 `maturity_promote_candidate` + review.modify `maturity_level` field). Reason: only visible after 3-6 months of accumulated consumption signal; RC users won't feel the gap. T6's `proposed_reason` field becomes input signal when this lands.
- **Hook-injection consumption sidecar** (Grill #2 — `.fabric/.cache/consumption-counter.jsonl` + doctor fold into `last_consumed_at`). Reason: T9 killing degenerate mode eliminates the most common silent-bypass path; remaining hook path has limited blast radius until knowledge base scales.
- **Canonical-vs-canonical semantic dedup/contradict** (Grill #3 — doctor lint #28 + fabric-review skill `mode: health`). Reason: 6+ months of canonical accumulation needed before genuine semantic collision frequency justifies LLM scan cost.

**Out of v2.x scope entirely:**
- Memory / CLAUDE.md as cross-session recall mechanism — pending file self-containedness (T6) is the right home; client-private memory is per-machine and conflicts with cross-client positioning.

---

## 5. New event ledger types (rc.7)

| Event | Trigger | Fields |
|---|---|---|
| `doctor_run` | `fabric doctor` completion (both `--lint` and `--apply-lint`) | `mode`, `issues`, `mutations`, `ts` |

No other new event types. T5 reuses existing `knowledge_proposed` for digest scope determination.

---

## 6. Hook signal inventory after rc.7

Existing (rc.5+rc.6):
- Signal A `archive` — 24h since last knowledge_proposed OR 20 edits since last archive
- Signal B `review` — pending count ≥ 10 OR oldest pending mtime ≥ 7 days
- Signal C `import` (underseeded) — canonical nodes < 10 AND 24h post-init cooldown elapsed
- Signal sentinel (NEW via T1) — `.fabric/.import-requested` present → unconditionally recommend import

rc.7 additions:
- Signal D `maintenance` (T10) — no `doctor_run` event in past 14 days AND canonical nodes ≥ 5; cooldown 7 days

Total after rc.7: 5 signals.

---

## 7. Open questions explicitly resolved during 2026-05-13 grill

| # | Question | Resolution |
|---|---|---|
| 1 | Maturity tier promotion mechanism (draft→endorsed→stable)? | Defer to v2.1; record `proposed_reason` (T6) now as future input signal |
| 2 | Hook injection emits `knowledge_consumed`? | Defer; T9 closes the main silent path, hook-injection remainder limited blast |
| 3 | Canonical-vs-canonical semantic dup/contradict scan? | Defer; need ≥6 months accumulation for justification |
| 4 | Should `fabric init` be a Skill? | No — bootstrap paradox + pure deterministic IO; document surface boundary instead (T3) |
| 5 | Default broad for all import + scan, or auto-narrow when path known? | scan auto-narrow (T2); LLM-import stays broad+[] (Q-20 honored for the LLM half only) |
| 6 | "3 candidates" framing in hook stderr — accurate? | NO. Hook has zero content awareness; T4 strips fabrication, keeps activity-only signal |
| 7 | archive Skill scope — current session or cross-session? | Cross-session via T5 digest accumulation |
| 8 | pending entries store enough context for stale review? | NO currently; T6 adds proposed_reason + Session context + Evidence dedup |
| 9 | Cross-session pending memory via Claude Code Memory / CLAUDE.md? | Rejected — per-user per-machine conflicts with cross-client positioning; pending files in git/personal root are correct home |
| 10 | "7d" threshold semantics — since user away or pending mtime? | pending mtime (file age); paired with T6 self-containedness so old pending still actionable |
| 11 | fabric-config.json should support hook timing setup? | YES, T7 — 3 hardcoded thresholds → config + 2 new for T10 + docs/configuration.md |
| 12 | `fab_plan_context` should always return description, never full body? | YES (T9) — degenerate mode breaks consumption signal closure |
| 13 | Hook stderr 第一读者 — Agent or human user? | **Human user**; Agent reads incidentally. T4 banner-style format reflects this |
| 14 | SessionStart dumps full broad list every session — banner blindness? | YES, fix via T8 revision_hash gating |
| 15 | Three-client (Claude/Cursor/Codex) stderr user-visibility verified? | NO currently; T8 includes manual verification round + screenshots |
| 16 | doctor has hook signal recommending it? | NO currently; T10 adds Signal D + doctor_run event |
| 17 | `--apply-lint` has safety prompt before mutation? | NO currently; T11 adds clack.confirm + `--yes` skip flag |

---

## 8. Acceptance walkthrough (fresh repo, run at rc.7 end)

A user with no prior Fabric experience runs:

1. `fabric init` — clack walks through; ends with "下次开 AI 时让我从 git log 抽更多知识吗? [Y/n]" → sentinel written, "下次开 AI 会看到提示"
2. scan completes — 5-6 baseline entries, 4 of them narrow with relevance_paths bound to known config files
3. User opens Claude Code (or Cursor / Codex) — SessionStart hook detects sentinel → stderr banner recommends `/fabric-import`
4. Agent invokes fabric-import Skill — runs git log mining → produces pending entries (broad), each with `## Why proposed` + `## Session context`
5. import Skill end → asks "review now?" → user confirms → fabric-review Skill (mode auto-inferred as `pending`) → batch approve
6. canonical/ grows → revision_hash changes → next session SessionStart shows update banner (NOT full dump)
7. User edits `packages/server/...` → PreToolUse hook hits scan-narrow `tech-stack` or `build-config` entry → stderr injects narrow context
8. After 24h or 20 edits → Stop hook 人-first banner shows activity overview → user invokes `/fabric-archive` → Skill loads cross-session digests since last archive → extracts candidates spanning multiple sessions → pending grows with full session_context
9. After 14 days idle on maintenance → Stop hook Signal D → user runs `fabric doctor --lint` → clean report → tries `fabric doctor --apply-lint` → clack.confirm displays mutation plan → user safely approves

All 9 steps user-perceptible without specialized knowledge of Fabric internals. The four chains (A 冷启动 / B 归档 / C 消费 / D 维护) deliver continuous experience.

---

## 9. Estimated workload

| Wave | Items | Estimate |
|---|---|---|
| 1 — Foundations | T9, T2, T11, T7 | ~2d |
| 2 — Schema + infra | T6, T5, T10 | ~3d |
| 3 — Hook + UX | T4, T8, T1 | ~2d |
| 4 — Docs | T3 | ~1d |
| **Total** | **11 items** | **7.4-8.4d (~1.5-2 weeks)** |

Coverage gate + dogfood validation cycle: +0.5-1d.

Target: v2.0.0-rc.7 ship by end of week +2; if rc.7 dogfood clean → tag v2.0.0 stable.

---

## 10. Implementation handoff

This document is the input to `workflow-lite-plan`. The lite-plan should produce 11 IMPL tasks (T1-T11) grouped into 4 waves, each task with concrete target files, acceptance criteria, and test strategy. Coverage gate script generated as part of T9+T10+T11 (the items touching tested behavior).
