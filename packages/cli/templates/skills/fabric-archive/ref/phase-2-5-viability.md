# Phase 2.5 — Viability Gate (ref)

> **Loaded on demand.** SKILL.md hot path retains the signal lists, gate decision pseudocode, and entry-point branching summary. This file holds the verbose explanations for each signal, gate-FAIL message variants (zh-CN/en), the events.jsonl 4KB atomicity constraint note, and rationale.

## Archive signals — verbose explanation

Scan `user_messages_summary` + `recent_paths` + the events tail collected in Phase 2. Each signal listed in SKILL.md hot path is explained below:

1. **Explicit normative language** — user said `always` / `never` / `from now on` / `下次注意` / `记一下` / `以后` / `永远不要`. Strongest single signal — even one normative cue is sufficient.
2. **Wrong-turn-and-revert** — a path was edited, then reverted (or partially undone) after diagnosis. Indicates a pitfall worth recording (the why-not lives in the revert).
3. **Long diagnostic loop** — an issue took > 15 minutes (or > ~10 tool turns) of debugging before resolution. Implies a non-obvious cause worth capturing.
4. **New dependency adoption** — a new package / library / external tool was introduced (e.g. `package.json` / `pyproject.toml` / `Cargo.toml` diff adds a dep).
5. **New pattern emergence** — a reusable abstraction or naming convention was named ("the X phase", "the Y pattern", "let's call this Z").
6. **Decision confirmation** — ≥ 2 alternatives were weighed AND a rationale was given before settling. The rationale is the archivable knowledge.
7. **Explicit dismissal-with-reason** — user rejected an approach AND stated why. The why is the archivable knowledge, not the dismissal itself.
8. **Process formalization** — a multi-step procedure was executed in a specific order AND the order was identified as load-bearing.

## Anti-archive signals — verbose explanation

These force the gate to FAIL **unless** an archive signal also fires (i.e. anti-signals are dominated by any archive signal per the gate decision rules):

1. **Typo-only edits** — the entire session is whitespace / spelling / formatting changes. No semantic content to archive.
2. **Pure refactor** — rename / move / extract with no behavior change AND no naming convention being established.
3. **Narrow rename request** — user asked to rename one symbol / file with no rationale. Zero generalization potential.
4. **Duplicate of existing canonical** — the observation is already covered by an existing entry under `.fabric/knowledge/<type>/`. Do a quick Glob before deciding.

## Gate-FAIL user messages (E2 / E4 only)

For the user-active branch, the gate-FAIL message variants are:

### zh-CN variant

```
本次会话为常规执行，无新知识可归档（gate=<reason>）。如需强制归档，请显式调用 fabric-archive。
```

### en variant

```
Current session is routine execution; no new knowledge to archive (gate=<reason>). To force-archive, explicitly invoke fabric-archive.
```

In BOTH branches: do NOT proceed to Phase 3, do NOT call any MCP tool. The legacy `knowledge_archive_aborted` event line (`{"ts":"...","kind":"knowledge_archive_aborted","reason":"<reason>","session":"<id>"}`) MAY be appended in addition to the mandatory Phase 4.5 `session_archive_attempted` event — they serve different audit purposes (legacy abort reason vs new outcome state machine) and the two coexist during the rc.25 transition window.

## events.jsonl Constraint Note (POSIX 4KB atomicity)

Event lines appended to `.fabric/events.jsonl` are subject to POSIX single-write atomicity: only writes ≤ 4KB (`PIPE_BUF`) are guaranteed atomic via `Bash: echo "..." >> file`. Lines exceeding 4KB risk interleaved corruption under concurrent skill + server writes to the same ledger.

Skills MUST ensure:

- Each event JSON line is a **single line** (no embedded newlines; escape `\n` in any string value).
- `session_context` and other free-form text fields **self-truncate** to keep the entire serialized line under 4KB. Suggested per-field caps: `session_context` first 500 chars; `source_sessions` cap at 5 entries; `recent_paths` cap at 20 entries; `user_messages_summary` first 500 chars.
- If approaching the 4KB ceiling after the per-field caps, drop optional fields (e.g. tags / extra metadata) **before** truncating semantic content (the summary / context that carries the actual observation).
- This constraint applies to any event the skill itself appends (e.g. the abort signal above); MCP-server-side appends (via `appendEventLedgerEvent`) are already line-length-bounded server-side.
