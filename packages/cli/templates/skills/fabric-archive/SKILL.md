---
name: fabric-archive
description: 归档对话洞察 + 冷启动从 git/docs 回灌到 pending knowledge (NOT code review). Triggers 归档/记一下/always/never/wrong-turn-revert;source mode bootstrap fabric/mine commit.
allowed-tools: Read, Glob, Grep, Bash, mcp__fabric__fab_archive_scan, mcp__fabric__fab_propose, mcp__fabric__fab_pending, mcp__fabric__fab_review
---

> **Surface**: Skill (LLM judgment over session digests). See [`docs/surfaces.md`](https://github.com/fenglimg/fabric/blob/main/docs/surfaces.md).

## Precondition

Invoke this skill ONLY when ONE of the following holds:

- Stop-hook printed stdout JSON `{"decision":"block","reason":"..."}` mentioning fabric-archive
- User typed an explicit archive request (e.g. "archive what we just did", "fabric archive")
- A task wrap-up moment where the agent itself判定 a worth-keeping insight has surfaced

If none hold, stop the skill and tell the user (UX i18n Policy class 2):

- zh-CN: `没有触发归档信号；如需手动归档请显式调用 fabric-archive`
- en: `No archive signal detected; to manually archive, explicitly invoke fabric-archive`

Render per global `language` (`zh-CN`|`en`) resolved in Phase 0.5.

This skill runs automatically — it does not interview the user for preferences. It gathers evidence, aborts if no archive signal exists, then classifies + persists.

## 执行流程 (1 User Review Round)

rc.37 NEW-9 collapsed the flow to **3 macro-phases**; the legacy fine-grained phases survive as labelled sub-steps:

- **GATHER** = Phase 0 (range) → 0.5 (config) → 1 (ledger scan via `fab_archive_scan`) → [1.5 onboard] → 2 (candidates).
- **REVIEW** = Phase 2.5 (viability gate) → 3 (classify / layer / slug + batch review) → 3.5 (relevance scope + relevance_paths) → 3.7 (semantic scope / audience axis). The single user review round lives here.
- **PERSIST** = Phase 4 (`fab_propose`, one call per candidate) → 4.5 (archive-attempt ledger).

Sub-step chain: `0 → 0.5 → 1 → [1.5] → 2 → 2.5 → 3 → 3.5 → 3.7 → 4 → 4.5`. Each below is a navigator stub — full procedure, decision tables, and worked examples live in `ref/`.

## Source Mode — cold-start bootstrap (W3-C: 吸收原 fabric-import)

**Default mode** GATHERs candidates from the cross-session digest ledger (Phase 1, `fab_archive_scan`). **Source mode** swaps ONLY the GATHER source: it mines `git log` + `docs/*.md` for one-time per-project cold-start — the REVIEW (classify / layer / scope / semantic_scope) and PERSIST (`fab_propose`) pipeline below is **shared, byte-for-byte the same contract**. No new write path: mined entries land as `team`-layer pending via the same `fab_propose`, then dedupe vs canonical via `fab_review`.

**Enter source mode when** the user explicitly asks to bootstrap / import history / mine commits, OR the SessionStart hook fired `shouldRecommendImport()`. Else stay in default mode. **SKIP** when `.fabric/` missing (→ `fabric install`), canonical count > `import_skip_canonical_threshold` (default 50), or checkpoint `phase=complete` + `last_checkpoint_at <24h`.

Source-mode pipeline (replaces GATHER; REVIEW+PERSIST unchanged):

1. **Init / checkpoint** — read/init `.fabric/.import-state.json` (single resumability source; atomic `Write .tmp` → `Bash mv`). Corruption → `Read ref/source-state-recovery.md`. Full state schema + 6-step resume → `Read ref/source-checkpoint.md`.
2. **Init-scan reference (NO re-implement)** — `fabric onboard-coverage --json` + `fab_pending action="search"` to learn existing canonical titles for the negative filter. `fabric install` already produced the baseline; source mode references it, never redoes it.
3. **Mine (git + docs)** — `git log --since="<window> months ago"` (conventional prefix → type signal) + `docs/*.md`; classify into the 5 types; `fab_propose` per candidate. **Source-mode scope lock (NON-NEGOTIABLE): every mined entry `relevance_scope="broad"` + `relevance_paths=[]`** — LLM-inferred narrow lies about applicability; narrowing is deferred to `fab_review.modify` post-import. Cap `import_max_pending_per_run` (default 10). Full mining procedure, conventional-prefix table, `--dry-run` template → `Read ref/source-mining.md`.
4. **Dedupe vs canonical** — for each pending, `fab_pending action="search"` (top 5 by type), classify duplicate / subsumption / subsumption-with-novelty / contradiction / genuinely-new, then `fab_review` reject / modify. `fab_pending` does NOT compare meaning — semantic compare is the LLM's job. Full 5-way classification → `Read ref/source-dedup.md`.

Source-mode config knobs (read from `.fabric/fabric-config.json`, defaults if absent): `import_window_first_run_months` (60), `import_window_rerun_months` (2), `import_max_pending_per_run` (10), `import_max_commits_scan` (500), `import_skip_canonical_threshold` (50).

Source-mode output roll-up + worked examples → `Read ref/source-output-contract.md` / `ref/source-worked-examples.md`. Source mode requires an **explicit target store** (E7) — never auto-route mined entries; resolve writable candidates via `fabric info scope team` and `AskUserQuestion` for the alias when more than one exists.

### Phase 0 — Range Resolution

Parse user's prompt for time-window (`今日` / `last week`), topic keyword (`rc.20`), or literal `session_id` reference; emit `session_id[]` OR `"all"` sentinel that constrains Phase 1 collection. LLM-as-parser contract — no parser code.

`Read ref/phase-0-range-resolution.md` for the confidence decision rule, bilingual time-window patterns, session_id resolution, AskUserQuestion fallback, and worked examples.

### Phase 0.5 — Config Load

Read `.fabric/fabric-config.json`; resolve `archive_max_candidates_per_batch` (default 8), `archive_max_recent_paths` (default 20), `archive_digest_max_sessions` (default 10). Missing file → defaults silently.

### Phase 0.6 — Store routing (v2.1 multi-store)

Archives land in the **active write store** for the entry's scope — NEVER pick a store yourself. Run `fabric info scope team` (or the relevant scope) to get the resolved `writeTarget`; that is where `fab_propose` persists. Single-store → the lone store (back-compat). After persisting, **echo the target store alias** (`归档到 store '<alias>'`). Personal-scope entries route to the personal store (never the shared team store, R5#3). Do NOT read `~/.fabric` store trees directly — go through `fabric info scope` / the MCP write path.

### UX i18n Policy

Read machine-wide `~/.fabric/fabric-global.json` `language` (`zh-CN` | `en` only; ISS-20260712-016). Emit user-facing prose in that language. Project `fabric_language` is retired for AI skill rendering. Protected tokens (MCP tool names, schema fields, the verbatim `强 team` / `强 personal` / `默认 team` heuristic) NEVER translated. `AskUserQuestion` policy: `header` + `question` translate; `options[]` stay English (routing keys).

`Read ref/i18n-policy.md` for the full 5-class taxonomy + edge cases.

### Phase 1 — Collect Cross-Session Digests (server-side ledger scan, rc.37 NEW-9)

The deterministic ledger scan now runs **server-side** — call `fab_archive_scan({ range, session_id })` (range = Phase 0's `session_id[]` or `"all"`/omitted). It returns:

- `anchor_ts` — ts of the last `knowledge_proposed` (the lower bound).
- `session_ids[]` — distinct in-scope sessions since the anchor, ALREADY filtered through the outcome-ledger state machine (drops `user_dismissed`, sessions inside the 12h anti-loop cooldown, and watermarked sessions with no new high-value signal). First-seen order.
- `dropped[]` — `{session_id, reason}` for transparency.
- `covered_through_ts` — max ts examined (becomes the next watermark).
- `already_proposed_keys[]` — idempotency keys already proposed but not yet reviewed; drop matching candidates in Phase 3 (cross-session pending dedupe).

Then (LLM side, Boundary B): for each returned `session_id`, load `.fabric/.cache/session-digests/<session_id>.md`, concatenate into a `### Cross-session digest` block, and populate `source_sessions[]` + `session_context` for Phase 4. Cap at `archive_digest_max_sessions`. Missing digest files degrade silently.

**Coverage transparency (crack 3 — cheap recall backstop).** BEFORE collecting candidates, surface the scan's watermark + drops to the user so a human can act as the recall detector and manually override (`--range <session_id>` to force a dropped session back in). This is the affordable substitute for the (deferred) periodic cold-eval miss-rate audit — show, don't hide, what the deterministic filter skipped:

```
📋 归档覆盖到 <covered_through_ts 转人类可读时间>。
   纳入会话: <session_ids.length> 个。
   跳过 <dropped.length> 个: <每个 {session_id 短码} (reason)>
     reason 含义: user_dismissed=用户曾拒绝 / cooldown=12h 防抖内 / no_new_signal=自上次归档无新高价值活
   若某个被跳过的会话其实有该归档的内容,显式 `fabric-archive --range <session_id>` 强制纳入。
```

Render `dropped` only when non-empty; render the watermark line always. en variant mirrors the same fields. Keep it ONE compact block — this is a backstop affordance, not a report.

`Read ref/phase-1-cross-session.md` for the filter state machine + digest-stitch + graceful-degradation notes. The hand-rolled `tail -n 200` scan is retired — `fab_archive_scan` is the source of truth.

Graceful degradation: missing digest cache → single-session fallback. Missing `session_archive_attempted` events (pre-rc.25) → legacy "scan everything since anchor" behaviour.

### Phase 1.5 — First-run Onboard (ref-only)

**SKIP this phase entirely unless** entry_point ∈ {E2_explicit_user_invoke, E4_user_range_rollback} AND `fabric onboard-coverage --json` reports `missing.length > 0`. For E1/E3/E5, silently fall through to Phase 0.

`Read ref/phase-1-5-onboard.md` for the Step 1-4 coverage check → user prompt → tour-and-propose procedure.

### Phase 2 — Collect Candidates

Gather raw evidence: tail `.fabric/events.jsonl` since last `knowledge_proposed`; enumerate `recent_paths` (workspace files touched by Read/Edit/Write); distill `user_messages_summary` (≤500 char prose, NOT verbatim transcript); build candidate list. Hard budget: `archive_max_candidates_per_batch` per batch (default 8); drop weaker overage.

**Activation floor.** A candidate is worth proposing only when it can change a future agent's next action after SessionStart or `fab_recall`. Drop storage-only observations that merely say a discussion happened, a file exists, or a topic is important without an operational trigger/action. The review-side name for this failure is `reached-but-inert`; avoid creating those pending entries here.

### Phase 2.5 — Viability Gate (Anti-Archive Guard)

Coarse viability check. **PASS**: user_explicit_invoke OR ≥1 archive signal hit. rc.37 NEW-4 folds the legacy 8 signals into **3 categories**: (1) **User-driven knowledge expression** (normative language `always`/`never`/`以后`/`记一下`/`永远不要`, OR decision-with-rationale, OR dismissal-with-reason); (2) **Reflective discovery** (wrong-turn-and-revert, OR long diagnostic loop, OR a named reusable pattern); (3) **Concrete artifact change** (new dependency diff, OR a formalized multi-step procedure).

Pre-PASS HARD gate (rc.37 NEW-4): per candidate, run `fab_pending action="search"` against the mounted read-set; duplicate canonical → drop the candidate (anti-signal #4). Silently writing a near-duplicate is the highest-noise failure mode.

**FAIL → branch**: E1/E3/E5 silent-skip (`outcome='skipped_no_signal'`); E2/E4 render gate-FAIL (`outcome='viability_failed'`) and MUST include the force-archive escape hatch (zh-CN: `如需强制归档，请显式调用 fabric-archive` / en: `To force-archive, explicitly invoke fabric-archive`).

`Read ref/phase-2-5-viability.md` for verbose signal definitions, full gate-FAIL bodies, anti-archive signals, and the events.jsonl 4KB POSIX atomicity constraint.

### Phase 3 — Classify, Layer, Slug, Review

For each candidate, propose **type** ∈ {model, decision, guideline, pitfall, process}, **layer** ∈ {team, personal} via the verbatim heuristic below, **slug** (kebab-case 2-5 words, 20-40 chars, unique within type+layer bucket), **summary** (1-2 sentences).

> **Self-sufficiency standard — guideline / model summaries (KT-GLD-0001/0006).** These two types land in the SessionStart **ALWAYS-ACTIVE** sink as a single INDEX line with NO body injected — so the summary IS the operative rule the agent acts on. Author it as a self-contained imperative that states the thesis (the *what* + the operative *so-what*), e.g. `改源码前先读 bootstrap+compiler config;scripts 为 init 主执行边界`. A topic label that only points at the body (`Code style guidelines`, `Scope model`) is NOT acceptable here — the reader can't act on it without a fetch, breaking the always-active contract. decision/pitfall/process summaries are exempt (they surface as `must_read_if` triggers, deliberately pointers). Do NOT self-judge sufficiency in this phase (curse-of-knowledge rubber-stamps — KT-GLD-0006); authoring to the standard is the write-time floor, the zero-context cold-eval at review time is the real gate.

#### Layer Classification Heuristic (verbatim, contract-locked)

> - **强 team**: 引用本项目代码、团队共识用语（"we decided"）、fabric-import 路径产物、业务领域、绑定本项目代码的 pitfall
> - **强 personal**: 第一人称偏好、跨项目通用、工具/编辑器偏好、个人工作流
> - **默认 team**: 安全偏置——错标 team 在 PR review 中会被发现，错标 personal 静默丢失

Resolution: 强 team first; assign personal only if 强 personal dominates AND no 强 team applies; else default team.

`Read ref/phase-3-classify.md` for per-type worth-archive vs skip signals, slug samples, decision tree, and en + zh-CN batch review templates. User MAY inline-edit `type` / `layer` / `slug` / `relevance_scope` / `relevance_paths` / `semantic_scope` before confirming; scope edits trigger Phase 3.5 re-derivation.

### Phase 3.5 — Scope Decision + relevance_paths Derivation

Assign `relevance_scope` ∈ {narrow, broad} + derive `relevance_paths` BEFORE batch review. **narrow** = candidate tied to specific module/file with single-module evidence in edit_paths; **broad** = cross-cutting/methodological/general (default on uncertainty). **Personal layer ALWAYS forces broad + `relevance_paths=[]`** (cross-project, paths don't generalize).

`Read ref/phase-3-5-scope.md` for the 6-step relevance_paths derivation pseudocode, the worked example, and narrow↔broad inline-edit re-derivation rules.

### Phase 3.6 — Related-edge Extraction (§7 graph generation)

For each candidate, record the `related` graph edges (store-qualified `stable_id`s this entry links to) as one line inside `session_context` (e.g. `related: team:KT-DEC-0007`) so they survive to approve-time frontmatter authoring. Cite only ids you actually saw via `fab_recall` — NEVER invent. **§4 privacy iron law: `KT→KP` is FORBIDDEN** (a team entry MUST NOT point at a personal id); when unsure a target is personal, OMIT the edge.

`Read ref/phase-3-6-related-edges.md` for the allowed/forbidden edge matrix and worked examples.

### Phase 3.7 — Semantic scope (audience axis, multi-project)

Sets the entry's **audience** `semantic_scope` (orthogonal to `layer`=store and `relevance_scope`=display). ONLY when `layer=team` AND `.fabric/fabric-config.json` has a non-empty `active_project`; else SKIP — the engine derives it. Default = OMIT → `project:<active_project>` (this-project-only). Escape hatch: pass explicit `semantic_scope: team` to keep a cross-project team-wide entry from being narrowed to this project. Phase 3 picks the STORE; this picks the AUDIENCE within the team store.

`Read ref/phase-3-7-semantic-scope.md` for the three-axis model, the this-project-only vs team-wide decision tree, and worked examples.

### Phase 4 — Persist via MCP

For each user-confirmed candidate, call `fab_propose` ONCE (NEVER batch). Required (must match `FabExtractKnowledgeInputBaseSchema`): `source_sessions[]`, `recent_paths[]` (cap 20), `user_messages_summary`, `type` (plural form: decisions/pitfalls/guidelines/models/processes), `slug`, `proposed_reason` (enum), `session_context` (3-5 line narrative). Author-facing scope is TWO optional fields only — `audience` (open scope coordinate; omit → engine defaults to `project:<active>` or `team`) + `paths` (relevance anchors; non-empty → narrow, empty/omit → broad). **Do NOT pass retired author fields `layer` / `relevance_scope` / `relevance_paths` / `semantic_scope`** — the engine derives them (ISS-20260711-173). Three OPTIONAL triage fields (`intent_clues`, `impact`, `must_read_if`) — populate when clean, **omit rather than guess**. `tech_stack` values merge into `tags` (v-next grill D2).

Server returns `{ pending_path, idempotency_key }`. Display `pending_path` for the user. `idempotency_key = sha256({source_session, type, slug})` — repeated calls SAFE (server merges evidence).

`Read ref/phase-4-mcp-persist.md` for the full call shape, C1 triage-field inference table, signal → `proposed_reason` mapping, and idempotency notes.

### Phase 4.5 — Persist Archive Attempt

MANDATORY closing step on EVERY invocation (Phase 4 success path + every early-exit). Append ONE `session_archive_attempted` line to `.fabric/events.jsonl` per `session_id` in run scope (single-line JSON ≤4KB POSIX atomicity). Outcome ∈ {`proposed` | `viability_failed` | `user_dismissed` | `skipped_no_signal`}. `covered_through_ts` = max ts of events examined. Best-effort write: failure → stderr log only, skill still exits successfully.

**Emit schema — inline; do NOT reverse-engineer it from existing `.fabric/events.jsonl` records (historical lines may carry a WRONG `event` key from prior buggy runs — copying one propagates the bug).** One single-line JSON per `session_id`, exact shape:

`{"kind":"fabric-event","id":"event:<uuid>","ts":<now_ms>,"schema_version":1,"session_id":"<sid>","event_type":"session_archive_attempted","outcome":"<enum>","covered_through_ts":<max ts examined>,"candidates_proposed":0,"knowledge_proposed_ids":[]}`

The discriminator key is **`event_type`** (a `fabric-event` envelope), NEVER a bare `event`: the Stop-hook (`fabric-hint.cjs` filters `ev.event_type`) AND `archive-scan.ts` both read `event_type`, and the zod `sessionArchiveAttemptedEventSchema` drops any record missing it (KT-PIT-0005 `.strip()`). A wrong-key record is SILENTLY invisible → the session is never marked archived → the Stop-hook archive-backlog nudge floods forever. After emitting, VERIFY round-trip: the hook backlog count / `fab_archive_scan` in-scope set MUST drop for the sessions you just wrote.

**Dry-run override**: SKIPS the `session_archive_attempted` emit entirely; read-side runs normally so user previews what WOULD have been written. See unified `## Dry-run Scope` pointer below.

`Read ref/phase-4-5-emit.md` for the full event shape, 4-state outcome decision matrix, `covered_through_ts` watermark spec, multi-session emission rule, and E5-cron silent-skip trace.

## Body altitude (quality)

Write **reusable altitude** (decision / pitfall / guideline / model / process) — not session dumps.

- Prefer 3–5 line structured `session_context` with `##` headings and operational trigger/action.
- Dump-shaped bodies (dense `User:`/`Assistant:` turn markers, raw transcript headers) may emit `body_altitude_dump` / `body_altitude_transcript_shape` at `fab_propose` (default **warn** + still write; set `FABRIC_ALTITUDE_PROPOSE_GATE=1` or `altitude_propose_gate: true` to refuse with empty `pending_path`).
- Doctor surfaces warn-only `knowledge_body_altitude_dump` for corpus hygiene — never auto-mutate.

## Finish→archive cadence (light)

After a **significant decision** lands, or an edit batch reaches config `archive_edit_threshold` (default **20**), lightly self-trigger this skill at a suitable turn:

- Max **1** self-trigger per turn; same session/outcome do not repeat (anti-loop).
- Soft Stop-hook nudge only (KT-DEC-0007) — **not** a task engine, not Spex/Trellis, not Stop-hook flood.
- Still requires a real archive signal (user-driven normative or wrong-turn-revert); typo-only batches do not count.

## Hard Rules (DO NOT TRANSLATE) — DISPLAY / WRITE Split

### DISPLAY Rules

- MUST complete Phase 2 AND Phase 2.5 viability gate before any batch-review output.
- MUST abort with the gate-FAIL message (no MCP call) when the viability gate fails AND the user did not explicitly invoke fabric-archive.
- MUST present every candidate with explicit `[type=...]`, `[layer=...]`, `[relevance_scope=...]`, and `slug=...` fields plus a `relevance_paths` line.
- MUST include a one-line `Layer reasoning:` for each candidate citing which 强 team / 强 personal signal applied (or default team).
- MUST include a one-line `Scope reasoning:` for each candidate citing why narrow or broad was chosen (or that personal forced broad).
- WHEN `active_project` is set AND `layer=team`, MUST present `[semantic_scope=...]` (`team` for team-wide, or `project:<active_project>` for this-project-only) plus a one-line `Audience reasoning:` citing this-project-only vs team-wide (Phase 3.7).
- MUST classify against the canonical singular nouns: model / decision / guideline / pitfall / process. NEVER invent new types.
- MUST cap the batch at `archive_max_candidates_per_batch` candidates (config-resolved, default 8); drop weaker ones over the cap.
- MUST display the resolved `pending_path` returned by `fab_propose` so the user can verify.
- MUST treat user inline edits to type/layer/slug/relevance_scope/relevance_paths/semantic_scope as authoritative replacements before Phase 2.
- MUST skip rather than guess when an observation does not fit any of the 5 types.

### WRITE Rules

- NEVER write a knowledge entry directly to the filesystem; the only legal write path is `mcp__fabric__fab_propose`.
- NEVER infer or glob a project-local pending directory — persist through `fab_propose` and use the returned store-resolved `pending_path`; promotion to canonical knowledge is fab_review concern, NOT this skill.
- NEVER include an `id` field anywhere — pending entries have no id (late-bind on approve).
- NEVER classify a candidate as `personal` when a 强 team signal applies. Default to team on ambiguity.
- NEVER emit a non-empty `relevance_paths` when `relevance_scope=broad` — broad MUST always carry `relevance_paths=[]`.
- NEVER emit a non-empty `relevance_paths` when `layer=personal` — personal forces `relevance_scope=broad` + `relevance_paths=[]`.
- v2.0.0-rc.37 NEW-7 widened Phase 3.5: `edit_paths` ∪ `user_mentioned_paths` drives `relevance_paths`; `read_paths` flows separately to `evidence_paths` (structured frontmatter, not body markdown). NEVER lift body regex / symbol extraction into `relevance_paths` — those remain reserved for v2.1+.
- NEVER batch multiple candidates into a single fab_propose call; one call per candidate.
- NEVER paraphrase the verbatim layer heuristic block above — the Chinese text is contract-locked.
- MUST preserve protected tokens exactly: `stable_id`, `knowledge_proposed`, `knowledge_archive_aborted`, `knowledge_scope_degraded`, `fab_propose`, `relevance_paths`, `relevance_scope`, `narrow`, `broad`, `edit_paths`, `source_sessions`, `proposed_reason`, `session_context`, `intent_clues`, `impact`, `must_read_if`, `pending_path`, `layer`, `semantic_scope`, `active_project`, `team`, `personal`, `MUST`, `NEVER`, `强 team`, `强 personal`, `默认 team`, `related`, `KT→KP`.

## Worked Examples / E5 Cron / Dry-run (ref-only)

- **Worked examples** (3 end-to-end fab_propose calls: decision/team, pitfall/team, guideline/personal): `Read ref/worked-examples.md`
- **E5 Scheduled Daily Recap** (only when entry_point=E5_cron — OS cron, `/loop`, or scheduled trigger): `Read ref/e5-cron-recap.md`
- **Dry-run Scope** (authoritative catalogue of all writes suspended by `--dry-run`): `Read ref/dry-run-scope.md`
- **RC history** (background-only migration notes; load only when auditing legacy release behaviour or why an old rc archive path differs): `Read ref/rc-history.md`
