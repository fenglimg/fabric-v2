# Phase 2 — LLM-Driven Git + Doc Mining (ref)

> **Loaded on demand.** SKILL.md hot path retains the broad+[] contract one-liner, brief Step 2.1/2.2 summaries, and a pointer to this file. This file holds: full Mandatory Scope Rule rationale + strict prohibitions, Step 2.1 git mining call shape + 6 conventional-commit signals, Step 2.1.5 Proposed Reason Inference table, Step 2.2 docs mining filter list + call shape, Skip Decision Tree, bilingual dry-run preview templates, and T5 array-form idempotency notes.

## Mandatory Scope Rule — Always Broad + Empty Paths (Q-1 Resolution)

**EVERY `fab_propose` call issued from this skill MUST set:**

- `relevance_scope = "broad"`
- `relevance_paths = []`

This is non-negotiable and applies to BOTH Step 2.1 (git mining) AND Step 2.2 (docs mining). No exceptions, no per-candidate override, no Agent judgment.

**Rationale — why archive source mode cannot bind paths from git history:**

1. `archive source mode` is LLM-driven (mines git log + docs), not session-driven (no live `edit_paths` signal).
2. `git diff --stat` lists files touched by a commit, but those files are the commit's **effect surface**, not the **applicability surface** of the underlying observation. A pitfall surfaced by a fix in `packages/server/src/retry.ts` may apply to every retry call-site in the repo, not just that one file.
3. LLM-inferred `relevance_paths` from historical commit metadata produces false-narrow bindings — `relevance_paths` becomes a lie about applicability. Post-rc.37 A1 the server no longer filters by `relevance_scope`, so false-narrow does NOT hide knowledge from AI recall (every selectable entry is surfaced regardless of scope). The damage is now downstream: doctor lint accounting, future-AI judgment, and any consumer that reads `relevance_paths` literally treats the wrong globs as ground truth. Broad+[] keeps the metadata honest until the user has the real applicability surface in hand to declare narrow.
4. Doc-mined observations are usually architectural / cross-cutting (a `docs/architecture.md` "Why a monolith?" decision applies to the whole codebase, not just to `docs/`).

**Strict prohibitions — DO NOT attempt any of the following:**

- DO NOT derive `relevance_paths` from `git log --name-only` / `git show --stat` / `git diff` file lists.
- DO NOT derive `relevance_paths` from the path of a mined Markdown file (e.g. do NOT bind a `docs/architecture.md` observation to `["docs/**"]`).
- DO NOT extract path-shaped tokens from commit subjects / bodies / doc text and lift them into `relevance_paths`.
- DO NOT classify a candidate as `relevance_scope = "narrow"` under ANY heuristic.
- DO NOT copy the public-prefix-generalization logic from fabric-archive Phase 3.5 — that logic is valid only when bound to a real-time `edit_paths` signal from an active session, which archive source mode lacks.

**Cross-reference — archive source mode vs fabric-archive scope handling:**

| Skill            | Scope decision     | Why                                                                   |
|------------------|--------------------|-----------------------------------------------------------------------|
| `fabric-archive` | narrow OR broad, case-by-case per Phase 3.5 rules | Has live `edit_paths` from the active session — the actual applicability surface. |
| `archive source mode`  | ALWAYS broad + `[]` (this skill) | LLM-only, no live session signal; git-history paths are effect-surface, not applicability-surface. |

`fabric-archive`'s Phase 3.5 scope decision (narrow-vs-broad rules + public-prefix generalization + glob blacklist) is INTENTIONALLY MORE PERMISSIVE than archive source mode because archive has the data to bind safely. archive source mode is the STRICTER case.

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

## Step 2.1 — Git Log Mining

Bash command (executed via the `Bash` tool — substitute `<window>` and `<commits-cap>` with values resolved from Phase 0.5 config load):

```bash
git log --since="<window> months ago" --pretty=format:"%H%n%s%n%b%n---ENDCOMMIT---" -n <commits-cap>
```

- `<window>` resolves to `import_window_first_run_months` on a first-run (default 60) or `import_window_rerun_months` on subsequent runs (default 2); first-run-vs-rerun is decided per the Phase 0.5 rule.
- `<commits-cap>` resolves to `import_max_commits_scan` (default 500).

Tolerate empty output (shallow clone or new repo). Cap the working set at the **`import_max_commits_scan`-most-recent commits (config-resolved)** regardless of date range to bound LLM context.

For each commit:

1. Inspect the conventional-commit prefix in the subject line. Strong signals:
   - `feat(...)` with a non-empty body → likely **decision** or **model** (a new capability landed; the body usually explains why)
   - `fix(...)` with body length >100 chars → likely **pitfall** (a bug worth diagnosing was non-trivial)
   - `refactor(...)` with body → likely **decision** (architectural choice was made)
   - `docs(...)` → usually a **guideline** if the body announces a convention; skip if it's just typo/reformat
   - `chore(...)`, `test(...)`, `ci(...)` → almost always skip (mechanical; no reusable insight)
2. Read the commit body. Extract the LLM-judged "core observation" — what would a future engineer want to know about this commit beyond the diff? Aim for 1–2 sentences in zh-CN (project fabric_language; mirror fabric-archive M3 style).
3. Apply the **Skip Decision Tree** below. If the commit is skip-worthy, record it in `p2_processed_commits[]` with `skipped: true` and move on.
4. For non-skipped commits, classify type / propose slug / draft summary. Then call `fab_propose` with the **mandatory broad + [] scope** (see "Mandatory Scope Rule" above):

```ts
mcp__fabric__fab_propose({
  source_sessions: ["fabric-archive-source-<ISO8601-date>"],   // T5: array form; stable per import run
  recent_paths: ["<files touched by this commit, capped at 20>"],   // provenance only, NOT a path-binding signal
  user_messages_summary: "<zh-CN 1-2 sentence summary of the commit's core observation; cite the commit sha as 'src=<sha7>'>",
  type: "decisions" | "pitfalls" | "guidelines" | "models" | "processes",
  slug: "<kebab-case 2-5 words derived from commit subject + body>",
  relevance_scope: "broad",                                          // MANDATORY — never "narrow" from archive source mode
  relevance_paths: [],                                               // MANDATORY — never derived from git history
  proposed_reason: "<inferred per Step 2.1.5 — varies>",
  session_context: "Imported from git log analysis. Origin: commit <sha7> (<subject 30 chars>). No live session — see commit body for full context.",
  // rc.23 TASK-006 four OPTIONAL triage fields — populate from commit body when clean, omit otherwise.
  intent_clues: ["<inferred trigger if commit body suggests one>"],
  tags: ["<lang/framework from recent_paths extensions>"],
  impact: ["<consequence stated in commit body / doc>"],
  must_read_if: "<one-line strongest trigger from commit's touched-path family>"
})
```

Note: `recent_paths` carries the touched-file list for **provenance display** only. It is NOT lifted into `relevance_paths` — those two fields serve different purposes and the prohibition on path inference from git history applies.

5. On success the server returns `{pending_path, idempotency_key}`. Append to `.fabric/.import-state.json`:
   - `p2_processed_commits[].push({sha: <full sha>, skipped: false, pending_path, type, slug})`
   - `last_checkpoint_at = <ISO8601 now>`
   Update is atomic via the 2-step `.tmp` + `mv` pattern documented in the **Atomic State Write** section under "Checkpoint Logic" below.
6. **Hard cap**: at most **`import_max_pending_per_run` new pending entries (config-resolved, default 10)** per Phase 2 run. When the cap is reached, mark `p2_cap_reached = true` and stop git-log iteration.

## Step 2.1.5 — Proposed Reason Inference (rc.7 T6)

For each non-skipped commit OR doc section, infer `proposed_reason` from prefix + body signal jointly. The 6 reasons below are the full enum accepted by `fab_propose` (schema-locked):

| Source signal | Body cue | Inferred reason |
|---|---|---|
| `feat(...)` commit | "vs" / "instead of" / "chose" / "rejected X for Y" | `decision-confirmation` |
| `feat(...)` commit | Announces new dep/lib/abstraction, no alternative cited | `new-dependency-or-pattern` |
| `fix(...)` commit | Cites wrong direction tried + reverted | `wrong-turn-revert` |
| `fix(...)` commit | Cites long diagnostic chain → root cause | `diagnostic-then-fix` |
| `refactor(...)` commit | Cites structural rationale (without "vs" alternatives) | `decision-confirmation` |
| `docs(...)` commit | Announces convention ("always X" / "never Y") | `explicit-user-mark` |
| Any commit | Body explicitly rejects an approach + states why | `dismissal-with-reason` |
| Doc section | "Why we chose X over Y" heading | `decision-confirmation` |
| Doc section | "Don't do Y because..." section | `dismissal-with-reason` |
| Doc section | "Always" / "Never" guidelines | `explicit-user-mark` |
| Doc section | Architecture/design narrative (descriptive, no choice rationale) | `new-dependency-or-pattern` |

**Edge cases:**

- `chore(` / `test(` / `ci(` should already be skipped per the Skip Decision Tree below; if they slip through, default to `new-dependency-or-pattern`.
- Ambiguous signals: prefer the reason matching **body content** over **prefix** (a `feat(` with strong revert-language is `wrong-turn-revert`, not `new-dependency-or-pattern`).

**Fallback**: when no row clearly applies, use `new-dependency-or-pattern` (the broadest "noticed something new" semantic).

## Step 2.2 — Docs Mining

Bash command:

```bash
find docs/ -maxdepth 3 -name '*.md' -type f 2>/dev/null
ls -1 *.md 2>/dev/null   # root-level architectural docs
```

For each Markdown file:

1. **Skip filter**:
   - `README.md` → skip (its first paragraph already lives in init-scan; body too generic for fine-grained classification)
   - `CHANGELOG.md` → skip (rendered from commit log; mining commits already covers it)
   - `LICENSE.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` → skip (boilerplate)
   - Files <300 bytes → skip (too thin to extract meaningful observations)
2. Read the file. Identify candidate observations: section headings that read like decisions ("we chose X over Y"), guidelines ("always do X"), pitfalls ("don't do Y because..."), or process steps ("the deploy procedure is..."). Architecture diagrams in fenced code blocks are strong **model** signals.
3. For each observation, classify type / propose slug / draft summary. Call `fab_propose` with the same shape as Step 2.1 (including the **mandatory `relevance_scope: "broad"` + `relevance_paths: []`**), replacing `recent_paths` with `[<this doc path>]` and citing `src=<doc-relative-path>` in the summary.
4. Append to `.fabric/.import-state.json`:
   - `p2_processed_docs[].push({path: <doc path>, observations_proposed: <count>, pending_paths: [...]})`
5. **Hard cap shared with Step 2.1**: total new pending entries across git + docs is capped at `import_max_pending_per_run` (config-resolved, default 10) per Phase 2 run.

## Skip Decision Tree

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
  └─ Else → propose via fab_propose
```

After Step 2.2 completes (or hits the cap), update `.fabric/.import-state.json`: `phase = "P2-done"`, `last_checkpoint_at = <ISO8601 now>`.

## Dry-Run Mode

When the user invocation carries the verbatim token `--dry-run`, Phase 2 runs WITHOUT calling `fab_propose`. Instead it prints a table. v2.0.0-rc.37 NEW-10 dropped the legacy substring fallback on bare `dry-run` / `预览` because those caused false positives on incidental mentions ("preview the table" / "do a dry run later"). UX i18n Policy class 4 — header + column titles bilingualized; row content (slug / commit sha / doc path) NOT translated. Protected tokens `broad`, `relevance_scope`, `relevance_paths` appear verbatim:

### zh-CN variant (`fabric_language === "zh-CN"`)

```md
# Import 预览 — 将提议 N 条 pending 条目（全部 relevance_scope=broad, relevance_paths=[]）

| # | 来源                  | 类型      | Slug                          | 作用域 | 摘要 (zh-CN)                                                |
|---|-----------------------|-----------|-------------------------------|--------|-------------------------------------------------------------|
| 1 | git c0a351d           | decisions | layer-flip-id-mutation        | broad+[] | layer 切换是唯一合法的 stable_id 变更途径，绑定原子事务。 |
| 2 | docs/architecture.md  | decisions | monolith-over-microservices   | broad+[] | 决定保留单体架构，三人团队不值微服务运维成本。            |
| 3 | git 50367b5           | pitfalls  | thundering-herd-no-backoff    | broad+[] | 重试无指数回退导致雪崩；必须 jittered exponential backoff。|
```

### en variant (`fabric_language === "en"`)

```md
# Import Dry Run — would propose N pending entries (all relevance_scope=broad, relevance_paths=[])

| # | Source                | Type      | Slug                          | Scope    | Summary                                                       |
|---|-----------------------|-----------|-------------------------------|----------|---------------------------------------------------------------|
| 1 | git c0a351d           | decisions | layer-flip-id-mutation        | broad+[] | Layer change is the only legal stable_id mutation path; atomic txn. |
| 2 | docs/architecture.md  | decisions | monolith-over-microservices   | broad+[] | Keep the monolith — 3-engineer team can't justify microservice ops. |
| 3 | git 50367b5           | pitfalls  | thundering-herd-no-backoff    | broad+[] | Retries without exponential backoff caused a thundering herd outage. |
```

Every dry-run row MUST show `broad+[]` in the Scope column (constant for archive source mode). A row showing anything else is a skill bug — refuse to proceed and surface the violation. Dry-run output is informational only. The state file is NOT written to in dry-run mode (so a real run later starts clean). Phase 3 is also skipped in dry-run.

## Idempotency Note — T5 array form

The server derives `idempotency_key = sha256({source_session, type, slug})` for every `fab_propose` call. Re-invoking with the same `(source_session, type, slug)` triple is SAFE: the server appends new evidence to the existing pending file rather than overwriting or producing duplicates — this is why `archive source mode` resume after Ctrl-C / crash never produces duplicate pending entries for already-processed commits.

**T5 array-form note (rc.7+)**: when `source_sessions` is passed as an array (rc.7 T5 contract), only `source_sessions[0]` participates in the server-side idempotency hash. Server formula at `packages/server/src/services/extract-knowledge.ts:78` is `sha256(JSON.stringify({source_session: sourceSessions[0], type, slug}))`. Implications for archive source mode:

- Every Phase 2 call uses `source_sessions: ["fabric-archive-source-<ISO8601-date>"]` (single-element array, stable per import run). First-element-only rule means re-runs on the same date produce the same idempotency key per `(type, slug)` → resume-safe by construction.
- If a future enhancement adds a trailing element (e.g. `["fabric-archive-source-<date>", "<commit-sha>"]`), only the first element participates in the hash — the commit-sha tail would NOT change the idempotency key for the same `(type, slug)`. Plan accordingly.
- The formula is intentionally stable across the rc.5 → rc.7 migration; adding or removing tail entries does NOT change the idempotency key, preserving rc.5 single-session compat.
