# Planning Context — Fabric v2.0 rc.2 Preparation

## Source Context

**Prior analysis session**: `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/` (confidence 0.93)
**Prior lite-plan (rc.1)**: `.workflow/.lite-plan/anl-2026-05-10-fabric-knowledge-pivot-2026-05-10/`
**rc.1 commit**: `aaf9c2c feat(v2): rc.1 clean rebrand — knowledge layer, dual-root, path-decoupled stable_id`
**Code review for rc.1**: passed (atomic write, monotonic counter, scope discipline)

**Memory constraints**:
- Fabric supports only Claude Code / Cursor / Codex CLI (Windsurf/Roo Code/Gemini CLI dropped)
- Clean-slate refactors preferred (zero users → no migration tax)

## Grill-Me Decisions Locked (2026-05-10)

User confirmed all 7 recommendations across grill-me session. Each maps to concrete tasks below.

### Q1 — Version strategy (CONFIRMED)
- `package.json` 2.0.0-rc.1 (single commit, retroactive on rc.1 commit)
- Annotated git tag `v2.0.0-rc.1`
- Old `1.8.0-rc.3` stays in npm history (deprecate as needed)

### Q2 — Dropped client cleanup (CONFIRMED)
Independent commit "v2: remove dropped clients (Windsurf/Roo Code/Gemini CLI)":
- `packages/shared/src/schemas/fabric-config.ts:5` — drop `.passthrough()`, strict union `claudeCode | cursor | codex`, **unknown keys reject and exit**
- `packages/cli/__tests__/fixtures/clientScope.test.ts:8` — `ClientKind` union remove `"Windsurf"` etc
- 6 files containing `windsurf|rooCode|geminiCLI`: `doctor.ts`, `doctor.test.ts`, `schemas-roundtrip.test.ts`, `fabric-config.ts`, `clientScope.test.ts`, `doctor-fix.test.ts` — all references removed (no skip-test, hard delete)

### Q3 — Self-repo dogfood (CONFIRMED)
Two-step dogfood:
1. Run `pnpm build && node packages/cli/dist/index.js init` on fabric monorepo itself
2. Verify acceptance: `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes,pending}/` created; `agents.meta.json.counters` has KT >= 4; 4-7 KT-* baseline `.md` with full v2 frontmatter; `~/.fabric/knowledge/` auto-created; `fab doctor` exit 0
3. Commit baseline `.md` to git: `chore(dogfood): v2.0 baseline knowledge entries`
4. Bug-handling protocol: hotfix on `2.0.0-rc.1` tag → `2.0.0-rc.1.fix.N`, NOT roll into rc.2

### Q4 — rc.1 真正完工 (CONFIRMED, 4 commits)

**Code review missed v1.x dead code paths**. Concrete grep findings:
- `buildInitialTaxonomyMarkdown` — 1 file (`packages/cli/src/commands/init.ts`) **STILL HAS THE FUNCTION**
- `INITIAL_TAXONOMY` — 5 files (`init.ts`, `doctor.ts`, `doctor.test.ts`, `init-atomic.test.ts`, `init-nondestructive.test.ts`)
- `.fabric/rules` — **26 files** including `init.ts`, `scan.ts`, `doctor.ts`, `rule-meta-builder.ts`, `server/index.ts`, `http.ts`, `bootstrap-guide.ts`, `forensic.ts`, watcher tests, **and user-facing templates** `agents-md/AGENTS.md.template`, `agents-md/variants/{vite,next,cocos}.md`, `husky/pre-commit`

**Commit A — CLI command layer**:
- Delete `packages/cli/src/commands/bootstrap.ts` (standalone command obviated by 4-stage init pipeline)
- `packages/cli/src/commands/init.ts`: delete `buildInitialTaxonomyMarkdown` function + all callers; remove all `.fabric/rules/` path constants and dir creation/check
- `packages/cli/src/commands/scan.ts`: confirm writes go to `.fabric/knowledge/`; remove any residual `.fabric/rules/` writes
- `packages/cli/src/scanner/forensic.ts`: remove `.fabric/rules/` scanning (forensic should only know source-code facts, not fabric self-state)

**Commit B — Server services layer**:
- `packages/server/src/services/rule-meta-builder.ts`: rename misleading functions like `findFabricRuleFiles`; switch path constants `.fabric/rules/` → `.fabric/knowledge/{type}/`
- `packages/server/src/services/doctor.ts` + `doctor.test.ts`: remove all checks targeting `.fabric/rules/` or `INITIAL_TAXONOMY` (false-positive forever in v2); rc.4 will add 6 new lint checks separately
- `packages/server/src/watcher.ts` (and test): watch path `.fabric/rules/**` → `.fabric/knowledge/**` + `.fabric/knowledge/pending/**`
- `packages/server/src/index.ts` + `packages/server/src/http.ts`: path constants synced
- **Delete entire file** `packages/shared/src/node/bootstrap-guide.ts` (v1 manual setup guidance, v2 init is turnkey)

**Commit C — Templates (user-facing — most critical)**:
- `packages/cli/templates/agents-md/AGENTS.md.template`: rewrite all `.fabric/rules/` → `.fabric/knowledge/{type}/`; introduce v2 vocabulary (5 type / 3 maturity / 2 layer)
- **Delete entire dir** `packages/cli/templates/agents-md/variants/` (`vite.md`, `next.md`, `cocos.md` — v1 framework presets, v2 init-scan auto-detects from forensic.json)
- **Delete file** `packages/cli/templates/husky/pre-commit` (v1 sync pre-commit gate, v2 model is async-review via `pending/` + fabric-review skill)
- **Delete entire dirs** (fabric-init three-piece, no v2 successor):
  - `packages/cli/templates/claude-skills/fabric-init/`
  - `packages/cli/templates/codex-skills/fabric-init/`
  - `packages/cli/templates/skill-source/fabric-init/`

**Commit D — Tests**:
- 13 test files reference v1.x paths/concepts. Default action: **delete**, only adapt if v2 equivalent purpose exists
- Likely delete-candidates by name:
  - `packages/server/src/services/rule-sync.test.ts` (v1 "rules sync protocol" — deprecated metaphor)
  - `packages/server/__tests__/tool-rule-freshness.test.ts` (v1 "rule freshness" — replaced by maturity/decay in rc.4 lint)
  - `packages/cli/__tests__/init-nondestructive.test.ts` (v1 semantic "don't break existing .fabric/rules/")
  - `packages/cli/__tests__/forensic-shadow-mirroring.test.ts` (if testing v1 forensic shadow over `.fabric/rules/`)
- Adapt-candidates: tests that exercise v2 schema/behavior but happen to reference old paths in fixtures

### Q5 — Release hygiene (CONFIRMED)
- CHANGELOG entry: BREAKING + Removed (v1.x list) + Added (v2 list) + Coming next (rc.2/3/4 preview)
- Git tag `v2.0.0-rc.1` (annotated)
- GitHub release marked `prerelease: true`; release notes = CHANGELOG entry
- **NOT publish to npm** during rc.x phase (entire RC cycle stays GitHub-only); `2.0.0` stable will publish to npm `latest`
- README.md: 5-line v2 banner injected at top (don't wait for rc.4 full rewrite — would mislead anyone landing during RC cycle)

### Q6 — Schema forward-compat (CONFIRMED, 1 commit, last cheap window)

**Add 1 frontmatter field**: `tags: [tag1, tag2]` (flat flow-style array, parser already supports). init-scan should auto-fill from forensic tech stack keywords. Required for rc.3 review skill's tag-filter search.

**NOT add**: `last_review_at`, `source_session`, `confidence_score`, `review_count`, `parent_id` — let events.jsonl be single source of truth (avoid double-write consistency issues).

**Event type rename for v2 vocabulary**:
| Old | New / action |
|---|---|
| `rule_context_planned` | → `knowledge_context_planned` |
| `rule_selection` | → `knowledge_selection` |
| `rule_sections_fetched` | → `knowledge_sections_fetched` |
| `rule_drift_detected` | → `knowledge_drift_detected` |
| `rule_baseline_accepted` | DELETE (v1 concept) |
| `baseline_synced` | DELETE (v1 concept) |
| `legacy_client_path_present` | DELETE (Q2 made obsolete) |
| `claude_skill_path_migrated`, `claude_hook_path_migrated`, `codex_skill_path_migrated` | KEEP |
| `mcp_config_migrated`, `meta_reconciled_on_startup`, `meta_reconciled` | KEEP |
| `reapply_completed`, `event_ledger_truncated`, `mcp_event`, `edit_intent_checked`, `init_scan_completed` | KEEP |

Net: 19 → 13 event types, with 4 renames + 3 deletions + 12 unchanged.

**Write `docs/schema.md`**: 1-page contract document covering frontmatter (7 fields), 13 event types, stable_id `K[PT]-(D|P|G|M|PR)-NNNN`, counters envelope. NOT marketing/READme rewrite (rc.4 scope).

### Q7 — Execution sequence + Day-1 gate + decision capture option B (CONFIRMED)

**Phase ordering (forced by dependencies)**: A → B → C → D → E
- A blocks B (B's strict-reject test relies on A's removal of legacy paths)
- C blocks D (schema must be locked before dogfood produces baseline)
- D blocks E (release tag should include dogfood baseline as part of rc.1)

**Phase D decision capture (option B, 5-8 entries)**: Author KT-D `.md` entries for these 8 core decisions during dogfood:
1. Boundary B (data + lifecycle + async-review primitive); rationale: rejected A=too thin, C=full-platform-wrong-fit
2. v2.0 clean rebrand over v1.x staged; rationale: 0 users → migration tax = 0
3. Dual-root layout (`~/.fabric` + `<repo>/.fabric`); rationale: gitignore can't filter by frontmatter
4. stable_id `K[PT]-(D|P|G|M|PR)-NNNN` + monotonic counter; rationale: path-decoupled, layer-flip is only legal mutation
5. 5-type / 3-maturity / 2-layer schema; rationale: flat scalars constraint from existing parser
6. Review mode inference (not AskUserQuestion); rationale: AskUserQuestion is for genuine choices, mode is deducible
7. Hook = reminder layer (exit 2 + stderr/followup_message); rationale: never block agent permanently
8. Decay thresholds 90/30/14 days; rationale: 1/4 of Tencent article 12/6/N months — single-repo high-frequency scaling

**Day-1 gate before opening rc.2** (ALL must pass):
```bash
# Code archaeology clean
grep -r "\.fabric/rules\|INITIAL_TAXONOMY\|buildInitialTaxonomyMarkdown\|bootstrap-guide\|fabric-init.*skill\|windsurf\|rooCode\|geminiCLI\|legacy_client_path_present\|rule_baseline\|baseline_synced" packages/  # output empty
test ! -f packages/cli/src/commands/bootstrap.ts
test ! -d packages/cli/templates/agents-md/variants
test ! -f packages/cli/templates/husky/pre-commit
test ! -d packages/cli/templates/claude-skills/fabric-init
test ! -d packages/cli/templates/codex-skills/fabric-init
test ! -d packages/cli/templates/skill-source/fabric-init

# Build + tests + lint green
pnpm build && pnpm test && pnpm lint

# Schema additions present
grep -E "tags:" packages/shared/src/schemas/agents-meta.ts  # hit
grep -c "knowledge_" packages/shared/src/schemas/event-ledger.ts | awk '$1 >= 4'  # ≥ 4 hits
test -f docs/schema.md

# Self-repo dogfood
test $(ls .fabric/knowledge/decisions/ 2>/dev/null | wc -l) -ge 8        # 8 decisions captured
test $(ls .fabric/knowledge/{models,guidelines,processes}/*.md 2>/dev/null | wc -l) -ge 4  # baseline
test "$(jq -r .counters.KT.D .fabric/agents.meta.json)" != "null"

# Release artifacts
test "$(jq -r .version package.json)" = "2.0.0-rc.1"
git tag --list "v2.0.0-rc.1" | grep -q "v2.0.0-rc.1"
gh release view v2.0.0-rc.1 --json isPrerelease | jq -e '.isPrerelease == true'
head -10 README.md | grep -iE "v2\.0.*rebrand|rc-stage"  # banner present
grep -A2 "## 2.0.0-rc.1" CHANGELOG.md | grep -i breaking
```

## Out of Scope (rc.2/3/4 — NOT in this session)

- `fab_extract_knowledge` MCP tool (rc.2)
- `fabric-archive` skill template (rc.2)
- Stop hook scripts + 3-client configs (rc.2)
- `fab_review` MCP tool (rc.3)
- `fabric-review` skill template (rc.3)
- `doctor --lint` 6 deterministic checks (rc.4)
- `fabric-import` skill template (rc.4)
- Full README rewrite + `docs/knowledge-types.md` + `docs/initialization.md` + `docs/roadmap.md` (rc.4)
- New event types `knowledge.{proposed,promoted,layer_changed,demoted,archived,archive_attempted}` (rc.2/3/4 will add as `z.literal()` discriminated union variants)

## Time Budget

| Phase | Estimate |
|---|---|
| A · Q4 4-commit code archaeology | 4-6h |
| B · Q2 drop client cleanup | 1-2h |
| C · Q6 schema forward-compat (tags + event rename + docs/schema.md) | 2-3h |
| D · Q3 dogfood + 8-decision capture | 2-3h |
| E · Q1+Q5 version + CHANGELOG + tag + GitHub release + README banner | 1h |
| **Total** | **10-15h (~2-3 工作日)** |
