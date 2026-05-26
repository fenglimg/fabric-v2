# Initialization

`fabric install` is the standard entry point. In v2.0 it does **three things** in
a single idempotent run: scan the repo, install Skills, install Stop hooks.
Every step is safe to re-run; existing user customizations are preserved.

> Cross-references: [README.md](../README.md) · [docs/knowledge-types.md](./knowledge-types.md) · [docs/roadmap.md](./roadmap.md) · [docs/data-schema.md](./data-schema.md)

## Overview

```text
fabric install
  │
  ├─ Phase 1: pre-flight checks
  │     project root · package manager · existing .fabric/
  │
  ├─ Phase 2: deterministic scan
  │     package.json · README first paragraph · build config · lint config · CI yaml
  │     → 4–7 baseline knowledge entries written to .fabric/knowledge/<type>/
  │
  ├─ Phase 3: Skill install
  │     fabric-archive · fabric-review · fabric-import
  │     → .claude/skills/  +  .codex/skills/   (Cursor reads either tree)
  │
  ├─ Phase 4: Stop-hook install
  │     archive-hint.cjs → .claude/hooks/  +  .codex/hooks/
  │     hook config → .claude/settings.json (hooks.Stop[]) + .codex/hooks.json (events.Stop[])
  │     (Cursor: no Stop-hook surface as of 2026-05; tracked in roadmap v2.1)
  │
  ├─ Phase 5: pointer install
  │     one-line skill references appended to AGENTS.md / CLAUDE.md / .cursor/rules
  │
  └─ Phase 6: scaffold
        .fabric/{knowledge/{5 type dirs}, pending/{5 type dirs}, agents.meta.json, events.jsonl}
```

`fabric` is the CLI entry point.

## Phase 1 — Pre-flight checks

Before any file is written, `fabric install`:

1. Detects the project root (walks up to find the nearest `package.json` or
   `.git/`). Aborts if neither is found.
2. Detects the package manager (`pnpm-lock.yaml` > `yarn.lock` > `package-lock.json`).
3. Checks for an existing `.fabric/` directory.
   - If absent: full install proceeds.
   - If present: re-init mode — diff against current scaffold, skip
     up-to-date files, preserve user customizations (especially
     `hooks.Stop[]` extensions in `settings.json`).
4. Validates supported clients: Claude Code, Cursor, Codex CLI. Other clients
   are dropped (see [docs/roadmap.md](./roadmap.md) for scope rationale).

## Phase 2 — Deterministic scan

The scan reads exactly six sources and emits 4–7 baseline entries:

| Source | Produces | Type |
|--------|----------|------|
| `package.json` (deps + scripts) | "Tech stack: …" | `models` |
| `README.md` first paragraph (or first 200 chars) | "Project mission: …" | `models` |
| Build config (`vite.config.*`, `tsconfig.json`, `next.config.*`, `webpack.config.*`) | "Build pipeline: …" | `models` |
| Code style indicators (`.eslintrc*`, `.prettierrc*`, `tsconfig.json#strict`) | "Code style: …" | `guidelines` |
| CI yaml (`.github/workflows/*.yml`, `.gitlab-ci.yml`) | "CI pipeline: …" | `processes` |
| Existing folder structure (heuristic) | "Module layout: …" | `models` |

Entries land in `<repo>/.fabric/knowledge/<type>/` with `maturity: draft` and
`layer: team`. They are baseline candidates intended to be reviewed (and
likely refined) by `fabric-review` Skill on first use.

The scan is **deterministic**: same repo state in → same entries out. No LLM
involved at this phase. LLM-driven enrichment is a separate, opt-in step
provided by the `fabric-import` Skill (see Phase 3).

## Phase 3 — Skill install

Three Skills land in both `.claude/skills/` and `.codex/skills/`:

1. **`fabric-archive`** — invoked by Stop hook or user. 5-type extraction
   prompt + layer classification heuristic + slug naming rules. Writes
   confirmed candidates to `.fabric/knowledge/pending/<type>/` via
   `fab_extract_knowledge` MCP tool.
2. **`fabric-review`** — invoked when `pending/` accumulates. 6-action
   review loop: list / approve / reject / modify / search / defer. Mode
   inference: detects whether to enter batch-review or single-entry-edit
   mode based on backlog size.
3. **`fabric-import`** — invoked manually for LLM-driven enrichment of the
   baseline scan. 3-phase pipeline (extract → classify → batch-write) with
   `.import-state.json` checkpoint for resumable runs.

Cursor reads from `.claude/skills/` (or `.codex/skills/` — whichever the
user has configured); no separate install path is needed.

## Phase 4 — Stop-hook install

The Stop hook fires at the end of every agent turn and decides whether to
prompt the user to archive. Two signals trigger:

1. **Archive opportunity**: `events.jsonl` shows ≥5 `plan_context` entries
   since the last `knowledge_proposed` event, OR ≥24h elapsed since last
   archive.
2. **Pending overflow**: `.fabric/knowledge/pending/` has ≥10 entries
   awaiting review (added in rc.3) — recommends `fabric-review` Skill.

Install layout:

```text
.claude/hooks/archive-hint.cjs        # the hook script (single source)
.claude/settings.json                  # hooks.Stop[] += [{ command: "node .claude/hooks/archive-hint.cjs" }]
.codex/hooks/archive-hint.cjs         # same script, copied (Codex repo skill convention)
.codex/hooks.json                      # events.Stop[] += [{ command: "node .codex/hooks/archive-hint.cjs" }]
```

The same `.cjs` script serves both clients because Claude Code and Codex CLI
accept the same stdout JSON shape: `{"decision":"block","reason":"..."}`.
This is documented as `KT-DEC-0009` in the self-repo.

**Cursor** is supported for Skills but has no Stop-hook surface as of
2026-05; tracked in [docs/roadmap.md](./roadmap.md) v2.1.

### Hook config merge — preserve user customizations

`hooks.Stop[]` is an *array*; users may have appended their own commands.
The merge logic (in `packages/cli/src/install/hooks.ts`):

1. Read existing `hooks.Stop[]`.
2. Index by hook command path (e.g. `node .claude/hooks/archive-hint.cjs`).
3. If Fabric's hook is already present → no-op.
4. If absent → append Fabric's entry; preserve all other user entries.

A naive `deepMerge` would *replace* the array and silently drop user
customizations — that pitfall is captured in the project's own knowledge
base (search `pending/pitfalls/` for `deepmerge-array-replace`).

## Phase 5 — Pointer install

A one-line reference is appended to client-specific entrypoints:

- `AGENTS.md` (Codex CLI convention)
- `CLAUDE.md` (Claude Code convention)
- `.cursor/rules/fabric.mdc` (Cursor convention)

Each pointer reads, e.g.:

```text
Fabric: see .claude/skills/fabric-archive/SKILL.md and
.claude/skills/fabric-review/SKILL.md for archiving and review.
```

If the file exists with user content, the pointer is appended (not
replacing). If the pointer line is already present, no-op.

## Phase 6 — Scaffold

Final filesystem state after a fresh init:

```text
.fabric/
├── knowledge/
│   ├── decisions/
│   ├── pitfalls/
│   ├── guidelines/
│   ├── models/
│   ├── processes/
│   └── pending/
│       ├── decisions/
│       ├── pitfalls/
│       ├── guidelines/
│       ├── models/
│       └── processes/
├── agents.meta.json    # counter envelope: { KT-DEC: N, KT-PIT: N, ... }
└── events.jsonl        # append-only event ledger (15 typed events)
```

`agents.meta.json` and `events.jsonl` are **derived** — `fabric doctor --fix`
can rebuild them from the knowledge tree if corrupted. The knowledge tree
itself is the source of truth.

## Idempotent re-run

`fabric install` is safe to run repeatedly. On re-run:

- Phase 1 detects the existing scaffold and switches to re-apply mode.
- Phase 2 skips re-scanning if `.fabric/forensic.json` is fresh (<24h);
  `--force` overrides.
- Phase 3 diffs Skill template hashes; updates only changed files.
- Phase 4 merges hook config (preserves user `hooks.Stop[]` extensions).
- Phase 5 checks for existing pointer line; no-op if present.
- Phase 6 creates only missing directories; never deletes existing entries.

Use `fabric install --force` to override the freshness check on Phase 2.

## `fabric hooks` — re-apply hook install only

After upgrading the package, you may want to refresh just the Stop-hook
script without re-running the full init:

```bash
fabric hooks
```

This re-runs Phase 4 (script copy + config merge) without touching scan
output, Skills, or pointers. Safe to run anytime.

## Manual customization

You may freely edit:

- `hooks.Stop[]` in `.claude/settings.json` and `events.Stop[]` in
  `.codex/hooks.json` — additional commands are preserved on re-init.
- Skill content in `.claude/skills/*/SKILL.md` and `.codex/skills/*/SKILL.md`
  — Fabric's re-init detects local edits via content hash and prompts before
  overwriting (use `--force` to skip the prompt).
- Pointers in `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/fabric.mdc` — the
  pointer line is identified by a deterministic anchor; surrounding user
  content is preserved.

## Cursor support note

Cursor reads Skills from `.claude/skills/` or `.codex/skills/` (whichever it
finds first per its configured search paths). However, **Cursor has no
Stop-hook surface as of 2026-05** — Phase 4 silently skips Cursor. When
Cursor exposes a Stop-hook API, Fabric will add a `.cursor/hooks/` install
path; tracked in [docs/roadmap.md](./roadmap.md) v2.1.

## Verification

After init, run:

```bash
fabric doctor
```

Expected output: 0 errors, 0 fixable findings. The Stop hook is installed
but won't fire until the agent has produced ≥5 `plan_context` events; this
is normal.

To confirm the scan output:

```bash
ls .fabric/knowledge/models/        # 1–3 baseline models
ls .fabric/knowledge/guidelines/    # 0–2 baseline guidelines (if lint configs present)
ls .fabric/knowledge/processes/     # 0–1 baseline processes (if CI yaml present)
```

Total baseline count is 4–7 entries depending on what the repo exposes.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `fabric install` reports "no project root" | run from outside a repo | `cd` into a repo with `package.json` or `.git/` |
| Re-init wiped my custom Stop hook | should not happen — please file an issue | meanwhile: re-add manually in `settings.json` |
| Cursor doesn't trigger archive prompt | expected — Cursor lacks Stop-hook surface | use Skill manually: invoke `fabric-archive` |
| `fabric doctor` reports `counter_desync` | `agents.meta.json` drifted from filesystem | `fabric doctor --fix` rebuilds counters |
| `pending/` has >10 entries and growing | review backlog | invoke `fabric-review` Skill (Stop hook now prompts) |

For deeper schema and event reference, see [docs/data-schema.md](./data-schema.md)
and [docs/mcp-contracts.md](./mcp-contracts.md).
