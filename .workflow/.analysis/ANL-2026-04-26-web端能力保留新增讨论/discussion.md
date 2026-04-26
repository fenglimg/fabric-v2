# Analysis Discussion

**Session ID**: ANL-2026-04-26-web端能力保留新增讨论  
**Topic**: 在 ANL-2026-04-26-fabric-cli-mcp-server-crud-职责优化 的前提下，讨论当前 Web 端应该保留和新增哪些能力。  
**Started**: 2026-04-26T20:15:00+08:00  
**Dimensions**: architecture, implementation, decision  
**Depth**: standard  

## Table of Contents
- [Analysis Context](#analysis-context)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
- [Decision Trail](#decision-trail)
- [Synthesis & Conclusions](#synthesis--conclusions)

## Current Understanding

### What We Established
- 前提会话已经锁定职责边界：CLI 是本地高影响写入 control plane，MCP 是 agent runtime context plane，HTTP/Dashboard 是 observe/approval plane。
- 当前 Web 端已有六个实页：Topology、Rules、Locks、Timeline、History、Doctor；另有 forensic、semantic、ledger 三个占位模块。
- Web 当前只有两个窄写入口：human-lock approve 与 intent annotation。它们是人类审批和审计追加，不等同于规则/registry/文件 CRUD。
- Web 最应该新增的是解释型和观察型能力，而不是修复型或文件变更型能力。

### What Was Clarified
- ~~Web 端应该补齐 CLI/MCP 的 CRUD~~ -> Web 端应该补齐观察、解释、审批和 readiness，而不是接管 CLI 或 MCP 的写入职责。
- ~~Doctor 页面可以自然加 fix 按钮~~ -> Doctor fix 属于 CLI `doctor --fix`，Web 可以展示建议命令，但不应直接执行修复。

### Key Insights
- Web 的产品价值不是“能改更多”，而是“让人看懂系统为什么这么判定、现在是否健康、下一步应该用哪个面完成动作”。
- 占位模块如果继续留在一等导航，会制造产品承诺；应实装成真实观察页或降级隐藏。

## Analysis Context
- Focus areas: Web 端能力边界、保留能力、新增能力、禁止新增能力。
- Perspectives: 技术 + 架构 + 产品职责。
- Prior session: `.workflow/.analysis/ANL-2026-04-26-fabric-cli-mcp-server-crud-职责优化/`
- Constraint: 本轮只读分析，不修改源码；当前仓库缺少 `.fabric/agents.meta.json`，Fabric MCP 规则上下文不可用，改用源码与既有分析文件作为证据。

## Initial Questions
- 在 CLI/MCP 职责优化之后，Web 端还应该承担哪些职责？
- 当前已有 Web 页面中哪些应保留、哪些应合并、哪些应降级？
- 哪些新增能力能增强 Web 的价值，但不破坏 CLI control plane 和 MCP runtime context plane？
- 哪些能力明确不应该进入 Web？

## Initial Decisions

> **Decision**: 本轮直接以前提会话的职责边界为硬约束，不重新讨论 CLI/MCP CRUD 分工。
> - **Context**: 用户明确指定“在 ANL-2026-04-26-fabric-cli-mcp-server-crud-职责优化 的前提下”。
> - **Options considered**: 重新分析 CLI/MCP/Web 三面；继承前提结论并专注 Web；只列 UI 页面清单。
> - **Chosen**: 继承前提结论并专注 Web 能力边界。
> - **Rejected**: 重新分析会重复前一会话；只列页面清单无法回答“应该新增什么”。
> - **Impact**: 本轮建议以 Web observe/approval/explain 为边界，不建议新增完整 CRUD。

---

## Discussion Timeline

### Round 1 - Exploration (2026-04-26T20:20:00+08:00)

#### User Input
用户要求基于既有 CLI/MCP CRUD 职责优化结论，讨论当前 Web 端应该保留和新增哪些能力。

#### Decision Log

> **Decision**: Web 端采用 observe + explain + approve 定位。
> - **Context**: 前提会话定义 HTTP/Dashboard 是 observe/approval plane；当前 Web 已通过 REST/SSE 展示规则、ledger、doctor、history，并只提供 approve/annotate 两个窄写入口。
> - **Options considered**: Web 补齐 CRUD；Web 保持纯只读；Web 作为 observe + explain + approve。
> - **Chosen**: observe + explain + approve。
> - **Rejected**: 补齐 CRUD 会与 CLI control plane 冲突；纯只读会损失 human-lock approval 和 human annotation 这类人类确认价值。
> - **Impact**: 新增能力只推荐 readiness、status、boundary visualization、audit/semantic explain 等，不推荐规则编辑或修复按钮。

> **Decision**: Doctor/Scan 类能力在 Web 中只展示诊断与建议命令，不直接执行修复。
> - **Context**: `DoctorView` 当前只调用 GET `/api/doctor`；前提会话已将 `doctor --fix` 归入 CLI 本地修复能力。
> - **Options considered**: Web 直接 POST fix；Web 展示建议命令；完全不展示诊断。
> - **Chosen**: Web 展示诊断和建议命令。
> - **Rejected**: 直接 POST fix 会扩大 Web 写入面；不展示诊断会削弱 Dashboard 的观察价值。
> - **Impact**: 建议新增 Scan/Readiness 页面，但必须 read-only。

#### Key Findings

> **Finding**: 当前 Web 已有六个实页和三个占位模块。
> - **Confidence**: High — **Why**: `packages/dashboard/src/app.tsx:16` 定义全部路由，`:166-174` 渲染六个实页，`:167-169` 渲染三个占位页。
> - **Hypothesis Impact**: Confirms hypothesis "Web 已有观察/诊断基础"。
> - **Scope**: Dashboard 导航、保留能力、占位模块治理。

> **Finding**: 当前 Web 写入口仅限 approval 和 annotation。
> - **Confidence**: High — **Why**: `packages/dashboard/src/api/client.ts:187-194` 只有 `approveHumanLock` 和 `annotateIntent` 两个 POST client；服务端对应 `packages/server/src/api/human-lock.ts:49-63` 和 `packages/server/src/api/intent.ts:72-87`。
> - **Hypothesis Impact**: Confirms hypothesis "Web 没有成为完整 CRUD 面"。
> - **Scope**: Web 写能力边界。

> **Finding**: Web 已具备 rules context explain 的雏形。
> - **Confidence**: High — **Why**: `packages/dashboard/src/views/rule-topology.tsx:23-31` 同时读取 rules meta 与 rules context，`:78-80` 展示 coverage heatmap 与 hit reason panel。
> - **Hypothesis Impact**: Confirms hypothesis "Web 新增 semantic explain 应复用现有 context API"。
> - **Scope**: semantic 模块实装、规则命中解释。

> **Finding**: Scan API 已有 client 和 server，但 Web 未展示 scan readiness。
> - **Confidence**: High — **Why**: `packages/dashboard/src/api/client.ts:175-177` 已有 `getScan()`；`packages/server/src/api/scan.ts:134-167` 提供 `/api/scan` 报告。
> - **Hypothesis Impact**: Modifies hypothesis "新增 scan 需要新后端" 为 "前端缺页，后端需先 service 收敛"。
> - **Scope**: 新增 Readiness 页面、scan service 收敛。

> **Finding**: HTTP app 同时承载 REST、SSE、MCP 和 Dashboard static，但 Web 不需要直接调用 MCP tools。
> - **Confidence**: High — **Why**: `packages/server/src/http.ts:222-253` 注册 REST APIs、`/events`、`/mcp` 和 static Dashboard。
> - **Hypothesis Impact**: Modifies hypothesis "Web 可作为 MCP 操作控制台" 为 "Web 应展示 MCP runtime 状态和边界，不代理 tools"。
> - **Scope**: MCP runtime status、tooling boundary view。

#### Technical Solutions

> **Solution**: 保留 Web 当前六个实页，并把它们定义为 Dashboard core。
> - **Status**: Proposed
> - **Problem**: Web 已有多个诊断/观察能力，但产品层级仍混有占位模块。
> - **Rationale**: 六个实页都符合 observe/approval 边界，且已有 REST/SSE 证据。
> - **Alternatives**: 只保留 topology；把所有模块合并成一个页面。前者削弱可视化价值，后者降低可扫描性。
> - **Evidence**: `packages/dashboard/src/app.tsx:166-174`
> - **Next Action**: 补页面状态测试和导航分组。

> **Solution**: 新增 Scan/Readiness 页面，但只读展示 `/api/scan`，并提示 CLI 命令。
> - **Status**: Proposed
> - **Problem**: 用户需要知道项目是否 ready，但 init/update/sync-meta 不应由 Web 执行。
> - **Rationale**: `getScan()` 和 `/api/scan` 已存在，readiness 是 Web 观察面的自然扩展。
> - **Alternatives**: Web 直接执行 `fab init`；不做 scan 页面。直接执行破坏职责边界，不做则浪费已有 API。
> - **Evidence**: `packages/dashboard/src/api/client.ts:175-177`, `packages/server/src/api/scan.ts:134-167`
> - **Next Action**: 先完成 scan shared service 收敛，再新增页面。

> **Solution**: 新增 MCP Runtime Status / Tooling Boundary 视图。
> - **Status**: Proposed
> - **Problem**: 前提会话的 CLI/MCP/HTTP 分工需要用户可见，否则 Web 用户仍会期待 Dashboard 直接修复或编辑。
> - **Rationale**: Web 最适合解释“该用哪个面完成动作”，同时展示 REST/SSE/MCP 是否在线。
> - **Alternatives**: 在 README 解释即可；把 MCP tools 包装成 Dashboard 按钮。README 不够现场，Dashboard 按钮会模糊职责。
> - **Evidence**: `packages/server/src/http.ts:222-253`, `packages/dashboard/src/app.tsx:134-149`
> - **Next Action**: 设计 `/api/status` 或复用 doctor/status 数据，避免暴露 tool invocation。

#### Analysis Results

**应该保留**
- Rules Tree：保留。它是 registry/meta 可视化与规则依赖观察面。
- Rule Topology：保留并强化。它已经接近 semantic explain，可以展示 L0/L1/L2 命中与 coverage。
- Human Lock：保留。approval 是 Web 最合理的窄写入口。
- Intent Timeline：保留。ledger 观察与 human annotation 属于审计追加，不是高影响 CRUD。
- History Replay：保留。它解释规则状态如何随 ledger 演化。
- Doctor：保留但只读。展示诊断、审计与建议命令，不执行 fix。

**应该新增**
- Scan / Readiness：展示框架识别、README/CONTRIBUTING、file count、existing Fabric、recommendations；建议 CLI 命令但不执行。
- Runtime Status：展示 REST/SSE/MCP 状态、auth/token 模式、last event、meta revision、cache/resource notification 状态。
- Tooling Boundary / Manifest：展示 Primary CLI、Advanced CLI、Automation/Internal、MCP read-only core、Deprecated/Compat surfaces，帮助用户判断该用哪个入口。
- Ledger Analysis：把占位 `ledger` 实装为统计和过滤视图，展示 event ledger/legacy ledger/audit violations，而不是仅 timeline。
- Semantic Explain：把占位 `semantic` 实装为 path 输入后的 rule hit simulation，复用 `/api/rules/context`。
- Forensic / Audit：把占位 `forensic` 实装为 doctor audit violations、protected path drift、business anchor stale/missing 的聚合视图；如果短期不做，应降级隐藏。

**不应该新增**
- 规则文件 CRUD、registry node 编辑、直接写 `.fabric/agents.meta.json`。
- `sync-meta`、`doctor --fix`、`init`、`update`、config/hooks/bootstrap 安装的 Web 执行按钮。
- MCP tool 调用控制台，尤其是 deprecated write tools 的按钮。
- 直接删除 ledger、lock、rules 的管理界面。

#### Corrected Assumptions
- ~~Web 应该补齐 CRUD 管理后台~~ -> Web 应该补齐观察、解释、审批和 readiness。
- ~~已有 `/api/scan` 就可以直接做 Scan 页面~~ -> 页面可以做，但应先处理前提会话指出的 CLI/HTTP scan 双实现问题。
- ~~MCP 与 Dashboard 同在 HTTP app，因此 Dashboard 可直接代理 MCP tool~~ -> 同宿主不等于同职责；Dashboard 应展示 MCP 状态，不代理 tool 调用。

#### Intent Coverage Check
- ✅ Intent 1: “在前提会话基础上” — 已继承 CLI/MCP/HTTP 三面职责边界。
- ✅ Intent 2: “Web 端应该保留哪些能力” — 已列出六个保留实页与两个保留窄写入口。
- ✅ Intent 3: “Web 端应该新增哪些能力” — 已列出 Scan/Readiness、Runtime Status、Tooling Boundary、Ledger Analysis、Semantic Explain、Forensic Audit。

#### Open Items
- Scan/Readiness 应作为 Doctor 子视图还是独立导航？
- `forensic/semantic/ledger` 是全部实装，还是先隐藏不成熟模块？
- Tooling manifest 是否已有目标位置，还是需要先创建 `docs/tooling-manifest.json`？

#### Narrative Synthesis
**起点**: 基于 CLI/MCP 职责优化结论，本轮从现有 Dashboard 路由、REST API、SSE 和两个 POST 写入口切入。  
**关键进展**: 确认 Web 目前并未越界成 CRUD 控制面，真实写入只限 approval 和 annotation；主要缺口是 readiness、runtime/status、边界解释和占位模块实装。  
**决策影响**: 将 Web 定位为 observe + explain + approve，使新增建议避开 init/update/sync-meta/doctor fix 等 CLI 职责。  
**当前理解**: Web 应让系统状态和职责边界更可见，而不是让用户在浏览器里执行更多高影响写操作。  
**遗留问题**: 需要决定新增页面优先级和占位模块处理策略。

---

## Decision Trail

| # | Decision | Reason | Impact |
|---|---|---|---|
| 1 | 继承前提会话的 CLI/MCP/HTTP 职责边界 | 用户明确要求以前提会话为基础 | 本轮不重新定义 CRUD，只讨论 Web 边界 |
| 2 | Web 定位为 observe + explain + approve | 与当前实现和前提架构一致 | 新增能力优先 read-only/approval，不做修复控制面 |
| 3 | Doctor/Scan 在 Web 中只展示诊断与建议命令 | 修复属于 CLI control plane | 禁止 Web 直接执行 `doctor --fix`、`sync-meta`、`init/update` |

## Synthesis & Conclusions

### Executive Summary
Web 端应该保留当前已经落地的观察和审批能力，并新增能解释系统状态和职责边界的页面。它不应该成为规则、registry、doctor fix 或 MCP tool 的 CRUD 管理后台。

### Recommendations
1. 保留并强化 Topology、Rules、Locks、Timeline、History、Doctor 六个实页。
2. 新增 Scan/Readiness 页面，但先完成 scan shared service 收敛，只展示建议 CLI 命令。
3. 新增 MCP Runtime Status 与 Tooling Boundary 可视化，用来解释 CLI/MCP/Web 分工。
4. 将 forensic、semantic、ledger 占位模块实装为真实观察页，或从主导航降级。
5. 明确禁止 Web 新增高影响写能力：规则 CRUD、registry 编辑、sync-meta、doctor fix、init/update、hooks/config 安装、MCP tool 控制台。

### Intent Coverage Matrix
| # | Original Intent | Status | Where Addressed | Notes |
|---|---|---|---|---|
| 1 | 以前提会话为基础 | Addressed | Round 1, Initial Decisions | 继承 CLI/MCP/HTTP 三面边界 |
| 2 | Web 端应该保留哪些能力 | Addressed | Round 1, Analysis Results | 六个实页与两个窄写入口 |
| 3 | Web 端应该新增哪些能力 | Addressed | Round 1, Analysis Results | readiness/status/tooling/ledger/semantic/forensic |

### Findings Coverage Matrix
| # | Finding | Disposition | Target |
|---|---|---|---|
| 1 | Web 应定位为 observe + explain + approve | recommendation | Rec #1, Rec #5 |
| 2 | approval/annotation 是合理窄写入口 | recommendation | Rec #1, Rec #5 |
| 3 | Scan API 已存在但需 service 收敛 | recommendation | Rec #2 |
| 4 | Web 可承担职责边界解释 | recommendation | Rec #3 |
| 5 | 三个占位模块需要治理 | recommendation | Rec #4 |

### Session Statistics
- Discussion rounds: 1
- Key findings: 5
- Recommendations: 5
- Source files reviewed: 10+
- Source code modified: none

---

### Round 2 - Correction: 当前分支 Web 能力校正 (2026-04-26T20:45:00+08:00)

#### User Input
用户指出当前分支已拆掉 Human Lock / Approval Web 写路径，要求基于当前实现重新校正 Web 端能力判断。用户随后确认推荐将 Web 重构收敛为四个一级主题。

#### Decision Log

> **Decision**: 不再把 `Approval / Human Lock` 作为当前 Web 一级主题或强保留能力。
> - **Context**: 当前工作树中 `packages/dashboard/src/views/human-lock.tsx`、`lock-card.tsx`、`packages/server/src/api/human-lock.ts` 以及 approve service/API client 已不存在；`http.ts` 也没有 human-lock REST 注册。
> - **Options considered**: 保留 Approval 一级导航并等待未来数据源；把 annotation 归入 Approval；移除 Approval 一级主题。
> - **Chosen**: 移除 Approval 一级主题。
> - **Rejected**: 保留 Approval 会制造空概念；annotation 是 ledger 审计补充，不是审批系统。
> - **Impact**: 最终推荐从五主题 `Readiness / Rules Explain / Timeline / Approval / Health` 改为四主题 `Readiness / Rules Explain / Timeline / Health`。

> **Decision**: 将 `Boundary / Runtime` 放入 `Health` 子视图，而不是单独作为一级主题。
> - **Context**: Boundary/Runtime 很重要，但它服务于健康诊断：REST/SSE/MCP 是否在线、当前 meta revision、last event、auth/token、哪些动作该用 CLI/MCP/Web。
> - **Options considered**: 做成第五个一级主题；放入 Readiness；放入 Health。
> - **Chosen**: 放入 Health，作为 `Runtime & Boundaries` 子视图。
> - **Rejected**: 单独一级主题会让导航过重；放入 Readiness 会混淆“安装准备”和“运行诊断”。
> - **Impact**: Web 信息架构更收敛，避免为了凑五个主题重造空壳。

#### Key Findings

> **Finding**: Human Lock / Approval Web 写路径在当前分支已不再是现有能力。
> - **Confidence**: High — **Why**: `rg` 只在服务测试中发现 `.fabric/human-lock.json` fixture；Dashboard API client 已无 `approveHumanLock`，App 路由也无 `locks`。
> - **Hypothesis Impact**: Refutes hypothesis "Web 当前有两个窄写入口 approval + annotation"。
> - **Scope**: Web 导航、保留能力、最终推荐。

> **Finding**: 当前仍可确认的 Web 写入口只剩 `annotateIntent`。
> - **Confidence**: High — **Why**: `packages/dashboard/src/api/client.ts` 只保留 `annotateIntent` POST；`IntentTimelineView` 调用它补充 human annotation。
> - **Hypothesis Impact**: Modifies hypothesis "Web 是 observe + explain + approve" 为 "Web 是 observe + explain + annotate"。
> - **Scope**: Timeline、ledger 审计、写能力边界。

> **Finding**: `human_locked_nearby` 仍存在于规则上下文 payload，但 UI 不应把它描述成已落地能力。
> - **Confidence**: Medium — **Why**: client 类型仍有 `human_locked_nearby`，但独立 human-lock 数据源和锁页面已拆除。
> - **Hypothesis Impact**: Modifies hypothesis "Rules Explain 包含 human lock nearby" 为 "字段可保留为 legacy/future extension，不作为现有 UI 能力"。
> - **Scope**: Rules Explain 文案、未来数据源设计。

> **Finding**: Forensic / Semantic / Ledger 仍是旧导航空壳，不应被视作已实现能力。
> - **Confidence**: High — **Why**: `app.tsx` 中三个 route 仍渲染 `ModulePlaceholder`。
> - **Hypothesis Impact**: Confirms hypothesis "旧占位模块应实装或降级"。
> - **Scope**: Web 重构导航。

#### Corrected Assumptions
- ~~Web 当前有 approval + annotation 两个窄写入口~~ -> 当前只剩 annotation；Approval/Human Lock 线已拆掉，不能作为现有能力。
- ~~五个一级主题中应保留 Approval~~ -> 当前推荐四个一级主题：Readiness、Rules Explain、Timeline、Health。
- ~~Boundary / Runtime 应独立成第五主题~~ -> 更适合归入 Health 的 Runtime & Boundaries 子视图。
- ~~Rules Explain 可以宣传 human lock nearby 为现有能力~~ -> 只能作为 legacy/future 字段，当前 UI 不应依赖它。

#### Revised Information Architecture

**推荐四个一级主题**

```text
Readiness
Rules Explain
Timeline
Health
```

**Readiness**
- Project Scan
- Setup Status
- Framework / README / CONTRIBUTING readiness
- Recommended CLI Next Steps
- 只读，不执行 `fab init`、`fab update`、`sync-meta`

**Rules Explain**
- Rule Topology
- Rules Tree
- Rule Hit Explanation
- Coverage / Dependencies
- L0 / L1 / L2 context
- `human_locked_nearby` 仅作为 legacy/future extension，不作为当前核心能力

**Timeline**
- Intent Timeline
- Human annotation via `annotateIntent`
- History Replay
- Event / legacy ledger status
- 状态演化与证据链

**Health**
- Doctor Report
- Fixable / Manual / Warning Issues
- Forensic / Audit
- Runtime Status
- Tooling Boundary
- 只展示建议 CLI，不直接执行 `doctor --fix`

#### Revised Recommendations
1. 一级导航收敛为 `Readiness / Rules Explain / Timeline / Health`。
2. 移除或降级旧的一等占位 `Forensic / Semantic / Ledger`；对应能力并入四主题子视图。
3. 不保留 `Approval` 一级主题，除非未来重新设计新的确认模型和稳定数据源。
4. 把 `topology + rules` 并入 `Rules Explain`，`timeline + history` 并入 `Timeline`，`doctor + runtime/boundary + audit` 并入 `Health`。
5. 新增 `Readiness` 页面接入已有 `getScan()`，但保持只读，并提示 CLI 下一步。

#### Narrative Synthesis
**起点**: 用户指出分析文档仍基于旧快照，把已拆掉的 Human Lock / Approval 当成当前能力。  
**关键进展**: 重新核对当前分支后，确认 Approval 不应再作为一级主题；Web 当前稳定主线是规则解释、时间线、健康诊断和 readiness。  
**决策影响**: 最终信息架构从五主题改为四主题，并将 Runtime/Boundary 归入 Health。  
**当前理解**: Web 重构应围绕四个真实问题组织：项目是否 ready、规则为什么命中、发生过什么、系统是否健康。  
**遗留问题**: 后续实现时需决定各主题下的具体路由层级和旧占位路由迁移方式。
