# Skill Architecture Absorption Analysis

> 日期：2026-07-08  
> 范围：`Ronifue/skill-authoring`、`WoJiSama/skill-based-architecture`、当前 Fabric v2 架构  
> 结论类型：架构调研与吸收建议，不是实现方案。

## Executive Summary

`skill-authoring` 和 `skill-based-architecture` 都和 Fabric 很像，但解决的问题层级不同。

- `skill-authoring` 是 **单个 Skill 的质量方法论**：description 怎么触发、正文怎么做 router、什么时候拆 references/scripts、怎么做 anti-drift。
- `skill-based-architecture` 是 **项目规则系统的工程化框架**：把散落在 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/`、README 里的规则，迁成 `skills/<name>/` 下可路由、可验证、可维护的知识资产。
- Fabric 是 **store-backed knowledge lifecycle 系统**：知识 source of truth 在 mounted stores，AI 通过 Hook/Skill/MCP/CLI 形成归档、召回、审核、同步闭环。

因此，Fabric 不应照搬 `skill-based-architecture` 的目录体系。真正值得吸收的是它的“知识激活”“可达性”“质量门”“渐进复杂度”思想，并把这些思想映射到 Fabric 已有的 `doctor`、`fabric-review`、Skill 模板 lint、store-backed KB lifecycle 上。

## Evidence Base

本次分析参考：

- `/tmp/skill-authoring/SKILL.md`
- `/tmp/skill-based-architecture/SKILL.md`
- `/tmp/skill-based-architecture/README.zh-CN.md`
- `/tmp/skill-based-architecture/WORKFLOW.md`
- `/tmp/skill-based-architecture/templates/skill/routing.yaml`
- `/tmp/skill-based-architecture/templates/skill/conformance.yaml`
- `/tmp/skill-based-architecture/scripts/README.md`
- `/tmp/skill-based-architecture/references/*.md`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME-CONTRACTS.md`
- `packages/cli/src/install/skills-and-hooks.ts`
- `packages/server/src/services/doctor-skill-lints.ts`
- `packages/cli/templates/skills/{fabric-archive,fabric-review,fabric-store,fabric-sync}/SKILL.md`
- `packages/server/src/tools/{recall,extract-knowledge,review}.ts`

另参考 Fabric KB：

- `KT-DEC-0001`：Fabric v2 边界是 data + lifecycle + async-review primitive。
- `KT-DEC-0042`：历史上已裁决过 skill router 取舍，不能轻易回到单入口 router。
- `KT-DEC-0043`：`fabric-store` / `fabric-sync` 保留为 thin shim，护栏归位到 CLI。
- `KT-PIT-0004`：多份 skill 镜像手编会无声漂移。

## What Skill-Based-Architecture Actually Is

`skill-based-architecture` 不是一个“知识库产品”，而是一个 **AI Agent 规则系统的生命周期管理框架**。它把规则从散落文本变成具备以下属性的工程资产：

- 可触发：description 用真实用户语言描述触发条件。
- 可路由：`routing.yaml` 是任务路由 source of truth。
- 可加载：`SKILL.md` 只做导航，长内容按任务延迟加载。
- 可验证：`smoke-test.sh`、`sync-routing.sh --check`、`route-reachability.sh`、`audit-orphans.sh` 等检查结构和漂移。
- 可维护：通过 progressive rigor、line budget、upstream sync、conformance manifest 控制增长。
- 可抗压缩：thin shell + routing bootstrap + 可选 SessionStart hook，降低 `/compact` 后规则丢失风险。

### Knowledge Architecture Layers

```text
User intent
  ↓
Harness entry shells
  AGENTS.md / CLAUDE.md / CODEX.md / GEMINI.md / .cursor/rules
  - 只保留 bootstrap，不复制规则正文
  - 指向 skills/<name>/SKILL.md 和 routing.yaml
  ↓
SKILL.md
  - description = coarse activation
  - body = router, not encyclopedia
  - Always Read + Common Tasks
  ↓
routing.yaml
  - Always Read
  - task routes
  - trigger_examples
  - required_reads
  - workflow
  ↓
Content tiers
  architecture/   抽象设计原则，骨架
  workflows/      操作流程，骨架
  rules/          稳定约束
  conventions/    项目风格
  gotchas/        代码耦合坑点
  references/     模块图、背景、索引，肉
  ↓
Validation scripts
  sync-routing.sh
  smoke-test.sh
  route-reachability.sh
  audit-orphans.sh
  check-version-conformance.sh
  check-cross-references.sh
  ↓
Task closure / AAR / update-rules
  - 从真实任务中抽取经验
  - 判断是否满足记录阈值
  - 写回可激活路径
```

### 核心设计模型

SBA 的知识模型可以概括为：

```text
规则不是“存下来”就结束，而是要进入任务执行路径。

Stored knowledge
  → Routed knowledge
  → Read knowledge
  → Action-changing knowledge
  → Validated knowledge
  → Maintained knowledge
```

这和 Fabric 的核心问题高度相似。Fabric 也不是把 markdown 存进 store 就结束，而是要让知识能被 SessionStart / PreToolUse / `fab_recall` / native Read / cite / review lifecycle 激活。

### 它的强点

1. **Activation over storage**

SBA 明确指出：内容在 `references/` 里不等于被捕获。它必须位于任务路径上，并改变 Agent 下一步行为。这个判断比普通 orphan/link check 更深，因为“可达但惰性”的内容结构上没坏，但行为上没用。

2. **Routing source of truth**

`routing.yaml` 管 `Always Read`、任务路由、触发样例、required reads、workflow；`SKILL.md` 和 thin shells 是生成或派生内容。这解决的是多入口规则漂移。

3. **Progressive Rigor**

它不是默认上重架构，而是有升级压力：行数、重复坑点、规则/流程混杂、多 harness、跨 session lessons。这个很重要，避免“为了像系统而系统”。

4. **Drift dimensions matrix**

`scripts/README.md` 不只列脚本，还明确每个脚本回答什么问题：

- route 是否和 `routing.yaml` 同步；
- shell 是否漂移；
- description 是否过宽或 keyword stuffing；
- content 是否 orphan；
- content 是否 link-reachable 但不在任务路由上；
- downstream 是否漏复制 mandatory section。

这类矩阵比单个 smoke test 更有价值。

5. **Upstream / downstream 模板同步**

SBA 把自身当 upstream，目标项目是 downstream。`conformance.yaml` 声明必须随升级传播的内容，`UPSTREAM-CHANGES` 记录下游影响。这对模板类项目很有启发。

## Fabric Architecture Contrast

Fabric 的主架构不是 `skills/<project>` 文档体系，而是：

```text
CLI
  install / doctor / store / sync / info / audit
  - 确定性 I/O
  - 安装 hooks / skills / MCP config
  - store 路由与安全门

Skill
  fabric-archive / fabric-review / fabric-store / fabric-sync
  - LLM 判断
  - 人类 review 交互
  - 归档/审核/退役/关联

MCP
  fab_recall / fab_propose / fab_pending / fab_archive_scan / fab_review
  - store-backed knowledge primitive
  - schema / idempotency / atomic write

Store
  ~/.fabric/stores/<uuid>/knowledge/**
  - canonical source of truth
  - pending review-only
  - semantic_scope + relevance_scope + visibility_store

Hooks
  SessionStart / PreToolUse / PostToolUse / Stop
  - broad/narrow hints
  - mutation and body-read observability
  - archive/review nudges
```

关键差异：

| 维度 | SBA | Fabric |
|---|---|---|
| 知识真源 | 项目内 `skills/<name>/` 文档树 | mounted store 的 `knowledge/` tree |
| 路由真源 | `routing.yaml` | scope/index/hooks/MCP + skill descriptions |
| 写入路径 | agent 编辑项目 skill docs | `fab_propose` / `fab_review` 写 store |
| 维护方式 | smoke-test + routing sync + conformance | doctor + install parity + schema + store review |
| 目标 | 治理散落项目规则 | 治理跨 client、跨 repo、跨 session 的知识生命周期 |
| 风险中心 | 文档漂移、规则没加载 | 错 scope、错 store、pending 堆积、summary 不自足、召回失效 |

所以，SBA 的目录和脚本不能直接成为 Fabric runtime。它们应转译为 Fabric 的治理能力。

## Absorption Decision Matrix

| 候选机制 | 判断 | 价值 | 风险 | Fabric 落点 |
|---|---|---|---|---|
| description trigger / anti-trigger 质量规则 | 强吸收 | 提升 skill 命中率，减少误触发 | 过度机械化会误伤短 description | `doctor-skill-lints.ts` warning + maintainer checklist |
| description 不写 HOW | 强吸收 | 避免 agent 不读 body 直接执行 | 需要人工判断 | Skill template review checklist |
| Activation over storage | 强吸收 | 直接对应 Fabric “知识是否真的影响行为” | 结构脚本无法完全验证 | `fabric-review` 审核标准 + KB maturity rubric |
| reached-but-inert 概念 | 强吸收 | 补足 orphan/reachability 之外的行为质量门 | 需要 LLM/human review | `fabric-review` guideline/model/process 审核语言 |
| Progressive Rigor | 强吸收 | 防止 Fabric skill 模板过度膨胀或过度拆分 | 指标被机械化会产生伪拆分 | maintainer docs + doctor report-only |
| Drift dimensions matrix | 强吸收 | 明确每个 check 解决什么问题，避免脚本堆叠 | 需要维护矩阵 | `docs/TESTING.md` / `doctor` check docs |
| conformance manifest | 改造后吸收 | 可防止 mandatory section 丢失 | 可能与现有 doctor lint 重叠 | 轻量 `skill-contract` 检查，先覆盖 protected tokens / hard rules |
| route-reachability | 改造后吸收 | 检查 `ref/*.md` 是否从 hot path 可达 | Fabric 的 ref 与 store KB 不同，不能直接套目录 | 对 `packages/cli/templates/skills/*/ref` 做 reachable check |
| `skill-asset where/related/group` | 改造后吸收 | 写新规则前找已有位置，减少重复 | Fabric 知识在 store，不在项目 docs | 做成 `fab_pending search` / `fabric audit related` 的思路 |
| executable skill contracts | 思想借鉴 | Fabric 已有 CLI/MCP/schema 边界，可强化文档 | 不需要引入 `capability/` 目录 | Runtime contract docs / MCP tool descriptions |
| Rationalizations Table | 思想借鉴 | 真实失败借口可成为高价值 pitfall | 如果人为编造会变成噪音 | 归档为 Fabric KB pitfalls/guidelines |
| SessionStart hook restore | 思想借鉴 | Fabric 已有 SessionStart broad hints | 照搬会和现有 hook 冲突 | 只借鉴“注入导航而非全文”原则 |
| `routing.yaml` 作为总路由 | 不建议照搬 | 对多入口项目规则有用 | 与 `KT-DEC-0042` 和 4-skill 终态冲突 | 不作为 Fabric runtime 真源 |
| full thin shell generation | 不建议照搬 | 解决 AGENTS/CLAUDE/CODEX 多入口漂移 | Fabric 已有 managed bootstrap 和 install pipeline | 只保留 parity lint，不另建生成体系 |
| `skills/<project>/rules/workflows/references` | 不建议照搬 | 适合项目本地规则 | 与 store-only source of truth 冲突 | 不引入 |
| 通用 Task Closure Protocol | 不建议照搬 | 对项目规则文档更新有用 | 与 fabric-archive/self-archive/review backlog 重叠 | 只吸收 recording threshold 思想 |
| XML tag injection 默认化 | 不建议默认 | 抗压缩可能有帮助 | 增加 bootstrap 噪音，未必适合所有 client | 可实验，不进默认模板 |

## Deeper Weighing

### 1. `routing.yaml` 为什么对 SBA 是核心，但对 Fabric 不应成 runtime 真源

SBA 的问题是：规则散落在多个 agent entry 文件里，任务路由没有单一来源。所以 `routing.yaml` 是合理的中心。

Fabric 的问题不是“入口文件不知道读哪个 workflow”，而是：

- 知识在多个 store 和 scope 中；
- pending 与 canonical 生命周期不同；
- 召回需要按 path、intent、semantic_scope、relevance_scope 过滤；
- 写入必须经过 MCP schema、store resolver、review lifecycle。

如果把 `routing.yaml` 变成 Fabric runtime 真源，会制造一个与 store/index/schema 并行的第二路由系统。历史上 Fabric 已经裁决过 skill router 取舍：`KT-DEC-0042` 记录了“保留 leaf skill，避免回到单入口 router”这一类问题。当前代码也明确是 2 个 real leaf + 2 个 thin shim + 0 router。

可吸收的是：

- 对 Skill 模板的 `ref/*.md` 建可达性检查；
- 对 description 和 trigger 维护一个质量 checklist；
- 对每个 lint/check 说明它解决的漂移维度。

不应吸收的是：

- 运行期让 `routing.yaml` 决定 Fabric archive/review/store/sync 路由。

### 2. SBA 的 “Activation over storage” 对 Fabric 最有价值

Fabric 已经有 `fab_recall` 返回 description + read_path，正文按需 native Read；SessionStart 注入 broad index，PreToolUse 触发 narrow hint。这比 SBA 的项目文档加载更强，但仍然会遇到同一个问题：

```text
知识存在 store 中 ≠ Agent 会用它
Agent 看到 summary ≠ summary 足以改变行为
Read 到正文 ≠ 正文包含下一步动作
```

Fabric 现有 `fabric-review` 已经有 guideline/model summary self-sufficiency gate。可以进一步吸收 SBA 的 “reached-but-inert” 维度：

- guideline/model：summary 是否给出可行动规则；
- process：是否让 Agent 改变下一步流程；
- pitfall：`must_read_if` 是否能命中真实触发；
- decision：是否说明裁决边界和反例；
- related edge：是否帮助下一次检索，不只是图谱装饰。

这类质量门不适合完全机械化，但适合在 `fabric-review` 的 maintain/pending 审核中作为 LLM/human 判断维度。

### 3. SBA 的脚本矩阵对 Fabric 的启发

SBA 的脚本价值不在 bash 本身，而在“每个检查回答一个明确问题”：

- route 是否同步；
- shell 是否漂移；
- content 是否 orphan；
- content 是否未激活；
- conformance 是否漏 mandatory section；
- cross-reference 是否断；
- growth 是否触发评估。

Fabric 也有很多 doctor lint，但文档层可以更明确地描述每个 lint 的 drift dimension。否则容易出现两个问题：

- 新增 lint 只是因为“看起来安全”，没有真实故障基线；
- 不同 lint 覆盖同一问题，维护成本上升。

建议 Fabric 学 SBA 的“check matrix”，而不是学它的具体 shell 脚本。

### 4. SBA 的 upstream/downstream 模板同步对 Fabric 部分适用

Fabric 已有 `fabric install` 分发 skill/hook/bootstrap 到 `.claude` / `.codex`，也已有 `KT-PIT-0004` 记录的多镜像漂移教训。SBA 的 `conformance.yaml` 可以启发 Fabric 做更显式的 Skill contract：

- `fabric-archive` 必须包含 Display/Write hard rules；
- `fabric-review` 必须保留 AskUserQuestion policy；
- `fabric-store` / `fabric-sync` 必须保持 thin shim，不把安全逻辑写厚；
- protected tokens 不得翻译或丢失；
- MCP-only write path 不得被弱化。

但这个 contract 应该由 TypeScript test / doctor lint / snapshot 驱动，不建议照搬 YAML 作为主实现。

### 5. Task Closure Protocol 不适合直接搬进 Fabric

SBA 的 closure protocol 是给“项目规则文档维护”用的：修改 skill docs 后跑 AAR、smoke test、path integrity。Fabric 已经有：

- Stop hook archive nudge；
- `fabric-archive` viability gate；
- `fabric-review` backlog nudge；
- event ledger；
- review/pending lifecycle。

直接再加一个通用 AAR 结束门，会和现有 archive/review 机制重叠。更好的吸收方式是保留 “recording threshold”：

```text
Repeatable + Costly + Not obvious from code
满足 2/3 才记录
```

这可以作为 `fabric-archive` Phase 2.5 / `fabric-review` pending 审核语言，而不是新增一个闭包协议。

## Recommended Fabric Optimization Directions

### P0：补 Skill 模板质量 checklist

目标：低风险吸收 `skill-authoring`。

内容：

- description 是 trigger，不是 summary；
- description 不描述 HOW；
- 至少有 should-trigger / should-not-trigger 示例；
- CJK + ASCII trigger 都有，但不 keyword stuffing；
- `ref/*.md` 必须从 hot path 可达；
- new ref must change behavior or justify background-only role。

落点：

- `docs/TESTING.md` 或 `docs/ARCHITECTURE.md` 的 Skill 扩展段；
- `doctor-skill-lints.ts` 增加 warning，而不是 hard error。

### P1：把 “reached-but-inert” 加入 `fabric-review`

目标：吸收 SBA 最有价值的知识质量观。

内容：

- pending review 展示时，除 duplicate/contradiction，还判断“读到后是否改变下一步动作”；
- guideline/model 冷评之外，process/pitfall/decision 也补一条 activation check；
- 对 `must_read_if`、`intent_clues`、`impact` 做更严格的可行动性审核。

落点：

- `packages/cli/templates/skills/fabric-review/SKILL.md`
- `fabric-review/ref/semantic-check.md`
- `fabric-review/ref/per-mode-flows.md`

### P2：建立 Fabric Skill Contract Check

目标：吸收 SBA conformance manifest 的能力，但以 Fabric 方式实现。

内容：

- 检查 `fabric-archive` / `fabric-review` 的 hard rules 存在；
- 检查 protected tokens；
- 检查 MCP-only write path；
- 检查 `fabric-store` / `fabric-sync` 仍为 thin shim；
- 检查 `ref/*.md` 在 `SKILL.md` 中有入口。

落点：

- 新增或扩展 `doctor-skill-lints.ts`；
- 对模板源码做 unit test，而不是只检查安装产物。

### P3：把 doctor lint 文档化成 Drift Matrix

目标：吸收 SBA `scripts/README.md` 的“每个检查回答什么问题”。

内容：

| Fabric check | 回答的问题 | 是否 hard gate |
|---|---|---|
| skill token budget | Skill 是否过大，需要拆 ref | warning/error |
| skill description lint | 触发描述是否可能失效 | warning |
| skill ref mirror | `.claude` / `.codex` 是否漂移 | warning |
| bootstrap drift | managed block 是否被手改 | fixable |
| store route check | scope 是否能解析到 write store | hard |
| personal leak check | personal 是否泄漏到 shared store | hard |

落点：

- `docs/TESTING.md`
- `docs/RUNTIME-CONTRACTS.md`
- doctor help output。

## Non-Goals

明确不做：

- 不引入项目内 `skills/<project>/` 作为 Fabric 知识真源。
- 不让 `routing.yaml` 成为 Fabric runtime 路由层。
- 不恢复单入口 `fabric` router。
- 不把 `fabric-store` / `fabric-sync` 写厚；护栏继续在 CLI。
- 不把 Task Closure Protocol 作为所有 Fabric 操作的结束门。
- 不把 XML tag injection 默认加入 bootstrap。

## Final Recommendation

Fabric 应该吸收 SBA 的 **知识工程观**，而不是它的 **目录工程形态**。

最值得吸收的一句话是：

> 知识只有在正常任务路径上被读取，并改变下一步动作，才算真正被捕获。

对 Fabric 来说，这句话应转化为：

```text
store-backed knowledge
  → indexed description
  → surfaced by SessionStart / PreToolUse / fab_recall
  → body read on demand
  → changes agent behavior
  → cited / reviewed / matured
```

这条链上目前最值得补强的是中后段：`changes agent behavior` 和 `reviewed / matured` 的判断语言。优先从 `fabric-review` 和 `doctor-skill-lints` 入手，而不是引入新的 runtime 路由文件。

## Implementation Completed

本轮按上面的 P0/P1/P2/P3 完成可验证落地：

- P0：`Skill description quality` 增加 `missing_anti_trigger` warning，要求 description 除中英 trigger 外，还要有 `NOT` / `不是` / `不要` 这类 anti-trigger 边界。
- P0/P2：模板源码 lint 增加 `ref/*.md` 可达性检查；任何 ref 文件必须被对应 `SKILL.md` 直接提到，background-only ref 也要写明加载时机。
- P1：`fabric-review` 的 Activation Gate 扩展到 guideline / model / process / decision / pitfall 全类型；pending 展示和语义检查同步评估 `must_read_if`、`intent_clues`、`impact` 的可行动性。
- P1 upstream：`fabric-archive` 的 Phase 2 增加 activation floor，从源头减少 storage-only pending。
- P2：新增 `skill_contract_integrity` doctor warning，检查 archive/review hard rules、MCP-only write path、store/sync thin shim、installed `ref/*.md` 入口。
- P2：`scripts/lint-protected-tokens.ts` 锁住 MCP tool names、hard-rule anchors、store/sync thin shim token、`reached-but-inert` / `changes next action` / triage field token。
- P3：`docs/TESTING.md` 增加 Skill / Doctor Drift Matrix；`docs/RUNTIME-CONTRACTS.md` 增加 Fabric Skill Contract 入口。

校验命令：

```bash
node --experimental-strip-types scripts/lint-protected-tokens.ts
node_modules/.bin/vitest run src/services/doctor-skill-lints.test.ts
../../node_modules/.bin/vitest run __tests__/lint-protected-tokens.test.ts
node scripts/test-strategy-gate.mjs
node_modules/.bin/vitest run src/services/doctor-i18n.test.ts
node_modules/.bin/vitest run src/services/doctor.test.ts -t "returns ok when target-state fabric artifacts are aligned"
git diff --check
```
