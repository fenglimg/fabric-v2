---
name: fabric-import
description: Cold-start enrich .fabric/knowledge/ from project git log + docs/*.md as broad+[] pending entries (NOT for code/data/module import). Trigger on 导入历史/bootstrap fabric/mine changelog/import knowledge from git/挖掘 commit/挖掘文档.
allowed-tools: Read, Glob, Grep, Bash, mcp__fabric__fab_extract_knowledge, mcp__fabric__fab_review
---

> **Surface**: This is a Skill (AI-driven, LLM judgment over git log + docs for cold-start enrichment). See [`docs/surfaces.md`](https://github.com/fenglimg/fabric/blob/main/docs/surfaces.md) for the CLI / Skill / MCP boundary.

## Purpose

`fabric-import` is a one-time (per project) cold-start skill that lifts existing project artifacts — git commit history and Markdown documentation — into the knowledge layer as pending entries. It is the bridge between a brand-new Fabric installation (which only has the 4–7 baseline entries produced by `fabric install`'s deterministic scan) and a useful corpus that reflects accumulated team thinking. Run it once when adopting Fabric on an existing repo, or after a major refactor that invalidates large chunks of canonical knowledge. Default layer is `team`: project artifacts in git/docs are team-shared by definition; the user can later layer-flip individual entries to `personal` via `fabric-review` modify.

## Precondition

This skill is invoked when one of the following holds:

- The user typed an explicit import request (e.g. "import knowledge from git history", "bootstrap fabric for this repo", "mine the changelog into pending", "fabric import")
- The user explicitly mentioned this skill by name (`fabric-import`)
- A `fabric import` CLI command was run (rc.4 wires this if shipped; otherwise treat as user prompt)

If none of the above hold, stop the skill immediately and tell the user:

- zh-CN: `没有触发 import 信号；如需手动 import 请显式调用 fabric-import`
- en: `No import signal detected; to manually import, explicitly invoke fabric-import`

(Render per `fabric_language` resolved in Phase 0.5 Config Load below — class 2 of the UX i18n Policy.)

> **Recommendation source (rc.8+)**: 过去版本的 `.fabric/.import-requested` sentinel 机制已下线；推荐由 SessionStart hook 的 underseed 自检触发（`templates/hooks/knowledge-hint-broad.cjs` 的 `shouldRecommendImport()`：`agents.meta.json` 存在 + canonical 节点数 < `underseed_node_threshold` + `.import-state.json` 缺失三条件齐备时一次性提示）。本 skill 不再读写 sentinel 文件，也不需要在 Phase 3 完成时手动清理它。

This skill SHOULD be skipped (warn the user, do not proceed) when:

- `.fabric/` does not exist — direct the user to run `fabric install` first; `fabric-import` is NOT a substitute for the deterministic install-scan
- `.fabric/knowledge/` already holds **>`import_skip_canonical_threshold` canonical entries (config-resolved, default 50)** across all types — the project is mature; use `fabric-archive` (per-session capture) and `fabric-review` (lifecycle review) instead; bulk import would just create dup churn
- `.fabric/.import-state.json` exists with `phase: "complete"` and `last_checkpoint_at` is **<24h ago** — the user just ran import; surface the prior result rather than re-running

Required preconditions before any MCP call:

- `.fabric/` directory exists in the project root
- `.fabric/agents.meta.json` is present (init produced it; the id allocator reads it on later approve)
- `.fabric/events.jsonl` exists (tolerate ENOENT — empty ledger is normal first-run)
- `mcp__fabric__fab_extract_knowledge` AND `mcp__fabric__fab_review` MCP tools are registered and reachable
- Working tree is reasonably clean (large uncommitted churn pollutes git-log mining; warn but allow)

### Phase 0 — Init (state-recovery ref-only)

On invocation: read/initialize `.fabric/.import-state.json` (resumable phase tracker — see Checkpoint Logic section below for schema). Scan workspace for stale `.tmp-import-*` residues (`.fabric/.import-state.json.tmp-*`). For details on the .tmp scan + state corruption recovery (rare — only triggers when a prior import crashed mid-phase), `Read packages/cli/templates/skills/fabric-import/ref/state-recovery.md` (or `.claude/skills/fabric-import/ref/state-recovery.md` post-install).

### Phase 0.5 — Config Load

Before any Phase 1 work, the skill MUST read `.fabric/fabric-config.json`
to resolve the following tunables (with documented defaults if absent):

| Config field | Default | Used by |
|---|---|---|
| `import_window_first_run_months` | 60 | Step 2.1 (--since arg construction, first-run window) |
| `import_window_rerun_months` | 2 | Step 2.1 (--since arg construction, re-run window) |
| `import_max_pending_per_run` | 10 | Step 2.1/2.2 hard cap on new pending entries per run |
| `import_max_commits_scan` | 500 | Step 2.1 `-n` arg (commit-scan budget) |
| `import_skip_canonical_threshold` | 50 | Precondition skip gate (canonical-entry maturity check) |

If `.fabric/fabric-config.json` is missing or unreadable, use defaults silently.
Whether the run is "first-run" vs "re-run" is decided by inspecting
`.fabric/.import-state.json`: ENOENT (or any state with `phase != "complete"`
and `final_summary.proposed == 0`) → first-run window; otherwise re-run window.

### UX i18n Policy

Read `.fabric/fabric-config.json` → `fabric_language` (`zh-CN` / `en` / `zh-CN-hybrid` / `match-existing`). Emit user-facing prose in the resolved variant. Protected tokens (`fab_extract_knowledge`, `fab_review`, `.fabric/.import-state.json`, schema/scope/layer enum values) are NEVER translated.

`AskUserQuestion` policy: `header` + `question` translate; `options[]` are routing keys — stay English regardless of locale.

**For the full 5-class taxonomy + edge cases:** `Read packages/cli/templates/skills/fabric-import/ref/i18n-policy.md` (or `.claude/skills/fabric-import/ref/i18n-policy.md` post-install).

## 3-Phase Pipeline (P1 reference / P2 mine / P3 dedup)

The pipeline runs strictly in order. Each phase reads the prior phase's outputs and updates `.fabric/.import-state.json` after every successful sub-step (not just at phase end). The skill is `Infer-not-Ask` for which phase to run (always all three when starting fresh, or resumes from the checkpoint phase).

### Phase 1 — Init-Scan Reference (NO RE-IMPLEMENTATION)

> Verbatim boundary: `fabric install` (v2.0+, deterministic CLI) already produces the baseline scan. Phase 1 of this skill **REFERENCES** that output. It does NOT redo the scan.

The deterministic init-scan has already populated `.fabric/knowledge/team/` with 4–7 baseline entries derived from:

- `package.json` (tech stack, scripts, key dependencies)
- `README.md` first paragraph (project elevator pitch)
- Build configuration (`tsconfig.json`, `pyproject.toml`, `Cargo.toml`, etc.)
- Code style (`.editorconfig`, lint config)
- CI configuration (`.github/workflows/`, `.gitlab-ci.yml`, etc.) when present
- The first sentence of any top-level `LICENSE` (rare baseline signal)

Phase 1 actions performed by THIS skill:

1. Read `.fabric/agents.meta.json` to confirm baseline counters exist (each type's `next_id` should be `>1` if init-scan landed entries; `=1` means init produced zero entries of that type — informational, not an error).
2. Glob `.fabric/knowledge/team/**/*.md` to enumerate baseline entry titles. Capture the list — Phase 2 uses these titles as a **negative filter** (signals already covered by init-scan should be skipped, not re-proposed).
3. If `.fabric/agents.meta.json` is missing OR `.fabric/knowledge/team/` is empty: STOP. Tell the user (UX i18n Policy class 2 — errors/preconditions):

   - zh-CN: `请先运行 fabric install 完成基线扫描，再调用 fabric-import`
   - en: `Please run fabric install first to complete the baseline scan, then invoke fabric-import`

   …and exit.
4. Update `.fabric/.import-state.json`: `phase = "P1-done"`, `p1_baseline_titles = [<list>]`, `last_checkpoint_at = <ISO8601 now>`.

**Phase 1 produces no MCP calls.** It only reads the on-disk init-scan output.

### Phase 2 — LLM-Driven Git + Doc Mining

For each candidate signal mined from git or docs, the skill classifies into one of the 5 types (`decisions / pitfalls / guidelines / models / processes`), drafts a slug per the 5-rule naming guideline (see fabric-archive for the canonical rules), and proposes a pending entry via `fab_extract_knowledge`. Default layer for every Phase 2 proposal: `team`.

#### Mandatory Scope Rule — Always Broad + Empty Paths (Q-1 Resolution)

**EVERY `fab_extract_knowledge` call issued from this skill MUST set:**

- `relevance_scope = "broad"`
- `relevance_paths = []`

This is non-negotiable. Applies to BOTH Step 2.1 (git mining) AND Step 2.2 (docs mining). No exceptions, no per-candidate override, no Agent judgment.

**Why broad-only:** fabric-import is LLM-driven (mines git/docs), not session-driven. Git's touched-files list is the commit's effect-surface, not the observation's applicability-surface; LLM-inferred narrow bindings produce false-narrow that silently hides knowledge. Doc observations are usually cross-cutting. Narrowing of imported entries is deferred to `fab_review.modify` (user decision, post-import).

For the full rationale + strict prohibitions list + fabric-archive cross-reference + post-import narrowing path + doctor lint #23 backstop, `Read packages/cli/templates/skills/fabric-import/ref/phase-2-mining.md` (or `.claude/skills/fabric-import/ref/phase-2-mining.md` post-install) §"Mandatory Scope Rule".

#### Step 2.1 — Git Log Mining (summary)

Run `git log --since="<window> months ago" --pretty=format:"%H%n%s%n%b%n---ENDCOMMIT---" -n <commits-cap>` (window/cap from Phase 0.5 config). For each commit: inspect conventional-commit prefix → infer type signal (feat→decision/model, fix→pitfall, refactor→decision, docs→guideline; chore/test/ci usually skip) → read body → extract core observation → apply Skip Decision Tree → classify type/slug/summary → call `fab_extract_knowledge` with broad+[] scope. Hard cap: `import_max_pending_per_run` (default 10) per run.

#### Step 2.1.5 — Proposed Reason Inference

Infer one of 6 enum values: `decision-confirmation` | `new-dependency-or-pattern` | `wrong-turn-revert` | `diagnostic-then-fix` | `explicit-user-mark` | `dismissal-with-reason`. Fallback: `new-dependency-or-pattern`. Full source-signal × body-cue mapping table in ref.

#### Step 2.2 — Docs Mining (summary)

`find docs/ -maxdepth 3 -name '*.md'` + root `*.md`. Skip README.md / CHANGELOG.md / LICENSE.md / CODE_OF_CONDUCT.md / CONTRIBUTING.md / files <300 bytes. Identify decision/guideline/pitfall/process/model heading patterns. Same `fab_extract_knowledge` call shape as Step 2.1. Cap shared with Step 2.1.

#### Skip Decision Tree

Skip if: cosmetic-only, metadata-only body, already in init-scan baseline, not classifiable to 5 types, or slug not derivable to 2-5 kebab words. Otherwise propose.

#### Dry-Run Mode

`dry-run` / `预览` / `--dry-run` keyword → skip MCP calls, render bilingual preview table instead. Every row Scope column shows `broad+[]` (constant for fabric-import). State file NOT written. Phase 3 also skipped.

For full Step 2.1 MCP call shape (all rc.7/rc.23 fields), the Step 2.1.5 inference table (11 rows), bilingual dry-run templates (zh-CN + en), and T5 array-form idempotency notes, `Read packages/cli/templates/skills/fabric-import/ref/phase-2-mining.md` (or `.claude/skills/fabric-import/ref/phase-2-mining.md` post-install).

### Phase 3 — LLM-Driven Dedup vs Canonical

For each pending entry created in Phase 2, check if it duplicates / contradicts / is subsumed by an existing canonical entry. **Semantic comparison is the LLM's job — `fab_review` does not compare meaning.**

**4-step summary:**

1. **Step 3.1** — `fab_review action="search"` filtered by `type`, cap top 5 canonical results.
2. **Step 3.2** — LLM classifies each (pending, canonical) pair: `duplicate` (reject pending) | `subsumption` (reject pending) | `subsumption-with-novelty` (modify canonical + reject pending) | `contradiction` (leave + flag) | `genuinely-new` (keep).
3. **Step 3.3** — Issue `fab_review` reject / modify MCP calls per classification.
4. **Step 3.4** — Update state to `phase="complete"` + write `final_summary`. Render roll-up.

For full Step 3.1/3.3 MCP call shapes, the 5-way semantic compare classification with action-per-case, and the rc.8 sentinel-removal note, `Read packages/cli/templates/skills/fabric-import/ref/phase-3-dedup.md` (or `.claude/skills/fabric-import/ref/phase-3-dedup.md` post-install).

## Checkpoint Logic — `.fabric/.import-state.json`

State file `.fabric/.import-state.json` is the single source of resumability. Every write uses the 2-step atomic pattern: **Step A** `Write` to `.fabric/.import-state.json.tmp` → **Step B** `Bash: mv .tmp` to commit. POSIX `rename(2)` guarantees atomicity. `Write` alone is NOT atomic.

Resume contract: re-invoking fabric-import after ANY interruption (Ctrl-C, crash, MCP network blip) MUST NOT propose duplicates and MUST NOT redo completed dedup. Resume per `phase` field: `P1-done` → resume Phase 2.1; `P2-done` → resume Phase 3.1; `complete` AND <24h → skip; ≥24h → confirm with user.

For the full Atomic State Write rationale + crash-safety reasoning, the events.jsonl 4KB POSIX atomicity constraint (single-line + self-truncate rules), the complete `.import-state.json` JSON schema, and the 6-step Resume Logic state machine, `Read packages/cli/templates/skills/fabric-import/ref/checkpoint-state.md` (or `.claude/skills/fabric-import/ref/checkpoint-state.md` post-install).

## Default Behavior & Knobs

| Knob                                | Default     | Override                                                       |
|-------------------------------------|-------------|----------------------------------------------------------------|
| Layer for new entries               | `team`      | User explicit instruction ("import these as personal")         |
| `relevance_scope` for new entries   | `broad`     | NONE — contract-locked; narrowing deferred to `fab_review.modify` post-import |
| `relevance_paths` for new entries   | `[]`        | NONE — contract-locked; populating deferred to `fab_review.modify` post-import |
| Max new pending entries per P2 run  | config-resolved (default 10, max 50) | `import_max_pending_per_run` in `.fabric/fabric-config.json`; user explicit ("import up to 25") |
| Git log window                      | config-resolved (default 60 first-run / 2 re-run, months) | `import_window_first_run_months` / `import_window_rerun_months`; user explicit ("import the full year") |
| Git log commit-scan cap             | config-resolved (default 500)        | `import_max_commits_scan` in `.fabric/fabric-config.json`      |
| Skip-import canonical threshold     | config-resolved (default 50)         | `import_skip_canonical_threshold` in `.fabric/fabric-config.json` |
| Docs scan depth                     | `3`         | User explicit ("scan docs/ recursively")                       |
| Dry-run mode                        | OFF         | User keyword `dry-run` / `预览` / `--dry-run`                  |
| Re-run within 24h of complete       | BLOCKED     | User keyword `re-run import` / `reset import`                  |

## Hard Rules — DISPLAY / WRITE Split

### DISPLAY Rules

- MUST present every proposed pending entry with explicit `[type=...]`, `[layer=team]`, `[scope=broad]`, `slug=...`, AND `src=<commit-sha7 or doc-path>` so the user can audit the provenance and the (constant) scope.
- MUST display zh-CN body for proposed summaries (M3 style consistent with fabric-archive / fabric-review).
- MUST display EN section headings.
- MUST surface the resolved `pending_path` returned by `fab_extract_knowledge` in the per-entry display block.
- MUST display the final roll-up with proposed / kept / rejected_dup / merged / contradictions_flagged counts.
- MUST display the `.fabric/.import-state.json` `phase` value when the skill exits (so the user knows whether re-invocation is required).
- NEVER hide the source signal; provenance is the only audit trail for bulk-imported entries.
- NEVER classify a Phase 2 candidate as `personal` automatically — default `team` is contract-locked; only flip layer at the user's explicit instruction (and even then, do it post-import via fabric-review).
- NEVER show raw `idempotency_key` to the user (internal server-side concern).

### WRITE Rules

- NEVER write a knowledge entry directly via `Edit` / `Write` / `Bash`; the only legal write paths are `mcp__fabric__fab_extract_knowledge` (Phase 2) and `mcp__fabric__fab_review` (Phase 3).
- NEVER batch multiple Phase 2 candidates into a single `fab_extract_knowledge` call; one call per candidate.
- NEVER skip the Phase 1 reference step — even if init-scan landed zero entries, the skill MUST verify `.fabric/agents.meta.json` is present.
- NEVER call `fab_review action="approve"` from this skill — promotion of pending → canonical is `fabric-review`'s concern, not import's. Imported entries land in `pending/` and wait for normal review flow.
- NEVER call `git mv` directly — layer flips during Phase 3 dedup go through `fab_review action="modify"` with `changes.layer`, which is a server-side transaction.
- NEVER infer a layer-flip target without explicit user instruction — fabric-import defaults `team`; if the user later wants `personal` for an entry, that's a `fabric-review` modify call, not an import-time decision.
- NEVER overwrite `.fabric/.import-state.json` non-atomically — use the 2-step `.tmp` + `mv` pattern documented in "Atomic State Write" under Checkpoint Logic (Step A: `Write` to `.fabric/.import-state.json.tmp`; Step B: `Bash: mv` to commit).
- NEVER exceed the 10-entry-per-run hard cap without explicit user override.
- NEVER pass `relevance_scope = "narrow"` to `fab_extract_knowledge` — every call from this skill MUST use `relevance_scope: "broad"`. No heuristic, no Agent judgment, no per-candidate override (see "Mandatory Scope Rule" in Phase 2).
- NEVER populate `relevance_paths` with a non-empty array on import — every call from this skill MUST pass `relevance_paths: []`. Do not derive paths from `git log --name-only`, `git show --stat`, commit subjects/bodies, or the path of a mined Markdown file.
- NEVER copy fabric-archive's Phase 1.5 scope-decision logic (narrow-vs-broad rules, public-prefix generalization, glob blacklist) into this skill — that logic requires a live `edit_paths` signal from an active session, which fabric-import does not have.
- Narrowing of imported entries happens out-of-band through `fab_review action="modify"` (issued by user via `fabric-review`), NOT inside this skill.
- MUST preserve protected tokens exactly: `stable_id`, `pending_path`, `layer`, `team`, `personal`, `knowledge_proposed`, `fab_extract_knowledge`, `fab_review`, `MUST`, `NEVER`, `phase`, `.import-state.json`, `relevance_scope`, `relevance_paths`, `broad`, `narrow`, `source_sessions`, `proposed_reason`, `session_context`, `intent_clues`, `tech_stack`, `impact`, `must_read_if`.

## Output Contract

After Phase 3 completes (or on any phase exit due to cap / error / interrupt), the skill MUST produce a roll-up. UX i18n Policy class 1 — render either en or zh-CN variant per `fabric_language`. Section names: `Phase 2 — Mining` (commits scanned / docs scanned / pending proposed / scope confirmation), `Phase 3 — Dedup` (kept / rejected_dup / modified-then-rejected / contradictions_flagged), `State` (phase + last_checkpoint_at), `Next Steps` (fabric-review for kept entries; manual resolve for contradictions; narrowing via `fab_review action="modify"`).

For the full bilingual roll-up templates (zh-CN + en) with all section/field placeholders, `Read packages/cli/templates/skills/fabric-import/ref/output-contract.md` (or `.claude/skills/fabric-import/ref/output-contract.md` post-install).

Also surface a one-line `git status` of `.fabric/knowledge/` so the user sees the new pending files appear (and any canonical files modified by dedup-merge).

## Worked Examples

Four end-to-end examples — (A) feat commit → pitfall entry showing broad+[] discipline and the "WRONG" counter-example; (B) docs/architecture.md → decision entry; (C) Phase 3 dedup finds duplicate → reject MCP call; (D) post-import narrowing via `fab_review.modify` (out-of-band, NOT this skill) — live in `packages/cli/templates/skills/fabric-import/ref/worked-examples.md` (or `.claude/skills/fabric-import/ref/worked-examples.md` post-install). Load when you want to see complete MCP call shapes + state file deltas in realistic scenarios.

## Failure Recovery

- **Phase 2 mid-run failure** (e.g. `fab_extract_knowledge` errors on commit 5 of 10): state already records commits 1–4; rerun resumes at commit 5 by skipping any sha in `p2_processed_commits[]`. Error appended to `errors[]`.
- **Phase 3 mid-run failure** (e.g. `fab_review action="search"` MCP timeout on dedup pair 3 of 7): state records pairs 1–2 in `p3_dedup_completed[]`; rerun resumes at pair 3.
- **Cumulative `errors[].length > 5`**: skill halts; asks free-text confirmation (UX i18n Policy class 3 — confirmation prompts):
  - zh-CN: `继续 (y) / 中止并保留 state (n)`
  - en: `Continue (y) / Abort and keep state (n)`
- **State file corruption**: handled by Phase 0.1 — Phase 0.1 detects corruption (JSON parse error / missing required fields / phase enum violation), renames the file to `.fabric/.import-state.json.corrupt-<ISO8601>`, and restarts from Phase 1. See "Phase 0.1 — State Corruption Recovery" above.
- **MCP tool unreachable**: skill halts before any work; surfaces (UX i18n Policy class 2 — errors/preconditions):
  - zh-CN: `MCP 工具未注册；请检查 fabric server 是否运行`
  - en: `MCP tool not registered; please check that the fabric server is running`
  …and exits without writing state.

The skill is `Check-not-Ask` for recovery: it inspects state and resumes deterministically; it does NOT ask the user where to resume from.
