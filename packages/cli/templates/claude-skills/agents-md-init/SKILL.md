---
name: agents-md-init
description: Use this skill when fab init just completed, when forensic.json generated, or when the user is asking to initialize AGENTS.md. This skill runs a 3-phase initialization interview, writes .fabric/init-context.json, generates layered AGENTS.md, and updates .fabric/agents.meta.json.
allowed-tools: Read, Write, Glob, Grep, Bash
---

## Precondition

必须先 Read `.fabric/forensic.json`。若该文件不存在，终止 skill 并告知用户：`请先运行 fab init 生成证据包`。

把以下状态视为 initialization pending：

- `.fabric/forensic.json` 存在
- `.fabric/init-context.json` 不存在

## 执行流程 (3 Phase / 3 Round)

### Phase 1 — 框架确认(1 轮,高效)

展示 `.fabric/forensic.json` 的 `framework`、`topology.by_ext`、`entry_points` 摘要，向用户提 1-2 个框架架构澄清问题。

示例(Cocos Creator 3.x)：

> 我检测到 Cocos Creator 3.8 项目，主要脚本在 `assets/scripts`，采用 `@ccclass + extends Component` 模式。请确认：(1) 这是 TypeScript 项目(非 JavaScript)对吗？(2) 节点引用主要通过 `@property(Node)` 注入，还是 `find/getChildByName`？

将用户确认结果暂存为已验证 framework assumptions。

### Phase 2 — 不变式提取(1 轮,关键)

基于 `.fabric/forensic.json` 的 `recommendations_for_skill` 列表，向用户提 3-5 个 invariants 问题，覆盖三类：

- `ban`：禁止 any、禁止 update() 中 async、禁止 find-by-name 等
- `require`：必须 strict TypeScript、必须 `@ccclass` decorator、必须 import from `cc` only 等
- `protect`：哪些目录或文件 AI 不能修改，一般是 `assets/prefabs/**`、`assets/scenes/**`、`**/*.meta`

原则：

- 只问 invariants，不问 preferences
- 每个问题只接受 yes/no/具体规则，不接受模糊回答
- 不要自动推测用户未确认的硬约束

### Phase 3 — 构造与落地(1 轮,自动)

1. 写入 `.fabric/init-context.json`，包含：

- `framework`
- `architecture_patterns`
- `invariants`
- `domain_groups`
- `interview_trail`
- `forensic_ref`

写入规则：

- `invariants[].type` 必须是 `ban`、`require`、`protect`
- `domain_groups` 由 `entry_points` 和访谈结果推断
- `interview_trail[]` 必须记录 Phase 1 和 Phase 2 的原始问答
- `forensic_ref` 必须为 `.fabric/forensic.json`

2. 生成分层 `AGENTS.md`：

- 根 `AGENTS.md` 必须在 300 行以内，结构包含：
- `# {projectName} — L0 AGENTS.md`
- `<!-- fab:index -->`：填充 `domain_groups` 索引
- `## L0 AI Constraints`：从 invariants 派生，按 `ban`、`require`、`protect` 分段
- `## @HUMAN`：protect 路径和用户声明的人类保护规则
- `## L1 Candidate Notes`：domain_groups 对应的候选子模块说明

如果 `domain_groups.length >= 2`，为每个 group 生成 `{group_path}/AGENTS.md`。最多到 L3，总嵌套不超过 4 层。

3. 更新 `.fabric/agents.meta.json` 的 nodes 树，保持 revision hash 链一致：

- nodes 结构与生成后的 AGENTS 层级一致
- 更新所有变更 AGENTS 文件的 hash
- 保持 revision hash 链内部一致

4. 最终输出：向用户列出生成文件清单，并建议后续维护时运行 `fabric doctor --fix`。

## Hard Rules

- Zero TODO: 不生成任何 `TODO`、`TBD`、placeholder、stub
- No YAML frontmatter in outputs: 除本 skill 自身外，生成的 `AGENTS.md` 不得包含 YAML frontmatter
- Root AGENTS.md <= 300 lines
- AGENTS 嵌套总层级 <= 4
- 不得自动推测用户未确认的 invariants
- 有不确定内容时删除，不要留占位符
