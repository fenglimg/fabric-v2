# Planning Context: rc.20 Cite Policy

## Source Evidence

### From exploration-cite-flow.json
- `packages/cli/templates/hooks/fabric-hint.cjs:1011-1088` — `summarizeTranscript` currently extracts user_messages + edit_paths; extend with `role:'assistant'` branch to harvest first-line `KB:` regex per envelope.
- `packages/cli/templates/hooks/fabric-hint.cjs:1134` — insertion point for new `extractAndWriteAssistantTurnsBestEffort(cwd, stdinPayload)` right after existing `writeSessionDigestBestEffort` call (reuses already-parsed stdinPayload, single pass).
- `packages/cli/templates/hooks/fabric-hint.cjs:28-29` — constant duplication pattern (`FABRIC_DIR`, `EVENT_LEDGER_FILE`); add `EVENT_TYPE_ASSISTANT_TURN_OBSERVED` + `EVENT_TYPE_CITE_POLICY_ACTIVATED` as string literals (hook can't import zod — node_modules unavailable in user repos).
- `packages/cli/templates/hooks/fabric-hint.cjs:1121, 1306` — outer try/catch never-block invariant; cite extraction MUST exit 0 silently on failure.
- `packages/shared/src/schemas/event-ledger.ts:330-337` — `doctorRunEventSchema` is the closest structural precedent for a single-purpose telemetry event with literal `event_type`, enum mode, timestamp.
- `packages/shared/src/schemas/event-ledger.ts:397-443` — `eventLedgerEventSchema.discriminatedUnion` registry; add `assistantTurnObservedEventSchema` and `citePolicyActivatedEventSchema` here.
- `packages/shared/src/schemas/event-ledger.ts:478-511` — `EventLedgerEvent` type union; append two new aliases.
- `packages/shared/src/templates/bootstrap-canonical.ts:61-74` — `BOOTSTRAP_CANONICAL` byte-locked body; insert `## Cite policy` H2 after `## 知识库(KB)` (current end L73), before closing backtick L74. Keep ≥400 byte guarantee.
- `packages/cli/src/commands/doctor.ts:21-39, 71-109, 110-244, 301-316` — args type, args declarations, run dispatcher, doctor_run emit helper. Plumb `--cite-coverage`, `--since`, `--client` flags; mutually exclusive with `--fix`/`--fix-knowledge`.

### From exploration-coverage-algo.json
- `packages/shared/src/schemas/agents-meta.ts:32-56, 127-131` — `ruleDescriptionSchema.relevance_paths` (default []) + `relevance_scope` (default 'broad'); ground truth for the per-cite denominator (narrow → path-filtered; broad → 'covers any edit').
- `packages/server/src/services/event-ledger.ts:52-105` — `readEventLedger` already supports `{event_type, since, correlation_id, session_id}` filters; `since` is epoch-ms numeric, so `--since=7d` requires CLI-side duration parser (`Date.now() - 7*86400_000`).
- `packages/server/src/services/event-ledger.ts:33-50` — `appendEventLedgerEvent` for in-process emit of `cite_policy_activated` marker (doctor first invocation).
- `packages/server/src/services/doctor.ts:746-954` — `runDoctorReport` entry; `Promise.all` block at L750-772 is where new `inspectCiteCoverage` slots in (OR new parallel `runDoctorCiteCoverage` export per locked decision: flag suppresses normal report → fast-path skip 28-check pipeline).
- `packages/server/src/services/doctor.ts:2885-2950` — `buildLastActiveIndex` is the structural template for cite-coverage replay (single readEventLedger pass → switch on event_type → accumulate Map<stableId, outcomes>).
- `packages/shared/src/i18n/locales/en.ts:140-163` — `cli.doctor.args.*` + `doctor.section.*` keys; add `cli.doctor.args.cite-coverage.description`, `cli.doctor.args.since.description`, `cli.doctor.args.client.description`, `doctor.section.cite-coverage`, plus metric + dismissed-reason label keys (zh-CN symmetric).
- `packages/server/src/services/doctor.test.ts:394-395, 426, 850` — `writeFileSync(ledgerPath, ${event_json}\n, 'utf8')` seeded events pattern; cite-coverage tests follow this verbatim.
- `packages/shared/src/templates/bootstrap-canonical.test.ts:22-30` — section-presence + ≥400 byte assertions; add `## Cite policy` contains-assertion.

## Understanding

### Current State
- rc.19 consolidated bootstrap to single `BOOTSTRAP_CANONICAL` constant propagated to all three end blocks via `fab install` managed-block writer (Claude Code, Codex CLI, Cursor).
- `fabric-hint.cjs` is single shared hook script (per KT-DEC-0009), wired to Stop on all three clients; already reads stdin payload + parses Claude Code transcript JSONL.
- `events.jsonl` is canonical event ledger with Zod-discriminated-union schema (31 variants currently); `readEventLedger` has `since`/`event_type`/`session_id`/`correlation_id` filters.
- `agents.meta.json` carries `relevance_paths[]` per knowledge entry — denominator ground truth.
- `fab doctor` has 28+ inspection pipeline with `--fix`/`--fix-knowledge`/`--rescan`/`--strict`/`--json` flags; no subcommand surface yet.

### Problem
- AI replies don't carry observable cite metadata → no way to measure whether KB entries are actually used at edit/decide/plan time.
- No policy text in canonical → AI doesn't know to emit `KB:` lines.
- No event schema → even if AI emitted KB: lines, no parser to capture them.
- No CLI surface → no operator visibility into cite coverage.

### Approach
**Closed loop in 4 vertical slices, ordered for clean commit chain:**
1. **Canonical policy text** (TASK-01) — define the protocol surface FIRST so subsequent slices have a contract anchor.
2. **Event schema** (TASK-02) — discriminated union additions for `assistant_turn_observed` + `cite_policy_activated`; pre-requisite for any emit site.
3. **Capture path** (TASK-03) — extend `fabric-hint.cjs` `summarizeTranscript` with assistant-envelope branch + first-line `KB:` regex; emit `assistant_turn_observed`.
4. **Marker emit** (TASK-04) — `cite_policy_activated` idempotent write on first `fab doctor --cite-coverage` invocation (NOT install per coverage-algo dependency direction).
5. **CLI surface** (TASK-05) — `--cite-coverage` / `--since` / `--client` flag plumbing in doctor command; fast-path mode skips 28-check pipeline.
6. **Algorithm** (TASK-06) — replay `events.jsonl` filtered by ts >= marker_ts, join against `agents.meta.json.relevance_paths`, accumulate per-cite outcomes.
7. **Report** (TASK-07) — formatter + i18n (en/zh-CN) + dismissed reason enum + per-client split.
8. **Tests** (TASK-08, TASK-09) — service-layer cite-coverage tests + hook-side capture tests.
9. **Self-host** (TASK-10) — refresh local `.fabric/AGENTS.md` etc. via `fab install` + `fab doctor --fix`.
10. **Release** (TASK-11) — version bump + CHANGELOG.

### Auto-orchestrator Locked Decisions Honored
- rc.20 scope: Claude Code first-class + Codex assume-and-test ONLY (Cursor deferred to rc.21 — PreToolUse doesn't see assistant text).
- Codex Stop hook: assume Claude Code shape; if shape differs at impl, fallback to "events.jsonl reconstruction (non-realtime)".
- Turn boundary: "first non-empty text line of first text block" of first text envelope.
- `turn_id`: generated from `session_id + envelope_index`.
- `client` literal: `'cc' | 'codex'` (cursor reserved, left empty rc.20).
- `--cite-coverage` flag → fast-path mode (skip 28-check pipeline); output uses 中文 report template.

## Key Decisions

| Decision | Rationale | Evidence |
|---|---|---|
| Two new events (not four) — `assistant_turn_observed` + `cite_policy_activated` | Per locked design: `assistant_turn_observed` carries `cite_ids[]` + `cite_tags[]` + `kb_line_raw` (one event per turn, not per cite). Reduces ledger noise; replay can derive planned/recalled/dismissed buckets from `cite_tags` enum on a single event. | MEMORY `project_cite_policy.md` step 6 — "Events: `assistant_turn_observed` event 含 kb_line_raw / cite_ids / cite_tags / client / turn_id" |
| Marker emit at first `fab doctor --cite-coverage`, NOT at install | Idempotent: check `readEventLedger({event_type:'cite_policy_activated'})` first; emit only if absent. Avoids polluting install hot path; tests can seed empty events.jsonl cleanly. | exploration-cite-flow integration-points §4; locked decision Q-5 "pre-policy marker" |
| Cite extraction lives in `summarizeTranscript` (extended), not a sibling function | Reuses already-parsed JSONL line-by-line iteration. Single pass = single I/O cost. Maintains `writeSessionDigestBestEffort` symmetry. | exploration-cite-flow `summarizeTranscript` key-code |
| `--cite-coverage` flag = fast-path (skip 28-check pipeline) | Per auto-orchestrator Q-3 option 3: cite report is read-only observability; running 28 inspections wastes time. Branches early in run dispatcher after arg validation. | exploration-coverage-algo clarification Q-3 recommended option 3; locked CLI shape |
| Turn boundary = `session_id + envelope_index` → `turn_id` | Stable, deterministic, no UUID dependency. Per-envelope granularity matches Claude Code transcript JSONL one-envelope-per-turn semantics. | Auto-orchestrator locked decision §4 |
| Cursor deferred to rc.21 | PreToolUse hook sees `tool_input` (file paths), NOT assistant text; Stop stdin shape unverified. Risk-honest scope cut. | Auto-orchestrator §1; exploration-cite-flow clarification Q-1 |
| `dismissed:<reason>` parsed as one tag with embedded reason | Tag enum: `planned|recalled|chained-from <id>|dismissed:<reason>`; reason enum `scope-mismatch|outdated|not-applicable|other:<text>`. Replay splits on `:` to extract reason. | MEMORY `project_cite_policy.md` step 9 dismissed reason enum |
| Per-task commit style (11 commits) | User explicit preference (rc.17 RC pattern). Each TASK = one atomic, reviewable commit; clean revert surface. | Task brief "Task Generation Rules — Per-Task Commit Style" |

## Dependencies

**DAG**:
```
TASK-01 (canonical) ─────┐
                         ├──► TASK-04 (marker) ──► TASK-05 (CLI flags) ──► TASK-06 (algorithm) ──► TASK-07 (report) ──► TASK-08 (server tests)
TASK-02 (event schema) ──┤
                         └──► TASK-03 (hook capture) ──► TASK-09 (hook tests)
TASK-02 ──► TASK-04

All ──► TASK-10 (self-host) ──► TASK-11 (release bump)
```

**Why this order**:
- TASK-01 publishes the protocol contract first → tests can assert canonical text contains policy.
- TASK-02 is a schema-only commit → unlocks both TASK-03 (writer) and TASK-04 (in-process emit) without coupling them.
- TASK-03/04 are independent after TASK-02 → could parallelize but commit chain stays linear.
- TASK-05 needs TASK-04 (marker emit lives in the same dispatcher path).
- TASK-06 needs TASK-05 (flag must exist before algorithm has a host function).
- TASK-07 layers reporting on top of TASK-06 (algorithm output shape stable).
- TASK-08 tests TASK-04+05+06+07 together (server-side surface integration).
- TASK-09 tests TASK-03 in isolation (hook-side capture).
- TASK-10 self-host requires all behavior in place to refresh blocks correctly.
- TASK-11 version bump is always last.
