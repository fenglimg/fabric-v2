# Planning Context: Fabric v2.0 rc.2 Implementation (Archive Write-Half)

## Source Evidence

### Exploration files (this session)
- `exploration-integration-points.json` — MCP registration site, service template pattern, deepMerge gap for hooks.Stop[] array, init pipeline stage layout, KnowledgeIdAllocator NEGATIVE integration (rc.2 does NOT call it — Q2 late-bind)
- `exploration-patterns.json` — SKILL.md format (180-line claude-style), single .cjs script for both clients (stdout JSON `{decision:'block', reason}`), events.jsonl reader semantics (split `/\r?\n/`, ENOENT-tolerant, partial-tail tolerant), verbatim heuristic at discussion.md L344-L347
- `exploration-testing.json` — Vitest 3.2.4, per-package thresholds (server 75 / cli 70 / shared 85), idempotency precedent at scan-init.test.ts:202 reruns_are_no_op_with_zero_diff, in-process hook script test pattern from signal-handler.test.ts

### Pre-locked schema commits (source of truth)
- commit `a0612a9` — `packages/shared/src/schemas/api-contracts.ts:295-330` — `FabExtractKnowledgeInputSchema`, `FabExtractKnowledgeOutputSchema`, `fabExtractKnowledgeAnnotations`. Frozen — rc.2 has zero degrees of freedom on field names.
- commit `e3975b5` — `packages/shared/src/schemas/event-ledger.ts:176-250` — `knowledgeProposedEventSchema`, `knowledgeArchiveAttemptedEventSchema`. `stable_id` is OPTIONAL (Q2 late-bind confirmed).

### Code anchors verified during exploration
- `packages/server/src/index.ts:108-109` — single MCP registration site (next to `registerPlanContext` / `registerRuleSections`)
- `packages/server/src/services/plan-context.ts:17-72` — service template pattern (pure async function, `appendEventLedgerEvent` best-effort try/catch)
- `packages/server/src/services/event-ledger.ts:33-50` — `appendEventLedgerEvent(projectRoot, event)` API
- `packages/server/src/services/_shared.ts` — `ensureParentDirectory`, `sha256` (rc.2 idempotency_key derivation), `EVENT_LEDGER_PATH = '.fabric/events.jsonl'`
- `packages/cli/src/commands/init.ts:767-775` — bootstrap stage NO-OP slot (rc.2 fills with skill+hook install)
- `packages/cli/src/commands/init.ts:800-803` — hooks stage calls `installHooks()` (currently throws)
- `packages/cli/src/commands/hooks.ts:63-72` — throwing v2 stub (must be replaced with per-client install)
- `packages/cli/src/config/json.ts:18-39` — `deepMerge` arrays-REPLACE behaviour (PROBLEM for hooks.Stop[] — rc.2 needs array-append-with-dedupe special case)
- `packages/cli/src/config/json.ts:81-122` — `writeJsonClientConfig` — pattern reference for atomic merged JSON write
- `packages/cli/src/config/resolver.ts:139` — Cursor `hook:false` (no Stop-hook surface — confirmed)
- `packages/cli/src/config/resolver.ts:157` — Codex hook config probe `existsSync(workspaceRoot, '.codex', 'hooks.json')` — confirms `.codex/hooks.json` (NOT `.toml`)
- `packages/server/src/services/doctor.test.ts:141,162` — only authoritative Claude Stop hook schema reference: `{hooks: {Stop: [{matcher: '*', hooks: [{type: 'command', command: '<path>'}]}]}}`
- `packages/cli/__tests__/integration/scan-init.test.ts:202-221` — `reruns_are_no_op_with_zero_diff` template (verbatim model for rc.2 idempotency test)
- `packages/server/__tests__/signal-handler.test.ts:1-14` — in-process hook test policy (no `child_process.spawn` in CI)

### Verbatim sources (must be embedded literally in SKILL.md)
- `discussion.md L344-L347` — Layer classification heuristic (强 team / 强 personal / 默认 team)
- `discussion.md L355-L362` — Hook threshold: 5 plan_contexts since last knowledge_proposed OR 24h
- `discussion.md L451` — Single .cjs script across clients
- `discussion-followup.md L60` — Slug naming convention (kebab-case, 2-5 words, 20-40 chars)
- `discussion-followup.md L72` — Pending frontmatter shape (no `id` field)

## Understanding

### Current State
- rc.1 prep merged: schemas pre-locked (api-contracts + event-ledger), v1 templates orphaned but untouched
- `fabric-config` has `knowledge_language` toggle and dispatches bilingual init scan (commit 66408fc)
- 13 dogfood entries already rewritten to M3 zh-CN style (commit b9862d9)
- Dogfood self-repo declared `knowledge_language=zh-CN` (commit a0a47dd)
- Day-1 gate housekeeping landed (commit f09bf60)
- bootstrap stage at `init.ts:767-775` is a vacated v2 slot
- `hooks.ts:63-72` throws — explicit rc.2 fill-in marker

### Problem (rc.2 scope)
Three deliverables close the WRITE half of the knowledge cycle:
1. **MCP write tool**: `fab_extract_knowledge` server-side service emits proposed entries to `pending/<type>/<slug>.md` (no id) + `knowledge_proposed` event
2. **Skill template**: `fabric-archive` SKILL.md with verbatim heuristic + 5-type prompt + decision tree, installed by `fabric init` to `.claude/skills/` AND `.codex/skills/`
3. **Stop-hook layer**: single cross-platform `.cjs` script + 2 client configs (`.claude/settings.json` Stop merge + `.codex/hooks.json`) wired through `fabric init` and `fabric hooks` commands

Coverage gate ≥90% on new code (per-file parser over `coverage-summary.json` — do NOT raise vitest.config global thresholds).

### Approach
Eight tasks, three parallel-safe groups after schemas-locked baseline:

- **Wave 1 (parallel-safe)**: TASK-001 (server impl) | TASK-002 (skill template) | TASK-003 (hook script)
- **Wave 2 (depends on Wave 1)**: TASK-004 (hook configs — depends on hook script path) | TASK-005 (init+hooks command wiring — depends on skill+hook script+configs)
- **Wave 3 (depends on Wave 2)**: TASK-006 (init wiring tests) | TASK-007 (dogfood self-repo manual flow)
- **Wave 4 (terminal)**: TASK-008 (batched-end Gemini review + ≥90% per-file coverage gate)

## Key Decisions

| Decision | Rationale | Evidence |
|---|---|---|
| **NO id frontmatter in pending entries** | Q2 late-bind confirmed. KnowledgeIdAllocator is rc.3 fab_review approve concern, not rc.2. | `knowledge-id-allocator.ts:42-56`, `discussion-followup.md L72`, `event-ledger.ts:176-182` (stable_id optional) |
| **Single .cjs script across clients (NOT three)** | Existing `fabric-init-reminder.cjs` and `fabric-stop-reminder.cjs` use identical stdout JSON shape `{decision:'block', reason}` — Claude Stop and Codex Stop both accept it. | `templates/claude-hooks/fabric-init-reminder.cjs:12-18`, `templates/codex-hooks/fabric-stop-reminder.cjs:12-18`, `discussion.md L451` |
| **Cursor explicitly OUT of scope for rc.2 Stop-hook** | resolver.ts:139 declares `hook:false` for Cursor; no documented Cursor Stop-hook API as of 2026-05. Documented as schema deviation from original handoff.json which mentioned 3 clients. | `resolver.ts:139`, task description ("Cursor: no Stop-hook surface — explicitly OUT of scope for rc.2") |
| **stdout JSON `{decision:'block', reason}` (NOT stderr+exit2)** | Existing repo pattern verified — `fabric-init-reminder.cjs:12-18` uses stdout JSON + exit 0. Task brief mention of "stderr+exit2" is corrected by existing code precedent. | `templates/claude-hooks/fabric-init-reminder.cjs:12-18` (verified L12-18), `discussion.md L451` ("hook 脚本本身可以是单份 Node 实现") |
| **Codex hook config = `.codex/hooks.json` (NOT `.toml`)** | resolver.ts:157 probes exactly `.codex/hooks.json`. User-level Codex MCP config (`~/.codex/config.toml`) is TOML; project-level hooks file is JSON. | `resolver.ts:157` |
| **Idempotency key = sha256({source_session, type, slug})** | Coarse triple keeps stability across LLM-summary regeneration. Including `user_messages_summary` would make key brittle (any LLM tweak triggers duplicate). When same triple hits with different content, append evidence section to existing pending file rather than overwrite. | api-contracts.ts:319 ("derived from inputs"), recommendation from integration exploration clarification_needs item 4 option 0+evidence-append refinement |
| **Frontmatter `layer: team` for pending** | Pending lives under project `.fabric/knowledge/pending/`, team is natural default. rc.3 fab_review modify can flip later. mcp-server.test.ts fixtures show team entries declare `layer: team`. | recommendation from integration exploration clarification_needs item 5 option 0 |
| **Bootstrap stage repurposed for skill install (NOT new "skills" stage)** | bootstrap is a vacated slot at init.ts:767-775. Adding a new InitStageName enum would require updating wizard + capability table — disproportionate churn for the same outcome. | recommendation from integration exploration clarification_needs item 3 option 0 |
| **Conditional skill install (per detectClientSupports)** | Honors supported-clients-only memory note (Claude Code / Cursor / Codex CLI). v2 init mcp stage is already conditional via resolveClients detection — consistent. | memory:project_fabric_scope, integration exploration clarification_needs item 1 option 0 |
| **deepMerge special-case for hooks.Stop[] array-append-with-dedupe-by-command** | Default deepMerge REPLACES arrays (json.ts:24). Stop-hook merge MUST preserve user's existing Stop entries and only append the fabric-archive entry once (dedupe by exact `command` string match). | json.ts:18-39 (problem identified in integration exploration patterns section) |
| **Event emission is best-effort try/catch (mirrors plan-context)** | plan-context.ts:134-151 shows ledger emission wrapped in try/catch with comment "best-effort and must not block rule discovery". rc.2 follows same convention — pending file write is the source of truth, ledger is observability. | `services/plan-context.ts:134-151` |
| **In-process hook script tests (NOT child_process.spawn)** | signal-handler.test.ts:1-14 explicit policy: spawn-based tests are unreliable in CI; export `main(argv,env,stdio)` and invoke in-process. | `__tests__/signal-handler.test.ts:1-14` |
| **Per-file ≥90% coverage gate via parser script (NOT vitest.config bumps)** | Bumping vitest.config global thresholds would fail existing files (server 75 → 90 breaks current code). rc.2 grill-followup convergence demands ≥90% on NEW code only. | `vitest.config.ts` per-package thresholds, testing exploration constraint section |
| **Atomic single commit per task with conventional commits** | Per user execution mode lock. Commit message authored autonomously by executor. | task description Execution Mode section |
| **Batched Gemini review at end (TASK-008), NOT per-task** | Per user MEMORY note "Batch review at end of multi-task plans". | `feedback_review_batching.md` (user memory) |

## Dependencies

### Wave structure (DAG)
```
                          Wave 1 (parallel-safe)
              ┌────────────┼────────────┐
        TASK-001       TASK-002       TASK-003
        (server impl)  (skill md)     (hook script)
              │            │            │
              │            │            │
              ▼            ▼            ▼
              └────────────┼────────────┘
                           │
                          Wave 2
                       TASK-004
                    (hook configs)
                           │
                           ▼
                       TASK-005
                  (init+hooks wiring)
                           │
                          Wave 3 (parallel-safe)
              ┌────────────┴────────────┐
        TASK-006                     TASK-007
        (init+hooks tests)           (dogfood manual)
              │                          │
              └────────────┬─────────────┘
                           │
                          Wave 4
                       TASK-008
              (batched review + coverage gate)
```

### External dependencies
- pnpm workspace already configured
- Vitest 3.2.4 pinned
- Schemas pre-locked (no shared package edits required for rc.2)
- @modelcontextprotocol/sdk available

### Provides for
- rc.3 fab_review (will consume pending entries written by fab_extract_knowledge)
- rc.4 dashboard (will visualize knowledge_proposed events)

## Schema Deviations From Original Handoff

| Original handoff.json | rc.2 Implementation | Reason |
|---|---|---|
| 3 client Stop-hook configs | 2 client configs (Claude Code + Codex CLI only) | Cursor has no documented Stop-hook surface (resolver.ts:139 hook:false) |
| `.codex/hooks.toml` | `.codex/hooks.json` | resolver.ts:157 probes JSON; Codex project hooks are JSON (only user-level MCP config is TOML) |
| `.js` hook script | `.cjs` hook script | Existing repo precedent (fabric-*-reminder.cjs); ESM/CJS interop simpler with explicit .cjs |
| stderr+exit2 hook output | stdout JSON `{decision:'block', reason}` exit 0 | Existing repo precedent in fabric-init-reminder.cjs:12-18 |

