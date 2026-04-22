# Planning Context: Fabric v2.0 MCP-First Fortified Implementation

## Note on Primary Context

This plan was generated from pre-analyzed upstream artifacts. No live exploration was
performed — the design is fully locked from the brainstorm + analysis sessions listed below.
All architectural decisions are final; implementation tasks derive directly from the
structured handoff spec in `ANL-implement-fabric-v2-2026-04-18`.

## Source Evidence

- `.workflow/.brainstorm/BS-universal-ai-docs-2026-04-18/ideas/mcp-first-fabric.md` — Final design spec (5-layer architecture, 3 MCP tools, pre-commit pipeline, 5-line bootstrap prompts, revision_hash protocol)
- `.workflow/.brainstorm/BS-universal-ai-docs-2026-04-18/synthesis.json` — Locked decisions: 6 target clients (no Copilot), stdio MCP, per-commit ledger granularity, git pre-commit as sole enforcement layer
- `.workflow/.analysis/ANL-implement-fabric-v2-2026-04-18/` — Implementation scope breakdown (7 Day plan → 8 tasks), file-level targets, acceptance criteria, constraints
- `思路.md` — Original seed (informational only, not modified)
- `/Users/wepie/Desktop/projects/werewolf-minigame/` — External real-world Cocos Creator fixture (READ-ONLY; used only as E2E validation target)

## Understanding

- **Current State**: `pcf/` directory is greenfield — only `思路.md` + workflow artifacts exist. No source code, no packages, no config files.
- **Problem**: Need a complete pnpm monorepo implementing Fabric v2.0 from scratch: MCP server + fab CLI + 6-client config generation + pre-commit enforcement + revision_hash staleness detection + E2E validation.
- **Approach**: Follow the 7-day MVP plan exactly as locked in brainstorm. Split Day 6-7 into two tasks (bootstrap templates vs. E2E). All 8 tasks are high-priority except the roadmap doc task. Dependency chain: TASK-001 (Day 0-1 repo init) is the foundation; TASK-002 (6-client config) and TASK-003 (fab CLI) both depend on TASK-001 independently; TASK-004 (pre-commit) depends on TASK-003; TASK-005 (revision_hash) depends on TASK-001; TASK-006 (bootstrap + stub) depends on TASK-003 + TASK-005; TASK-007 (E2E) depends on TASK-006; TASK-008 (roadmap doc) has no dependencies.

## Key Decisions

- Decision: pnpm monorepo with 3 packages (server, cli, shared) | Rationale: Clean separation of MCP server from CLI tool; shared types avoid duplication | Evidence: synthesis.json decisions_locked + mcp-first-fabric.md §2
- Decision: @modelcontextprotocol/sdk@^1 + zod@^3, module:Node16, type:module | Rationale: Pinned for stability; Node16 module resolution required for ESM/CJS interop in MCP SDK | Evidence: handoff spec key_findings
- Decision: stdio MCP transport (not HTTP) | Rationale: All 6 clients support stdio; HTTP fallback only if latency > 2s (Kill Switch 2) | Evidence: synthesis.json decisions_locked + mcp-first-fabric.md §6
- Decision: Never write to stdout in packages/server | Rationale: MCP stdio protocol uses stdout as message channel; console.log would corrupt the protocol stream | Evidence: handoff spec constraints
- Decision: lefthook for stdio lint enforcement | Rationale: Pre-commit hook that rejects console.log in server package; citty for CLI framework; tsup for build | Evidence: handoff spec implementation_scope[0]
- Decision: fab init is non-destructive (TODO-marker scaffold only) | Rationale: Nx-style scaffold; never AI-guess content; never overwrite existing files | Evidence: mcp-first-fabric.md §4.5 + handoff spec key_findings
- Decision: @iarna/toml for Codex TOML config (not hand-rolled) | Rationale: Correct schema compliance; handoff spec explicitly calls this out | Evidence: handoff spec implementation_scope[1]
- Decision: .fabric/human-lock.json stores precise string+position hashes for @HUMAN sections | Rationale: AST/exact-string match prevents boundary erosion (Phase 3 risk score 20) | Evidence: mcp-first-fabric.md §3 decision table
- Decision: pre-commit budget < 300ms | Rationale: Developer experience; slow hooks get disabled | Evidence: mcp-first-fabric.md §4.4 + handoff spec constraints

## Dependencies

- TASK-001 blocks all other tasks (monorepo foundation)
- TASK-002 and TASK-003 are independent of each other (both depend on TASK-001 only)
- TASK-004 depends on TASK-003 (pre-commit commands must exist before the hook)
- TASK-005 depends on TASK-001 (extends MCP server; CLI not required)
- TASK-006 depends on TASK-003 + TASK-005 (bootstrap uses scan command; Dev Mode uses server)
- TASK-007 depends on TASK-006 (E2E requires all prior deliverables)
- TASK-008 depends on nothing (pure documentation, can be written any time)
