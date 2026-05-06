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

### Round 5 - Rule Change Observability (Parked for Dedicated Discussion)

**Status**: ⏸ **PARKED — needs deeper standalone discussion before binding to a release**

#### User Input
> 用户提问："当前如何处理人为更改已有的规则文件的呢？如何确保可以实时同步呢？感觉一个好的交互方式应该是不阻碍允许修改，但是有相应的事件记录具体哪些进行了修改"

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

#### Proposed Direction (NOT bound to 1.8.0; needs deeper discussion)

Sketch — DO NOT TREAT AS COMMITTED:

**R28 (PROPOSED, DEFERRED)** — Rule-change observability: real-time sync + event attribution
- Extend `fab serve` watcher glob to include `.fabric/rules/**/*.md`
- On change, debounced 300ms → compute hash diff against stored meta → append granular ledger events:
  - `rule_content_changed { stable_id, path, prev_hash, new_hash, fields_diff[], source }`
  - `rule_added { path, derived_stable_id, source }`
  - `rule_removed { stable_id, last_known_path, source }`
  - `rule_id_changed { path, prev_stable_id, new_stable_id, source }`
- New doctor check `rule_drift_pending` (informational) — summarize pending drift since last `baseline_synced`
- Estimated work: ~150 LoC; multiple touch points

#### Open Questions Blocking Commitment

1. **Cache-only vs full meta auto-sync**: when watcher fires, do we (a) only invalidate `contextCache` (conservative — keeps "edit ↔ baseline" boundary explicit), or (b) auto-rewrite `agents.meta.json` with `source:"watch_autosync"` ledger tag (aggressive — full real-time but writes files in background)?
2. **Approval semantics**: should there be an explicit `fab doctor --baseline` (or similar) command that promotes accumulated `rule_*_changed` events into a `baseline_synced` event? Or keep using `doctor --fix` as the implicit baseline command?
3. **Event volume / retention**: if a developer rapidly saves a file 50 times, do we coalesce into one event or write 50? Implication for ledger size and rotation strategy (couples to R2 ledger fix).
4. **`agents.meta.json` description field semantics**: today it's regenerated on every doctor --fix from `.md` frontmatter. Should the new ledger record `description_overridden_by_user` events when meta.json description differs from .md-derived? Coupling to F23 finding.
5. **Cross-process locking interaction**: watcher fires in `fab serve` while user runs `fab doctor --fix` from another shell — both would try to write meta + ledger. Couples to R4 (PID lockfile).
6. **Notification surface**: should ledger events trigger MCP `notifications/resources/updated` to push the change to the active client, or only invalidate cache and let the next tool call read fresh? UX vs network-cost tradeoff.

#### Decision Log

> **Decision**: Park R28 for dedicated discussion before binding to 1.8.0
> - **Context**: Topic surfaces 6 cross-cutting open questions that interact with R2 (ledger), R4 (lockfile), F23 (meta drift), and broader UX semantics
> - **Chosen**: Document current behavior + proposal sketch; do NOT add R28 to recommendation list yet
> - **Rejected**: Bind R28 to 1.8.0 P1 immediately — too many unresolved tradeoffs, risk of half-baked design landing in stabilization release
> - **Impact**: Recommendation count remains at 27. R23 stays as-is (simple watch-glob extension). A dedicated future analysis session should resolve the 6 open questions and then either spawn a refined R28 or bundle it into 1.9.0

#### Round 5 Status
- No new recommendations added to active list
- R23 (watch glob extension) **remains** in 1.8.0 P1 as-is — independent of R28 outcome
- Confidence unchanged (this round explored an additional direction but did not modify the existing plan)
- A `discussion-rule-observability.md` follow-up doc could capture the dedicated session when scheduled

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
| F9 | fab_get_rules orphan tool (registered nowhere) | recommendation | R10 (delete or register) |
| F10 | _error.ts string-prefix HTTP-status matching | recommendation | R11 |
| F11 | 22 atomic-write callsites, 14 candidates for shared helper | recommendation | R7 |
| F12 | Concurrency: serve vs doctor --fix / init --reapply races | recommendation | R4 |
| F13 | SSE reader already does tail-tolerance (reusable pattern) | informational | feeds R2 |
| F14 | Gemini G1: drain-without-fsync paradox | absorbed by R3 | R3 includes fsyncSync-on-shutdown |
| F15 | Gemini G2: stale lockfile deadlock | absorbed by R4 | R4 includes liveness check |
| F16 | Gemini G8: missing MCP Payload Guard | recommendation | R12 (NEW) |

All findings have a non-null disposition. ✅

### Executive Summary

Fabric v1.7.0 is feature-complete; the remaining work is **stability + scope discipline**, not new functionality. Across 3 rounds and a Gemini cross-verification we identified **16 findings → 12 actionable recommendations + 1 deferral**, sequenced into a two-release plan totalling roughly **600 LoC** of changes plus tests, all at I/O / lifecycle boundaries with zero business-logic risk.

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

**RELEASE 1.8.0 (stabilization milestone, ~10-14 days work, ~600 LoC + tests)**

> **R1** — `[1.8.0, P0, FIRST]` Remove Windsurf / Roo Code / Gemini CLI support: 10 code/schema/i18n files + 6 template-file deletions + 5 doc updates + add `clientScope` test fixture preventing reintroduction. Effort: ~1 day mechanical. Evidence: exploration-codebase.json client_scope_map (full file list); architectural.json blast_radius. Acceptance: `pnpm test` green; `grep -ri 'windsurf\|roo\|gemini' packages/` returns 0 hits in `src/`.

> **R7** — `[1.8.0, P0, SECOND]` Build `packages/shared/src/node/atomic-write.ts` exporting `atomicWriteText`, `atomicWriteJson`, and `createLedgerWriteQueue(path)` (path-keyed in-process queue). Migrate the 14 P0/P1 callsites in priority order. Effort: ~2 days. Evidence: stability-deepdive.json atomic_write_inventory. Acceptance: every `.fabric/*` write goes through the helper; old direct-fs calls land in lint-stdio gate.

> **R2** — `[1.8.0, P0]` Lift the SSE reader's tail-tolerance pattern into `readEventLedger`; introduce `LedgerWarning[]` returned to doctor; add fixable check `event_ledger_partial_write` with `truncateLedgerToLastNewline`. ~120 LoC. Evidence: stability-deepdive.json ledger_fix_plan; existing pattern at `packages/server/src/api/events.ts:363-401`. Acceptance: corrupted JSONL fixture surfaces a warning, `--fix` makes it parseable, no real entries lost in test.

> **R3** — `[1.8.0, P0]` Signal handlers SIGINT/SIGTERM/SIGHUP in `packages/server/src/index.ts`: drain via new `InFlightTracker` (5s deadline), then `fsyncSync(ledgerFd)` (Gemini G1), then `server.close()`, then exit. Double-signal hard-exits. ~150 LoC. Evidence: domain.json handshake_lifecycle_audit; Gemini G1 coupling. Acceptance: vitest spawn → SIGTERM → exit-code 0 within 5s; no zombie process; ledger has all in-flight events durable.

> **R4** — `[1.8.0, P0]` `.fabric/.serve.lock` PID file with `process.kill(pid, 0)` liveness check (Gemini G2); doctor preflight detects stale lock and recovers; `--force` flag override; `init --reapply` and `doctor --fix` both gate destructive ops on the lock. ~70 LoC. Evidence: stability-deepdive.json concurrency_scenarios; Gemini G2. Acceptance: kill -9 of serve leaves stale lock; next `doctor --fix` runs after stale-lock report (not blocked).

> **R5** — `[1.8.0, P0]` Fix Claude MCP config path: split `ClaudeCodeCLIWriter` into `ClaudeCodeMcpWriter` (writes project-scope `.mcp.json`) + keep `.claude/settings.json` strictly for hooks/permissions. Doctor warns if user's `~/.claude.json` already has a `fabric` entry (avoids tool-shadowing per Gemini G3). User-scope `~/.claude.json` support deferred to next minor. Evidence: domain.json client_config_audit. Acceptance: snapshot `__fixtures__/claude-mcp.json.snap` matches Claude Code spec; old `settings.json` writes are migrated by doctor.

> **R6** — `[1.8.0, P0, paired with R10]` Export tool input/output Zod schemas to `packages/shared/src/schemas/api-contracts.ts`; add per-tool golden-file snapshot tests. Snapshots include MCP tool annotations from R10. Effort: ~2 days. Evidence: domain.json schema_drift_surface (38% MCP failure category). Acceptance: any handler-vs-schema drift fails CI; `__snapshots__/tool-schemas.snap` is the source of truth.

> **R10** — `[1.8.0, P0, paired with R6]` Add MCP tool annotations to all registered tools: `readOnlyHint:true`, `idempotentHint:true`, `destructiveHint:false`, `openWorldHint:false`, `title`. Ship in the SAME PR as R6 to avoid snapshot churn (Gemini G6). Evidence: domain.json tool_annotation_audit.

> **R12** — `[1.8.0, P1, NEW from Gemini G8]` Add `packages/shared/src/node/mcp-payload-guard.ts` with token-budget enforcement before JSON-RPC response. Particularly relevant for `fab_get_rule_sections` if a section is large. Threshold proposal: ~16KB warn, ~64KB hard limit (revisit during implementation). ~80 LoC. Acceptance: `fab_get_rule_sections` over budget returns truncated payload with explicit `truncated:true` flag.

> **R8** — `[1.8.0, P1]` Delete the 7 dead helper functions at `packages/cli/src/commands/init.ts:1383-1554`. Independent verification: zero callers across packages; superseded by plan/apply pattern at L842-1008. Effort: ~30 min. Evidence: technical.json key_findings.

> **R9** — `[1.8.0, P1]` Route `writeDefaultBootstrap` (`packages/server/src/services/doctor.ts:665-669`) to call `buildFabricBootstrapGuide` so `doctor --fix` produces the same framework-aware bootstrap as `init`. Effort: ~1-2 hours. Evidence: technical.json key_findings (Layering issue).

> **R11** — `[1.8.0, P1]` Replace `_error.ts:93-115` string-prefix HTTP-status matching with typed error classes (e.g., `NotFoundError`, `ValidationError`, `ConflictError`). Map errors at the boundary, not by message text. Effort: ~1 day. Evidence: domain.json error_mapping_audit.

> **R13** — `[1.8.0, P1]` Adopt Knip with a `pnpm dlx knip` baseline + CI gate; rerun after each client removal to guarantee no orphan code. Surfaces `fab_get_rules` orphan immediately. Effort: ~half day for baseline + config. Evidence: research.json best_practices; technical.json (Knip would have caught the 7 dead helpers).

**DEFERRED (this cycle)**
- **D1** — Lift dashboard's `DoctorReport`/`DoctorCheck` from `packages/shared` (Gemini G9 accept; not stability-critical; revisit when contract changes).
- **D2** — JsonClientConfigWriter format-split refactor (Architectural defer; only 2 JSON writers survive narrowing; saves ~25 LoC for added indirection).
- **D3** — `init.ts` 6-module decomposition (Tech proposed, Business deferred; high blast radius / no user payoff in stability cycle).
- **D4** — `tsconfig.base.json` `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (1-2 days noise; warrants its own focused minor).

### Open Questions

- MCP Payload Guard token threshold: 16KB / 64KB / client-negotiated? Defer to implementation PR.
- 1.7.1 → 1.8.0 interval: 2 weeks (matches Fabric's 17-day-7-minor cadence) recommended.
- After 1.8.0 lands: do we backport any of the I/O hardening to a hypothetical 1.7.x patch line? Recommend NO — 1.7 stays frozen; users upgrade.

### Follow-up Suggestions
- A separate analysis-with-file session for: (a) tsconfig hardening rollout (D4), (b) init.ts decomposition (D3) — both deferred-then-revisit candidates.
- After R6 + R10 ship, a one-page "MCP contract" doc inside `docs/` showing the tool schemas + annotations as the public surface.
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

## Session Statistics

- **Rounds**: 3 (Round 1 exploration, Round 2 stability deep-dive, Round 3 Gemini cross-verification)
- **Key findings**: 16 (8 Round 1 + 4 Round 2 + 4 Round 3 from Gemini)
- **Recommendations**: 13 (R0/R1/R2/R3/R4/R5/R6/R7/R8/R9/R10/R11/R12/R13) + 4 deferrals
- **Dimensions**: 3 (architecture / implementation / performance)
- **Perspectives**: 4 (Technical / Architectural / Domain Expert / Business) + Gemini cross-verification
- **External research**: 1 workflow-research-agent run (9 findings, 9 best practices, 9 codebase gaps)
- **Decisions logged**: 10 (D1-D10)
- **Final confidence**: 0.896 (architecture 0.879 / implementation 0.890 / performance 0.918)
- **Quality signals**: pressure pass executed (Round 2), 2 challenge modes fired (devils_advocate + cross_verification_gemini), readiness gate PASSED, no residual risks blocking
- **Total estimated work**: 1.7.1 ≈ 1-2 days (deprecation/docs only); 1.8.0 ≈ 10-14 days, ~600 LoC across 13 recommendations
