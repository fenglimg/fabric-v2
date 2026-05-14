# Fabric configuration reference

This document is the canonical reference for Fabric's user-facing
configuration surfaces. Each section enumerates the available knobs, their
defaults, and recommended values for repos of different sizes.

> Two surfaces matter for day-to-day tuning:
>
> - `.fabric/fabric-config.json` — JSON object, parsed at hook start. Missing
>   file or absent field → documented default. Schema lives in
>   `packages/shared/src/schemas/fabric-config.ts`.
> - Environment variables — see the `--apply-lint` section.

## Repo-size cheat-sheet

The hook tunables default to values that work well for small-to-medium
workspaces. Larger repos generate more knowledge churn and benefit from
relaxed thresholds. The table below lists recommended overrides; everything
else can stay at its default.

| Field                              | Small (<20 entries) | Medium (20-100) | Large (>100) |
| ---------------------------------- | ------------------- | --------------- | ------------ |
| `archive_hint_hours`               | 24 (default)        | 24              | 48           |
| `archive_hint_cooldown_hours`      | 12 (default)        | 12              | 24           |
| `archive_edit_threshold`           | 20 (default)        | 30              | 50           |
| `review_hint_pending_count`        | 5                   | 10 (default)    | 25           |
| `review_hint_pending_age_days`     | 7 (default)         | 7               | 14           |
| `underseed_node_threshold`         | 10 (default)        | 10              | 20           |
| `maintenance_hint_days`            | 14 (default)        | 14              | 30           |
| `maintenance_hint_cooldown_days`   | 7 (default)         | 7               | 14           |
| `import_window_first_run_months`   | 24                  | 60 (default)    | 60           |
| `import_window_rerun_months`       | 2 (default)         | 2               | 6            |
| `import_max_pending_per_run`       | 5                   | 10 (default)    | 20           |
| `import_max_commits_scan`          | 200                 | 500 (default)   | 1500         |
| `import_skip_canonical_threshold`  | 30                  | 50 (default)    | 100          |
| `archive_max_candidates_per_batch` | 5                   | 8 (default)     | 15           |
| `archive_max_recent_paths`         | 10                  | 20 (default)    | 50           |
| `archive_digest_max_sessions`      | 5                   | 10 (default)    | 20           |
| `review_topic_result_cap`          | 5                   | 8 (default)     | 15           |
| `review_stale_pending_days`        | 7                   | 14 (default)    | 30           |

The "Small" column matches Fabric's defaults. Tweak only when nags get too
loud or too quiet for your workflow.

## Hook thresholds

The Stop hook (`templates/hooks/fabric-hint.cjs`) reads every value below
synchronously at hook start. Any read failure, JSON parse error, or
non-positive value falls back to the documented default — the hook never
crashes on config errors.

### `archive_hint_hours` (default `24`)

Hours-since-last-`knowledge_proposed` cutoff for **Signal A** (archive
reminder, recommend `fabric-archive` skill). When this many hours have
elapsed AND there has been at least one prior `knowledge_proposed` event,
Signal A fires.

Externalized in rc.7 T7 (was hardcoded as `THRESHOLD_HOURS = 24` in rc.6).

- **Small / medium repos**: keep at 24. Daily reminder is the right rhythm
  when knowledge changes touch a handful of files.
- **Large repos**: bump to 48 or 72 if 24h feels too noisy.

### `review_hint_pending_count` (default `10`)

Pending-entry count cutoff for **Signal B** (review reminder, recommend
`fabric-review` skill). When pending entries (`knowledge/pending/`) reach
this count OR the oldest pending entry exceeds
`review_hint_pending_age_days`, Signal B fires.

Externalized in rc.7 T7 (was hardcoded as `THRESHOLD_PENDING_COUNT = 10`).

- **Small repos**: lower to 5 — backlog grows in absolute terms slower.
- **Large repos**: raise to 25+ — natural pending churn from many parallel
  contributors should not constantly trigger.

### `review_hint_pending_age_days` (default `7`)

Pending-entry age cutoff (in days) for **Signal B**. The complementary
trigger to `review_hint_pending_count`: when the *oldest* pending file is
older than this many days, the reminder fires regardless of count.

Externalized in rc.7 T7 (was hardcoded as `THRESHOLD_PENDING_AGE_DAYS = 7`).

- **Default 7d** matches a typical weekly review cadence.
- **Large repos with bi-weekly reviews**: 14 is reasonable.

### `archive_hint_cooldown_hours` (default `12`)

After Signal A / B / C / D fires once, the same signal stays silent for this
many hours regardless of state drift. Pure reminder-noise throttle.

- Lower for noisy workspaces if you want repeat nags within the same day.
- Raise to 24 to align with the daily archive trigger.

### `archive_edit_threshold` (default `20`)

Number of recorded Edit/Write fires (sidecar at
`.fabric/.cache/edit-counter`) since the last `knowledge_proposed` event that
trigger Signal A's edit-count branch. Lower → nag more aggressively.

### `underseed_node_threshold` (default `10`)

Canonical-knowledge-node count below which **Signal C** (import reminder,
recommend `fabric-import` skill) fires. Workspaces with fewer than this
many entries are below the floor for plan_context retrieval to be useful.
Also drives doctor lint #22 (`knowledge_underseeded`).

### `maintenance_hint_days` (default `14`)

(rc.7 T7 / T10 pre-wiring.) Days-since-last-doctor-invoke cutoff for the
forthcoming **Signal D** (maintenance reminder). T10 lands the
consumer-side wiring; T7 only externalizes the knob so the schema is stable
across the rc.7 series.

- 14d reflects a fortnightly cadence — long enough to avoid nag, short
  enough to catch index drift before it compounds.

### `maintenance_hint_cooldown_days` (default `7`)

(rc.7 T7 / T10 pre-wiring.) Cooldown between Signal D reminders. Pairing
14d trigger + 7d cooldown caps reminders at roughly two per month for a
workspace that ignores doctor.

## Skill tunables (rc.9+)

The ten knobs in this section back the three pagination / threshold contracts
that drive the `fabric-import`, `fabric-archive`, and `fabric-review` skills.
All ten are optional and resolve to documented defaults when absent — existing
`.fabric/fabric-config.json` files parse unchanged.

### `import_window_first_run_months` (default `60`)

First-run git-history window (in months) for the `fabric-import` skill.
When no prior `import_run_completed` event exists, the skill scans this
many months of history in one pass.

- **Small / fresh repos**: lower to 12-24. There is no signal further back
  than the project's own age.
- **Medium / large mature repos**: keep at 60 (~5 years). Captures the bulk
  of historical knowledge in a single import.

### `import_window_rerun_months` (default `2`)

Rerun git-history window (in months). After the first successful import,
every subsequent run only scans this many recent months — older commits
are assumed to have already been crystallized into pending or canonical
knowledge.

- **Default 2**: aligned with typical bi-monthly import cadence.
- **Workspaces that pause fabric-import for long stretches**: raise to 6
  to avoid gaps in coverage between runs.

### `import_max_pending_per_run` (default `10`, range `1-50`)

Hard cap on pending entries produced per `fabric-import` invocation.
Prevents one run from dumping hundreds of proposals when a backfill window
is wide open.

- **Default 10** matches the rule-of-thumb "human can triage ~10 pending
  entries in one review pass."
- **Large repos**: raise to 20 if maintainers prefer fewer-but-bigger
  review batches.

### `import_max_commits_scan` (default `500`, range `50-2000`)

Hard cap on commits scanned per `fabric-import` invocation. Bounds runtime
on monorepos with high commit velocity. Hitting the cap mid-window is
logged but non-fatal — the next run resumes from the unscanned tail.

- **Small repos**: 200 is usually sufficient.
- **Medium repos**: 500 (default) covers ~2 months of typical churn.
- **Large monorepos**: 1500+ for high-velocity codebases.

### `import_skip_canonical_threshold` (default `50`)

Canonical-node count above which `fabric-import`'s pre-flight should warn
and recommend running `fabric-review` first. A workspace with 50+ canonical
entries usually benefits more from consolidation than from importing more.

- **Default 50**: matches typical inflection point where review > import.
- **Large polyglot repos**: raise to 100+ — they legitimately accumulate
  more canonical entries before consolidation pays off.

### `archive_max_candidates_per_batch` (default `8`)

Maximum candidate entries surfaced per `fabric-archive` batch (one
invocation of the skill). Primary pagination knob for the archive flow.

- **Small repos**: 5 — keeps individual sessions short.
- **Default 8**: balances thoroughness against reviewer fatigue.
- **Large repos with high archive throughput**: 15+ if maintainers prefer
  fewer-but-larger archive sessions.

### `archive_max_recent_paths` (default `20`)

Maximum recently-touched paths included in `fabric-archive`'s relevance
digest. Limits the size of the path-relevance lookup the skill emits when
ranking candidates.

- **Default 20**: sufficient for most repos.
- **Large repos with deep directory fan-out**: 50+ if archive candidates
  feel under-contextualized.

### `archive_digest_max_sessions` (default `10`)

Maximum prior `fabric-archive` sessions summarised in the digest the skill
loads on start. Prevents the digest from ballooning past the model context
budget on workspaces that have archived repeatedly.

- **Default 10**: ~3-5 months of fortnightly archiving.
- Lower if context pressure bites; raise for longer-range trend visibility.

### `review_topic_result_cap` (default `8`)

Maximum review results returned per topic when `fabric-review` clusters
pending entries by topic. Pagination knob analogous to
`archive_max_candidates_per_batch` but scoped to each topic cluster.

- **Default 8**: each cluster reviewable in one sitting.
- **Large repos**: 15-20 when each topic legitimately groups many pending
  entries.

### `review_stale_pending_days` (default `14`)

Age threshold (in days) above which a pending entry is considered "stale"
by `fabric-review` and surfaced for explicit resolve-or-drop decision.
Tighter than the 7d Signal-B trigger because review specifically targets
the long tail.

- **Aggressive review cadence**: 7 — match Signal B exactly.
- **Default 14**: catches genuinely-stuck pending entries without
  prematurely escalating routine backlog.
- **Slow cadence**: 30 — only the truly-abandoned surface.

## Workspace policy

### `knowledge_language` (default `match-existing`)

Drives `fabric init` baseline template language. `match-existing` detects
the language of the repo's README / docs prose; explicit `zh-CN` / `en`
lock the policy regardless of detected content.

### `default_layer_filter` (default `both`)

Default fallback for `fab_plan_context` when the caller omits `layer_filter`.
`both` keeps team and personal knowledge in scope; `team` / `personal`
narrow the default surface for projects that only curate one layer.

### `audit_mode` (default unset — equivalent to `warn`)

Either `strict`, `warn`, or `off`. Drives the `fabric review` skill's
behavior when deferred entries surface.

### `mcpPayloadLimits`

Optional. Object with `warnBytes` and `hardBytes`. Override the default
MCP payload-size guardrails enforced by the server.

### `clientPaths`

Optional. Object with per-client install paths. v2.0 supported clients:
`claudeCodeCLI`, `claudeCodeDesktop`, `cursor`, `codexCLI`. Unknown keys
(e.g. `windsurf`, `rooCode`, `geminiCLI` from v1.x) are rejected at parse
time. See `packages/shared/src/schemas/fabric-config.ts` for the strict
shape.

### `scanIgnores`

Optional. Array of glob patterns the deterministic scanner should ignore
in addition to the built-in ignore list (`node_modules`, `.git`, `dist`,
etc.).

### `externalFixturePath`

Optional. Project path used by integration tests when running against an
external fixture; ignored in production.

## `--apply-lint` safety (rc.7 T11)

`fabric doctor --apply-lint` mutates user-knowledge state: it rewrites
frontmatter (`maturity` demotions), runs `git mv` to relocate stale entries
into `.fabric/.archive/`, deletes session-hint cache files, and bumps drifted
counters in `agents.meta.json`. Because the surface is destructive, the
command refuses to mutate without an explicit confirmation.

### Behavior

When `--apply-lint` is invoked the doctor command:

1. Runs a pre-flight `runDoctorReport()` to enumerate the proposed mutations.
2. Renders a plan banner to stdout with per-code counts and a preview of up
   to twelve entries.
3. Decides whether to proceed based on the rules below.

### Bypass options

| Mechanism                          | Effect                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `--yes` flag                       | Skip the confirm prompt. Required for non-tty CI invocations.                   |
| `FABRIC_NONINTERACTIVE=1` env var  | Skip the confirm prompt. Useful for nested process invocations.                 |
| Interactive tty, user answers `y`  | Confirm prompt appears with default `N`; user must explicitly type `y`.         |
| Interactive tty, user answers `n`  | Exit code `1`. No mutations occur.                                              |
| Non-tty stdin AND no bypass        | Exit code `1`. Error written to stderr explaining the requirement.              |

The pair `--yes` + `FABRIC_NONINTERACTIVE` is intentional and orthogonal:

- `--yes` is the explicit-CLI knob (`fabric doctor --apply-lint --yes`).
- `FABRIC_NONINTERACTIVE=1` is the environment knob (POSIX-style, mirrors
  `DEBIAN_FRONTEND=noninteractive`). It is useful when Fabric is invoked
  from a wrapping pipeline that does not have direct control over the
  argv passed to doctor.

### Recommended usage

- **Local development (interactive)**: just run
  `fabric doctor --apply-lint`. Read the plan, confirm if it looks right.
- **CI (workflow steps)**: use `--yes` explicitly. Example:
  `fabric doctor --apply-lint --yes`. Prefer this over the env var because
  the intent is visible in the workflow file.
- **Wrapped invocations (e.g. nested doctor calls in a build pipeline)**:
  set `FABRIC_NONINTERACTIVE=1` once at the top of the pipeline and let
  every Fabric invocation inherit it.

### Plan no-op shortcut

When the pre-flight report shows zero apply-lint findings the plan banner
and the confirm prompt are both skipped. `runDoctorApplyLint()` still runs
so the standard no-op message ("No apply-lint mutations were needed.") is
emitted.

## Doctor lint #28: `knowledge_relevance_fields_missing` (rc.9 TASK-003)

`fabric doctor --lint` reports pending knowledge entries
(`.fabric/knowledge/pending/**/*.md` and `~/.fabric/knowledge/pending/**/*.md`)
whose YAML frontmatter is missing one or both of the rc.5-introduced
`relevance_scope` and `relevance_paths` fields. The lint is info-kind and
does not bump report status — back-fill is hygiene rather than correctness,
because `knowledge-meta-builder` already falls back to the schema defaults
(`relevance_scope: broad`, `relevance_paths: []`) at read time
(knowledge-meta-builder.ts:1007-1021).

### `--apply-lint` behavior

In `--apply-lint` mode the doctor command:

1. Walks the dual-root pending tree (team + personal) once.
2. For every pending entry whose frontmatter is missing a field, atomically
   appends the missing line(s) to the frontmatter block:
   - `relevance_scope: broad`
   - `relevance_paths: []`
3. Skips entries that already declare both fields (idempotent — re-running
   produces zero per-file mutations).
4. Emits exactly one aggregate `relevance_migration_run` event per
   invocation (not per file) with `scanned_count` / `touched_count`.
   The event fires unconditionally on every `--apply-lint` run — including
   no-op re-runs (`touched_count: 0`) — to keep an audit-trail heartbeat in
   `events.jsonl` for migration archaeology.

### Scope: pending only

Canonical entries (under `.fabric/knowledge/<type>/` and
`~/.fabric/knowledge/<type>/`) are intentionally excluded from lint #28.
The `fab_review.approve` and `fab_review.modify` flows already write both
fields verbatim into canonical frontmatter, so back-filling there is
unnecessary. Lint #28 closes the only remaining surface where the v2.0
read-time fallback still has to tolerate schema-default reads.

### Lint number conflict note

The TASK-003 spec called this lint "#26" but the numbering was already
allocated to `knowledge_narrow_too_few` (rc.6 TASK-023) and #27 to
`knowledge_session_hints_stale` (rc.6 TASK-021). The lint ships as **#28**
to honor the "do not break existing lint numbering" constraint.
