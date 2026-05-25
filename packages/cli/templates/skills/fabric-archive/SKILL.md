---
name: fabric-archive
description: 归档对话洞察到 .fabric/knowledge/pending (NOT code review). Triggers 以后/always/never/下次/记一下;wrong-turn-revert;decision-confirm;dismissal-reason;/fabric-archive.
allowed-tools: Read, Glob, Grep, Bash, mcp__fabric__fab_extract_knowledge
---

> **Surface**: This is a Skill (AI-driven, LLM judgment over session digests). See [`docs/surfaces.md`](https://github.com/fenglimg/fabric/blob/main/docs/surfaces.md) for the CLI / Skill / MCP boundary.

## Precondition

This skill is invoked when one of the following holds:

- The Stop-hook printed a stdout JSON pointer of shape `{"decision":"block","reason":"..."}` mentioning fabric-archive
- The user typed an explicit archive request (e.g. "archive what we just did", "fabric archive")
- A task wrap-up moment where the agent itself判定 a worth-keeping insight has surfaced

If none of the above hold, stop the skill immediately and tell the user (UX i18n Policy class 2 — errors/preconditions):

- zh-CN: `没有触发归档信号；如需手动归档请显式调用 fabric-archive`
- en: `No archive signal detected; to manually archive, explicitly invoke fabric-archive`

(Render per `fabric_language` resolved in Phase 0.5 Config Load below.)

This skill is `Check-not-Ask`, not a preference interview:

- **Phase 1.5 (rc.23 F8c) first-run onboard phase** — checks S5 onboard-slot coverage; if unclaimed slots remain, prompts user to fill / dismiss / skip before proceeding to normal archive flow
- Phase 2 proactively gathers candidate evidence from the session
- Phase 2.5 viability gate aborts the skill if the session lacks any archive-signal (anti-archive guard)
- Phase 3 classifies / layers / slugs each candidate and presents one batch review for user correction
- Phase 3.5 assigns `relevance_scope=narrow|broad` and derives `relevance_paths` from edit history (rc.5 single-signal source)
- Phase 4 calls `fab_extract_knowledge` once per confirmed candidate

## 执行流程 (1 User Review Round)

### Phase 0 — Range Resolution

When the skill is invoked, the user's prompt may carry an explicit range hint —
a time window (`今日` / `last week`), a topic keyword (`rc.20`, `cite policy`),
or a literal session_id reference. This phase parses those hints and resolves
them to a concrete `session_id[]` set that constrains Phase 1 cross-session
digest collection. **Falls through silently** when no hint is detected — Phase
1 then sees the legacy "all distinct sessions since last anchor" behaviour.

This is the foundation of the **E4 (user-language range selection) entry
point** per rc.25 Q3.3. AI (Claude/Codex) interprets the rules below at runtime
— there is no parser code; the LLM IS the parser. Time-window patterns +
keyword extraction are LLM-native tasks; an `AskUserQuestion` fallback covers
the low-confidence case.

#### Confidence decision rule (rc.33 — explicit LLM-as-parser contract)

LLM-as-parser commits a result OR falls back to `AskUserQuestion` per these
deterministic criteria. **Confidence is not a vibe** — it is a checklist.

| Confidence | Conditions (ALL must hold) | Action |
|---|---|---|
| **HIGH (commit)** | (a) Time-window matches a row in the Step 2 bilingual pattern table verbatim (modulo case); AND (b) Topic-keywords are nouns from Step 3 retention rules (no ambiguous referents like `it`, `这个`); AND (c) No conflicting hints (e.g. `今日` + `上周` co-present) | Commit `time_window` + `topic_keywords[]` → Step 4 |
| **MEDIUM (commit with audit log)** | Exactly ONE category present (only time-window OR only keywords) AND remaining categories empty (not contradictory) | Commit with single-category filter; emit `low_confidence_parse=false` field |
| **LOW (AskUserQuestion)** | ANY of: (i) multiple competing time-windows; (ii) numeric N in `过去 N 天` parses outside 1..30; (iii) keyword set after Step 3 stop-word filter is empty BUT prompt clearly carried non-time intent (≥3 residual content words); (iv) literal `session_id=` substring present but malformed (not matching `[a-f0-9-]{36}` UUID); (v) entry = E2/E4 AND patterns yield BOTH time + keywords but they appear in unconnected clauses (LLM-judged separation) | Step 5 fallback (`AskUserQuestion` with structured options) |
| **PARSE-MISS (silent skip)** | None of above match AND entry ∈ {E1, E3, E5} | Fall through with `range = "all"` sentinel; no user prompt |

Implementation note: the LLM's evaluation MUST proceed top-to-bottom — HIGH
checks first, then MEDIUM, then LOW. The first match wins. Do not skip
categories or pick LOW preemptively to avoid commitment — that defeats the
deterministic-parser contract and reintroduces the rc.32 audit P0 (T4) issue.

#### Step 1 — Invocation context inspection

Read three sources to determine whether a range hint is present:

| Source | Inspection | Yields |
|---|---|---|
| User prompt text (the natural-language string that triggered the skill) | Free-form parse for time words + topic keywords + literal `session_id=...` | Candidate `time_window`, `topic_keywords[]`, `explicit_session_ids[]` |
| Hook-context-marker (only when entry = E1 hook-triggered) | Already-parsed `{count, hours_since_last, sessions_since_last_proposed}` block emitted by archive-hint.cjs | Optional default scope = "since last archive" |
| User invocation type | E1 / E2 / E3 / E4 / E5 (per rc.25 5-entry model) | Decides whether to fall back to `AskUserQuestion` (E2/E4 only) |

If NONE of the three yields a usable hint AND `user_invocation_type ∉ {E2, E4}`,
fall through directly to Phase 0.5 with `range = "all"` sentinel (legacy
behaviour). E2 / E4 with no hint → proceed to Step 5 fallback.

#### Steps 2-6 (ref-only)

For the full **Step 2** bilingual time-window pattern tables (zh-CN + en), **Step 3** topic-keyword extraction algorithm, **Step 4** session_id resolution pseudocode, **Step 5** AskUserQuestion fallback (E2/E4 only), **Step 6** carry-forward contract (`session_id[] | "all"`), and three worked examples (time-only / keyword-only / combined), `Read packages/cli/templates/skills/fabric-archive/ref/phase-0-range-resolution.md` (or `.claude/skills/fabric-archive/ref/phase-0-range-resolution.md` post-install).

Brief output contract: Phase 0 emits ONE of `session_id[]` (non-empty distinct list, scope filter for Phase 1) OR `"all"` sentinel (legacy anchor-walk). Never empty array.

### Phase 0.5 — Config Load

Before any candidate-gathering work, the skill MUST read
`.fabric/fabric-config.json` to resolve the following tunables (with documented
defaults if absent):

| Config field | Default | Used by |
|---|---|---|
| `archive_max_candidates_per_batch` | 8 | Phase 2 hard budget on candidates per Phase 3 batch |
| `archive_max_recent_paths` | 20 | Phase 2 cap on `recent_paths` enumeration |
| `archive_digest_max_sessions` | 10 | Phase 1 cap on cross-session digest load |

If `.fabric/fabric-config.json` is missing or unreadable, use defaults silently.

### UX i18n Policy

Read `.fabric/fabric-config.json` → `fabric_language` (`zh-CN` / `en` / `zh-CN-hybrid` / `match-existing`). Emit all user-facing prose in the resolved variant. Protected tokens (MCP tool names like `fab_extract_knowledge`, schema fields like `relevance_scope`, the verbatim `强 team` / `强 personal` / `默认 team` heuristic block) are NEVER translated.

`AskUserQuestion` policy: `header` + `question` translate; `options[]` are routing keys — stay English regardless of locale.

**For the full 5-class taxonomy + edge cases:** `Read packages/cli/templates/skills/fabric-archive/ref/i18n-policy.md` (or `.claude/skills/fabric-archive/ref/i18n-policy.md` post-install).


### Phase 1 — Collect Cross-Session Digests

Stitch together context from every session that has accumulated since the last `knowledge_proposed` event. The rc.7 Stop hook writes a per-session digest to `.fabric/.cache/session-digests/<session_id>.md` (≤5KB, contains top 10 user messages + edit_paths + 1-line title), so this phase is a tail-scan + read.

**5-step summary:**

1. Read `.fabric/events.jsonl` tail (last 200 lines). Tolerate ENOENT.
2. Walk backward → find most recent `knowledge_proposed` event as anchor (ts lower bound).
3. Forward-scan from anchor → collect distinct `session_id`s.
4. Load each `<session_id>.md` digest. Cap at `archive_digest_max_sessions` (default 10).
4.5. **(rc.25 TASK-05) Apply ledger filter state machine** — drop sessions per outcome ledger: `user_dismissed` (permanent), within 12h cooldown, or no high-value signal past `covered_through_ts`. Cross-session pending dedupe also gates Phase 3 candidate emission.
5. Concatenate digests into `### Cross-session digest` block; populate `source_sessions[]` + `session_context` for Phase 4.

For the full Step 4.5 ledger state machine (rules a-f), `ANTI_LOOP_HOURS` / `HIGH_VALUE_EVENT_TYPES` / `NORMATIVE_KEYWORDS` constants, and 3 worked examples (user_dismissed / cooldown / re-scan-with-signal), `Read packages/cli/templates/skills/fabric-archive/ref/phase-1-cross-session.md` (or `.claude/skills/fabric-archive/ref/phase-1-cross-session.md` post-install).

Graceful degradation: missing digest cache → empty context, Phase 2 single-session fallback. Missing `session_archive_attempted` events (pre-rc.25) → Step 4.5 rule (e) applies uniformly (legacy "scan everything since anchor").

### Phase 1.5 — First-run Onboard (ref-only)

**SKIP this phase entirely unless** entry_point ∈ {E2_explicit_user_invoke, E4_user_range_rollback} AND a fresh `fab onboard-coverage --json` reports `missing.length > 0`. For E1 (hook), E3 (AI self-trigger), and E5 (cron), onboard is non-applicable — silently fall through to Phase 0.

When the gate above does fire (live user + missing slots), `Read packages/cli/templates/skills/fabric-archive/ref/phase-1-5-onboard.md` (or `.claude/skills/fabric-archive/ref/phase-1-5-onboard.md` post-install) for the full Step 1-4 (coverage check → user prompt → tour-and-propose) procedure.

### Phase 2 — Collect Candidates

Gather raw evidence from the recent session before any classification:

1. Read the tail of `.fabric/events.jsonl` since the last `knowledge_proposed` event.
   - Use `Bash` with `tail -n 200 .fabric/events.jsonl` if the file is large.
   - Tolerate ENOENT — empty ledger is a normal first-run state.
2. Enumerate `recent_paths`: workspace files touched by Read/Edit/Write in the current session. Cap at `archive_max_recent_paths` most-recent paths (config-resolved, default 20).
3. Distill `user_messages_summary`: a compact (≤500 char) prose summary of what the user asked for and what was decided. NOT a verbatim transcript.
4. Build a candidate list: each candidate is one observation that MIGHT be worth archiving.

Hard budget: `archive_max_candidates_per_batch` candidates max per Phase 3 batch (config-resolved, default 8). If more surface, keep the configured-N with strongest worth-archiving signals (see Phase 3 type definitions) and drop the rest.

### Phase 2.5 — Viability Gate (Anti-Archive Guard)

Coarse viability check before Phase 3 batch review. Goal: short-circuit obvious no-archive sessions (routine execution, typo fixes, narrow renames).

**Archive signals (≥ 1 hit ⇒ gate PASS):**

1. Explicit normative language (`always`/`never`/`以后`/`下次注意`/`记一下`/`from now on`/`永远不要`).
2. Wrong-turn-and-revert (edit-then-undo with diagnosis).
3. Long diagnostic loop (> 15 min or > ~10 tool turns).
4. New dependency adoption (package.json / pyproject.toml diff adds dep).
5. New pattern emergence (named abstraction/convention).
6. Decision confirmation (≥ 2 alternatives + rationale).
7. Explicit dismissal-with-reason.
8. Process formalization (load-bearing step order).

**Anti-archive signals (force FAIL unless ≥ 1 archive signal also fires):** typo-only / pure refactor / narrow rename / duplicate-of-existing-canonical.

**Gate decision:**

```
IF user_explicit_invoke:    gate = PASS
ELIF archive_signals_hit == 0:  gate = FAIL (reason="no_signal")
ELSE:                         gate = PASS  # any archive signal overrides anti-archive
```

**On gate FAIL — branch by entry_point:**

- `E1_hook` / `E3_ai_self_trigger` / `E5_cron` → SILENT-SKIP path. No message, no AskUserQuestion. Still emit Phase 4.5 `session_archive_attempted` event with `outcome='skipped_no_signal'`. Exit silently.
- `E2_explicit` / `E4_user_range` → User-active path. Render gate-FAIL message (i18n class 2, see ref). Emit Phase 4.5 event with `outcome='viability_failed'`. Exit.

**On gate PASS:** proceed to Phase 3 with carried-over candidates.

For verbose signal explanations, zh-CN/en gate-FAIL message bodies, and the events.jsonl 4KB POSIX atomicity constraint note (single-line + self-truncate rules), `Read packages/cli/templates/skills/fabric-archive/ref/phase-2-5-viability.md` (or `.claude/skills/fabric-archive/ref/phase-2-5-viability.md` post-install).

### Phase 3 — Classify, Layer, Slug, Review

For each candidate, the skill proposes:

- **type** ∈ {model, decision, guideline, pitfall, process}
- **layer** ∈ {team, personal} via the verbatim heuristic below
- **slug** per the 5-rule naming guideline below
- **summary** (1-2 sentences, will become the entry body's lead paragraph)

#### Five Knowledge Types

`{model, decision, guideline, pitfall, process}` — singular noun = type concept. Pick one type per candidate; skip if none fits (not yet ripe is also a valid outcome).

For verbose worth-archive vs skip-it signals per type with positive/negative examples, see `ref/phase-3-classify.md`.

#### Layer Classification Heuristic (强 team 信号 / 强 personal 信号 / 默认 team)

> - **强 team**: 引用本项目代码、团队共识用语（"we decided"）、fabric-import 路径产物、业务领域、绑定本项目代码的 pitfall
> - **强 personal**: 第一人称偏好、跨项目通用、工具/编辑器偏好、个人工作流
> - **默认 team**: 安全偏置——错标 team 在 PR review 中会被发现，错标 personal 静默丢失

Resolution order: check 强 team signals first; only assign personal if 强 personal signals dominate AND no 强 team signal applies; otherwise default to team.

#### Slug Naming (5 rules)

1. kebab-case (lowercase letters, digits, hyphens only).
2. 2-5 words.
3. 20-40 chars total.
4. Semantic core only (drop articles/generics).
5. Unique within (type, layer) bucket — collisions → add discriminator, NOT counter.

Pass/fail examples → see `ref/phase-3-classify.md`.

#### Decision Tree

```
Observation worth keeping?
  NO → skip
  YES → fits {model, decision, guideline, pitfall, process}?
         NO → skip (not yet ripe)
         YES → assign type → apply layer heuristic → propose slug
               → batch review → user confirm → Phase 4: fab_extract_knowledge per candidate
```

#### Batch Review

Single-screen presentation of all candidates. UX i18n Policy classes 1 + 3 — structure + `Confirm?` prompt bilingualized; protected tokens verbatim; data values (slugs, paths, enum strings) NOT translated.

For en + zh-CN batch review templates with example output, `Read packages/cli/templates/skills/fabric-archive/ref/phase-3-classify.md` (or `.claude/skills/fabric-archive/ref/phase-3-classify.md` post-install).

User MAY inline-edit `type` / `layer` / `slug` / `relevance_scope` / `relevance_paths` before confirming. Editing `[relevance_scope=...]` triggers re-derivation per Phase 3.5 (narrow ⇒ recompute from edit_paths; broad ⇒ force `[]`).

### Phase 3.5 — Scope Decision + relevance_paths Derivation

After classify/layer/slug but BEFORE batch review output, assign a `relevance_scope` to each candidate and derive its `relevance_paths` array. These two fields drive rc.6 hint injection: narrow knowledge is gated by working in matching paths, broad knowledge is project-wide.

#### Scope decision (narrow vs broad)

```
relevance_scope =
    narrow  IF the candidate is tied to a specific module / file / subsystem
            AND there is explicit single-module evidence in edit_paths
            (i.e. all worth-keeping edits in this session concentrated in one
            module tree, OR the candidate explicitly references that module)

    broad   IF the candidate is cross-cutting / methodological / general
            (applies regardless of which path the agent is working in)

    broad   (default, on uncertainty — safe偏置 per Q-1 in handoff)
```

Special case — Personal layer ALWAYS resolves to `relevance_scope=broad` with `relevance_paths=[]`. Rationale: personal knowledge crosses projects; paths from one project do not generalize. If `layer=personal` and a narrow scope was tentatively chosen, auto-flip to `broad` and clear `relevance_paths`.

##### Examples

- `decision: single-cjs-hook-script` → `narrow` (tied to `templates/claude-hooks/` + `packages/cli/src/commands/hooks.ts`)
- `pitfall: deepmerge-array-replace-trap` → `broad` (cross-cutting JSON merge gotcha, applies anywhere deepMerge is used)
- `guideline: slug-naming-rules` → `broad` (methodology, no specific module)
- `model: wave-1-parallel-task-dag` → `narrow` (tied to `packages/cli/src/commands/plan.ts`)
- `guideline: indent-style-by-language` (personal layer) → `broad + []` (personal forces broad)

#### relevance_paths derivation (rc.5 single-signal: edit_paths)

rc.5 derives `relevance_paths` exclusively from `edit_paths` (Edit/Write/MultiEdit tool calls). Multi-signal (read_paths + body regex + symbols) deferred to rc.7. The algorithm has 6 steps:

1. COLLECT edit_paths from session transcript.
2. DEDUPE.
3. BLACKLIST FILTER (drop repo-root single files like README.md, package.json; drop trivial `**/*.<ext>` globs; drop read-only paths).
4. PUBLIC-PREFIX GENERALIZE (group ≥ 2 siblings into glob, depth ≤ 2; singletons kept literal).
5. SCOPE GATE (broad → force `[]`; narrow → use Step 4 result).
6. ATTACH READ-ONLY EVIDENCE as `## Evidence` block (NOT in relevance_paths).

For full pseudocode, a worked generalization example (5 sample paths → glob + literal output), and inline-edit re-derivation rules (narrow↔broad transitions), `Read packages/cli/templates/skills/fabric-archive/ref/phase-3-5-scope.md` (or `.claude/skills/fabric-archive/ref/phase-3-5-scope.md` post-install).

### Phase 4 — Persist via MCP

For each user-confirmed candidate, call `fab_extract_knowledge` ONCE. Do NOT batch multiple candidates into one call.

#### Output Contract (essentials)

`fab_extract_knowledge` call carries: `source_sessions[]` (T5 array), `recent_paths[]` (cap 20), `user_messages_summary` (≤500 chars), `type` ∈ {decisions, pitfalls, guidelines, models, processes} (plural directory-form), `slug` (kebab-case 2-5 words), `layer` ∈ {team, personal}, `relevance_scope` ∈ {narrow, broad}, `relevance_paths[]` (narrow ⇒ derived; broad ⇒ `[]`), `proposed_reason` (enum: `explicit-user-mark` | `diagnostic-then-fix` | `decision-confirmation` | `wrong-turn-revert` | `new-dependency-or-pattern` | `dismissal-with-reason`), `session_context` (3-5 line narrative).

Four OPTIONAL rc.23 triage fields (`intent_clues`, `tech_stack`, `impact`, `must_read_if`) — populate when the skill can infer cleanly; **omit rather than guess**.

For the full TypeScript call shape, the C1 triage-field inference table, the Phase-2.5-signal → `proposed_reason` mapping table, `session_context` format, and T5 array-form idempotency notes, `Read packages/cli/templates/skills/fabric-archive/ref/phase-4-mcp-persist.md` (or `.claude/skills/fabric-archive/ref/phase-4-mcp-persist.md` post-install).

Server returns `{ pending_path, idempotency_key }`. Display `pending_path` for the user. `idempotency_key = sha256({source_session, type, slug})` — calling twice with the same triple is SAFE (server merges evidence).

### Phase 4.5 — Persist Archive Attempt

MANDATORY closing step on every skill invocation — runs AFTER Phase 4 (success path) AND on every early-exit path (Phase 1 dropped-all, Phase 2.5 gate-FAIL silent-skip or user-active, Phase 3 batch user-dismissed). Drives the Q3.4 outcome state machine + cross-session digest rescan filter.

#### Dry-run override

See the unified `## Dry-run Scope` section at the end of this file for the full catalogue of writes suspended in dry-run mode. Summary for Phase 4.5: dry-run SKIPS the `session_archive_attempted` emit entirely; the read-side machinery (Phase 1 digest, Phase 2.5 gate, Phase 3 preview) runs normally so the user sees what WOULD have been written.

#### Event emission summary

Append ONE `session_archive_attempted` line to `.fabric/events.jsonl` PER `session_id` in the run scope. Single-line JSON ≤ 4KB (POSIX atomicity — see Phase 2.5 ref). Best-effort write: append failure → log stderr only, skill still exits successfully. Outcome ∈ {`proposed` | `viability_failed` | `user_dismissed` | `skipped_no_signal`}. `covered_through_ts` = max ts of events the skill examined for that session.

For the full jsonc event shape, the outcome decision matrix (4 terminal states × outcome / candidates_proposed / knowledge_proposed_ids columns), `covered_through_ts` watermark spec, multi-session emission rule, the bash echo append pattern, and an E5-cron-silent-skip worked trace, `Read packages/cli/templates/skills/fabric-archive/ref/phase-4-5-emit.md` (or `.claude/skills/fabric-archive/ref/phase-4-5-emit.md` post-install).

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
- NEVER write outside `.fabric/knowledge/pending/` — promotion to `.fabric/knowledge/<type>/` is rc.3 fab_review concern, NOT this skill.
- NEVER include an `id` field anywhere — pending entries have no id (late-bind on approve).
- NEVER classify a candidate as `personal` when a 强 team signal applies. Default to team on ambiguity.
- NEVER emit a non-empty `relevance_paths` when `relevance_scope=broad` — broad MUST always carry `relevance_paths=[]`.
- NEVER emit a non-empty `relevance_paths` when `layer=personal` — personal forces `relevance_scope=broad` + `relevance_paths=[]`.
- NEVER use multi-signal sources for relevance_paths in rc.5 — `edit_paths` is the SOLE source. `read_paths`, body regex, and symbol extraction are reserved for rc.7+.
- NEVER batch multiple candidates into a single fab_extract_knowledge call; one call per candidate.
- NEVER paraphrase the verbatim layer heuristic block above — the Chinese text is contract-locked.
- MUST preserve protected tokens exactly: `stable_id`, `knowledge_proposed`, `knowledge_archive_aborted`, `knowledge_scope_degraded`, `.fabric/knowledge/pending/`, `fab_extract_knowledge`, `relevance_paths`, `relevance_scope`, `narrow`, `broad`, `edit_paths`, `source_sessions`, `proposed_reason`, `session_context`, `intent_clues`, `tech_stack`, `impact`, `must_read_if`, `pending_path`, `layer`, `team`, `personal`, `MUST`, `NEVER`, `强 team`, `强 personal`, `默认 team`.

## Worked Examples (ref-only)

Three end-to-end fab_extract_knowledge call examples (decision/team, pitfall/team, guideline/personal) live in `packages/cli/templates/skills/fabric-archive/ref/worked-examples.md` (or `.claude/skills/fabric-archive/ref/worked-examples.md` post-install). Load when you want to see all required + optional fields populated together in a realistic shape.

## E5 Scheduled Daily Recap (ref-only)

Only relevant when entry_point=E5_cron (OS cron, `/loop`, or scheduled trigger). For interactive invocations, Phase 0 has already routed past this — nothing to load.

When E5 fires: `Read packages/cli/templates/skills/fabric-archive/ref/e5-cron-recap.md` (or `.claude/skills/fabric-archive/ref/e5-cron-recap.md` post-install) for `/loop` vs OS cron tradeoffs + the `今日复盘` magic-phrase parse contract.

## Dry-run Scope (unified)

`dry_run = true` (per Phase 4.5 detection rule — substring match on `--dry-run` | `dry-run` | `dry_run` | `预览` token) suspends ALL side-effecting writes below; read-side machinery (Phase 1 digest collection, Phase 2.5 viability gate evaluation, Phase 3 candidate render) executes normally so the user can preview what WOULD happen.

| Write operation | Normal mode | Dry-run mode |
|---|---|---|
| `fab_extract_knowledge` MCP call (Phase 4) | One call per confirmed candidate, writes to `.fabric/knowledge/pending/<slug>.md` | SKIPPED. Phase 4 renders "would write N pending entries" preview table instead. |
| `session_archive_attempted` event (Phase 4.5) | Appended to `.fabric/events.jsonl` for every session in scope | SKIPPED entirely. No ledger entry. |
| `fab_review reject` (Phase 3 user-dismissed branch) | Invoked when user types `撤销` / `reject` after self-archive proposal | SKIPPED. The dismissal is rendered to console but no MCP write occurs. |
| `fab onboard-coverage` slot writes (Phase 1.5 fill-all / dismiss-all) | Each `Bash("fab config dismiss-slot <slot>")` invocation runs | SKIPPED. Slot decisions are shown as "would dismiss/propose" preview. |
| `.fabric/.cache/session-digests/<session_id>.md` reads | Read freely (read-side, safe) | Read freely — same as normal. |
| Stop-hook / archive-hint stdin/stdout | Read-only inspection of `.fabric/events.jsonl` | Same — no change. |

All user-facing output in dry-run mode MUST prefix `[DRY-RUN]` at the start of each Phase header (e.g. `[DRY-RUN] Phase 3 — Batch Review`). Exit message: `[DRY-RUN complete] would have written N entry/entries; no .fabric/ files were modified. Re-invoke without --dry-run to commit.`

Cross-reference: Phase 4.5 §Dry-run override holds the rationale; this section is the authoritative catalogue of skipped writes. When adding a new write side-effect to any phase, update BOTH the phase section AND this table.
