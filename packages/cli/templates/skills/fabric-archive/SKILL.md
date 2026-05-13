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
- Phase 0.5 viability gate aborts the skill if the session lacks any archive-signal (anti-archive guard)
- Phase 1 classifies / layers / slugs each candidate and presents one batch review for user correction
- Phase 1.5 assigns `scope=narrow|broad` and derives `relevance_paths` from edit history (rc.5 single-signal source)
- Phase 2 calls `fab_extract_knowledge` once per confirmed candidate

## 执行流程 (5 Phase / 1 User Review Round)

### Phase 0.0 — Collect Cross-Session Digests (v2.0.0-rc.7 T5)

Before any single-session collection or viability gating, stitch together
context from every session that has accumulated since the last
`knowledge_proposed` event. The rc.7 Stop hook writes a per-session digest to
`.fabric/.cache/session-digests/<session_id>.md` (≤5KB, contains top 10 user
messages + edit_paths + 1-line title), so this phase is a tail-scan + read.

1. **Read events.jsonl tail.** Use `Bash` with
   `tail -n 200 .fabric/events.jsonl` (tolerate ENOENT — empty ledger is a
   normal first-run state).
2. **Find the anchor.** Walk the tail backwards to locate the most recent
   `knowledge_proposed` event (`event_type === "knowledge_proposed"`). The
   anchor's `ts` becomes the lower bound for digest selection. If NO anchor
   exists, treat all digests in the cache as in-scope.
3. **Collect session_ids since anchor.** Scan the tail forward from the
   anchor and collect every distinct `session_id` field that appears on any
   event newer than the anchor. Distinct ordering preserved.
4. **Load digests.** For each collected `session_id`, read
   `.fabric/.cache/session-digests/<session_id>.md`. Missing digest files
   degrade silently (the digest write was best-effort, so a Stop hook crash
   can produce a session_id without a digest). Cap the loaded digest set at
   10 most-recent sessions to bound LLM context (~50KB worst-case).
5. **Build cross-session context.** Concatenate the loaded digests into a
   single `### Cross-session digest` block to carry into Phase 0.5 + Phase 1.
   Use this block to:
   - Detect session-spanning patterns (e.g. a discussion that started in
     session A and continued in session B).
   - Populate the `source_sessions` array on every fab_extract_knowledge
     call — the array form (T5) replaces the legacy `source_session` string.
   - Inform the `session_context` blob written to each pending entry's body
     (3-5 lines summarizing goal + key turning point, per T6).

Graceful degradation: if `.fabric/.cache/session-digests/` is missing
entirely, this phase reports an empty context and Phase 0 falls back to the
single-session behaviour. Tests that synthesize events.jsonl without
populating the digest cache continue to work.

### Phase 0 — Collect Candidates

Gather raw evidence from the recent session before any classification:

1. Read the tail of `.fabric/events.jsonl` since the last `knowledge_proposed` event.
   - Use `Bash` with `tail -n 200 .fabric/events.jsonl` if the file is large.
   - Tolerate ENOENT — empty ledger is a normal first-run state.
2. Enumerate `recent_paths`: workspace files touched by Read/Edit/Write in the current session. Cap at 20 most-recent paths.
3. Distill `user_messages_summary`: a compact (≤500 char) prose summary of what the user asked for and what was decided. NOT a verbatim transcript.
4. Build a candidate list: each candidate is one observation that MIGHT be worth archiving.

Hard budget: 8 candidates max per Phase 1 batch. If more surface, keep the 8 with strongest worth-archiving signals (see Phase 1 type definitions) and drop the rest.

### Phase 0.5 — Viability Gate (Anti-Archive Guard)

Before producing any candidate output, run a coarse viability check on the session as a whole. The goal is to short-circuit obvious no-archive sessions (routine execution, typo fixes, narrow renames) so that Phase 1 batch review is never spent on noise.

#### Archive signals (≥ 1 hit ⇒ gate PASSES, proceed to Phase 1)

Scan `user_messages_summary` + `recent_paths` + the events tail collected in Phase 0:

1. Explicit normative language: user said `always` / `never` / `from now on` / `下次注意` / `记一下` / `以后` / `永远不要`.
2. Wrong-turn-and-revert: a path was edited, then reverted (or partially undone) after diagnosis — indicates a pitfall worth recording.
3. Long diagnostic loop: an issue took > 15 minutes (or > ~10 tool turns) of debugging before resolution.
4. New dependency adoption: a new package / library / external tool was introduced (e.g. `package.json` / `pyproject.toml` / `Cargo.toml` diff adds a dep).
5. New pattern emergence: a reusable abstraction or naming convention was named ("the X phase", "the Y pattern", "let's call this Z").
6. Decision confirmation: ≥ 2 alternatives were weighed AND a rationale was given before settling.
7. Explicit dismissal-with-reason: user rejected an approach AND stated why (the why is the archivable knowledge, not the dismissal itself).
8. Process formalization: a multi-step procedure was executed in a specific order AND the order was identified as load-bearing.

#### Anti-archive signals (forces gate to FAIL unless an archive signal also fires)

1. Typo-only edits: the entire session is whitespace / spelling / formatting changes.
2. Pure refactor: rename / move / extract with no behavior change AND no naming convention being established.
3. Narrow rename request: user asked to rename one symbol / file with no rationale.
4. Duplicate of existing canonical: the observation is already covered by an existing entry under `.fabric/knowledge/<type>/` (do a quick Glob before deciding).

#### Gate decision

```
archive_signals_hit   = count of archive signals fired
anti_signals_hit      = count of anti-archive signals fired
user_explicit_invoke  = user typed "archive what we just did" / "fabric archive" / similar

IF user_explicit_invoke:
    gate = PASS                          # explicit invocation bypasses all gates
ELIF archive_signals_hit == 0:
    gate = FAIL (reason="no_signal")
ELIF anti_signals_hit > 0 AND archive_signals_hit == 0:
    gate = FAIL (reason="anti_signal_dominates")
ELSE:
    gate = PASS
```

#### On gate FAIL

Stop the skill with the exact user-facing message:

```
本次会话为常规执行，无新知识可归档（gate=<reason>）。如需强制归档，请显式调用 fabric-archive。
```

Optionally append a one-line event to `.fabric/events.jsonl` of shape `{"ts":"...","kind":"knowledge_archive_aborted","reason":"<reason>","session":"<id>"}` if the events ledger is writable; otherwise just log to stderr. Do NOT proceed to Phase 1, do NOT call any MCP tool.

#### On gate PASS

Proceed to Phase 1 with the candidates carried over from Phase 0.

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

## C1 [type=decision] [layer=team] [scope=narrow] slug=wave-1-parallel-task-dag
Summary: <1-2 sentences capturing the observation>
Layer reasoning: <which 强 team / 强 personal signal applied, or default team>
Scope reasoning: <why narrow or broad — see Phase 1.5>
relevance_paths: ["packages/cli/src/commands/plan.ts", "packages/cli/templates/**/*.md"]
Confirm? (Y to accept, edit type/layer/slug/scope/relevance_paths inline, N to skip)

## C2 [type=pitfall] [layer=team] [scope=broad] slug=deepmerge-array-replace-trap
Summary: ...
Layer reasoning: ...
Scope reasoning: ...
relevance_paths: []
Confirm? ...
```

The user MAY edit type/layer/slug/scope/relevance_paths inline before confirming. The user MAY skip individual candidates without rejecting the whole batch. Inline-editing `[scope=...]` triggers a re-derivation of `relevance_paths` per the Phase 1.5 rules (narrow ⇒ recompute from edit_paths; broad ⇒ force `[]`).

### Phase 1.5 — Scope Decision + relevance_paths Derivation

After classify/layer/slug but BEFORE batch review output, assign a `scope` to each candidate and derive its `relevance_paths` array. These two fields drive rc.6 hint injection: narrow knowledge is gated by working in matching paths, broad knowledge is project-wide.

#### Scope decision (narrow vs broad)

```
scope =
    narrow  IF the candidate is tied to a specific module / file / subsystem
            AND there is explicit single-module evidence in edit_paths
            (i.e. all worth-keeping edits in this session concentrated in one
            module tree, OR the candidate explicitly references that module)

    broad   IF the candidate is cross-cutting / methodological / general
            (applies regardless of which path the agent is working in)

    broad   (default, on uncertainty — safe偏置 per Q-1 in handoff)
```

Special case — Personal layer ALWAYS resolves to `scope=broad` with `relevance_paths=[]`. Rationale: personal knowledge crosses projects; paths from one project do not generalize. If `layer=personal` and a narrow scope was tentatively chosen, auto-flip to `broad` and clear `relevance_paths`.

##### Examples

- `decision: single-cjs-hook-script` → `narrow` (tied to `templates/claude-hooks/` + `packages/cli/src/commands/hooks.ts`)
- `pitfall: deepmerge-array-replace-trap` → `broad` (cross-cutting JSON merge gotcha, applies anywhere deepMerge is used)
- `guideline: slug-naming-rules` → `broad` (methodology, no specific module)
- `model: wave-1-parallel-task-dag` → `narrow` (tied to `packages/cli/src/commands/plan.ts`)
- `guideline: indent-style-by-language` (personal layer) → `broad + []` (personal forces broad)

#### relevance_paths derivation algorithm (rc.5 single-signal: edit_paths only)

rc.5 uses ONLY the `edit_paths` signal — list of paths modified by `Edit` / `Write` / `MultiEdit` tool calls in the current session. Multi-signal (read_paths + body regex + symbols) is explicitly deferred to rc.7 per design decision.

```
Step 1: COLLECT
  edit_paths = []
  Scan session transcript for tool_use entries where
    tool_use.name ∈ {Edit, Write, MultiEdit}
  Extract the file_path argument from each, push into edit_paths.

Step 2: DEDUPE
  edit_paths = unique(edit_paths)

Step 3: BLACKLIST FILTER
  Drop paths matching any of:
    - **/*.<ext>          where <ext> is a single trivial extension on a single file
                          (i.e. avoid emitting bare **/*.md as a relevance pattern)
    - Repo-root single files: README.md, package.json, package-lock.json,
      pnpm-lock.yaml, tsconfig.json, .gitignore, LICENSE, CHANGELOG.md
    - Read-only paths (never modified) — those go to ## Evidence, not relevance_paths

Step 4: PUBLIC-PREFIX GENERALIZE (depth ≤ 2, minGroupSize = 2)
  Group remaining paths by common prefix.
  For each group of ≥ 2 sibling paths sharing a prefix:
    - Compute longest common directory prefix
    - Limit generalization depth: at most 2 levels below the common prefix
    - Emit glob: <common-prefix>/**/*.<ext>  (or <common-prefix>/**/<filename>)
  Singleton paths (group size = 1) are kept as-is (literal path, no glob).

Step 5: SCOPE GATE
  IF scope == broad → relevance_paths = []  (force empty regardless of edit_paths)
  IF scope == narrow → relevance_paths = result of Step 4

Step 6: ATTACH READ-ONLY EVIDENCE
  Read-only paths (filtered in Step 3) are emitted as a ## Evidence markdown
  block in the pending entry body — NOT in relevance_paths. They document
  what the agent consulted without making them part of the activation gate.
```

##### Worked generalization example

Edit history during session:

```
packages/server/src/services/extract.ts
packages/server/src/services/review.ts
packages/server/src/services/promote.ts
packages/cli/src/commands/plan.ts
README.md
```

Step 1-2 (collect + dedupe): all 5 unique.
Step 3 (blacklist): drop `README.md` (repo-root single file).
Step 4 (generalize, depth ≤ 2, minGroupSize = 2):
- `packages/server/src/services/{extract,review,promote}.ts` → group size 3 ≥ 2, common prefix `packages/server/src/services/`, glob: `packages/server/src/services/**/*.ts`
- `packages/cli/src/commands/plan.ts` → group size 1, kept literal.

Step 5 (assume `scope=narrow`):

```json
"relevance_paths": [
  "packages/server/src/services/**/*.ts",
  "packages/cli/src/commands/plan.ts"
]
```

If `scope=broad` had been chosen instead, `relevance_paths` would be `[]` regardless of the above.

#### Inline-edit support during batch review

The user MAY inline-edit `[scope=...]` in the batch review. When this happens:

- Edit changes `narrow → broad`: clear `relevance_paths` to `[]`.
- Edit changes `broad → narrow`: re-run Steps 1-4 of the derivation algorithm to recompute.
- The user MAY also directly inline-edit `relevance_paths` to a custom array; treat this as authoritative and skip auto-derivation.

### Phase 2 — Persist via MCP

For each user-confirmed candidate, call `fab_extract_knowledge` ONCE. Do NOT batch multiple candidates into one call.

#### Output Contract (MCP tool call shape)

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["<session id1>", "<session id2>", ...],  // T5: array form (Phase 0.0)
  recent_paths: ["<path1>", "<path2>", ...],   // capped at 20
  user_messages_summary: "<compact prose ≤500 chars>",
  type: "decisions" | "pitfalls" | "guidelines" | "models" | "processes",
  slug: "<kebab-case-2-to-5-words>",
  layer: "team" | "personal",
  scope: "narrow" | "broad",                   // from Phase 1.5
  relevance_paths: ["<glob1>", "<literal2>", ...],  // narrow ⇒ derived; broad ⇒ []
  // v2.0.0-rc.7 T6: required fields for future-self reviewability.
  proposed_reason:
    "explicit-user-mark"      // user said "always / never / 下次注意" etc.
    | "diagnostic-then-fix"   // long debug loop surfaced a new pattern/pitfall
    | "decision-confirmation" // ≥2 options weighed AND rationale stated → decision/model
    | "wrong-turn-revert"     // tried path X, reverted → pitfall
    | "new-dependency-or-pattern" // new dep/lib/abstraction introduced
    | "dismissal-with-reason",    // user rejected approach AND said why
  session_context: "<3-5 line markdown: session goal + key turning point>",
  // tags? — NOT in current schema; reserved for future
})
```

The Skill infers `proposed_reason` from the classification + viability-gate
signal that fired:

| Signal fired (Phase 0.5)       | Classification | Default proposed_reason     |
|--------------------------------|----------------|-----------------------------|
| Explicit normative language    | guideline      | `explicit-user-mark`        |
| Wrong-turn-and-revert          | pitfall        | `wrong-turn-revert`         |
| Long diagnostic loop           | pitfall/model  | `diagnostic-then-fix`       |
| New dependency adoption        | decision/model | `new-dependency-or-pattern` |
| New pattern emergence          | model          | `new-dependency-or-pattern` |
| Decision confirmation          | decision       | `decision-confirmation`     |
| Explicit dismissal-with-reason | decision       | `dismissal-with-reason`     |
| Process formalization          | process        | `new-dependency-or-pattern` |

The `session_context` is a 3-5 line summary distilled from the Phase 0.0
cross-session digest (see Phase 0.0 below for digest source). Format:

```
Session goal: <one-line of what the user was trying to accomplish>
Turning point: <one-line of the key moment that produced the worth-archive observation>
[optional 1-3 more lines of supporting context]
```

Future-self reviewing the pending entry MUST be able to understand WHY this
entry was proposed without conversation transcript access — proposed_reason
is the structured why, session_context is the narrative why.

Note on type plurality: the MCP enum uses plural directory-form (decisions / pitfalls / guidelines / models / processes), while the conceptual classification above uses singular nouns (decision / pitfall / guideline / model / process) for natural English. They map 1:1.

The server returns `{ pending_path, idempotency_key }`. Display `pending_path` to the user so they can `Read` the persisted entry if they wish.

#### Idempotency Note

The MCP tool derives `idempotency_key = sha256({source_session, type, slug})`. Calling fab_extract_knowledge twice with the same `(source_session, type, slug)` triple is SAFE: the server appends new evidence to the existing pending file rather than overwriting or producing duplicates. This means the skill MAY be re-invoked on the same session without producing junk.

If the skill needs to record a genuinely separate observation in the same session+type, the slug MUST differ.

## Hard Rules (DO NOT TRANSLATE) — DISPLAY / WRITE Split

### DISPLAY Rules

- MUST complete Phase 0 AND Phase 0.5 viability gate before any batch-review output.
- MUST abort with the gate-FAIL message (no MCP call) when the viability gate fails AND the user did not explicitly invoke fabric-archive.
- MUST present every candidate with explicit `[type=...]`, `[layer=...]`, `[scope=...]`, and `slug=...` fields plus a `relevance_paths` line.
- MUST include a one-line `Layer reasoning:` for each candidate citing which 强 team / 强 personal signal applied (or default team).
- MUST include a one-line `Scope reasoning:` for each candidate citing why narrow or broad was chosen (or that personal forced broad).
- MUST classify against the canonical singular nouns: model / decision / guideline / pitfall / process. NEVER invent new types.
- MUST cap the batch at 8 candidates; drop weaker ones over the cap.
- MUST display the resolved `pending_path` returned by `fab_extract_knowledge` so the user can verify.
- MUST treat user inline edits to type/layer/slug/scope/relevance_paths as authoritative replacements before Phase 2.
- MUST skip rather than guess when an observation does not fit any of the 5 types.

### WRITE Rules

- NEVER write a knowledge entry directly to the filesystem; the only legal write path is `mcp__fabric__fab_extract_knowledge`.
- NEVER write outside `.fabric/knowledge/pending/` — promotion to `.fabric/knowledge/<type>/` is rc.3 fab_review concern, NOT this skill.
- NEVER include an `id` field anywhere — pending entries have no id (late-bind on approve).
- NEVER classify a candidate as `personal` when a 强 team signal applies. Default to team on ambiguity.
- NEVER emit a non-empty `relevance_paths` when `scope=broad` — broad MUST always carry `relevance_paths=[]`.
- NEVER emit a non-empty `relevance_paths` when `layer=personal` — personal forces `scope=broad` + `relevance_paths=[]`.
- NEVER use multi-signal sources for relevance_paths in rc.5 — `edit_paths` is the SOLE source. `read_paths`, body regex, and symbol extraction are reserved for rc.7+.
- NEVER batch multiple candidates into a single fab_extract_knowledge call; one call per candidate.
- NEVER paraphrase the verbatim layer heuristic block above — the Chinese text is contract-locked.
- MUST preserve protected tokens exactly: `stable_id`, `knowledge_proposed`, `knowledge_archive_aborted`, `.fabric/knowledge/pending/`, `fab_extract_knowledge`, `relevance_paths`, `scope`, `narrow`, `broad`, `edit_paths`, `MUST`, `NEVER`, `强 team`, `强 personal`, `默认 team`.

## Worked Examples

### Example 1 — decision (team)

Session: User and agent debated whether the Stop-hook should be one .cjs script or three per-client scripts. Settled on one because stdout JSON shape `{"decision":"block","reason"}` is identical across Claude / Codex.

Skill output:

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["WFS-2026-05-10-rc2"],
  recent_paths: ["templates/claude-hooks/", "packages/cli/src/commands/hooks.ts"],
  user_messages_summary: "User pushed back on three-script proposal; agreed single .cjs because stdout JSON shape is universal across Claude Code and Codex CLI.",
  type: "decisions",
  slug: "single-cjs-hook-script",
  layer: "team",
  scope: "narrow",
  relevance_paths: [
    "templates/claude-hooks/**/*.cjs",
    "packages/cli/src/commands/hooks.ts"
  ],
  proposed_reason: "decision-confirmation",
  session_context: "Session goal: ship Stop-hook for v2 release.\nTurning point: user rejected 3-script proposal after seeing identical stdout JSON across Claude / Codex.\nResult: single .cjs path locked in."
})
```

Layer = team (引用本项目代码 + fabric-import 路径产物 signals). Scope = narrow (tied to hook templates + hooks command module; single-module evidence in edit_paths).

### Example 2 — pitfall (team)

Session: deepMerge silently replaced the existing `hooks.Stop[]` array in `.claude/settings.json` instead of appending. Cost ~30 min to diagnose.

Skill output:

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["WFS-2026-05-10-rc2"],
  recent_paths: ["packages/cli/src/config/json.ts"],
  user_messages_summary: "deepMerge default behavior REPLACES arrays. hooks.Stop[] needs an array-append-with-dedupe special case keyed on .command string match.",
  type: "pitfalls",
  slug: "deepmerge-array-replace-trap",
  layer: "team",
  scope: "broad",
  relevance_paths: [],
  proposed_reason: "diagnostic-then-fix",
  session_context: "Session goal: wire hook installer for v2.\nTurning point: spent ~30 min chasing why prior Stop[] entries vanished — root cause was deepMerge replacing arrays silently.\nResult: array-append-with-dedupe special case added."
})
```

Layer = team (绑定本项目代码的 pitfall signal). Scope = broad (deepMerge gotcha is cross-cutting — applies anywhere JSON merge is used, not just `json.ts`).

### Example 3 — guideline (personal)

Session: User mentioned across three projects that they prefer 2-space indent in TypeScript and 4-space in Python.

Skill output:

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["WFS-2026-05-10-rc2"],
  recent_paths: [".editorconfig"],
  user_messages_summary: "Personal indent preference: 2-space TS / 4-space Py. Stable across multiple projects, not project-specific.",
  type: "guidelines",
  slug: "indent-style-by-language",
  layer: "personal",
  scope: "broad",
  relevance_paths: [],
  proposed_reason: "explicit-user-mark",
  session_context: "Session goal: align editor config.\nTurning point: user said '一直 prefer 2-space TS / 4-space Py，across projects'.\nResult: personal-layer guideline; not bound to this project."
})
```

Layer = personal (跨项目通用 + 工具/编辑器偏好 signals dominate; no 强 team signal applies). Scope = broad with `relevance_paths=[]` (personal layer ALWAYS forces broad — paths don't generalize across projects per Phase 1.5 special case).
