# Analysis Discussion

**Session ID**: ANL-2026-04-25-ledger-意图账本-重构
**Topic**: Ledger (意图账本) 重构：通过服务器已有接口打点记录，以及规则文件更改如何审计
**Started**: 2026-04-25T00:00:00+08:00
**Dimensions**: architecture, implementation, decision, security
**Depth**: standard

## Table of Contents
- [Analysis Context](#analysis-context)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
- [Synthesis & Conclusions](#synthesis--conclusions)
- [Decision Trail](#decision-trail)

## Current Understanding

### What We Established
- Fabric 现在已经有两条记录轨道：`.fabric/.intent-ledger.jsonl` 记录 AI/human intent，`.fabric/audit.jsonl` 记录协议级打点事件。
- `fab_append_intent` 已经是服务器侧写入 Ledger 的正式接口，并且会 best-effort 追加 `edit_intent` 合规审计。
- `fab_get_rule_sections` 已经在读取规则 section 后写入 `rule_selection` audit 事件，记录 selection token、required/selected/final stable ids 和 AI selection reasons。
- `doctor` 已经能通过 agents meta hash 对比识别规则文件 drift，但当前只输出检查状态，不会把 drift 事实写入 Ledger。

### What Was Clarified
- ~~Ledger 应承担所有遥测事件~~ -> Ledger 更适合记录“完成了什么变更/发现了什么需要追责的事实”；高频、协议过程性事件继续留在 audit log。
- ~~规则文件变更审计必须由编辑入口实时记录~~ -> doctor/hash 对比适合作为兜底发现机制，但需要补充“发现事件 -> 归因/确认 -> 更新 meta”的闭环。

### Key Insights
- 下一步不是新增一套平行日志，而是把已有 `appendIntent`、`audit-log`、`doctor` 和 `updateRegistry` 串成分层审计模型。
- 规则文件 drift 的审计最小闭环应包括 old hash、current hash、node/stable id、文件路径、发现方式、后续处理动作，以及是否关联到已有 ledger/audit 事件。

## Analysis Context
- Focus areas: 服务器已有接口打点记录、规则文件 hash drift 审计
- Perspective: 架构实现
- Depth: Standard

## Initial Questions
- 现有服务器接口中哪些已经在写 Ledger 或 audit log？
- Ledger 与 audit log 应该如何分工，避免把过程遥测和意图事实混在一起？
- doctor 识别规则文件 hash drift 后，是否应该自动写 Ledger？写什么粒度？
- `fab_update_registry` 这类规则元数据变更入口是否应该自动追加 intent/audit？

## Initial Decisions

> **Decision**: 本次分析采用“接口+审计 / 架构实现 / Standard”范围。
> - **Context**: 用户明确提出两个功能：服务器已有接口打点记录、规则文件更改审计。
> - **Options considered**: 只看服务器接口；只看规则审计；同时覆盖接口和审计。
> - **Chosen**: 同时覆盖接口和审计 - **Reason**: 两者共享 Ledger/audit 分层边界，分开分析容易得出重复或冲突模型。
> - **Rejected**: 单点视角 - **Reason**: 无法解释 doctor drift 发现与 append intent 之间的闭环。
> - **Impact**: 探索范围集中在 `append-intent`、`audit-log`、`doctor`、`rule-sections`、`update-registry` 和 Ledger schema。

---

## Discussion Timeline

### Round 1 - Codebase Exploration (2026-04-25T00:00:00+08:00)

#### User Input
用户希望讨论 Ledger 重构，重点是：
- 如何通过服务器已经拥有的接口进行打点记录。
- 对规则文件的更改如何审计，一个方向是 doctor 识别已存在文件更改并做 hash 对比后，意图账本记录具体更改过程。

#### Decision Log

> **Decision**: 保持 Ledger 与 audit log 分层，而不是把所有事件统一塞进 Ledger。
> - **Context**: 现有代码已经把 `get_rules`、`rule_selection`、`edit_intent` 放在 `.fabric/audit.jsonl`，把 AI/human intent 放在 `.fabric/.intent-ledger.jsonl`。
> - **Options considered**: Ledger 统一承载所有事件；audit log 继续承载过程遥测、Ledger 承载意图事实；新增第三种日志。
> - **Chosen**: audit log 记录过程与合规证据，Ledger 记录完成的变更意图和需要审计追踪的事实 - **Reason**: 符合现有 schema，避免高频读规则事件污染用户可读时间线。
> - **Rejected**: 全部进 Ledger 会降低信噪比；第三种日志会增加认知和查询成本。
> - **Impact**: 后续建议会围绕“扩展事件类型/关联字段”，而不是替换存储。

#### Key Findings

> **Finding**: `appendIntent` 是现有服务器侧 Ledger 写入口，并且会自动补一组 edit intent 合规审计。
> - **Confidence**: High - **Why**: `packages/server/src/services/append-intent.ts:17` 写入 ledger，`packages/server/src/services/append-intent.ts:30` 调用 `appendEditIntentAuditEvents`。
> - **Hypothesis Impact**: Confirms hypothesis "已有服务器接口可以作为打点入口"。
> - **Scope**: MCP tool `fab_append_intent`、Ledger append、edit intent compliance。

> **Finding**: `audit-log` 当前已有三类事件：`get_rules`、`edit_intent`、`rule_selection`。
> - **Confidence**: High - **Why**: `packages/server/src/services/audit-log.ts:16`、`:21`、`:30` 定义三类 audit entry。
> - **Hypothesis Impact**: Modifies hypothesis "Ledger 负责所有打点" 为 "audit log 已承担协议打点"。
> - **Scope**: 合规审计、doctor audit、规则选择链路。

> **Finding**: `fab_get_rule_sections` 已经在规则 section 获取后记录 `rule_selection` 事件。
> - **Confidence**: High - **Why**: `packages/server/src/services/rule-sections.ts:158` 调用 `appendRuleSelectionAuditEvent`。
> - **Hypothesis Impact**: Confirms hypothesis "服务器已有接口可以直接打点"。
> - **Scope**: selection token、required L0/L2、AI-selected L1、final stable ids。

> **Finding**: doctor 能发现 agents meta hash drift，但只生成检查结果，不写 Ledger。
> - **Confidence**: High - **Why**: `packages/server/src/services/doctor.ts:511` 检查文件 hash，`:529` 比对 actual hash 与 node hash，`:544` 返回 driftCount；未发现 append ledger 调用。
> - **Hypothesis Impact**: Confirms hypothesis "doctor hash 对比可作为规则变更审计触发点"，但当前缺少记录闭环。
> - **Scope**: 规则文件变更审计、doctor --fix/repair flow、规则 registry 更新。

> **Finding**: `fab_update_registry` 是规则元数据变更的服务器工具入口，但当前只写 agents.meta.json，不写 Ledger/audit。
> - **Confidence**: High - **Why**: `packages/server/src/services/update-registry.ts:20` 到 `:48` 完成 meta 写入和 cache invalidation；tool 描述要求用它替代直接编辑 meta。
> - **Hypothesis Impact**: Adds new audit candidate "registry mutation should be recorded"。
> - **Scope**: 规则注册表变更、meta revision、破坏性 MCP tool。

#### Technical Solutions

> **Solution**: 引入分层审计模型：Ledger = 事实时间线，audit log = 协议证据链。
> - **Status**: Proposed
> - **Problem**: 服务器接口打点和规则文件审计需要共享证据，又不能混淆高频遥测与可读意图记录。
> - **Rationale**: 现有 audit log 已经有低层协议事件，Ledger schema 已被 dashboard/timeline/history 消费。
> - **Alternatives**: 所有事件进 Ledger；只扩展 audit log；新增 change-log。
> - **Evidence**: `packages/shared/src/types/ledger.ts:1`; `packages/server/src/services/audit-log.ts:16`; `packages/server/src/services/audit-log.ts:30`
> - **Next Action**: 在 synthesis 中定义哪些事件进哪条轨道。

> **Solution**: doctor drift 发现后生成 `rule_drift_detected` 审计事件，并可选择追加一条 Ledger entry 描述发现事实。
> - **Status**: Proposed
> - **Problem**: 规则文件被改动但没有通过规则接口或 registry 更新时，需要后验追踪。
> - **Rationale**: doctor 已经有 hash 对比数据；audit event 可记录机器事实，Ledger entry 可记录用户可见意图/发现。
> - **Alternatives**: 自动修改 meta；仅报错；只在 human pre-commit ledger 中体现。
> - **Evidence**: `packages/server/src/services/doctor.ts:529`; `packages/server/src/services/doctor.ts:548`
> - **Next Action**: 明确自动记录和显式确认边界，避免读命令产生意外副作用。

#### Analysis Results
- `fab_append_intent` 的 MCP tool 说明是 "Call after a completed task to append an intent ledger entry"，天然是任务完成后的记录接口。
- `appendIntent` 写 Ledger 后再 best-effort 写 audit，因此 Ledger 写入不能被合规遥测失败阻断。
- doctor audit 已经会把 Ledger 中 AI edit intent 与之前的 `get_rules` 或 `rule_selection` 事件关联，说明现有设计已经把 Ledger 作为“发生了编辑”的锚点，把 audit log 作为“编辑前是否读过规则”的证据链。
- `runDoctorReport` 是读路径；`runDoctorFix` 当前有写行为，但只迁移 legacy ledger。未来若要让 doctor 记录 drift，应优先放在显式 `--audit-record` / `--fix` / `approve` 流程，避免普通 doctor 运行污染工作区。

#### Corrected Assumptions
- ~~服务器已有接口需要从零设计打点~~ -> 多个接口已经在写 audit；缺的是统一事件分类和某些 mutation 入口补点。
- ~~规则文件 hash drift 只能靠 commit diff 审计~~ -> doctor 已经能基于 agents meta hash 做工作区级发现，适合做后验审计入口。

#### Open Items
- AI Ledger schema 是否要引入 `event_type`/`metadata`，还是保持最小 schema 并把细节放 audit log？
- `fab_update_registry` 是否应自动调用 `appendIntent`，还是只写 audit event 并要求调用方在任务结束时统一 `fab_append_intent`？
- doctor drift 记录是默认启用、仅 strict/audit mode 启用，还是必须显式命令触发？

#### Narrative Synthesis
**起点**: 基于用户提出的两个功能点，本轮从现有服务器接口和 doctor hash 对比代码切入。
**关键进展**: 确认了已有 `appendIntent`、`audit-log`、`rule-sections`、`doctor` 的职责分布，并发现 registry mutation 入口缺少打点。
**决策影响**: 分析方向从“重写 Ledger”调整为“建立 Ledger/audit 分层闭环”。
**当前理解**: Ledger 应是用户可读、可回放的事实时间线；audit log 是协议级证据链；doctor drift 是后验发现和补录入口。
**遗留问题**: 自动写 Ledger 的边界，以及规则文件 drift 的归因/确认流程。

#### Initial Intent Coverage Check
- ✅ Intent 1: 通过服务器已有接口进行打点记录 - 已覆盖 `fab_append_intent`、`fab_get_rule_sections`、`fab_update_registry` 三类入口。
- 🔄 Intent 2: 规则文件更改如何审计 - 已确认 doctor hash drift 能发现，但具体记录策略待综合。

---

### Round 2 - Clarification Q&A (2026-04-26T00:00:00+08:00)

#### User Input
用户提出四个澄清问题：
- Ledger 和 audit log 的职责到底是什么。
- `fab_append_intent` 能否覆盖服务器相关接口调用，以及是否有相应 hook 周期提示。
- `fab_update_registry` 是否可以丢弃，改为直接维护原始规则文本，再由 `agents.meta.json` 文件 hash 判断变化。
- 如果从 doctor 审计到 Ledger 记录形成闭环，文件更改后如何消除 doctor error。

#### Decision Log

> **Decision**: 将 `agents.meta.json` 定位为生成索引/基线，不作为常规规则编辑入口。
> - **Context**: 用户倾向丢弃 `fab_update_registry`，改为维护原始规则文本。
> - **Options considered**: 继续以 `fab_update_registry` 修改 meta；直接编辑规则文本并由 sync/doctor 更新 meta；两者长期并存。
> - **Chosen**: 直接编辑规则文本，meta 作为派生索引与 hash baseline - **Reason**: 更符合“一个地方维护原始规则文本”的心智，也减少 registry mutation 和规则正文之间的双写。
> - **Rejected**: 继续让 `fab_update_registry` 成为主要入口会造成原文与 meta 双真源；长期并存会增加审计解释成本。
> - **Impact**: 后续建议应从“审计 fab_update_registry”调整为“弱化/废弃 fab_update_registry，并强化 sync-meta/doctor baseline 更新流程”。

#### Key Findings

> **Finding**: `fab_append_intent` 当前不是自动 hook，而是任务完成后显式调用的 MCP tool。
> - **Confidence**: High - **Why**: `packages/server/src/tools/append-intent.ts` 只注册 tool；`appendIntent` 在被调用时写 Ledger 并补 edit_intent audit，没有发现全局 server wrapper。
> - **Hypothesis Impact**: Modifies hypothesis "fab_append_intent 覆盖服务器接口调用" 为 "fab_append_intent 覆盖任务完成记录，不能自动覆盖所有 server API 调用"。
> - **Scope**: MCP lifecycle、hook 提示、自动化记录策略。

> **Finding**: doctor error 的消除动作本质上不是“写 Ledger”，而是“更新 baseline 或回滚文件”，Ledger 只记录这个处理事实。
> - **Confidence**: High - **Why**: doctor drift 来自 actual hash 与 meta hash 不一致；只有重新同步 meta hash 或还原规则文件才能使下一次 hash 对比通过。
> - **Hypothesis Impact**: Clarifies hypothesis "doctor -> Ledger 闭环"。
> - **Scope**: doctor --fix/sync-meta/approve flow、Ledger 记录边界。

#### Technical Solutions

> **Solution**: 规则变更闭环采用四步：编辑规则文本 -> doctor 发现 drift -> 人/AI 确认并 sync baseline -> Ledger 记录确认/同步事实。
> - **Status**: Proposed
> - **Problem**: 当前容易误以为 Ledger 记录本身能消除 doctor error。
> - **Rationale**: doctor error 来源是 hash baseline 不匹配，必须通过同步或回滚消除；Ledger 是记录，不是修复动作。
> - **Alternatives**: doctor 自动写 Ledger 并视为修复；直接编辑 meta；忽略 drift。
> - **Evidence**: `packages/server/src/services/doctor.ts:529`; `packages/server/src/services/update-registry.ts:20`
> - **Next Action**: 将 recommendation 从 registry mutation 审计改为 baseline sync / doctor fix 设计。

#### Analysis Results
- Ledger 是“结果事实”：任务完成、规则变更被接受、doctor fix 已执行。它应该少而清楚，适合人读和历史回放。
- audit log 是“过程证据”：调用过哪些规则接口、选了哪些 stable id、某次编辑是否有前置规则访问、doctor 何时发现了 drift。它可以高频、细粒度、机器读。
- `fab_append_intent` 不能天然覆盖服务器所有接口调用。要覆盖 mutation，有两种策略：调用方在任务结束时统一调用；或服务器为 mutation tool 加 wrapper 自动写 audit event。前者适合 Ledger，后者适合 audit。
- 如果废弃 `fab_update_registry`，需要另一个“更新 baseline”的显式入口，例如 `sync-meta` 或 `doctor --fix-rule-baseline`。它读取规则原文，计算新 hash，写回 `agents.meta.json`。
- 消除 doctor error 的动作是：接受新规则并更新 meta hash，或回滚规则文件到旧 hash。Ledger 记录“为什么接受/回滚”，audit log 记录“发现和同步细节”。

#### Corrected Assumptions
- ~~写 Ledger 就能消除 doctor error~~ -> Ledger 只是记录；消除 error 需要更新 hash baseline 或回滚文件。
- ~~fab_append_intent 可以自动覆盖所有服务器接口调用~~ -> 当前它是显式任务完成入口；自动覆盖需要额外 hook/wrapper。
- ~~meta 可以作为规则修改入口~~ -> 更清晰的模型是规则原文为真源，meta 为生成索引和 hash baseline。

#### Open Items
- `fab_update_registry` 是直接删除，还是保留为内部/迁移兼容但不推荐给 Agent 使用？
- baseline 更新入口最终叫 `sync-meta`、`doctor --fix`，还是新增专门的 `doctor --accept-rule-drift`？
- Ledger entry 是否需要 `kind: "rule_baseline_accepted"` 这类可选分类字段？

#### Narrative Synthesis
**起点**: 用户指出职责边界和 doctor 闭环仍然混乱。
**关键进展**: 本轮把 Ledger/audit/meta/rule text 四者分工重新划清：规则文本是真源，meta 是基线索引，doctor 是检查者，Ledger 是结果记录，audit 是证据链。
**决策影响**: 原先“审计 `fab_update_registry`”的建议应降级，因为更自然的架构是弱化或废弃该工具。
**当前理解**: doctor error 不是通过记录消除，而是通过 baseline sync 或回滚消除；记录只是让这个处理过程可追踪。
**遗留问题**: baseline 更新入口和 Ledger schema 的命名仍需实现前确认。

---

### Round 3 - Unified Event Ledger Direction (2026-04-26T00:00:00+08:00)

#### User Input
用户提出新的架构判断：audit log 和 Ledger 是否本质上都是审计日志，能否合并成一个统一账本以避免复杂度；具体查看需求后续通过视图处理。

#### Decision Log

> **Decision**: 将 audit log 与 Ledger 的物理存储合并为统一 Event Ledger，保留视图层分工。
> - **Context**: 用户指出 audit log 和 Ledger 都是 append-only 审计记录，拆成两个文件和两套引用关系可能引入不必要复杂度。
> - **Options considered**: 继续保留 `.fabric/.intent-ledger.jsonl` + `.fabric/audit.jsonl` 双轨；完全取消 audit 概念；统一底层事件账本并通过 `type`/view 区分消费场景。
> - **Chosen**: 统一底层事件账本 + 视图分层 - **Reason**: 既减少存储和关联复杂度，也保留人类时间线、doctor、合规审计等不同读取方式。
> - **Rejected**: 双轨会持续带来 Ledger/audit 互相引用和边界解释成本；完全取消 audit 概念会丢失机器合规视角。
> - **Impact**: 前序“Ledger 与 audit log 分层”的结论需要修正为“物理合并、逻辑分层”。后续实现应围绕事件类型、统一 append 入口和视图 API 设计。

#### Key Findings

> **Finding**: audit log 与 Ledger 的差异主要是消费视图，而不是存储本质。
> - **Confidence**: Medium - **Why**: 两者当前都使用 JSONL append-only 记录，都服务审计和历史追踪；差异在于事件粒度和展示对象。
> - **Hypothesis Impact**: Refutes earlier hypothesis "Ledger 和 audit log 必须物理分离"，modifies it to "底层统一，视图分层"。
> - **Scope**: Ledger schema、audit event schema、doctor audit、timeline/history API。

#### Technical Solutions

> **Solution**: 引入统一 Event Ledger，所有审计事实写入一个 append-only JSONL 文件，用 `type`、`actor`、`correlation_id`、`details` 区分事件。
> - **Status**: Proposed
> - **Problem**: 双轨日志导致职责边界解释复杂、事件关联复杂、未来视图开发成本增加。
> - **Rationale**: 单一事实源更容易维护；人类时间线、doctor、audit 可以通过过滤和投影生成。
> - **Alternatives**: 保持双文件；只保留人类 Ledger；只保留机器 audit log。
> - **Evidence**: 当前 `LedgerEntry` 和 `AuditLogEntry` 都是 append-only JSONL 记录；doctor/timeline/history 本质都在读事件事实。
> - **Next Action**: 后续需要设计事件 envelope 和兼容迁移策略。

#### Analysis Results
- 合并后的底层模型可以叫 `Event Ledger`，例如 `.fabric/events.jsonl` 或继续沿用 `.fabric/.intent-ledger.jsonl` 但升级语义。
- 每条记录应有统一 envelope，例如：
  - `id`
  - `ts`
  - `actor`
  - `type`
  - `intent`
  - `affected_paths`
  - `correlation_id`
  - `details`
- 原 audit log 事件不消失，而是成为事件类型：
  - `rule_access`
  - `rule_selection`
  - `edit_intent`
  - `rule_drift_detected`
  - `baseline_synced`
- 原 Ledger 事件也成为事件类型：
  - `task_completed`
  - `rule_change_accepted`
  - `doctor_fix_completed`
  - `human_annotation`
- UI 和 doctor 不应直接展示全部事件，而应读取视图：
  - Timeline view: 过滤高层事件。
  - Audit view: 展示规则访问、选择、drift、合规窗口。
  - Doctor view: 聚合 drift、baseline、fix 状态。
  - History replay view: 按时间点投影规则/meta 状态。

#### Corrected Assumptions
- ~~Ledger 和 audit log 必须是两个物理文件~~ -> 它们可以是同一个统一事件账本，不同消费者通过 view/query 区分。
- ~~合并会导致人类时间线被低层事件污染~~ -> 污染来自缺少视图过滤，而不是来自统一存储本身。
- ~~audit log 是 Ledger 外部的证据链~~ -> audit 可以是 Event Ledger 中的低层事件类型。

#### Open Items
- 统一文件名使用 `.fabric/events.jsonl`、`.fabric/ledger.jsonl`，还是兼容沿用 `.fabric/.intent-ledger.jsonl`？
- 是否需要先做兼容层：读旧 Ledger + 旧 audit log，写新 Event Ledger？
- 事件类型 schema 是用 discriminated union 严格建模，还是先用统一 envelope + `details` 渐进收敛？

#### Narrative Synthesis
**起点**: 用户质疑双轨日志是否过度复杂。
**关键进展**: 本轮将“Ledger vs audit log”的问题从物理存储分离改成统一事件源和多视图投影。
**决策影响**: 前序建议需要整体调整：不再推荐长期保留独立 audit log，而是把 audit 作为 Event Ledger 的一种 view。
**当前理解**: Event Ledger 是唯一事实源；audit、timeline、doctor、history replay 都是对事件源的不同过滤、聚合和投影。
**遗留问题**: 文件命名、兼容迁移、事件 envelope 严格程度。

---

### Round 4 - MCP Interface Event Recording (2026-04-26T00:00:00+08:00)

#### User Input
用户继续追问：`fab_append_intent` 的具体记录能力，能否分化到其他 Fabric server MCP 接口调用时自动打点处理。

#### Decision Log

> **Decision**: 将 `fab_append_intent` 的记录职责拆分到各 MCP 接口的 typed event 打点中，只保留任务级 summary event 作为显式补充。
> - **Context**: 在统一 Event Ledger 模型下，单独的 append intent 接口会变成历史包袱；不同 MCP 接口本来就知道自己的语义、输入、输出和结果。
> - **Options considered**: 继续要求任务末尾统一调用 `fab_append_intent`；每个 MCP 接口自动写对应 typed event；两者并存但明确分工。
> - **Chosen**: MCP 接口自动写 typed event，任务结束时可选写 `task_completed` summary - **Reason**: 接口本地最清楚事件语义，自动打点更可靠；summary 仍然保留人类可读的任务闭环。
> - **Rejected**: 完全依赖手动 `fab_append_intent` 容易漏记；完全取消任务 summary 会丢失人类可读的“为什么做这件事”。
> - **Impact**: `fab_append_intent` 应逐步降级为兼容 alias 或 `fab_record_event(type=task_completed)`；server MCP 工具需要统一 event recorder wrapper。

#### Key Findings

> **Finding**: 不同 MCP 接口应记录不同粒度的事件，而不是都伪装成 intent。
> - **Confidence**: High - **Why**: `fab_plan_context`、`fab_get_rule_sections`、doctor fix、baseline sync 的语义不同；统一写 `intent` 会丢失结构化信息。
> - **Hypothesis Impact**: Confirms hypothesis "append intent 能力可以分化到接口调用打点"。
> - **Scope**: MCP tool registration、server service wrapper、Event Ledger schema。

#### Technical Solutions

> **Solution**: 为 Fabric server MCP 层引入统一 `recordEvent` 基础设施，由各 tool/service 在成功或关键失败点写 typed event。
> - **Status**: Proposed
> - **Problem**: 手动 append intent 容易漏记，且不能表达不同接口的细粒度证据。
> - **Rationale**: 接口本身知道 op、target paths、selection token、hash、old/new baseline、diagnostics 等结构化数据。
> - **Alternatives**: 保留 `fab_append_intent` 为唯一记录入口；只由 doctor 后验扫描推断事件。
> - **Evidence**: 现有 `rule-sections` 已在接口内部写 `rule_selection` audit event，是这种模式的先例。
> - **Next Action**: 设计 Event Ledger envelope 和 per-tool event map。

#### Analysis Results
- `fab_plan_context` 可记录 `rule_context_planned`：target paths、requirement profile 摘要、candidate stable ids、selection token。
- `fab_get_rule_sections` 可记录 `rule_selection` / `rule_sections_fetched`：required ids、AI selected ids、final ids、reasons、diagnostics。
- doctor report 默认仍只读，或只记录到内存/调试；显式 doctor fix/accept 可记录 `rule_drift_detected`、`rule_change_accepted`、`baseline_synced`。
- 规则文本修改不应靠 `fab_update_registry`；baseline 更新由 doctor fix/sync-meta 记录 `baseline_synced`。
- `fab_append_intent` 的剩余价值是任务级 summary：在一组低层事件之后记录 `task_completed`，提供人类可读的 intent、影响路径、结果摘要。

#### Corrected Assumptions
- ~~所有记录都需要通过 `fab_append_intent` 汇总~~ -> MCP 接口应自动写 typed event，`fab_append_intent` 只保留为 summary/兼容。
- ~~接口自动打点会替代任务 intent~~ -> 自动打点记录过程证据，任务 summary 仍然表达“为什么”和“完成结果”。

#### Open Items
- 哪些 MCP 接口需要记录 success event，哪些只记录 mutation/fix event？
- 失败事件是否进入 Event Ledger，还是只进入 debug log？
- `task_completed` summary 是否由 Codex hook 自动写，还是由用户/Agent 显式触发？

#### Narrative Synthesis
**起点**: 用户希望把 `fab_append_intent` 的能力分散到 server MCP 接口。
**关键进展**: 本轮确认接口级 typed event 是统一 Event Ledger 的自然写入方式。
**决策影响**: `fab_append_intent` 从核心接口降级为兼容 alias 或任务 summary writer。
**当前理解**: Event Ledger 写入应主要发生在 MCP tool/service 语义边界；人类可读任务总结作为高层事件保留。
**遗留问题**: success/failure event 边界、hook 自动 summary 的触发方式。

---

### Round 5 - Event Ledger as Logging Infrastructure First (2026-04-26T00:00:00+08:00)

#### User Input
用户修正方向：暂时不把 `task_completed` 这类事件作为“人类能快速理解的总结”来设计，当前阶段先把 Event Ledger 更多定位为日志和打点。

#### Decision Log

> **Decision**: 当前阶段不把任务级 summary 作为 Event Ledger 的核心需求，优先实现接口级日志/打点事件流。
> - **Context**: 统一 Event Ledger 的首要目标是降低 audit log/Ledger 双轨复杂度，并让 server MCP 接口自动记录结构化事件。
> - **Options considered**: 同时设计人类 summary 和机器打点；先做机器打点，后续由 view 派生人类摘要；保留 `fab_append_intent` 作为必需 summary。
> - **Chosen**: 先做机器打点，后续由视图或聚合层生成摘要 - **Reason**: 当前讨论重点是日志基础设施和自动打点，过早设计 summary 会把 `fab_append_intent` 的旧心智带回来。
> - **Rejected**: 必需 summary 会让 Event Ledger 继续被“任务意图账本”绑定；同时做两套语义会扩大第一阶段范围。
> - **Impact**: `fab_append_intent` 不再被视为必须保留的任务总结入口；第一阶段应聚焦 `recordEvent`、event envelope、per-MCP tool typed events 和查询视图。

#### Key Findings

> **Finding**: Event Ledger 的第一阶段价值是统一日志基础设施，而不是直接服务人类时间线。
> - **Confidence**: High - **Why**: 用户明确希望先把它作为日志和打点；timeline/summary 可以由后续 view 处理。
> - **Hypothesis Impact**: Modifies Round 4 hypothesis "仍保留任务 summary" 为 "summary 不是第一阶段核心需求"。
> - **Scope**: Event Ledger schema、MCP event recorder、Dashboard/doctor views。

#### Technical Solutions

> **Solution**: 第一阶段仅实现 typed event logging，不强制写 `task_completed`。
> - **Status**: Proposed
> - **Problem**: 如果继续保留任务 summary，统一 Event Ledger 容易退回旧的 intent-ledger 设计。
> - **Rationale**: MCP 接口级事件已经能构成完整的过程日志；人类视图可以后续通过聚合或筛选产生。
> - **Alternatives**: 保留 `fab_append_intent` 必填；自动 hook 写 summary；完全无视后续人类视图。
> - **Evidence**: Round 3 已确认底层合并、视图分层；Round 4 已确认接口级 typed event 是自然写入点。
> - **Next Action**: 更新 synthesis，将 `task_completed` 降级为未来可选事件类型，不进入第一阶段验收标准。

#### Analysis Results
- 第一阶段事件可以集中在系统可观测性和审计需要：
  - `rule_context_planned`
  - `rule_selection`
  - `rule_sections_fetched`
  - `rule_drift_detected`
  - `rule_change_accepted`
  - `baseline_synced`
  - `doctor_check_run`（是否记录需再定）
- `task_completed` 暂时不作为必需事件。
- `fab_append_intent` 可不进入新架构核心；如果保留，只作为兼容旧客户端的 alias，不影响新模型。
- 人类时间线可以后续作为 view/aggregation：从多个低层事件中聚合成“某次规则变更过程”。

#### Corrected Assumptions
- ~~统一 Event Ledger 仍需要高层 task summary 才完整~~ -> 第一阶段只需要稳定、结构化、可查询的接口级事件。
- ~~`fab_append_intent` 需要保留来表达人类可读意图~~ -> 当前不作为核心需求；未来可由视图层或聚合器生成摘要。

#### Open Items
- 第一阶段是否记录 read-only 查询事件，例如 `fab_plan_context`，还是只记录 mutation/fix/selection？
- 是否需要 correlation/session id 来支持未来视图聚合？
- 旧 `.intent-ledger.jsonl` 的迁移是否直接转成 event type，还是保留兼容读取？

#### Narrative Synthesis
**起点**: 用户担心任务总结语义会让设计偏离日志/打点目标。
**关键进展**: 本轮将 Event Ledger 第一阶段范围收窄到 typed event logging。
**决策影响**: `fab_append_intent` 不再是必须保留的核心接口，`task_completed` 也不进入第一阶段关键路径。
**当前理解**: Event Ledger 是统一日志基础设施；人类摘要和 timeline 是后续 view/aggregation 问题。
**遗留问题**: 事件记录范围、correlation id、旧 ledger 兼容迁移。

---

## Synthesis & Conclusions

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|-----------------|--------|-----------------|-------|
| 1 | 通过服务器已经拥有的接口进行打点记录 | Addressed | Round 1, Conclusion #1, Recommendation #1/#2 | 已确认 `fab_append_intent`、`fab_get_rule_sections` 已打点，`fab_update_registry` 是缺口。 |
| 2 | 对规则文件更改如何审计 | Addressed | Round 1, Conclusion #3/#4, Recommendation #3/#4 | 已确认 doctor hash drift 是发现机制，但需要显式记录/确认闭环。 |
| 3 | 意图账本记录具体更改过程 | Transformed | Conclusion #2/#4, Recommendation #3 | 转化为“Ledger 记录事实摘要与处理动作，audit log 记录协议证据与 hash 细节”。 |

### Findings Coverage Matrix

| # | Finding (Round) | Disposition | Target |
|---|-----------------|-------------|--------|
| 1 | `fab_append_intent` 已是 Ledger 写入口 (R1) | recommendation | Rec #1 |
| 2 | audit log 已有 `get_rules`/`edit_intent`/`rule_selection` (R1) | recommendation | Rec #1, Rec #2 |
| 3 | `fab_get_rule_sections` 已记录 rule selection (R1) | absorbed | Rec #1 |
| 4 | doctor 发现 hash drift 但不记录 (R1) | recommendation | Rec #3 |
| 5 | `fab_update_registry` mutation 未审计 (R1) | recommendation | Rec #4 |

### Executive Summary

Ledger 重构不应从“再造一个日志系统”开始。当前项目已经形成两个事实：`.fabric/.intent-ledger.jsonl` 是 AI/human 意图时间线，`.fabric/audit.jsonl` 是规则访问、规则选择、编辑合规的协议证据链。更稳的重构方向是把两者的职责正式化，然后补齐两个缺口：`fab_update_registry` 这类规则元数据 mutation 要打点，doctor 发现规则文件 hash drift 后要能显式记录发现事实和处理结果。

### Key Conclusions

1. **服务器已有接口已经足够承载主要打点，但需要补齐 mutation 入口。**
   `fab_append_intent` 负责任务完成后的 Ledger entry；`fab_get_rule_sections` 负责 rule selection audit；`fab_update_registry` 应成为 registry mutation 的打点入口。

2. **Ledger 与 audit log 应继续分层。**
   Ledger 记录“完成了什么、发现了什么、处理了什么”；audit log 记录“什么时候读取/选择了哪些规则、是否满足合规窗口、hash 对比细节”。这样 Dashboard timeline 和 doctor compliance 都能保持清晰。

3. **规则文件更改审计应以 doctor hash drift 为后验发现机制。**
   doctor 已经有 old meta hash 与 current file hash 的比较基础。缺的是把 drift 明细结构化为 audit event，并在用户确认或 fix 时追加 Ledger entry。

4. **不要让普通 doctor report 产生隐式写入。**
   `runDoctorReport` 应继续是读路径。记录 drift 应放到显式操作，例如 `fab doctor --audit-record`、`fab doctor --fix` 或 dashboard approve flow，避免一次诊断命令污染工作区。

### Recommendations

1. **正式定义 Ledger/audit 分层契约。** [high]
   - Ledger: task completed、rule drift confirmed、registry change completed、doctor fix completed。
   - Audit log: get_rules、rule_selection、edit_intent、registry_mutation、rule_drift_detected。
   - Verification: doctor audit 能从 Ledger entry 反查 audit evidence，而 timeline 不被高频规则读取淹没。

2. **扩展 `appendIntent` 结果和调用约定，明确“完成任务后统一 append”的服务器接口。** [high]
   - 保持 `fab_append_intent` 为 AI 任务完成记录入口。
   - 在文档/工具说明中要求受影响路径包含规则文件、meta 文件和被编辑业务文件。
   - 保持 audit telemetry best-effort，避免 audit 写失败阻断 Ledger。
   - Evidence: `packages/server/src/services/append-intent.ts:17`, `packages/server/src/tools/append-intent.ts:33`.

3. **为 doctor drift 增加显式记录流。** [high]
   - 在 `inspectMetaRevision` 结果中保留 drift detail：node id、stable id、file、expected hash、actual hash、identity_source。
   - 新增 audit event `rule_drift_detected`，由显式 doctor record/fix 操作写入。
   - 对确认后的 drift 追加 Ledger entry，例如 intent 为 `doctor: detected rule drift in .fabric/rules/...`，affected_paths 包含 drift 文件和 `.fabric/agents.meta.json`。
   - Verification: doctor 测试覆盖“report 不写文件、record/fix 写 audit/Ledger”。

4. **给 `fab_update_registry` 增加 mutation 审计。** [high]
   - 记录 op、node_id、old_revision、new_revision、changed fields、affected file/hash。
   - 是否自动 append Ledger 可以保守处理：先写 audit event，任务完成后仍由调用方统一 `fab_append_intent`，避免一次任务内多条重复 Ledger entry。
   - Evidence: `packages/server/src/services/update-registry.ts:20`, `packages/server/src/tools/update-registry.ts:44`.

5. **谨慎扩展 Ledger schema，优先添加可选 metadata 而不是拆多套 entry 类型。** [medium]
   - 当前 `AiLedgerEntry`/`HumanLedgerEntry` 很小，已经被多个 UI/历史功能消费。
   - 可考虑 `kind?: "task" | "rule_drift" | "registry_change"` 和 `metadata?: Record<string, unknown>`，但 hash 明细仍以 audit log 为真源。
   - Verification: shared schema、dashboard timeline、history replay 对未知 metadata 向后兼容。

### Remaining Open Questions
- Ledger schema 是否接受可选 `kind/metadata`，还是暂时只用 intent prose + affected_paths？
- doctor drift 记录命令名采用 `--audit-record`、`--record-drift` 还是并入 `--fix`？
- registry mutation 是否需要在 strict audit mode 下强制要求对应 `fab_append_intent`？

## Decision Trail

### Critical Decisions

> **Decision**: Ledger 与 audit log 继续分层。
> - **Context**: 现有代码已将 intent 与协议事件分开存储。
> - **Options considered**: 单 Ledger 事件流；分层日志；第三类 change-log。
> - **Chosen**: 分层日志 - **Reason**: 保持 timeline 可读，同时保留机器可审计证据。
> - **Rejected**: 单流噪声过高；第三类日志增加查询复杂度。
> - **Impact**: 后续实现应补 audit event 和显式 ledger facts，而不是替换存储。

> **Decision**: doctor report 保持读路径，drift 记录必须显式触发。
> - **Context**: doctor 已经能发现 hash drift，但普通 report 若写文件会产生意外副作用。
> - **Options considered**: 每次 report 自动写 Ledger；只 report；显式 record/fix 写入。
> - **Chosen**: 显式 record/fix 写入 - **Reason**: 审计记录需要可追踪，但读命令不应污染 worktree。
> - **Rejected**: 自动写入会导致重复和副作用；只 report 则缺少持久证据。
> - **Impact**: 需要新增 doctor drift detail 和显式写入测试。

> **Decision**: `fab_update_registry` 先写 audit event，不默认自动追加 Ledger。
> - **Context**: registry mutation 是规则变更生命周期关键入口，但一次任务可能包含多步 registry 操作。
> - **Options considered**: 每次 mutation 自动 append Ledger；只靠最终 appendIntent；mutation 写 audit、最终 appendIntent 写 Ledger。
> - **Chosen**: mutation 写 audit、最终 appendIntent 写 Ledger - **Reason**: 避免 Ledger 重复，同时保留每一步机器证据。
> - **Rejected**: 每步 Ledger 会污染 timeline；只最终 appendIntent 会丢失中间 mutation 明细。
> - **Impact**: audit event union 需要扩展 registry mutation 类型。

### Session Statistics
- Discussion rounds: 1
- Key findings: 5
- Recommendations: 5
- Decisions: 3
- Artifacts generated: discussion.md, exploration-codebase.json, explorations.json, conclusions.json
