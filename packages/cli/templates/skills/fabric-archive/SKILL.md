---
name: fabric-archive
description: Use this skill when the Stop-hook signals an archive opportunity (events.jsonl shows ≥5 plan_context entries since the last knowledge_proposed event, or ≥24h elapsed since the last archive), OR when the user explicitly invokes archival. The skill classifies recent session candidates into one of five knowledge types (model/decision/guideline/pitfall/process), assigns a layer (team/personal) via the verbatim heuristic, proposes a slug, presents one batch review, and persists confirmed entries through the fab_extract_knowledge MCP tool to .fabric/knowledge/pending/.
allowed-tools: Read, Glob, Grep, Bash, mcp__fabric__fab_extract_knowledge
---

## Precondition

This skill is invoked when one of the following holds:

- The Stop-hook printed a stdout JSON pointer of shape `{"decision":"block","reason":"..."}` mentioning fabric-archive
- The user typed an explicit archive request (e.g. "archive what we just did", "fabric archive")
- A task wrap-up moment where the agent itself判定 a worth-keeping insight has surfaced

If none of the above hold, stop the skill immediately and tell the user `没有触发归档信号；如需手动归档请显式调用 fabric-archive`.

This skill is `Check-not-Ask`, not a preference interview:

- Phase 0 proactively gathers candidate evidence from the session
- Phase 1 presents one batch review for user correction
- Phase 2 calls `fab_extract_knowledge` once per confirmed candidate

## 执行流程 (3 Phase / 1 User Review Round)

### Phase 0 — Collect Candidates

Gather raw evidence from the recent session before any classification:

1. Read the tail of `.fabric/events.jsonl` since the last `knowledge_proposed` event.
   - Use `Bash` with `tail -n 200 .fabric/events.jsonl` if the file is large.
   - Tolerate ENOENT — empty ledger is a normal first-run state.
2. Enumerate `recent_paths`: workspace files touched by Read/Edit/Write in the current session. Cap at 20 most-recent paths.
3. Distill `user_messages_summary`: a compact (≤500 char) prose summary of what the user asked for and what was decided. NOT a verbatim transcript.
4. Build a candidate list: each candidate is one observation that MIGHT be worth archiving.

Hard budget: 8 candidates max per Phase 1 batch. If more surface, keep the 8 with strongest worth-archiving signals (see Phase 1 type definitions) and drop the rest.

### Phase 1 — Classify, Layer, Slug, Review

For each candidate, the skill proposes:

- **type** ∈ {model, decision, guideline, pitfall, process}
- **layer** ∈ {team, personal} via the verbatim heuristic below
- **slug** per the 5-rule naming guideline below
- **summary** (1-2 sentences, will become the entry body's lead paragraph)

#### Five Knowledge Types (singular noun = type concept)

- **model** — A reusable mental abstraction or domain object schema. Worth-archive signal: the user names something ("the X pattern", "the Y phase"). Skip-it signal: ad-hoc terminology used once. Positive: "Wave-1/Wave-2 task DAG decomposition for parallel-safe planning". Negative: "the thing we did just now" (too thin, no reusable abstraction).
- **decision** — A choice between alternatives with rationale. Worth-archive signal: ≥2 options were weighed AND a rationale was given. Skip-it signal: the choice was forced by external constraint with no real alternative. Positive: "Single .cjs hook script over three per-client scripts — rationale: identical stdout JSON shape across Claude/Codex". Negative: "Used the existing fab_extract_knowledge schema" (no alternative was considered).
- **guideline** — A normative rule for future similar situations. Worth-archive signal: the user said "always" / "never" / "from now on". Skip-it signal: a one-off preference that won't generalize. Positive: "Slug naming: kebab-case, 2-5 words, 20-40 chars, semantic core only". Negative: "Use 4-space indent in this one file" (too narrow).
- **pitfall** — A trap that wasted time and is non-obvious. Worth-archive signal: a bug took >15 min to diagnose AND is repeatable. Skip-it signal: a typo or one-time API quirk. Positive: "deepMerge replaces arrays — hooks.Stop[] needs special-case append-with-dedupe". Negative: "Forgot a comma in JSON" (too obvious).
- **process** — A multi-step procedure with a stable shape. Worth-archive signal: the steps were executed in a specific order AND the order matters. Skip-it signal: a one-shot script with no reusable structure. Positive: "fab_review approve = counter++ → frontmatter inject → git mv → meta rebuild → event append (5 atomic steps)". Negative: "Ran the tests, then committed" (trivial, no reusable shape).

#### Layer Classification Heuristic (强 team 信号 / 强 personal 信号 / 默认 team)

> - **强 team**: 引用本项目代码、团队共识用语（"we decided"）、fabric-import 路径产物、业务领域、绑定本项目代码的 pitfall
> - **强 personal**: 第一人称偏好、跨项目通用、工具/编辑器偏好、个人工作流
> - **默认 team**: 安全偏置——错标 team 在 PR review 中会被发现，错标 personal 静默丢失

Resolution order: check 强 team signals first; only assign personal if 强 personal signals dominate AND no 强 team signal applies; otherwise default to team.

#### Slug Naming Guideline (5 Rules)

1. kebab-case (lowercase letters, digits, hyphens only — no underscores, no CamelCase)
2. 2-5 words separated by hyphens
3. 20-40 characters total length
4. semantic core only (drop articles "the/a", drop generic suffixes "stuff/thing")
5. unique within its (type, layer) bucket — if collision, the LLM must add a discriminating word, NOT a counter

Examples passing: `wave-1-parallel-task-dag` (4 words, 24 chars), `deepmerge-array-replace-trap` (4 words, 28 chars). Examples failing: `the_solution` (underscore + article), `fix` (1 word, too short), `how-we-decided-to-handle-the-merge-conflict-in-stop-hook-config` (overlong).

#### Decision Tree (是否值得归档)

```
Recent session contains an observation worth keeping?
  ├─ NO → skip (do nothing, no MCP call)
  └─ YES → does it fit one of {model, decision, guideline, pitfall, process}?
            ├─ NO → skip (not classifiable = not yet ripe)
            └─ YES → assign type
                      ↓
                Apply layer heuristic
                      ↓
                Propose slug per 5 rules
                      ↓
                Present in batch review
                      ↓
                User confirms / corrects / rejects
                      ↓
                Phase 2: call fab_extract_knowledge once per confirmed candidate
```

#### Batch Review Template

Present all candidates in a single screen using this exact structure:

```md
# Archive Review — N candidates

## C1 [type=decision] [layer=team] slug=wave-1-parallel-task-dag
Summary: <1-2 sentences capturing the observation>
Layer reasoning: <which 强 team / 强 personal signal applied, or default team>
Confirm? (Y to accept, edit type/layer/slug inline, N to skip)

## C2 [type=pitfall] [layer=team] slug=deepmerge-array-replace-trap
Summary: ...
Layer reasoning: ...
Confirm? ...
```

The user MAY edit type/layer/slug inline before confirming. The user MAY skip individual candidates without rejecting the whole batch.

### Phase 2 — Persist via MCP

For each user-confirmed candidate, call `fab_extract_knowledge` ONCE. Do NOT batch multiple candidates into one call.

#### Output Contract (MCP tool call shape)

```ts
mcp__fabric__fab_extract_knowledge({
  source_session: "<session id from current invocation>",
  recent_paths: ["<path1>", "<path2>", ...],   // capped at 20
  user_messages_summary: "<compact prose ≤500 chars>",
  type: "decisions" | "pitfalls" | "guidelines" | "models" | "processes",
  slug: "<kebab-case-2-to-5-words>"
  // tags? — NOT in current schema; reserved for future
})
```

Note on type plurality: the MCP enum uses plural directory-form (decisions / pitfalls / guidelines / models / processes), while the conceptual classification above uses singular nouns (decision / pitfall / guideline / model / process) for natural English. They map 1:1.

The server returns `{ pending_path, idempotency_key }`. Display `pending_path` to the user so they can `Read` the persisted entry if they wish.

#### Idempotency Note

The MCP tool derives `idempotency_key = sha256({source_session, type, slug})`. Calling fab_extract_knowledge twice with the same `(source_session, type, slug)` triple is SAFE: the server appends new evidence to the existing pending file rather than overwriting or producing duplicates. This means the skill MAY be re-invoked on the same session without producing junk.

If the skill needs to record a genuinely separate observation in the same session+type, the slug MUST differ.

## Hard Rules (DO NOT TRANSLATE) — DISPLAY / WRITE Split

### DISPLAY Rules

- MUST complete Phase 0 before any batch-review output.
- MUST present every candidate with explicit `[type=...]`, `[layer=...]`, and `slug=...` fields.
- MUST include a one-line `Layer reasoning:` for each candidate citing which 强 team / 强 personal signal applied (or default team).
- MUST classify against the canonical singular nouns: model / decision / guideline / pitfall / process. NEVER invent new types.
- MUST cap the batch at 8 candidates; drop weaker ones over the cap.
- MUST display the resolved `pending_path` returned by `fab_extract_knowledge` so the user can verify.
- MUST treat user inline edits to type/layer/slug as authoritative replacements before Phase 2.
- MUST skip rather than guess when an observation does not fit any of the 5 types.

### WRITE Rules

- NEVER write a knowledge entry directly to the filesystem; the only legal write path is `mcp__fabric__fab_extract_knowledge`.
- NEVER write outside `.fabric/knowledge/pending/` — promotion to `.fabric/knowledge/<type>/` is rc.3 fab_review concern, NOT this skill.
- NEVER include an `id` field anywhere — pending entries have no id (late-bind on approve).
- NEVER classify a candidate as `personal` when a 强 team signal applies. Default to team on ambiguity.
- NEVER batch multiple candidates into a single fab_extract_knowledge call; one call per candidate.
- NEVER paraphrase the verbatim layer heuristic block above — the Chinese text is contract-locked.
- MUST preserve protected tokens exactly: `stable_id`, `knowledge_proposed`, `.fabric/knowledge/pending/`, `fab_extract_knowledge`, `MUST`, `NEVER`, `强 team`, `强 personal`, `默认 team`.

## Worked Examples

### Example 1 — decision (team)

Session: User and agent debated whether the Stop-hook should be one .cjs script or three per-client scripts. Settled on one because stdout JSON shape `{"decision":"block","reason"}` is identical across Claude / Codex.

Skill output:

```ts
mcp__fabric__fab_extract_knowledge({
  source_session: "WFS-2026-05-10-rc2",
  recent_paths: ["templates/claude-hooks/", "packages/cli/src/commands/hooks.ts"],
  user_messages_summary: "User pushed back on three-script proposal; agreed single .cjs because stdout JSON shape is universal across Claude Code and Codex CLI.",
  type: "decisions",
  slug: "single-cjs-hook-script"
})
```

Layer = team (引用本项目代码 + fabric-import 路径产物 signals).

### Example 2 — pitfall (team)

Session: deepMerge silently replaced the existing `hooks.Stop[]` array in `.claude/settings.json` instead of appending. Cost ~30 min to diagnose.

Skill output:

```ts
mcp__fabric__fab_extract_knowledge({
  source_session: "WFS-2026-05-10-rc2",
  recent_paths: ["packages/cli/src/config/json.ts"],
  user_messages_summary: "deepMerge default behavior REPLACES arrays. hooks.Stop[] needs an array-append-with-dedupe special case keyed on .command string match.",
  type: "pitfalls",
  slug: "deepmerge-array-replace-trap"
})
```

Layer = team (绑定本项目代码的 pitfall signal).

### Example 3 — guideline (personal)

Session: User mentioned across three projects that they prefer 2-space indent in TypeScript and 4-space in Python.

Skill output:

```ts
mcp__fabric__fab_extract_knowledge({
  source_session: "WFS-2026-05-10-rc2",
  recent_paths: [".editorconfig"],
  user_messages_summary: "Personal indent preference: 2-space TS / 4-space Py. Stable across multiple projects, not project-specific.",
  type: "guidelines",
  slug: "indent-style-by-language"
})
```

Layer = personal (跨项目通用 + 工具/编辑器偏好 signals dominate; no 强 team signal applies).
