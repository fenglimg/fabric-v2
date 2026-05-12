---
name: fabric-import
description: Use this skill for cold-start enrichment of `.fabric/knowledge/` from existing project artifacts — mines `git log` and `docs/*.md` for candidate observations, proposes pending entries via `fab_extract_knowledge`, then deduplicates against canonical entries via `fab_review action: search` (rejecting obvious duplicates, modifying-to-merge marginal duplicates). Triggered by user prompts like "import knowledge from git history" / "bootstrap fabric for this repo" or by an explicit fabric-import skill mention. Default layer: team (project artifacts are team-shared). The 3-phase pipeline is resumable via `.fabric/.import-state.json`.
allowed-tools: Read, Glob, Grep, Bash, mcp__fabric__fab_extract_knowledge, mcp__fabric__fab_review
---

## Purpose

`fabric-import` is a one-time (per project) cold-start skill that lifts existing project artifacts — git commit history and Markdown documentation — into the knowledge layer as pending entries. It is the bridge between a brand-new Fabric installation (which only has the 4–7 baseline entries produced by `fabric init`'s deterministic scan) and a useful corpus that reflects accumulated team thinking. Run it once when adopting Fabric on an existing repo, or after a major refactor that invalidates large chunks of canonical knowledge. Default layer is `team`: project artifacts in git/docs are team-shared by definition; the user can later layer-flip individual entries to `personal` via `fabric-review` modify.

## Precondition

This skill is invoked when one of the following holds:

- The user typed an explicit import request (e.g. "import knowledge from git history", "bootstrap fabric for this repo", "mine the changelog into pending", "fabric import")
- The user explicitly mentioned this skill by name (`fabric-import`)
- A `fabric import` CLI command was run (rc.4 wires this if shipped; otherwise treat as user prompt)

If none of the above hold, stop the skill immediately and tell the user `没有触发 import 信号；如需手动 import 请显式调用 fabric-import`.

This skill SHOULD be skipped (warn the user, do not proceed) when:

- `.fabric/` does not exist — direct the user to run `fabric init` first; `fabric-import` is NOT a substitute for the deterministic init-scan
- `.fabric/knowledge/` already holds **>50 canonical entries** across all types — the project is mature; use `fabric-archive` (per-session capture) and `fabric-review` (lifecycle review) instead; bulk import would just create dup churn
- `.fabric/.import-state.json` exists with `phase: "complete"` and `last_checkpoint_at` is **<24h ago** — the user just ran import; surface the prior result rather than re-running

Required preconditions before any MCP call:

- `.fabric/` directory exists in the project root
- `.fabric/agents.meta.json` is present (init produced it; the id allocator reads it on later approve)
- `.fabric/events.jsonl` exists (tolerate ENOENT — empty ledger is normal first-run)
- `mcp__fabric__fab_extract_knowledge` AND `mcp__fabric__fab_review` MCP tools are registered and reachable
- Working tree is reasonably clean (large uncommitted churn pollutes git-log mining; warn but allow)

## 3-Phase Pipeline (P1 reference / P2 mine / P3 dedup)

The pipeline runs strictly in order. Each phase reads the prior phase's outputs and updates `.fabric/.import-state.json` after every successful sub-step (not just at phase end). The skill is `Infer-not-Ask` for which phase to run (always all three when starting fresh, or resumes from the checkpoint phase).

### Phase 1 — Init-Scan Reference (NO RE-IMPLEMENTATION)

> Verbatim boundary: `fabric init` (rc.1, deterministic CLI) already produces the baseline scan. Phase 1 of this skill **REFERENCES** that output. It does NOT redo the scan.

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
3. If `.fabric/agents.meta.json` is missing OR `.fabric/knowledge/team/` is empty: STOP. Tell the user `请先运行 fabric init 完成基线扫描，再调用 fabric-import` and exit.
4. Update `.fabric/.import-state.json`: `phase = "P1-done"`, `p1_baseline_titles = [<list>]`, `last_checkpoint_at = <ISO8601 now>`.

**Phase 1 produces no MCP calls.** It only reads the on-disk init-scan output.

### Phase 2 — LLM-Driven Git + Doc Mining

For each candidate signal mined from git or docs, the skill classifies into one of the 5 types (`decisions / pitfalls / guidelines / models / processes`), drafts a slug per the 5-rule naming guideline (see fabric-archive for the canonical rules), and proposes a pending entry via `fab_extract_knowledge`. Default layer for every Phase 2 proposal: `team`.

#### Mandatory Scope Rule — Always Broad + Empty Paths (Q-1 Resolution)

**EVERY `fab_extract_knowledge` call issued from this skill MUST set:**

- `relevance_scope = "broad"`
- `relevance_paths = []`

This is non-negotiable and applies to BOTH Step 2.1 (git mining) AND Step 2.2 (docs mining). No exceptions, no per-candidate override, no Agent judgment.

**Rationale — why fabric-import cannot bind paths from git history:**

1. `fabric-import` is LLM-driven (mines git log + docs), not session-driven (no live `edit_paths` signal).
2. `git diff --stat` lists files touched by a commit, but those files are the commit's **effect surface**, not the **applicability surface** of the underlying observation. A pitfall surfaced by a fix in `packages/server/src/retry.ts` may apply to every retry call-site in the repo, not just that one file.
3. LLM-inferred `relevance_paths` from historical commit metadata produces false-narrow bindings — entries get filtered out for paths they actually govern. False-narrow is worse than broad because it silently hides knowledge during plan-context filtering.
4. Doc-mined observations are usually architectural / cross-cutting (a `docs/architecture.md` "Why a monolith?" decision applies to the whole codebase, not just to `docs/`).

**Strict prohibitions — DO NOT attempt any of the following:**

- DO NOT derive `relevance_paths` from `git log --name-only` / `git show --stat` / `git diff` file lists.
- DO NOT derive `relevance_paths` from the path of a mined Markdown file (e.g. do NOT bind a `docs/architecture.md` observation to `["docs/**"]`).
- DO NOT extract path-shaped tokens from commit subjects / bodies / doc text and lift them into `relevance_paths`.
- DO NOT classify a candidate as `relevance_scope = "narrow"` under ANY heuristic.
- DO NOT copy the public-prefix-generalization logic from fabric-archive Phase 1.5 — that logic is valid only when bound to a real-time `edit_paths` signal from an active session, which fabric-import lacks.

**Cross-reference — fabric-import vs fabric-archive scope handling:**

| Skill            | Scope decision     | Why                                                                   |
|------------------|--------------------|-----------------------------------------------------------------------|
| `fabric-archive` | narrow OR broad, case-by-case per Phase 1.5 rules | Has live `edit_paths` from the active session — the actual applicability surface. |
| `fabric-import`  | ALWAYS broad + `[]` (this skill) | LLM-only, no live session signal; git-history paths are effect-surface, not applicability-surface. |

`fabric-archive`'s Phase 1.5 scope decision (narrow-vs-broad rules + public-prefix generalization + glob blacklist) is INTENTIONALLY MORE PERMISSIVE than fabric-import because archive has the data to bind safely. fabric-import is the STRICTER case.

**Post-import narrowing path — deferred to user, via `fab_review.modify`:**

After import completes, the user reviews each kept pending entry via `fabric-review`. When the user judges that an imported entry is actually narrow-scoped, they (or the reviewing Agent on their explicit instruction) issue:

```ts
mcp__fabric__fab_review({
  action: "modify",
  pending_path: "<the imported pending or its post-approval canonical path>",
  changes: {
    relevance_scope: "narrow",
    relevance_paths: ["packages/server/src/retry/**", "packages/server/src/lib/retry.ts"]
  }
})
```

This is the ONLY legal path for an imported entry to acquire `relevance_paths`. The narrowing decision is the user's, informed by the actual `relevance_paths` candidates they propose — not the skill's, inferred from git metadata.

**Lint backstop:** doctor lint #23 (`narrow_no_paths`) warns on any `relevance_scope=narrow` entry with empty `relevance_paths`. If this skill ever deviates from the broad+[] rule and writes narrow without paths, lint #23 catches the mistake post-hoc.

#### Step 2.1 — Git Log Mining

Bash command (executed via the `Bash` tool):

```bash
git log --since="2 months ago" --pretty=format:"%H%n%s%n%b%n---ENDCOMMIT---" -n 200
```

Tolerate empty output (shallow clone or new repo). Cap the working set at the **most recent 200 commits** regardless of date range to bound LLM context.

For each commit:

1. Inspect the conventional-commit prefix in the subject line. Strong signals:
   - `feat(...)` with a non-empty body → likely **decision** or **model** (a new capability landed; the body usually explains why)
   - `fix(...)` with body length >100 chars → likely **pitfall** (a bug worth diagnosing was non-trivial)
   - `refactor(...)` with body → likely **decision** (architectural choice was made)
   - `docs(...)` → usually a **guideline** if the body announces a convention; skip if it's just typo/reformat
   - `chore(...)`, `test(...)`, `ci(...)` → almost always skip (mechanical; no reusable insight)
2. Read the commit body. Extract the LLM-judged "core observation" — what would a future engineer want to know about this commit beyond the diff? Aim for 1–2 sentences in zh-CN (project knowledge_language; mirror fabric-archive M3 style).
3. Apply the **Skip Decision Tree** below. If the commit is skip-worthy, record it in `p2_processed_commits[]` with `skipped: true` and move on.
4. For non-skipped commits, classify type / propose slug / draft summary. Then call `fab_extract_knowledge` with the **mandatory broad + [] scope** (see "Mandatory Scope Rule" above):

```ts
mcp__fabric__fab_extract_knowledge({
  source_session: "fabric-import-<ISO8601-date>",   // stable per import run
  recent_paths: ["<files touched by this commit, capped at 20>"],   // provenance only, NOT a path-binding signal
  user_messages_summary: "<zh-CN 1-2 sentence summary of the commit's core observation; cite the commit sha as 'src=<sha7>'>",
  type: "decisions" | "pitfalls" | "guidelines" | "models" | "processes",
  slug: "<kebab-case 2-5 words derived from commit subject + body>",
  relevance_scope: "broad",                                          // MANDATORY — never "narrow" from fabric-import
  relevance_paths: []                                                // MANDATORY — never derived from git history
})
```

Note: `recent_paths` continues to carry the touched-file list for **provenance display** (so the user can audit which commit produced which entry). It is NOT lifted into `relevance_paths` — those two fields serve different purposes and the prohibition on path inference from git history applies.

5. On success the server returns `{pending_path, idempotency_key}`. Append to `.fabric/.import-state.json`:
   - `p2_processed_commits[].push({sha: <full sha>, skipped: false, pending_path, type, slug})`
   - `last_checkpoint_at = <ISO8601 now>`
   Update is atomic (write to temp file then rename) so a crash between commits never corrupts the state file.
6. **Hard cap**: at most **10 new pending entries** per Phase 2 run. When the cap is reached, mark `p2_cap_reached = true` and stop git-log iteration (the user can re-invoke for more — idempotent resume picks up from the next unprocessed commit).

#### Step 2.2 — Docs Mining

Bash command (executed via the `Bash` tool):

```bash
find docs/ -maxdepth 3 -name '*.md' -type f 2>/dev/null
ls -1 *.md 2>/dev/null   # root-level architectural docs
```

For each Markdown file:

1. **Skip filter**:
   - `README.md` → skip (its first paragraph already lives in init-scan; its body is too generic for fine-grained classification)
   - `CHANGELOG.md` → skip (rendered from commit log; mining commits already covers it)
   - `LICENSE.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` → skip (boilerplate)
   - Files <300 bytes → skip (too thin to extract meaningful observations)
2. Read the file. Identify candidate observations: section headings that read like decisions ("we chose X over Y"), guidelines ("always do X"), pitfalls ("don't do Y because..."), or process steps ("the deploy procedure is..."). Architecture diagrams in fenced code blocks are strong **model** signals.
3. For each observation, classify type / propose slug / draft summary. Call `fab_extract_knowledge` with the same shape as Step 2.1 (including the **mandatory `relevance_scope: "broad"` + `relevance_paths: []`**), replacing `recent_paths` with `[<this doc path>]` and citing `src=<doc-relative-path>` in the summary. The mined doc's own path goes into `recent_paths` for provenance display ONLY — it is NOT lifted into `relevance_paths`.
4. Append to `.fabric/.import-state.json`:
   - `p2_processed_docs[].push({path: <doc path>, observations_proposed: <count>, pending_paths: [...]})`
5. **Hard cap shared with Step 2.1**: total new pending entries across git + docs is capped at 10 per Phase 2 run.

#### Skip Decision Tree (when to NOT propose)

```
A candidate signal surfaces (commit body or doc section).
  ├─ Is it cosmetic only? ("fix typo", whitespace, formatting)
  │    └─ YES → skip
  ├─ Is the body just metadata? (Co-Authored-By, Signed-off-by, no prose)
  │    └─ YES → skip
  ├─ Is the same observation already covered by an init-scan baseline title (Phase 1 list)?
  │    └─ YES → skip (don't re-propose what init already captured)
  ├─ Does the observation fit one of {decisions, pitfalls, guidelines, models, processes}?
  │    └─ NO  → skip (not classifiable = not yet ripe)
  ├─ Is the slug derivable as 2-5 kebab-case words?
  │    └─ NO  → skip (signal too vague for stable identifier)
  └─ Else → propose via fab_extract_knowledge
```

After Step 2.2 completes (or hits the cap), update `.fabric/.import-state.json`: `phase = "P2-done"`, `last_checkpoint_at = <ISO8601 now>`.

#### Dry-Run Mode

When the user invocation includes `dry-run` / `预览` / `--dry-run` keywords, Phase 2 runs WITHOUT calling `fab_extract_knowledge`. Instead it prints a table:

```md
# Import Dry Run — would propose N pending entries (all relevance_scope=broad, relevance_paths=[])

| # | Source                | Type      | Slug                          | Scope | Summary (zh-CN)                                            |
|---|-----------------------|-----------|-------------------------------|-------|------------------------------------------------------------|
| 1 | git c0a351d           | decisions | layer-flip-id-mutation        | broad+[] | layer 切换是唯一合法的 stable_id 变更途径，绑定原子事务。 |
| 2 | docs/architecture.md  | decisions | monolith-over-microservices   | broad+[] | 决定保留单体架构，三人团队不值微服务运维成本。            |
| 3 | git 50367b5           | pitfalls  | thundering-herd-no-backoff    | broad+[] | 重试无指数回退导致雪崩；必须 jittered exponential backoff。|
```

Every dry-run row MUST show `broad+[]` in the Scope column (it is a constant for fabric-import). A row showing anything else is a skill bug — refuse to proceed and surface the violation. Dry-run output is informational only. The state file is NOT written to in dry-run mode (so a real run later starts clean). Phase 3 is also skipped in dry-run.

### Phase 3 — LLM-Driven Dedup vs Canonical

For each pending entry created in Phase 2 (read from `p2_processed_commits[].pending_path` and `p2_processed_docs[].pending_paths`), check if it duplicates / contradicts / is subsumed by an existing canonical entry. **Semantic comparison is the LLM's job — `fab_review` does not compare meaning.**

#### Step 3.1 — Search Canonical of Same Type

For each just-proposed pending entry (read its frontmatter via the `Read` tool to get type + slug + title):

```ts
mcp__fabric__fab_review({
  action: "search",
  query: "<title or summary keywords from the pending entry>",
  filters: { type: "<same type as pending>" }
})
```

The server returns ranked `items[]` of CANONICAL entries (not pending) of the same type. Cap the comparison set at the top 5 results.

#### Step 3.2 — Semantic Compare

For each `(pending, canonical)` pair the LLM judges:

- **Duplicate** — same essential claim. Heuristics: title keyword overlap >60%, summary asserts the same outcome with no novel evidence. Action: **reject** the new pending.
- **Subsumption** (pending narrower) — canonical fully covers the pending plus more. Action: **reject** the new pending (canonical already serves).
- **Subsumption-with-novelty** (pending adds evidence) — canonical covers the claim but the new pending brings new evidence (commit sha, file paths). Action: **modify** the canonical to merge in the new evidence; **reject** the new pending citing the modified canonical.
- **Contradiction** — opposing claims about the same scope. Action: leave pending; flag for user via roll-up. The user must decide via `fabric-review` later — `fabric-import` does NOT auto-resolve contradictions.
- **Genuinely new** — no canonical match. Action: leave pending in place (will surface in next `fabric-review` run for normal approval flow).

#### Step 3.3 — Issue Dedup MCP Calls

For each `reject`-classified pending:

```ts
mcp__fabric__fab_review({
  action: "reject",
  pending_paths: ["<the new pending path>"],
  reason: "duplicate of <stable_id of canonical>"   // OR "subsumed by <stable_id>"
})
```

For each `subsumption-with-novelty` case (modify canonical, then reject pending):

```ts
// Step A: merge new evidence into canonical
mcp__fabric__fab_review({
  action: "modify",
  pending_path: "<canonical's pending_path-style relative path>",
  changes: { summary: "<merged summary; original + new evidence cite>" }
})

// Step B: reject the now-superseded pending
mcp__fabric__fab_review({
  action: "reject",
  pending_paths: ["<the new pending path>"],
  reason: "merged into <stable_id of modified canonical>"
})
```

Append to `.fabric/.import-state.json` after EACH successful MCP call:

- `p3_dedup_completed[].push({pending_path: <new pending>, action: "reject" | "modify-then-reject" | "kept", canonical_ref: "<stable_id>" | null})`
- `last_checkpoint_at = <ISO8601 now>`

#### Step 3.4 — Phase 3 Completion

After all Phase 2 outputs are dedup-reviewed:

- Update `.fabric/.import-state.json`: `phase = "complete"`, `last_checkpoint_at = <ISO8601 now>`, `final_summary = {proposed: N, kept: K, rejected_dup: R, merged: M, contradictions_flagged: C}`.
- Render the final roll-up to the user (see Output Contract below).

The user MAY manually delete `.fabric/.import-state.json` to reset, or the skill MAY offer a one-line "reset state and re-run from scratch?" prompt the next time it is invoked with `phase="complete"` already present.

## Checkpoint Logic — `.fabric/.import-state.json`

The state file lives at `.fabric/.import-state.json` and is the single source of resumability for fabric-import. It is written via `atomicWriteJson` (write-temp-then-rename) so a crash between phases / between sub-steps never corrupts it.

### Schema (all fields)

```json
{
  "phase": "P1-done | P2-done | complete",
  "started_at": "<ISO8601 first invocation>",
  "last_checkpoint_at": "<ISO8601 most recent successful sub-step>",
  "p1_baseline_titles": ["<title1>", "<title2>"],
  "p2_processed_commits": [
    { "sha": "<full sha>", "skipped": true,
      "skip_reason": "cosmetic | metadata-only | already-in-baseline | unclassifiable | overlong-slug" },
    { "sha": "<full sha>", "skipped": false,
      "pending_path": "knowledge/pending/<type>/<slug>.md",
      "type": "<one of 5>", "slug": "<kebab-case-slug>" }
  ],
  "p2_processed_docs": [
    { "path": "docs/<file>.md", "observations_proposed": 2,
      "pending_paths": ["<path1>", "<path2>"] }
  ],
  "p2_cap_reached": false,
  "p3_dedup_completed": [
    { "pending_path": "<new pending path>",
      "action": "reject | modify-then-reject | kept",
      "canonical_ref": "<stable_id or null>" }
  ],
  "errors": [
    { "step": "P2.git", "ref": "<commit sha or doc path>", "error": "<message>" }
  ],
  "final_summary": {
    "proposed": 0, "kept": 0, "rejected_dup": 0, "merged": 0, "contradictions_flagged": 0
  }
}
```

### Resume Logic (Idempotent Re-Invocation)

On every skill invocation, BEFORE Phase 1 starts:

1. Read `.fabric/.import-state.json`. ENOENT → fresh run, initialize state with `phase: "P1-done"` after Phase 1 completes (state file is created at end of Phase 1, not at start).
2. If `phase === "complete"` AND `last_checkpoint_at < 24h ago` → SKIP this invocation (precondition warning above) unless user explicitly typed `re-run import` or `reset import`.
3. If `phase === "complete"` AND `last_checkpoint_at ≥ 24h ago` → ask the user (free-text prompt, NOT AskUserQuestion since this is rare): "上次 import 已完成 (<N> 天前)。重新运行将基于当前 canonical 重做 P2/P3。继续？(y/n)"; if `n`, exit.
4. If `phase === "P1-done"` → skip Phase 1; resume from Phase 2 Step 2.1; iterate git log skipping any sha already in `p2_processed_commits[]`.
5. If `phase === "P2-done"` → skip Phase 1 + Phase 2; resume from Phase 3 Step 3.1; iterate Phase 2 outputs skipping any pending_path already in `p3_dedup_completed[]`.
6. After every successful sub-step (one commit processed, one doc processed, one dedup pair resolved), atomically write the updated state file. Failures append to `errors[]` and proceed (or halt with prompt if cumulative errors `>5`).

The contract: re-invoking fabric-import after ANY interruption (Ctrl-C, crash, network blip on MCP) MUST NOT propose duplicates of already-proposed entries and MUST NOT redo already-completed dedup decisions.

## Default Behavior & Knobs

| Knob                                | Default     | Override                                                       |
|-------------------------------------|-------------|----------------------------------------------------------------|
| Layer for new entries               | `team`      | User explicit instruction ("import these as personal")         |
| `relevance_scope` for new entries   | `broad`     | NONE — contract-locked; narrowing deferred to `fab_review.modify` post-import |
| `relevance_paths` for new entries   | `[]`        | NONE — contract-locked; populating deferred to `fab_review.modify` post-import |
| Max new pending entries per P2 run  | `10`        | User explicit ("import up to 25"); skill caps at 50 hard       |
| Git log window                      | `2 months`  | User explicit ("import the full year")                         |
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
- NEVER overwrite `.fabric/.import-state.json` non-atomically — use `atomicWriteJson` (write-temp-then-rename).
- NEVER exceed the 10-entry-per-run hard cap without explicit user override.
- NEVER pass `relevance_scope = "narrow"` to `fab_extract_knowledge` — every call from this skill MUST use `relevance_scope: "broad"`. No heuristic, no Agent judgment, no per-candidate override (see "Mandatory Scope Rule" in Phase 2).
- NEVER populate `relevance_paths` with a non-empty array on import — every call from this skill MUST pass `relevance_paths: []`. Do not derive paths from `git log --name-only`, `git show --stat`, commit subjects/bodies, or the path of a mined Markdown file.
- NEVER copy fabric-archive's Phase 1.5 scope-decision logic (narrow-vs-broad rules, public-prefix generalization, glob blacklist) into this skill — that logic requires a live `edit_paths` signal from an active session, which fabric-import does not have.
- Narrowing of imported entries happens out-of-band through `fab_review action="modify"` (issued by user via `fabric-review`), NOT inside this skill.
- MUST preserve protected tokens exactly: `stable_id`, `pending_path`, `layer`, `team`, `personal`, `knowledge_proposed`, `fab_extract_knowledge`, `fab_review`, `MUST`, `NEVER`, `phase`, `.import-state.json`, `relevance_scope`, `relevance_paths`, `broad`, `narrow`.

## Output Contract

After Phase 3 completes (or on any phase exit due to cap / error / interrupt), the skill MUST produce a roll-up:

```md
# Import Summary — phase=<P1-done | P2-done | complete>

## Phase 2 — Mining
- Commits scanned: <N>     (skipped: <S> — cosmetic/metadata/baseline-overlap)
- Docs scanned:    <D>     (skipped: <DS> — README/CHANGELOG/boilerplate)
- Pending proposed: <P>     (cap_reached: <true|false>)
- Scope: all <P> proposed entries use relevance_scope=broad, relevance_paths=[] (fabric-import contract).

## Phase 3 — Dedup
- Kept (genuinely new):       <K>
- Rejected (duplicate):       <RD>
- Modified-then-rejected:     <MR>     (canonical entries enriched: <list of stable_ids>)
- Contradictions flagged:     <C>     (require manual fabric-review)

## State
- .fabric/.import-state.json phase: <phase>
- last_checkpoint_at: <ISO8601>
- Re-invoke to continue if phase != complete.

## Next Steps
- Run `fabric-review` to approve the <K> kept pending entries.
- Resolve <C> contradictions manually if any.
- If any kept entry is actually narrow-scoped, narrow it via `fab_review action="modify"` with `changes.relevance_scope="narrow"` + `changes.relevance_paths=[...]` (this skill cannot narrow — see Mandatory Scope Rule in Phase 2).
```

Also surface a one-line `git status` of `.fabric/knowledge/` so the user sees the new pending files appear (and any canonical files modified by dedup-merge).

## Worked Examples

### Example A — Phase 2 git mining: feat commit → pitfall entry

Source signal: `git log` surfaces commit `50367b5` with subject `feat(server): add custom retry logic` and body explaining that initial implementation retried without exponential backoff, causing a thundering-herd outage during a brief upstream hiccup; the fix was jittered exponential backoff with a 30s ceiling.

LLM analysis: this is a **pitfall** (a non-obvious trap that wasted time and is repeatable across services). The body itself documents the trap. Slug candidates: `retry-without-backoff-thundering-herd` (5 words, 38 chars — passes 5 rules).

Skill output (note `relevance_scope: "broad"` + `relevance_paths: []` — mandatory for fabric-import):

```ts
mcp__fabric__fab_extract_knowledge({
  source_session: "fabric-import-2026-05-10",
  recent_paths: ["packages/server/src/lib/retry.ts"],     // provenance only
  user_messages_summary: "重试无指数退避会在短暂上游故障下放大成雪崩。修正：jittered exponential backoff，30 秒上限。src=50367b5",
  type: "pitfalls",
  slug: "retry-without-backoff-thundering-herd",
  relevance_scope: "broad",                                // MANDATORY
  relevance_paths: []                                      // MANDATORY — do NOT infer ["packages/server/src/lib/retry.ts"]
})
```

Counter-example — DO NOT do this:

```ts
// WRONG — this skill must never produce narrow + paths from git metadata.
// The retry pitfall applies to every retry site, not just the file touched by 50367b5.
mcp__fabric__fab_extract_knowledge({
  // ...
  relevance_scope: "narrow",                                // VIOLATION
  relevance_paths: ["packages/server/src/lib/retry.ts"]     // VIOLATION
})
```

If the user later judges this pitfall to be narrow-scoped, they (via `fabric-review`) issue `fab_review action="modify"` with `changes.relevance_scope` + `changes.relevance_paths` — that is the legal narrowing path.

State file delta:
```json
{ "p2_processed_commits": [
    { "sha": "50367b5...", "skipped": false,
      "pending_path": "knowledge/pending/pitfalls/retry-without-backoff-thundering-herd.md",
      "type": "pitfalls", "slug": "retry-without-backoff-thundering-herd" }
  ]
}
```

### Example B — Phase 2 doc mining: architecture.md → decision entry

Source signal: `docs/architecture.md` contains a section heading "## Why a monolith?" with body explaining the team chose monolith over microservices because the 3-engineer team couldn't justify the operational cost of multi-service deploys, and the dominant performance constraint (DB throughput) doesn't benefit from horizontal split.

LLM analysis: this is a **decision** (≥2 alternatives weighed — monolith vs microservices — with explicit rationale). Slug candidates: `monolith-over-microservices-small-team` (5 words, 38 chars — passes 5 rules).

Skill output (broad+[] mandatory; the doc's own path stays in `recent_paths` for provenance, NOT in `relevance_paths`):

```ts
mcp__fabric__fab_extract_knowledge({
  source_session: "fabric-import-2026-05-10",
  recent_paths: ["docs/architecture.md"],                  // provenance only
  user_messages_summary: "选择单体架构而非微服务：3 人团队无法承担多服务运维成本，且主要性能瓶颈在 DB 吞吐而非应用层水平扩展。src=docs/architecture.md",
  type: "decisions",
  slug: "monolith-over-microservices-small-team",
  relevance_scope: "broad",                                // MANDATORY
  relevance_paths: []                                      // MANDATORY — a monolith-vs-microservices decision applies repo-wide, not only to docs/
})
```

### Example C — Phase 3 dedup finds duplicate, rejects

After Example A's pending entry (`retry-without-backoff-thundering-herd`) is proposed, Phase 3 runs:

```ts
mcp__fabric__fab_review({
  action: "search",
  query: "retry backoff thundering herd",
  filters: { type: "pitfalls" }
})
```

Server returns 1 canonical match: `KT-P-0007--retry-no-jitter-amplification.md` with summary "重试缺少 jitter 在并发场景放大原始故障峰值". LLM judgment: the existing canonical asserts the same essential claim (retry without jitter amplifies failures) — this is a **duplicate**, not subsumption-with-novelty (the new pending offers no new evidence beyond restating the trap).

Skill output:

```ts
mcp__fabric__fab_review({
  action: "reject",
  pending_paths: ["knowledge/pending/pitfalls/retry-without-backoff-thundering-herd.md"],
  reason: "duplicate of KT-P-0007"
})
```

State file delta:
```json
{ "p3_dedup_completed": [
    { "pending_path": "knowledge/pending/pitfalls/retry-without-backoff-thundering-herd.md",
      "action": "reject", "canonical_ref": "KT-P-0007" }
  ]
}
```

Final roll-up to user reflects: 1 proposed, 0 kept, 1 rejected_dup, 0 merged, 0 contradictions.

### Example D — Post-import narrowing (out-of-band, NOT this skill)

This example documents the legal narrowing path; it is NOT performed by `fabric-import` itself. After Example B's `monolith-over-microservices-small-team` decision is imported (with `relevance_scope=broad`, `relevance_paths=[]`) and later approved into canonical via `fabric-review`, the user decides the decision is actually narrow to the server package's deploy tooling.

The user issues (via `fabric-review`, NOT via this skill):

```ts
mcp__fabric__fab_review({
  action: "modify",
  pending_path: "knowledge/team/decisions/monolith-over-microservices-small-team.md",
  changes: {
    relevance_scope: "narrow",
    relevance_paths: ["packages/server/**", "scripts/deploy/**"]
  }
})
```

Key invariants of this flow:

- The narrowing decision originates from the **user**, informed by the actual paths they propose — not from `fabric-import` inferring paths from git metadata.
- The modify call goes through `fab_review`, not `fab_extract_knowledge`, because the entry already exists (post-import or post-approval).
- If the user later flips the entry's layer from `team` to `personal`, server-side auto-degrades scope back to `broad` and clears `relevance_paths` (see rc.5 C3 acceptance criterion; personal knowledge crosses projects so paths don't generalize). This is the only legal way for `relevance_paths` to be re-cleared.

## Failure Recovery

- **Phase 2 mid-run failure** (e.g. `fab_extract_knowledge` errors on commit 5 of 10): state already records commits 1–4; rerun resumes at commit 5 by skipping any sha in `p2_processed_commits[]`. Error appended to `errors[]`.
- **Phase 3 mid-run failure** (e.g. `fab_review action="search"` MCP timeout on dedup pair 3 of 7): state records pairs 1–2 in `p3_dedup_completed[]`; rerun resumes at pair 3.
- **Cumulative `errors[].length > 5`**: skill halts; asks free-text "继续 (y) / 中止并保留 state (n)".
- **State file corruption**: skill renames it to `.fabric/.import-state.json.corrupt-<ISO8601>` and starts fresh from Phase 1.
- **MCP tool unreachable**: skill halts before any work; surfaces "MCP 工具未注册；请检查 fabric server 是否运行" and exits without writing state.

The skill is `Check-not-Ask` for recovery: it inspects state and resumes deterministically; it does NOT ask the user where to resume from.
