# Analysis Discussion

**Session ID**: ANL-2026-04-22-codex适配
**Topic**: Fabric 对 Codex 的适配分析：新增 Codex skill，并评估接入 Codex hooks 的可行路径
**Started**: 2026-04-22T00:00:00+08:00
**Dimensions**: architecture, implementation, comparison, decision
**Depth**: standard

## Table of Contents
- [Analysis Context](#analysis-context)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
- [Decision Trail](#decision-trail)
- [Synthesis & Conclusions](#synthesis--conclusions)

## Current Understanding

### What We Established
- Fabric 当前已经识别 `CodexCLI`，并可写入 `~/.codex/config.toml` 的 MCP server 配置。
- Fabric 当前没有为 Codex 安装任何 repo-scoped skill 或 hook，也没有在 `init` 里把 Codex 标记为具备这些能力。
- OpenAI 官方文档已明确 Codex 支持 repo skill 和 hooks，因此 Codex 现在不是“能力缺失”，而是 Fabric 侧“尚未接入”。
- Claude 现有的 `agents-md-init` skill 和 reminder hook 设计可以复用思路，但不能直接 1:1 复制，因为 Codex 的 skill 目录与 hook 事件模型不同。

### What Was Clarified
- ~~Codex 可能不支持 skill / hook~~ → Codex 官方已提供 skill 与 hooks 文档，且 hooks 配置支持 repo 级 `.codex/hooks.json`。
- ~~Codex skill 可能必须装到 `~/.codex`~~ → 官方文档显示 Codex 会扫描仓库内 `.agents/skills`，repo-scoped skill 是一等路径。
- ~~Codex hook 可像 Claude 一样拦截所有工具~~ → 目前 `PreToolUse` / `PostToolUse` / `PermissionRequest` 主要只覆盖 `Bash`，不是完整工具拦截边界。

### Key Insights
- 对 Fabric 来说，新增 Codex skill 的最低成本路径不是发明 `.codex/skills` 目录，而是直接利用 Codex 原生扫描的 repo skill 路径 `.agents/skills`。
- 对 Fabric 来说，Codex hook 的最佳切入点不是“完全复制 Claude Stop hook”，而是分成两个层次：
  1. `SessionStart` 注入 bootstrap context
  2. `Stop` 触发 continuation / reminder
- 现有 `detectClientSupports()` 将 Codex 标成 `hook: false`、`skill: false` 已经与官方能力不一致，这会误导 `init` 输出和后续产品路径。

## Analysis Context
- Focus areas: 实现接入
- Perspectives: Technical
- Depth: standard

## Initial Questions
- Fabric 应该把 Codex skill 放在哪个原生路径，才能最小改动接入？
- Fabric 应该如何利用 Codex hooks，补齐 `fab init` 之后的 follow-up 流程？
- 哪些 Claude 现有资产可以复用，哪些必须按 Codex 能力模型重写？
- 用户在 `fab init` 输出里应该看到什么能力状态，才能避免“部分接入看起来像完成”？

## Initial Decisions
> **Decision**: 以“实现接入”而非“纯产品讨论”作为本轮主轴。
> - **Context**: 用户明确提出两个新需求：新增 Codex skill、接入 Codex hooks。
> - **Options considered**: 只看文档说明；只看架构抽象；直接看实现接点。
> - **Chosen**: 直接看实现接点。 — **Reason**: 需要尽快得到可执行的改造落点。
> - **Rejected**: 纯文档或纯抽象分析。原因是无法回答哪些文件需要改、哪些能力已存在。
> - **Impact**: 本轮重点落在 `resolver.ts`、`init.ts`、Codex config 写入与模板/文档资产。

---

## Discussion Timeline

### Round 1 - Exploration (2026-04-22T00:15:00+08:00)

#### User Input
当前有新需求主要集中在 Codex 的适配：
- 需要新增 Codex skill
- Codex 支持 hook，也可以接入

#### Decision Log
> **Decision**: 先核实本地实现现状，再对照 OpenAI 官方 Codex docs。
> - **Context**: 需求包含“Codex 支持 hook”这一时效性很强的能力判断。
> - **Options considered**: 只看仓库代码；只看官方文档；两者交叉核验。
> - **Chosen**: 两者交叉核验。 — **Reason**: 需要判断是 Codex 不支持，还是 Fabric 尚未接入。
> - **Rejected**: 单看仓库会误把现状当能力边界；单看文档无法定位实现缺口。
> - **Impact**: 结论可直接映射到代码改造与文档修正。

#### Key Findings
> **Finding**: Fabric 已把 Codex 作为 MCP 客户端接入，但只覆盖配置写入。
> - **Confidence**: High — **Why**: `packages/cli/src/config/resolver.ts` 检测 `~/.codex` 并返回 `CodexTOMLConfigWriter`；`packages/cli/src/config/toml.ts` 负责写入 `~/.codex/config.toml`。
> - **Hypothesis Impact**: Confirms hypothesis "Codex 已部分接入"
> - **Scope**: init / config install / capability summary

> **Finding**: Fabric 当前把 Codex 能力错误地展示为 `hook: false`、`skill: false`。
> - **Confidence**: High — **Why**: `packages/cli/src/config/resolver.ts` 的 `detectClientSupports()` 对 `CodexCLI` 明确写死了这两个布尔值。
> - **Hypothesis Impact**: Confirms hypothesis "产品层能力矩阵已经落后于官方能力"
> - **Scope**: init summary / follow-up guidance / docs

> **Finding**: Claude 的 init follow-up 闭环是“skill + hook + settings merge”，Codex 当前完全没有对应安装路径。
> - **Confidence**: High — **Why**: `packages/cli/src/commands/init.ts` 只创建 `.claude/skills/agents-md-init/SKILL.md`、`.claude/hooks/agents-md-init-reminder.cjs` 和 `.claude/settings.json`。
> - **Hypothesis Impact**: Confirms hypothesis "Codex 缺的是 Fabric 接入，不是 Codex 能力"
> - **Scope**: init assets / installer / tests

> **Finding**: OpenAI 官方 Codex skills 文档确认 repo skill 是原生能力，扫描路径包括仓库内 `.agents/skills`。
> - **Confidence**: High — **Why**: 官方 skills 文档说明 Codex 会扫描 `$CWD/.agents/skills` 到 `$REPO_ROOT/.agents/skills`，并基于 `SKILL.md` 的 `name` / `description` 做显式或隐式调用。
> - **Hypothesis Impact**: Refutes hypothesis "需要专门发明 Codex 私有 skill 安装目录"
> - **Scope**: skill 安装策略 / bootstrap / initialization

> **Finding**: OpenAI 官方 Codex hooks 文档确认 repo hook 是原生能力，配置文件可放在 `<repo>/.codex/hooks.json`。
> - **Confidence**: High — **Why**: 官方 hooks 文档明确列出 `~/.codex/hooks.json` 和 `<repo>/.codex/hooks.json` 两个高价值位置。
> - **Hypothesis Impact**: Confirms hypothesis "Codex hook 可以纳入 Fabric init 的 repo 资产"
> - **Scope**: init assets / repo scaffolding / docs

> **Finding**: Codex hooks 目前的工具拦截边界主要是 Bash，不覆盖 MCP / Write / WebSearch。
> - **Confidence**: High — **Why**: 官方 hooks 文档说明 `PreToolUse` / `PostToolUse` 当前主要只支持 `Bash`，应视为 guardrail 而非完整 enforcement。
> - **Hypothesis Impact**: Modifies hypothesis "Codex hooks 可以完全替代 Claude 的触发逻辑"
> - **Scope**: hook 策略 / enforcement design

#### Technical Solutions
> **Solution**: 为 Codex 采用 repo skill 路径 `.agents/skills/agents-md-init-codex/`，而不是尝试在 `.codex/` 下维护 skill 目录。
> - **Status**: Proposed
> - **Problem**: Fabric 需要给 Codex 增加初始化 skill，但仓库当前没有 Codex 原生 skill 安装策略。
> - **Rationale**: 官方技能扫描已覆盖 repo `.agents/skills`；这条路径还能与 Fabric 现有 skill 体系更好对齐。
> - **Alternatives**: 将 skill 放在用户级目录（被拒绝：不适合 repo 初始化）；继续只做 manual 文档提示（被拒绝：不能形成闭环）。
> - **Evidence**: `https://developers.openai.com/codex/skills`, `packages/cli/src/commands/init.ts`
> - **Next Action**: 评估 skill 是否应复用现有 `agents-md-init` 语义，还是拆出 Codex 版本。

> **Solution**: 为 Codex 增加 repo 级 `.codex/hooks.json`，先接 `SessionStart` + `Stop`，暂不依赖 `PreToolUse/PostToolUse` 做强约束。
> - **Status**: Proposed
> - **Problem**: Fabric 需要在 Codex 中形成 `fab init` 后的 follow-up 提醒和接力。
> - **Rationale**: `SessionStart` 可注入 initialization context，`Stop` 可触发 continuation reason；二者比 Bash-only hook 更贴近 Claude reminder 方案。
> - **Alternatives**: 仅用 `PreToolUse/PostToolUse`（被拒绝：覆盖面不足）；不接 hook 只靠文档（被拒绝：闭环太弱）。
> - **Evidence**: `https://developers.openai.com/codex/hooks`, `packages/cli/src/commands/init.ts`
> - **Next Action**: 设计 hook 脚本输出格式与何时继续/何时静默。

> **Solution**: 先修正 capability matrix，再补安装资产，最后再改 docs 与测试。
> - **Status**: Proposed
> - **Problem**: 当前产品输出把 Codex 错误标成不支持 skill/hook。
> - **Rationale**: 先纠正能力模型，避免后续设计继续建立在错误前提上。
> - **Alternatives**: 先做模板或 docs（被拒绝：会继续放大错误能力表达）。
> - **Evidence**: `packages/cli/src/config/resolver.ts`, `packages/cli/__tests__/init-mcp-scope.test.ts`
> - **Next Action**: 形成改造优先级清单。

#### Analysis Results
- `packages/cli/src/config/resolver.ts`
  - `resolveClients()` 已通过 `~/.codex` 检测 Codex，并使用 `CodexTOMLConfigWriter`
  - `detectClientSupports()` 仍把 Codex 标为 `hook: false`、`skill: false`
- `packages/cli/src/config/toml.ts`
  - 当前只负责 MCP TOML block 的写入和更新
  - 尚未承载任何 skill/hook 相关配置协助
- `packages/cli/src/commands/init.ts`
  - `initFabric()` 只生成 `.claude/skills`、`.claude/hooks`、`.claude/settings.json`
  - 没有 `.codex/hooks.json` 或 repo skill 相关安装
- `packages/cli/__tests__/init-mcp-scope.test.ts`
  - 现有测试甚至显式验证 Codex 在 capability summary 中需要 manual follow-up
- 近期分析会话已指出 “Codex 目前是部分接入，需要显式暴露能力边界”，本轮新信息是：官方能力现已足够，下一步不应只停留在 manual follow-up

#### Corrected Assumptions
- ~~Codex 还没有 hook 机制~~ → Codex 已有官方 hooks 文档与 repo 级 `hooks.json`
  - Reason: OpenAI 官方文档已明确配置位置、事件、输入输出格式
- ~~Codex skill 只能靠用户全局安装~~ → Codex 原生支持 repo `.agents/skills`
  - Reason: 官方 skills 文档已明确 repo/user/admin/system 四层扫描

#### Open Items
- Codex skill 是否应该继续命名为 `agents-md-init`，还是拆为 Codex-specific skill 名称？
- `Stop` hook 的 continuation 文案是否应继续复用当前 Claude 的“finish initialization”语义？
- `features.codex_hooks` 当前是实验开关，Fabric 是否需要在文档与输出中明确提示这一点？

#### Narrative Synthesis
**起点**: 基于用户提出的 Codex 新需求，本轮先核对 Fabric 现状与官方能力边界。  
**关键进展**: 新发现确认了 Codex 的 skill 与 hook 都已具备官方支持，因此当前缺口集中在 Fabric 侧的 installer、capability matrix 和 follow-up 资产。  
**决策影响**: 分析方向从“Codex 是否支持”转为“Fabric 应如何接入，以及按什么顺序接入”。  
**当前理解**: Codex 适配不需要重新发明协议，重点是复用 Fabric 已有 init 语义，并改用 Codex 原生的 repo skill + repo hook 入口。  
**遗留问题**: 需要决定命名兼容策略、hook 最小闭环方案、以及实验特性的产品表达方式。  

#### Initial Intent Coverage Check (Post-Exploration)
- ✅ Intent 1: 新增 Codex skill — 已确认可用原生 repo skill 路径落地
- ✅ Intent 2: 接入 Codex hooks — 已确认可用 repo hooks.json 落地
- 🔄 Intent 3: 明确如何接入到 Fabric — 已形成初步方案，但尚未收敛成执行优先级

---

## Decision Trail

> Consolidated critical decisions across all rounds (to be finalized in synthesis).

## Synthesis & Conclusions

### Executive Summary
- Codex 官方已经支持 repo skill 与 repo hook，Fabric 当前仅完成 MCP/config 接入。
- 第一优先级不是直接写 hook，而是先修正 capability matrix 与 init 输出，避免继续把 Codex 描述成“不支持”。
- 第一阶段最稳的实现是新增 repo-scoped Codex init skill；第二阶段再补 `SessionStart` + `Stop` hooks。

### Recommendations
1. 修正 Codex capability matrix，区分 official support 与 Fabric-installed status。
2. 为 Codex 新增 repo `.agents/skills` 下的 init skill。
3. 第二阶段补 `.codex/hooks.json` + `SessionStart` / `Stop` helper scripts。
4. 同步收口文档与测试，形成 Codex parity 叙事。

### Intent Coverage Matrix
| # | Original Intent | Status | Where Addressed | Notes |
|---|----------------|--------|-----------------|-------|
| 1 | 需要新增 Codex skill | ✅ Addressed | Round 1, Recommendation 2 | 建议采用 repo `.agents/skills` |
| 2 | Codex 支持 hook，也可以接入 | ✅ Addressed | Round 1, Recommendation 3 | 建议优先 `SessionStart` + `Stop` |
| 3 | 主要集中在 Codex 的适配 | ✅ Addressed | Summary + Recommendations | 已覆盖 capability / skill / hook / docs / tests |

### Findings Coverage Matrix
| # | Finding (Round) | Disposition | Target |
|---|----------------|-------------|--------|
| 1 | Fabric already detects Codex but only configures MCP (R1) | recommendation | Rec #1 |
| 2 | Codex repo skills are officially supported (R1) | recommendation | Rec #2 |
| 3 | Codex repo hooks.json is officially supported (R1) | recommendation | Rec #3 |
| 4 | PreToolUse/PostToolUse are Bash-centric and incomplete (R1) | absorbed | -> Rec #3 |
| 5 | Existing tests and docs encode Codex as partial/manual support (R1) | recommendation | Rec #4 |

### Recommendation Review Summary
| # | Action | Priority | Steps | Review Status | Notes |
|---|--------|----------|-------|---------------|-------|
| 1 | 修正 capability matrix | high | 3 | ✅ Accepted | 应作为第一步 |
| 2 | 新增 repo-scoped init skill | high | 3 | ✅ Accepted | 应与第一步同一阶段规划 |
| 3 | 增加 repo-scoped hooks 闭环 | medium | 4 | ✅ Accepted | 建议放第二阶段 |
| 4 | 收口文档与测试 | medium | 2 | ✅ Accepted | 跟随实现收尾 |

## Plan Checklist

> **This is a plan only — no code was modified.**

- **Recommendations**: 4
- **Generated**: 2026-04-22T00:40:00+08:00

### 1. 修正 Codex capability matrix，并区分“官方能力”与“Fabric 已安装能力”
- **Priority**: high
- **Rationale**: 避免继续把错误前提扩散到 init 输出、文档和测试。
- **Target files**: `packages/cli/src/config/resolver.ts`, `packages/cli/src/commands/init.ts`, `packages/shared/src/i18n/locales/*.ts`, `packages/cli/__tests__/init-mcp-scope.test.ts`
- **Acceptance criteria**: init summary 不再把 Codex 错误显示为不支持 skill/hook；Codex 场景下输出明确下一步；测试更新为 supported/installed 模型
- [ ] Ready for execution

### 2. 为 Codex 增加 repo-scoped init skill
- **Priority**: high
- **Rationale**: 这是最稳的最小闭环，且完全符合官方技能发现模型。
- **Target files**: `packages/cli/src/commands/init.ts`, `templates/*codex*`, `.agents/skills/*` related install templates, `packages/cli/__tests__/*`
- **Acceptance criteria**: skill 安装到 repo `.agents/skills`；在 Codex 打开仓库时可被发现；语义能指导 Fabric initialization follow-up
- [ ] Ready for execution

### 3. 为 Codex 增加 repo-scoped hooks 闭环，优先接入 `SessionStart` 与 `Stop`
- **Priority**: medium
- **Rationale**: 补齐自动提醒和 continuation handoff，同时避开 Bash-only 拦截的局限。
- **Target files**: `packages/cli/src/commands/init.ts`, `.codex/hooks.json` templates, helper scripts, docs
- **Acceptance criteria**: 生成 repo hook assets；未完成初始化时可触发 continuation；文档明确 feature-flag 要求
- [ ] Ready for execution

### 4. 收口文档与测试，形成 Codex parity 叙事
- **Priority**: medium
- **Rationale**: 当前实现、测试和文档对 Codex 的描述不一致，容易持续回退到“部分支持”状态。
- **Target files**: `docs/*.md`, `README.md`, `packages/cli/__tests__/*`
- **Acceptance criteria**: 文档不再把 Codex 描述成 MCP-only；新增 Codex install 回归测试
- [ ] Ready for execution
