# Migration guide: Fabric v2.0.0-rc.36 → v2.0.0 GA

> Audience: existing `v2.0.0-rc.x` users (rc.5+) preparing to upgrade to the
> v2.0.0 GA release. Net result is a small, mostly-mechanical migration:
> `pnpm dlx @fenglimg/fabric-cli@latest install` does the heavy lifting; a
> handful of behaviors changed and a few flags moved.

## TL;DR (3 commands)

```bash
# 1. Upgrade the global CLI (or your project pin)
pnpm add -g @fenglimg/fabric-cli@latest      # or: npm i -g

# 2. Re-run install in each project that was on rc.x
cd your-project && fabric install

# 3. Restart your AI client (Claude Code / Cursor / Codex CLI)
#    so it picks up the regenerated MCP config + hooks.
```

That's it for the happy path. The rest of this doc covers the behavior changes
you'll see and the rare cases where you need to do something else.

---

## What changed between rc.36 and GA

The GA release rolls up rc.37's Wave A + Wave B + Wave D changes. The summary:

### 1. `fabric serve` is gone from the main CLI surface

`fabric serve` (the Express + REST + SSE + Dashboard UI HTTP server) was
quarantined to `packages/server-http-experimental/` and is no longer built or
tested by default. v2.0.0 clients (Claude Code / Cursor / Codex CLI) all use
**stdio MCP transport exclusively**, so the HTTP server had zero consumer.

**Migration**: if you ever ran `fabric serve` directly (instead of letting
your AI client spawn the MCP server over stdio), stop. Re-run `fabric install`
and let the regenerated MCP config spawn the server. The Dashboard UI is gone
in v2.0.0; restoration recipe lives at `packages/server-http-experimental/README.md`.

The following environment variables / CLI flags no longer apply and can be
removed from your shell rc / launchd plist / systemd unit:

- `FABRIC_AUTH_TOKEN` (was: bearer-auth for non-loopback HTTP)
- `fabric serve --host <addr>` / `--port <n>` / `--allow-loopback-no-auth`

### 2. `fab_recall` MCP tool (NEW-3)

A new MCP tool `fab_recall` replaces the common two-step `fab_plan_context →
fab_get_knowledge_sections` ceremony for the typical "fetch every relevant
entry's body" use case. Pass `paths` (+ optional `intent` / `ids`) and get the
full markdown bodies back in one round-trip. The two-step tools still work
(unchanged contract) — `fab_recall` is purely additive.

**Migration**: AI clients with cached MCP tool lists need to restart to see
`fab_recall`. Until then they keep using the two-step flow (which still works
correctly). No action required from you.

### 3. Selection-token TTL default 5min → 30min (NEW-3)

`selection_token` returned by `fab_plan_context` now defaults to a 30-minute
TTL (was 5 minutes). Long-running AI sessions can reuse a single token across
multiple `fab_get_knowledge_sections` follow-up calls.

**Migration**: nothing. Existing tokens still expire on `revision_hash`
change; the longer TTL only matters for sessions that ALREADY exceeded 5min
under rc.x.

### 4. Cite policy simplified 4-state → 2-state (NEW-1)

The `KB:` line vocabulary collapsed: `[planned | recalled | chained-from |
dismissed]` → `[applied | dismissed:<reason>]`. `[applied]` consolidates all
positive uses (planned / recalled / chained-from); the dismissal channel is
unchanged. The parser still accepts old tags for back-compat, so in-flight
sessions continue to count toward cite-coverage.

**Migration**: nothing required. Future AI replies will use the new vocabulary
once they reload AGENTS.md (`.fabric/AGENTS.md` was rewritten in-place by the
new template; `fabric install` syncs it).

### 5. cite-policy-evict default ON (NEW-18)

The cite-policy reminder hook (Claude Code only, UserPromptSubmit) now fires
every 10 turns by default. Operators on short / scripted sessions can opt out
by setting `cite_evict_interval: 0` in `.fabric/fabric-config.json`.

### 6. Layer-flip transparent redirects (NEW-24)

When `fab_review modify --layer` reassigns an entry's stable_id across layer
counters, the server now emits a `knowledge_id_redirect` event AND
`fab_plan_context` / `fab_recall` / `fab_get_knowledge_sections` transparently
rewrite stale caller-held ids before fetching. No more "rule not found" after
a layer flip.

**Migration**: nothing.

### 7. Self-archive triggers simplified 4 → 2 categories (NEW-2)

`AGENTS.md` self-archive trigger taxonomy collapsed:

- **User-driven normative** (merges old: Normative + Decision-confirmation + Explicit-dismissal)
- **Wrong-turn-and-revert** (unchanged)

Old marker names (`Normative` / `Decision confirmation` / `Explicit dismissal`)
still route correctly because the Phase 1.5 gate only matches the verbatim
`self-archive policy triggered by signal` prefix.

### 8. events.jsonl + metrics.jsonl split (Wave B)

A new sidecar `.fabric/metrics.jsonl` aggregates high-frequency counter
events (60s flush, server-side). The audit `events.jsonl` ledger keeps the
state-transition events. A 6-hour server-side rotation tick prunes events
older than the retention window automatically — `fabric doctor --fix` is no
longer the only path that triggers rotation.

**Migration**: nothing. Existing `events.jsonl` continues to work; the new
sidecar starts accumulating on next MCP server start.

A new doctor check `Events ledger health (rc.37 Plan B 5 hard gate)` warns
when:

- events.jsonl > 10 MB
- metric-managed event_types leak into the audit ledger
- metrics.jsonl is stale (> 10 min since last flush)
- events.jsonl rotation is overdue (> 90 days)

### 9. `fabric metrics` CLI dashboard (NEW-34)

```bash
fabric metrics                    # all-time counter totals
fabric metrics --since 24h        # last 24h only
fabric metrics --json             # machine-readable
```

Surfaces counter trends + top-10 per-entry consumed leaderboard (helps spot
Goodhart patterns where the AI cites a single hot id over and over).

### 10. Doctor TL;DR header (NEW-25)

`fabric doctor` human output now leads with a TL;DR top-3 critical issues
header so you don't scroll past 48 OK checks to find what to fix. `--json`
output unchanged.

### 11. Knowledge-hint-broad SessionStart 'next step' nudge (NEW-23)

The SessionStart hook output now ends with a bilingual `下一步 / Next:` line
nudging `fab_recall(paths)` or `fab_plan_context`. Eliminates the common
"AI parsed the index then moved on without using it" failure mode.

### 12. Auto-disambiguated pending slugs (NEW-6)

`fab_extract_knowledge` no longer throws on slug collisions. When two
distinct triples sanitize to the same slug, the server auto-routes the second
to `slug-2.md` (then `-3` / `-4` / ... up to `-9`) instead of refusing the
write. Parallel-session archives Just Work.

### 13. Per-field 4 KB truncate on events.jsonl writes (NEW-14)

`appendEventLedgerEvent` now truncates any string field exceeding 4 KB (PIPE_BUF
on Linux/macOS) + appends a sentinel marker. Defends against POSIX
atomic-write violations when a huge string lands in a concurrent-writer
ledger.

### 14. Prompt-injection sanitization on KB body writes (NEW-31)

`fab_extract_knowledge` strips obvious prompt-injection patterns (`ignore
previous instructions` / `rm -rf /` / `you are now a ... assistant` / ChatML
envelope markers / etc.) from `summary` / `session_context` / `must_read_if`
/ `intent_clues` / `slug` before persisting. Redactions emit a
`knowledge_archive_attempted` event for audit.

### 15. evidence_paths frontmatter field (NEW-7)

Read-only paths the agent consulted are now persisted to the pending entry's
frontmatter `evidence_paths: [...]` field (alongside the legacy body
`## Evidence` markdown block for back-compat). Lets plan-context retrieval
read evidence as data instead of re-parsing markdown.

---

## Workspace-side state — what migrates automatically

| File | Migration |
|------|-----------|
| `.fabric/AGENTS.md` | Rewritten by `fabric install` (managed block — your edits outside the markers are preserved). |
| `.fabric/agents.meta.json` | Untouched. Schema is forward-compatible; doctor's auto-heal handles any drift on first MCP read. |
| `.fabric/events.jsonl` | Untouched. Existing rows continue to work; 6h rotation tick will prune > 90d entries on next server start. |
| `.fabric/metrics.jsonl` | NEW. Starts accumulating on first MCP server start. Absent until then. |
| `.fabric/knowledge/**/*.md` | Untouched. Existing entries continue to surface; new `evidence_paths` frontmatter field is optional. |
| `.fabric/knowledge/pending/**/*.md` | Untouched. |
| `.fabric/fabric-config.json` | Untouched. New keys (e.g. `cite_evict_interval`) are optional with sensible defaults. |
| `.claude/hooks/*.cjs` | Rewritten by `fabric install` from the latest templates. |
| `.codex/hooks/*.cjs` | Same. |
| `.cursor/hooks/*.cjs` | Same. |

---

## Workspace-side state — what you might want to migrate manually

### Old `summary == stable_id` entries (werewolf dogfood pattern)

If `fabric doctor` reports `knowledge_summary_opaque` for a high percentage
of entries, you have legacy pending entries where `summary` was either empty
or literally the stable_id. NEW-37 (in rc.37) blocks new writes of these,
but old entries linger.

**Migration**: invoke `/fabric-review` to batch-modify the opaque entries
with real one-line summaries.

### Old `events.jsonl` already past 10 MB

The new `events_jsonl_health` doctor check will warn on any pre-existing
ledger > 10 MB. Run `fabric doctor --fix` once after upgrade to trigger the
first rotation; subsequent rotations happen automatically on the 6h server
tick.

---

## Removed / deprecated surfaces

| Surface | Status | Replacement |
|---------|--------|-------------|
| `fabric serve` CLI command | Quarantined to `packages/server-http-experimental/` (not installed by default) | stdio MCP transport via `fabric install` |
| `FABRIC_AUTH_TOKEN` env var | No longer read by main-line code | N/A (HTTP server quarantined) |
| `cli.serve.*` i18n keys | Removed from locales | N/A |
| `--host` / `--port` / `--allow-loopback-no-auth` flags | Removed alongside `fabric serve` | N/A |
| `docs/dashboard-tour.md` | Deleted | N/A (Dashboard UI gone) |
| `docs/migration-1.8.md` | Deleted (v1.8 archived) | This file |
| `docs/release/v1.8.0-pr.md` | Deleted | N/A |
| 4-state cite tags (`planned` / `recalled` / `chained-from`) | Parser back-compat only; new emissions use `[applied]` | `[applied|dismissed:<reason>]` |
| 4-name self-archive signals | Parser back-compat only | 2-category taxonomy in AGENTS.md |

---

## Rollback path

The upgrade is non-destructive in terms of workspace state. To roll back to
the prior rc.x:

```bash
pnpm add -g @fenglimg/fabric-cli@2.0.0-rc.36
fabric install                    # regenerates rc.36 hooks/templates
```

Your `.fabric/knowledge/` + `.fabric/events.jsonl` survive across both versions.
The new `metrics.jsonl` sidecar is harmless to leave behind (rc.36 ignores
unknown files in `.fabric/`).

---

## When to file an issue

`fabric install` + restart should produce a clean `fabric doctor` run. If you
see any of these, file at <https://github.com/fenglimg/fabric-v2/issues>:

- `fabric install` fails with non-zero exit
- `fabric doctor` reports `event_ledger_invalid` after the upgrade (events.jsonl
  format regression — should never happen post-rc.36)
- AI client can't see the `fab_recall` / `fab_plan_context` tools after a
  full client restart (MCP config sync regression)

Happy shipping.
