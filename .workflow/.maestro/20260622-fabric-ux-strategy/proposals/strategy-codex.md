{"id":"item_0","type":"error","message":"failed to parse hooks config /Users/wepie/Desktop/personal-projects/pcf/.codex/hooks.json: unknown field `events`, expected `hooks` at line 2 column 10"}[Exec: /bin/zsh -lc 'maestro search "fabric knowledge architecture strategy field model"']
我会按只读模式处理：先满足项目要求做知识检索，然后只读取相关资料和关键源码片段，不进行任何写入。接下来我会先加载被点名的 `fabric` skill 规则，再展开三类输入源。[Exec: /bin/zsh -lc "sed -n '1,240p' /Users/wepie/Desktop/personal-projects/pcf/.codex/skills/fabric/SKILL.md"]
`fabric` 入口 skill 这里只提供运维路由，不适合直接产出架构提案；我会保留它的 store 安全约束作为边界。现在开始枚举指定上下文文件，并只选取 maestro-flow 中与知识检索、可信度、注入相关的关键片段。[Exec: /bin/zsh -lc 'rg --files .workflow/.analysis/kb-arch-complete']
上下文里 `.workflow/.analysis/kb-arch-complete` 只有 7 个结论文件，适合完整读取；`maestro-flow` 文件量很大，我会按任务指定集中在 search、credibility、keyword-spec-injector，并补几处 guide / dashboard / tests 证据。[Exec: /bin/zsh -lc 'nl -ba .workflow/.analysis/kb-arch-complete/final-synthesis/conclusions.json']
初步证据已经显示两条硬约束：Fabric 的强项是多 Store 物理隔离、生命周期、引用追踪、MCP；但体验问题集中在字段和规则外显。接下来我会读取其余分析结论，以及 maestro 的关键实现证据，用来判断哪些复杂度可以下沉到引擎。[Exec: /bin/zsh -lc 'nl -ba .workflow/.analysis/kb-arch-complete/maestro-governance/conclusions.json']
maestro 的关键差异不是字段更少，而是把映射、预算、去重、衰减和注入时机放进代码路径里。这个对 Fabric 的启发很直接：公开 frontmatter 应该只承载作者必须确认的事实，其余都由 recall / hook / ledger 派生。[Exec: /bin/zsh -lc "nl -ba ../maestro-flow/src/hooks/spec-injector.ts | sed -n '1,130p'"]
我还需要补一小块 Fabric 现状字段证据，避免只凭擂主描述复述。会用只读 `rg` 定位 `layer`、`semantic_scope`、`relevance_paths` 等字段定义或文档位置，然后收束成提案。[Exec: /bin/zsh -lc "rg -n \"semantic_scope|visibility_store|relevance_scope|relevance_paths|layer:|layer\\b|scope:\" packages src docs schemas .fabric .workflow -g '*.ts' -g '*.md' -g '*.json'"]
# Analysis：Fabric 交互与策略迭代提案

## Related Files
- `.workflow/.analysis/kb-arch-complete/*.json`：完整读取 7 个分析结论，覆盖 Fabric、Maestro、竞品、UI、wizard、测试、最终综合。
- `.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md`：交互研究与 “complexity should be absorbed by the system” 核心原则。
- `docs/ARCHITECTURE.md`、`docs/RUNTIME-CONTRACTS.md`、`docs/USER-QUICKSTART.md`：Fabric 当前 scope/store、MCP、pending 示例。
- `packages/shared/src/schemas/api-contracts.ts`、`packages/shared/src/schemas/scope.ts`、`packages/server/src/services/extract-knowledge.ts`、`packages/server/src/services/cross-store-write.ts`、`packages/server/src/services/recall.ts`：当前字段与写入/召回行为。
- `../maestro-flow/src/commands/search.ts`、`../maestro-flow/src/graph/kg/credibility.ts`、`../maestro-flow/src/hooks/spec-injector.ts`、`../maestro-flow/src/hooks/keyword-spec-injector.ts`、`../maestro-flow/src/tools/spec-keyword-index.ts`、`../maestro-flow/guide/spec-*.md`：按题设读取关键片段，未逐行通读整个 `../maestro-flow` 仓库。

## Summary
我的方案：**把擂主的 3 字段再压成 2 个作者字段：`audience` + `paths`，其余全部变成 engine-derived / readonly metadata；把 cite/self-archive 从 AGENTS.md 考纲改成 hook + ledger 的状态机；把 3 stage 保留，但在写 pending 前加机器质量闸。** 这比擂主更进一步地内化复杂度，也比 maestro 更适合 Fabric，因为 Fabric 的护城河是 MCP 跨端和多 store 物理隔离，而不是单 workspace spec/wiki 系统。

## 1. 对擂主四块判断

| 擂主块 | 判断 | 理由 |
|---|---|---|
| 交互 1：SessionStart 单 HUD、PreToolUse 一行、Stop 闭嘴 | **保留并细化** | 研究明确支持 progressive disclosure / responsive salience，避免 hook 输出刷屏：`.workflow/scratch/.../design-research.md:29`、`:80`、`:216`。Fabric 当前强项是 MCP lifecycle，但缺统一反馈面：`.workflow/.analysis/kb-arch-complete/final-synthesis/conclusions.json:80`。 |
| 交互 2：11 phase 砍成 3 stage | **保留，但加 pre-pending quality gate** | 当前 archive skill 仍把大量分类、scope、paths、semantic_scope 暴露给 AI/用户：`.codex/skills/fabric-archive/SKILL.md:28`、`:118`、`:140`。3 stage 正确，但不能让低质候选直接污染 pending。 |
| 交互 3：nudge 响应式渐强，并从 Stop 搬到 SessionStart | **保留** | Stop 应只写 ledger；用户可见反馈应集中在下一次 SessionStart。竞品也有 context gauge / References 类可视反馈：`.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json:36`、`:84`、`:133`。 |
| 策略 4：`layer/scope/when` 三字段 | **改进，压成 `audience/paths` 两字段** | 当前架构已经说 `semantic_scope` 是逻辑受众、`visibility_store` 是物理 provenance，resolver 负责映射：`docs/ARCHITECTURE.md:40`。`layer` 只是兼容 hint：`docs/RUNTIME-CONTRACTS.md:52`。所以公开 `layer + scope` 是重复心智负担。 |

## 2. 字段模型与内化方案

当前问题证据：`fab_extract_knowledge` schema 仍要求/暴露 `layer`、`semantic_scope`、`relevance_scope`、`relevance_paths`、`proposed_reason`、`session_context` 等：`packages/shared/src/schemas/api-contracts.ts:667`、`:688`、`:698`、`:732`。写入时又会生成 `layer`、`semantic_scope`、`visibility_store`：`packages/server/src/services/extract-knowledge.ts:685`、`:689`、`:694`。这就是复杂度重复出现。

**新模型：作者/审核者只看 2 个作用域字段：**

- `audience`：谁能用。取值为 open coordinate：`personal`、`project:fabric-v2`、`team`、未来 `org:acme:team:platform`。这复用现有 open scope grammar：`packages/shared/src/schemas/scope.ts:31`。
- `paths`：什么时候自动提醒。空或缺省 = broad；非空 glob = path-match。`relevance_scope` 由 `paths.length` 推导，不再手写。
- `store` / `visibility_store`：只读 provenance，由 resolver 写入，用户不选。
- `layer`：删除公开字段。内部可由 `audience` root 推导：`personal -> personal layer / KP-*`，其他 -> shared/team layer / KT-*`。
- `activation`：不落 frontmatter，运行时推导。`guidelines/models + paths=[]` 进 SessionStart；`paths!=[]` 走 PreToolUse；`must_read_if/intent_clues` 走 intent-match；manual 由 `fab_recall ids` 实现。

**Before：当前式 frontmatter**

```yaml
type: pitfalls
maturity: draft
layer: team
semantic_scope: project:fabric-v2
visibility_store: "team"
source_sessions: ["s1"]
proposed_reason: diagnostic-then-fix
summary: Atlas premultiplyAlpha mismatch causes black edges.
relevance_scope: narrow
relevance_paths: ["src/render/**", "assets/atlas/**"]
intent_clues: ["atlas loader"]
tech_stack: ["cocos"]
impact: ["transparent sprite black edge"]
must_read_if: "touching atlas runtime loader"
tags: ["atlas", "premultiply-alpha"]
```

**After：human-authored / review surface**

```yaml
type: pitfall
audience: project:fabric-v2
summary: Atlas premultiplyAlpha mismatch causes black edges on transparent sprites.
paths: ["src/render/**", "assets/atlas/**"]
tags: ["atlas", "premultiply-alpha"]
```

**After：engine envelope，默认折叠，只读**

```yaml
fabric:
  id: KT-PIT-0001
  maturity: draft
  store: team
  source_sessions: ["s1"]
  proposed_reason: diagnostic-then-fix
  created_at: "2026-06-22T00:00:00Z"
  confidence:
    signal: high
    novelty: medium
```

安全边界不削弱：`audience: personal` 仍硬路由 personal store；personal scope 写 shared store 继续拒绝。现有代码已有 R5#3 防线：`packages/server/src/services/cross-store-write.ts:120`、`:148`。

## 3. Cite 与 Self-Archive 如何内化

**Cite policy：从“AI 写 `KB:` 合同”改成“engine 记账 + 风险提示”。**

- PreToolUse 自动记录：本次 edit paths、最近 `fab_recall` 命中、read body ids。
- PostToolUse 生成 `knowledge_usage` ledger：`matched / read / edited / missed / stale`。
- 现有 7 operator 不再让 AI 写；默认由 `audience + paths + type + must_read_if` 推导。
- 只有极少数可执行约束保留可选 `guards`，例如 `require_symbol` / `forbid_symbol`，由 review 或 doctor 维护，不出现在 AGENTS.md。

这借鉴 maestro 的做法：注入映射、预算、去重都在代码里，非让 agent 背规则。`spec-injector` 用 agent type 映射 category：`../maestro-flow/src/hooks/spec-injector.ts:79`，再走预算：`:293`；keyword 注入有 session 去重和上限 5 条：`../maestro-flow/src/hooks/keyword-spec-injector.ts:61`、`:96`。

**Self-archive：从“AI marker 触发”改成“hook/ledger 状态机触发”。**

- UserPromptSubmit 检测 normative / dismissal-with-reason。
- Stop 或 PostToolUse 检测 wrong-turn-revert：失败路径、撤回、替代方案、最终修复。
- `fab_archive_scan` 返回候选、drop reason、水位线；AI 只负责摘要措辞，不负责记住触发规则。
- 用户只看到一行 receipt：`Fabric archived 1 candidate -> pending/...`；误记可 `reject`。

## 4. 交互层方案

- **SessionStart HUD**：只显示状态，不显示规则。示例：`Fabric: team+personal stores | audience project:fabric-v2 | 14 active KB | 3 pending | 1 suggested review`。
- **PreToolUse 一行**：`Fabric KB: 2 relevant for src/render/** — KT-PIT-0001, KT-DEC-0007 [details: fabric recall --last]`。
- **Archive receipt**：只说写入 store、pending path、为何触发；不展开 phase。
- **Review surface**：单队列，但每条显示 `confidence / duplicate flag / privacy risk / suggested action`，而不是让用户读 frontmatter。
- **Stop**：默认不输出，只写 ledger；超阈值 nudge 挪到下一次 SessionStart。

## 5. Maestro 到 Fabric 功能集成清单

| 功能 | 价值 | 成本 | 本版？ |
|---|---:|---:|---|
| Agent/category 映射式注入，改成 client/task/audience/type 映射 | 高 | 中 | 是 |
| Context budget + compact context wrapper | 高 | 低 | 是 |
| Keyword index + CJK n-gram | 高 | 中 | 是 |
| Search result credibility decay | 高 | 中 | 是 |
| Injection analytics / ledger 事件 | 高 | 低 | 是 |
| L1-L4 测试分层，补 archive→review→recall e2e 和 recall stress | 高 | 中 | 是 |
| Wiki health / graph / reader dashboard | 中高 | 高 | 否，P1 |
| Install wizard / onboarding wizard | 中 | 高 | 否，P1 |
| Maestro 9 类 knowhow 全量迁移 | 低 | 高 | 否；Fabric 保持 5 类型更清晰 |
| Spec/Knowhow 双层模型 | 中 | 高 | 否；只借鉴 “summary index + body on demand” 模式 |

## 一句话总结
这版比擂主更强在于把 `layer/scope/when` 继续压缩为 `audience/paths` 并把 cite/self-archive 规则移进 hook/ledger；比 maestro 更强在于不复制单 workspace spec/wiki 复杂度，而是保留 Fabric 的 MCP 跨端、多 store 物理隔离和生命周期治理护城河。[Tokens: 1338138in/9759out]

# Analysis：Fabric 交互与策略迭代提案

## Related Files
- `.workflow/.analysis/kb-arch-complete/*.json`：完整读取 7 个分析结论，覆盖 Fabric、Maestro、竞品、UI、wizard、测试、最终综合。
- `.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md`：交互研究与 “complexity should be absorbed by the system” 核心原则。
- `docs/ARCHITECTURE.md`、`docs/RUNTIME-CONTRACTS.md`、`docs/USER-QUICKSTART.md`：Fabric 当前 scope/store、MCP、pending 示例。
- `packages/shared/src/schemas/api-contracts.ts`、`packages/shared/src/schemas/scope.ts`、`packages/server/src/services/extract-knowledge.ts`、`packages/server/src/services/cross-store-write.ts`、`packages/server/src/services/recall.ts`：当前字段与写入/召回行为。
- `../maestro-flow/src/commands/search.ts`、`../maestro-flow/src/graph/kg/credibility.ts`、`../maestro-flow/src/hooks/spec-injector.ts`、`../maestro-flow/src/hooks/keyword-spec-injector.ts`、`../maestro-flow/src/tools/spec-keyword-index.ts`、`../maestro-flow/guide/spec-*.md`：按题设读取关键片段，未逐行通读整个 `../maestro-flow` 仓库。

## Summary
我的方案：**把擂主的 3 字段再压成 2 个作者字段：`audience` + `paths`，其余全部变成 engine-derived / readonly metadata；把 cite/self-archive 从 AGENTS.md 考纲改成 hook + ledger 的状态机；把 3 stage 保留，但在写 pending 前加机器质量闸。** 这比擂主更进一步地内化复杂度，也比 maestro 更适合 Fabric，因为 Fabric 的护城河是 MCP 跨端和多 store 物理隔离，而不是单 workspace spec/wiki 系统。

## 1. 对擂主四块判断

| 擂主块 | 判断 | 理由 |
|---|---|---|
| 交互 1：SessionStart 单 HUD、PreToolUse 一行、Stop 闭嘴 | **保留并细化** | 研究明确支持 progressive disclosure / responsive salience，避免 hook 输出刷屏：`.workflow/scratch/.../design-research.md:29`、`:80`、`:216`。Fabric 当前强项是 MCP lifecycle，但缺统一反馈面：`.workflow/.analysis/kb-arch-complete/final-synthesis/conclusions.json:80`。 |
| 交互 2：11 phase 砍成 3 stage | **保留，但加 pre-pending quality gate** | 当前 archive skill 仍把大量分类、scope、paths、semantic_scope 暴露给 AI/用户：`.codex/skills/fabric-archive/SKILL.md:28`、`:118`、`:140`。3 stage 正确，但不能让低质候选直接污染 pending。 |
| 交互 3：nudge 响应式渐强，并从 Stop 搬到 SessionStart | **保留** | Stop 应只写 ledger；用户可见反馈应集中在下一次 SessionStart。竞品也有 context gauge / References 类可视反馈：`.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json:36`、`:84`、`:133`。 |
| 策略 4：`layer/scope/when` 三字段 | **改进，压成 `audience/paths` 两字段** | 当前架构已经说 `semantic_scope` 是逻辑受众、`visibility_store` 是物理 provenance，resolver 负责映射：`docs/ARCHITECTURE.md:40`。`layer` 只是兼容 hint：`docs/RUNTIME-CONTRACTS.md:52`。所以公开 `layer + scope` 是重复心智负担。 |

## 2. 字段模型与内化方案

当前问题证据：`fab_extract_knowledge` schema 仍要求/暴露 `layer`、`semantic_scope`、`relevance_scope`、`relevance_paths`、`proposed_reason`、`session_context` 等：`packages/shared/src/schemas/api-contracts.ts:667`、`:688`、`:698`、`:732`。写入时又会生成 `layer`、`semantic_scope`、`visibility_store`：`packages/server/src/services/extract-knowledge.ts:685`、`:689`、`:694`。这就是复杂度重复出现。

**新模型：作者/审核者只看 2 个作用域字段：**

- `audience`：谁能用。取值为 open coordinate：`personal`、`project:fabric-v2`、`team`、未来 `org:acme:team:platform`。这复用现有 open scope grammar：`packages/shared/src/schemas/scope.ts:31`。
- `paths`：什么时候自动提醒。空或缺省 = broad；非空 glob = path-match。`relevance_scope` 由 `paths.length` 推导，不再手写。
- `store` / `visibility_store`：只读 provenance，由 resolver 写入，用户不选。
- `layer`：删除公开字段。内部可由 `audience` root 推导：`personal -> personal layer / KP-*`，其他 -> shared/team layer / KT-*`。
- `activation`：不落 frontmatter，运行时推导。`guidelines/models + paths=[]` 进 SessionStart；`paths!=[]` 走 PreToolUse；`must_read_if/intent_clues` 走 intent-match；manual 由 `fab_recall ids` 实现。

**Before：当前式 frontmatter**

```yaml
type: pitfalls
maturity: draft
layer: team
semantic_scope: project:fabric-v2
visibility_store: "team"
source_sessions: ["s1"]
proposed_reason: diagnostic-then-fix
summary: Atlas premultiplyAlpha mismatch causes black edges.
relevance_scope: narrow
relevance_paths: ["src/render/**", "assets/atlas/**"]
intent_clues: ["atlas loader"]
tech_stack: ["cocos"]
impact: ["transparent sprite black edge"]
must_read_if: "touching atlas runtime loader"
tags: ["atlas", "premultiply-alpha"]
```

**After：human-authored / review surface**

```yaml
type: pitfall
audience: project:fabric-v2
summary: Atlas premultiplyAlpha mismatch causes black edges on transparent sprites.
paths: ["src/render/**", "assets/atlas/**"]
tags: ["atlas", "premultiply-alpha"]
```

**After：engine envelope，默认折叠，只读**

```yaml
fabric:
  id: KT-PIT-0001
  maturity: draft
  store: team
  source_sessions: ["s1"]
  proposed_reason: diagnostic-then-fix
  created_at: "2026-06-22T00:00:00Z"
  confidence:
    signal: high
    novelty: medium
```

安全边界不削弱：`audience: personal` 仍硬路由 personal store；personal scope 写 shared store 继续拒绝。现有代码已有 R5#3 防线：`packages/server/src/services/cross-store-write.ts:120`、`:148`。

## 3. Cite 与 Self-Archive 如何内化

**Cite policy：从“AI 写 `KB:` 合同”改成“engine 记账 + 风险提示”。**

- PreToolUse 自动记录：本次 edit paths、最近 `fab_recall` 命中、read body ids。
- PostToolUse 生成 `knowledge_usage` ledger：`matched / read / edited / missed / stale`。
- 现有 7 operator 不再让 AI 写；默认由 `audience + paths + type + must_read_if` 推导。
- 只有极少数可执行约束保留可选 `guards`，例如 `require_symbol` / `forbid_symbol`，由 review 或 doctor 维护，不出现在 AGENTS.md。

这借鉴 maestro 的做法：注入映射、预算、去重都在代码里，非让 agent 背规则。`spec-injector` 用 agent type 映射 category：`../maestro-flow/src/hooks/spec-injector.ts:79`，再走预算：`:293`；keyword 注入有 session 去重和上限 5 条：`../maestro-flow/src/hooks/keyword-spec-injector.ts:61`、`:96`。

**Self-archive：从“AI marker 触发”改成“hook/ledger 状态机触发”。**

- UserPromptSubmit 检测 normative / dismissal-with-reason。
- Stop 或 PostToolUse 检测 wrong-turn-revert：失败路径、撤回、替代方案、最终修复。
- `fab_archive_scan` 返回候选、drop reason、水位线；AI 只负责摘要措辞，不负责记住触发规则。
- 用户只看到一行 receipt：`Fabric archived 1 candidate -> pending/...`；误记可 `reject`。

## 4. 交互层方案

- **SessionStart HUD**：只显示状态，不显示规则。示例：`Fabric: team+personal stores | audience project:fabric-v2 | 14 active KB | 3 pending | 1 suggested review`。
- **PreToolUse 一行**：`Fabric KB: 2 relevant for src/render/** — KT-PIT-0001, KT-DEC-0007 [details: fabric recall --last]`。
- **Archive receipt**：只说写入 store、pending path、为何触发；不展开 phase。
- **Review surface**：单队列，但每条显示 `confidence / duplicate flag / privacy risk / suggested action`，而不是让用户读 frontmatter。
- **Stop**：默认不输出，只写 ledger；超阈值 nudge 挪到下一次 SessionStart。

## 5. Maestro 到 Fabric 功能集成清单

| 功能 | 价值 | 成本 | 本版？ |
|---|---:|---:|---|
| Agent/category 映射式注入，改成 client/task/audience/type 映射 | 高 | 中 | 是 |
| Context budget + compact context wrapper | 高 | 低 | 是 |
| Keyword index + CJK n-gram | 高 | 中 | 是 |
| Search result credibility decay | 高 | 中 | 是 |
| Injection analytics / ledger 事件 | 高 | 低 | 是 |
| L1-L4 测试分层，补 archive→review→recall e2e 和 recall stress | 高 | 中 | 是 |
| Wiki health / graph / reader dashboard | 中高 | 高 | 否，P1 |
| Install wizard / onboarding wizard | 中 | 高 | 否，P1 |
| Maestro 9 类 knowhow 全量迁移 | 低 | 高 | 否；Fabric 保持 5 类型更清晰 |
| Spec/Knowhow 双层模型 | 中 | 高 | 否；只借鉴 “summary index + body on demand” 模式 |

## 一句话总结
这版比擂主更强在于把 `layer/scope/when` 继续压缩为 `audience/paths` 并把 cite/self-archive 规则移进 hook/ledger；比 maestro 更强在于不复制单 workspace spec/wiki 复杂度，而是保留 Fabric 的 MCP 跨端、多 store 物理隔离和生命周期治理护城河。
