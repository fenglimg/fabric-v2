# TDD Refactor Preflight Concerns

**Session**: ANL-2026-04-25-fabric-v2核心认知对齐方案
**Date**: 2026-04-25
**Purpose**: 在进入 TDD 重构前，明确顾虑、未对齐点和必须先测试锁定的边界。

## 结论先行

我不建议现在直接进入实现。当前方向是对的，但“核心认知对齐方案”还没有被拆成足够稳定的协议边界。如果直接改，会很容易把一个已经漂移的项目继续推向另一套漂移：表面上有 L0/L1/L2、Description Schema、Requirement Profile，实际上各层职责仍然混在一起。

更稳的入口是先写 characterization tests，把现状和目标行为同时钉住，再按从外到内的顺序改：

1. 先锁 `fabric init` 产物和 `.fabric/INITIAL_TAXONOMY.md`。
2. 再锁 shared schema 的兼容解析。
3. 再锁 `fab_plan_context` 的 profile-ranked description 输出。
4. 再锁编辑前 rule section batch fetch。
5. 最后锁 L2 > L1 > L0 的协议可见性。

## 最高优先级顾虑

### 1. 规则出现时机还没有被协议化

用户预期是：已经查看具体脚本后，编辑前再查看规则。当前工具说明只有 `fab_get_rules` 的描述写着修改文件前调用，`fab_plan_context` 是计划阶段批量查询，但代码层没有表达“脚本已查看”这个状态。

证据：

- `packages/server/src/tools/get-rules.ts:35` 只有工具描述。
- `packages/server/src/tools/plan-context.ts:81` 只表达计划阶段批量查询。
- `packages/server/src/services/plan-context.ts:12` 的 input 只有 `paths` 和 `client_hash`。

风险：

- AI client 可能在未看脚本时拿到完整规则，导致上下文再次偏离。
- description stub、full rule、mandatory section 三种时机可能混用。

TDD 前置测试：

- `fab_plan_context` 只返回 description/profile candidates，不返回 mandatory sections。
- 新的 section fetch API 必须要求 stable_id 批量输入，并且语义是“编辑前确认注入”。
- 工具 output 中需要明确 `phase` 或 `delivery_mode`。

### 2. L0/L1/L2 的命名已经达成，但对象模型还没达成

用户希望：

- L0 = Global，全局不可变协作规范。
- L1 = Domain/Module，技术栈或功能领域级。
- L2 = Local，具体脚本或特定资源处理细则。

当前实现仍允许从路径深度派生 layer。

证据：

- `packages/shared/src/schemas/agents-meta.ts:60` 仍在缺失 layer 时调用 `deriveAgentsMetaLayer`。
- `packages/shared/src/schemas/agents-meta.ts:88` 到 `110` 仍按路径深度返回 L0/L1/L2。
- `packages/cli/src/commands/sync-meta.ts:193` 到 `196` 用派生 layer 生成 node id。

风险：

- 新方案说 L1 是 Domain/Module，但测试仍可能证明“路径两层以内就是 L1”。
- 如果保留 path-derived default，不加迁移标识，未来 AI 看到 L1 也不知道它是领域规则还是历史镜像规则。

TDD 前置测试：

- structured registry node 显式声明 `level/domain/module` 时，不再被文件深度覆盖。
- legacy `.fabric/agents/**/*.md` 节点被标记为 legacy/mirror source。
- L1 bucket matching 优先基于 description/profile，不基于路径深度。

### 3. `agents.meta.json` 的索引真源边界还不清楚

上一轮结论是 registry-first，而不是 JSON-only。现在仍需明确：

- meta 是否只存 routing/index/description。
- rule body 是否通过 `content_ref` 指向 MD。
- `.fabric/agents/` 是否只是 legacy import path。
- 新规则正文是否放在 `.fabric/rules/*.md`、`.fabric/rules/{stable_id}.md`，还是沿用现目录。

证据：

- 当前 `AgentsMetaNode` 只有 `file`，没有 `content_ref` 或 content store 语义：`packages/shared/src/types/agents.ts:13`。
- 当前 server 直接按 `node.file` 读取整篇正文：`packages/server/src/services/get-rules.ts:190` 到 `197`。

风险：

- 如果直接扩展 `file` 语义，会继续把“规则文件路径”和“规则索引身份”混在一起。
- 如果把正文塞进 meta，会破坏 Markdown 可维护性。

TDD 前置测试：

- 新 schema 明确支持 `content_ref`，legacy `file` 自动适配。
- server rule loader 通过 resolver 读 content，不在业务逻辑里直接假设 `.fabric/agents/`。
- sync-meta legacy importer 能生成新 registry shape，但不成为新架构的唯一入口。

### 4. Description Schema 的字段语义还需要冻结

用户给出的 schema 方向正确。关于身份字段的认知已修正：

- Description 不拥有 `id`。
- 规则身份统一使用 node-level `stable_id`。
- `level` 是 node/rule 字段；如果 description index 中出现 level，它也是 node metadata 的投影，不是 description 自身身份。

仍需定义：

- `impact` 是枚举还是自由字符串？
- `must_read_if` 是人类可读文本，还是可匹配条件？
- `intent_clues` 是否需要支持中英文、正则、权重？

当前实现只有 `activation.description?: string`。

证据：

- `packages/shared/src/types/agents.ts:8` 到 `11`。
- `packages/shared/src/schemas/agents-meta.ts:33` 到 `38`。

TDD 前置测试：

- legacy string description parse 为 `{ summary }`。
- structured description 至少包含 `summary`, `intent_clues`, `tech_stack`, `impact`, `must_read_if`。
- output 保留 stable_id，RuleDescription schema 明确不定义 id，避免身份分裂。

### 5. Requirement Profile 的生成责任必须定清

用户提出的画像包括 Target Path、Known Tech、User Intent、Detected Entities。我倾向 server-side profile with optional client hints，但这还没被明确落成协议。

证据：

- `PlanContextInput` 当前没有 `intent`、`known_tech`、`detected_entities`：`packages/server/src/services/plan-context.ts:12`。
- tool schema 当前没有 profile hints：`packages/server/src/tools/plan-context.ts:7` 到 `16`。

风险：

- 如果让 AI client 自己拼 profile，每个 client 行为会漂移。
- 如果 server 过早做 AST/entity detection，范围会变大，TDD 难以收敛。

TDD 前置测试：

- 第一版只做 deterministic profile：path、extension、user intent hints、known tech hints、detected entities hints。
- entity detection 可先作为 optional hints，不阻塞核心 ranking。
- ranked candidates 必须返回 `score` 和 `match_reasons`。

### 6. L1 “一般命中所有”与“画像匹配”存在张力

当前实现中 `activation.tier = description` 是全局命中。

证据：

- `packages/server/src/services/get-rules.ts:279` 到 `283`，description 直接 `return true`。
- `packages/server/src/services/get-rules.test.ts:46` 到 `87` 明确测试了 description stub 即使 path 不匹配也返回。

风险：

- 如果 L1 description 全局出现，规模变大后噪声会再次压垮 AI。
- 如果 L1 严格 path-scoped，又可能漏掉跨路径领域规则。

建议拍板：

- L1 description 可以全局进入 candidate pool，但不能全部进入 mandatory injection。
- `fab_plan_context` 对 L1 返回 ranked candidates；只有高分或用户/AI 选择后的 stable_id 才进入 section fetch。

### 7. 结构化 MD 不能靠脆弱字符串截取

用户建议的分区是正确方向，但需要先定义 parser 行为：

- marker 是必须二级标题，还是任何标题级别？
- section 名是否大小写敏感？
- 重复 section 是合并、报错、还是保留顺序？
- 缺失 mandatory section 是空数组还是 fallback 全文？
- section 内是否允许嵌套标题？

TDD 前置测试：

- parser 覆盖 missing、duplicate、nested heading、unordered sections。
- batch API 按 stable_id + section names 返回内容。
- 默认只取 `[MANDATORY_INJECTION]`，调试模式可取 full content。

### 8. 冲突优先级不是排序问题，而是覆盖语义问题

用户明确希望 L2 > L1 > L0。当前排序按 priority，然后 node id；payload 分 L1/L2 数组，但没有 effective precedence。

证据：

- `packages/server/src/services/get-rules.ts:150` 到 `155` 按 priority + id 排序。
- `packages/server/src/services/get-rules.ts:213` 到 `220` 只输出 `L0`, `L1`, `L2`。

建议拍板：

- `priority` 只在同层内部排序。
- 跨层覆盖语义固定为 L2 > L1 > L0。
- payload 显式输出 `precedence: ["L0", "L1", "L2"]` 和 `conflict_resolution: "L2 overrides L1 overrides L0"`。

### 9. 当前项目自身 `.fabric/` 不完整，会干扰自举式认知对齐

当前根项目 `.fabric/` 只有 audit 文件，没有 active registry。

证据：

- `find .fabric -maxdepth 3 -type f` 只返回 `.fabric/audit.jsonl`。
- `docs/RULE_REGISTRY.md` 也记录缺失 `.fabric/agents.meta.json`、bootstrap、agents、human-lock。

建议：

- 实施代码前，不一定要运行 `fabric init` 改根项目状态；但必须在测试 fixture 中模拟完整 `.fabric`。
- 如果要让本仓库自举，先单独开一个任务恢复或初始化根 `.fabric`，不要夹在本次协议重构中。

### 10. 现有未提交改动需要隔离

工作区已有修改：

- `.fabric/audit.jsonl`
- `.intent-ledger.jsonl`
- `packages/cli/src/scanner/tree-sitter-probe.ts`

建议：

- 本次重构首阶段不碰 `tree-sitter-probe.ts`。
- entity detection 先做 optional hints，不依赖 tree-sitter。

## 需要用户拍板的问题

1. 新规则正文目录：采用 `.fabric/rules/`，还是继续 `.fabric/agents/` 但只改语义？
2. `Description.id` 已取消，统一用 node `stable_id`。后续 TDD 应加入 schema 断言。
3. L1 candidate pool 是否允许全局进入，但由 profile ranking 降噪？
4. Requirement Profile 第一版是否只做 deterministic hints，不做 AST？
5. section API 是新建 `fab_get_rule_sections`，还是扩展 `fab_get_rules`？
6. `.fabric/INITIAL_TAXONOMY.md` 是纯留痕 Markdown，还是也要有 machine-readable JSON sidecar？
7. L0 是否仍保存在 `.fabric/bootstrap/README.md`，还是也进入统一 content_ref？
8. `priority` 是否降级为同层排序，跨层永远固定 L2 > L1 > L0？

## TDD 切分建议

### Phase A: Characterization tests

- shared schema 兼容旧 node。
- sync-meta legacy mirror 扫描仍可工作。
- get-rules description tier 当前全局返回 stub 的行为被记录。
- plan-context shared bundle 仍能 dedupe。

### Phase B: Init taxonomy contract

- `buildInitFabricPlan` 包含 `taxonomyPath`、`taxonomyAction`、`taxonomyContent`。
- `executeInitFabricPlan` 写入 `.fabric/INITIAL_TAXONOMY.md`。
- content 包含 L0/L1/L2 判定准则、初始 L1 bucket、evolution guide。

### Phase C: Schema migration

- structured `RuleDescription` 可 parse。
- legacy string description 自动 wrap。
- registry node 支持 `content_ref`，legacy `file` 仍可读。
- explicit `level/domain` 不被 path depth 覆盖。

### Phase D: Plan context profile ranking

- input 接受 optional `intent`, `known_tech`, `detected_entities`。
- output 有 `requirement_profile` 和 `ranked_candidates`。
- L1 candidate score 由 tech_stack/intent_clues/entities/path hints 共同决定。

### Phase E: Section injection API

- parser 提取 `[MANDATORY_INJECTION]`。
- batch API 按 stable_id 返回 requested sections。
- 缺失 section 有 deterministic diagnostic。

### Phase F: Conflict protocol

- payload 输出 fixed precedence metadata。
- 同层 priority 排序不影响跨层覆盖语义。
- docs 和 tool schema 同步。

## 当前建议

下一步不要直接“实现全部方案”。应该先确认上面的 8 个拍板问题，然后把 Phase A-F 做成 TDD 任务序列。每个 phase 的第一步都是写失败测试，避免在重构中继续凭感觉修补。
