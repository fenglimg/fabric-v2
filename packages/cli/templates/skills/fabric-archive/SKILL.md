---
name: fabric-archive
description: 归档对话洞察到 active write store 的 knowledge/pending (NOT code review). Triggers 以后/always/never/下次/记一下;wrong-turn-revert;decision-confirm;dismissal-reason;/fabric-archive.
allowed-tools: Read, Glob, Grep, Bash, mcp__fabric__fab_extract_knowledge
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

Render per `fabric_language` resolved in Phase 0.5.

This skill runs automatically — it does not interview the user for preferences. It gathers evidence, aborts if no archive signal exists, then classifies + persists.

## 执行流程 (1 User Review Round)

v2.0.0-rc.37 NEW-9 collapsed the flow to **3 macro-phases**; the legacy fine-grained phases survive as labelled sub-steps (back-compat for `ref/` navigation + existing traces):

- **GATHER** = Phase 0 (range) → 0.5 (config) → 1 (ledger scan via `fab_archive_scan`) → [1.5 onboard] → 2 (candidates). Resolve scope, load config, deterministically scan the ledger for in-scope sessions, collect candidate observations.
- **REVIEW** = Phase 2.5 (viability gate — abort guard) → 3 (classify / layer / slug + batch review) → 3.5 (scope + relevance_paths). The single user review round lives here.
- **PERSIST** = Phase 4 (`fab_extract_knowledge`, one call per candidate) → 4.5 (archive-attempt ledger).

Sub-step chain: `0 → 0.5 → 1 → [1.5] → 2 → 2.5 → 3 → 3.5 → 4 → 4.5`. Each below is a navigator stub — full procedure, decision tables, and worked examples live in `ref/`.

### Phase 0 — Range Resolution

Parse user's prompt for time-window (`今日` / `last week`), topic keyword (`rc.20`), or literal `session_id` reference; emit `session_id[]` OR `"all"` sentinel that constrains Phase 1 collection. LLM-as-parser contract — no parser code.

`Read ref/phase-0-range-resolution.md` for the HIGH/MEDIUM/LOW/PARSE-MISS confidence decision rule (rc.33), Step 1 inspection table, bilingual time-window patterns (zh-CN + en), topic-keyword extraction, session_id resolution pseudocode, AskUserQuestion fallback (E2/E4 only), and 3 worked examples.

### Phase 0.5 — Config Load

Read `.fabric/fabric-config.json`; resolve `archive_max_candidates_per_batch` (default 8), `archive_max_recent_paths` (default 20), `archive_digest_max_sessions` (default 10). Missing file → defaults silently.

### Phase 0.6 — Store routing (v2.1 multi-store)

Archives land in the **active write store** for the entry's scope — NEVER pick a store yourself. Run `fabric scope-explain team` (or the relevant scope) to get the resolved `writeTarget` (alias + UUID); that is where `fab_extract_knowledge` persists. Single-store / no global config → the lone store (back-compat). After persisting, **echo the target store alias** to the user (`归档到 store '<alias>'`). Personal-scope entries route to the personal store (never the shared team store, R5#3). Do NOT read `~/.fabric` store trees directly — go through `scope-explain` / the MCP write path.

### UX i18n Policy

Read `fabric_language` (`zh-CN` / `en` / `zh-CN-hybrid` / `match-existing`); emit user-facing prose in resolved variant. Protected tokens (MCP tool names, schema fields, the verbatim `强 team` / `强 personal` / `默认 team` heuristic) NEVER translated. `AskUserQuestion` policy: `header` + `question` translate; `options[]` stay English (routing keys).

`Read ref/i18n-policy.md` for the full 5-class taxonomy + edge cases.

### Phase 1 — Collect Cross-Session Digests (server-side ledger scan, rc.37 NEW-9)

The deterministic ledger scan now runs **server-side** — call `fab_archive_scan({ range, session_id })` (range = Phase 0's `session_id[]` or `"all"`/omitted). It returns:

- `anchor_ts` — ts of the last `knowledge_proposed` (the lower bound).
- `session_ids[]` — distinct in-scope sessions since the anchor, ALREADY filtered through the outcome-ledger state machine (drops `user_dismissed`, sessions inside the 12h anti-loop cooldown, and watermarked sessions with no new high-value signal). First-seen order.
- `dropped[]` — `{session_id, reason}` for transparency.
- `covered_through_ts` — max ts examined (becomes the next watermark).
- `already_proposed_keys[]` — idempotency keys already proposed but not yet reviewed; drop matching candidates in Phase 3 (cross-session pending dedupe).

Then (LLM side, Boundary B): for each returned `session_id`, load `.fabric/.cache/session-digests/<session_id>.md`, concatenate into a `### Cross-session digest` block, and populate `source_sessions[]` + `session_context` for Phase 4. Cap at `archive_digest_max_sessions`. Missing digest files degrade silently.

`Read ref/phase-1-cross-session.md` for the (now server-side) filter state machine rules + the digest-stitch + graceful-degradation notes. The hand-rolled `tail -n 200` events.jsonl scan is retired — `fab_archive_scan` is the source of truth for which sessions to load.

Graceful degradation: missing digest cache → single-session fallback. Missing `session_archive_attempted` events (pre-rc.25) → legacy "scan everything since anchor" behaviour.

### Phase 1.5 — First-run Onboard (ref-only)

**SKIP this phase entirely unless** entry_point ∈ {E2_explicit_user_invoke, E4_user_range_rollback} AND `fabric onboard-coverage --json` reports `missing.length > 0`. For E1/E3/E5, silently fall through to Phase 0.

`Read ref/phase-1-5-onboard.md` for the Step 1-4 coverage check → user prompt → tour-and-propose procedure.

### Phase 2 — Collect Candidates

Gather raw evidence: tail `.fabric/events.jsonl` since last `knowledge_proposed`; enumerate `recent_paths` (workspace files touched by Read/Edit/Write); distill `user_messages_summary` (≤500 char prose, NOT verbatim transcript); build candidate list. Hard budget: `archive_max_candidates_per_batch` per batch (default 8); drop weaker overage.

### Phase 2.5 — Viability Gate (Anti-Archive Guard)

Coarse viability check. **PASS conditions**: user_explicit_invoke OR ≥1 archive signal hit. v2.0.0-rc.37 NEW-4 simplifies the legacy 8-signal list into **3 major categories** (each maps to multiple legacy signals for back-compat scoring):

1. **User-driven knowledge expression** — user message contains normative language (`always`/`never`/`from now on`/`下次注意`/`记一下`/`以后`/`永远不要`), OR user weighed ≥2 alternatives and gave rationale (decision confirmation), OR user explicitly dismissed an approach AND stated why (dismissal-with-reason). Legacy signals #1 + #6 + #7.
2. **Reflective discovery** — AI tried path X, reflected, then took path Y (wrong-turn-and-revert); OR a long diagnostic loop (>15 min / >10 turns) surfaced a non-obvious cause; OR a reusable pattern was named in the session ("the X phase", "the Y pattern"). Legacy signals #2 + #3 + #5.
3. **Concrete artifact change** — a new dependency was added (package.json/pyproject.toml/Cargo.toml diff), OR a load-bearing multi-step procedure was formalized in a specific order. Legacy signals #4 + #8.

Pre-PASS MUST step (rc.37 NEW-4): for each candidate, run `fab_review action="search"` scoped by type/slug keywords to check for duplicate canonical entries in the mounted store read-set. If duplicate found → drop candidate (treat as anti-signal #4 'duplicate of existing canonical'). This is a HARD gate, not advisory — silently writing a near-duplicate is the highest-noise failure mode.

**FAIL → branch by entry_point**: E1/E3/E5 silent-skip (emit Phase 4.5 event `outcome='skipped_no_signal'`); E2/E4 render gate-FAIL message (emit `outcome='viability_failed'`). Gate-FAIL message for E2/E4 MUST include the "to force-archive, explicitly invoke fabric-archive" remediation pointer so the user has an unambiguous escape hatch when the gate misclassifies (zh-CN: `如需强制归档，请显式调用 fabric-archive` / en: `To force-archive, explicitly invoke fabric-archive`).

`Read ref/phase-2-5-viability.md` for verbose signal definitions, zh-CN/en gate-FAIL message bodies, anti-archive signals (typo / refactor / rename / duplicate), and the events.jsonl 4KB POSIX atomicity constraint.

### Phase 3 — Classify, Layer, Slug, Review

For each candidate, propose **type** ∈ {model, decision, guideline, pitfall, process}, **layer** ∈ {team, personal} via the verbatim heuristic below, **slug** (kebab-case 2-5 words, 20-40 chars, unique within type+layer bucket), **summary** (1-2 sentences).

#### Layer Classification Heuristic (verbatim, contract-locked)

> - **强 team**: 引用本项目代码、团队共识用语（"we decided"）、fabric-import 路径产物、业务领域、绑定本项目代码的 pitfall
> - **强 personal**: 第一人称偏好、跨项目通用、工具/编辑器偏好、个人工作流
> - **默认 team**: 安全偏置——错标 team 在 PR review 中会被发现，错标 personal 静默丢失

Resolution: 强 team first; assign personal only if 强 personal dominates AND no 强 team applies; else default team.

`Read ref/phase-3-classify.md` for per-type worth-archive vs skip signals with positive/negative examples, slug pass/fail samples, decision tree, en + zh-CN batch review templates. User MAY inline-edit `type` / `layer` / `slug` / `relevance_scope` / `relevance_paths` before confirming; scope edits trigger Phase 3.5 re-derivation.

### Phase 3.5 — Scope Decision + relevance_paths Derivation

Assign `relevance_scope` ∈ {narrow, broad} + derive `relevance_paths` BEFORE batch review. **narrow** = candidate tied to specific module/file with single-module evidence in edit_paths; **broad** = cross-cutting/methodological/general (default on uncertainty). **Personal layer ALWAYS forces broad + `relevance_paths=[]`** (cross-project, paths don't generalize).

`Read ref/phase-3-5-scope.md` for the 6-step relevance_paths derivation pseudocode (COLLECT → DEDUPE → BLACKLIST → PUBLIC-PREFIX GENERALIZE → SCOPE GATE → ATTACH READ-ONLY EVIDENCE), worked example (5 sample paths → glob + literal output), and narrow↔broad inline-edit re-derivation rules.

### Phase 3.6 — Related-edge Extraction (§7 graph generation)

For each candidate, identify the **`related`** graph edges to other KB entries — the store-qualified `stable_id`s this entry semantically links to (the decision it supersedes, the pitfall it explains, the model it instantiates). You discovered these ids during the session via `fab_recall` / plan-context, so cite the ones you actually saw, NEVER invent stable_ids. Because `fab_extract_knowledge` has no dedicated `related` input, record the candidate edges as one line inside `session_context` (e.g. `related: team:KT-DEC-0007, team:KT-PIT-0011`) so they survive to approve-time frontmatter authoring (`fabric-review` writes the canonical `related: [...]` frontmatter).

**§4 privacy iron law — KT→KP is FORBIDDEN.** A **team** (`KT-*`) entry's `related` MUST NOT point at a **personal** (`KP-*`) id: that would write a personal-knowledge topology pointer into a shared store. Allowed: `KT→KT`, `KP→KP`, `KP→KT`. Forbidden: `KT→KP` only. When unsure whether a target is personal, OMIT the edge.

### Phase 4 — Persist via MCP

For each user-confirmed candidate, call `fab_extract_knowledge` ONCE (NEVER batch). Required: `source_sessions[]`, `recent_paths[]` (cap 20), `user_messages_summary`, `type` (plural form: decisions/pitfalls/guidelines/models/processes), `slug`, `layer`, `relevance_scope`, `relevance_paths[]`, `proposed_reason` (enum), `session_context` (3-5 line narrative). Four OPTIONAL rc.23 triage fields (`intent_clues`, `tech_stack`, `impact`, `must_read_if`) — populate when clean, **omit rather than guess**.

Server returns `{ pending_path, idempotency_key }`. Display `pending_path` for the user. `idempotency_key = sha256({source_session, type, slug})` — repeated calls SAFE (server merges evidence).

`Read ref/phase-4-mcp-persist.md` for full TypeScript call shape, C1 triage-field inference table, Phase 2.5 signal → `proposed_reason` mapping, `session_context` format, T5 array-form idempotency notes.

### Phase 4.5 — Persist Archive Attempt

MANDATORY closing step on EVERY invocation (Phase 4 success path + every early-exit). Append ONE `session_archive_attempted` line to `.fabric/events.jsonl` per `session_id` in run scope (single-line JSON ≤4KB POSIX atomicity). Outcome ∈ {`proposed` | `viability_failed` | `user_dismissed` | `skipped_no_signal`}. `covered_through_ts` = max ts of events examined. Best-effort write: failure → stderr log only, skill still exits successfully.

**Dry-run override**: SKIPS the `session_archive_attempted` emit entirely; read-side runs normally so user previews what WOULD have been written. See unified `## Dry-run Scope` pointer below.

`Read ref/phase-4-5-emit.md` for the full event jsonc shape, 4-state outcome decision matrix (outcome × candidates_proposed × knowledge_proposed_ids), `covered_through_ts` watermark spec, multi-session emission rule, bash echo append pattern, and E5-cron silent-skip worked trace.

## Hard Rules (DO NOT TRANSLATE) — DISPLAY / WRITE Split

### DISPLAY Rules

- MUST complete Phase 2 AND Phase 2.5 viability gate before any batch-review output.
- MUST abort with the gate-FAIL message (no MCP call) when the viability gate fails AND the user did not explicitly invoke fabric-archive.
- MUST present every candidate with explicit `[type=...]`, `[layer=...]`, `[relevance_scope=...]`, and `slug=...` fields plus a `relevance_paths` line.
- MUST include a one-line `Layer reasoning:` for each candidate citing which 强 team / 强 personal signal applied (or default team).
- MUST include a one-line `Scope reasoning:` for each candidate citing why narrow or broad was chosen (or that personal forced broad).
- MUST classify against the canonical singular nouns: model / decision / guideline / pitfall / process. NEVER invent new types.
- MUST cap the batch at `archive_max_candidates_per_batch` candidates (config-resolved, default 8); drop weaker ones over the cap.
- MUST display the resolved `pending_path` returned by `fab_extract_knowledge` so the user can verify.
- MUST treat user inline edits to type/layer/slug/relevance_scope/relevance_paths as authoritative replacements before Phase 2.
- MUST skip rather than guess when an observation does not fit any of the 5 types.

### WRITE Rules

- NEVER write a knowledge entry directly to the filesystem; the only legal write path is `mcp__fabric__fab_extract_knowledge`.
- NEVER write outside the resolved store `knowledge/pending/` tree — promotion to canonical `knowledge/<type>/` is fab_review concern, NOT this skill.
- NEVER include an `id` field anywhere — pending entries have no id (late-bind on approve).
- NEVER classify a candidate as `personal` when a 强 team signal applies. Default to team on ambiguity.
- NEVER emit a non-empty `relevance_paths` when `relevance_scope=broad` — broad MUST always carry `relevance_paths=[]`.
- NEVER emit a non-empty `relevance_paths` when `layer=personal` — personal forces `relevance_scope=broad` + `relevance_paths=[]`.
- v2.0.0-rc.37 NEW-7 widened Phase 3.5: `edit_paths` ∪ `user_mentioned_paths` drives `relevance_paths`; `read_paths` flows separately to `evidence_paths` (structured frontmatter, not body markdown). NEVER lift body regex / symbol extraction into `relevance_paths` — those remain reserved for v2.1+.
- NEVER batch multiple candidates into a single fab_extract_knowledge call; one call per candidate.
- NEVER paraphrase the verbatim layer heuristic block above — the Chinese text is contract-locked.
- MUST preserve protected tokens exactly: `stable_id`, `knowledge_proposed`, `knowledge_archive_aborted`, `knowledge_scope_degraded`, `knowledge/pending/`, `fab_extract_knowledge`, `relevance_paths`, `relevance_scope`, `narrow`, `broad`, `edit_paths`, `source_sessions`, `proposed_reason`, `session_context`, `intent_clues`, `tech_stack`, `impact`, `must_read_if`, `pending_path`, `layer`, `team`, `personal`, `MUST`, `NEVER`, `强 team`, `强 personal`, `默认 team`, `related`, `KT→KP`.

## Worked Examples / E5 Cron / Dry-run (ref-only)

- **Worked examples** (3 end-to-end fab_extract_knowledge calls: decision/team, pitfall/team, guideline/personal): `Read ref/worked-examples.md`
- **E5 Scheduled Daily Recap** (only when entry_point=E5_cron — OS cron, `/loop`, or scheduled trigger): `Read ref/e5-cron-recap.md`
- **Dry-run Scope** (authoritative catalogue of all writes suspended by `--dry-run`): `Read ref/dry-run-scope.md`
