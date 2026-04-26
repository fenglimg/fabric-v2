# Analysis Discussion

**Session ID**: ANL-2026-04-26-fabric-cli-mcp-server-crud-职责优化
**Topic**: 现有框架下，fabric cli和 mcp_server 优化支持的相关命令(增删改查)，以及相应命令的功能和职责划分和优化。
**Started**: 2026-04-26T18:50:14+0800
**Dimensions**: architecture, implementation, performance, decision
**Depth**: deep

## Table of Contents
- [Analysis Context](#analysis-context)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
- [Decision Trail](#decision-trail)

## Current Understanding

### What We Established
- 当前框架已经形成四个操作面：CLI 是安装、修复、本地治理入口；MCP 是 agent runtime 上下文入口；HTTP API 是 Dashboard/观察面入口；共享 services 是应收敛的业务能力层。
- CLI 已覆盖较多 C/U/D 类本地治理动作，MCP 当前主要覆盖 runtime 查上下文，只有两个写入口仍作为 deprecated compatibility surface 保留。
- 现有最大职责风险不是“命令不够多”，而是同类能力散落在 CLI、HTTP API、MCP tool 和 service 中，部分逻辑重复、部分写入口语义过旧。
- 文档层已把 `init/serve/doctor/approve` 作为主命令，把 `bootstrap/config/hooks` 定义为重跑阶段的进阶命令；实现层和帮助面还需要同等分层。

### What Was Clarified
- ~~MCP server 应直接承载完整 CRUD~~ -> MCP server 更适合承载 agent 运行期的受控 Read/Append 型能力；确定性文件生成、迁移、修复仍应由 CLI 驱动。
- ~~所有查询都可只放 HTTP/Dashboard~~ -> agent 运行期需要 MCP 原生资源/工具；Dashboard 查询可走 REST，但底层服务应共享。

### Key Insights
- CRUD 应按“使用者”和“风险”划分，而不是按数据表机械划分：CLI 操作本地项目状态，MCP 暴露 agent 可安全调用的上下文，HTTP 服务 UI 查询/审批。
- deprecated MCP 写工具需要明确迁移路径：`fab_update_registry` 应被 `sync-meta`/`doctor --fix` 替代；`fab_append_intent` 应被 typed Event Ledger 自动记录替代。

## Analysis Context
- Focus areas: 职责划分
- Perspectives: 技术+架构
- Depth: Deep Dive
- Constraints: 本轮只读分析，不修改源代码；本仓库缺少 `.fabric/agents.meta.json`，Fabric MCP 规则上下文不可用。

## Initial Questions
- 现有 CLI 命令和 MCP tools 分别承担哪些 Create/Read/Update/Delete 能力？
- 哪些命令职责重叠、命名不清或实现重复？
- 哪些能力应放在 CLI，哪些应放在 MCP runtime，哪些只应留在 HTTP/Dashboard？
- 下一步优化应优先改命令面、service 边界，还是 MCP 协议资源/通知？

## Initial Decisions

> **Decision**: 使用 Deep Dive + 技术/架构视角，优先分析职责划分。
> - **Context**: 用户选择“职责划分(Recommended)”“技术+架构(Recommended)”“Deep Dive”。
> - **Options considered**: 命令清单、产品职责、实现风险、Quick/Standard/Deep。
> - **Chosen**: 深入分析 CLI/MCP/HTTP/service 边界。
> - **Rejected**: 只列命令会遗漏重复实现与职责漂移；只看产品文案不足以指导后续代码重构。
> - **Impact**: 本轮输出以职责矩阵和优化路线为主，不直接修改代码。

> **Decision**: 本轮以本地源码和近期工作流为主要证据，外部研究仅用于 MCP 协议边界校验。
> - **Context**: 主题是现有框架内部优化；同时 MCP tool/resource 语义属于外部规范。
> - **Options considered**: 纯内部分析、全面外部调研、内部为主 + MCP 官方规范校验。
> - **Chosen**: 内部为主 + MCP 官方规范校验。
> - **Rejected**: 全面外部调研会稀释项目代码事实；纯内部分析可能误判 MCP tool annotations/resources 的职责。
> - **Impact**: 结论会引用本地文件行号，并用 MCP 官方规范验证 read/write/resource 边界。

---

## Discussion Timeline

### Round 1 - Exploration (2026-04-26T18:50:14+0800)

#### User Input
用户要求分析“fabric cli 和 mcp_server 优化支持的相关命令(增删改查)，以及相应命令的功能和职责划分和优化”，并选择职责划分、技术+架构、Deep Dive。

#### Decision Log

> **Decision**: 沿用既有“三面分工”作为前置架构约束：CLI=control，Dashboard/HTTP=observe，MCP=runtime dispatch。
> - **Context**: 近期分析会话已锁定该产品骨架，当前源码也体现出 `serve` 同时挂 REST、SSE、MCP HTTP。
> - **Options considered**: 重新定义所有面、完全按 CRUD 分层、沿用三面分工并细化 CRUD。
> - **Chosen**: 沿用三面分工并细化 CRUD。
> - **Rejected**: 重新定义会和已有路线冲突；纯 CRUD 分层不能解释 agent runtime 的安全边界。
> - **Impact**: 后续建议会优先减少重复实现和 deprecated 写入口，而不是把所有功能强行塞进 MCP。

> **Decision**: 将 `fab_update_registry` 和 `fab_append_intent` 视为兼容入口，不作为新职责模型的核心写命令。
> - **Context**: 两个 MCP tool 描述已显式标记 deprecated，并提示改用 `sync-meta`/`doctor --fix` 或 typed Event Ledger。
> - **Options considered**: 继续完善这两个写 tool、立即删除、保留兼容但从新流程降级。
> - **Chosen**: 保留兼容但从新流程降级。
> - **Rejected**: 继续完善会强化旧语义；立即删除有兼容风险。
> - **Impact**: 推荐新增/调整能力时优先放到 CLI/service 或新的受控 MCP read/append 模式。

#### Key Findings

> **Finding**: CLI 入口已有 12 个显式命令/命令组，覆盖 init/update/scan/serve/doctor/sync-meta/human-lint/ledger-append/pre-commit/bootstrap/config/hooks/approve。
> - **Confidence**: High — **Why**: `packages/cli/src/commands/index.ts:1` 到 `:22` 是唯一命令注册表。
> - **Hypothesis Impact**: Confirms hypothesis "CLI 是 control plane"。
> - **Scope**: CLI 命令面、帮助信息、后续重组。

> **Finding**: MCP server 当前只注册 4 个 tools：`fab_plan_context`、`fab_get_rule_sections`、`fab_append_intent`、`fab_update_registry`，外加 bootstrap README resource。
> - **Confidence**: High — **Why**: `packages/server/src/index.ts:50` 到 `:81` 明确注册。
> - **Hypothesis Impact**: Modifies hypothesis "MCP 已覆盖完整 CRUD" 为 "MCP 主要是 runtime context + 兼容写入口"。
> - **Scope**: MCP tool surface、agent 使用协议。

> **Finding**: HTTP app 挂载了 REST 查询/审批、SSE 观察和 MCP HTTP transport，是 Dashboard 与 MCP 共用的 server runtime。
> - **Confidence**: High — **Why**: `packages/server/src/http.ts:222` 到 `:253` 注册 REST、events、`/mcp`。
> - **Hypothesis Impact**: Confirms hypothesis "server 是多协议承载层，不等于 MCP tools 本身"。
> - **Scope**: server package 边界、serve 命令职责。

> **Finding**: `init` 已经是编排器：preflight/scaffold/bootstrap/mcp/hooks/post-setup，负责创建 `.fabric`、skills、hooks、MCP 配置。
> - **Confidence**: High — **Why**: `packages/cli/src/commands/init.ts:388` 到 `:425` 构建 plan，`:455` 到 `:470` 执行阶段，`:485` 到 `:520` 规划 scaffold 文件。
> - **Hypothesis Impact**: Confirms hypothesis "CLI 负责确定性本地写入"。
> - **Scope**: Create 命令、安装职责。

> **Finding**: `sync-meta` 是 registry 的 canonical rebuild/update/check 命令，而不是 MCP `update-registry`。
> - **Confidence**: High — **Why**: `packages/cli/src/commands/sync-meta.ts:72` 到 `:117` 计算并写 `.fabric/agents.meta.json` 和 `rule-test.index.json`，`:123` 到 `:163` 从 `.fabric/agents/**/*.md` 派生 meta。
> - **Hypothesis Impact**: Confirms hypothesis "registry 应从规则文件派生"。
> - **Scope**: Update 命令、registry 写路径、deprecated MCP tool 替代路线。

> **Finding**: `scan` 存在 CLI 与 HTTP API 两份实现，且 CLI 读取 `fabric.config.json` ignore 规则，HTTP API 使用硬编码 `DEFAULT_IGNORES` 和英文文案。
> - **Confidence**: High — **Why**: `packages/cli/src/commands/scan.ts:36` 到 `:45` 使用 `resolveIgnores(fabricConfig)`；`packages/server/src/api/scan.ts:21` 到 `:50` 内置忽略规则并复制扫描逻辑。
> - **Hypothesis Impact**: Confirms hypothesis "查询/诊断能力存在 service 收敛缺口"。
> - **Scope**: Read/diagnostic 命令、REST API、共享 service。

> **Finding**: MCP tools 的 annotations 已正确区分 read-only 与 destructive，但 deprecated 写工具缺少更细粒度 idempotent/open-world 语义。
> - **Confidence**: Medium — **Why**: 本地 `fab_plan_context` 标记 `readOnlyHint: true`，`fab_update_registry` 标记 `destructiveHint: true`；MCP 官方规范说明 annotations 是行为提示，包括 readOnly/destructive/idempotent/openWorld。
> - **Hypothesis Impact**: Modifies hypothesis "只靠命名区分安全性" 为 "应同时靠 annotation 和职责降级表达安全性"。
> - **Scope**: MCP tool schema、客户端安全提示、未来工具设计。

#### Technical Solutions

> **Solution**: 建立 CRUD 职责矩阵：CLI 管 Create/Update/Delete/Repair，MCP 管 runtime Read/Append telemetry，HTTP 管 Dashboard Read/Approve。
> - **Status**: Proposed
> - **Problem**: 当前命令多但职责散，用户难以判断应该用 `fab sync-meta`、MCP tool 还是 Dashboard API。
> - **Rationale**: 符合现有代码形态和既有产品骨架，风险最高的写操作留在显式 CLI。
> - **Alternatives**: 把所有 CRUD 都暴露为 MCP tools；把 MCP 只留 resource，不保留任何 write。前者风险较高，后者会削弱 agent runtime telemetry。
> - **Evidence**: `packages/cli/src/commands/index.ts:1`, `packages/server/src/index.ts:50`, `packages/server/src/http.ts:222`
> - **Next Action**: Round 2 需要确认是否把该矩阵转成命令重组执行范围。

> **Solution**: 抽出 `scan` service，CLI 和 HTTP API 共用同一实现。
> - **Status**: Proposed
> - **Problem**: CLI/HTTP 双实现导致 ignore、i18n 和 recommendation 文案不一致。
> - **Rationale**: 这是低风险高收益的 service 边界修复。
> - **Alternatives**: 保持重复实现；只让 HTTP 调 CLI。前者继续漂移，后者把 API 绑定到命令输出。
> - **Evidence**: `packages/cli/src/commands/scan.ts:36`, `packages/server/src/api/scan.ts:44`
> - **Next Action**: 可作为 P0 实施项。

> **Solution**: 将 deprecated MCP 写工具从默认推荐链路中移除，仅保留兼容；新增能力优先走 file-first + sync-meta 或 event-ledger 自动记录。
> - **Status**: Proposed
> - **Problem**: `fab_update_registry` 可直接改 meta，与 registry-first/规则文件派生方向冲突。
> - **Rationale**: 当前 tool 描述已写明替代路径，后续应让实现和文档一致。
> - **Alternatives**: 强化 `fab_update_registry` 成完整 CRUD；立即删除。前者违背新架构，后者兼容风险大。
> - **Evidence**: `packages/server/src/tools/update-registry.ts:44`, `packages/cli/src/commands/sync-meta.ts:72`
> - **Next Action**: 需要补测试/文档防回退。

#### Analysis Results

**CRUD responsibility matrix**

| Domain Object | Create | Read | Update | Delete/Repair | Recommended Owner |
|---|---|---|---|---|---|
| `.fabric` scaffold/bootstrap/taxonomy/skills/hooks | `fab init` | `fab doctor`, `fab scan` | `fab init --reapply`, `fab update` | `fab init --force` scoped overwrite | CLI |
| client MCP config | `fab init`, `fab config install` | capability summary | `fab update`, `fab config install` | manual/force overwrite only | CLI |
| rule registry `.fabric/agents.meta.json` | `fab init`, `fab sync-meta` | HTTP `/api/rules`, MCP context tools | `fab sync-meta`, `fab doctor --fix` baseline accept | derived by deleting source rule + sync | CLI/service |
| rule content/context | author edits `.fabric/agents/**/*.md` | MCP `fab_plan_context`, `fab_get_rule_sections`, resource | author edits + `sync-meta` | author deletes + `sync-meta` | Human/CLI, MCP read |
| intent/event ledger | pre-commit, service event writes | HTTP `/api/ledger`, `/events`, history replay | annotation API | no direct delete | service/HTTP; MCP append compatibility only |
| human lock | init template | CLI `human-lint`, HTTP `/api/human-lock` | CLI `approve`, HTTP approve | no direct delete | service shared by CLI/HTTP |
| diagnostics | `scan` report generation | CLI/HTTP scan, doctor | doctor fix for known drift | n/a | shared service |

**Command grouping proposal**

- `fabric init`: first-run scaffold and client enablement.
- `fabric update`: re-apply installed integration surfaces (`mcp`, `hooks`, future bootstrap adapter).
- `fabric sync-meta`: rebuild derived registry and rule-test index from source files.
- `fabric doctor [--fix] [--audit]`: validate and repair known derived/baseline state.
- `fabric scan [--json]`: read-only project detection; should be shared with HTTP `/api/scan`.
- `fabric approve`: human-lock approval workflow; CLI twin of Dashboard approval.
- `fabric serve`: run HTTP/Dashboard/MCP transport.
- Internal/compat: `ledger-append`, `human-lint`, `pre-commit`, `hooks`, `bootstrap`, `config` can stay but should be documented as lower-level plumbing or grouped.

**MCP tool surface proposal**

- Keep as runtime-safe core: `fab_plan_context`, `fab_get_rule_sections`, bootstrap README resource.
- Keep but discourage: `fab_append_intent`, `fab_update_registry` until compatibility window closes.
- Future candidate, if needed: read-only `fab_doctor_status` or resource links to current registry/ledger state, not destructive repair.
- Avoid exposing: direct file delete, force overwrite, package install, hook install, config mutation.

#### Corrected Assumptions
- ~~MCP server command surface should mirror CLI CRUD~~ -> MCP should expose only agent-runtime-safe operations; high-impact file mutation stays CLI/service gated.
- ~~`scan` is already unified because CLI and server both import shared detector~~ -> only framework detector is shared; report construction and recommendations are duplicated.
- ~~`update-registry` is the current preferred registry update path~~ -> its own description says deprecated; `sync-meta` and `doctor --fix` are preferred.

#### Initial Intent Coverage Check (Post-Exploration)
- ✅ Intent 1: “fabric cli 支持的相关命令(增删改查)” — 已通过命令注册表和主要 command 实现梳理。
- ✅ Intent 2: “mcp_server 支持的相关命令(增删改查)” — 已梳理 4 个 MCP tools、resource 和 HTTP/MCP 承载边界。
- 🔄 Intent 3: “相应命令的功能和职责划分” — 已形成初始职责矩阵，还需要用户确认是否按该矩阵进入执行范围。
- 🔄 Intent 4: “优化” — 已提出 scan service 收敛、deprecated tool 降级、命令分层文档化等方向；优先级仍待确认。

#### Open Items
- 是否要把 `config/bootstrap/hooks` 这些低层命令从公开帮助里降级为 advanced/internal？
- 是否需要新增 MCP read-only tool 暴露 doctor/scan 状态，还是 Dashboard REST 已足够？
- `fab_update_registry` 的兼容窗口和测试策略要不要明确为一个版本周期？
- `doctor --fix` 与 `sync-meta` 都能接受/重建 baseline，是否需要更清晰的命令语义边界？

#### Narrative Synthesis
**起点**: 基于用户希望梳理 CLI/MCP CRUD 和职责优化，本轮从命令注册、MCP tool 注册、HTTP API 和共享 services 切入。  
**关键进展**: 发现当前系统不是缺少命令，而是缺少统一职责模型；CLI 和 MCP 已经天然分化，但 `scan` 双实现和 deprecated 写工具让边界变模糊。  
**决策影响**: 用户选择 Deep Dive，使本轮将近期工作流结论纳入背景，并用官方 MCP 规范校验 tool/resource 语义。  
**当前理解**: 最优方向是强化“CLI control / MCP runtime / HTTP observe / service shared”的边界，并将低层兼容写入口降级。  
**遗留问题**: 需要确认下一步是深挖命令重组，还是直接形成可执行改造计划。

---

### Round 2 - Deepen: 命令重组 (2026-04-26T19:05:00+0800)

#### User Input
用户选择“继续深入(Recommended)”并指定“命令重组(Recommended)”。

#### Decision Log

> **Decision**: 命令重组以“公开主路径 / 进阶阶段命令 / 自动化内部命令 / 兼容废弃面”四层表达，而不是删减现有命令。
> - **Context**: README/CLI README 已把 `bootstrap/config/hooks` 写成进阶命令；测试仍要求独立命令与旧 flags 兼容。
> - **Options considered**: 删除低层命令、全部保留同等公开、四层分级。
> - **Chosen**: 四层分级。
> - **Rejected**: 删除低层命令会破坏针对性重跑与测试；全部同等公开会继续制造用户心智负担。
> - **Impact**: 后续建议会优先改帮助、文档、manifest 和测试，不急于破坏 API。

> **Decision**: 将 deprecated MCP 写工具的治理纳入“兼容废弃面”，不与 CLI plumbing 混在一起。
> - **Context**: docs/getting-started 与 SPEC_INTERNAL 已明确新流程不调用 `fab_append_intent` 和 `fab_update_registry`。
> - **Options considered**: 当成 advanced MCP 工具、隐藏但保留、继续公开但强提示 deprecated。
> - **Chosen**: 继续注册但在文档/测试/manifest 中标为 compat/deprecated，后续可进入 hidden/removal。
> - **Rejected**: 当成 advanced 会误导新 client；立即隐藏可能影响旧集成。
> - **Impact**: 新工作流只允许 `fab_plan_context -> fab_get_rule_sections -> edit`。

#### Key Findings

> **Finding**: README 已明确 `fabric init` 自动执行 bootstrap、MCP config 和 git hooks，只有单独重跑阶段才使用独立命令。
> - **Confidence**: High — **Why**: `README.md:36-48` 和 `README.md:86-102` 同时定义 init 变体和进阶命令。
> - **Hypothesis Impact**: Confirms hypothesis "命令重组可以先从公开层级表达开始"。
> - **Scope**: CLI help、README、packages/cli/README、docs/getting-started。

> **Finding**: `fabric serve` 是单独主命令，因为它同时承载 Dashboard、REST API、SSE 和 Streamable HTTP MCP。
> - **Confidence**: High — **Why**: `docs/getting-started.md:90-95` 明确四类承载。
> - **Hypothesis Impact**: Confirms hypothesis "serve 不是普通 plumbing，而是 runtime host 主入口"。
> - **Scope**: serve 命令、Dashboard/MCP 入口。

> **Finding**: 文档已将 MCP 新协议压缩为 `fab_plan_context -> fab_get_rule_sections -> edit`，并要求自动写 typed Event Ledger。
> - **Confidence**: High — **Why**: `docs/getting-started.md:101-107` 和 `docs/SPEC_INTERNAL.md:236-240`。
> - **Hypothesis Impact**: Confirms hypothesis "deprecated tools 不应出现在新工作流"。
> - **Scope**: MCP 工具暴露、bootstrap guidance、lint protected tokens。

> **Finding**: 测试层已经固定 `--plan`、`--reapply` 和 legacy stage flag compatibility，这说明短期不适合删除旧 flags 或低层命令。
> - **Confidence**: High — **Why**: `packages/cli/__tests__/init-cli-surface.test.ts` 覆盖 `--reapply`、`--plan`、legacy `--no-*` notices。
> - **Hypothesis Impact**: Modifies hypothesis "可以直接隐藏/删除旧入口" 为 "先分层与提示，再迁移"。
> - **Scope**: CLI backward compatibility、测试策略。

#### Technical Solutions

> **Solution**: CLI public taxonomy
> - **Status**: Proposed
> - **Problem**: `allCommands` 当前把所有命令平铺注册，用户看到的是实现模块列表，不是操作模型。
> - **Rationale**: 文档已经存在主路径/进阶路径的雏形，应该让 help、tooling manifest 和测试保持一致。
> - **Alternatives**: 删除 low-level commands；保留但只在 README 说明。删除风险高，只靠 README 不足以约束 CLI UX。
> - **Evidence**: `packages/cli/src/commands/index.ts:1`, `README.md:86`, `packages/cli/README.md:18`
> - **Next Action**: 设计命令分组 metadata，并更新 `fabric --help` 或 docs/tooling manifest。

> **Solution**: 命令分层建议
> - **Status**: Proposed
> - **Problem**: 当前公开命令职责不均匀，`init` 与 `config install`、`hooks install` 同时出现在命令面。
> - **Rationale**: 按用户任务分层可以减少重复认知。
> - **Alternatives**: 继续平铺；新增大量 alias。平铺会继续混淆，alias 会扩大维护面。
> - **Evidence**: `README.md:47`, `README.md:86-102`, `docs/initialization.md:22-36`
> - **Next Action**: P0 先改文档/manifest/help，不改命令可用性。

**Proposed CLI levels**

| Level | Commands | Responsibility |
|---|---|---|
| Primary | `init`, `serve`, `doctor`, `approve`, `scan`, `sync-meta`, `update` | 日常用户可直接理解的任务入口 |
| Advanced stage rerun | `bootstrap install`, `config install`, `hooks install` | `init` 或 `update` 的可重跑子阶段 |
| Automation/internal | `pre-commit`, `human-lint`, `ledger-append` | Git hook/CI 调用，不应作为普通上手命令推广 |
| Deprecated/compat | MCP `fab_append_intent`, MCP `fab_update_registry`, legacy `fab_get_rules`/rules context API | 兼容旧流程，不进入新 bootstrap guidance |

#### Analysis Results

**命令重组不是简单改名。** 当前 README 和 getting-started 已经表达了较成熟的用户心智：`fabric init` 是一站式初始化，`fabric serve` 是本地 runtime host，`fabric doctor/approve` 是维护/审批，`fabric sync-meta` 是规则 registry 生成，`fabric bootstrap/config/hooks` 只是重跑阶段。实现层的下一步应让 `fabric --help`、`packages/cli/README.md`、`docs/tooling-manifest.*` 和测试显式反映这个层级。

**`update` 需要补职责描述。** 代码里 `update` 只重跑 MCP 与 hooks；文档主要强调 `init --reapply`。如果保留 `update` 为 primary，应定义为“更新 integration surface，不重建 scaffold”；如果不想扩大用户心智，可把它放到 advanced，保留给脚本或维护者。

**`scan` 适合升为 primary read-only。** roadmap 和 init 设计都把 scan 作为 evidence 入口，但 README 常用命令没有列出 `fabric scan`。鉴于它是无写副作用的诊断入口，可以作为 primary inspection 命令，前提是先收敛 CLI/HTTP 双实现。

**自动化命令应明确为非人工入口。** `pre-commit` 编排 `sync-meta --check-only`、`human-lint`、`ledger-append --staged`，适合作为 hook target；`human-lint` 与 `ledger-append` 不应在主 README 的常用命令中推广。

#### Corrected Assumptions
- ~~命令重组需要马上删除低层命令~~ -> 现阶段更合理的是保持兼容、调整 help/docs/manifest 的公开层级。
- ~~`update` 已经自然属于主命令~~ -> 其职责比 `init --reapply` 窄，需要文档明确或降级为 advanced。
- ~~Dashboard 只读，因此所有写动作都应 CLI-only~~ -> `approve` 已经有 HTTP API 和 CLI 两个入口，但底层 service 共享；重点是限制“任意写”，不是禁止所有 UI 写。

#### Intent Coverage Check
- ✅ Intent 1: CLI 增删改查命令 — Round 1 已覆盖，Round 2 进一步给出公开层级。
- ✅ Intent 2: MCP server 增删改查命令 — Round 1 已覆盖，Round 2 明确 deprecated 写工具退场语义。
- ✅ Intent 3: 功能和职责划分 — 已形成四层 CLI taxonomy 与四面架构边界。
- 🔄 Intent 4: 优化 — 已有候选方案，下一步综合为 recommendations。

#### Open Items
- `update` 是 primary 还是 advanced，需要在实施前决定。
- CLI help 是否能原生支持分组；如果 citty 不支持，需要通过 README/help description 或 `fabric help` 自定义实现。
- `scan` service 放在 shared/node 还是 server service，需要结合依赖方向决定。

#### Narrative Synthesis
**起点**: 基于 Round 1 的职责矩阵，本轮专门追踪文档、测试和命令面是否已有分层依据。  
**关键进展**: README/getting-started/SPEC 已经支持“主路径 + 进阶阶段 + 废弃兼容”的模型，测试则说明短期必须保留兼容入口。  
**决策影响**: 用户选择命令重组，使优化方向从“新增命令”转为“公开层级、帮助面、服务收敛和兼容退场”。  
**当前理解**: 最稳妥的重组路径是先文档和 help 分层，再抽 shared service，最后处理 deprecated MCP tools 的隐藏/移除。  
**遗留问题**: `update` 的最终层级和 `scan` service 的归属需在实施计划中确认。

---

## Decision Trail

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|---|---|---|---|
| 1 | fabric cli 支持的相关命令(增删改查) | ✅ Addressed | Round 1, Round 2, Rec #1/#4 | 已覆盖主命令、进阶命令、自动化命令。 |
| 2 | mcp_server 支持的相关命令(增删改查) | ✅ Addressed | Round 1, Round 2, Rec #3/#5 | 已区分 read-only core 与 deprecated write compat。 |
| 3 | 相应命令的功能和职责划分 | ✅ Addressed | Round 1 CRUD matrix, Rec #1 | 已形成 CLI/MCP/HTTP/service 四面边界。 |
| 4 | 优化 | ✅ Addressed | Rec #1-#5 | 已输出可执行优化路线。 |

### Findings Coverage Matrix

| # | Finding (Round) | Disposition | Target |
|---|---|---|---|
| 1 | CLI 是 control plane (R1) | recommendation | Rec #1, Rec #4 |
| 2 | MCP 是 read-only core + deprecated writes (R1) | recommendation | Rec #3, Rec #5 |
| 3 | HTTP 同时承载 REST/SSE/Dashboard/MCP (R1) | absorbed | Rec #5 |
| 4 | init 是阶段编排器 (R1) | absorbed | Rec #1 |
| 5 | sync-meta 是 registry canonical rebuild (R1) | recommendation | Rec #3, Rec #4 |
| 6 | scan 双实现漂移 (R1) | recommendation | Rec #2 |
| 7 | README 已有主/进阶命令分层 (R2) | recommendation | Rec #1 |
| 8 | serve 是 runtime host 主入口 (R2) | absorbed | Rec #1, Rec #5 |
| 9 | deprecated MCP tools 已被新文档排除 (R2) | recommendation | Rec #3 |
| 10 | 测试要求兼容旧入口 (R2) | absorbed | Rec #1 |

## Synthesis & Conclusions

### Executive Summary

Fabric 当前的 CLI/MCP 命令面已经有足够能力，真正需要优化的是职责表达和实现收敛。目标模型应是：

- CLI = control plane：初始化、安装、同步、修复、审批、hook 自动化。
- MCP = runtime context plane：`fab_plan_context -> fab_get_rule_sections -> edit`，不扩成完整 CRUD。
- HTTP/Dashboard = observe/approval plane：查询、可视化、有限审批。
- Services = shared logic：scan、doctor、ledger、human-lock、registry 等业务逻辑不能在 CLI/HTTP/MCP 各复制一份。

### Key Conclusions

1. CLI 命令应按 Primary / Advanced / Automation / Deprecated 四层公开，而不是平铺。
2. MCP 新协议应保持 read-only core；`fab_append_intent` 和 `fab_update_registry` 只做兼容面。
3. `scan` 是最优先的代码收敛点，应抽共享 service。
4. `update`、`sync-meta`、`doctor --fix` 的边界需要写清：integration surface、derived registry、baseline repair 是三件事。

### Recommendations

1. **建立 CLI 命令公开层级并同步 help/docs/manifest** [high]  
   让 `init/serve/doctor/approve/scan/sync-meta/update` 与 `bootstrap/config/hooks`、`pre-commit/human-lint/ledger-append`、deprecated MCP tools 处于不同公开层级。

2. **抽取共享 scan service，消除 CLI 与 HTTP 双实现** [high]  
   CLI 负责渲染和 i18n，HTTP 负责 JSON 响应，业务判断只保留一份。

3. **制定 deprecated MCP 写工具退场策略** [high]  
   保留兼容但从 bootstrap guidance、getting-started 和新 workflow 测试中彻底移除。

4. **明确 update、sync-meta、doctor --fix 的边界** [medium]  
   避免用户混淆重跑 integration、重建 registry、接受 baseline 修复。

5. **保留 MCP read-only core，只考虑新增读状态工具或资源** [medium]  
   不把 destructive file mutation 暴露为默认 MCP CRUD。

### Remaining Open Questions

- `update` 最终应归入 primary 还是 advanced？
- `scan` service 放在 shared/node 还是 server service？
- deprecated MCP 写工具的隐藏/移除窗口绑定哪个版本？

### Recommendation Review Summary

| # | Action | Priority | Steps | Review Status | Notes |
|---|---|---|---|---|---|
| 1 | 建立 CLI 命令公开层级并同步 help/docs/manifest | high | 3 | pending | 等待用户确认 |
| 2 | 抽取共享 scan service | high | 3 | pending | 等待用户确认 |
| 3 | 制定 deprecated MCP 写工具退场策略 | high | 3 | pending | 等待用户确认 |
| 4 | 明确 update/sync-meta/doctor --fix 边界 | medium | 2 | pending | 等待用户确认 |
| 5 | 保留 MCP read-only core，只考虑新增读状态工具或资源 | medium | 2 | pending | 等待用户确认 |

## Session Statistics

- Total discussion rounds: 2
- Key findings: 10
- Recommendations: 5
- Artifacts generated: discussion.md, exploration-codebase.json, research.json, explorations.json, conclusions.json
- Decision count: 4
