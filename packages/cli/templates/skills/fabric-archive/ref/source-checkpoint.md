# Checkpoint Logic — `.fabric/.import-state.json` (ref)

> **Loaded on demand.** SKILL.md hot path retains a 2-line mention of the 2-step atomic write pattern + a pointer to this file. This file holds the full Atomic State Write rationale, events.jsonl 4KB constraint, complete schema, and resume-logic state machine.

The state file lives at `.fabric/.import-state.json` and is the single source of resumability for archive source mode. It is written via the explicit 2-step atomic pattern documented below so a crash between phases / between sub-steps never corrupts it.

## Atomic State Write (2-step pattern)

**Every** update to `.fabric/.import-state.json` MUST use the following two-step pattern, executed by the skill itself (not delegated to an external helper):

- **Step A**: `Write` tool → `.fabric/.import-state.json.tmp` (full JSON content; never partial / never appended).
- **Step B**: `Bash` → `mv .fabric/.import-state.json.tmp .fabric/.import-state.json`.

This 2-step pattern is mandatory for every state file update. `mv` is atomic on POSIX (`rename(2)` on the same filesystem guarantees the target either points to the old or new inode, never to a half-written file). `Write` alone is NOT atomic — the open + truncate + write sequence opens a window in which a crash leaves a zero-length or partially-written file on disk, which Phase 0.1 then has to discard. The `.tmp` + `mv` pattern eliminates that window.

Crash safety expectations:

- Crash between Step A and Step B → leaves `.fabric/.import-state.json.tmp`. Phase 0 residue scan (see `ref/source-state-recovery.md`) triages it on next invocation.
- Crash during Step B (between the `rename` syscall start and return) → POSIX `rename` is atomic; either the prior `.import-state.json` is intact, or the new one is in place. No torn state.
- Crash before Step A → no state mutation occurred; prior state file is unchanged.

The legacy phrasing `atomicWriteJson` / `write-temp-then-rename` used in earlier drafts of this skill refers to this exact 2-step pattern; the explicit Step A / Step B description above is the canonical form.

## events.jsonl Constraint Note

Event lines appended to `.fabric/events.jsonl` are subject to POSIX single-write atomicity: only writes ≤ 4KB (`PIPE_BUF`) are guaranteed atomic via `Bash: echo "..." >> file`. Lines exceeding 4KB risk interleaved corruption under concurrent skill + server writes to the same ledger.

Skills MUST ensure:

- Each event JSON line is a **single line** (no embedded newlines; escape `\n` in any string value).
- `session_context` and other free-form text fields **self-truncate** to keep the entire serialized line under 4KB. Suggested per-field caps: `session_context` first 500 chars; `source_sessions` cap at 5 entries; `recent_paths` cap at 20 entries; `user_messages_summary` first 500 chars.
- If approaching the 4KB ceiling after the per-field caps, drop optional fields (e.g. tags / extra metadata) **before** truncating semantic content.
- This constraint applies to any event the skill itself appends; MCP-server-side appends (via `appendEventLedgerEvent`) are already line-length-bounded server-side.

## Schema (all fields)

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

## Resume Logic (Idempotent Re-Invocation)

On every skill invocation, BEFORE Phase 1 starts:

1. Read `.fabric/.import-state.json`. ENOENT → fresh run, initialize state with `phase: "P1-done"` after Phase 1 completes (state file is created at end of Phase 1, not at start).
2. If `phase === "complete"` AND `last_checkpoint_at < 24h ago` → SKIP this invocation (precondition warning) unless user explicitly typed `re-run import` or `reset import`.
3. If `phase === "complete"` AND `last_checkpoint_at ≥ 24h ago` → ask the user (free-text prompt, NOT AskUserQuestion since this is rare). UX i18n Policy class 3 — confirmation prompts:

   - zh-CN: `上次 import 已完成 (<N> 天前)。重新运行将基于当前 canonical 重做 P2/P3。继续？(y/n)`
   - en: `Last import completed (<N> days ago). Re-running will redo P2/P3 against the current canonical set. Continue? (y/n)`

   If `n`, exit.
4. If `phase === "P1-done"` → skip Phase 1; resume from Phase 2 Step 2.1; iterate git log skipping any sha already in `p2_processed_commits[]`.
5. If `phase === "P2-done"` → skip Phase 1 + Phase 2; resume from Phase 3 Step 3.1; iterate Phase 2 outputs skipping any pending_path already in `p3_dedup_completed[]`.
6. After every successful sub-step (one commit processed, one doc processed, one dedup pair resolved), write the updated state file via the 2-step `.tmp` + `mv` pattern. Failures append to `errors[]` and proceed (or halt with prompt if cumulative errors `>5`).

The contract: re-invoking archive source mode after ANY interruption (Ctrl-C, crash, network blip on MCP) MUST NOT propose duplicates of already-proposed entries and MUST NOT redo already-completed dedup decisions.
