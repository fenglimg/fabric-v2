# Analysis Discussion

**Session**: ANL-2026-05-06-stabilize-three-clients
**Topic**: 在不加入新功能的基础上完善和稳定 Fabric v1.7.0，并将 AI 客户端范围收敛到 Claude / Codex / Cursor
**Started**: 2026-05-06 (UTC+8)
**Dimensions**: implementation, performance, architecture
**Depth**: Standard

## Table of Contents
- [Current Understanding](#current-understanding)
- [Analysis Context](#analysis-context)
- [Initial Questions](#initial-questions)
- [Initial Decisions](#initial-decisions)
- [Discussion Timeline](#discussion-timeline)
- [Synthesis & Conclusions](#synthesis--conclusions)
- [Decision Trail](#decision-trail)
- [Session Statistics](#session-statistics)

## Current Understanding

### What We Established
- **Client narrowing is mechanical**: 15 files, ClientKind is the typed pivot, no false positives. Can ship in one PR.
- **5 production-grade stability gaps** dominate the work: events.jsonl durability (raw appendFile / no fsync / no rotation / no tail-tolerance), MCP server signal handling (zero handlers → zombie risk), schema-drift surface (inline tool schemas / no contract tests), Claude config path noncompliance (`settings.json` instead of `.mcp.json`), state-write durability inconsistency (atomic vs raw mixed).
- **5 lower-grade defects** worth grouping with stabilization: 7 dead helpers in init.ts (~170 LoC), `writeDefaultBootstrap` silent stub, dashboard `DoctorReport` re-declaration, `fab_get_rules` orphan tool, `_error.ts` string-prefix HTTP-status matching.
- **Research-validated practices** to adopt: Knip (dead code), `atomically` (atomic writes), MCP tool annotations, snapshot tests per emitted client config, MCP handshake conformance test.
- **AGENTS.md/CLAUDE.md drift problem doesn't apply** — Fabric uses MCP resource, not root files. Architecture sidesteps a known industry pitfall.
- **Doctor extensibility is medium**: hard-coded check array; keep pattern for v1.7, add 3 new checks (partial-write / bootstrap-stub / legacy-client-paths) without registry refactor.

### What Was Clarified
- ~~Format-split client config refactor needed~~ → DEFERRED. Base class already format-aligned; only 2 JSON writers survive narrowing.
- ~~init.ts 1897-line monolith refactor needed~~ → SCOPED DOWN. Delete 170 LoC of dead helpers now; defer 6-module decomposition (high blast radius / no user payoff).
- ~~tsconfig hardening (`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`)~~ → DEFERRED to a focused future minor (1-2 days noise).

### Key Insights
- "Stability is the product" — Business POV reframes the work as brand investment, not maintenance debt.
- Two-step ship (1.7.1 deprecation-only → 1.8.0 stabilization) decouples user comms from code removal — uniform deprecation policy across all 3 retired clients is itself a maturity signal.
- The most surprising bug is the Claude config path: silent today, will break when Claude Code tightens MCP loading.
- The single highest-ROI test layer is contract / golden-file tests for emitted MCP tool schemas + emitted client configs — closes 38% of industry MCP failures.
- **Total stabilization budget ≈ 470 LOC** in 4 independent change buckets (ledger / signal / lockfile / atomic-write helper + migration). All changes are at the I/O boundary — zero business-logic risk.
- **Pressure-pass refinement**: hard fsync-per-append is overkill. Tail-tolerant reader + opportunistic fsync + doctor truncate-and-warn delivers 95% of the value at <30% of the cost.
- **SSE reader already does tail tolerance** — lift the existing pattern; don't invent new logic.
- **Gemini cross-verification surfaced 4 coupling bugs the 4-perspective analysis missed**: drain-without-fsync paradox; stale-lock deadlock; snapshot↔annotation release coupling; ledger-truncate vs OS-buffered last event. All accepted; sequencing rewritten.
- **Right order**: deprecate (1.7.1) → narrow (drop 3 clients) → atomic-write helper → ledger fix → signal handlers (with fsync-on-shutdown) → Claude config fix → schema snapshots paired with annotations → `--reapply` preservation.
- **Round 4 surfaces interaction bugs the code-only audit missed**: `--reapply` silently truncates ledger + resets meta; `serve` doesn't watch rule files; manual rule additions invisible to AI; Codex/Cursor SKILL parity gap with Claude (Cursor has NO skill at all).
- **Two failure-mode buckets** become clear: I/O+lifecycle (R1-R13) and user-mental-model+UX (R14-R27). Both shippable in 1.8.0.
- **Rule-change observability (real-time sync + event attribution)** flagged by user — current behavior verified, R28 proposal sketched, but **PARKED** for dedicated discussion (6 open cross-cutting questions). Not bound to 1.8.0 yet.

## Analysis Context

**Focus areas (用户选定)**:
1. 客户端范围收敛 — 从 6 个 AI 客户端（Claude Code, Cursor, Windsurf, Roo Code, Gemini CLI, Codex CLI）收敛到 3 个（Claude, Codex, Cursor）。识别可下线的代码 / 文档 / 配置 / 测试。
2. 代码质量与一致性 — 重复代码、命名约定、错误处理、接口契约、技术债清理。
3. 稳定性与回归防护 — 测试覆盖、契约测试、doctor 诊断、CI 守门、回归预防。
4. 运行时健壮性 — MCP server 错误恢复、文件 I/O 边界、并发与状态机、用户面错误信息。

**Perspectives**:
- Technical: 代码细节、模式、潜在 bug、测试缺口
- Architectural: 模块边界、规则分发、MCP/CLI 协作、客户端适配层
- Domain Expert: MCP 规范、AGENTS.md 协议、客户端集成最佳实践
- Business: 稳定性 vs 工作量 ROI、客户端收敛对用户的影响

**Depth**: Standard (3-5 rounds)

## Initial Questions

1. 当前 6 客户端代码（Windsurf / Roo Code / Gemini CLI 适配）分布在哪些目录、模块、配置点？收敛代价多大？
2. 哪些模块测试覆盖薄弱、错误路径未覆盖、契约不明？
3. doctor 检查覆盖了哪些"必修复"场景？哪些 silent failure 需要补漏？
4. MCP server 与 CLI 之间的契约是否稳固？是否有不一致或重复实现？
5. 稳定性的"完美"标准是什么？是 TDD 覆盖率、E2E 通过率、还是 doctor 零告警？
6. 客户端收敛后，用户的迁移路径如何？要不要保留兼容（弃用警告 vs 直接移除）？

## Initial Decisions

> **Decision**: 选择 implementation + performance + architecture 三维度，全部 4 个视角并行
> - **Context**: 用户选了 4 个 focus 全部，覆盖代码层 / 系统层 / 协议层 / 业务层
> - **Chosen**: 多视角并行 (Technical + Architectural + Domain Expert + Business)
> - **Reason**: 稳定化既是代码层（implementation）也是架构层（客户端收敛），还涉及协议规范，仅技术视角不够
> - **Rejected**: 单视角综合 — 会丢失协议合规与产品取舍维度
> - **Impact**: Phase 2 将启动并行 4 个 Agent 深入探索

> **Decision**: Standard 深度（3-5 轮）
> - **Reason**: 用户期望平衡完整度与时间，不要 Quick 也不要 Deep Dive
> - **Impact**: Round 1 探索后预留 2-4 轮用户互动 + 综合

## Discussion Timeline

### Round 1 - Exploration (2026-05-06 19:30 UTC+8)

#### Sources
- `exploration-codebase.json` — shared Layer 1 (34 relevant files, 8 patterns, full client_scope_map)
- `research.json` — external research (9 findings, 9 best practices, 9 codebase gaps)
- `explorations/technical.json` — code-level audit
- `explorations/architectural.json` — module/contract audit
- `explorations/domain.json` — MCP/AGENTS.md/spec audit
- `explorations/business.json` — ROI / sequencing / risk

#### Per-Perspective Summary

**Technical** (code level)
- 7 unused helper functions in `packages/cli/src/commands/init.ts:1383-1554` (~170 lines, NEW finding) — Knip would catch
- 8 error-handling smells classified (3 HIGH / 4 MEDIUM / 1 LOW); worst is `tryBuildRuleMeta` swallowing all errors and `_error.ts:93-115` string-prefix HTTP-status mapping
- `writeDefaultBootstrap` (`doctor.ts:665-669`) silent stub: `doctor --fix` produces inferior bootstrap vs `fab init`; layering issue (server reaches into CLI concern)
- Promise hygiene: clean. Type-safety: 12 assertions audited, removable ones concentrate in init.ts
- Test gaps: `_error.ts` 0 tests; `resolver.ts` 0 direct tests (this is the client-scope dispatch core); `event-ledger` covers full malformed lines but not trailing-partial truncation

**Architectural** (module / contract)
- Client adapter layer ALREADY format-aligned at base class. Format-split refactor would save ~25 lines but add indirection — **DEFER** verdict
- 6→3 blast radius: small. `ClientKind` (writer.ts:1-8) is the typed pivot; TS surfaces every consumer
- 3 MCP↔CLI drift surfaces: tool Zod schemas inline (not z.infer-derived); service input types separate; **dashboard re-declares `DoctorReport`/`DoctorCheck`** with diverged shape
- 3-tier state-write durability with no documented contract: atomic snapshots vs raw `events.jsonl` append (no fsync/flock/rotation) vs sync init scaffold writes
- doctor: hard-coded 9-check array (NOT registry); medium extensibility — keep pattern, add 3 specific checks for v1.7
- shared package: 13 root exports, NO cyclic deps (clean DAG); medium dumping-ground score
- Largest hidden risk: `schemas/fabric-config.json` is a public artifact with no CI gate against the Zod source

**Domain Expert** (MCP/AGENTS.md spec)
- AGENTS.md/CLAUDE.md handling: COMPLIANT. Fabric writes NO root `CLAUDE.md`/`AGENTS.md`. Single source: `.fabric/bootstrap/README.md` exposed via MCP resource. The drift problem flagged in research is sidestepped by architecture.
- **Claude config NONCOMPLIANT** (NEW finding): `packages/cli/src/config/json.ts:99-109` writes `mcpServers.fabric` into `.claude/settings.json`, but Claude Code expects MCP servers in `~/.claude.json` (user) or `.mcp.json` (project). `settings.json` is for hooks/permissions only.
- **No signal handlers** in `packages/server/src/index.ts:92-97` — direct hit on Claude Code #15945 zombie pattern
- Tool annotations PARTIAL: only `readOnlyHint:true`; missing `idempotentHint`, `destructiveHint:false`, `openWorldHint:false`, `title`
- Tool surface: 2 registered (within ≤5 budget) BUT `fab_get_rules` is implemented/exported and **never registered** — orphan
- Schema drift surface: tools' input/output schemas inline in `tools/*.ts`, NOT exported to shared, NO snapshot/contract test → high risk per industry 38% MCP failure category
- Resource handler at `index.ts:74-86` throws raw `fs.readFile` ENOENT to MCP client (not mapped to spec error code)

**Business** (ROI / sequencing)
- Verdict: PROCEED. Fabric's brand IS stability. v1.0→v1.7 ran 7 minors in 17 days, all Added-heavy; seam debt is bigger reputational risk than missing features.
- **Two-step ship recommended**: 1.7.1 = docs + doctor deprecation warnings only (2-3d); 1.8.0 = code removal + contract tests + atomic ledger + typed errors + per-client snapshot tests (10-14d). Don't burn 2.0.0 on scope-only.
- KPI trio: doctor_pass_rate on 3 reference projects, time_to_first_success <5min, mcp_contract_test_coverage 100%
- Deprecation: deprecate-then-remove for all 3 retired clients (uniform = maturity signal)
- Top risk: backward-compat for users with `clientPaths.{windsurf,rooCode,geminiCLI}` in fabric.config.json; mitigation = zod passthrough + `legacy_client_path_present` doctor code with `--fix` auto-strip
- Don't this cycle: init.ts refactor (high blast radius, no user payoff), JsonClientConfigWriter consolidation, `noUncheckedIndexedAccess`, any new tools/doctor checks

#### Synthesis Across Perspectives

**Convergent themes (all/most agree)**
- `events.jsonl` durability is broken: raw appendFile, no fsync, no rotation, no tail-tolerance — Tech + Arch + Domain all flag fsyncgate-class bug
- MCP server signal handling is the highest-impact stability fix (Tech + Domain + Arch all cite #15945)
- Schema-drift contract tests are the highest-ROI test layer (Domain + Arch + Research converge)
- Dashboard ↔ server type drift is real and silent (Architectural; reinforced by domain noting public artifact divergence)
- 6→3 client narrowing is mechanical/low-risk: 15 files, ClientKind pivot, no false positives — every perspective agrees

**Conflicting / nuanced**
- **Claude config path NONCOMPLIANT** (Domain) is a *spec bug* that exists TODAY and will silently break in modern Claude Code. Tech/Arch did not flag it because they audited code shape, not spec compliance. → Highest-priority fix surfaced by domain perspective.
- Format-split refactor: Architectural says DEFER (only 2 JSON writers remain after narrowing); Research recommended split. Architectural reasoning wins given scope-narrowing already collapses the surface.
- init.ts refactor: Technical proposes 6-module decomposition; Business says DEFER (high blast radius, no user payoff). Compromise: delete the 7 dead helpers (zero risk), defer the 1700-line restructure.

**Unique contributions**
- Tech: 7 dead helpers in init.ts (Knip would surface immediately)
- Arch: dashboard re-declares DoctorReport — public-facing type drift
- Domain: Claude `settings.json` vs `.mcp.json`/`~/.claude.json` — the most surprising bug
- Domain: `fab_get_rules` orphan — registered nowhere
- Business: Two-step ship (1.7.1 → 1.8.0) lets users see deprecation warnings before code removal
- Research: Cursor 40-tool ceiling — currently fine (2 tools) but worth a doctor warning surfacing the constraint

#### Key Findings

> **Finding**: Claude Code MCP config emitted to wrong file (`.claude/settings.json` instead of `.mcp.json` or `~/.claude.json`)
> - **Confidence**: High — **Why**: cited at `packages/cli/src/config/json.ts:99-109` cross-checked vs Claude Code MCP docs
> - **Hypothesis Impact**: Confirms the system has spec-compliance debt distinct from code-quality debt
> - **Scope**: All Claude users; latent until Claude Code removes settings.json compatibility

> **Finding**: MCP server lacks signal handlers (no SIGINT/SIGTERM/SIGHUP)
> - **Confidence**: High — **Why**: `packages/server/src/index.ts:92-97` shows no handler registration; matches Claude Code #15945 zombie pattern exactly
> - **Hypothesis Impact**: Confirms runtime-robustness gap is real and externally observable
> - **Scope**: All clients running fabric serve; risk grows with session count

> **Finding**: events.jsonl uses raw `appendFile` with no fsync, no rotation, no tail-tolerance on read
> - **Confidence**: High — **Why**: triangulated by Tech (event-ledger.ts test gap) + Arch (state_write_audit) + Research (fsyncgate)
> - **Hypothesis Impact**: Confirms ledger durability is the single largest stability bet
> - **Scope**: All users; manifests on power loss / OOM / fs error

> **Finding**: 6→3 client narrowing has small, well-scoped blast radius (~15 files)
> - **Confidence**: High — **Why**: Layer 1 enumerated all sites; Architectural verified ClientKind is the typed pivot
> - **Hypothesis Impact**: Confirms narrowing is mechanical and safe; can be done in one PR
> - **Scope**: cli + shared + schemas + i18n + 6 template files + 5 docs

> **Finding**: Tool input/output schemas live inline in `packages/server/src/tools/*.ts`, not exported, no contract tests
> - **Confidence**: High — **Why**: Domain Expert audit + Architectural drift inventory
> - **Hypothesis Impact**: Confirms #1 MCP failure category (38% schema drift) is unmitigated
> - **Scope**: Every MCP tool call

> **Finding**: 7 unused helper functions in `packages/cli/src/commands/init.ts:1383-1554` (~170 lines dead code)
> - **Confidence**: High — **Why**: Tech verified zero callers across packages; superseded by plan/apply pattern at L842-1008
> - **Hypothesis Impact**: Adds Knip adoption to recommendation list
> - **Scope**: Maintainability; no runtime impact

> **Finding**: `writeDefaultBootstrap` silent stub — `doctor --fix` writes inferior bootstrap than `fab init`
> - **Confidence**: High — **Why**: Tech opened both code paths and quoted divergence
> - **Hypothesis Impact**: Latent UX bug; fix is one-line route to `buildFabricBootstrapGuide`
> - **Scope**: Users running `doctor --fix` after deleting bootstrap

> **Finding**: Dashboard re-declares `DoctorReport`/`DoctorCheck` with diverged shape (server has kind/code/fixable; dashboard doesn't)
> - **Confidence**: High — **Why**: Arch cited dashboard/src/api/client.ts:51-80
> - **Hypothesis Impact**: Public artifact drift surface
> - **Scope**: Dashboard correctness when server schema evolves

#### Decision Log

> **Decision**: Defer JsonClientConfigWriter format-split refactor
> - **Context**: Research recommended split-by-format; Arch found base class is already format-aligned
> - **Options**: Refactor now / defer / reject permanently
> - **Chosen**: Defer (post-narrowing, only 2 JSON writers remain — saves ~25 lines for added indirection)
> - **Rejected**: Refactor now — premature, churn without user payoff
> - **Impact**: Stabilization plan focuses on contract/atomicity/scope, not class restructure

> **Decision**: Adopt two-step release sequencing (1.7.1 deprecation-only → 1.8.0 stabilization)
> - **Context**: Business analysis identified backward-compat risk for users with retired clientPaths keys
> - **Options**: Direct 1.8.0 with breaking removal / two-step / feature-flag
> - **Chosen**: Two-step (matches semver community precedent)
> - **Rejected**: Direct removal (poor user comms); feature-flag (preserves no value)
> - **Impact**: Phase 4 recommendations split into 1.7.1 batch and 1.8.0 batch

#### External Research Integration & Codebase Gaps

Codebase gaps confirmed by research (now elevated to recommendations candidates):
- ⚠️ tsconfig missing `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (Business says DEFER this cycle)
- ⚠️ No Knip / dead-code detector configured (Tech finding shows 170 LoC immediate win)
- ⚠️ No atomic-write standardization (mix of `atomicWriteText` and raw `appendFile`)
- ⚠️ No snapshot tests for emitted client configs
- ⚠️ No MCP handshake conformance test
- ⚠️ doctor doesn't detect events.jsonl tail corruption
- ⚠️ Server has no signal handlers
- ⚠️ Tool annotations missing `idempotentHint`/`destructiveHint`/`title`

#### Intent Coverage Check (after Round 1)

| # | User Intent | Status | Where |
|---|---|---|---|
| 1 | 客户端范围收敛 | ✅ Covered | exploration-codebase.json (15 files) + Arch (blast radius) + Business (sequencing) |
| 2 | 代码质量与一致性 | ✅ Covered | Tech (smells, dead code, type safety) + Arch (drift surfaces) |
| 3 | 稳定性与回归防护 | ✅ Covered | Tech (test gaps) + Arch (state writes) + Domain (contract tests) + Research (best practices) |
| 4 | 运行时健壮性 | ✅ Covered | Domain (signal handlers, error mapping) + Arch (race scenarios) + Research (fsyncgate, timeouts) |

All 4 user focus areas have substantive findings. Strongest coverage: 客户端范围收敛 + 运行时健壮性.

#### Confidence Score (Baseline)

| Dimension | Findings Depth | Evidence Strength | Coverage Breadth | User Validation | Consistency | **Score** |
|---|---|---|---|---|---|---|
| architecture | 0.85 | 0.85 | 0.80 | 0.0 | 0.95 | **0.733** |
| implementation | 0.85 | 0.90 | 0.80 | 0.0 | 0.95 | **0.745** |
| performance (stability) | 0.80 | 0.80 | 0.75 | 0.0 | 0.90 | **0.695** |

Overall: **0.724** | Weakest: **performance (stability)** at 69.5%

> 60-80%: 可选深入或收敛 — 探索充分，主要不确定项是用户优先级与具体取舍

#### Round 1: Narrative Synthesis

**起点**: 用户希望在不加新功能的前提下完善并稳定 v1.7.0，并将客户端从 6 收敛到 3。本轮以 Layer 1 全景扫描 + 4 视角并行深入 + 外部研究为切入。

**关键进展**: 4 视角共同确认 5 个核心问题（events.jsonl 持久化、MCP 信号处理、契约测试缺失、Claude 配置路径错误、客户端收敛蓝图）。新发现 4 个非显而易见的问题：Claude `settings.json` 配置违规、`fab_get_rules` 孤儿工具、init.ts 7 个死函数、dashboard 类型重声明漂移。

**决策影响**: Architectural 否决了 Research 提出的 format-split 重构（"6→3 之后只剩 2 个 JSON writer，重构无收益"）；Business 提出 1.7.1 → 1.8.0 两步发布序列。两个决策已记录。

**当前理解**: 稳定化的核心是「契约 + 原子性 + 信号 + 配置正确性」，而不是大规模重构。客户端收敛是机械工作。最危险的潜在 bug 是 Claude 配置写错文件（settings.json）以及事件账本无 fsync。

**遗留问题**:
- 1.7.1 vs 1.8.0 的拆分用户是否同意？
- Claude 配置路径修复是否需要保留 settings.json 兼容（migration 脚本）？
- doctor 是否扩容到检测三个新代码（partial-write / bootstrap-stub / legacy-client-paths）？
- Knip 现在引入还是延后？
- contract 测试用 zod schema 自比对，还是用 golden file？

### Round 2 - Deepen Weakest Dimension (2026-05-06 19:50 UTC+8)

#### User Input
> User chose: **深入稳定性细节**. Focus on performance/stability dimension (weakest at 69.5%).
> Targets requested: events.jsonl atomic-fix path, signal handler implementation, authorization/concurrency scenarios, atomic-write standardization.

#### Key Findings (Round 2)

> **Finding**: SSE incremental reader at `packages/server/src/api/events.ts:363-401` ALREADY implements tail-tolerance via `state.eventLedgerRemainder` — but the full-read path `readEventLedger` silently drops bad lines.
> - **Confidence**: High — **Why**: code path read directly
> - **Hypothesis Impact**: REDUCES implementation effort. Lift the SSE pattern; don't invent new logic. Escalate "silent drop" to "surface warning to doctor."
> - **Scope**: Reader unification + warning surface

> **Finding**: events.jsonl writer is single-callsite (`packages/server/src/services/event-ledger.ts:21-38`, line 35 = the appendFile), with 12 transitive write callsites
> - **Confidence**: High — **Why**: enumerated by deep-dive
> - **Hypothesis Impact**: Confirms fix is well-scoped; one writer to harden, 12 producers untouched
> - **Scope**: Hardening lives behind one function

> **Finding**: Concurrency surface = 4 scenarios; only 2 require cross-process coordination (`serve` vs `doctor --fix`, `serve` vs `init --reapply`); recommended `.fabric/.serve.lock` PID file (not proper-lockfile dep)
> - **Confidence**: Medium-High — **Why**: scenarios enumerated; mitigation pragmatic but PID-file approach has known edge cases (stale lock after SIGKILL)
> - **Hypothesis Impact**: Cross-process locking cost is small; reject heavy `proper-lockfile` dep
> - **Scope**: 2 lockfile sites: `serve` start + `doctor --fix`/`init --reapply` preflight

> **Finding**: Atomic-write standardization = 22 callsites; 14 benefit from a single `atomic-write.ts` helper in `packages/shared/src/node/`
> - **Confidence**: High — **Why**: full inventory in stability-deepdive.json
> - **Hypothesis Impact**: Confirms one-helper pattern; ~14 callsites migrate cleanly
> - **Scope**: shared package gets a `node/` subpath (helps fix dumping-ground concern)

#### Pressure Pass — Round 2

Target: highest-confidence finding "events.jsonl needs atomic-append + tail-tolerance"

**Step 1 — Evidence demand**: Concrete evidence the current behavior fails?
- ✅ `event-ledger.ts:35` calls `fs.appendFile` (no fsync, no flock)
- ✅ Per fsyncgate: appendFile alone returns success before fsync; on crash mid-write, OS may not have flushed
- ⚠️ Counter: POSIX O_APPEND IS atomic for writes ≤ PIPE_BUF (typically 4096 bytes); a single small line WILL appear fully or not at all on crash
- 🔄 Refined: the actual risk is NOT torn writes for normal lines, but (a) writes > PIPE_BUF, (b) fsync errors marking pages clean, (c) reader behavior on partial last line during *concurrent* read
- Verdict: **partial confirm**. Risk is real but scoped — for typical ≤256-byte audit lines on local fs, torn-write on crash is rare. Reader-during-write race is the more common bug.

**Step 2 — Assumption probe**: Hidden assumption?
- Assumed: "fsync is mandatory." Counter-assumption: "Eventually-consistent ledger is acceptable for an audit log; doctor periodically reconciles."
- Refined recommendation: fsync is NOT mandatory for every append. **Pair atomicity-on-read (tail tolerance) + opportunistic fsync-on-shutdown + doctor truncate-and-warn** — this gives 95% of the value at <30% of the cost.

**Step 3 — Boundary/tradeoff**: What gets excluded if we accept the simpler approach?
- Excluded: zero-data-loss guarantee for last entry on power loss. Acceptable for an audit ledger; not acceptable for a transaction log.
- Excluded: cross-process coordination on JSONL itself. Acceptable: PID lockfile gates the destructive operations (doctor --fix, init --reapply rmSync), so concurrent appends are the only race and POSIX handles them.

**Step 4 — Root cause check**: Is "no fsync" the cause, or symptom?
- Symptom of: no documented durability contract for `.fabric/*` files (Architectural finding)
- Root cause: 3-tier durability with no explicit contract
- Implication: fix needs to include a documented "Durability Contract" comment block in shared/event-ledger or shared README, not just a code change

> **Pressure Pass Outcome**: Recommendation refined. Drop hard fsync-per-append requirement. Adopt: tail-tolerant reader (lift SSE pattern), in-process queue for same-process, PID lockfile for cross-process destructive ops, documented durability contract. Doctor surfaces partial writes as warning + `--fix` truncates. ~120 LOC instead of ~180.

#### Challenge: Devil's Advocate (auto-fired, dimension architecture > 0.7)

> "What if the events.jsonl durability concern is overstated?"
> - Counter-evidence: 0 reported corruption issues in CHANGELOG; SSE reader already handles tail; writes are small lines
> - Counter-counter: absence of bug reports != absence of bug (silent drop). Doctor not detecting it = users don't know.
> - Verdict: investment IS justified. The fix is small (~120 LOC after pressure pass) and delivers a *visible* signal (doctor warning) on a previously silent failure mode. Adopt.

#### Technical Solutions (Round 2)

> **Solution**: Lift SSE tail-tolerance to `readEventLedger`, escalate silent-drop to `LedgerWarning[]` consumed by doctor + new fixable code `event_ledger_partial_write` with `truncateLedgerToLastNewline` helper
> - **Status**: Validated (post pressure pass)
> - **Problem**: Silent drop on partial write; no fsync semantics
> - **Rationale**: Reuses existing logic; avoids hard fsync; doctor surfaces issue
> - **Alternatives**: hard fsync per append (rejected — overhead, fsyncgate); proper-lockfile (rejected — unnecessary for line appends)
> - **Evidence**: `packages/server/src/api/events.ts:363-401` (existing pattern); `event-ledger.ts:21-38` (target)
> - **Next Action**: Plan Step in 1.8.0 batch (~120 LOC)

> **Solution**: Single `packages/shared/src/node/atomic-write.ts` helper exporting `atomicWriteText`, `atomicWriteJson`, `createLedgerWriteQueue`. Migrate 14 callsites P0→P1→P2.
> - **Status**: Validated
> - **Problem**: 22 callsites with 3-tier inconsistent durability
> - **Rationale**: One pattern, one location, easier to audit
> - **Alternatives**: per-package helper (rejected — duplication); `atomically` dep (deferred — hand-rolled is small)
> - **Evidence**: stability-deepdive.json atomic_write_inventory
> - **Next Action**: Plan Step in 1.8.0; helper first, then per-callsite migration

> **Solution**: Signal handler pattern — SIGINT/SIGTERM/SIGHUP → drain via InFlightTracker, 5s deadline, double-signal hard exit. ~130 LOC.
> - **Status**: Validated
> - **Problem**: Server has no handlers; matches Claude #15945 zombie pattern
> - **Rationale**: Industry-standard pattern; reasonable test surface (vitest spawn + SIGTERM + assert exit code)
> - **Alternatives**: Defer to user-supplied wrapper (rejected — Fabric is the wrapper)
> - **Evidence**: `packages/server/src/index.ts:92-97`; tracker missing
> - **Next Action**: Plan Step in 1.8.0; new `in-flight-tracker.ts` module + handler registration in startStdioServer

> **Solution**: `.fabric/.serve.lock` PID file (NOT proper-lockfile) gating destructive ops in `doctor --fix` and `init --reapply` preflight
> - **Status**: Proposed (PID lockfile has stale-lock edge cases — flag for user awareness)
> - **Problem**: serve vs doctor --fix race; serve vs init --reapply race
> - **Alternatives**: proper-lockfile (rejected — heavy dep), no protection (rejected — known race)
> - **Evidence**: stability-deepdive.json concurrency_scenarios
> - **Next Action**: Plan Step; small (~40 LOC); doctor reports stale lock with recovery instructions

#### Confidence Score (Round 2)

| Dimension | findings_depth | evidence_strength | coverage_breadth | user_validation | consistency | **Score** |
|---|---|---|---|---|---|---|
| architecture | 0.90 | 0.90 | 0.85 | 0.30 | 0.95 | **0.835** |
| implementation | 0.90 | 0.95 | 0.85 | 0.30 | 0.95 | **0.840** |
| performance (stability) | 0.95 | 0.95 | 0.90 | 0.50 | 0.95 | **0.910** |

Overall: **0.862** | Weakest: **architecture (0.835)** | Δ vs Round 1: **+0.138**

> > 80%: 建议收敛 — implementation details are concrete, ready for synthesis

#### Intent Coverage Check (after Round 2)

| # | User Intent | Status | Notes |
|---|---|---|---|
| 1 | 客户端范围收敛 | ✅ Covered | 15 files; ClientKind pivot; two-step ship |
| 2 | 代码质量与一致性 | ✅ Covered | 8 smells, 7 dead helpers, dashboard re-decl, error mapping |
| 3 | 稳定性与回归防护 | ✅ Covered | Contract tests, snapshot tests, doctor extensions, Knip |
| 4 | 运行时健壮性 | ✅ Strongly covered | Ledger fix, signal handlers, concurrency, atomic-write helper, all with LOC estimates |

#### Round 2: Narrative Synthesis

**起点**: Confidence 72.4%，performance 维度最弱。用户选择深入稳定性细节。

**关键进展**: 4 个稳定性主题获得可执行的实施细节（writer:35 / 12 callsites / 4 concurrency scenarios / 22 atomic-write inventory）。新发现：SSE 增量读已实现 tail-tolerance，可以直接复用。压力测试将"硬性 fsync"降级为"tail-tolerant reader + opportunistic fsync + doctor 修复"，工作量从 180 LOC 降到 120 LOC。

**决策影响**: 拒绝 `proper-lockfile`（重）和 `atomically` 依赖（小到可手写）。采用 PID 锁文件 + 进程内队列 + 文档化耐久性契约的组合。

**当前理解**: 稳定性工作总量约 470 LOC（120 ledger + 130 signal + 40 lockfile + 180 atomic-write 助手与 14 处迁移），分散在 4 个独立 PR 中可并行评审。所有改动均落在 `.fabric/` 写入边界 + 服务进程生命周期，不触碰业务逻辑。

**遗留问题**:
- 用户是否同意压力测试后的耐久性折中（无硬 fsync）？
- PID 锁文件的 stale-lock 提示文案是否需要打磨？
- 1.8.0 批次的 PR 拆分粒度（合并 vs 4 个独立 PR）？

### Round 3 - Gemini Cross-Verification (2026-05-06 20:10 UTC+8)

#### User Input
> User asked: "是否引入了 Gemini 进行辅助分析？" — request for independent CLI cross-verification.

#### Methodology
Compiled 13 proposed solutions + project facts + decisions into a verification prompt; ran Gemini 0.41.1 in `--yolo` mode as an independent senior reviewer; asked for: (a) flaws/risks missed, (b) sequencing critique, (c) hidden couplings, (d) one missing recommendation, (e) nuke-it list.

#### Gemini's Findings (verbatim summary, then our adjudication)

**G1 — Drain vs Corruption Paradox (NEW RISK, accepted)**
- Gemini: signal handlers (5s drain) + raw appendFile (no fsync) = false sense of safety. Double-SIGINT during drain *guarantees* the partial-write corruption P0.1 is trying to fix.
- Adjudication: **ACCEPT**. Pressure-pass refinement to drop fsync was correct for normal small appends, but DRAIN-CORRUPTION COUPLING was missed. Mitigation: signal-handler MUST call `fsyncSync` on the ledger fd before exit (single fsync at shutdown is cheap; fsyncgate risk is acceptable because we're already exiting).
- → Updated solution: signal handler runs `await drainInFlight(); await fsyncLedger(); await server.close();`

**G2 — Stale Lockfile Deadlock (NEW RISK, accepted)**
- Gemini: PID file without `process.kill(pid, 0)` liveness check is a deadlock liability post-SIGKILL — `doctor --fix` will refuse to run.
- Adjudication: **ACCEPT**. Concrete mitigation. Add to lockfile spec: read PID, `process.kill(pid, 0)` to test liveness, on ESRCH treat lock as stale, log+overwrite. Add `--force` flag override + doctor reports stale lock at preflight.

**G3 — Claude Config Discovery Non-Determinism (NEW RISK, partial accept)**
- Gemini: `.mcp.json` vs `~/.claude.json` discovery non-deterministic across Claude Code versions; tool-shadowing risk if global config exists.
- Adjudication: **PARTIAL ACCEPT — needs verification**. The research source said both work; Gemini's claim of non-determinism is plausible but unverified for current Claude versions. Mitigation: pick PROJECT-scope `.mcp.json` (most explicit, repo-local), document the choice, doctor warns if `~/.claude.json` also has a `fabric` entry. Defer ~/.claude.json support to a later release.

**G4 — Sequencing: 6→3 Narrowing should be P0, not P1.12 (accepted)**
- Gemini: don't write snapshot tests (P0.5) for clients about to die.
- Adjudication: **ACCEPT**. Re-rank: 6→3 narrowing is the FIRST P0 (after deprecation 1.7.1 ships). Snapshot tests come after.

**G5 — Sequencing: Atomic-write helper should be P0, not P1.6 (accepted)**
- Gemini: P0.1 ledger fix and P0.2 signal handlers both consume durability primitives. Build the helper first.
- Adjudication: **ACCEPT**. Re-rank: atomic-write helper is the SECOND P0 after narrowing. Order: narrowing → atomic-write helper → ledger fix → signal handlers → Claude config fix → schema snapshots.

**G6 — Hidden Coupling: P0.4 (snapshots) + P1.10 (annotations) (accepted)**
- Gemini: golden snapshots before annotations = 100% test failure on annotation add.
- Adjudication: **ACCEPT**. Rule: ship snapshot tests in the SAME PR as the final tool-annotation changes (or at minimum the same release). Annotations come WITH the snapshot baseline.

**G7 — Hidden Coupling: ledger truncation + InFlightTracker (accepted, reinforces G1)**
- Gemini: drain may leave OS-buffered last event; truncate-on-no-newline could delete a real event.
- Adjudication: **ACCEPT**. Reinforces G1: fsync-on-shutdown closes this gap. Without fsync, the "last event was real but unflushed" scenario is real.

**G8 — Missing: MCP Payload Guard (NEW recommendation, accepted)**
- Gemini: MCP-first stabilization without output truncation/budgeting is incomplete; large payloads spike latency and burn client context.
- Adjudication: **ACCEPT**. Add as P1: `packages/shared/src/node/mcp-payload-guard.ts` with token-limit enforcement before JSON-RPC response. Particularly relevant for `fab_get_rule_sections` if a section is large.

**G9 — Nuke-it list (partial accept)**
- Drop Knip: **REJECT**. Pressure-pass already verified Knip is not strictly needed for THIS cycle (we enumerated dead code), but adopting it as a CI gate prevents *future* drift. Cost is one config file. Keep.
- Drop dashboard type lift (P1.11): **ACCEPT**. Defer to next minor — not stability per se.
- Drop bootstrap routing (P1.9): **REJECT**. The bug is real and one-line fix. The "aesthetic" framing is wrong; users running `doctor --fix` get a worse README than `init` produces.

#### Updated Decision Log

> **Decision**: Re-sequence to put narrowing + atomic-write helper as the FIRST two P0s before any other code changes
> - **Context**: Gemini G4 + G5 — building stability fixes on the about-to-be-deleted client surface is wasted work; building durability fixes without the primitive creates rework
> - **Chosen**: Order: 1.7.1 deprecation → 6→3 narrowing → atomic-write helper → ledger fix → signal handlers → Claude config fix → schema snapshots → annotations (paired)
> - **Rejected**: Original P0.1 ledger-first order
> - **Impact**: Implementation plan rewritten

> **Decision**: Add fsync-on-shutdown to signal handler design
> - **Context**: Gemini G1+G7 — drain without fsync is a corruption window
> - **Chosen**: `fsyncSync(ledgerFd)` after drain, before close
> - **Rejected**: Pressure-pass's "no fsync needed" — was correct for normal operation but missed shutdown coupling
> - **Impact**: Signal-handler LOC bumps from ~130 to ~150

> **Decision**: PID lockfile MUST include `process.kill(pid, 0)` liveness check + stale-lock recovery
> - **Context**: Gemini G2 — silent deadlock on SIGKILL
> - **Chosen**: liveness check + auto-overwrite stale + `--force` override + doctor preflight reports
> - **Impact**: Lockfile LOC bumps from ~40 to ~70

> **Decision**: Add MCP Payload Guard as new P1 recommendation
> - **Context**: Gemini G8 — missing for MCP-first cross-client tool
> - **Chosen**: `packages/shared/src/node/mcp-payload-guard.ts` with token budget
> - **Impact**: One new P1 item; ~80 LOC; closes "tool blows up client context" failure mode

> **Decision**: Defer dashboard type lift to next minor
> - **Context**: Gemini G9 — not stability-critical
> - **Chosen**: Park; revisit when dashboard ↔ server contract changes
> - **Impact**: P1 list shrinks by 1

#### Confidence Score (Round 3, after Gemini cross-verification)

| Dimension | findings_depth | evidence_strength | coverage_breadth | user_validation | consistency | **Score** |
|---|---|---|---|---|---|---|
| architecture | 0.92 | 0.92 | 0.90 | 0.50 | 0.90 | **0.879** |
| implementation | 0.92 | 0.95 | 0.90 | 0.50 | 0.95 | **0.890** |
| performance (stability) | 0.95 | 0.95 | 0.92 | 0.65 | 0.90 | **0.918** |

Overall: **0.896** | Weakest: **architecture (0.879)** | Δ vs Round 2: **+0.034**

Cross-verification raised consistency confidence (Gemini independently corroborated 8 of 13 solutions) AND surfaced 4 real coupling issues (drain-corruption, stale lock, snapshot-annotation, ledger-truncate-vs-buffered). Net: confidence rose, plan refined.

#### Round 3: Narrative Synthesis

**起点**: Confidence 86%，user 要求 Gemini 交叉验证。

**关键进展**: Gemini 独立验证发现 4 个未被前 4 视角察觉的耦合问题：(1) 优雅退出 vs 损坏悖论 — 无 fsync 的 drain 是假象；(2) PID 锁文件 stale-lock 死锁；(3) Claude 配置发现非确定性；(4) Snapshot 与 Annotation 的发布耦合。还提出一个被遗漏的关键建议（MCP Payload Guard）。

**决策影响**: 重排序 P0 序列（narrowing → atomic-write helper → 其余）；signal handler 加入 fsyncSync；锁文件加入 liveness check；新增 MCP Payload Guard 作为 P1；删除 dashboard type lift。

**当前理解**: 13 项建议经交叉验证后调整为 12 项，序列重排，3 项 LOC 估算上调。Confidence 来到 89.6%，可以进入 Phase 4 综合。

**遗留问题**:
- Claude Code `.mcp.json` 发现非确定性是否需要进一步代码验证？
- MCP Payload Guard 的 token 预算阈值（≤4KB / ≤16KB / 客户端协商）？
- 1.7.1 与 1.8.0 之间的间隔（2 周 / 4 周）是否合理？

### Round 4 - Interaction Layer Audit (2026-05-06 20:35 UTC+8)

#### User Input
> User flagged a coverage gap: 前 3 轮聚焦代码/契约/稳定性，没系统看 **规则更改后的审查策略 / 初始化文档→规则架构的转换 / 其他交互痛点**。要求识别交互痛点。

#### Methodology
Focused interaction-axis exploration across 3 axes (rule-change review, init pipeline, other UX). Output: `explorations/interaction.json` (64KB). Reading flow surfaced 14 new actionable items (R14-R27).

#### Key Findings (Round 4)

> **Finding [F17]**: `fab init --reapply` is destructive in two ways the user does not expect — truncates `.fabric/events.jsonl` to empty (init.ts:579-580) AND regenerates `agents.meta.json` as L0-only stub (init.ts:572-573 + createInitialMeta L1256-1271), wiping the AI-built rule node tree.
> - **Confidence**: High — code paths quoted directly
> - **Severity**: HIGH (silent data loss; only recoverable by user re-running AI skill + `doctor --fix`)
> - **Scope**: every user who runs `--reapply` to "refresh"

> **Finding [F18]**: `fab serve` cacheWatcher watches only `agents.meta.json` + bootstrap README (http.ts:167-177). Edits to `.fabric/rules/*.md` while serve is running do NOT invalidate cache.
> - **Confidence**: High — chokidar glob inspected
> - **Severity**: HIGH for live-edit workflow
> - **Fix**: extend chokidar glob pattern (~15 LoC)

> **Finding [F19]**: `fab_plan_context` and `get-rules` iterate `agents.meta.json.nodes` only (services/plan-context.ts:218, get-rules.ts:157). User-dropped `.fabric/rules/foo.md` is invisible to AI until `doctor --fix` regenerates meta.
> - **Confidence**: High — call sites inspected
> - **Severity**: HIGH (user mental model "drop a file = AI sees it" diverges from reality)
> - **Mental model gap**: this is the #1 surprise documented

> **Finding [F20]**: Duplicate `<!-- fab:rule-id X -->` declarations silently overwrite via `Map.set` last-wins (rule-meta-builder.ts:372-382). Invalid declared ids are silently rejected; user believes their declared id was honored.
> - **Confidence**: High — verified Map iteration semantics
> - **Severity**: MEDIUM (rule-test linkage becomes non-deterministic)

> **Finding [F21]**: `content_ref_missing` is misclassified as `manual_error` even though `doctor --fix`'s existing `writeRuleMeta` path would auto-recover. Routing miss at doctor.ts:271.
> - **Confidence**: High — Tech reviewer cross-checked auto-fix capability
> - **Severity**: MEDIUM (UX: user told to fix manually when system can auto-fix)

> **Finding [F22]**: Codex SKILL (`packages/cli/templates/codex-skills/fabric-init/SKILL.md`, ~25 lines) is dramatically thinner than Claude SKILL (`agents-md-init/SKILL.md`, ~150 lines). Codex skill doesn't prescribe writing `init-context.json` or generating rules. **Cursor has NO skill or hook at all.**
> - **Confidence**: High — file-by-file comparison
> - **Severity**: HIGH (brand-quality gap for the kept-3 scope; given the topic is to NARROW to 3 clients, parity must be guaranteed)

> **Finding [F23]**: Doctor section headers ("Fixable errors:", "Manual errors:", "Warnings:") are hardcoded English at `cli/doctor.ts:72-74`, while every other CLI command uses `t()`. zh-CN users see jarring mixed output.
> - **Confidence**: High — direct hardcode quote
> - **Severity**: MEDIUM (consistent UX brand)

> **Finding [F24]**: `init_context_missing` error message has no action hint. The fix is "run an AI skill in your client" — NOT something `doctor --fix` can do — but the user has no way to know this.
> - **Confidence**: High — message text inspected
> - **Severity**: HIGH (this is the #1 confusing post-init error)

> **Finding [F25]**: No approval gate for rule changes. Edit-and-pray for `.fabric/rules/*.md` and `agents.meta.json`. No diff review, no revision-bump enforcement at write time, only after-the-fact doctor scan.
> - **Confidence**: High — codebase-wide audit found no review hook
> - **Severity**: MEDIUM (acceptable for solo workflow; risky for team)

#### Decision Log

> **Decision**: Add Codex + Cursor SKILL parity to recommendations (NEW R20)
> - **Context**: Topic is to narrow to 3 clients — parity becomes a brand commitment, not an aspiration
> - **Chosen**: Bring Codex SKILL to Claude SKILL parity; create Cursor equivalent (currently missing)
> - **Rejected**: "Document the gap, don't fix" — the analysis charter is "make 3 clients first-class"
> - **Impact**: 1.8.0 P1 gains R20

> **Decision**: `--reapply` semantics fix elevated to 1.8.0 P0
> - **Context**: F17 reveals data-loss bug, not just polish issue
> - **Chosen**: R17 = preserve events.jsonl by default; skip agents.meta.json regen if rules already exist
> - **Rejected**: "Add a `--keep-events` flag" — flag complicates UX; correct default is preservation
> - **Impact**: 1.8.0 P0 gains R17

> **Decision**: Two i18n / message-quality items moved to 1.7.1 (R18 + R24)
> - **Context**: Both are tiny, low-risk, immediately user-visible — perfect 1.7.1 candidates
> - **Chosen**: Bundle with R0 in the deprecation release
> - **Impact**: 1.7.1 grows from 1 item to 3 (still <3 days)

> **Decision**: Defer full server-side i18n (R26)
> - **Context**: R26 needs server to import @fenglimg/fabric-shared/i18n — touches package boundaries
> - **Chosen**: Defer to a later minor; ship the 3-header fix in 1.7.1 as a tactical patch
> - **Impact**: D5 added to deferral list

#### Updated Sequencing (post-Round 4)

**1.7.1 (~3 days, 3 items):** R0 (deprecation warnings) + **R18** (i18n doctor headers) + **R24** (init-context-missing action hint)

**1.8.0 P0 (~10-14 days, 8 items, ordered):** R1 (narrow 6→3) → R7 (atomic-write helper) → R2 (ledger fix) → R3 (signal handlers + fsync) → R4 (PID lockfile) → R5 (Claude config path) → R6+R10 paired (schema + annotations) → **R17** (--reapply preservation)

**1.8.0 P1 (~5-7 days, 12 items):** R12 (payload guard) + R8 (delete dead helpers) + R9 (bootstrap routing) + R11 (typed errors) + R13 (Knip) + **R14** (reclassify content_ref_missing) + **R15** (rules_dir_unindexed warning) + **R16** (stable_id_collision check) + **R19** (action hints on all checks) + **R20** (Codex + Cursor SKILL parity) + **R23** (watch rules/ in serve) + **R27** (reapply wizard warning)

**1.8.0 P2 (defer if time pressed, 4 items):** R21 (orphan annotations warning) + R22 (invalid-id warning) + R25 (preexisting CLAUDE.md/AGENTS.md detection) + (D5 R26 = full server i18n, tracked but not bound to 1.8.0)

#### Confidence Score (Round 4)

| Dimension | findings_depth | evidence_strength | coverage_breadth | user_validation | consistency | **Score** |
|---|---|---|---|---|---|---|
| architecture | 0.92 | 0.92 | 0.95 | 0.65 | 0.90 | **0.901** |
| implementation | 0.95 | 0.95 | 0.95 | 0.65 | 0.95 | **0.918** |
| performance (stability) | 0.95 | 0.95 | 0.92 | 0.70 | 0.90 | **0.921** |
| **interaction (NEW)** | 0.92 | 0.92 | 0.90 | 0.50 | 0.90 | **0.875** |

Overall: **0.904** | Weakest: **interaction (0.875)** | Δ vs Round 3: **+0.008** (coverage breadth substantially expanded)

#### Round 4: Narrative Synthesis

**起点**: 用户标记前 3 轮聚焦代码/契约/稳定性，遗漏了交互层。

**关键进展**: 3 个交互轴并行审视，发现 9 条新发现 (F17-F25) + 14 条新推荐 (R14-R27)。最严重的是 4 个隐藏 bug：(1) `--reapply` 静默清空 ledger 并重置 meta；(2) `serve` 不 watch 规则文件；(3) 手工放进 `.fabric/rules/` 的规则对 AI 不可见；(4) Codex/Cursor 的 SKILL 与 Claude 严重不对等。

**决策影响**: 1.7.1 从 1 项扩到 3 项（加 i18n 头 + init-context 提示）；1.8.0 P0 从 8 项扩到 9 项（加 R17 --reapply 修复）；1.8.0 P1 从 5 项扩到 12 项（交互推荐主要落 P1）。新增 deferral D5（完整服务端 i18n）。

**当前理解**: Fabric 的核心稳定性问题集中在两个层面：(a) **I/O 与生命周期边界**（前 3 轮已覆盖），(b) **用户心智模型与系统行为的偏差**（本轮覆盖）。两类问题都在 1.8.0 stabilization 范围内可解。Cursor 完全没 skill 是"narrow to 3"承诺的硬伤，必须补上才能称得上"first-class support"。

**遗留问题**:
- 现在共 27 项推荐 + 5 项 deferral，是否仍按"全部接受"还是用户希望剔除某些项？
- Cursor SKILL 从零开始建，需要参考 Claude/Codex 哪一套作为模板？
- `--reapply` 修复后是否还需要一个新的 `--reset` 命令显式提供"清空"语义？

### Round 6 - Implementation Confirmation (2026-05-06 22:00 UTC+8)

#### User Input
> User confirmed two-step release strategy (1.7.1 → 1.8.0), fully delegated to Claude Code for implementation.
> Discussed MCP config scope design for R5 (Claude config path fix).

#### Key Decisions

> **Decision**: `fab init` MCP config scope — support both `--scope project|user` CLI flag and interactive prompt
> - **Context**: R5 fixes Claude MCP config path from `.claude/settings.json` to `.mcp.json` / `~/.claude.json`
> - **Chosen**: `--scope` flag for automation/scripts; interactive question when flag omitted. Default: `project` scope (Fabric's core value is project-level rules; team-sharing is the primary use case)
> - **Rejected**: Single-mode (flag-only or prompt-only) — loses either automation or discoverability
> - **Impact**: R5 implementation now includes interactive init flow

> **Decision**: `.mcp.json` merge strategy on init — create if absent, deep-merge if exists
> - **Context**: User may already have other MCP servers configured in `.mcp.json`
> - **Chosen**: Deep-merge `mcpServers.fabric` into existing JSON; preserve all other `mcpServers.*` entries
> - **Rejected**: Overwrite (destroys user's existing MCP config); skip-if-exists (silent failure, confusing)
> - **Impact**: R5 implementation requires JSON deep-merge utility

> **Decision**: Old `settings.json` `mcpServers.fabric` cleanup — doctor detects, `--fix` auto-removes
> - **Context**: Existing installations have incorrect `mcpServers.fabric` in `.claude/settings.json` (hooks/permissions file)
> - **Chosen**: Doctor warns on detection; `--fix` removes the fabric entry from settings.json; writes `mcp_config_migrated` ledger event
> - **Rejected**: Silent removal (hides migration from user); manual-only (poor UX for known-wrong config)
> - **Impact**: New doctor check code `mcp_config_in_wrong_file`; fixable via `--fix`

#### Updated Decision Trail (new entries)

| D11 | R6 | `fab init` MCP scope: `--scope project|user` flag + interactive prompt, default project | User: team-sharing = primary use case | Adopted |
| D12 | R6 | `.mcp.json` deep-merge on init (preserve existing entries) | User: don't destroy user's existing MCP config | Adopted |
| D13 | R6 | Doctor `--fix` auto-removes stale settings.json mcpServers.fabric | Derived from D11/D12: cleanup the old path | Adopted |



**Status**: ✅ **RESOLVED — unified sync pattern adopted for 1.8.0**

#### User Input (Round 5)
> User: "当前如何处理人为更改已有的规则文件的呢？如何确保可以实时同步呢？"

#### User Input (Round 7)
> User confirmed: one-step to full observability. File system = truth; meta.json = auto-derived cache; drop explicit baseline. Sync only when truth is needed.

#### Current Behavior (verified, for reference)

When a user edits `.fabric/rules/<id>.md`:

| Step | Reality | User-visible effect |
|---|---|---|
| File modified | OS event fires | — |
| `fab serve` watcher | ❌ does NOT watch `.fabric/rules/` (`http.ts:167-177` only watches `agents.meta.json` + `bootstrap/README.md`) | 5s contextCache continues serving stale rule |
| `agents.meta.json` sync | ❌ no auto sync; only when user runs `doctor` / `doctor --fix` | meta enters "stale" state |
| Event ledger | 🔄 partial: 3 generic events (`rule_drift_detected` / `rule_baseline_accepted` / `baseline_synced`) written ONLY when `doctor --fix` runs; **no per-file attribution** | Ledger says "drift happened", not "which file changed which fields" |
| `fab_plan_context` visibility | ❌ reads `agents.meta.json.nodes` only (not the `.md` source); waits for `doctor --fix` to rewrite meta | AI keeps using old rules indefinitely |

**Already correct (do not break)**:
- ✅ Non-blocking architecture — no lock / approval gate; users edit freely
- ✅ Revision-hash algorithm (`rule-meta-builder.ts:64-66`) precisely detects any `.md` change
- ✅ `doctor --fix` does sync meta + write ledger + invalidate contextCache
- ✅ Stable-id preservation contract (`<!-- fab:rule-id X -->`) survives renames

#### Core Principle

> **Do not block modifications, but make every change fully traceable.**
> **File system = single source of truth. `agents.meta.json` = auto-derived cache.**
> **Sync only when truth is needed — no background writes, no watcher complexity, no races.**

#### Resolved Target Behavior

| User Action | User Expectation | New Reality |
|---|---|---|
| Edit `.fabric/rules/foo.md` | AI sees new rule on next call | MCP call detects mtime change -> incremental sync -> AI gets latest |
| Drop a `.md` into rules/ | File placed = active | Same as above |
| Edit rules while `fab serve` runs | Service should notice | MCP call triggers sync; watcher downgraded to cache invalidation flag only |
| Teammate changed a rule | Should be traceable | `rule_content_changed` ledger event records exact file, what changed |

**R28 (RESOLVED, 1.8.0 P0)** — Rule-change observability via unified sync pattern:

**Unified Sync Path** (every MCP entry touching Fabric rules runs this):
```
MCP call -> mtime detect -> if stale: incremental sync -> ledger events -> response with status summary
```

**Sync trigger points:**

| Trigger | Scope | Action |
|----------|--------|--------|
| `fab serve` startup | Full scan | Scan rules/ -> hash vs meta -> auto-repair all diffs -> write `meta_reconciled_on_startup` event |
| MCP tool call (`fab_plan_context`, `get-rules`, etc.) | Incremental | Check mtime -> if stale: process only changed files -> write granular ledger events -> response includes warnings/status |
| `fab doctor --fix` | Full repair | Consistency repairer: rebuild meta from filesystem, write `meta_reconciled` event |

**Watcher role: DOWNGRADED** — watches `.fabric/rules/` only to set a dirty flag for cache invalidation. Writes nothing.

**Granular Ledger Events:**
- `rule_content_changed { stable_id, path, prev_hash, new_hash, changed_fields[], source: "mcp_sync" }`
- `rule_added { path, derived_stable_id, source }`
- `rule_removed { stable_id, last_known_path, source }`
- `meta_reconciled { reason: "startup" | "doctor_fix" | "crash_recovery", fixes_applied[] }`
- `meta_manually_diverged { field, expected, actual }`

**Event Dedup:** One file x one effective change x one debounce (500ms) = one event. Hash-identical saves = no event.

**Doctor Role Change:** "Baseline promoter" -> "Consistency repairer". `baseline_synced` event -> `meta_reconciled`.

Estimated work: ~200 LoC; coupled with R2 (ledger), R4 (lockfile), R11 (typed errors), R24 (action hints).

#### Resolved Open Questions

1. **Cache-only vs auto-sync** → Auto-sync at access points (serve startup + MCP calls). Never in background watcher. **(D21)**
2. **Approval semantics** → Dropped. No explicit baseline command needed. **(D21, D22)**
3. **Event volume** → One event per file per 500ms debounce window. Hash-identical saves produce no event. **(D23)**
4. **Description field** → Serve startup full scan auto-repairs. Doctor detects manual meta tampering as `meta_manually_diverged`. **(D24)**
5. **Cross-process locking** → Watcher writes nothing; no conflict. Only serve startup + MCP calls + doctor write. **(D25)**
6. **Notification surface** → (See sub-question below — MCP notifications push pending)

#### Rule Quality Gate (Hybrid B+C)

**MCP-call-time incremental sync:**
- Lightweight validation on changed files: frontmatter parsable, `<!-- fab:rule-id -->` format, required fields present
- On failure -> write `rule_validation_error` ledger event; skip bad rule; include in structured warnings
- On pass -> update meta, invalidate cache

**Read-side tolerance:**
- Rule parser skips corrupted entries individually
- Response includes structured machine-actionable warnings with typed error codes + file:line + action_hint
- AI consumers can precisely cite problems, execute fix commands, and self-assess whether to continue

**Doctor keeps deep audit:** Cross-reference consistency, hash-chain integrity, rule-test linkage — periodic full physical.

#### Updated Recommendations

> **R28** — `[1.8.0, P0, NEW]` Rule-change observability: unified sync at serve startup (full) + MCP calls (incremental via mtime) + doctor (consistency repairer). Granular ledger events. Machine-actionable structured warnings. Watcher cache-invalidation only. ~200 LoC. Coupled: R2/R4/R11/R24.

> **R23** — `[1.8.0, P0]` (was P1, merged into R28) Extend watcher glob + serve startup full scan. Subsumed.

#### Decision Log (Round 5 + 7)

> D21-D26 recorded in main Decision Trail. All 6 open questions resolved.

## Synthesis & Conclusions

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|---|---|---|---|
| 1 | 客户端范围收敛 (6→3) | ✅ Addressed | Round 1 (15-file map), Round 3 (re-prioritized to first P0) | Two-step ship 1.7.1→1.8.0 |
| 2 | 代码质量与一致性 | ✅ Addressed | Round 1 (Tech smells, Arch drift surfaces), Recs 8/9/10/11 | Knip kept; dashboard type lift deferred |
| 3 | 稳定性与回归防护 | ✅ Addressed | Round 1 (test gaps), Round 2 (concrete LOC), Round 3 (Gemini coupling) | Schema golden-files = headline regression net |
| 4 | 运行时健壮性 | ✅ Addressed | Round 1 (signal handlers, error mapping), Round 2 (concurrency), Round 3 (drain+fsync) | Highest-confidence dimension at 91.8% |

### Findings Coverage Matrix

| # | Finding | Disposition | → Recommendation |
|---|---|---|---|
| F1 | Claude config path noncompliant (`settings.json` vs `.mcp.json`) | recommendation | R5 |
| F2 | MCP server has no signal handlers (#15945 zombie pattern) | recommendation | R3 |
| F3 | events.jsonl raw appendFile, no fsync, no rotation, no tail-tolerance on full read | recommendation | R2 |
| F4 | 6→3 client narrowing scope = 15 files mechanical | recommendation | R0 (1.7.1) + R1 (1.8.0) |
| F5 | Tool schemas inline, no shared export, no contract tests | recommendation | R6 |
| F6 | 7 dead helpers in init.ts (~170 LoC) | recommendation | R8 |
| F7 | writeDefaultBootstrap silent stub | recommendation | R9 |
| F8 | Dashboard re-declares DoctorReport type | deferred | next minor (Gemini G9 accept) |
| F9 | fab_get_rules orphan tool (registered nowhere) | → R8 (merged into dead code removal) |
| F10 | _error.ts string-prefix HTTP-status matching | recommendation | R11 |
| F11 | 22 atomic-write callsites, 14 candidates for shared helper | recommendation | R7 |
| F12 | Concurrency: serve vs doctor --fix / init --reapply races | recommendation | R4 |
| F13 | SSE reader already does tail-tolerance (reusable pattern) | informational | feeds R2 |
| F14 | Gemini G1: drain-without-fsync paradox | absorbed by R3 | R3 includes fsyncSync-on-shutdown |
| F15 | Gemini G2: stale lockfile deadlock | absorbed by R4 | R4 includes liveness check |
| F16 | Gemini G8: missing MCP Payload Guard | recommendation | R12 (NEW) |

All findings have a non-null disposition. ✅

### Executive Summary

Fabric v1.7.0 is feature-complete; the remaining work is **stability + scope discipline**, not new functionality. Across 6 rounds (including Gemini cross-verification and user confirmation rounds) we identified **16 findings resolving to ~24 actionable recommendations + 5 deferrals**, sequenced into a two-release plan totalling roughly **~950 LoC** of changes plus tests, all at I/O / lifecycle boundaries with zero business-logic risk.

The most surprising finding is a latent bug: Claude Code MCP configuration is being emitted to `.claude/settings.json` (which is for hooks/permissions) instead of `.mcp.json` / `~/.claude.json`. The most coupling-sensitive change is the signal-handler design — Gemini correctly pointed out that "graceful drain" without an explicit `fsync` is a corruption window, not a corruption fix. The single highest-ROI test layer is golden-file contract tests for emitted MCP tool schemas + emitted client configs, which closes the industry's #1 MCP failure category (38% schema drift).

The 6→3 client narrowing is mechanical (15 files, ClientKind is a typed pivot). It should ship FIRST (after a 1.7.1 deprecation release) so that the subsequent stabilization work doesn't pile snapshots and contract tests onto code about to be deleted.

### Key Conclusions

1. **The work IS stabilization, not refactor.** init.ts decomposition, JsonClientConfigWriter format-split, and tsconfig hardening are all correctly DEFERRED — none of them buy user-visible stability this cycle.
2. **Fabric's MCP architecture is sound.** The AGENTS.md/CLAUDE.md drift problem documented industry-wide doesn't apply because Fabric uses an MCP resource (single source of truth) rather than per-client root files.
3. **The right unit of change is the I/O boundary.** Ledger writer, atomic-write helper, signal handler, lockfile, schema export — all live at the periphery. Business logic doesn't move.
4. **Cross-verification matters.** 4 perspectives + research agreed on 5 themes; Gemini independently agreed on those 5 AND surfaced 4 coupling issues none of the 4 caught. Plan stability ≠ code stability.
5. **Two-release sequencing buys deprecation politeness AND code safety.** 1.7.1 = deprecation warnings; 1.8.0 = removal + hardening + contracts.

### Recommendations (ranked, with sequence labels for two-release plan)

**RELEASE 1.7.1 (deprecation-only, ~3 days work)**

> **R0** — `[1.7.1, P0]` Emit deprecation warnings via `fabric doctor` for any `clientPaths.{windsurf,rooCode,geminiCLI}` keys present in `fabric.config.json`; document migration in CHANGELOG and a new `docs/migration-1.8.md`. Keep zod schema `passthrough()` so users do not see hard validation errors. **No code removal yet.** Effort: ~1-2 days. Evidence: business.json sequencing recommendation; risk_register top item.

**RELEASE 1.8.0 (stabilization milestone, ~10-14 days work, ~950 LoC + tests)**

**P0 (ordered, 9 items):**

> **R1** — `[1.8.0, P0, FIRST]` Remove Windsurf / Roo Code / Gemini CLI support: 10 code/schema/i18n files + 6 template-file deletions + 5 doc updates + add `clientScope` test fixture preventing reintroduction. Effort: ~1 day mechanical. Evidence: exploration-codebase.json client_scope_map. Acceptance: `pnpm test` green; `grep -ri 'windsurf\|roo\|gemini' packages/` returns 0 hits in `src/`.

> **R7** — `[1.8.0, P0, SECOND]` Build `packages/shared/src/node/atomic-write.ts` exporting `atomicWriteText`, `atomicWriteJson`, and `createLedgerWriteQueue(path)`. Migrate the 14 P0/P1 callsites. Effort: ~2 days. Evidence: stability-deepdive.json atomic_write_inventory.

> **R2** — `[1.8.0, P0]` Lift SSE reader's tail-tolerance pattern into `readEventLedger`; introduce `LedgerWarning[]`; add fixable check `event_ledger_partial_write` with `truncateLedgerToLastNewline`. ~120 LoC. Evidence: `packages/server/src/api/events.ts:363-401`.

> **R3** — `[1.8.0, P0]` Signal handlers SIGINT/SIGTERM/SIGHUP: drain via `InFlightTracker` (5s deadline), `fsyncSync(ledgerFd)` (Gemini G1), `server.close()`, exit. Double-signal hard-exits. ~150 LoC. Acceptance: vitest spawn → SIGTERM → exit-code 0 within 5s; no zombie; ledger durable.

> **R4** — `[1.8.0, P0]` `.fabric/.serve.lock` PID file with `process.kill(pid, 0)` liveness check (Gemini G2); doctor preflight detects stale lock; `--force` override. ~70 LoC.

> **R5** — `[1.8.0, P0]` Fix Claude MCP config path: write project-scope `.mcp.json` via `--scope project|user` flag + interactive prompt (default: project). Deep-merge if `.mcp.json` exists. Doctor `--fix` auto-removes stale `settings.json` mcpServers.fabric entry; writes `mcp_config_migrated` ledger event. Acceptance: snapshot test matches Claude Code MCP spec. (D11-D13)

> **R6+R10** — `[1.8.0, P0, paired]` Export tool input/output Zod schemas to `packages/shared/src/schemas/api-contracts.ts`; add per-tool golden-file snapshot tests. Ship with tool annotations (`readOnlyHint`, `idempotentHint`, `destructiveHint`, `openWorldHint`, `title`) in same PR to avoid snapshot churn (Gemini G6). ~2 days.

> **R17** — `[1.8.0, P0]` Fix `--reapply` data-loss: preserve events.jsonl; skip agents.meta.json regen if rules already exist. No new `--reset` command. (D14)

> **R28** — `[1.8.0, P0, NEW]` Rule-change observability: unified sync pattern. Serve startup full scan → auto-repair meta. MCP calls: mtime detect → incremental sync → granular ledger events (`rule_content_changed`, `rule_added`, `rule_removed`) → machine-actionable structured warnings (typed error codes + file:line + action_hint). Doctor: consistency repairer role; `meta_reconciled` replaces `baseline_synced`. Watcher downgraded to cache-invalidation-only. Event dedup: one file × one effective change × 500ms debounce = one event. ~200 LoC. Coupled with R2/R4/R11/R24. (D18-D27)

**P1 (12 items):**

> **R8** — `[1.8.0, P1]` Delete 7 dead helpers at `packages/cli/src/commands/init.ts:1383-1554` + `fab_get_rules` orphan tool (never registered). Effort: ~1 hour. (D17, D32)

> **R9** — `[1.8.0, P1]` Route `writeDefaultBootstrap` to call `buildFabricBootstrapGuide`. Effort: ~1-2 hours.

> **R11** — `[1.8.0, P1]` Replace `_error.ts:93-115` string-prefix matching with typed error class hierarchy: `FabricError` base → `ConfigError` / `RuleError` / `IOFabricError` / `MCPError` / `InitError` sub-trees. Each carries `code` + `actionHint` + `fixable`. ~1 day. (D31)

> **R12** — `[1.8.0, P1]` MCP Payload Guard: 16KB warn / 64KB hard limit, user-configurable via `fabric.config.json`. ~80 LoC. (D28)

> **R13** — `[1.8.0, P1]` Knip: `knip.config.ts`, zero clean (no baseline), integrated into lint step with ESLint. ~half day. (D35)

> **R14** — `[1.8.0, P1]` Reclassify `content_ref_missing` from manual_error → fixable. Route to existing `writeRuleMeta` auto-recovery path.

> **R15** — `[1.8.0, P1]` `rules_dir_unindexed` doctor check: detect orphan `.md` files in rules/ not in meta. `--fix` indexes them. (R28 MCP sync does this proactively; doctor is fallback.)

> **R16** — `[1.8.0, P1]` `stable_id_collision` detection: two files declaring same `<!-- fab:rule-id -->` → structured warning with both file paths.

> **R19** — `[1.8.0, P1]` Action hints on ALL doctor checks. Every check message includes actionable next step.

> **R20** — `[1.8.0, P1]` Single canonical SKILL source → derive both Claude SKILL + Codex SKILL. Same "one truth, per-client artifacts" philosophy as rules. (D29)

> **R23** — `[1.8.0, P1]` (subsumed into R28) Extend watcher glob to `.fabric/rules/**/*.md` + serve startup full consistency scan.

> **R25** — `[1.8.0, P1]` (was P2, elevated) Pre-existing CLAUDE.md/AGENTS.md detection: serve startup info-level check. Prevents user confusion between Fabric bootstrap and existing rule files. (D30)

**DEFERRED (this cycle):**
- **D1** — Dashboard `DoctorReport`/`DoctorCheck` type lift (Gemini G9; not stability-critical).
- **D2** — JsonClientConfigWriter format-split refactor (only 2 JSON writers survive narrowing).
- **D3** — `init.ts` 6-module decomposition (high blast radius / no user payoff).
- **D4** — tsconfig `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (1-2 days noise).
- **R21** — Orphan annotations warning → 1.9.0 (D30).
- **R22** — Invalid stable_id warning → 1.9.0 (D30).
- **D5/R26** — Full server-side i18n (package boundary complexity; revisit when i18n strategy matures).
- **R27** — `--reapply` wizard warning: DELETED, obsoleted by R17 fix (D34).

### Open Questions (Resolved)

- MCP Payload Guard token threshold: **16KB warn / 64KB hard limit, user-configurable in fabric.config.json** (D28).
- `fab_get_rules` orphan tool: **DELETED, merged into R8** (D17, D32).
- MCP config scope on init: **`--scope project|user` flag + interactive prompt, default project; deep-merge** (D11-D12).
- `--reapply` fix: **preserve ledger + skip meta regen if rules exist; no `--reset`** (D14).
- R28 rule-change observability: **all 6 sub-questions resolved** (D18-D27).
- R11 error class hierarchy: **FabricError base → 5 sub-trees** (D31).
- Knip config: **`knip.config.ts`, zero clean, lint step** (D35).
- Test strategy: **implementation + tests in same commit, all items** (D33).
- SKILL strategy: **single canonical source → derive Claude + Codex** (D29).

### Follow-up Suggestions
- A separate analysis-with-file session for: (a) tsconfig hardening rollout (D4), (b) init.ts decomposition (D3).
- After R6 + R10 ship, a one-page "MCP contract" doc inside `docs/` showing tool schemas + annotations as public surface.
- Consider a third release line at 1.8.x for any stability hot-fixes from wider rollout.
- R21+R22 follow 1.9.0 alongside any new feature work.
- Consider a third release line at 1.8.x for any stability hot-fixes that emerge from the wider rollout.

## Decision Trail

| # | Round | Decision | Driver | Status |
|---|---|---|---|---|
| D1 | R1 | Defer JsonClientConfigWriter format-split | Architectural: only 2 JSON writers survive narrowing | Deferred |
| D2 | R1 | Two-step release sequencing (1.7.1 → 1.8.0) | Business: backward-compat + uniform deprecation | Adopted |
| D3 | R2 | Drop hard fsync-per-append; tail-tolerant reader instead | Pressure pass: 95% value at <30% cost | Adopted (refined in R3) |
| D4 | R3 | Re-sequence: narrowing FIRST, then atomic-write helper, then ledger fix | Gemini G4+G5: don't snapshot dying clients | Adopted |
| D5 | R3 | Add `fsyncSync` to signal handler shutdown | Gemini G1: drain-without-fsync paradox | Adopted |
| D6 | R3 | PID lockfile MUST include liveness check + stale recovery | Gemini G2: silent deadlock on SIGKILL | Adopted |
| D7 | R3 | Add MCP Payload Guard as new R12 | Gemini G8: missing for MCP-first tool | Adopted |
| D8 | R3 | Defer dashboard type lift to next minor | Gemini G9 partial: not stability-critical | Deferred |
| D9 | R4 | Pair R6 (schema snapshots) with R10 (annotations) in same PR | Gemini G6: snapshot-vs-annotation churn coupling | Adopted |
| D10 | R4 | Claude config: project-scope `.mcp.json` only; defer user-scope | Gemini G3: Claude discovery non-determinism | Adopted with deferral |
| D11 | R6 | `fab init` MCP scope: `--scope project\|user` flag + interactive prompt, default project | User: team-sharing = primary use case | Adopted |
| D12 | R6 | `.mcp.json` deep-merge on init (preserve existing entries) | User: don't destroy user's existing MCP config | Adopted |
| D13 | R6 | Doctor `--fix` auto-removes stale settings.json mcpServers.fabric | Derived from D11/D12: cleanup the old path | Adopted |
| D14 | R6 | `--reapply` fix: preserve ledger + skip meta regen if rules exist; no `--reset` for now | User: fix the data-loss bug, keep it simple | Adopted |
| D15 | R6 | R20 scoped down: Cursor auto-loads Claude/Codex SKILL dirs; only maintain Claude + Codex SKILL | User: Cursor compatibility confirmed; no Cursor-specific SKILL needed | Adopted |
| D16 | R6 | Execution: 1.7.1 first → 1.8.0, same branch, separate commits; P0 per-item commits, P1 grouped by theme; small calls self-decided + logged | User: follow recommended approach | Adopted |
| D17 | R6 | `fab_get_rules` orphan tool: DELETE (never registered, no compat burden, keep tool surface small) | User: delete | Adopted |
| D18 | R6 | R23/R28 two-layer: 1.8.0 does cache invalidation + coalesced ledger event + doctor info check; deep observability deferred | User: safety-first incremental approach | Adopted |
| D19 | R6 | Rule quality: watcher incremental validation + read-time tolerance with machine-actionable warnings (Hybrid B+C) | User: AI must be able to understand and self-repair from warnings | Adopted |
| D20 | R6 | Warning structure: typed error codes + file:line + action_hint + machine-actionable; feeds into R11+R24 | Derived from D19: AI is the consumer, not just humans | Adopted |
| D21 | R7 | R28: one-step to full observability. File system = truth; meta.json = auto-derived cache; drop explicit baseline | User: explicit baseline too burdensome; file system maps to current spec; ledger events = sufficient traceability | Adopted |
| D22 | R7 | Doctor role change: "baseline promoter" → "consistency repairer". `baseline_synced` → `meta_reconciled` | Derived from D21: with auto-sync, doctor's job is full consistency repair, not approval | Adopted |
| D23 | R7 | Event dedup: one file × one effective change × one debounce window (500ms) = one event; hash-identical saves = no event | User: reasonable | Adopted |
| D24 | R7 | Serve startup: full scan rules/ → hash vs meta → auto-repair + `meta_reconciled_on_startup` event. Doctor: detect manual meta divergence | User: reasonable | Adopted |
| D25 | R7 | R28 unified sync: watcher auto-sync REMOVED. Sync happens at serve startup (full) + MCP calls (incremental via mtime). Watcher downgraded to cache invalidation only. | User: watcher too frequent; sync only when truth is needed | Adopted |
| D26 | R7 | Unified rule-access pattern: every MCP entry that touches Fabric rules runs the same path — mtime detect → incremental sync → ledger event → response with status summary | Derived from D25: consistency at access points, no background writes | Adopted |
| D27 | R7 | MCP notifications: passive only (cache invalidate). No push. Web UI would be the right place if ever needed. | User: passive is sufficient; push adds complexity with no clear payoff | Adopted |
| D28 | R7 | MCP Payload Guard: 16KB warn / 64KB hard limit + user-configurable via `fabric.config.json` | User: reasonable defaults, let power users customize | Adopted |
| D29 | R7 | Single canonical SKILL source -> derive Claude SKILL + Codex SKILL. Same philosophy as rules: one truth, per-client artifacts. | User: better than asymmetric Claude-primary approach | Adopted |
| D30 | R7 | P2 reclassified: R25 -> P1 (pre-existing CLAUDE.md/AGENTS.md detection); R21+R22 -> 1.9.0 | User: reasonable | Adopted |
| D31 | R7 | R11 error class hierarchy: FabricError base -> Config/Rule/IO/MCP/Init sub-trees. Each carries code + actionHint + fixable. | User: reasonable | Adopted |
| D32 | R7 | `fab_get_rules` orphan deletion merged into R8 (dead code removal) | User: same category, same commit | Adopted |
| D33 | R7 | Test strategy: implementation + tests in SAME commit for ALL items (P0 and P1), TDD-style | User: cleaner, no exception needed for P1 | Adopted |
| D34 | R7 | R27 (--reapply wizard warning): DELETED. Obsoleted by R17 fix; help text covers it | User: non-destructive behavior doesn't warrant wizard intervention | Adopted |
| D35 | R7 | Knip: `knip.config.ts`, zero-clean baseline (no baseline to maintain), integrated into lint step with ESLint | User: agreed | Adopted |
| D36 | R7 | R14-R19+R25: all 5 interaction P1 items confirmed as-designed | User: all confirmed | Adopted |

### Round 7 - Rule Change Observability Design (2026-05-06 22:45 UTC+8)

#### User Input
> User requested: revisit parked R28 together with R23. Discuss the optimal strategy for rule loading and human interaction.

#### Core Principle

> **Do not block modifications, but make every change fully traceable.**

With sufficient ledger events, users and team leads can see a clear timeline in the dashboard or `fab doctor`: who changed what rule, when, and with what effect. This is superior to both "lock it down" and "silently ignore changes."

#### Two-Layer Design

**Layer 1 — 1.8.0 (Enhanced R23, ~40 LoC):**

- Extend chokidar glob to `.fabric/rules/**/*.md` (was: only `agents.meta.json` + bootstrap README)
- On change, debounce 500ms → invalidate `contextCache` (AI reads fresh on next `fab_plan_context`)
- Write **one** coalesced ledger event: `cache_invalidated { trigger: "rule_file_change", files: ["a.md", "b.md"], timestamp }`
- **Do NOT auto-update `agents.meta.json`** — preserves explicit baseline semantics; avoids race with concurrent `doctor --fix`
- New doctor info-level check `rule_drift_pending`: summarizes file changes since last `baseline_synced`

**Layer 2 — Future Version (R28 full, ~150 LoC, DEFERRED):**

- Compute hash diff against stored meta → granular ledger events (`rule_content_changed` / `rule_added` / `rule_removed` / `rule_id_changed`)
- Optional `fab serve --auto-sync` mode
- `fab doctor --baseline` as explicit approval command
- MCP `notifications/resources/updated` push to connected clients

**Why cache-only, not meta auto-sync:**
1. **Preserves human approval node** — `agents.meta.json` update = "I confirm current rules are correct." Auto-overwriting loses this.
2. **Avoids background-write races** — serve watcher writing meta + user running `doctor --fix` = no lock protection yet.
3. **Safe increment** — cache invalidation is pure benefit (changes are visible); no destructive side effects.

#### Rule Quality Gate (Hybrid B+C)

> **Decision**: Adopt watcher-side incremental validation + read-side tolerance with machine-actionable warnings.

**Watcher-side (change detection):**
- Lightweight validation: frontmatter parsable, `<!-- fab:rule-id -->` format correct, required fields present
- On failure → write `rule_validation_error` ledger event; **keep cache stale** (don't feed bad rules to AI)
- On pass → invalidate cache for next read

**Read-side (MCP call tolerance):**
- Rule parser skips corrupted entries individually; includes structured warnings in response metadata
- Warning format (machine-actionable for AI consumers):

```json
{
  "warnings": [
    {
      "code": "RULE_FRONTMATTER_PARSE_ERROR",
      "rule_path": ".fabric/rules/auth-strategy.md",
      "line": 3,
      "detail": "missing required field 'description'",
      "action_hint": "Edit the file to add a description field, or run `fab doctor --fix` to auto-repair"
    },
    {
      "code": "RULE_ID_COLLISION",
      "rule_path": ".fabric/rules/payment-flow.md",
      "conflict_with": ".fabric/rules/checkout.md",
      "stable_id": "rule-abc123",
      "action_hint": "Both files declare the same rule-id. Remove the duplicate from one file."
    }
  ]
}
```

- AI can: (a) precisely cite which file + line has the problem, (b) execute the action_hint CLI command, (c) self-assess whether to continue with partial context

**Doctor keeps deep audit role:**
- Cross-reference consistency, hash-chain integrity, rule-test linkage verification
- Daily flow relies on watcher + tolerance; doctor is the periodic full physical

> This feeds directly into R11 (typed errors replacing string-prefix matching) and R24 (action hints on all checks) — both serve the same goal: **make AI consumers able to understand and handle errors autonomously.**



## Session Statistics

- **Rounds**: 6 (Round 1 exploration, Round 2 stability deep-dive, Round 3 Gemini cross-verification, Round 4 interaction layer audit, Round 5 rule-change observability parked, Round 6 implementation confirmation)
- **Key findings**: 16 (8 Round 1 + 4 Round 2 + 4 Round 3 from Gemini)
- **Recommendations**: 27 (R0-R27) + 5 deferrals
- **Dimensions**: 4 (architecture / implementation / performance / interaction)
- **Perspectives**: 4 (Technical / Architectural / Domain Expert / Business) + Gemini cross-verification
- **External research**: 1 workflow-research-agent run (9 findings, 9 best practices, 9 codebase gaps)
- **Decisions logged**: 36 (D1-D36)
- **Final confidence**: 0.896 (architecture 0.879 / implementation 0.890 / performance 0.918)
- **Quality signals**: pressure pass executed (Round 2), 2 challenge modes fired (devils_advocate + cross_verification_gemini), readiness gate PASSED, no residual risks blocking
- **Total estimated work**: 1.7.1 ≈ 1-2 days (deprecation/docs only); 1.8.0 ≈ 10-14 days, ~600 LoC across 13 recommendations
