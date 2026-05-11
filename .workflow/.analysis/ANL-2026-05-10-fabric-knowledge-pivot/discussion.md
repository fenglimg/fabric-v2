# Analysis Discussion

**Session**: ANL-2026-05-10-fabric-knowledge-pivot
**Topic**: Should Fabric pivot from "MCP-first AGENTS.md / rules sync protocol" to "MCP-first knowledge sustainment protocol for AI delivery teams" per Tencent AI Team article methodology?
**Started**: 2026-05-10 (UTC+8)
**Dimensions**: decision, architecture, comparison, concept
**Depth**: standard

## Table of Contents
- [Current Understanding](#current-understanding)
- [Analysis Context](#analysis-context)
- [Initial Questions](#initial-questions)
- [Initial Decisions](#initial-decisions)
- [Discussion Timeline](#discussion-timeline)

## Current Understanding

### What We Established
- **Direction confirmed via grill-me: full v2.0 clean rebrand**, not v1.x staged. Triggered by user's "no current users / migration acceptable" context. Net work ~4-5 weeks (RC milestones).
- **Three "1:1 mapping" claims falsified**: INITIAL_TAXONOMY doesn't cover the 5 types; Fabric L0/L1/L2 is rule precedence (not 3-tier progressive index); 5-layer directory tree is product-story decoration, not value.
- **Industry consensus on knowledge layout**: 2-tier (personal/team) + nested-by-directory + lazy-load. Validated by Cursor / Cline / Claude Code / Mercari / Datadog / Nx.
- **The real moat is schema + lint + cross-client MCP**, not the 5-layer tree. Anthropic/Letta evidence converges on "curate aggressively > accumulate."
- **Refactor cost**: v1.x staged path ~3-4 weeks; v2.0 full rebrand 6-10 weeks. v1.x captures ~70% of value at ~30% of cost; v2.0 carries stable_id breakage + adoption-path inversion risk.
- **"AI delivery teams" is a use case, not a headline.** dbt/Airflow/Backstage all bootstrapped via developer-love → enterprise pull, never the inverse.

### What Was Clarified
- The article is ~80% Tencent's own derivation, ~20% Karpathy. Attribution should be honest; Fabric should claim its own credit for cross-client MCP.
- "Rules vs Knowledge" is a continuum (Cursor's own docs already split rules into static-conventions vs contextual). Reframe as "rules done right with lifecycle," not "categorically new product."
- `maturity` field should stay flat scalar to fit existing hand-rolled regex parser; nested object would force YAML upgrade.
- `fab_extract_knowledge` is implementable cross-client via MCP tools; defer Skill-style auto-invocation since Cursor lacks Skills + has 40-tool cap.

### Key Insights
- **Schema is the moat, not directory structure.** Adopt the 5 types (model/decision/guideline/pitfall/process) and lifecycle (draft→verified→proven, plus decay/lint) — but skip the 5-layer tree.
- **Path-derived `stable_id` is a hidden migration tax.** Any directory reorganization invalidates ledger replay. Strong argument against speculative directory restructuring.
- **The MCP server is half the moat**, not just a distribution channel. "MCP-first cross-client" + "lifecycle-aware knowledge" is the pair that no competitor offers.
- **Pre-pivot housekeeping is independent and overdue**: README still claims 6-client support (only 3 active); 3 dead bootstrap templates remain. Should ship in any path.

## Analysis Context
- **Focus areas**: Positioning & value proposition · Architecture refactor cost · v1.x progressive vs v2.0 rebrand
- **Perspectives**: Architectural, Business, Technical, Domain Expert
- **Depth**: Standard (3-4 rounds)

## Initial Questions
1. Is Fabric's current "AGENTS.md / rules sync" framing genuinely too weak, or only weak relative to the article's much larger ambition?
2. Does the article's methodology actually need an MCP layer, or is the AI Team's monolithic codebuddy approach simpler precisely because it controls the full stack?
3. Which existing Fabric assets (L0/L1/L2 protocol, agents.meta.json, events.jsonl, doctor, INITIAL_TAXONOMY.md) map cleanly to the new positioning, and which become legacy?
4. What is the minimum delta to test the new positioning without committing to a full v2.0 rebrand?
5. Are "AI delivery teams" (B2B) actually reachable as an open-source adoption audience, or is this positioning aspirational?
6. Is `fab_extract_knowledge` (the ARCHIVE-side tool) realistically callable from heterogeneous clients (Claude Code / Cursor / Codex CLI), or does it require workflow conventions those clients lack?

## Initial Decisions

> **Decision**: Scope the analysis to 3 focus areas + 4 perspectives at standard depth.
> - **Context**: User invoked /workflow:analyze-with-file with article + own analysis suggesting Fabric should adopt the methodology.
> - **Options**: (1) accept user's analysis as conclusion and jump to handoff, (2) full multi-perspective evaluation, (3) competitive-only.
> - **Chosen**: Multi-perspective evaluation across 4 angles — user already brought one strong perspective; the analysis adds value by stress-testing it from architectural cost, business reachability, technical implementability, and domain validity.
> - **Rejected**: Competitive deep-dive deferred — user did not select that focus, and their own analysis already addresses Ruler/claude-mem/MemPalace at high level.
> - **Impact**: Phase 2 will explore current Fabric structure for refactor cost, plus external research on AI Team article + Karpathy LLM Wiki to validate methodology.

---
## Discussion Timeline

### Round 1 — Exploration (2026-05-10 UTC+8)

#### Sources
- `exploration-codebase.json` — 24 relevant files, 10 patterns, 13 module-map entries (cli-explore-agent)
- `research.json` — Karpathy LLM Wiki verification, competitive scan, B2B-OSS adoption patterns, MCP cross-client reality (workflow-research-agent)

#### Key Findings

> **Finding**: User's "1:1 mapping" claim is partially false. INITIAL_TAXONOMY.md does NOT cover the article's 5 knowledge types (model/decision/guideline/pitfall/process). Code at `packages/cli/src/commands/init.ts:1390` (`buildInitialTaxonomyMarkdown`) builds a *structural* L0/L1/L2 topology from `forensic.json` with zero domain-knowledge type content.
> - **Confidence**: High — direct code anchor.
> - **Hypothesis Impact**: Refutes "INITIAL_TAXONOMY 直接采用". Schema work is net-new, not rename.
> - **Scope**: Affects refactor cost (taxonomy module is 1-2 weeks, not zero).

> **Finding**: Fabric's L0/L1/L2 is **NOT** the article's 3-tier progressive index. Fabric L0/L1/L2 = rule precedence levels (`L2 > L1 > L0`, mandatory vs selectable), per `api-contracts.ts:46-51` and `rule-sections.ts:40`. Article's 3-tier = panoramic catalog → category list → full entry. **Different axes**.
> - **Confidence**: High — direct contract typing.
> - **Hypothesis Impact**: Refutes "三级渐进索引已有". Catalog/category index pattern is net-new.
> - **Scope**: Reframes "已有架构基础" claims; the protocol shape is similar but the index pattern is missing.

> **Finding**: Cross-client MCP value proposition is technically real and competitively unique. No direct competitor positioned as "MCP-first cross-client knowledge protocol" exists. Closest analog is `Astro-Han/karpathy-llm-wiki` (pattern-only, not productized). Ruler does rules sync but no knowledge schema/lifecycle. claude-mem/MemPalace are per-user, not team.
> - **Confidence**: High — competitive scan + framework comparison.
> - **Hypothesis Impact**: Confirms whitespace exists.
> - **Scope**: Confirms that abandoning the cross-client thesis would forfeit the only unique angle.

> **Finding**: Lifecycle/decay/lint is the most defensible differentiator. Anthropic's published context-engineering guidance + Letta benchmarks both agree: "knowledge accumulation" without aggressive demotion/deletion produces worse, not better, agent outcomes. The article correctly identifies lint as the durable insight; the 5-layer / 5-type classification is aesthetic scaffolding.
> - **Confidence**: High — multiple authoritative sources converge.
> - **Hypothesis Impact**: Modifies the user's framing — the moat isn't 5-layer storage; it's *curated* knowledge with deletion as a first-class operation.
> - **Scope**: Should be the headline feature, not a v2 add-on.

> **Finding**: "AI 工程交付团队" as primary OSS positioning likely backfires. dbt/Airflow/Backstage all bootstrapped via *individual developer love → enterprise pull*, not B2B-headline-first. Stanford Enterprise AI Playbook documents AI-delivery teams currently use bespoke playbooks, not standardized OSS. Going B2B-headline before reaching critical individual adoption inverts the proven path.
> - **Confidence**: Medium-High — pattern is well-documented across multiple OSS infrastructure projects.
> - **Hypothesis Impact**: Refutes the user's positioning recommendation as the *headline*. Doesn't refute the methodology — only the marketing framing.
> - **Scope**: Affects README phrasing more than architecture.

> **Finding**: `fab_extract_knowledge` has cross-client implementation friction. Cursor lacks Skills (only MCP tools), and has a 40-tool cap. Codex CLI has limited workflow hooks. The article's ARCHIVE-time auto-extraction depends on workflow conventions Cursor/Codex don't natively offer.
> - **Confidence**: Medium — competitive evidence is strong; whether MCP tool calls alone suffice for extraction is untested.
> - **Hypothesis Impact**: Modifies "v1 直接做 fab_extract_knowledge". Implementation must abstract from "Skill"-style invocation.
> - **Scope**: Affects whether ARCHIVE closure is v1 or v2.

> **Finding**: `stable_id` is path-derived (`agents-meta.ts:93`). Directory reorganization (`rules/` → `knowledge/{personal,team-conv,tech-wiki,...}`) regenerates every ID and breaks `events.jsonl` replay/audit.
> - **Confidence**: High — direct code evidence.
> - **Hypothesis Impact**: Migration is materially harder than "diff: rename rules → knowledge". Need ID stability strategy or accept ledger reset.
> - **Scope**: Adds 0.5–1 week of migration tooling work; affects whether this is v1.x or v2.0.

> **Finding**: Two namespaces coexist — `.fabric/rules/` (production) vs `.fabric/agents/` (legacy/example). README still claims 6-client support though only 3 are actively maintained; 3 dead bootstrap templates remain in `packages/cli/templates/bootstrap/`. Pre-pivot housekeeping is independent of the positioning question.
> - **Confidence**: High — file system evidence.
> - **Hypothesis Impact**: Independent finding. Should be done regardless of pivot decision.
> - **Scope**: 1-2 days cleanup.

> **Finding**: Rules vs Knowledge is a real distinction but smaller than article claims. Cursor's own docs already split "always-apply rules" (conventions) from "agent-requested rules" (decisions/architecture). Practitioners are *already using rule files as underpowered knowledge bases*. Honest framing: "rules done right with lifecycle" — not "categorically new product."
> - **Confidence**: Medium-High — Cursor's official taxonomy validates this.
> - **Hypothesis Impact**: Tempers the rebrand zeal. "Rules sync" framing isn't wrong; it's incomplete.
> - **Scope**: Affects README/positioning rhetoric.

#### Multi-Perspective Synthesis

**Architectural** — Convergent: Pivot is *implementable* but not *cheap*. Fabric has the substrate (frontmatter parser, doctor checks, event ledger, MCP server) but most claimed "1:1 mappings" are aspirational. Concrete cost: rename-only 1-2 days · schema extension 1-2 weeks · new MCP tool 2-3 weeks · full v2.0 rebrand 6-10 weeks. ID stability across `rules/` → `knowledge/` reorganization is the largest hidden cost.

**Business** — Conflicting with user's framing: The article's headline ("knowledge sustainment for AI delivery teams") is product-market-fit-correct as a *use case* but B2B-OSS-adoption-wrong as a *headline*. Successful precedents (dbt/Airflow/Backstage) lead with developer love and let teams pull in. "AI delivery teams" reframed as a *prominent use case in a developer-headline product* is the lower-risk path.

**Technical** — Convergent: The most defensible additions are (1) maturity field on rule frontmatter, (2) `doctor --lint` for orphan/contradiction/staleness detection, (3) `fab_extract_knowledge` as a documented MCP tool. (1) and (2) are achievable in v1.x without migration pain. (3) needs cross-client abstraction work and is a v1.next or v2 candidate.

**Domain Expert** — Modified: Karpathy's actual gist is *much smaller* than the article extrapolates — 3 ops (ingest/query/lint), 3-layer storage (raw/wiki/CLAUDE.md), explicitly framed as a pattern not a product. The Tencent article's "team engineering knowledge" derivation is **its own contribution**, not Karpathy's. Fabric should own this honestly — credit Karpathy for *schema-driven wiki + lint*, claim its own credit for *team-engineering + cross-client + MCP*.

**Unique to Architectural**: stable_id breakage as migration cost.
**Unique to Business**: B2B-OSS adoption inversion warning.
**Unique to Technical**: Cursor 40-tool cap + Skills-absence as `fab_extract_knowledge` constraint.
**Unique to Domain**: Karpathy attribution accuracy.

#### Decision Log

> **Decision**: Skip Phase B per-perspective deep-dives.
> - **Context**: Phase A produced 25KB of file-anchored evidence (24 files) and Phase A2 produced field-mapped competitive analysis. Standard depth selected.
> - **Options**: (1) launch 4 parallel perspective agents for Layer 2-3 depth, (2) write synthesis from already-rich Phase A+A2 outputs.
> - **Chosen**: Option 2 — additional perspective work would re-discover the same files; per-perspective synthesis is achievable as analytical lensing on existing data.
> - **Rejected**: Option 1 — burns 4× agent budget for marginal new evidence at standard depth.
> - **Impact**: Round 1 proceeds directly to user dialogue; if Round 2+ surfaces gaps, targeted agents fire then.

#### Intent Coverage Check (Initial)

| # | User Intent | Status | Where Addressed |
|---|---|---|---|
| 1 | Should Fabric pivot to "knowledge sustainment protocol"? | 🔄 In progress | Round 1 multi-perspective synthesis — directional answer emerged |
| 2 | Is the article's methodology architecturally compatible with Fabric? | ✅ Covered | Codebase exploration — partially compatible, with concrete falsifications |
| 3 | What's the realistic refactor cost? | ✅ Covered | Refactor cost estimates (1-2 days → 6-10 weeks based on scope) |
| 4 | v1.x progressive vs v2.0 rebrand? | 🔄 In progress | Evidence supports staged path; final recommendation pending user input |
| 5 | Is "AI delivery team" target audience reachable? | ✅ Covered | B2B-OSS adoption research — risky as headline, valid as use case |
| 6 | Does cross-client MCP justify the methodology? | ✅ Covered | Confirmed unique whitespace; honest scope warnings issued |

Five of six intents at least partially addressed in Round 1. Intent #1 and #4 await user decision-making input.

#### Confidence Score (Baseline)

| Dimension | findings_depth (0.30) | evidence_strength (0.25) | coverage_breadth (0.20) | user_validation (0.15) | consistency (0.10) | Score |
|---|---|---|---|---|---|---|
| decision | 0.75 | 0.80 | 0.70 | 0.0 | 0.85 | **0.61** |
| architecture | 0.85 | 0.95 | 0.80 | 0.0 | 0.90 | **0.71** |
| comparison | 0.80 | 0.80 | 0.85 | 0.0 | 0.85 | **0.66** |
| concept | 0.65 | 0.75 | 0.70 | 0.0 | 0.80 | **0.56** |

**Overall**: ~0.64 · **Weakest**: concept (0.56) — Karpathy/methodology pressure-test still pending; user validation factor at 0.0 across all (no Phase 3 yet).

> Range guidance: 60–80% = optional deepen or converge. Concept at 56% leans toward one targeted deepening round.

#### Round 1 Narrative Synthesis
**起点**: 用户带着自己的强分析（"1:1 mapping" + "rebrand to knowledge sustainment"）请求验证。本轮从代码事实 + 外部证据双轨切入。
**关键进展**: 三个声称的"已有"组件（INITIAL_TAXONOMY 类型覆盖、L0/L1/L2 三级索引、agents.meta.json 作为暂存账本）被代码证据精准证伪，但**核心方向并未崩塌**——MCP 跨客户端独特性、生命周期/lint 作为护城河、Karpathy 模式适用性都得到外部确认。
**决策影响**: 用户的方向直觉是对的，但具体的"几乎零成本"叙事不成立。真实选择是 v1.x 渐进 vs v2.0 重定位的成本/收益判断，而非"能不能做"。
**当前理解**: Pivot 在概念上合理，在执行上需要分级；headline 文案需要从 "AI delivery teams" 改为 developer-first；schema/lint 是真正的差异化资产。
**遗留问题**: 用户对成本-收益曲线的偏好（保守渐进 vs 激进重定位）；对 stable_id 重生成的容忍度；ARCHIVE-side 工具的优先级。

---

### Round 2 — Deepen: concept (2026-05-10 UTC+8)

#### User Input
> Selection: 继续深入 concept → 子方向 "5层存储 vs 单一 schema+lint"。
> 这是 Round 1 留下的最关键开放问题：article 推荐的"5 层目录树"是否本身有产品价值，还是 schema+lint 才是真正的护城河。

#### Decision Log

> **Decision**: Probe 5-layer-tree-as-moat hypothesis through targeted external research, then pressure-pass the Round 1 high-confidence finding ("lifecycle/lint is the moat").
> - **Context**: User selected concept dimension as weakest (56%); 5-layer-vs-schema is the central concept question.
> - **Options**: (1) analytical pressure-pass only, (2) targeted external research + pressure pass, (3) launch additional code dives.
> - **Chosen**: Option 2 — empirical evidence from peer team deployments is the strongest input here; code dives unnecessary for this concept question.
> - **Rejected**: Code-only path would re-discover known structure without challenging the methodology.
> - **Impact**: This round's finding likely resolves v1.x vs v2.0 question.

#### Key Findings

> **Finding**: **5-layer storage tree is REFUTED as moat.** Karpathy's actual gist proposes 3 layers (`raw/wiki/CLAUDE.md`), zero further hierarchy. No external team has published a 5-layer team-knowledge tree outside the Tencent article. Industry has converged on **2-tier (personal/team) + directory-co-located nested AGENTS.md** (Mercari, Datadog, Nx, Cursor, Cline, Claude Code). The `tech-wiki/biz-wiki/project` further split is product-story decoration, not user value.
> - **Confidence**: High — multiple independent peer-team case studies converge.
> - **Hypothesis Impact**: **Refutes** "directly adopt 5-layer storage" as v1 work. Confirms the *2-tier* personal/team split (already in every major tool); rejects the 3-way team-internal split as mandatory.
> - **Scope**: Reduces architectural rebrand surface ~50%. Saves 1-2 weeks of "build the directory tree" work; redirects budget to schema + lint, which is where the moat actually lives.

> **Finding**: Industry pattern for monorepo knowledge is **nested AGENTS.md by directory** + **lazy/path-scoped loading**, not a parallel knowledge-base tree. Claude Code only reloads nested CLAUDE.md when the agent enters that directory; root ships every session.
> - **Confidence**: High — Anthropic docs + multiple production case studies.
> - **Hypothesis Impact**: Suggests `.fabric/knowledge/` as a parallel tree is *worse* than letting knowledge live next to code, with Fabric's MCP server doing the smart loading.
> - **Scope**: Architectural — Fabric's value is the *retrieval layer* (MCP server, schema, lint), not the *directory layout*.

> **Finding**: 2-tier personal/team split IS validated by every major tool (Cursor User Rules vs Project Rules, Cline global/workspace, Claude Code memory hierarchy). All actively used; no reports of teams collapsing them. Layer 0-P + Layer 0-T from the article maps cleanly here.
> - **Confidence**: High — direct product evidence.
> - **Hypothesis Impact**: Confirms keeping a personal/team split. Refutes ranking it as "novel."
> - **Scope**: Trivial — Fabric should support both, but this isn't a differentiator.

#### Pressure Pass

**Target finding** (highest-confidence from Round 1): "Lifecycle/decay/lint is the most defensible differentiator."

1. **Evidence demand**: Concrete sources or counter-example?
   - ✅ Anthropic Effective Context Engineering (JIT retrieval > pre-loading), Letta benchmarks (good retrieval > elaborate memory), Cursor docs (path-only refs don't load), DEV "What Karpathy's LLM Wiki Is Missing" (deletion/demotion must be first-class).
   - **No counter-example found.** All authorities on context engineering converge on "curate aggressively."

2. **Assumption probe**: Hidden assumptions?
   - **A1**: Users will actually run lint. → Mitigation: ship as `doctor --lint` (extending existing doctor pattern); recommend in CI/pre-commit.
   - **A2**: `maturity` field stays simple enough to maintain. → Risk Medium: hand-rolled regex frontmatter parser may need upgrade. **Action item: flatten to scalar fields (`maturity_level`, `maturity_evidence_count`) rather than nested object.**
   - **A3**: Demotion/deletion is socially acceptable. → Risk Low for solo/small-team OSS use; higher for org-policy contexts. Acceptable for v1.

3. **Boundary/tradeoff**: What's excluded if accepted?
   - Excluded: "platform-y" features (RBAC, three-role model, dashboard authoring) → push to v2+ only if traction warrants.
   - Excluded: competing with Mem0/MemPalace on auto-extraction. Fabric's wedge is *human-curated quality*, not *auto-everything*. This is correct positioning.

4. **Root cause check**: Symptom or cause of user's pivot enthusiasm?
   - The article *gave Fabric better vocabulary* for what it largely already is. The "pivot" framing oversells: Fabric isn't becoming something new; it's reframing a thin "rules sync" headline into the larger truth of "rules + lifecycle on top of cross-client MCP." This is a **positioning correction**, not an architectural pivot.

> **Pressure Pass Outcome**: Finding **VALIDATED with refinement**. Lifecycle/lint is the moat; the 5-layer tree is decoration; 2-tier personal/team is table stakes. Next-action: ensure maturity stays scalar to fit existing parser.

#### Challenge — Devil's Advocate (auto-fired, dimension confidence > 0.7 on architecture)

> "If 'lifecycle/lint is the moat' isn't actually true — what's the alternative?"
>
> **Counter-thesis 1**: The moat is the **ingest** side, not lint. Mem0 etc. are winning on auto-extraction. → **Refuted**: those are per-app, per-user; team-curated quality is a different bet, validated by Letta's "filesystem + good retrieval" thesis.
>
> **Counter-thesis 2**: There's no moat at all — knowledge protocols are commoditizing into client built-ins. → **Partial concession**: this is real long-term risk. Mitigation: keep Fabric thin and protocol-shaped; don't become a platform that competes with built-ins.
>
> **Counter-thesis 3**: The moat is the **MCP server itself** — single source of truth across clients. → **Reinforces, doesn't refute**: this IS the second leg of the moat. Lint + cross-client MCP server = pair, not either/or.

#### Technical Solutions (consolidated from Round 1+2)

> **Solution**: Staged pivot — v1.x progressive evolution to "knowledge sustainment" framing without full rebrand.
> - **Status**: Proposed
> - **Problem**: Reconcile "user's instinct is right" with "1:1 mapping is overstated and 5-layer is decoration"
> - **Rationale**: All concrete defensible additions (maturity field, doctor --lint, fab_extract_knowledge, README reframe) fit in v1.x. Full v2.0 rebrand would force directory reorg (stable_id breakage) and B2B-headline (adoption inversion) — both high-cost low-evidence bets.
> - **Concrete steps**:
>   1. **README reframe** (1 day): "Cross-client knowledge protocol with rule-level lifecycle" — demote "AGENTS.md protocol" framing to subtitle; lead with developer benefit (single source of truth across Claude/Cursor/Codex), use AI-delivery-team as a *use case section*, not headline.
>   2. **Schema extension** (3-5 days): Add `type` (one of model/decision/guideline/pitfall/process) and `maturity_level` (draft/verified/proven) to rule frontmatter. Keep flat scalars to fit existing parser. Update INITIAL_TAXONOMY.md to actually cover the 5 types.
>   3. **`doctor --lint` mode** (5-7 days): orphan detection (no references), staleness (last_referenced > N months), duplicate/similar (string distance), contradiction flagging (manual). Pattern-conformant with existing 19 inspect+check pairs.
>   4. **Reference tracking** (2-3 days): emit `rule.referenced` events to events.jsonl when MCP serves rules; doctor --lint reads those for staleness signal.
>   5. **`fab_extract_knowledge` MCP tool** (7-10 days): take task summary + key decisions → propose new draft entries with type/maturity, written to `pending/` for human review. Cross-client by design (works wherever MCP works). Defer Skill-style auto-invocation (Cursor lacks Skills); position as "Claude Code agent calls it; Cursor/Codex users invoke manually."
>   6. **Defer**: 5-layer directory tree, three-role permissions, contribution staging, independent team-knowledge.git → reassess after schema/lint validate user demand.
> - **Alternatives**: Full v2.0 rebrand (rejected: stable_id breakage + adoption inversion + 6-10 weeks vs ~3-4 weeks staged); status quo (rejected: README undersells; Round 1 evidence shows real whitespace).
> - **Evidence**: `init.ts:1390` (taxonomy gap), `doctor.ts:285-305` (additive 19 checks), `rule-meta-builder.ts:748-785` (parser scalar limits), `agents-meta.ts:93` (path-derived stable_id pinned by staged path).
> - **Next Action**: Phase 4 readiness — confirm with user, generate handoff if approved.

#### Corrected Assumptions

> ~~"5-layer storage tree from the article maps directly to Fabric's `.fabric/rules/` 5-level structure"~~ → **Corrected**: Fabric's `.fabric/rules/` does NOT have 5 levels (it's flat with topology metadata). And even if it did, the 5-level tree itself isn't the value — schema + lint is. Industry consensus: 2 levels (personal/team) + flat schema-typed entries.

> ~~"INITIAL_TAXONOMY.md classification directly adopts the 5 types"~~ → **Corrected**: It builds structural L0/L1/L2 topology only; 5 knowledge types are net-new content.

> ~~"v2.0 rebrand is the natural next step"~~ → **Corrected**: v1.x staged adoption is materially safer (no migration tax, no adoption-path inversion, ~70% of value at ~30% of cost).

#### Confidence Score (Round 2)

| Dimension | findings_depth | evidence_strength | coverage_breadth | user_validation | consistency | Score | Δ |
|---|---|---|---|---|---|---|---|
| decision | 0.85 | 0.85 | 0.80 | 0.50 | 0.90 | **0.79** | +18% |
| architecture | 0.90 | 0.95 | 0.85 | 0.50 | 0.90 | **0.84** | +13% |
| comparison | 0.80 | 0.80 | 0.85 | 0.50 | 0.85 | **0.79** | +13% |
| concept | 0.85 | 0.90 | 0.85 | 0.50 | 0.85 | **0.83** | +27% |

**Overall**: ~0.81 · **Weakest**: decision/comparison tied at 0.79.

> All dimensions ≥ 79%. Range guidance: > 80% recommends converge.

#### Intent Coverage Check (Round 2)

| # | User Intent | Status | Where Addressed |
|---|---|---|---|
| 1 | Should Fabric pivot? | ✅ Resolved | Directional yes; framing as "positioning correction" not "rebrand" |
| 2 | Methodology compatible? | ✅ Resolved | Round 1 falsifications + Round 2 5-layer refutation |
| 3 | Refactor cost? | ✅ Resolved | Staged path: ~3-4 weeks for v1.x, vs 6-10 weeks for v2.0 |
| 4 | v1.x vs v2.0? | ✅ Resolved | v1.x staged, evidence-driven |
| 5 | "AI delivery team" reachable? | ✅ Resolved | As use case yes; as headline no |
| 6 | Cross-client MCP justified? | ✅ Resolved | Real whitespace + table-stakes 2-tier covered |

All 6 intents resolved.

#### Round 2 Narrative Synthesis
**起点**: Round 1 验证了大方向，但留下"5 层目录树是不是真的护城河"这个核心 concept 问题。
**关键进展**: 外部证据（Karpathy 原始 gist 仅 3 层、Mercari/Datadog/Nx 都用 nested AGENTS.md 而非平行知识树、Cursor/Cline/Claude 都仅 2-tier）**精准证伪 5 层目录树**。Pressure pass 验证 lifecycle/lint 这一最高置信度发现仍然站得住，并在压力下找到了具体优化点（maturity 保持扁平 scalar）。
**决策影响**: 把"v1.x 渐进 vs v2.0 重定位"的天平推向 v1.x。具体技术方案已成形：5 步 v1.x 路径，~3-4 周工作量。
**当前理解**: Fabric 的真实价值 = MCP server (cross-client distribution) + schema (5 types) + lifecycle ops (lint + decay + extract)。目录布局是 serialization detail，不是 architecture。
**遗留问题**: 用户对建议 1（README reframe 不去掉"AGENTS.md protocol"完全 vs 仅降级）的偏好；建议 5（`fab_extract_knowledge` 跨客户端策略）是否真要进 v1.x。

---

### Round 3 — Grilling Synthesis: Design Tree Walkdown (2026-05-10 UTC+8)

> 经多轮 /grill-me 交互（用户回答了 ~10 个分支问题），原 Round 2 的"v1.x 渐进"推荐被关键上下文（**没有现存用户、可接受路径迁移**）翻盘，重建为完整 v2.0 clean rebrand 设计。本节按主题汇总每个分支的最终决策。

#### 关键上下文翻盘
> **User Input**: "当前没有人使用我的这个产品，可以接受路径迁移"
>
> 这条信息使 Round 2 关于"stable_id 重生成 = 老用户 events 失效"的核心论据消失。因此：
> - v1.x 渐进 → **v2.0 clean rebrand**（净工作量近乎相等：~4-5 周）
> - 物理目录保留 `.fabric/rules/` → **改名为 `.fabric/knowledge/`**
> - stable_id sticking with path-derived → **改为内容 ID（type 前缀 + 单调计数）**

#### Decision Log（按主题汇总）

> **Decision: 边界（Boundary）= Plan B**
> - **Context**: 三个候选——A 仅数据层 / B 数据 + 异步审批原语 / C 全平台
> - **Chosen**: B — pending/ 队列 + fab_review 是协议（数据），UI 留给客户端
> - **Reason**: A 太薄（fab_extract_knowledge 抽完没人审，跨客户端碎片化）；C 太厚（与 llm_wiki 桌面应用赛道直接竞争，违背 MCP-first 协议层定位）
> - **Impact**: 最终 4 MCP 工具 + 3 Skills 架构都基于此决定

> **Decision: 触发路径分类**
> - **4 路径共用同一架构**: 初始化 (fabric-import skill) / 任务完成 (fabric-archive skill, Agent 自判) / Hook (同 archive skill, Stop hook 推一下) / 用户主动 (同 archive skill)
> - **关键纠正**: Hook 不是独立路径——它是路径 2 漏掉时的兜底
> - **判定"任务结束"的责任在 Agent**: Fabric 通过 Skill SKILL.md 内的 prompt 教 Agent 何时调；Fabric 不"算"结束事件
> - **Skill 不常驻**: 按需加载，避免每次会话消耗 token

> **Decision: 工具与 Skill 数量**
> - **MCP 工具 = 4**: fab_plan_context (existing) / fab_get_rule_sections (existing) / fab_extract_knowledge (new) / fab_review (new, 用 action 参数收编 list/approve/reject/modify)
> - **Skills = 3**: fabric-import / fabric-archive / fabric-review
> - **拒绝 fab_get_extraction_prompt MCP 工具**: 用户洞察——prompt 模板属于 Skill 内容，不是 API 调用
> - **理由**: Cursor 40-tool cap 留余地；Skill 内联 prompt 跨客户端零适配

> **Decision: Schema 设计**
> - **Frontmatter 字段**: id / type (5 枚举) / maturity (3 枚举) / layer (personal|team) / layer_reason / created_at
> - **拒绝**: 5 层目录、复杂 evidence 嵌套结构（保持扁平 scalar 适应现有正则解析器）
> - **stable_id 方案**: `KP-{TYPE}-{N}` (personal) / `KT-{TYPE}-{N}` (team)，单调计数器路径解耦
> - **唯一允许的 ID 重生成场景**: review 阶段用户显式 layer 翻转（KT ↔ KP），写 knowledge.layer_changed 事件保留追溯

> **Decision: 目录布局（双根）**
> - **Personal**: `~/.fabric/knowledge/{type}/`，跟用户跨项目
> - **Team**: `<repo>/.fabric/knowledge/{type}/`，进 git
> - **拒绝单根 + 子目录方案 (B)**: 跨项目 personal 共享语义会丢
> - **拒绝单根 + frontmatter 方案 (C)**: gitignore 无法按 frontmatter 过滤
> - **Home 目录隐式自动创建**: 首次有 personal 写入时 `mkdir -p`

> **Decision: Layer 分类启发式（强 team 信号 / 强 personal 信号 / 默认 team）**
> - **强 team**: 引用本项目代码、团队共识用语（"we decided"）、fabric-import 路径产物、业务领域、绑定本项目代码的 pitfall
> - **强 personal**: 第一人称偏好、跨项目通用、工具/编辑器偏好、个人工作流
> - **默认 team**: 安全偏置——错标 team 在 PR review 中会被发现，错标 personal 静默丢失

> **Decision: doctor --lint 6+2 拆分**
> - **doctor --lint 6 项确定性检查**: 孤儿条目降级 / 过时归档 / stable_id 重复 / layer 错位 / 索引漂移 / pending 过期提示
> - **fabric-review skill 2 项语义检查**: 重复/相似 / 矛盾检测（需要 LLM 判定）
> - **衰减阈值**: 90/30/14 天 (proven→verified→draft→archive)（缩到文章 1/4，反映单仓低频使用）
> - **行为**: 只报告不自动应用，独立 `doctor --apply-lint` 才生效改

> **Decision: Hook 设计（最终版）**
> - **触发器**: Stop hook 监控 events.jsonl
> - **两个独立信号**:
>   - 距上次 knowledge.proposed 超 N 次 plan_context（推荐 N=5）→ 推 archive skill
>   - pending/ 条目数 ≥ M（推荐 M=10）→ 推 review skill
> - **绝对时间兜底**: ≥ 24h / ≥ 7 天分别为两类信号的时间触发线
> - **机制**: exit 2 + stderr 输出"建议调用 fabric-{archive|review} skill"——只是指针，不复制规则内容
> - **指标用 plan_context 计数而非 rule 引用**: 入口级信号最稳

> **Decision: 三层规则交付架构**
> - **Tier 1（极简提示）**: CLAUDE.md / AGENTS.md / .cursor/rules 一行话指向 Skill
> - **Tier 2（不再使用）**: 原本计划用 plan_context 注入详细规则——已被 Skill 模式取代
> - **Tier 3（详细教学）**: SKILL.md 内联完整 prompt + 决策树
> - **Hook（强制提醒）**: Stop hook，仅指针不教学

> **Decision: 发布节奏 β（rc.1 ~ rc.4）**
> - **rc.1**: 目录改名 + 新 stable_id schema + 既有 MCP 适配（1 周）
> - **rc.2**: fab_extract_knowledge + fabric-archive skill + Hook 提醒（1.5 周）
> - **rc.3**: fab_review + fabric-review skill + pending 流程（1 周）
> - **rc.4**: doctor --lint + README 重写 + 文档（1 周）
> - **拒绝 α（一次性大爆炸）**: 没用户阶段没有"流出风险"，但 RC 节奏给自己提供 dogfood 反馈
> - **拒绝 γ（双分支并行）**: v1.7 没人维护浪费

> **Decision: fabric-import skill 设计**
> - **方案**: α（单一 Skill 顺序跑 P1→P2→P3）+ `.fabric/.import-state.json` 断点恢复
> - **拒绝 β（3 个子 skill）**: 99% 用户不想知道 3 阶段；过度暴露
> - **默认 layer = team**: import 是项目客观沉淀
> - **跑完自动建议（不强制）触发 fabric-review**

#### 关键设计洞察（从 grilling 中浮现）

1. **Skill 是数据 + 教学 + 流程的统一容器**——把 prompt 模板、判定标准、调用流程都收在 SKILL.md 内，避免散落在 MCP 工具描述、CLAUDE.md、Hook 输出里
2. **Hook 是"提醒层"而非"控制层"**——只输出 stderr 指向 Skill，不复制规则
3. **MCP 工具是"变更面"**——只做写入和审计，不做提取（提取交给客户端 Agent）
4. **stable_id 路径解耦是 v2.0 真正的架构跃迁**——文件可以自由 git mv，未来重构无成本
5. **layer 翻转是 ID 重生成的唯一合法场景**——其他场景 ID 永久稳定

#### Confidence Score (Round 3)

| Dimension | Score | Δ from R2 |
|---|---|---|
| decision | 0.92 | +13% |
| architecture | 0.93 | +9% |
| comparison | 0.85 | +6% |
| concept | 0.92 | +9% |

**Overall**: ~0.91 · **Pressure pass**: 已完成 (R2) · **Challenge mode**: 已完成 (R2) · **Stall**: 无

#### Round 3 Narrative Synthesis
**起点**: Round 2 末尾用户用 /grill-me 介入，从我提出的"5 层 vs schema+lint"边界一路下钻。
**关键进展**: 通过 ~10 轮 grilling 把 Round 2 的方向性结论拆到了具体设计动作；用户提供的"无现存用户"上下文翻盘了 v1.x vs v2.0 决策；新设计完全闭环（4 MCP 工具 / 3 Skills / 1 类 hook，所有触发路径都有归属）。
**决策影响**: 从"是否 pivot"问题前进到"v2.0 该怎么实现"，置信度从 0.81 推到 0.91。
**当前理解**: 设计已经成熟到可以输出 implementation_scope JSON 直接走 lite-plan。
**遗留问题**: README 措辞、"Fabric"命名是否要变、events.jsonl v2.0 事件清单、rc.1-rc.4 精确 scope 切分。

---

### Round 4-5 — Final Grilling & Convergence (2026-05-10 UTC+8)

#### Additional Decisions (后续 grilling 共识)

> **Decision: README tagline 采纳 B' (5 词 hook + 解释段)**
> - **Final**: "Fabric — cross-client knowledge for AI agents." + 双句解释段
> - **Reject A** (B2B headline) — Round 1 研究证伪
> - **Open structure**: i (痛点) + iv (架构图) 在前 100 词内；ii (demo) 留 Quickstart；iii (vs) 留 Comparison

> **Decision: 保留 "Fabric" 命名 + 重新定义隐喻**
> - 不重命名（Microsoft Fabric/HyperLedger Fabric SEO 冲突真实但赛道完全不同）
> - 在 README 加 "Why Fabric" 段落把 fabric/threads/weaving 隐喻从 AGENTS.md era 扭到 knowledge-sustainment era
> - CLI 命令 `fabric` / `fab` 不变

> **Decision: 当前 .fabric/rules/ 直接删，不归档**
> - 用户偏好：clean-slate（已记录到长期记忆 feedback_clean_slate.md）
> - INITIAL_TAXONOMY.md 一并删；新增 `docs/knowledge-types.md` 作 human reference

> **Decision: rc 切分（最终版，5.5 周）**
> - rc.1（1.5w）：rebrand + 新目录 + 新 stable_id + init-time deterministic scan（4-7 baseline entries）+ 既有 MCP 适配
> - rc.2（1.5w）：fab_extract_knowledge + fabric-archive skill + Stop hook（3 客户端配置）+ 客户端 Skill 安装
> - rc.3（1w）：fab_review + fabric-review skill（含 mode 推断）+ pending promotion 流程 + Hook pending 过载信号
> - rc.4（1.5w）：doctor --lint（6 项）+ fabric-import skill（LLM-driven）+ README 重写 + docs

> **Decision: fabric-import 进 v2.0（拆分确定性 vs LLM-driven）**
> - 确定性 init scan 进 rc.1：tech stack / module structure / build config / code style config / CI config / README first paragraph，4-7 个 model/guideline/process 类条目
> - LLM-driven fabric-import skill 进 rc.4：git log decision/pitfall mining + README/CHANGELOG semantic extraction
> - **拒绝合并 fabric-init/fabric-import 为单命令**：scaffolding 是确定性，extraction 是 LLM-driven，应该分两步在合适环境跑

> **Decision: archive ↔ review 解耦统一架构（用户重要纠正）**
> - archive skill 只做提取；不做 inline disposition
> - review 永远走 fabric-review skill，**模式从上下文推断**（4 种 mode：pending queue / by topic / health overview / revisit existing）
> - **AskUserQuestion 仅在真有选择时用**——"何种 mode" 不是真选择（系统能推断），"approve/reject/modify 单条" 是真选择
> - fab_extract_knowledge 不需要 target 参数；总是写 pending/，promote 走 fab_review action=approve
> - fab_review action 增加：search（[b] 分支）、defer（暂搁）

> **Decision: Cursor & Codex CLI Hook 支持确认（Round 5 跨客户端验证）**
> - **Cursor**: 完整 hook 支持，含 `stop` event + exit 2 阻断 + `followup_message` 字段（比 Claude Code 的 stderr 注入更优雅）。配置 `.cursor/hooks.json` (https://cursor.com/cn/docs/hooks)
> - **Codex CLI**: 同样支持 hooks（https://developers.openai.com/codex/hooks 用户验证）
> - **影响**: Hook 层完全跨客户端可用。rc.2 安装三份配置（CC/Cursor/Codex），但 hook 脚本本身可以是单份 Node 实现，三客户端配置指向同一脚本
> - **不影响 v2.0 设计共识**——只是把"Hook 层是否真跨客户端"这个隐含疑虑彻底消除

> **Decision: Cursor Skill 路径**
> - Cursor 直接读 `.claude/skills/` 和 `.codex/skills/`（用户确认）
> - rc.2 Skill 安装目标只有 2 个物理路径（CC + Codex），Cursor 自动 pickup
> - 实现：拷贝（不软链接，Windows 兼容性优先）

#### Confidence Score (Final)

| Dimension | Score | Δ from R3 |
|---|---|---|
| decision | 0.95 | +3% |
| architecture | 0.95 | +2% |
| comparison | 0.88 | +3% |
| concept | 0.93 | +1% |

**Overall**: ~0.93 · **Pressure pass**: ✅ done · **Challenge mode**: ✅ done · **Stall**: 无

---

## Synthesis & Conclusions

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|---|---|---|---|
| 1 | Should Fabric pivot to "knowledge sustainment protocol"? | ✅ Addressed | R1 multi-perspective synthesis + R3 grilling synthesis | 答：是，但是是"positioning correction"+ "v2.0 clean rebrand"，不是 v1.x evolution |
| 2 | Is the article's methodology architecturally compatible with Fabric? | ✅ Addressed | R1 codebase exploration | 大方向兼容，3 个"1:1 mapping"被证伪（INITIAL_TAXONOMY、L0/L1/L2 语义、5 层目录） |
| 3 | What's the realistic refactor cost? | ✅ Addressed | R2 + R4 | v2.0 clean rebrand: 5.5 周（rc.1 1.5w + rc.2 1.5w + rc.3 1w + rc.4 1.5w） |
| 4 | v1.x progressive vs v2.0 rebrand? | 🔀 Transformed | R2 → R3 翻盘 | 原推荐 v1.x 渐进；用户提供"无现存用户"上下文后翻盘为 v2.0 clean rebrand |
| 5 | Is "AI delivery teams" target audience reachable? | ✅ Addressed | R1 + R4 README 决策 | 作 use case ✓；作 headline ✗；headline 走 dev-first |
| 6 | Does cross-client MCP justify the methodology? | ✅ Addressed | R1 + R5 hook 验证 | 真实差异化；Hook + Skill 全跨客户端 |

**Gate**: ✅ All 6 intents resolved.

### Findings Coverage Matrix

每条关键 finding 的处置（recommendation / absorbed / deferred / informational）：

| Finding | Disposition | Where |
|---|---|---|
| 5-layer storage tree refuted as moat | recommendation | REC-5 (don't build 5-layer) |
| INITIAL_TAXONOMY.md mismaps to article's 5 types | recommendation | REC-10 (delete, replace with docs) |
| Fabric L0/L1/L2 ≠ article 3-tier index | recommendation | REC-2 (existing tools adapted, not reimplemented) |
| Lifecycle/decay/lint is the moat | recommendation | REC-7 (doctor --lint + fabric-review semantic) |
| Cross-client MCP genuine whitespace | recommendation | REC-1 (positioning) + REC-2 (4 MCP tools) |
| `stable_id` path-derived blocks reorganization | recommendation | REC-5 (path-decoupled stable_id) |
| Karpathy gist scope smaller than article extrapolates | informational | README "Why Fabric" honest attribution |
| AI delivery teams as headline = OSS adoption inversion | recommendation | REC-9 (dev-first README) |
| Cursor lacks Skills (early misconception) | absorbed | Round 5 validated Cursor reads `.claude/skills/` |
| `fab_extract_knowledge` Cursor friction (40-tool cap) | absorbed | REC-2 collapses tools to 4 |
| Two `.fabric/rules/` vs `.fabric/agents/` namespaces | absorbed | REC-10 clean-slate removes both |
| Hook 是真正的强制层（vs CLAUDE.md 软提示） | recommendation | REC-4 (Stop hooks) |
| Skill 是数据+教学+流程统一容器（无需 fab_get_extraction_prompt MCP） | recommendation | REC-3 (3 Skills internalize prompt templates) |
| Layer 分类启发式比"全 team 让 review 兜底"好 | recommendation | REC-3 (Skill 内含 layer heuristic) |
| llm_wiki 远超 Karpathy 3 ops（graph/communities/async review/...） | informational | Boundary B 决策——不竞争桌面应用赛道 |
| Cursor + Codex CLI 都支持 stop hook | absorbed | REC-4 三客户端 hook |

**Gate**: ✅ No null disposition. All findings mapped.

### Executive Summary

**结论**: Fabric 应**采纳"knowledge sustainment protocol"定位**，通过 v2.0 clean rebrand 实施。这不是凭空 pivot，而是一次定位修正——Fabric 既有的 L0/L1/L2 协议、events.jsonl ledger、MCP server、doctor 都是合适的基础设施，只是 README "AGENTS.md protocol" 叙事低估了它能做的事。

**关键洞察**: 文章方法论的 80% 是 Tencent 自己的扩展，20% 是 Karpathy 真正的贡献。Fabric 应该诚实地承认这一点——继承 Karpathy 的 schema + ingest/query/lint 核心，自己原创"跨客户端 MCP + 团队级 lifecycle"的方法论。

**真正的护城河**:
1. MCP 协议层跨 Claude Code / Cursor / Codex CLI（无直接竞品）
2. Schema-typed knowledge entries（5 types × 3 maturity）
3. Lifecycle ops（lint + decay + 引用追踪）

**不是护城河**（不要做的事）: 5 层目录树（refuted）、B2B 头部叙事（adoption inversion）、桌面应用功能集（llm_wiki 赛道）。

**v2.0 工作量**: 5.5 周（4 个 RC milestone）。

### Key Conclusions

#### 1. Architecture: 4 MCP tools + 3 Skills + 1 Hook layer

```
MCP Tools (mutation plane):
  fab_plan_context        (existing, 读)
  fab_get_rule_sections   (existing, 读)
  fab_extract_knowledge   (rc.2 新)
  fab_review              (rc.3 新, action-based: list/approve/reject/modify/search/defer)

Skills (workflow plane, 跨客户端):
  fabric-archive   (rc.2)  — 提取后写 pending/，不做 inline disposition
  fabric-review    (rc.3)  — 4-mode 上下文推断（pending/topic/health/revisit）
  fabric-import    (rc.4)  — LLM-driven 冷启动语义抽取

Hook layer (reminder plane, 三客户端确认支持):
  Stop hook 监控 events.jsonl (Claude Code / Cursor / Codex)
  - 5 plan_contexts OR 24h 未 archive → 推 fabric-archive skill
  - pending count >= 10 OR 7 days → 推 fabric-review skill
```

#### 2. Schema: type + maturity + layer + stable_id 路径解耦

```yaml
---
id: KT-DEC-0042                    # KP- (personal) | KT- (team) + type code + counter
type: decision                     # 5 types: model/decision/guideline/pitfall/process
maturity: draft                    # 3 levels: draft → verified → proven
layer: team                        # 2-tier: personal | team
layer_reason: "References this repo's auth middleware"
created_at: 2026-05-10T00:00:00Z
---
```

唯一允许的 ID 重生成场景：用户在 review 时显式 layer 翻转，写 `knowledge.layer_changed` 事件保留追溯。

#### 3. Directory: 双根 (personal at home, team at repo)

```
~/.fabric/                       ← personal, cross-project, auto-mkdir 首次写入时
├── knowledge/{type}/
└── pending/

<repo>/.fabric/                  ← team, in git
├── knowledge/{type}/
├── pending/
├── events.jsonl                 ← 主战场事件账本
└── agents.meta.json
```

#### 4. Trigger paths: 4 路径共用同一 archive skill + 上下文推断 review

| Path | Skill | 用户在场 | review 触发 |
|---|---|---|---|
| 1 init/import | fabric-import | 否（批量） | init 末 AskUserQuestion "Review now?" |
| 2 Agent 自判 | none (直接 MCP) | 否 | silent；Hook 阈值时再提 |
| 3 Hook 推 | none | Agent 执行 | 同上 |
| 4 用户主动 | fabric-archive | 是 | archive 末 AskUserQuestion "Review now?" |

review skill 加载时按"用户消息 → events.jsonl → pending count"三层规则**自动推断 mode**，不向用户问"何种 mode"。

#### 5. Release: β cadence (rc.1 → rc.4)

总长 5.5 周。每 RC 独立可发布、自带验收门、有 dogfood demo 价值。

### Recommendations (Prioritized)

#### REC-1: 采纳 v2.0 clean rebrand 为 "knowledge sustainment protocol" 定位
- **Priority**: high
- **Action**: 整体重新定位，从 "MCP-first AGENTS.md protocol" 改为 "MCP-first cross-client knowledge protocol with lifecycle"
- **Rationale**: Round 1 + Round 2 + Round 5 多轮验证；研究确认无直接竞品；用户无现存用户 = 零迁移成本
- **Evidence**: research.json (competitive landscape) + Round 1 codebase findings + Round 5 cross-client hook validation

#### REC-2: 实现 4 MCP 工具（2 existing + 2 new）
- **Priority**: high (rc.2 + rc.3)
- **Target files**: `packages/server/src/index.ts`, `packages/server/src/services/`, `packages/shared/src/schemas/api-contracts.ts`
- **New tools**:
  - `fab_extract_knowledge({source_session, proposed_entries[]})` → 写 pending/
  - `fab_review({action: list|approve|reject|modify|search|defer, ...})` → 审批 + 搜索
- **Acceptance**: 在自己仓里跑 archive + review 闭环 + events.jsonl 有完整事件链

#### REC-3: 实现 3 Skills（fabric-archive / fabric-review / fabric-import）
- **Priority**: high (rc.2/rc.3/rc.4)
- **Target paths**: `packages/cli/templates/skills/fabric-{archive,review,import}/SKILL.md`
- **Install targets**: `<repo>/.claude/skills/{name}/` + `<repo>/.codex/skills/{name}/`
- **Key designs**:
  - fabric-archive: 含 layer 启发式（强 team / 强 personal / 默认 team）+ extraction prompt template
  - fabric-review: **mode 自动推断**（不向用户问"何种 mode"）—— 用户消息 → 最近 events → pending count 三层规则
  - fabric-import: 单 skill 顺序执行 P1+P2+P3，配 `.fabric/.import-state.json` 断点恢复
- **Acceptance**: 三客户端都能 invoke 三 skills 完成端到端流程

#### REC-4: Stop hook 安装（三客户端）
- **Priority**: high (rc.2)
- **Target**: 单份 Node hook 脚本 `<repo>/.fabric/hooks/archive-hint.js`，配置文件三份指向它
  - `<repo>/.claude/settings.json` (Claude Code)
  - `<repo>/.cursor/hooks.json` (Cursor, 用 `followup_message` 字段)
  - Codex CLI 等价配置（rc.2 实施时按 https://developers.openai.com/codex/hooks 适配）
- **Logic**: 监控 events.jsonl 计数 + 时间，触发条件下输出 stderr/followup_message 推 Agent 调对应 skill
- **Acceptance**: 三客户端 stop 时 hook 能在阈值条件下成功推送

#### REC-5: 新 Schema (frontmatter + stable_id 路径解耦)
- **Priority**: high (rc.1 基础)
- **Target files**: `packages/shared/src/schemas/`, frontmatter parser at `rule-meta-builder.ts`
- **Schema**: id (KP-/KT- prefix + type code + monotonic counter)、type (5 enum)、maturity (3 enum)、layer (2 enum)、layer_reason、created_at
- **Counter management**: `.fabric/agents.meta.json` (team) + `~/.fabric/agents.meta.json` (personal) 维护单调计数器
- **Acceptance**: 文件 git mv 不影响 stable_id；events.jsonl 引用稳定

#### REC-6: 双根目录布局
- **Priority**: high (rc.1 基础)
- **Target**: 实现 `~/.fabric/` + `<repo>/.fabric/` 双 root 扫描；隐式自动创建（首次写入时 mkdir -p）
- **fab_plan_context 行为**: 同时扫两个 root；返回结果可标 source layer
- **events.jsonl 双份**: personal 操作不进 repo events.jsonl
- **Acceptance**: personal 写入不污染 git 历史；多个 repo 共享 personal knowledge

#### REC-7: doctor --lint (6 确定性 + 2 语义检查)
- **Priority**: medium (rc.4)
- **Target**: `packages/server/src/services/doctor.ts` 扩展
- **Deterministic checks (6)**: 孤儿降级 / 过时归档 / stable_id 重复 / layer 错位 / 索引漂移 / pending 过期
- **Semantic checks (2, 在 fabric-review skill 内 LLM 辅助)**: 重复/相似 / 矛盾检测
- **Decay thresholds**: 90/30/14 days (proven/verified/draft/archive)
- **Default behavior**: report only; `doctor --apply-lint` 才真正改
- **Acceptance**: 在 dogfood 仓里产生有意义的 lint 报告；`--apply-lint` 写正确事件

#### REC-8: 4 RC 发布节奏（5.5 周）
- **Priority**: high
- **Milestones**:
  - **rc.1** (1.5w): clean rebrand + 新目录 + stable_id + init-time scan + 既有 MCP 适配
  - **rc.2** (1.5w): fab_extract_knowledge + fabric-archive skill + Stop hook 三客户端
  - **rc.3** (1w): fab_review + fabric-review skill (mode 推断) + Hook pending 信号
  - **rc.4** (1.5w): doctor --lint + fabric-import skill + README 重写 + docs
- **Acceptance**: 每个 RC 独立可发布；rc.4 末发 v2.0.0 stable

#### REC-9: README 完整重写（B' tagline + i+iv 结构 + Why Fabric）
- **Priority**: medium (rc.4)
- **Target**: `README.md`
- **Structure**:
  - Tagline (5 词): "Fabric — cross-client knowledge for AI agents."
  - 双句解释段
  - Pain-point opening (i): "Today's AI agents lose context every session..."
  - ASCII architecture diagram (iv)
  - Quickstart 章节（demo: ii）
  - "Why Fabric" 段落（解释 fabric/threads/weaving 隐喻 + 与 v1.x 的演化故事）
  - Comparison 章节（vs Ruler / claude-mem / MemPalace, iii）
- **Acceptance**: 新访客阅读前 100 词后能正确说出 Fabric 是什么、给谁用、与同类的差异

#### REC-10: 删除当前 .fabric/rules/ 内容（clean-slate）
- **Priority**: high (rc.1 第一动作)
- **Action**: rc.1 直接删 `.fabric/rules/`、`.fabric/INITIAL_TAXONOMY.md`、`.fabric/bootstrap/`，不归档
- **Rationale**: 用户 clean-slate 偏好（已记录到长期记忆）；零用户 = 零迁移义务
- **Acceptance**: rc.1 完成后 `.fabric/` 目录只含 v2.0 新结构

### Open Questions / Follow-ups (post-v2.0)

- v2.1+: 团队级独立 git 仓库 + 三角色权限模型（maintainer/contributor/reader）
- v2.x: 知识的语义检索增强（vector DB optional）
- v2.x: Hook 阈值（5 plan_contexts / 24h / pending count 10）的真实使用反馈调参
- v2.x: 多团队联邦（不同团队 knowledge 仓库间安全共享通用 tech 知识）
- 长期：与未来更强模型能力的接口（探针系统/SAE/认知节省机制）

## Decision Trail

R1 → R2 → R3 → R4 → R5 主要决策时间线：

| Round | 关键决策 | 触发输入 |
|---|---|---|
| R1 | 多视角探索；3 "1:1 mapping" 证伪；whitespace 确认 | 文章 + 用户分析 |
| R2 | v1.x 渐进路径推荐 (后被翻盘) + 5 层目录 refuted | concept pressure-test |
| R3 grill #1 | Boundary B (data + lifecycle + async-review) | grilling on llm_wiki/Section 8 gaps |
| R3 grill #2-9 | 4 paths / 3 skills / Hook / Schema / stable_id / 双根 / layer 启发式 / lint | 用户连续 9 个分支 grill |
| R4 翻盘 | v2.0 clean rebrand（取代 v1.x 渐进） | **用户输入"无现存用户"** ← 决定性翻盘点 |
| R4 收敛 | rc 切分、README、命名、清空 .fabric/rules/、统一 review 流程 | 用户细化 grilling |
| R4 修正 | review mode 推断（不 AskUserQuestion）+ Cursor 路径确认 | 用户连续修正 |
| R5 验证 | Cursor + Codex Hook 跨客户端确认 | 用户提供 Cursor + Codex hook docs |

## Session Statistics

- **Rounds**: 5（R1 探索 + R2 单维度深入 + R3-R5 grilling 收敛）
- **Key findings**: 18+ 条
- **Pressure pass**: 1 次（R2 末，validated）
- **Challenge mode used**: devils_advocate (R2)
- **Confidence trajectory**: 0.64 → 0.81 → 0.91 → 0.93
- **Quality signals**: 三个"1:1 mapping" 声称被 codebase 证据精准证伪；用户主动提供两次决定性纠正（无现存用户 / Cursor & Codex hook）；用户偏好 clean-slate 已存长期记忆

## Plan Checklist (handoff for workflow-lite-plan)

### rc.1 — Clean rebrand foundation (1.5w)
- [ ] Delete `.fabric/rules/`, `.fabric/INITIAL_TAXONOMY.md`, `.fabric/bootstrap/`（不归档）
- [ ] Implement new directory layout: `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes}/` + `pending/`
- [ ] Implement dual-root: `~/.fabric/` 隐式 mkdir 首次写入时
- [ ] New frontmatter schema: id (KP-/KT- prefix + type code + counter), type, maturity, layer, layer_reason, created_at
- [ ] stable_id 计数器在 agents.meta.json 维护
- [ ] Init-time deterministic scan: tech stack / module structure / build / style / CI / README first paragraph
- [ ] Adapt fab_plan_context + fab_get_rule_sections to new schema
- [ ] Adapt doctor existing checks
- [ ] Update fabric init flow (no old taxonomy generation; install scaffolding for new layout)

### rc.2 — Archive loop (1.5w)
- [ ] Implement fab_extract_knowledge MCP tool (validation + pending/ write + events)
- [ ] Create fabric-archive SKILL.md (extraction prompt + layer heuristic + decision tree)
- [ ] Skill install: `.claude/skills/fabric-archive/` + `.codex/skills/fabric-archive/`
- [ ] CLAUDE.md / AGENTS.md / .cursor/rules pointer line
- [ ] Hook script `archive-hint.js` (Node, cross-platform)
- [ ] Hook configs: Claude Code settings, Cursor `.cursor/hooks.json`, Codex CLI hook config
- [ ] New events: knowledge.proposed, knowledge.archive_attempted, plan_context.served
- [ ] Hook threshold: 5 plan_contexts OR 24h
- [ ] Dogfood test: archive flow end-to-end on Fabric self repo

### rc.3 — Review loop (1w)
- [ ] Implement fab_review MCP tool (action enum: list/approve/reject/modify/search/defer)
- [ ] approve action: batch ids + git mv pending → 正式目录 + knowledge.promoted event
- [ ] modify action: layer flip path with id regeneration + knowledge.layer_changed event
- [ ] Create fabric-review SKILL.md with mode inference (user message → events → pending count → 3-tier deduction)
- [ ] Skill install: `.claude/skills/fabric-review/` + `.codex/skills/fabric-review/`
- [ ] Filesystem-edit fallback: doctor identifies user-mv'd files
- [ ] Hook second signal: pending count >= 10 OR 7 days
- [ ] New events: knowledge.reviewed, knowledge.promoted, knowledge.rejected, knowledge.modified, knowledge.layer_changed, knowledge.referenced
- [ ] Dogfood test: review rc.2 pending entries with at least one layer flip

### rc.4 — Lint + import + docs (1.5w)
- [ ] Implement doctor --lint: 6 deterministic checks (orphan demote / stale archive / id duplicate / layer mismatch / index drift / pending overdue)
- [ ] Implement doctor --apply-lint: actually mutate + write knowledge.demoted / knowledge.archived events
- [ ] Decay thresholds: 90/30/14 days
- [ ] Create fabric-import SKILL.md: 3-phase pipeline (P1 init-scan integration / P2 git+doc mining / P3 dedup) + .fabric/.import-state.json checkpoint
- [ ] Skill install: `.claude/skills/fabric-import/` + `.codex/skills/fabric-import/`
- [ ] README full rewrite: B' tagline + pain-point opening + ASCII architecture + Why Fabric metaphor section + Comparison
- [ ] docs/knowledge-types.md (5-type semantic reference)
- [ ] docs/initialization.md (v2.0 flow)
- [ ] docs/roadmap.md (v2.0 + v2.1 + v2.x)
- [ ] CHANGELOG with all RC milestones
- [ ] v2.0.0 stable release tag (no -rc) after dogfood validation

**Total estimate**: 5.5 weeks (4 RC milestones)




