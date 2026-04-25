# Analysis Discussion

**Session ID**: ANL-2026-04-25-重建对于该项目的完全掌握和认知
**Topic**: 重建对于 Fabric-v2 项目的完全掌握和认知
**Started**: 2026-04-25
**Dimensions**: architecture, implementation, decision, concept
**Depth**: standard

## Current Understanding

### What We Established

- Fabric-v2 的核心闭环是 `cli -> server -> shared`，Dashboard 是 HTTP/SSE consumer。
- `get-rules` 是规则分发热路径，负责 meta/L0/human-lock context、path match、priority sort、activation stub、payload build。
- Stable ID 已经通过 `stable_id + identity_source` 和 HTML comment `fab:rule-id` 实现了基础链路。
- 当前仓库根 `.fabric/agents.meta.json` 缺失，因此本项目自身没有完整运行时规则注册表。
- Dashboard 目标约束是观察优先，但当前实现仍保留 approve/annotate 写入口，需作为架构偏离记录。

### What Was Clarified

- ~~docs/ 里叙事文档可继续作为认知入口~~ -> 叙事文档会干扰底层接管，当前入口应转为协议、源码地图、决策记录、开发约定。
- ~~Dashboard 已完全只读~~ -> 近期决策收敛为只读/观察优先，但源码仍存在写路径。
- ~~模板规则等同于当前项目激活规则~~ -> 当前根 `.fabric/` 缺少 registry，模板和 example 只能作为规则身份来源样本。

### Key Insights

- `SPEC_INTERNAL.md` 是未来核心引擎改动的前置变更图。
- `CODEBASE_LANDSCAPE.md` 是 `packages/` 修改后的同步锚点。
- `RULE_REGISTRY.md` 需要同时记录运行时 registry 状态和模板/example 规则身份，避免误读。

## Discussion Timeline

### Round 1 - Exploration And Execution

#### User Input

用户要求立即整理 `docs/`，删除或归档 `launch-story.md`、`smoke-v1.0.md`、`brand.md`，合并 `quickstart.md` 与 `getting-started.md`，合并中文本地化与品牌调性为 `CONVENTIONS.md`，并扫描源码生成三份内核白皮书及 `RULE_REGISTRY.md`。

#### Decision Log

> **Decision**: 将本次任务从纯分析升级为“分析记录 + 文档执行”。
> - **Context**: 用户明确使用“请立即执行”。
> - **Options considered**: 只生成分析计划；先询问是否执行；直接执行并记录过程。
> - **Chosen**: 直接执行并记录过程 — **Reason**: 用户目标清晰，变更范围限于 `docs/` 和 `.workflow/.analysis/`。
> - **Rejected**: 只生成计划会阻塞接管目标；询问会增加无效轮次。
> - **Impact**: 本 session 不是严格只读，实际修改文档。

> **Decision**: 删除叙事/仪式文档，不做 archives 目录。
> - **Context**: 用户目标是让 `docs/` 变薄。
> - **Options considered**: 移到 `docs/archive/`；删除；保留并降级。
> - **Chosen**: 删除 — **Reason**: archive 仍会留在 `docs/` 干扰认知入口。
> - **Rejected**: archive/保留不满足“变薄”。
> - **Impact**: 活跃引用需要同步修复。

> **Decision**: 把 Dashboard 只读写成目标约束加实现偏离。
> - **Context**: 近期分析结论要求只读 Dashboard，但源码存在 `POST /api/human-lock/approve` 和 UI approve。
> - **Options considered**: 写成已实现；忽略；明确偏离。
> - **Chosen**: 明确偏离 — **Reason**: 架构文档必须对应具体代码行。
> - **Rejected**: 写成已实现会伪造状态；忽略会丢失关键风险。
> - **Impact**: `ARCHITECTURE_DECISIONS.md` 记录 ADR-008。

#### Key Findings

> **Finding**: `get-rules` 的规则优先级是 `high -> medium -> low`，同优先级按 node id 排序。
> - **Confidence**: High — **Why**: `packages/server/src/services/get-rules.ts:77` 和 `:150`。
> - **Hypothesis Impact**: Confirms hypothesis "规则合并逻辑可由源码精确复原"。
> - **Scope**: `SPEC_INTERNAL.md`。

> **Finding**: Stable ID 已经在 shared schema、sync-meta、plan-context 形成闭环。
> - **Confidence**: High — **Why**: `packages/shared/src/schemas/agents-meta.ts:31`、`packages/cli/src/commands/sync-meta.ts:334`、`packages/server/src/services/plan-context.ts:172`。
> - **Hypothesis Impact**: Confirms hypothesis "Stable ID 可作为协作契约基础"。
> - **Scope**: `RULE_REGISTRY.md`, `CONVENTIONS.md`, `ARCHITECTURE_DECISIONS.md`。

> **Finding**: 当前根 `.fabric/agents.meta.json` 缺失。
> - **Confidence**: High — **Why**: `fab_plan_context` 返回缺失错误，`find .fabric` 只看到 `.fabric/audit.jsonl`。
> - **Hypothesis Impact**: Modifies hypothesis "可扫描现有根规则"。
> - **Scope**: `RULE_REGISTRY.md`。

#### Technical Solutions

> **Solution**: 建立四类内核文档：执行流协议、源码地图、架构决策、规则注册。
> - **Status**: Validated
> - **Problem**: `docs/` 叙事文档多，无法作为底层架构接管入口。
> - **Rationale**: 用户需要的是能直接对应源码行的开发者白皮书。
> - **Alternatives**: 保留旧 quickstart/launch story；仅更新 README。
> - **Evidence**: 新增 `docs/SPEC_INTERNAL.md`, `docs/CODEBASE_LANDSCAPE.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/RULE_REGISTRY.md`。
> - **Next Action**: 未来核心代码修改必须同步这些文档。

#### Analysis Results

- 已删除 `docs/launch-story.md`、`docs/smoke-v1.0.md`、`docs/brand.md`、`docs/quickstart.md`、`docs/chinese-localization.md`。
- 已重建 `docs/getting-started.md`，只保留技术上手。
- 已新增 `docs/CONVENTIONS.md`，承载中文命名、品牌调性、协作契约。
- 已新增三份内核白皮书和 `RULE_REGISTRY.md`。
- 已修复 `README.md`、`RELEASING.md`、`docs/dashboard-tour.md` 中对被删除文档的活跃引用。

#### Open Items

- 当前项目根 `.fabric/` 缺少运行时 registry；是否要让 fabric-v2 仓库自身完成 Fabric 初始化，需要维护者另行确认。
- 若严格落实 Dashboard 只读，需要后续迁移或移除 HTTP approve/annotate 写入口。

#### Narrative Synthesis

**起点**: 用户要求重新接管 Fabric-v2 的底层架构，并清理干扰性文档。
**关键进展**: 源码扫描确认了 `cli -> server -> shared -> dashboard` 的实际边界，并将规则分发、Stable ID、MCP transport 写成可追踪协议。
**决策影响**: 用户选择立即执行，导致本轮直接修改 `docs/` 而非停留在计划。
**当前理解**: Fabric-v2 的认知入口应以协议和源码证据为中心，叙事文档退出核心 docs。
**遗留问题**: 根 `.fabric/` registry 缺失和 Dashboard 写入口偏离需要后续单独处理。

## Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
| --- | --- | --- | --- | --- |
| 1 | 清理叙事/仪式 docs 并合并上手与约定文档 | Addressed | Round 1, docs changes | 已删除/重建。 |
| 2 | 生成 `SPEC_INTERNAL.md`、`CODEBASE_LANDSCAPE.md`、`ARCHITECTURE_DECISIONS.md` | Addressed | Round 1, docs changes | 均含源码行证据。 |
| 3 | 建立协作契约：先更图后改码、Stable ID、自动化同步 | Addressed | `CONVENTIONS.md`, `RULE_REGISTRY.md` | 已写入规则。 |
| 4 | 扫描现有规则并创建 `RULE_REGISTRY.md` | Addressed | `RULE_REGISTRY.md` | 明确根 registry 缺失，列出模板/example/core module IDs。 |

## Findings Coverage Matrix

| # | Finding | Disposition | Target |
| --- | --- | --- | --- |
| 1 | `get-rules` 是规则分发热路径 | recommendation | `SPEC_INTERNAL.md` |
| 2 | Stable ID 链路已部分实现 | recommendation | `RULE_REGISTRY.md`, `ARCHITECTURE_DECISIONS.md` |
| 3 | 当前根 registry 缺失 | recommendation | `RULE_REGISTRY.md` |
| 4 | Dashboard 只读目标与当前实现有偏离 | recommendation | `ARCHITECTURE_DECISIONS.md` |
| 5 | `packages/` 修改需要源码地图同步 | recommendation | `CONVENTIONS.md`, `CODEBASE_LANDSCAPE.md` |

## Decision Trail

- 清理方式选择删除而非归档，理由是保持 `docs/` 变薄。
- 内核白皮书以代码证据为主，不保留产品叙事。
- Dashboard 只读写为目标约束和偏离，而非伪造实现状态。
- 当前项目规则注册表记录“缺失状态”，不把模板规则误称为当前激活规则。

## Session Statistics

- Rounds: 1
- Key findings: 5
- Decisions: 4
- Docs files added: 5
- Docs files removed: 5
- Source code modified: no
