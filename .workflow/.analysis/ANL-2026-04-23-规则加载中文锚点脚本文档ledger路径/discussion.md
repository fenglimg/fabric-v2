# Analysis Discussion

**Session ID**: ANL-2026-04-23-规则加载中文锚点脚本文档ledger路径
**Topic**: 讨论四个议题：规则加载逻辑优化、中文化与英文锚点共存、脚本文档化与变更维护、`.intent-ledger.jsonl` 路径 bug
**Started**: 2026-04-23T00:00:00+08:00
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
- 当前 `fab_get_rules` 已经把 L0 / human lock / meta context 做了缓存，但对每个目标路径仍会重新遍历 `meta.nodes`、重新做 `minimatch` 过滤，并逐条读命中的规则文件；这使“连续编辑多个同目录文件”仍然存在重复解析成本。
- 当前 `fab_plan_context` 只是对多个路径并发调用 `resolveRulesForPath(..., { dedupeByPath: true })`，解决了同一批路径的输入去重，但没有把“跨路径共享的命中节点”和“共享文件内容读取”上提到批量层。
- 项目已经建立了“中文解释层 + 英文受保护 token / anchor 层”的基本规范，且多处文档明确要求 protected tokens 不翻译、证据锚点保持 `file:line`。
- `.intent-ledger.jsonl` 目前被当成仓库根目录文件在 CLI、server、文档、i18n 中广泛引用；如果预期应放到 `.fabric/` 内，这不是单点 bug，而是跨常量、测试、文档、UI 文案的路径收敛问题。

### What Was Clarified
- ~~`fab_plan_context` 已经能避免大部分重复加载~~ → 它目前只做路径级去重和共享 context，尚未做规则命中结果缓存、共享文件内容缓存，也没有返回“批量编辑集合的并集规则视图”。
- ~~中文化会天然破坏英文稳定性~~ → 现有框架已经证明可以把中文放在 wrapper / explanation 层，把英文 token 放在 core / anchor 层，两者并不冲突；问题在于缺少更系统的“锚点字段”设计。
- ~~脚本文档化必须另起一套系统~~ → 现有框架更适合把脚本文档挂到 `.fabric/agents/` 或 docs 中，并用稳定英文键连接脚本、规则和变更记录，而不是在 `scripts/` 目录旁边再造一套文档协议。

### Key Insights
- 真正高价值的优化不是“编辑前把待改文件整批传入”本身，而是把它扩展成“两阶段规则解析”：规划阶段返回 per-path 视图 + shared union 视图，执行阶段针对最终落笔文件再做一次单文件确认。
- 中文化和稳定英文锚点最稳的组合不是“中英混写正文”，而是“中文面向人、英文面向协议”。也就是正文可中文化，但 rule id、activation tier、token、evidence anchor、script id 等字段必须保持稳定英文。
- 脚本文档化如果没有变更面板或 ledger 挂钩，很快会失真；因此比“给每个脚本写 README”更关键的是定义最小 metadata 和变更归属机制。

## Analysis Context
- Focus areas: 规则加载路径、批量上下文、双语规则表达、脚本知识挂载、ledger 存储边界
- Perspectives: Technical, Architectural
- Depth: standard

## Initial Questions
- `fab_get_rules` 与 `fab_plan_context` 在当前实现里分别缓存了什么，重复成本在哪里？
- 现有双语规范里，哪些部分已经被要求保持英文稳定，哪些部分仍缺乏结构化锚点？
- 脚本说明与脚本变更跟踪应挂在 docs、rules mirror、还是独立 registry？
- `.intent-ledger.jsonl` 从根目录迁入 `.fabric/` 会影响哪些实现和用户心智？

## Initial Decisions
> **Decision**: 先按“实现现状 → 结构问题 → 框架融入方式 → bug 收口”组织分析，而不是分别孤立回答四个问题。
> - **Context**: 四个议题存在共享根因：规则元数据、受保护 token、docs/skill 约束、ledger 边界。
> - **Options considered**: 分题逐个回答；按系统层次统一回答。
> - **Chosen**: 按系统层次统一回答。 — **Reason**: 这样更容易发现批量规则查询、双语锚点、脚本说明、ledger 路径之间的复用点。
> - **Rejected**: 纯分题回答会遗漏跨模块常量分叉与协议一致性问题。
> - **Impact**: 后续 recommendations 会偏向框架级收敛，而不是单文件 patch 思维。

---

## Discussion Timeline

### Round 1 - Exploration (2026-04-23T00:00:00+08:00)

#### User Input
用户提出四个并行议题：
- 规则加载逻辑如何优化，尤其是看起来同目录会重复加载多次，是否应在探索后、编辑前批量传入待编辑文件并返回具体规则。
- 规则如何在中文化的同时保持准确稳定的英文锚点。
- 是否需要支持脚本级说明及其变更维护，并思考怎样融入当前框架。
- `.intent-ledger.jsonl` 裸露在 `.fabric` 外是否属于 bug，预期应放进 `.fabric`。

#### Decision Log
> **Decision**: 先检查近期分析结论和现有源码，再形成第一轮综合判断，不直接提出实现方案。
> - **Context**: 仓库已有最近 7 天的 analysis / lite-plan，会影响本轮判断。
> - **Options considered**: 仅看当前源码；同时吸收近期分析结论。
> - **Chosen**: 同时读取近期 analysis / lite-plan 与源码。 — **Reason**: 仓库已在 2026-04-23 的分析里讨论过 activation tier、description stubs、Dashboard 规则拓扑。
> - **Rejected**: 只看源码会忽略近期已经形成的设计方向，容易重复分析。
> - **Impact**: 本轮结论会把既有方向视作“前置共识”，再判断是否继续推进。

> **Decision**: 把 `fab_plan_context` 视为现有优化基础，而不是最终答案。
> - **Context**: 用户的批量加载想法与现有 MCP tool `fab_plan_context(paths[])` 高度相关。
> - **Options considered**: 认为已有工具已经充分解决；认为该工具只是第一步。
> - **Chosen**: 认为它只是第一步。 — **Reason**: 当前实现仅做 unique path 去重和共享 context，没有共享规则命中结果和文件内容缓存。
> - **Rejected**: “已经解决”的判断与实现细节不符。
> - **Impact**: 推荐会落在 `planContext` 返回结构和 `resolveRulesForPath` 的批量化重构上。

#### Key Findings
> **Finding**: `getRules()` 只缓存了 `meta + L0 + human lock`，未缓存“某路径命中了哪些节点”或“某规则文件内容”。
> - **Confidence**: High — **Why**: `loadGetRulesContext()` 仅把 `meta`、`l0Content`、`humanLockedNearby` 放进 `contextCache`，随后每次 `resolveRulesForPath()` 仍调用 `loadRulesForPath()` 做节点过滤和文件读取（evidence: `packages/server/src/services/get-rules.ts:67`, `packages/server/src/services/get-rules.ts:89`, `packages/server/src/services/get-rules.ts:112`, `packages/server/src/services/get-rules.ts:148`）。
> - **Hypothesis Impact**: Confirms hypothesis "当前对同类路径存在重复规则解析成本"
> - **Scope**: 规则加载性能、批量编辑前置规划、Dashboard rules context API

> **Finding**: `fab_plan_context` 已提供“多路径单次 round-trip”，但仍是逐路径调用 `resolveRulesForPath()`。
> - **Confidence**: High — **Why**: `planContext()` 中对 `uniquePaths` 使用 `Promise.all(paths.map(resolveRulesForPath))`，只是在 path 级别去重，并传入 `dedupeByPath: true`（evidence: `packages/server/src/services/plan-context.ts:22`, `packages/server/src/services/plan-context.ts:28`, `packages/server/src/services/plan-context.ts:29`）。
> - **Hypothesis Impact**: Modifies hypothesis "批量接口缺失"
> - **Scope**: MCP tool 设计、编辑前规则预取、规划期上下文

> **Finding**: 项目已明确要求“core English / wrapper Chinese”分层，且 protected tokens 不翻译。
> - **Confidence**: High — **Why**: bootstrap 模板与 skill 模板要求 `CORE RULES` / `Hard Rules` English-only，并强制保留 protected tokens；`scripts/lint-protected-tokens.ts` 还专门校验 core section 是否含 CJK（evidence: `templates/bootstrap/windsurf-fabric.md`, `templates/codex-skills/fabric-init/SKILL.md`, `scripts/lint-protected-tokens.ts:112`, `scripts/lint-protected-tokens.ts:120`, `scripts/lint-protected-tokens.ts:140`）。
> - **Hypothesis Impact**: Refutes hypothesis "中文化机制尚不存在"
> - **Scope**: 双语规则写法、模板治理、客户端稳定行为

> **Finding**: 文档已经把“稳定英文锚点”表达为 `file:line` evidence anchor 与 `Reason:` preserved token，而不是完全靠正文文字稳定。
> - **Confidence**: High — **Why**: `docs/initialization.md` 要求 Architecture Review 每项附 `file:line` 锚点；`docs/launch-story.md` 明确说明 `Reason:` 行保留英文 protected token（evidence: `docs/initialization.md:319`, `docs/launch-story.md:91`）。
> - **Hypothesis Impact**: Confirms hypothesis "已有英文锚点语义，但还未系统化到所有规则对象"
> - **Scope**: rule node schema、脚本说明字段、跨语言 UI 表达

> **Finding**: `.intent-ledger.jsonl` 作为根目录文件已渗透到 CLI、server 共享常量、测试、docs、UI 文案和 protected token registry。
> - **Confidence**: High — **Why**: server 共享常量 `LEDGER_FILE = ".intent-ledger.jsonl"`，CLI `ledger-append` 自己又单独声明同名常量，`pre-commit` 和 docs / i18n 都直接写死根目录路径（evidence: `packages/server/src/services/_shared.ts:5`, `packages/server/src/services/_shared.ts:7`, `packages/cli/src/commands/ledger-append.ts:15`, `packages/cli/src/commands/pre-commit.ts:63`, `packages/shared/src/i18n/protected-tokens.ts:17`, `docs/getting-started.md:227`）。
> - **Hypothesis Impact**: Confirms hypothesis "这是路径裸露 bug，且已经形成常量分叉"
> - **Scope**: ledger 存储边界、CLI/server 一致性、文档迁移

#### Technical Solutions
> **Solution**: 把规则加载重构为“规划批量视图 + 执行单文件确认”两阶段协议。
> - **Status**: Proposed
> - **Problem**: 当前 `fab_plan_context` 无法显式表达多文件编辑集合共享的规则并集，`fab_get_rules` 也会对相似路径重复做节点过滤与文件读取。
> - **Rationale**: 规划阶段更适合一次性看候选文件集合的 shared context，执行阶段再对最终落笔文件做精确确认，既减少重复，也不丢局部精度。
> - **Alternatives**: 仅继续使用逐文件 `fab_get_rules`；只在 client 侧做 memoization。
> - **Evidence**: `packages/server/src/services/get-rules.ts:148`; `packages/server/src/services/plan-context.ts:29`
> - **Next Action**: 如果进入实现阶段，优先设计 `planContext` 的 union/shared 结构，而不是直接加更多缓存。

> **Solution**: 对规则、脚本、证据统一采用“中文 label + 英文 id/anchor/token”双轨字段。
> - **Status**: Proposed
> - **Problem**: 纯中文正文不利于跨客户端稳定引用，纯英文正文又降低中文维护体验。
> - **Rationale**: 现有模板已经证明英文 core section 与中文 explanation 可共存；可以把这一模式从文档层下沉到 rule/script metadata 层。
> - **Alternatives**: 完全中文化；完全英文化；自由混写。
> - **Evidence**: `scripts/lint-protected-tokens.ts:112`; `docs/initialization.md:319`; `docs/launch-story.md:91`
> - **Next Action**: 为 rule node / script doc 增加稳定英文字段，例如 `rule_id`, `script_id`, `anchors[]`, `change_log_ref`。

> **Solution**: 把脚本说明整合进 `.fabric/agents/` 或 docs 索引，而不是在 `scripts/` 下散落 README。
> - **Status**: Proposed
> - **Problem**: 当前仓库脚本很少，但它们的业务作用、输入输出、维护者认知没有统一挂载点。
> - **Rationale**: Fabric 已以 `.fabric/agents/` 为规则镜像树，脚本说明应复用同一认知入口，而不是再造独立知识系统。
> - **Alternatives**: 每个脚本旁边单独 README；只靠代码注释；独立脚本 registry。
> - **Evidence**: `docs/initialization.md:423`; `packages/server/scripts/copy-dashboard.mjs:1`
> - **Next Action**: 如果进入实现阶段，可先从 `script-manifest` 最小集开始，再决定是否映射到 `.fabric/agents/_cross/tooling/`。

> **⚠️ Ambiguity**: 脚本文档方案仍有 2 个未决分支：放在 `.fabric/agents/_cross/tooling/*.md`，还是放在 `docs/scripts/*.md + manifest.json`。
> - **Needs**: 先确定脚本文档主要服务对象是 AI 规则加载，还是人类维护文档。如果偏 AI，优先前者；如果偏人类导航，优先后者。

#### Analysis Results
- 规则加载链路：
  - `getRules()` 调用 `loadGetRulesContext()`，命中 `contextCache` 后可避免重复读取 `.fabric/bootstrap/README.md`、`.fabric/human-lock.json` 与 `.fabric/agents.meta.json`。
  - 但 `resolveRulesForPath()` 每次仍会进入 `loadRulesForPath()`，对 `meta.nodes` 全量过滤并排序，再逐个 `readFile()` 命中规则文件。
  - 这意味着“同目录下多个文件”若命中相近 scope_glob，重复成本主要在 node filtering、排序、文件内容读取，而不在 meta 读取本身。
- 批量规则查询现状：
  - `planContext()` 的主要价值是共享 `loadGetRulesContext()` 结果，并避免重复 path 输入。
  - 当前没有返回 shared rules union，也没有将“某规则文件已被前一个路径读取”复用给后一个路径。
  - 用户提出的“探索后，编辑前，批量传入待编辑文件”方向是对的，但更合理的返回应同时包含：
    - per-path resolved rules
    - shared matched nodes / shared file contents
    - conflicts / ambiguities（例如某些路径只命中 description stub）
- 双语与锚点现状：
  - 受保护 token 已集中在 `packages/shared/src/i18n/protected-tokens.ts`。
  - lint 脚本会强制 bootstrap / skill 的核心规则段保持英文，中文只能在 wrapper/explanation。
  - 文档对锚点的硬要求更多集中在 `file:line` 和 `Reason:`，说明英文稳定性的核心载体其实是结构化字段，不是整段英文文案本身。
- 脚本说明现状：
  - 仓库内真正的顶层脚本数量很少，当前 `scripts/` 只有 lint 与 version sync；`packages/server/scripts/` 里有部署类脚本。
  - 这些脚本的“为什么存在”“输入输出是什么”“何时需要跑”“与哪条规则/模块相关”没有统一出口。
  - 因为 Fabric 已经有 mirror / cross-cutting 规则树，脚本认知更适合挂到这棵树上，而不是只留在代码目录。
- ledger 路径现状：
  - server 读取/追加 ledger 复用了共享 `LEDGER_FILE` 常量。
  - CLI `ledger-append` 没有复用该常量，而是本地再次定义，说明路径语义已在多个层级分叉。
  - `pre-commit` 的 fast path、docs/getting-started 的示例、dashboard timeline subtitle、protected token registry 都默认 ledger 在根目录。
  - 因此若迁移到 `.fabric/.intent-ledger.jsonl`，需要做“常量收敛 + API 兼容 + 文档/UI 迁移”，不能只改一个路径字符串。

#### Corrected Assumptions
- ~~批量规则查询还不存在~~ → 仓库已经有 `fab_plan_context(paths[])`，但能力还停在“多路径并发包装器”。
  - Reason: `packages/server/src/services/plan-context.ts` 已实现多路径入口。
- ~~双语规范还没定~~ → bootstrap/skill 模板与 lint 已经建立了“英文核心不可翻译，中文解释外包”的制度。
  - Reason: 相关模板与 lint 校验都已存在。

#### Open Items
- `fab_plan_context` 是否需要新增 `shared` 字段，还是仅在内部缓存优化而保持现有输出形状？
- rule/script 的稳定英文锚点最小集合应该是什么：`id`、`slug`、`token`、`evidence_anchor`、`kind`？
- 脚本文档如果并入 `.fabric/agents/`，是否需要扩展 `agents.meta.json` 支持 script-only node，还是只放文档不入 meta？
- ledger 路径迁移是否需要一段兼容期，例如读 `.fabric/.intent-ledger.jsonl` 优先，缺失时回退旧路径？

#### Narrative Synthesis
**起点**: 基于用户提出的四个议题，本轮从现有实现、近期分析和文档规范三条线同时切入。  
**关键进展**: 新发现确认了两个关键事实：一是批量规则查询并非空白，而是已有 `fab_plan_context` 但能力不足；二是双语稳定性并非缺制度，而是缺少从模板层下沉到 metadata 层的结构化英文锚点。  
**决策影响**: 分析方向从“是否需要新增机制”调整为“哪些机制已存在但还没走完最后一公里”。  
**当前理解**: 核心问题不是单个 bug 或单次加载性能，而是协议对象边界尚未统一：规则解析对象、双语锚点对象、脚本文档对象、ledger 路径对象都需要进一步收敛。  
**遗留问题**: 是否进入实现，应先决定优先级是规则批量协议、双语 anchor schema、脚本知识挂载，还是 ledger 路径修复。

#### Initial Intent Coverage Check (Post-Exploration)
- ✅ Intent 1: 规则加载逻辑优化与批量查询思路 — 已覆盖，确认现有 `fab_plan_context` 是基础但不足。
- ✅ Intent 2: 中文化同时保持准确稳定英文锚点 — 已覆盖，确认已有 wrapper/core 分层，但需结构化字段化。
- ✅ Intent 3: 脚本说明与变更维护如何融入框架 — 已覆盖，确认适合挂入现有 `.fabric/agents/` / docs 体系，而非另造系统。
- ✅ Intent 4: `.intent-ledger.jsonl` 裸露到 `.fabric` 外的 bug — 已覆盖，确认是跨常量、文档、UI 的收敛问题。

### Round 2 - Feedback Refinement (2026-04-23T00:10:00+08:00)

#### User Input
用户补充了 5 个定向建议：
- 规则加载应从“路径去重”进一步升级为“语义并集”，并引入 `shared_logic_hash`、`shared_nodes`、`file_map` 等结构，以及覆盖冲突预检。
- 双语锚点建议引入稳定英文 `rule_id` / `slug` / `uuid`，并明确分层：ID/Anchor/Tier 强英文，Explanation/Label 中文，Protected Tokens 保持英文。
- 脚本文档可视为 Agent 的工具组件，在 `.fabric/agents/_cross/tooling/` 下建立镜像，并为 `agents.meta.json` 增加 tools 节点。
- ledger 路径迁移建议通过 `getLedgerPath()` 双路径嗅探，必要时自动迁移。
- 希望增加当前模式与优化模式的时序对比图。

#### Decision Log
> **Decision**: 吸收“shared view / stable id / tooling mirror”方向，但对 `shared_logic_hash` 和“read 时自动 mv 迁移”保留约束。
> - **Context**: 用户建议已经足够接近实现设计，需要区分“应采纳方向”和“具体落法”。
> - **Options considered**: 全盘采纳；逐项筛选采纳。
> - **Chosen**: 逐项筛选采纳。 — **Reason**: 部分建议方向正确，但具体字段或迁移动作会影响兼容性与副作用边界。
> - **Rejected**: 全盘采纳会把分析结论误导成已验证设计。
> - **Impact**: 最终 recommendations 增加“推荐采纳/谨慎采纳/不建议立即采用”的边界说明。

> **Decision**: 将 Dashboard 路径建议修正为“API contract 收口”，而不是“UI 不要自己拼文件路径”。
> - **Context**: 用户担心 Dashboard 侧自行推导 ledger 文件路径。
> - **Options considered**: 维持原表述；按现有实现修正。
> - **Chosen**: 按现有实现修正。 — **Reason**: Dashboard 当前通过 `getLedger()` 访问 `/api/ledger`，并不直接操作 ledger 文件路径。
> - **Rejected**: 原建议中的 UI 路径担忧与当前实现不完全匹配。
> - **Impact**: 迁移重点仍在 server/CLI/shared constants，而不是 dashboard 文件访问逻辑。

#### Key Findings
> **Finding**: `AgentsMetaNode` 当前没有容纳 `rule_id`、`tools` 或其他扩展元数据的结构位，需要 schema 级扩展才支持用户建议。
> - **Confidence**: High — **Why**: 现有 `AgentsMetaNode` 只有 `file/scope_glob/deps/priority/layer/topology_type/hash/activation` 字段（evidence: `packages/shared/src/types/agents.ts:12`）。
> - **Hypothesis Impact**: Confirms hypothesis "稳定英文锚点与 tools 节点需要显式 schema 演进"
> - **Scope**: agents meta schema、registry tool、dashboard rendering

> **Finding**: Dashboard 当前并不拼接 ledger 文件路径，而是通过 `/api/ledger` 获取数据。
> - **Confidence**: High — **Why**: `IntentTimelineView` 只调用 `getLedger()`；`getLedger()` 仅拼装查询参数后请求 `/api/ledger`（evidence: `packages/dashboard/src/views/intent-timeline.tsx:21`, `packages/dashboard/src/api/client.ts:139`）。
> - **Hypothesis Impact**: Refutes hypothesis "UI 直接依赖 ledger 文件路径"
> - **Scope**: ledger 迁移、dashboard compatibility

> **Finding**: ledger entry schema 当前没有 `last_ledger_intent_id` 这类字段，若要建立脚本文档与 ledger 的强链接，应更适合放在脚本文档 metadata，而不是 ledger schema 本身。
> - **Confidence**: High — **Why**: `AiLedgerEntry` / `HumanLedgerEntry` 字段较少且偏事件记录，不包含外部知识引用位（evidence: `packages/shared/src/types/ledger.ts:1`, `packages/shared/src/types/ledger.ts:10`）。
> - **Hypothesis Impact**: Modifies hypothesis "last_ledger_intent_id 应直接进 ledger record"
> - **Scope**: script manifest schema、docs linkage、history traceability

#### Technical Solutions
> **Solution**: 在 `fab_plan_context` 中引入内容寻址式 shared view，但 `shared_logic_hash` 应指向“规则内容集合哈希”，而不是“目录逻辑哈希”。
> - **Status**: Proposed
> - **Problem**: `shared_logic_hash` 命名如果过于语义化，容易掺入目录/业务逻辑概念，和当前 `hash` 体系冲突。
> - **Rationale**: 更稳的方案是按 resolved rule bundle 做 hash，例如 `shared_bundle_hash`，再由 `file_map[path] -> bundle_hash` 映射；这样与现有 node `hash` 更一致。
> - **Alternatives**: 直接返回重复规则内容；沿用 `shared_logic_hash` 命名。
> - **Evidence**: `packages/shared/src/types/agents.ts:19`; `packages/server/src/services/plan-context.ts:13`
> - **Next Action**: 若进入实现，优先设计 bundle-level data model，再决定命名。

> **Solution**: 支持稳定英文 `rule_id` / `script_id`，但优先选 slug-like id，而非 uuid。
> - **Status**: Proposed
> - **Problem**: uuid 稳定但不可读，不利于 CLI、文档、Dashboard 和规则引用。
> - **Rationale**: 像 `ts_naming_conventions`、`copy_dashboard_dist` 这种稳定 slug 更适合人机双读；必要时再补内部 hash。
> - **Alternatives**: 纯 uuid；只用 file path；只用 `file:line`。
> - **Evidence**: `docs/initialization.md:319`; `packages/shared/src/types/agents.ts:12`
> - **Next Action**: 将 stable id 作为 metadata anchor 第一优先级，`file:line` 退居证据定位层。

> **Solution**: 将脚本文档视为 tooling knowledge 是正确方向，但不建议立刻把 `tools` 节点塞进 `agents.meta.json`。
> - **Status**: Proposed
> - **Problem**: `agents.meta.json` 目前语义单一，只描述规则节点；直接塞 `tools` 节点会扩大 registry 与 tool surface 的语义范围。
> - **Rationale**: 更稳的第一步是 docs/manifest 或 `.fabric/agents/_cross/tooling/*.md`，由规则文档引用工具；等用例成熟后再决定是否扩展 meta schema。
> - **Alternatives**: 立即扩展 `agents.meta.json`；完全不做结构化脚本说明。
> - **Evidence**: `packages/shared/src/types/agents.ts:12`
> - **Next Action**: 先定义 script manifest，后评估是否上升为 meta node。

> **Solution**: ledger 双路径嗅探可以采纳，但不建议在“普通读取”时静默 `mv` 自动迁移。
> - **Status**: Proposed
> - **Problem**: 读操作触发写 side effect 会影响可预期性，也可能与并发工具或未提交状态冲突。
> - **Rationale**: 更安全的是显式迁移：优先读新路径，若发现旧路径则返回 migration warning 或由 CLI `fabric doctor --fix` / `fabric migrate-ledger` 执行迁移。
> - **Alternatives**: 读取时静默 mv；直接不兼容旧路径。
> - **Evidence**: 当前仓库已有未提交 `.intent-ledger.jsonl`，说明读路径上静默搬迁可能直接影响用户 worktree。
> - **Next Action**: 如果实现，应把迁移动作设计成显式命令或带确认的修复流程。

#### Analysis Results
- 我同意你对“从路径去重到语义并集”的判断，这一条基本抓到了优化核心。
- 我建议把 `shared_logic_hash` 改成更接近现有数据模型的名字，比如 `shared_bundle_hash` 或 `resolved_bundle_id`。
- “覆盖冲突预检”是很好的补充，但它不应只叫冲突；更准确可以做成 `preflight diagnostics`，同时覆盖：
  - 规则冲突
  - 只命中 description stub 的风险
  - 需要先跑脚本/同步元数据的前置动作
- 你对双语层次的拆法我基本认同，尤其是 `ID / Anchor / Tier` 强英文这点。
- 我更倾向 `slug id` 而不是 `uuid`，因为 Fabric 很强调人可检查性，纯 uuid 会降低可维护性。
- “把脚本视为 Agent 工具组件”这个 framing 很好，说明脚本不只是 docs 对象，而是执行能力对象。
- 但我不建议第一步就把 `tools` 节点写入 `agents.meta.json`，否则会把原本清晰的“规则元图”混成“规则+工具大杂烩”。
- 对 ledger 迁移，我同意双路径嗅探，不同意读取时静默 `mv`。这个仓库现在就有未提交 `.intent-ledger.jsonl`，读路径自动搬迁很容易踩脏工作区。
- 关于 UI 收口，当前实现其实已经走 API，不需要担心 Dashboard 自己拼路径；真正需要收口的是 API 背后的 path resolver。
- 你的“时序对比图”建议很好，适合补进最终分析结论或后续设计文档。

#### Corrected Assumptions
- ~~Dashboard 可能自己拼了 ledger 文件路径~~ → 当前 Dashboard 只通过 `/api/ledger` API 取数。
  - Reason: `packages/dashboard/src/views/intent-timeline.tsx` 与 `packages/dashboard/src/api/client.ts` 已显示是 API 访问模式。
- ~~可以直接把 tools 节点塞进现有 agents meta~~ → 现有 `AgentsMetaNode` 结构并没有多余语义位，贸然扩展会放大改动面。
  - Reason: 当前 schema 仍是纯规则节点模型。

#### Open Items
- `shared view` 输出是采用 bundle hash 映射，还是 node hash 数组 + shared entry pool？
- stable id 最终落在哪：frontmatter、agents meta、还是两边同时保留？
- script manifest 是单独文件，还是文档 frontmatter 聚合导出？
- ledger 迁移是通过 doctor fix、独立 migrate 命令，还是 init/serve 时提示？

#### Narrative Synthesis
**起点**: 基于第一轮分析结论，用户提出了更接近设计稿的 5 条改进建议。  
**关键进展**: 本轮确认这些建议大多方向正确，但需要按当前实现边界做修正，特别是 `shared_logic_hash` 的命名、`tools` 节点的时机、以及 ledger 自动迁移的副作用。  
**决策影响**: 分析方向从“提出建议”进一步收敛为“区分哪些建议可直接采纳，哪些要分阶段推进”。  
**当前理解**: 最优路径是分三层推进：先做 batch shared view 与 ledger path constant 收敛，再做 stable id / bilingual metadata，再视使用情况决定是否将 tooling 进一步进入 agents meta。  
**遗留问题**: 还需要把本轮筛选后的采纳意见合并进最终 recommendations，并决定是否转入实现规划。

#### Intent Coverage Check
- ✅ Intent 1: 规则加载逻辑优化 — 已进一步细化为 shared view / bundle hash / preflight diagnostics。
- ✅ Intent 2: 中文化与英文锚点 — 已进一步细化为 slug-like stable ids + bilingual metadata layering。
- ✅ Intent 3: 脚本文档化与变更维护 — 已进一步细化为 tooling knowledge / script manifest 的分阶段路径。
- ✅ Intent 4: ledger 路径 bugfix — 已进一步细化为双路径嗅探 + 显式迁移而非静默搬迁。

### Round 3 - Critical Review Of Advanced Proposal (2026-04-23T00:20:00+08:00)

#### User Input
用户继续补充了一版更成体系的工程见解：
- 规则加载从逐文件匹配升级为 `resolved_bundle_id` 驱动的语义切片，并加入 `valid_until_hash` 支持 Session 级复用。
- 双语锚点层采用 slug id，并建议通过 ledger 记录“执行了某项协议”而非“改了某段文字”。
- 脚本文档建议从手写 manifest 转向 JSDoc 自动提取，形成自治工具链。
- ledger 路径迁移建议通过 `doctor --fix` 驱动，而不是静默迁移。
- 给出执行优先级：P0 常量/路径收敛、P0 规则 batch/shared、P1 frontmatter id、P2 JSDoc 工具镜像。

#### Decision Log
> **Decision**: 采纳 `resolved_bundle_id`、`doctor --fix`、slug id 这几个方向，但不直接采纳 `valid_until_hash`、Frontmatter 强制化、以及“ledger 记录协议执行”的完整表述。
> - **Context**: 新建议已经明显靠近实现设计，需要与现有协议字段和文档约束对齐。
> - **Options considered**: 基本照单全收；按现有协议约束做兼容性筛选。
> - **Chosen**: 做兼容性筛选。 — **Reason**: 当前系统已经有 `revision_hash/client_hash/stale`，也已有“AGENTS.md 不得含 YAML frontmatter”的既有约束。
> - **Rejected**: 直接吸收会制造术语重复与规范冲突。
> - **Impact**: 最终结论会把这版建议拆成“直接执行项”和“需先改协议/改规范后再执行项”。

#### Key Findings
> **Finding**: `valid_until_hash` 与现有 `revision_hash/client_hash/stale` 语义高度重叠，更像是现有协议的别名而不是新原语。
> - **Confidence**: High — **Why**: 当前 `fab_get_rules` 与 `fab_plan_context` 已返回 `revision_hash`，并接受 `client_hash` 用于 `stale` 判定（evidence: `packages/server/src/services/get-rules.ts:67`, `packages/server/src/services/plan-context.ts:22`, `packages/server/src/tools/plan-context.ts:12`）。
> - **Hypothesis Impact**: Modifies hypothesis "需要新增 valid_until_hash 字段"
> - **Scope**: MCP contract、session cache、client reuse semantics

> **Finding**: 当前仓库对生成的 `AGENTS.md` 有“不得包含 YAML frontmatter”的现成约束，因此 Frontmatter 方案若要推行，需要先明确适用范围不是所有规则文件。
> - **Confidence**: High — **Why**: `agents-md-init` skill 模板明确写了“生成的 AGENTS.md 不得包含 YAML frontmatter”（evidence: `packages/cli/templates/claude-skills/agents-md-init/SKILL.md:82`）。
> - **Hypothesis Impact**: Confirms hypothesis "frontmatter 方案与既有规范存在冲突"
> - **Scope**: rule file format、lint、init workflow

> **Finding**: JSDoc 自动提取脚本元数据比手写 JSON 更抗双写，但会天然绑定 JS/TS 家族，不能覆盖所有脚本形态。
> - **Confidence**: High — **Why**: 当前仓库脚本有 `.mjs`、`.ts`，未来也可能出现 shell 或其他语言；JSDoc 只能天然覆盖一部分脚本。
> - **Hypothesis Impact**: Modifies hypothesis "JSDoc 可作为统一脚本元数据真源"
> - **Scope**: script metadata extraction、tooling portability

> **Finding**: “ledger 记录执行了某项协议”这个表达方向正确，但不适合立刻把 ledger 从 intent log 改造成 protocol execution log。
> - **Confidence**: High — **Why**: 当前 ledger schema 极轻，只承载 `intent/affected_paths/commit_sha` 等字段；而真正的规则合规交叉检查已经在 `audit-log` 里完成（evidence: `packages/shared/src/schemas/ledger-entry.ts:3`, `packages/server/src/services/audit-log.ts:47`）。
> - **Hypothesis Impact**: Modifies hypothesis "应直接把 applied_rule 写进核心 ledger schema"
> - **Scope**: ledger schema、audit trail、history replay

#### Technical Solutions
> **Solution**: 继续采用 `resolved_bundle_id`，但把 Session 级复用建立在现有 `revision_hash` 之上，而不是新增 `valid_until_hash`。
> - **Status**: Proposed
> - **Problem**: 新增 `valid_until_hash` 会与 `revision_hash` 重叠，增加协议名词负担。
> - **Rationale**: 更稳的模型是 `resolved_bundle_id + revision_hash`；只要 revision 未变，client 可以复用 bundle。
> - **Alternatives**: 单独增加 `valid_until_hash`；完全不做 session 复用。
> - **Evidence**: `packages/server/src/services/get-rules.ts:69`; `packages/server/src/services/plan-context.ts:27`
> - **Next Action**: 若实现 shared bundle 视图，优先用现有 revision 语义承载有效期。

> **Solution**: 规则稳定 id 倾向采纳，但不建议第一步强推 YAML frontmatter 到所有 `.md` 规则文件。
> - **Status**: Proposed
> - **Problem**: frontmatter 方案清晰，但与现有 `AGENTS.md` 输出约束冲突。
> - **Rationale**: 更稳的第一步可以是 sidecar manifest、HTML comment header、或仅在 `.fabric/agents/**/*.md` 内允许 metadata，而不改 bootstrap/legacy AGENTS 约束。
> - **Alternatives**: 全面 frontmatter 化；完全放弃 stable id。
> - **Evidence**: `packages/cli/templates/claude-skills/agents-md-init/SKILL.md:82`
> - **Next Action**: 先做“stable id 方案选型”，再决定最终语法承载体。

> **Solution**: JSDoc 提取适合作为 JS/TS 脚本的增量增强，而不是唯一的 tooling registry 真源。
> - **Status**: Proposed
> - **Problem**: 纯 JSDoc 真源会把脚本知识模型绑定到特定语言生态。
> - **Rationale**: 更稳的方式是“manifest 是协议真源，JSDoc 是可选提取器/同步源”；或者“JSDoc + fallback manual entry”双轨。
> - **Alternatives**: 纯手写 manifest；纯 JSDoc 自动提取。
> - **Evidence**: 当前仓库已有 `.mjs`/`.ts` 脚本，但 Fabric 作为框架不应假设未来脚本都可 JSDoc 化。
> - **Next Action**: 如果实现，可先在 JS/TS 脚本上试行提取，再决定是否上升为通用约定。

> **Solution**: 协议执行引用更适合先进入 audit/derived event，而非直接扩张核心 ledger schema。
> - **Status**: Proposed
> - **Problem**: 直接让 ledger 记录 `applied_rule` 会把 intent log 与 compliance/protocol execution 混成一个层。
> - **Rationale**: 现有审计体系已经记录了 `get_rules` 与 `edit_intent` 的时间关系；stable rule refs 更适合先作为 audit enrichment 或 annotation 数据。
> - **Alternatives**: 直接扩展 ledger core schema；完全不记录规则引用。
> - **Evidence**: `packages/server/src/services/audit-log.ts:9`; `packages/shared/src/schemas/ledger-entry.ts:3`
> - **Next Action**: 若要落地，可先给 AI ledger entry 增加可选 `rule_refs`，或在 audit event 中写入 `resolved_bundle_id`。

#### Analysis Results
- 我赞同把 `shared_bundle_hash` 进一步命名成 `resolved_bundle_id`，这个名字更接近“解析结果对象”，不局限于 hash 实现。
- 我不建议再额外引入 `valid_until_hash`。现有 `revision_hash/client_hash/stale` 已经承担了“什么时候失效”的语义；更好的做法是 bundle 复用依附当前 revision。
- 你对时序改写的判断是对的：关键飞跃不是“多文件少调几次 minimatch”，而是把返回对象从 per-path rules 提升为可切片的 resolved bundle。
- `Slug ID 优于 UUID` 我完全同意，这和 Fabric 的可审计、可讨论特性一致。
- 但“Frontmatter 协议头”现在有一个现实冲突：仓库已有 `AGENTS.md` 不得含 YAML frontmatter 的明确约束，所以如果走这条路，要先缩小作用域，不能直接改成全量规则文件强制 frontmatter。
- “ledger 记录执行了某项协议”这个表达很有吸引力，但我会更保守一点。ledger 目前更像 intent stream，真正的规则执行/合规引用更适合先放在 audit enrichment，而不是立刻改造 ledger 的中心语义。
- “JSDoc 自动提取”比手写 JSON 更有生命力，这点我认同；但它天然偏 JS/TS 工具链。作为 Fabric 的统一机制，最好是“manifest 为协议层，JSDoc 为提取器”，不要把协议真源绑定到特定语言注释格式。
- `doctor --fix` 我基本赞同，这比任何静默迁移都稳，是目前 ledger 路径迁移里最合理的显式入口。
- 优先级上，我会微调你的排序：`LEDGER_FILE/getLedgerPath()` 收敛依然应是 P0；但 `Frontmatter/Stable ID` 我倾向提前到和 `plan_context shared view` 同级，至少先做 design 决策。否则 bundle/view 做出来之后，后面还要二次改对象标识。

#### Corrected Assumptions
- ~~需要新增 valid_until_hash 才能表达 session 级复用~~ → 现有 `revision_hash/client_hash/stale` 已具备有效期判断骨架。
  - Reason: 当前协议已经支持 revision-based staleness。
- ~~Frontmatter 可以直接作为所有规则文件统一格式~~ → 现有 `AGENTS.md` 生成规范明确限制了 YAML frontmatter。
  - Reason: 需要先明确适用边界或换一种 metadata 承载体。
- ~~JSDoc 可以自然成为 Fabric 的通用工具元数据语法~~ → 它更像 JS/TS 家族的优化路径，不适合作为唯一跨语言协议层。
  - Reason: Fabric 不能假设未来所有脚本都可被 JSDoc 表达。

#### Open Items
- stable id 最终承载体选什么：frontmatter、HTML comment、sidecar manifest，还是混合方案？
- `resolved_bundle_id` 与 per-path slice 的最小输出结构该如何定义？
- `rule_refs` 应先进入 ledger、audit event，还是 annotation/derived event？
- JSDoc 提取是“真源”还是“生成器”？

#### Narrative Synthesis
**起点**: 用户在上一轮基础上，进一步把方案收敛为更像设计稿的一套工程建议。  
**关键进展**: 本轮确认 `resolved_bundle_id`、`doctor --fix`、slug id 三条方向质量很高，但也识别出两个关键冲突：`valid_until_hash` 与既有 revision 语义重复，Frontmatter 与现有 AGENTS 规范冲突。  
**决策影响**: 后续若进入实现，必须先做“对象标识与承载格式”决策，避免 batch/shared view 先落地后又返工。  
**当前理解**: 最稳的落地路径是：shared constants/path resolver 与 stable id 设计并行启动，然后做 resolved bundle 视图，最后再把 tooling registry 以 manifest + extractor 的方式引入。  
**遗留问题**: 还需要决定 stable id 的最终语法承载和 rule_refs 的落点。

#### Intent Coverage Check
- ✅ Intent 1: 规则加载逻辑优化 — 已延伸到 resolved bundle / revision-based reuse。
- ✅ Intent 2: 中文化与英文锚点 — 已延伸到 stable id 的语法承载体选择。
- ✅ Intent 3: 脚本文档化与变更维护 — 已延伸到 manifest vs JSDoc extractor 的边界。
- ✅ Intent 4: ledger 路径 bugfix — 已延伸到 doctor --fix 作为显式迁移入口。

### Round 5 - Review Of Precompile-In-Meta Proposal (2026-04-23T00:40:00+08:00)

#### User Input
用户进一步提出把 stable id 走“预编译”路线：
- 在 `agents.meta.json` 的 node 上新增 `stable_id` 与 `is_ephemeral`。
- 在 `sync-meta` 中提取文件头 `fab:rule-id` 注释；未找到则生成派生 id 并标记临时状态。
- `doctor` 扫描到临时状态节点时给出提示，并可通过 `doctor --fix` 写回稳定 ID。

#### Decision Log
> **Decision**: 预编译方案优于 get-rules 热路径动态解析，应作为当前首选实现方向。
> - **Context**: 上一轮已基本认可 HTML comment 作为 stable id carrier，当前需要决定解析时机。
> - **Options considered**: get-rules 动态解析；sync-meta 预编译进 meta。
> - **Chosen**: sync-meta 预编译进 meta。 — **Reason**: 它把解析成本移出热路径，也让 doctor / dashboard / MCP 共用同一份身份视图。
> - **Rejected**: 热路径动态解析会让每次规则读取都重复做文本提取，也让 identity 语义分散在多个调用点。
> - **Impact**: stable id 将更像 registry metadata，而不是 get-rules 的临时副产品。

#### Key Findings
> **Finding**: `sync-meta` 当前已经是扫描 `.fabric/agents/**/*.md` 并生成 `agents.meta.json` 的中心入口，非常适合顺手预编译 stable id。
> - **Confidence**: High — **Why**: `computeAgentsMeta()` 已经遍历 shadow rules 文件，读取文件内容并生成 node metadata（evidence: `packages/cli/src/commands/sync-meta.ts:55`, `packages/cli/src/commands/sync-meta.ts:68`, `packages/cli/src/commands/sync-meta.ts:81`）。
> - **Hypothesis Impact**: Confirms hypothesis "stable id 预编译最适合挂在 sync-meta"
> - **Scope**: meta generation、doctor、dashboard、MCP contract

> **Finding**: 当前 `computeRevision()` 只拼接 node `hash`，没有把其他元数据纳入 revision 计算；如果 stable id / 临时状态进入 meta，这个算法需要同步升级。
> - **Confidence**: High — **Why**: `computeRevision()` 目前只基于 node `hash` 计算 revision（evidence: `packages/cli/src/commands/sync-meta.ts:232`）。
> - **Hypothesis Impact**: Confirms hypothesis "预编译 stable id 后 revision 机制也要调整"
> - **Scope**: stale detection、client_hash、bundle reuse

> **Finding**: `stable_id + is_ephemeral` 是可用最小集，但表达力偏弱；更稳的结构是显式记录来源。
> - **Confidence**: Medium — **Why**: 布尔值只能表达“是否临时”，不能表达“来源于声明 / 来源于路径派生 / fix 后已固化”等更细语义。
> - **Hypothesis Impact**: Modifies hypothesis "布尔字段足够长期使用"
> - **Scope**: meta schema、doctor copy、future migrations

#### Technical Solutions
> **Solution**: 预编译 stable id 到 meta，但字段设计优先考虑 `identity_source` 而不是单一 `is_ephemeral`。
> - **Status**: Proposed
> - **Problem**: 纯布尔字段后续扩展性差。
> - **Rationale**: 更稳的最小结构可以是 `stable_id` + `identity_source: "declared" | "derived"`。
> - **Alternatives**: 仅 `stable_id + is_ephemeral`；完全不记录来源。
> - **Evidence**: 预编译后 doctor、dashboard、rule refs 都会消费这份元数据，来源语义很快会变重要。
> - **Next Action**: 若实现，优先选 enum 风格而非布尔风格。

> **Solution**: `doctor --fix` 应只做“插入 comment anchor + 重新 sync-meta”，不要直接改 meta。
> - **Status**: Proposed
> - **Problem**: 如果 doctor 直接改 meta，会让 meta 成为真源而不是规则文件。
> - **Rationale**: 规则文件本体仍应是 stable id 的声明源，meta 只是编译产物。
> - **Alternatives**: 直接改 meta；只提示不 fix。
> - **Evidence**: 既然 carrier 已经选了 HTML comment，fix 最自然的动作就是把 comment 写回规则文件。
> - **Next Action**: doctor fix 完成后应立刻触发 sync-meta 或提示用户执行 sync-meta。

> **Solution**: 预编译 stable id 后，`resolved_bundle_id` 应优先基于 meta 中的 stable ids + revision 生成，而不是重新读文件。
> - **Status**: Proposed
> - **Problem**: 如果 bundle 仍回头扫文件，会抵消预编译收益。
> - **Rationale**: 既然 meta 已经有 stable id，bundle 身份计算应消费编译结果而不是重新解析源文本。
> - **Alternatives**: 在 batch 计算时再次读规则文件提取 comment；只看 node hash。
> - **Evidence**: 预编译的最大价值就是把身份元数据集中在 meta。
> - **Next Action**: 若实现，shared bundle 设计与 meta schema 修改应一起推进。

#### Analysis Results
- 我整体上赞同这条路线，甚至比“在 get_rules 热路径动态提取 comment id”更好。
- `sync-meta` 本来就是“把规则文件编译成 meta”的地方，所以把 stable id 一并编进去，逻辑非常顺。
- 你这个设计最大的优点不是性能，而是一致性：MCP、Doctor、Dashboard、后续 bundle slicing 都能看同一份 identity 视图。
- 但我会改两个点：
  - 我不太想长期保留 `is_ephemeral` 这个布尔命名，更倾向 `identity_source: declared | derived`
  - 我会强烈要求同步修改 `computeRevision()`，否则 stable id / 来源状态变了，client 可能收不到 stale 信号
- `doctor --fix` 这一段我完全认同，但 fix 的对象应该是规则文件，不是 meta。
- 如果这样做，`get_rules` 服务层就可以不碰 comment 解析，只信任 meta；热路径会非常干净。

#### Corrected Assumptions
- ~~stable id 最好在 get-rules 时动态解析，避免污染 meta~~ → 对当前 Fabric 来说，预编译进 meta 反而更统一。
  - Reason: `sync-meta` 已经是规则文件到 meta 的编译入口。
- ~~revision 机制可以原样复用~~ → 一旦 meta 增加 stable id 身份字段，revision 计算需要扩展到身份元数据。
  - Reason: 只看正文 hash会漏掉 identity metadata 变化。

#### Open Items
- schema 最终是 `stable_id + is_ephemeral`，还是 `stable_id + identity_source`？
- `computeRevision()` 是改为 hash 全量 node 序列化，还是至少把 identity 字段拼进去？
- `doctor --fix` 后是自动触发 sync-meta，还是要求用户显式再跑一次？

#### Narrative Synthesis
**起点**: 在 carrier 基本收敛为 HTML comment 之后，用户进一步提出把 stable id 预编译进 meta。  
**关键进展**: 本轮确认“预编译”比“热路径动态解析”更适合 Fabric 当前架构，也识别出 revision 计算必须同步升级。  
**决策影响**: stable id 方案从“选择 carrier”进一步推进到“选择编译位置”，实现方向明显收敛。  
**当前理解**: 当前最佳路线是：规则文件 comment 作为声明源，sync-meta 负责预编译到 meta，doctor 负责发现并固化缺失声明。  
**遗留问题**: 还需要定 identity 字段形态与 revision 计算策略。

### Round 6 - Final Decision Baseline (2026-04-23T00:50:00+08:00)

#### User Input
用户确认：直接按推荐方案全部采纳。

#### Decision Log
> **Decision**: 采用推荐决策作为本轮分析的最终基线，并转入执行范围整理。
> - **Context**: 前几轮已把候选方案、风险与取舍全部摊开，当前用户授权直接按推荐值拍板。
> - **Options considered**: 再逐项确认；直接按推荐值定稿。
> - **Chosen**: 直接按推荐值定稿。 — **Reason**: 关键分叉已充分讨论，继续逐项确认收益很低。
> - **Rejected**: 继续开放式讨论会拖慢收敛。
> - **Impact**: conclusions 与 handoff 将以“已决策基线”而不是“待选方案”表述。

#### Key Findings
> **Finding**: 关键技术分叉现已完成拍板，可以形成稳定的实现范围，不再停留在“方案竞选”阶段。
> - **Confidence**: High — **Why**: 用户已明确接受推荐方案，且前面所有高风险分叉都已有推荐结论。
> - **Hypothesis Impact**: Confirms hypothesis "可以进入实现 handoff"
> - **Scope**: planning handoff、issue splitting、implementation sequencing

#### Technical Solutions
> **Solution**: 采用以下最终决策基线。
> - **Status**: Validated
> - **Problem**: 多轮讨论后仍需一个可执行、无歧义的设计基线。
> - **Rationale**: 只有把协议对象、身份对象和迁移策略拍板，后续实现才不会返工。
> - **Alternatives**: 保持多个候选并行；延迟决策到实现期。
> - **Evidence**: 前 5 轮讨论已覆盖 carrier、编译位置、revision、doctor、ledger path、shared bundle、tooling source-of-truth。
> - **Next Action**: 进入实施计划。

#### Analysis Results
- 最终拍板如下：
  - `stable_id` carrier：规则文件开头 HTML comment，语法固定为 `<!-- fab:rule-id <slug> -->`
  - 提取时机：`sync-meta` 预编译进 `agents.meta.json`
  - identity schema：`stable_id + identity_source: declared | derived`
  - revision：把 `stable_id` 与 `identity_source` 纳入 revision 输入
  - doctor fix：修改规则文件 comment，然后重新 `sync-meta`
  - ledger 新路径：`.fabric/.intent-ledger.jsonl`
  - legacy ledger：只读兼容旧根路径并发 warning，不做读时静默迁移
  - 迁移入口：`fabric doctor --fix`
  - `resolved_bundle_id`：基于排序后的 stable id 集合 + revision 生成
  - `fab_plan_context`：保留现有 `entries[]`，新增 additive `shared` 视图
  - stable id 暴露：通过 MCP 结构化字段暴露，不让 client 自己从正文解析
  - `rule_refs`：暂缓，不先改核心 ledger schema
  - tooling registry：manifest/registry 为真源，JSDoc 仅为提取器

#### Corrected Assumptions
- ~~还需要继续讨论多个平行候选~~ → 当前已经可以直接形成实现 handoff。
  - Reason: 用户已授权按推荐方案直接定稿。

#### Open Items
- 无关键架构分叉待定；剩余问题降级为实现细节。

#### Narrative Synthesis
**起点**: 在多轮分析后，用户选择直接采用推荐方案。  
**关键进展**: 所有关键分叉已经从“待选项”变成“已决策基线”。  
**决策影响**: 分析阶段完成，后续应转入实现规划或 issue 拆分。  
**当前理解**: 现在最重要的不是继续争论方案，而是按这套基线拆任务、定顺序、控回归。  
**遗留问题**: 剩余只是一组实现层细节，不再是架构阻塞。

---

## Decision Trail

### Critical Decisions
- 将本轮分析聚焦为“协议对象收敛问题”，而不是四个孤立 patch 点。
- 将 `fab_plan_context` 定位为既有基础设施，而不是重起炉灶。
- 将“双语稳定性”拆分为人类中文阅读层和机器英文锚点层。

## Synthesis & Conclusions

### Executive Summary
当前四个议题背后的共因是“Fabric 对认知对象的边界定义还不够统一”。规则加载有批量入口但没有 shared union 视图；中文化有 wrapper/core 规范但没有系统化的英文 metadata anchors；脚本存在但没有被纳入统一认知树；ledger 路径则已经在多个层级发生硬编码扩散。

### Key Conclusions
1. 规则加载优化应该优先做协议升级，不只是做缓存。
2. 中文化与英文稳定锚点可以长期共存，但前提是把英文稳定性收敛到结构化字段。
3. 脚本文档化是值得做的，但应作为 Fabric 认知树的一个子域，而不是独立附属系统。
4. `.intent-ledger.jsonl` 迁入 `.fabric/` 应被视为真实 bugfix，但需要兼容式迁移，而不是直接替换路径。

### Recommendations
1. 为 `fab_plan_context` 设计批量共享视图。
2. 为规则与脚本文档定义稳定英文 anchor schema。
3. 先做最小 script manifest / doc 索引，再决定是否纳入 agents meta。
4. 统一 ledger 路径常量并规划兼容迁移。

### Session Statistics
- Total discussion rounds: 1
- Key findings: 5
- Dimensions covered: 3
- Artifacts generated: discussion.md, exploration-codebase.json, explorations.json, conclusions.json
- Decision count: 3

## Plan Checklist

> **This is a plan only — no source code was modified.**

- **Recommendations accepted**: 4
- **Generated**: 2026-04-23T00:55:00+08:00

### 1. 收敛 ledger 路径与常量来源
- **Priority**: high
- **Rationale**: 根目录 `.intent-ledger.jsonl` 已在 server、cli、docs、tests、UI copy 多处扩散，需要先建立唯一真实路径与兼容迁移入口。
- **Target files**: `packages/server/src/services/_shared.ts`, `packages/cli/src/commands/ledger-append.ts`, `packages/cli/src/commands/pre-commit.ts`, `packages/server/src/http.ts`, `packages/server/src/api/events.ts`, `packages/server/src/services/read-ledger.ts`, `packages/server/src/services/doctor.ts`, docs/tests/i18n 相关文件
- **Acceptance criteria**: 全仓仅保留一处 ledger 路径定义；默认读写 `.fabric/.intent-ledger.jsonl`；旧根路径只读兼容并告警；`doctor --fix` 可驱动迁移；文档与测试同步更新
- [ ] Ready for execution

### 2. 为规则文件建立 stable id 预编译链路
- **Priority**: high
- **Rationale**: 后续 shared bundle、rule refs、审计稳定性都依赖统一身份对象。
- **Target files**: `packages/shared/src/types/agents.ts`, `packages/shared/src/schemas/agents-meta.ts`, `packages/cli/src/commands/sync-meta.ts`, `scripts/lint-protected-tokens.ts`, rule templates/docs
- **Acceptance criteria**: 规则文件支持固定的 `fab:rule-id` HTML comment；`sync-meta` 预编译 `stable_id` 与 `identity_source`；revision 计算纳入身份元数据；缺失声明时可生成 derived id 并被 doctor 识别
- [ ] Ready for execution

### 3. 扩展 fab_plan_context 为 shared resolved bundle 视图
- **Priority**: high
- **Rationale**: 解决批量规划阶段重复匹配/读取，形成“shared view + per-path slices + final confirm”的两阶段协议。
- **Target files**: `packages/server/src/services/plan-context.ts`, `packages/server/src/tools/plan-context.ts`, `packages/server/src/services/get-rules.ts`, shared/dashboard consumer types/tests
- **Acceptance criteria**: 保留 `entries[]` 兼容输出；新增 additive `shared` 视图；输出 `resolved_bundle_id`、`shared_entries`、`file_map`、`description_stub_union`、`preflight_diagnostics`；bundle identity 基于 stable ids + revision
- [ ] Ready for execution

### 4. 建立 tooling manifest 作为脚本知识真源
- **Priority**: medium
- **Rationale**: 让脚本从“散落实现”升级为可被规则与 Agent 引用的工具知识对象。
- **Target files**: 新增 tooling manifest / docs，相关 docs 或 `.fabric/agents/_cross/tooling`，后续可选 JSDoc extractor
- **Acceptance criteria**: 至少一份 machine-readable manifest 与一份人读说明；JSDoc 仅作生成/同步增强而非唯一真源；脚本与 related rules 能稳定关联
- [ ] Ready for execution
