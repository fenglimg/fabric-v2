# Analysis Discussion — Grill-Me Follow-Up

**Session**: ANL-2026-05-10-fabric-knowledge-pivot (continuation)
**Topic**: Detailed engineering decisions left open after the v2.0 rebrand commitment — filename convention, pending stage, language policy, topology, sync contract, and the contract surface of the four MCP tools.
**Started**: 2026-05-10 (UTC+8), after rc.1 ship + rc.2-prep ship
**Trigger**: Two unresolved questions raised by user — (1) `.fabric/knowledge/` 文件结构与命名统一，(2) `plan_context` MCP 与具体使用的 MCP 在新结构中的承接关系
**Method**: grill-me skill, single-question cadence, recommendation-with-rationale per question
**Outcome**: 7 questions resolved, all LOCKED by user; downstream lite-plan `fabric-v2-grill-followup-2026-05-10` opened to land the engineering deltas

## Table of Contents
- [Why a Follow-Up](#why-a-follow-up)
- [Code State at Grill-Time](#code-state-at-grill-time)
- [Q1 — Filename Convention](#q1--filename-convention)
- [Q2 — Pending Stage Layout & Id Allocation](#q2--pending-stage-layout--id-allocation)
- [Q3 — Knowledge-Entry Language Policy](#q3--knowledge-entry-language-policy)
- [Q4 — Directory Topology + Cache Rename](#q4--directory-topology--cache-rename)
- [Q5 — Authoritative Source & Sync Contract](#q5--authoritative-source--sync-contract)
- [Q6 — Existing-MCP v2 Adaptation](#q6--existing-mcp-v2-adaptation)
- [Q7 — New-MCP Contracts & Skill↔MCP Boundary](#q7--newmcp-contracts--skillmcp-boundary)
- [Engineering Delta Summary](#engineering-delta-summary)

## Why a Follow-Up

The original `discussion.md` and `handoff.json` locked the strategic direction (v2.0 clean rebrand, 4 RC cadence, 4 MCP tools, 3 Skills, dual-root layout). The rc.1-prep + rc.2-prep lite-plans then shipped concrete commits implementing that direction. But two whole branches of design remained vague:

1. **File naming inside `.fabric/knowledge/{type}/`.** rc.1 dogfood produced a split: `decisions/` used `KT-DEC-NNNN.md` (id-based), while `models/` `guidelines/` `processes/` used slug-based names like `tech-stack.md` `code-style.md`. This inconsistency was tolerated through rc.1-prep because the schema and counter mechanism were higher-priority. But the rc.2 archive loop is about to create dozens more entries — the convention must lock first.

2. **MCP承接结构.** `fab_plan_context` and `fab_get_rule_sections` exist and work, but their data flow — `.md → rule-meta-builder → agents.meta.json → MCP response` — was never written down as a contract. The two new tools (`fab_extract_knowledge`, `fab_review`) need explicit input/output shape, idempotency keys, and Skill↔MCP responsibility boundaries before rc.2 implementation begins.

This follow-up grill resolves both branches with 7 LOCKED decisions.

## Code State at Grill-Time

- `.fabric/knowledge/decisions/` contains 9 files named `KT-DEC-0001.md` .. `KT-DEC-0009.md`
- `.fabric/knowledge/{models,guidelines,processes}/` contains 5 files named by slug
- `.fabric/knowledge/pending/` is empty (`.gitkeep` only)
- `~/.fabric/knowledge/` does not exist yet (no personal entry written)
- `agents.meta.json` exists at `.fabric/`, indexes only KT entries
- `packages/server/src/services/plan-context.ts` reads `agents.meta.json` and returns `description_index[].stable_id` to clients; clients call `fab_get_rule_sections` to materialize content
- `inferKnowledgeLayerFromContentRef()` hard-codes `.fabric/knowledge/` (team) and `~/.fabric/knowledge/` (personal) prefix matching

## Q1 — Filename Convention

### Options Considered
- **(A) Pure id**: `KT-DEC-0001.md` — id is the only file identifier; humans navigate by counter
- **(B) Pure slug**: `boundary-b-async-review.md` — humans navigate by topic; id lives only in frontmatter
- **(C) Combined `<id>--<slug>.md`**: e.g. `KT-DEC-0001--boundary-b-async-review.md` — id prefix + double-dash separator + slug suffix
- **(D) Pure id + auto-generated index.md**: id-only filenames plus a doctor-maintained `INDEX.md` that maps id → human description

### Recommendation
**(C) Combined `<id>--<slug>.md`**. The current state already proves neither pure scheme works alone — decisions naturally want id (numbered references), but init-scan baselines naturally want slug (topical names). Combined keeps both axes visible. The double-dash separator avoids ambiguity with regular slug hyphens.

### Rationale
- Layer-flip via `git mv KT-...--slug.md → KP-...--slug.md` keeps the slug segment stable and `git log --follow` traceable
- File-system level KT/KP prefix acts as secondary evidence for layer (frontmatter is primary) — doctor lint can detect `KT-...` files appearing under `~/.fabric/knowledge/`
- MCP承接零负担: `path.basename(file).split('--')[0]` recovers the id
- LLM-proposed slug introduces non-determinism, but the Skill (rc.2 fabric-archive) carries a NAMING guideline that constrains the LLM's choice

### LOCKED Decision
**LOCKED: filename = `<id>--<slug>.md`. LLM proposes slug, fabric-archive SKILL.md carries naming guideline (5 rules: kebab-case, 2-5 words, 20-40 chars, semantic core only, unique within type+layer). Layer-flip = `git mv` updating prefix; slug-rename = `git mv` keeping id stable.**

## Q2 — Pending Stage Layout & Id Allocation

### Options Considered
- **2.a Pending layout**: (A) flat `pending/<file>.md` / (B) by-type `pending/<type>/<slug>.md` / (C) flat with type prefix `pending/<type>--<slug>.md`
- **2.b Id allocation timing**: eager (counter++ on pending write, leaks counter on reject) / late (counter++ on approve only, no counter gaps) / hybrid (provisional id like `KT-DEC-P01`)
- **2.c Pending frontmatter id field**: (X) full id present / (Y) `id: pending` placeholder / (Z) no id field

### Recommendation
- **2.a = B (by-type subdirectories)** — mirrors final layout, makes review-skill UX clear, and the git-mv from `pending/<type>/foo.md` to `<type>/<id>--foo.md` has minimum diff complexity
- **2.b = late-bind** — counter monotonicity is a load-bearing audit property; eager-bind leaves "id was allocated but content was rejected" gaps that complicate event-ledger replay
- **2.c = Z (no id field)** — pending frontmatter has only `type / maturity:draft / layer / created_at / source_session / tags`; rule-meta-builder must SKIP the `pending/` subtree so MCP plan_context never returns pending entries

### Rationale
- Counter without gaps preserves the invariant "every KT-DEC-N corresponds to exactly one promoted entry"
- Skipping `pending/` in rule-meta-builder keeps the MCP plan-context surface clean — pending entries are drafts, not yet entitled to influence agent behavior
- The approve action becoming a 5-step transaction (counter++, frontmatter inject, git mv, meta rebuild, event append) is acceptable cost since it's a rare event

### LOCKED Decision
**LOCKED: pending = `pending/<type>/<slug>.md`, late-bind id (allocated only on approve), no `id` field in pending frontmatter. rule-meta-builder must skip `pending/` subtree. fab_review.approve is atomic 5-step with rollback semantics.**

## Q3 — Knowledge-Entry Language Policy

### Options Considered
- **3.a Scope**: which surfaces become zh-CN vs stay EN (frontmatter, section markers, headings, body, SKILL.md, prompt templates, docs/, CLI messages)
- **3.b Heading style**: M1 full zh-CN headings / M2 zh-CN headings + EN terms / M3 EN headings + zh-CN body + EN terms / M4 bilingual headings
- **3.c Tool default**: P1 fabric defaults zh-CN / P2 fabric defaults EN with `language` config / P3 fabric language-agnostic with "match-existing" heuristic / P4 EN tool + per-repo override
- **3.d Existing 13 dogfood entries**: R1 rewrite all / R2 keep mixed / R3 delete and re-dogfood
- **3.e init-scan baseline templates**: S1 hard-code zh-CN / S2 dispatch on config / S3 EN stub + skill rewrite

### Recommendation
- **3.a = surgical**: knowledge entry body → zh-CN; frontmatter fields/values → EN (protocol); section markers `[MISSION_STATEMENT]` etc → EN (LLM anchors); H1/H2 headings → see 3.b; SKILL.md / prompt templates / docs/ / CLI messages → all EN (OSS audience)
- **3.b = M3** (EN headings + zh-CN body + EN terms preserved). Headings are structural skeleton, not narrative — keeping them EN preserves grep/lint stability and LLM extraction signals; zh-CN narrative happens in the paragraphs under each heading
- **3.c = P3 plus a single `knowledge_language` config field**. Default `match-existing` lets LLM auto-detect from existing entries' language; per-repo override `zh-CN` or `en` for explicit control. Fabric tool itself stays language-neutral
- **3.d = R1** (rewrite all 13 entries to M3 zh-CN), as a single new commit in the follow-up plan
- **3.e = S2** (dispatch on `knowledge_language` config; init.ts hard-codes both EN and zh-CN templates for the 5 baselines)

### Rationale
- M3 keeps OSS users on a tool with no language opinion — a Korean or French team can set `knowledge_language: "match-existing"` and get their language back
- Mixing zh-CN body with EN headings is technically acceptable to LLMs (their training spans both); the inconsistency-cost is paid once per entry and the searchability-benefit is paid every grep
- Rewriting all 13 entries is cheap (~1.5h) because M3 keeps headings — only paragraphs need translation
- Adding a config field now is dramatically cheaper than retrofitting it after rc.2 spawns dozens more entries

### LOCKED Decision
**LOCKED: M3 style. fabric-config new field `knowledge_language: "match-existing" | "zh-CN" | "en"` default `"match-existing"`. fabric-monorepo's own config explicitly `"zh-CN"`. Existing 13 entries rewritten as a follow-up commit. init-scan templates dispatch on config.**

## Q4 — Directory Topology + Cache Rename

### Options Considered
- **4.a Per-type subdirectories**: T1 strict flat / T2 allow nested groups / T3 flat now, allow future nesting
- **4.b Personal layer mirror level**: U1 fully mirror team layout / U2 simplified flat / U3 same layout, fingerprinted root
- **4.c Counter strategy**: V1 independent counter+meta per layer / V2 shared global counter / V3 per-repo namespaced counter
- **4.d docs/ vs .fabric/knowledge/**: W1 strict separation / W2 mixed
- **4.e `rule-test.index.json`**: keep in `.fabric/` root with v1 name / rename to `knowledge-test.index.json` and move to `.fabric/.cache/`

### Recommendation
- **4.a = T3** (flat for now, nesting allowed by parser) — rule-meta-builder already supports recursive `**/*.md`, so future grouping is non-breaking
- **4.b = U1** (fully mirror) — review skill's layer-flip operation becomes pure prefix swap (`<repo>/.fabric/knowledge/<type>/KT-...` → `~/.fabric/knowledge/<type>/KP-...`)
- **4.c = V1** (independent meta files: `~/.fabric/agents.meta.json` for KP, repo `.fabric/agents.meta.json` for KT; readAgentsMeta merges at MCP read time)
- **4.d = W1** (strict separation): `docs/` is OSS project documentation (English, external audience); `.fabric/knowledge/` is project-specific living knowledge (per-repo language)
- **4.e = rename + move**: `rule-test.index.json` → `.fabric/.cache/knowledge-test.index.json`. The "rule" prefix is a v1 vocabulary remnant; the file is a regenerable cache, belongs under `.cache/`

### Rationale
- Per-type flat keeps things simple while review-skill UX is being designed; nesting is reserved for after volume justifies it
- KP global-uniqueness across all repos (V2) sounds elegant but creates absurd cross-project leakage — KP should mean "this user, this project," not "this user, anywhere"
- Independent meta files mean `readAgentsMeta` must change from `(projectRoot)` to `(projectRoot, homeDir)` and merge — this承接 cost is recorded for the rc.3 fab_review implementation
- `.cache/` subdirectory establishes a convention for future regenerable artifacts (test indexes, search caches) — should be added to `.gitignore`

### LOCKED Decision
**LOCKED: T3 flat-with-future-nesting; U1 personal mirrors team; V1 independent counter + meta files per layer; W1 docs/ ↔ .fabric/knowledge/ strict separation; rename `.fabric/rule-test.index.json` → `.fabric/.cache/knowledge-test.index.json` and add `.fabric/.cache/` to `.gitignore`.**

## Q5 — Authoritative Source & Sync Contract

### Options Considered
- **5.a Authoritative source**: X1 .md authoritative / X2 meta authoritative / X3 dual authoritative by domain
- **5.b Sync trigger**: Y1 explicit `fab scan` only / Y2 watcher real-time / Y3 write-time + watcher fallback / Y4 Y3 + doctor `--reindex`
- **5.c Drift detection**: Z1 id-set + key-frontmatter-fields comparison / Z2 content-hash comparison / `meta.revision` formula
- **5.d Approve transaction atomicity**: A1 event-sourced 2-phase / A2 in-memory transaction with conflict pre-check / A3 best-effort, doctor reports orphan ids
- **5.e Slug rename mechanism**: B1 rm + add (apparent rename) / B2 explicit `git mv` / B3 forbid slug rename

### Recommendation
- **5.a = X1** (.md authoritative). `.md` is git-first-class, PR-reviewable, human-editable. Meta is derived cache, recomputable. X2 makes git diff non-intuitive ("which one did I change?"); X3 is a consistency-bug factory
- **5.b = Y3** (write-time sync + watcher fallback). Internal writes (fab_review approve, layer-flip, fab scan) update meta transactionally. Watcher catches the rare case of user manually editing a `.md` file. Y4 (`doctor --reindex`) added as rc.4 nice-to-have
- **5.c = Z1 + meta.revision formula**: id-set match + frontmatter key fields (id/type/maturity/layer) match. Revision bumped on each meta update. `meta.revision = sha256(sorted(stable_id + ":" + frontmatter_hash))`. Content-hash drift would create noise from typo-level edits
- **5.d = A2 + A1**: in-memory transaction prepares everything (meta delta, frontmatter, target path) and pre-checks conflicts; success path appends `knowledge.promote_started` → does file ops → meta write → `knowledge.promoted`; failure path appends `knowledge.promote_failed` and discards in-memory transaction (counter ++ stays — orphan id reported by doctor)
- **5.e = B2** (explicit `git mv` + meta update + `knowledge.slug_renamed` event). Preserves history; matches OSS git-native ergonomics

### Rationale
- Counter monotonicity wins over rollback complexity. Orphan ids are visible (doctor reports), recoverable (user can manually re-promote), and rare (only on race-conditioned approve)
- 2-phase events make the audit log self-recoverable: replaying events.jsonl reconstructs intent even after a half-failed transaction
- The watcher's contention with write-time-sync is solved by a no-op short-circuit: when watcher detects a file change matching the expected meta.revision, it does nothing

### LOCKED Decision
**LOCKED: X1 .md authoritative. Y3 write-time + watcher fallback. Z1 id-set + frontmatter-key drift detection. `meta.revision = sha256(sorted(stable_id + ":" + frontmatter_hash))`, no bump on pending writes. A2 + A1 transactional 2-phase events. B2 explicit `git mv` for slug rename + layer flip. rc.4 doctor adds 7th lint check: "orphaned counter".**

## Q6 — Existing-MCP v2 Adaptation

### Options Considered
- **6.a tags exposure** in `description_index`: a1 yes flat / a2 no, internal only / a3 yes but limited to fab_review/fab_extract scope
- **6.b layer_filter input**: b1 always merged / b2 explicit `layer_filter` field / b3 binary `include_personal` flag
- **6.c selection_token cross layer-flip**: c1 hard error / c2 silent redirect / c3 silent empty / c4 error + `redirect_to: { stable_id }`
- **6.d Cross-layer same-slug merge**: d1 return both / d2 return both with `near_duplicate` diagnostic / d3 dedupe
- **6.e fab_get_rule_sections ENOENT**: e1 ENOENT to client / e2 server fallback grep / e3 1 meta-rebuild retry then ENOENT

### Recommendation
- **6.a = a1** (tags into description_index). rc.3 review needs tag-filter search; not exposing here forfeits the schema investment
- **6.b = b2** (explicit `layer_filter`) plus `default_layer_filter` in fabric-config. CI workflows want personal exclusion (don't pollute PR-review context with developer privates); local IDE workflows want both. Per-repo default avoids per-call repetition
- **6.c = c4** (`redirect_to` error). c1 forces double round-trip; c2 silently misleads agent; c3 just confuses. c4 is agent-friendly: agent sees the flip happened, decides whether to refresh
- **6.d = d2** (return both + `near_duplicate` diagnostic). d3 loses data; d1 confuses agent; d2 informs without deciding
- **6.e = e3** (1 meta-rebuild retry, then ENOENT). e1 dumps internal-consistency problems on clients; e2 full-grep is slow; e3 is self-healing within bounds

### Rationale
- These are all small surface-area additions but their absence becomes very expensive once rc.2 ships and creates real volume
- `default_layer_filter` is critical for CI — without it, every fab_plan_context call needs explicit `layer_filter: "team"` which is easy to forget
- `redirect_to` lets agent code be defensive without paying full re-plan-context cost on every layer-flip event

### LOCKED Decision
**LOCKED: a1 tags in description_index; b2 layer_filter input + default_layer_filter config (default "both"); c4 redirect_to error shape; d2 near_duplicate diagnostic; e3 1 meta-rebuild retry. All schema additions land in the follow-up plan as protocol pre-lock.**

## Q7 — New-MCP Contracts & Skill↔MCP Boundary

### Options Considered
- **7.a fab_extract_knowledge input thickness**: a1 thin (server self-extracts from events) / a2 semi-thick (skill summarizes context) / a3 thick (skill dumps raw, server runs LLM)
- **7.b idempotency key**: b1 source_session only / b2 (source_session, content_hash) / b3 (source_session, slug) / b4 (source_session, type, slug)
- **7.c output shape**: full proposed[] vs minimal `pending_path[]`
- **7.d fab_review action input shapes**: approve uses `ids[]` (eager-bind compatible) vs `pending_paths[]` (late-bind compatible)
- **7.e Skill ↔ MCP responsibility**: thin MCP / thick MCP with LLM
- **7.f docs split**: f1 single docs/schema.md / f2 split into data-schema.md + mcp-contracts.md / f3 single file with sectioned headings

### Recommendation
- **7.a = a2** (semi-thick: source_session + recent_paths + user_messages_summary). Thin MCP principle: MCP is data + control primitive, NOT LLM orchestrator. Skill prepares context, server persists
- **7.b = b3+b4 hybrid**: `(source_session, slug)` matches → evidence-append; new `(source_session, type, slug)` → new entry. Couples naturally with the Q1 naming guideline (LLM should reuse same slug for related observations)
- **7.c = full proposed[]** with summary, pending_path, evidence_appended_to (for evidence-append mode), plus events_appended[], plus optional empty_reason. summary is server-side string truncation, NOT LLM-generated
- **7.d = pending_paths[]** for approve (matches Q2 late-bind); modify.layer is the only path for layer-flip (no separate flip_layer action — keeps the action enum at 6); defer expiry → doctor lint, not hook proactive
- **7.e = thin MCP + thick Skill**, codified in `docs/mcp-contracts.md` as a design principle. Responsibility matrix: extraction classification / layer inference / slug naming / mode inference / semantic dedup → Skill (LLM); pending file write / frontmatter assembly / idempotency check / counter mgmt / layer-flip transaction / atomic promote → MCP (deterministic)
- **7.f = f2** (split data-schema.md + mcp-contracts.md). Different audiences (data: contributors + AI parsers; API: client integrators + cross-client behavior reference)

### Rationale
- Thin MCP avoids API key, retry, billing, provider abstraction concerns leaking into the server. Skill is where LLM lives
- `(source_session, type, slug)` aligns with the "reuse same slug" naming guideline rule, making the幂等 logic and the naming logic mutually-reinforcing
- Splitting docs prevents the 300+ line monolith problem and lets each doc serve a different audience tone
- Pre-locking all 4 MCP zod schemas in this follow-up means rc.2 and rc.3 implementation can be pure server code — no schema commits, no protocol drift

### LOCKED Decision
**LOCKED: a2 semi-thick input. b3+b4 hybrid idempotency. c full proposed[] output with server-side summary. d approve = pending_paths[], modify.layer for flip, defer expiry by doctor. e thin MCP / thick Skill with explicit responsibility matrix. f2 split data-schema.md + mcp-contracts.md. All 4 MCP zod schemas pre-locked in the follow-up plan.**

## Engineering Delta Summary

The follow-up plan `fabric-v2-grill-followup-2026-05-10` decomposes these 7 LOCKED decisions into 10 atomic tasks:

| Task | Maps to | Type |
|---|---|---|
| TASK-001 | This document | docs |
| TASK-002 | Q3 + Q6 (fabric-config additions) | feat(schema) |
| TASK-003 | Q6 + Q7 (api-contracts additions) | feat(schema) |
| TASK-004 | Q5 + Q7 (event-ledger pre-registration) | feat(schema) |
| TASK-005 | Q4.e (cache rename) | refactor |
| TASK-006 | Q5 + Q6 + Q7 (docs split) | docs |
| TASK-007 | Q3.d (zh-CN dogfood rewrite) | docs(dogfood) |
| TASK-008 | Q3.e (init-scan bilingual templates) | feat(init) |
| TASK-009 | Q3 (fabric-monorepo own config) | chore(dogfood) |
| TASK-010 | Day-1 verification gate | (no commit) |

Total budget ~8-12 hours. Per-task atomic conventional-commit; per-commit Gemini Review gates next task. ≥90% new-code coverage. Day-1 gate (TASK-010) is the boundary — once it passes, rc.2 implementation (fab_extract_knowledge MCP + fabric-archive Skill + Stop hooks) opens.

Once rc.2 begins, the 7 LOCKED decisions in this document become non-renegotiable contracts. Any need to revisit triggers a new grill session, not in-flight amendment.
