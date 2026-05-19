# Planning Context: rc.23 combined plan

## Source Evidence

### Memory references
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/project_rc23_planned.md` — 9-scope frozen design (F1-F6 + a-B + a-C1/C2 + c + d + e)
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/project_rc22_shipped.md` — rc.22 baseline; D2 auto-heal pattern reused in a-B
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/feedback_clean_slate.md` — pre-user clean-slate (no compat shims)
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/feedback_review_batching.md` — one Gemini review at end of rc
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/feedback_cli_design.md` — drift→abort, no --force, fail-loud over silent stale
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/project_cite_policy.md` — cite-coverage rendering target
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/project_rc19_bootstrap_consolidation.md` — `.fabric/AGENTS.md` bootstrap propagation pattern

### Code anchors
- `packages/shared/src/templates/bootstrap-canonical.ts:71,78` — F1 single-step API description hot-spot
- `.fabric/AGENTS.md:11,18` — F1 second hot-spot (must double-write once)
- `packages/shared/src/schemas/api-contracts.ts` — F2 knowledgeSectionsInputSchema.ai_selected_stable_ids describe; F3 precedence tuple; F4 getKnowledgeInput/Output/Annotations + fab_get_rules; F5 _FabExtractKnowledgeInputBaseSchema + superRefine; a-C1 FabExtractKnowledge*Schema additive 4 fields
- `packages/shared/src/schemas/__tests__/tool-contracts.test.ts` — F4 dead-tool assertion update
- `packages/server/src/services/extract-knowledge.ts` — F5 source_session removal + a-C1 frontmatter writer
- `packages/server/src/tools/knowledge-sections.ts` — F6 description self-describe target
- `packages/server/src/services/plan-context.ts` — a-B buildPreflightDiagnostics + auto_healed plumbing
- `packages/server/src/services/knowledge-sync.ts` — a-B/d shared reconcile path; reconcileKnowledge trigger union
- `packages/server/src/services/doctor.ts` — a-C2 enrichDescriptions + e stale_serve_lock + c cite-coverage breakdown
- `packages/cli/src/commands/doctor.ts` — a-C2 + e flag wiring
- `packages/server/src/services/cite-coverage.ts` — c sentinel parser + renderCiteCoverageReport columns
- `packages/server/src/index.ts:startStdioServer` — d non-blocking startup refactor
- `packages/shared/src/schemas/event-ledger.ts` — a-B/d new trigger / event_type values
- `packages/shared/src/skills/fabric-archive.md` + `fabric-import.md` — a-C1 skill prompt updates

## Understanding

### Current State
rc.22 just shipped (combined 5-scope: A ledger rotation + B baseline filename + C tags drop + D read-side auto-heal + E reconcile dual-root). rc.23 bundles 9 distinct scopes that surfaced in post-rc.22 dogfooding and from a fresh Gemini review of the published surface. Two flagship issues:

1. **Bootstrap teaches a wrong API (F1)** — `fab_get_knowledge_sections(id=...)` does not exist; real API is two-step (plan_context → get_knowledge_sections with selection_token + ai_selected_stable_ids + sections). Every fresh agent session breaks on first KB read.
2. **Slow MCP startup (d)** — reconcileKnowledge blocks server.connect; large KBs add 2-15s to first-call latency, which UX-tests showed users perceive as "broken".

The remaining 7 scopes are smaller hygiene + schema cleanups that share files (api-contracts.ts gets edits from F2/F3/F4/F5/a-C1) so they need careful sequencing to avoid merge-loop churn.

### Proposed Approach

- **11 feature-scoped tasks** (not file-scoped) sequenced as a single commit chain
- **Commit order is authoritative**: F1(T1) → F2-F6(T2/T3/T4) → a-B(T5) → a-C1(T6) → a-C2(T7) → c(T8) → d(T9) → e(T10) → release+review(T11)
- **Parallel-safe pairs**: T3 (F5) and T4 (F6) can run beside T2 if developer wants; T10 (e) has no dependency on anything else and could be done first
- **Critical coordination points**:
  - TASK-001 and TASK-008 both edit `.fabric/AGENTS.md` (F1 rewrites the rule body, c adds the sentinel reasons to the cite-policy block). T8 is sequenced after T1 so the second edit sees T1's text.
  - TASK-002 and TASK-006 both edit `api-contracts.ts` (F2/F3/F4 sweep + a-C1 additive fields). T6 declares depends_on=[T2] to force sequencing.
  - TASK-005 and TASK-009 both touch reconcileKnowledge/ensureKnowledgeFresh. T9 declares depends_on=[T5].

## Per-task technical decisions

### TASK-001 (F1) — Bootstrap two-step API
- **Decision**: Edit source template AND project AGENTS.md manually once
- **Rationale**: Source template fixes future fab install behavior; manual AGENTS.md patch unblocks current users immediately
- **Risk**: AGENTS.md is also touched by TASK-008 (cite sentinel); T8 must rebase onto T1 cleanly
- **Mitigation**: AGENTS.md edits are in separate H2 sections (behaviors vs Cite policy)

### TASK-002 (F2+F3+F4) — Schema sweep
- **Decision**: Bundle three small schema edits in one task — same file, splitting forces serial merges
- **F2 detail**: knowledgeSectionsInputSchema.ai_selected_stable_ids.describe → mention `fab_plan_context` + `selectable=true`
- **F3 detail**: PlanContextResult precedence tuple → JSDoc @deprecated + removal note (kept for one rc to ease consumer migration to entries[].precedence)
- **F4 detail**: hard-delete getKnowledgeInput/Output/Annotations + fab_get_rules exports + tool-contracts.test.ts assertions of absence
- **Risk**: Downstream import error if any internal caller of the deleted exports remains
- **Mitigation**: T2 implementation step explicitly greps then runs `pnpm -r typecheck` as gate

### TASK-003 (F5) — Drop source_session singular
- **Decision**: Hard removal, no deprecation cycle (pre-user clean-slate)
- **Risk**: In-flight skill scripts using legacy form would break
- **Mitigation**: Grep across `packages/shared/src/skills/**` is part of implementation steps

### TASK-004 (F6) — Self-describe knowledge-sections
- **Decision**: Description rewrite only — no schema change since enum is authoritative
- **Risk**: Description grows past MCP manifest budget
- **Mitigation**: Convergence criterion caps at 600 chars

### TASK-005 (a-B) — description-undefined auto-heal
- **Decision**: Mirror rc.22 D2 loadActiveMeta pattern — read-side auto-heal, additive optional fields on PlanContextResult
- **Risk**: Extra reconcile cost on every plan_context call
- **Mitigation**: Detector is a single-field scan over already-loaded meta; reconcile only fires when drift detected
- **Trigger**: New event-ledger trigger value `auto-heal-description` (or new event_type, decision deferred to implementation)

### TASK-006 (a-C1) — 4 optional fields
- **Decision**: All four (intent_clues / tech_stack / impact / must_read_if) are optional; existing entries remain valid
- **Risk**: Schema surface bloat
- **Mitigation**: Tight describe text + optional everywhere

### TASK-007 (a-C2) — doctor --enrich-descriptions
- **Decision**: Doctor subcommand with --auto (stub) vs interactive (prompt) split; never run silently inside `fab scan`
- **Risk**: Interactive prompt UX needs care for batched runs
- **Mitigation**: --auto is the supported automation path; interactive is human-loop

### TASK-008 (c) — cite sentinel enums
- **Decision**: Two sentinel reasons `[no-relevant]` / `[not-applicable]` + bare `KB: none` maps to `[unspecified]` for legacy/lazy
- **Risk**: Parser regex complexity (5 forms)
- **Mitigation**: Unit tests cover all five forms before merging
- **Note**: Sentinel column added to cite-coverage report — observability-only, non-blocking

### TASK-009 (d) — Non-blocking MCP startup
- **Decision**: server.connect returns immediately; reconcile runs as background promise; handler entry awaits up to 5s
- **Risk**: A handler that misses the 5s window serves stale meta — silent regression possible
- **Mitigation**: Fail-loud `reconcile_pending: true` warning + `meta_stale_at_handler` event on every timeout
- **Coordination with T5**: Same `ensureKnowledgeFresh` host file — T9 must come after T5

### TASK-010 (e) — Stale serve lock
- **Decision**: Advisory in default `fab doctor`; --fix unlinks
- **Risk**: Auto-cleaning could destroy a live serve lock if liveness check is wrong
- **Mitigation**: Liveness check uses `process.kill(pid, 0)` + ts age (>24h); both must trigger before lock is considered stale

### TASK-011 (release + review)
- **Decision**: ONE Gemini batch review over rc.23 cumulative diff per feedback_review_batching
- **Risk**: Single point of failure
- **Mitigation**: Qwen fallback chain documented in cli-tools.json

## Risks

### R1 — api-contracts.ts merge conflict
- **Surface**: T2 (F2+F3+F4 deletions/edits) + T6 (a-C1 additive 4 fields) both edit the same file
- **Severity**: Medium
- **Mitigation**: T6 depends_on=[T2]; commits applied in strict order; manual rebase guard in commit gate

### R2 — reconcileKnowledge race / silent stale
- **Surface**: T5 (description-undefined auto-heal) + T9 (non-blocking startup with 5s gate) both touch reconcile/ensureKnowledgeFresh
- **Severity**: High
- **Mitigation**: 
  - T9 depends_on=[T5] so T5's reconcile trigger lands first
  - T9 fail-loud warnings (reconcile_pending / meta_stale_at_handler) make stale-serve visible
  - Dogfood pass (T11) runs MCP server end-to-end against this repo + the werewolf-minigame sample KB

### R3 — Werewolf-minigame KB regression
- **Surface**: Any change to extract-knowledge / get-knowledge-sections / plan-context affects an existing third-party-style KB layout
- **Severity**: Medium
- **Mitigation**: Use `werewolf-minigame` as the golden regression sample — confirm `fab_plan_context` + `fab_get_knowledge_sections` still serve correct content in dogfood

### R4 — Bootstrap double-edit (AGENTS.md)
- **Surface**: T1 (F1 rewrite behavior rules) + T8 (c augment cite-policy block) both edit `.fabric/AGENTS.md`
- **Severity**: Low
- **Mitigation**: Sections are non-adjacent (## 行为规则 vs ## Cite policy); T8 depends_on=[T1]

### R5 — fab doctor --enrich-descriptions over-eager
- **Surface**: T7 could rewrite frontmatter on entries that intentionally omit fields
- **Severity**: Low
- **Mitigation**: --auto writes empty-array stubs (cosmetic only, not lossy); interactive mode requires explicit selection

## Regression strategy

### Test surfaces
- **Unit**: each impl task adds at least 2 unit tests under the affected service's `__tests__/`
- **Integration**: T9 mocked-timing tests (3 scenarios: fast reconcile / 5s race / 6s timeout)
- **Manual dogfood (T11)**:
  - Fresh repo + `fab install` + `fab serve` + first agent call → first-call latency < 100ms (d acceptance)
  - Existing repo with description-undefined entries + `fab_plan_context` call → `auto_healed=true` in response (a-B acceptance)
  - `fab doctor --cite-coverage --since=7d` → 5-column breakdown rendered (c acceptance)
  - `fab doctor --enrich-descriptions --auto` on this repo → legacy entries get stub fields, modern entries unchanged (a-C2 acceptance)
  - `werewolf-minigame` sample KB regression: `fab_plan_context paths=[<src files>]` + `fab_get_knowledge_sections` → returns the same body content as rc.22 baseline (no regression)

### Golden samples
- **This repo** (pcf) is the primary dogfood target — already runs at rc.22 with 623/490/332 tests green
- **werewolf-minigame** is the second sample — was used during rc.22 D-scope validation, retained as a heterogeneous KB shape

### Acceptance gates (T11)
1. All package unit tests pass (`pnpm -r test`): ≥ rc.22 baseline counts
2. MCP handshake p95 < 100ms (synthetic timing test)
3. Cite-coverage report shows 5-column breakdown for this repo's events.jsonl
4. Gemini batch review verdict: SHIP IT (or PASS with no blockers)
5. `fab -v` reports v2.0.0-rc.23 (release-rc skill performs version bump in a separate step before T11)

## Out of scope (rc.24)

The following came up during rc.23 design but were deliberately deferred:

- **Cite scheme iii — semi-automated audit hook**: a PostToolUse hook that scans the just-written file and emits a `cite_audit` event if the LLM forgot to cite. Architecturally similar to the SessionStart broad-hint hook but post-execution. Pushed to rc.24 to keep rc.23 scope tight.
- **fab_review 6-in-1 decomposition**: current fab_review action surface (list / approve / reject / modify / search / defer) is a 6-way switch with overlapping schemas; rc.24 will split into sibling tools (fab_review_list / fab_review_propose / fab_review_apply) to improve LLM tool-selection clarity.
- **Cite policy enforcement (not just observability)**: today cite is observability-only via cite-coverage report; rc.24 may add a soft-block on first message of a session if the previous session had < 50% cite coverage.
- **Personal-layer enrich**: a-C2 only enriches team-layer entries today; rc.24 will extend to personal layer once we confirm there's no privacy footgun.

## Key Decisions (compact)

- **D1**: F1 double-write (template + AGENTS.md) | Rationale: future + present | Evidence: bootstrap-canonical.ts L71/78 + AGENTS.md L11/18
- **D2**: F4 hard removal (no deprecate-then-remove) | Rationale: clean-slate | Evidence: feedback_clean_slate.md
- **D3**: a-B mirrors rc.22 D2 auto-heal | Rationale: pattern consistency | Evidence: project_rc22_shipped.md
- **D4**: a-C1 four optional fields | Rationale: backward-compat within KB | Evidence: existing optional `tags` field precedent
- **D5**: a-C2 doctor subcommand, NOT scan-time auto-run | Rationale: UX (no surprise rewrites) | Evidence: feedback_cli_design.md
- **D6**: c sentinel + legacy `[unspecified]` mapping | Rationale: preserve historical event-stream usability | Evidence: cite-coverage backfill compatibility
- **D7**: d non-blocking + fail-loud reconcile_pending | Rationale: latency + observability | Evidence: feedback_cli_design.md fail-loud preference
- **D8**: e advisory + --fix unlink | Rationale: rc.22 demote-to-warning consistency | Evidence: project_rc22_shipped.md
- **D9**: T11 single Gemini batch review | Rationale: cross-scope interaction visibility | Evidence: feedback_review_batching.md

## Dependencies (DAG)

```
T1 (F1 bootstrap)         ─┐
T2 (F2+F3+F4 schemas)     ─┤  independent
T3 (F5 source_session)    ─┤
T4 (F6 self-describe)     ─┘

T5 (a-B description heal) ── independent (mirrors rc.22 D2)

T6 (a-C1 4 fields) ←T2    (same api-contracts.ts file)

T7 (a-C2 enrich cmd) ←T6  (consumes new fields)

T8 (c cite sentinel) ←T1  (same AGENTS.md + bootstrap)

T9 (d non-blocking) ←T5   (shared reconcile path)

T10 (e serve lock) ── independent

T11 (release+review) ← T1..T10  (fork-join all impl)
```

## Provides For

- **Correctness**: Every fresh agent makes the right two-step API call (F1)
- **Latency**: MCP handshake under 100ms regardless of KB size (d)
- **KB quality**: No more `description: undefined` served to LLMs (a-B)
- **Triage richness**: LLM has intent_clues / tech_stack / impact / must_read_if for relevance ranking (a-C1)
- **Hygiene**: Backfill path for legacy entries (a-C2); stale lock cleanup (e); cite observability with sentinel breakdown (c)

## Notes / Discrepancies

- **AGENTS.md double-write**: TASK-001 + TASK-008 both edit `.fabric/AGENTS.md`. Sections are non-adjacent (## 行为规则 at L11 vs ## Cite policy at L23+) so merge is mechanical, but the task ordering must hold (T8 after T1).
- **api-contracts.ts churn**: TASK-002 + TASK-006 both edit `api-contracts.ts`. TASK-002 removes getKnowledge*+fab_get_rules and refines describe text; TASK-006 adds 4 optional fields to FabExtractKnowledge*Schema. Edits are non-overlapping but in the same file — T6 depends_on=[T2] forces clean serial commits.
- **reconcile path co-edit**: TASK-005 + TASK-009 share the reconcile/ensureKnowledgeFresh surface. T5 adds a new trigger; T9 reworks the surrounding async lifecycle. T9 depends_on=[T5] preserves causality.
- **Bootstrap template ↔ AGENTS.md drift**: After T1, the source template and project AGENTS.md must teach the same flow. Any future fab install regenerates AGENTS.md from the template, so an out-of-sync state will self-correct on next install — but for the rc.23 window, we hold both in sync manually.
- **Event ledger schema**: TASK-005 (a-B) and TASK-009 (d) both extend the event-ledger schema. T5 adds `auto-heal-description` trigger; T9 adds `reconcile_failed` + `meta_stale_at_handler` event types. They're additive and non-conflicting; ordering doesn't matter for the schema itself but the implementation tasks must still serialize on the shared reconcile code path.
- **No package version bump in T11**: The release-rc skill is the canonical surface for version bump + tag + push; T11 only handles MEMORY.md + release notes + Gemini review + cite-coverage snapshot. Run `release-rc` after T11 PASSes.

---

## Addendum — F8 系列 (2026-05-18 grill 中追加)

Wave 1-3 执行后,用户在 grill-me 中深挖 KB 结构,锁定 **3 个新 scope** 进 rc.23(F8a/F8b/F8c)。原 11 task 扩到 14 task。

### F8a (TASK-012) — fab scan baseline 整删

**Why**: 用户提问 "为啥 scan 会生成文档?预期文档应该使用 fabric import 产出"。
- 捕获会话 werewolf 的 plan_context 响应中,5 个 baseline entry(KT-MOD-0001/0002/0003 + KT-PRO-0001/0002)全部 `selectable:false, required:false` —— LLM 选择路径从不读它们
- 5 baseline 都是机械提取的元数据,AI 按需 1-2 个 Read 即可取得
- baseline 用 A 套 `## [BRACKET]` heading(rc.1 引入,早于 rc.7 B 套);删 scan 后 A 套写入端消失,统一 B 套(F8b 前提)
- KB 唯一合法源是 Skill 路径(archive/import/review)

**How**: 整删 scan.ts + 5 个已生成 .md + caller(install/doctor)+ 相关测试 + .scan-state.json + forensic.json scan 字段。**Pre-user clean-slate 不留兼容**。

### F8b (TASK-013) — sections enum 整删 + B 套统一 + 回潮 T1/T4/T8

**Why**: 用户追问 "当前 mcp tool 关于文档的结构已经不像之前 MANDATORY_INJECTION, CONTEXT_INFO 这种了"。
- 调查证实 A 套(scan.ts L1061-1068)与 B 套(extract-knowledge.ts L358-376 `## Summary / ## Why proposed / ## Session context / ## Evidence`)两套并存
- `KNOWLEDGE_SECTION_NAMES_TUPLE` 锁定 A 套 4 元 enum,但 Skill 产出 .md body 用 B 套 → `fab_get_knowledge_sections` 对 Skill 产出永远拿不到匹配 section
- 进一步发现 `sections` 输入参数 YAGNI:plan_context description 已是选择信号;fetch 拿完整 body 比 4-section 切片直观;output `rules[].sections: Record<string,string>` 简化为 `body: string`

**How**: 删 KNOWLEDGE_SECTION_NAMES_TUPLE + sections 输入 + 改 body 输出 + extractRuleSections 正则放宽 plain heading + 回潮 T1(bootstrap)/T4(F6 description)/T8(cite policy)中 sections 演示。

### F8c (TASK-014) — fabric-archive onboard phase + S5 slot 机制

**Why**: F8a 删 baseline 后 KB 全空,用户问 "这些画像有没有需要进入深入项目调研才知道的呢?这些是确定整体基调的东西"。
- 重新分层:**表层数据**(deps/树/README)AI 按需 Read 即可;**解读型基调**(Vue 2 Options 风格、monorepo workspaces 边界、TS strict 程度、Vite plugin 定制、限界上下文术语)需多文件交叉推理,有价值
- 解读型基调不能机械生成,必须 AI 真探索过才有信号
- 设计:archive Skill first-run phase coverage-based 自检 → 缺 slot 时提示用户让 AI tour propose

**S5 slot 列表**(grill 锁定): `tech-stack-decision / architecture-pattern / code-style-tone / build-system-idiom / domain-vocabulary`

**关键决定**:
- S5 而非 S3 (漏 build-idiom + domain-vocab) / S7 (testing/release 在很多项目 N/A,dismiss 噪声大)
- slot 不绑 type:onboard_slot 是正交标签,允许 user/AI 灵活分类
- onboard_slot 不进 idempotency_key(rc.8 A1 规则一致)
- dismiss 显式重置:`fab config onboard-reset <slot>` 才能重开

**How**: FabExtractKnowledge*Schema 加 onboard_slot enum optional 字段 + 新 `fab onboard-coverage --json` CLI + fabric-config 加 onboard_slots_opted_out 数组 + 新 `fab config onboard-reset <slot>` + fabric-archive SKILL.md PURPOSE 加 first-run phase + doctor 加 onboard advisory。

### 修订 Wave 计划

```
Wave 1 (✓ 完成 2026-05-18): T1+T2+T4+T5+T10 并行(5 agents)
Wave 2 (✓ 完成):           T3+T8+T9 并行(3 agents)
Wave 3 (✓ 完成):           T6 单飞
Wave 4 (← 当前):           TASK-012 (F8a) 单飞
Wave 5:                    TASK-007 (T7) + TASK-013 (F8b) 并行
Wave 6:                    TASK-014 (F8c) 单飞
Wave 7:                    TASK-011 (T11 release+review)
```

### 风险新增

- agents.meta.json 删 5 个 baseline node 后,reconcile auto-heal(T5)应自愈;若不能,F8a 手动编辑或 fab doctor --fix 重生
- F8b 回潮 T1/T4/T8 文案一次性完成,grep `sections:` / `sections=\[` 全仓零作为 convergence
- F8c onboard phase 大量靠 SKILL.md prompt 引导 LLM,不可单测;T11 dogfood 阶段 manual 验证 first-run flow

### 回归验证增强

- werewolf-minigame 老库:跑 fab doctor --fix → 触发 T5 auto-heal + T7 enrich-descriptions + F8c onboard advisory(应报 5 slot missing)
- 临时空目录 fab install → KB 完全空 + onboard-coverage missing=5
- pcf 本仓:F8a 删 baseline 后 onboard-coverage 应报 missing=5
