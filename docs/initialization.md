# 初始化指南

> 请从标准上手路径开始：[Getting Started](./getting-started.md)。本文是 `fabric init` 状态机、Claude handoff 与 initialization 内部的深度技术参考。

`fabric init` 是 Fabric 的 canonical installer。它先构建初始化计划，再根据运行环境进入以下路径之一：

- `fabric init`
  在 TTY 中打开 wizard，确认计划后执行。
- `fabric init --yes`
  直接接受当前计划并执行，不进入 wizard。
- `fabric init --plan`
  仅打印初始化计划，不写文件。
- `fabric init --reapply --yes`
  对已有 Fabric setup 重新应用 Fabric 管理的 scaffold 与阶段安装器。

执行路径一旦确认，`fabric init` 会为项目提供 evidence 与 protocol，自动完成 bootstrap、MCP config 与 git hooks 安装，并使 Claude Code 或 Codex 在安装对应 follow-up assets 后继续完成项目专属的规则初始化。

> `fabric` 是主命令，`fab` 是永久别名。下文统一使用 `fabric`。

## 概览

`fabric init` 在一条命令里做四件事：

1. Plan：收集 target、阶段选择和 MCP 安装范围，必要时通过 TTY wizard 让用户确认。
2. Evidence：扫描仓库并写入 `.fabric/forensic.json`。
3. Protocol install：写入 `.fabric/bootstrap/README.md`、`.fabric/agents.meta.json`、`.fabric/human-lock.json`，以及 Claude/Codex follow-up assets。
4. Follow-up setup：自动执行 bootstrap install、MCP config install、git hooks install，并打印同 session handoff 的 reason 行。

这种拆分是故意的：Fabric 让 CLI 步骤快速且确定，再由 AI client 完成 semantic initialization。

## Bootstrap 协议与客户端适配

从 `v1.3.1` 开始，bootstrap 阶段已经收敛为“内部 bootstrap guide + 客户端配置”模型：

- 可见 bootstrap 入口固定为 `.fabric/bootstrap/README.md`。
- `fabric bootstrap install` 只负责确保或刷新这份内部 guide。
- bootstrap 阶段不再生成根级 `AGENTS.md`、`CLAUDE.md` 或 `GEMINI.md`。
- Claude Code 的 handoff 仍通过 `.claude/skills/agents-md-init/SKILL.md`、Stop hook 与 `.claude/settings.json` 接力。
- Codex 的 handoff 通过 repo skill `.agents/skills/fabric-init/SKILL.md` 与 repo hooks `.codex/hooks.json` 接力。
- 其他 MCP-capable 客户端通过各自的 MCP config 发现 Fabric server，并在运行期调用 `fab_get_rules`。

> Codex hooks 依赖 `features.codex_hooks = true`。若该 feature 未启用，Codex 仍可手动使用 repo skill `.agents/skills/fabric-init/SKILL.md`，但 `.codex/hooks.json` 中的 `SessionStart` / `Stop` hooks 不会触发。

当前 bootstrap hard rules 仍保持同一组核心约束：

1. 把 Fabric Protocol 明确为规则来源。
2. 在任何代码读取、架构规划或逻辑修改前先调用 `fab_get_rules`。
3. 把 registry 更新与直接编辑 `.fabric/agents.meta.json` 严格分离。
4. 把 `.fabric/human-lock.json` 中的 `@HUMAN` 保护范围视为显式停机点。
5. 在完整任务结束后调用 `fab_append_intent` 记录意图。

需要针对性重跑时仍可使用：

```bash
fabric bootstrap install
fabric bootstrap install --clients claude,cursor,windsurf,roo,gemini,codex
```

这里的 `--clients` 仅用于约束检测与阶段输出；真正的 bootstrap artifact 仍然只会写回 `.fabric/bootstrap/README.md`。

## 前置条件

- 全局安装 CLI 一次：

  ```bash
  npm install -g @fenglimg/fabric-cli
  ```

- 在目标项目根目录运行 `fabric init`。
- 从干净的初始化项目状态开始：
  - 尚不存在 `.fabric/`。
- 完整 Stage 3 到 Stage 6 流程需要 Claude Code。
- 下文运行示例使用 `werewolf-minigame`，一个 Cocos Creator 3.8 TypeScript 项目。

## 7 阶段旅程

### Stage 1：Installation

在机器上安装 Fabric 一次：

```bash
npm install -g @fenglimg/fabric-cli
```

此时项目本身尚未改变。仍无 `.fabric/` 目录、无 `.claude/` initialization 资产、无生成的 bootstrap guide。

---

### Stage 2：运行 `fabric init`

在项目根目录：

```bash
cd ~/projects/werewolf-minigame
fabric init
```

本步会发生：

- 若当前终端为 TTY，先显示 wizard 并让你确认 plan。
- 若使用 `--plan`，本步只输出计划摘要，不写任何文件。
- 若使用 `--yes`，跳过 wizard，直接按当前 flags 执行。
- 若使用 `--reapply --yes`，会以“重应用”模式覆盖 Fabric 管理的 scaffold 文件。

- Fabric 扫描仓库并写入 `.fabric/forensic.json`。
- Fabric 写入 `.fabric/bootstrap/README.md` 与 metadata 文件。
- Fabric 安装 `.claude/skills/agents-md-init/SKILL.md`、`.claude/hooks/agents-md-init-reminder.cjs`、`.claude/settings.json`，并安装 Codex 的 `.agents/skills/fabric-init/SKILL.md`、`.codex/hooks.json` 与 `.codex/hooks/*.cjs`。
- Fabric 自动运行 bootstrap install、MCP config install 与 git hooks install。

来自 disposable `werewolf-minigame` 示例运行的真实输出：

```text
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.fabric/bootstrap/README.md
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.fabric/agents.meta.json
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.fabric/human-lock.json
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.fabric/forensic.json
Installed /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.claude/skills/agents-md-init/SKILL.md
Installed /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.claude/hooks/agents-md-init-reminder.cjs
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.claude/settings.json with Claude Stop hook.
--- Installing bootstrap templates... ---
completed bootstrap: ...
--- Configuring MCP clients... ---
...
--- Installing git hooks... ---
...
Reason: .fabric/forensic.json is ready; some detected clients still need manual follow-up because no Fabric skill is installed for them yet.
```

Stage 2 之后，项目已准备好由 AI 接管，但在 `.fabric/init-context.json` 出现之前，initialization 仍为 pending。若你只运行了 `fabric init --plan`，则 Stage 2 其实尚未开始，因为没有任何文件被写入。

---

### Stage 3：AI Takeover

在 Claude Code 中打开同一仓库并发送普通消息。支持两种触发路径：

- Same-session path：若在 Claude Code 的 Bash tool 中运行 `fabric init`，模型会看到 Stage 2 的 reason 行并触发 `agents-md-init`。
- Cross-session path：若在外部终端运行 `fabric init`，Claude Stop hook 或 Codex Stop hook 会检测存在 `.fabric/forensic.json` 但缺少 `.fabric/init-context.json`，并继续提醒完成 initialization follow-up。

示例 prompt：

```text
I just ran fabric init in this repo. Finish Fabric initialization.
```

关键心智模型：Stage 2 装备仓库，Stage 3 把仓库交给 skill。

---

### Stage 4：Phase 1 Framework Confirm

`agents-md-init` 先读取 `.fabric/forensic.json`，并确认检测到的 framework 假设。

`werewolf-minigame` 示例对话：

```text
AI: I detected a Cocos Creator 3.8 project with scripts under assets/scripts.
    It looks like a TypeScript Component-based codebase using @ccclass.
    Please confirm:
    1. Is this TypeScript rather than JavaScript?
    2. Do node references usually come from @property(Node) injection?

Developer: Yes. It is TypeScript, and we mainly use @property(Node).
```

本阶段刻意保持简短：在 Fabric 询问硬约束之前，先验证 framework model。

---

### Stage 5：Phase 2 Invariants

接下来 skill 收集必须成为项目 rule nodes 与 init context 的硬规则。

`werewolf-minigame` 示例对话：

```text
AI: I need to lock the project invariants:
    1. Ban async/await inside update() and lateUpdate()?
    2. Require every Component class to use @ccclass(name)?
    3. Protect assets/prefabs/** and assets/scenes/** from AI edits?
    4. Protect all **/*.meta files?
    5. Must network traffic go through NetworkManager?

Developer: Yes to all five.
```

本阶段应产出硬规则，而非偏好。若某条规则不确定，先省略，留待日常维护再补。

---

### Stage 6：Phase 3 Generate

Interview 结束后，skill 写入 semantic initialization 输出：

- `.fabric/init-context.json`
- `.fabric/agents/` 下确认后的项目专属 rule nodes
- 更新后的 `.fabric/agents.meta.json` hash

对 `werewolf-minigame`，生成结果应编码例如：

- Cocos Creator 3.8 与 `@ccclass + extends Component`
- 在 `update()` 或 `lateUpdate()` 中不使用 `async/await`
- 保护路径 `assets/prefabs/**`、`assets/scenes/**` 与 `**/*.meta`
- `NetworkManager` 作为必需的 network boundary

当本阶段成功时，initialization 即完成，因为两份 state artifact 均已存在：

- `.fabric/forensic.json`
- `.fabric/init-context.json`

---

### Stage 7：Daily Dev

从此将 `AGENTS.md` 视为持续维护的项目 contract，而非一次性 scaffold。
从此将 `.fabric/bootstrap/README.md`、`.fabric/agents/` 与 `.fabric/agents.meta.json` 视为持续维护的项目 contract，而非一次性 scaffold。

典型后续命令：

```bash
fabric hooks install   # 针对性重跑
fabric sync-meta
```

> `fabric init` 已在 Stage 2 自动运行 hooks install。此处独立命令仅用于需要针对性重跑的场景。

当项目架构、invariants 或 protected paths 变化时，使用持续的 `agents-md` workflow。Initialization skill 为一次性 setup；日常开发是保持 `AGENTS.md` 与 `.fabric/agents.meta.json` 与 codebase 对齐。

## 状态机

```text
[empty project]
    |
    | fabric init (scaffold + bootstrap + MCP + hooks)
    v
[forensic.json exists] + [init-context.json missing]
    |   ^
    |   | Stop hook blocks here until initialization is finished
    |
    | Claude Code + agents-md-init
    v
[forensic.json exists] + [init-context.json exists] + [rule nodes completed]
    |
    | ongoing edits + agents-md maintenance
    v
[rule graph stays in sync with code]
```

## 兼容性矩阵

| Scenario | Trigger mechanism | Result |
| --- | --- | --- |
| 自 Claude Code Bash tool 运行 `fabric init` | 模型从 tool 结果读取 Stage 2 reason 行 | 可在同 session 立即触发 `agents-md-init` |
| 在外部终端运行 `fabric init` | Claude Code Stop hook 或 Codex Stop hook 发现存在 `forensic.json` 但无 `init-context.json` | 下一次客户端 session 会收到 initialization follow-up 提醒 |
| 在 CI 或其他非 TTY 环境运行 `fabric init --yes` | 无 wizard takeover；命令直接写文件并记录 reason 行 | `.fabric/bootstrap/README.md` 与 `.fabric/` artifact 仍有效，但 `.fabric/init-context.json` 不会自动创建 |
| 在任意环境运行 `fabric init --plan` | 只打印计划与核心写入摘要 | 不落盘，适合在 CI/脚本里先做审批或预览 |
| Codex（已启用 `features.codex_hooks = true`） | repo `.codex/hooks.json` 的 `SessionStart` / `Stop` hooks + `.agents/skills/fabric-init/SKILL.md` | 可在仓库内得到 initialization 提醒与 follow-up 上下文 |
| 其他非 Claude client | `.claude/` 与 `.codex/` 文件在无关客户端中为无害 no-op | `.fabric/bootstrap/README.md` 可作为稳定 bootstrap 入口 |

## 故障排除

### Hook 未触发

先检查 sentinel state：

```bash
test -f .fabric/forensic.json && echo "forensic: ok"
test ! -f .fabric/init-context.json && echo "init-context: missing"
test -f .claude/hooks/agents-md-init-reminder.cjs && echo "hook: ok"
test -f .codex/hooks.json && echo "codex hooks: ok"
```

然后确认 `.claude/settings.json` 包含指向 `.claude/hooks/agents-md-init-reminder.cjs` 的 Stop hook entry，或 `.codex/hooks.json` 已存在且 Codex 侧启用了 `features.codex_hooks = true`。若条件满足，在对应客户端中打开仓库并继续 initialization。

```text
Use the agents-md-init skill to finish this project's initialization.
```

### 缺少 `.fabric/forensic.json`

Initialization 未完成 Stage 2。回到项目根目录运行：

```bash
fabric init
```

若因已存在 `.fabric/bootstrap/README.md`、`.fabric/forensic.json` 或其他 `.fabric/` 文件而中止，先检查这些文件，不要覆盖。`fabric init` 刻意设计为非破坏性（除非使用 `--force`）。
若你确认要重新应用 Fabric 管理的 scaffold，请优先使用：

```bash
fabric init --reapply --yes
```

`--force` 仍是底层执行选项，但从用户心智模型上，`--reapply` 才是当前推荐的重应用入口。

### 未生成 `.fabric/bootstrap/README.md`，或仍为通用 bootstrap

`fab init` 在 Stage 2 总会写入 `.fabric/bootstrap/README.md`。更丰富的项目规则稍后由 `agents-md-init` 写入 `.fabric/agents/`。

若 `.fabric/bootstrap/README.md` 完全缺失，Stage 2 未完成。若存在但 `.fabric/init-context.json` 仍缺失，说明 Stage 3 到 Stage 6 尚未完成。在仓库中打开 Claude Code 并继续 initialization review。

### `init-context.json` 无效或不完整

Stop hook 仅在缺少 `.fabric/init-context.json` 时阻塞。若文件存在但 malformed，将其移开并重新跑 initialization interview：

```bash
mv .fabric/init-context.json .fabric/init-context.invalid.json
```

然后重新在项目中打开 Claude Code，并要求再次使用 `agents-md-init`。保留 `.fabric/forensic.json`，以便 skill 复用原始 evidence pack。

## Matcha 交互 / Matcha Interaction

Matcha 模式是 `Check-not-Ask`：先由 CLI 准备 evidence，再由 client 用一屏 Architecture Review 让用户只做纠错或确认，而不是串行回答 5 到 7 个问题。

Phase 0 到 Phase 2 的流转可以用 `werewolf-minigame-stub` 理解：

1. Phase 0：读取 `.fabric/forensic.json` 的 `framework`、`assertions[]`、`candidate_files[]`，并在 `15 files x 100 lines` 的预算内补读关键样本。
2. Phase 1：把候选结论整理成一屏 `Architecture Review`，按 `framework`、`architecture_pattern`、`proposed_rule`、`domain_boundary` 四个分区展示，每项都附 `file:line` 锚点。
3. Phase 2：只把确认后的集合写入 `.fabric/init-context.json` 和 `.fabric/agents/`，不在业务目录落任何 rule file。

单屏 Review 的具体示例如下：

```md
# Architecture Review

## framework
- [HIGH] 这是一个 Cocos Creator TypeScript Component 项目，核心类通过 `@ccclass(...)` 暴露给引擎。
  evidence: examples/werewolf-minigame-stub/assets/scripts/Game.ts:5, examples/werewolf-minigame-stub/assets/scripts/Network.ts:5, examples/werewolf-minigame-stub/assets/scripts/Player.ts:5
  write status: implicit accept unless corrected

## architecture_pattern
- [HIGH] 主要游戏脚本集中在 `assets/scripts/`，适合映射到 `.fabric/agents/assets/scripts/*.md` 的镜像节点。
  evidence: examples/werewolf-minigame-stub/assets/scripts/Game.ts:1, examples/werewolf-minigame-stub/assets/scripts/Network.ts:1, examples/werewolf-minigame-stub/assets/scripts/Player.ts:1
  write status: implicit accept unless corrected

## proposed_rule
- [HIGH] 初始化输出必须保留 Cocos component decorators、lifecycle methods 与配对的 `.meta` sidecar。
  evidence: examples/werewolf-minigame-stub/assets/scripts/Game.ts:5, examples/werewolf-minigame-stub/assets/scripts/Game.ts.meta:1
  write status: implicit accept unless corrected

## domain_boundary
- [MEDIUM] 网络相关约束应汇总到独立边界，再映射到 mirror 节点或 `_cross` 节点。
  evidence: examples/werewolf-minigame-stub/assets/scripts/Network.ts:5
  write status: explicit accept required
```

用户在这个屏幕里只需要做两类动作：

- 纠正某个 `HIGH` 项，例如“framework 不是泛化的 cocos，而是 Cocos Creator 3.8 TypeScript”。
- 显式接受某个 `MEDIUM` 或 `LOW` 项，例如“接受 `domain_boundary`：网络边界统一落到 `.fabric/agents/_cross/security.md`”。

Phase 2 的输出也是具体可见的：`HIGH` 且未被纠正的项会直接进入 `.fabric/init-context.json`；被显式接受的 `MEDIUM` 项会补充生成对应的 `.fabric/agents/root.md`、`.fabric/agents/assets/scripts/*.md` 或 `.fabric/agents/_cross/*.md` 节点。

## 置信度分档 / Confidence Tiers

`HIGH`、`MEDIUM`、`LOW` 不是文案语气，而是可写入决策的定量门槛。当前实现使用量化规则决定每个 assertion 能否默认进入 Phase 2。

| Tier | 定量定义 | 写入语义 | 用户动作 |
| --- | --- | --- | --- |
| `HIGH` | `astLevel = true`，或 `coverage.ratio >= 0.8` 且 `co_occurring_patterns.length >= 2` | 默认可写 | 不反对即接受；若错误则直接纠正 |
| `MEDIUM` | 不满足 `HIGH`，且无冲突，通常是 `0.5 <= coverage.ratio < 0.8` 或只有单一模式证据 | 不可默认写入 | 必须显式回复“接受” |
| `LOW` | `coverage.ratio < 0.5`，或存在冲突信号 `hasConflict = true` | 不可默认写入 | 只有显式接受后才能写，否则丢弃 |

用户纠错流程应保持固定：

1. 看 Phase 1 的整屏输出，而不是被逐题追问。
2. 对错误的 `HIGH` 项直接给出修正版，修正后版本替换原项进入 Phase 2。
3. 对 `MEDIUM` 或 `LOW` 项明确回复“接受”或“不接受”；未明确接受的内容不得写入 `.fabric/init-context.json` 或 `.fabric/agents/`。

一个最小化回复示例：

```text
修正 framework：这是 Cocos Creator 3.8 TypeScript。
接受 domain_boundary：网络相关约束写入 .fabric/agents/_cross/security.md。
不接受 proposed_rule：当前项目没有强制单一 NetworkManager。
```

这意味着：

- 第一行会覆盖原先的 `HIGH` framework 结论。
- 第二行会让一个原本 `MEDIUM` 的边界项变成可写集合。
- 第三行会阻止该规则进入任何输出文件。

## Shadow Mirroring 架构 / Shadow Mirroring Architecture

Shadow Mirroring 的核心不是“把 `AGENTS.md` 挪个地方”，而是把语义规则树完整收敛到 `.fabric/agents/`，并让物理文件路径与业务路径脱钩。

一个典型目录结构如下：

```text
.fabric/
  agents/
    root.md
    packages/
      cli/
        index.md
        src/
          commands/
            index.md
      server/
        index.md
    _cross/
      security.md
```

这里有三个关键约束：

- `.fabric/agents/root.md` 是全局入口，承载 bootstrap 之后仍需长期生效的全局规则。
- `.fabric/agents/{path}/index.md` 是 mirror 节点，按源码目录 1:1 镜像。例如 `packages/cli/` 的语义规则放在 `.fabric/agents/packages/cli/index.md`，而不是放在 `packages/cli/AGENTS.md`。
- `.fabric/agents/_cross/security.md` 这类文件承载跨切面规则，例如安全、发布、审计等，不归属于单一业务目录。

`agents.meta.json` 中的 `topology_type` 只允许两种值：

| 节点文件 | `topology_type` | 典型 `scope_glob` |
| --- | --- | --- |
| `AGENTS.md` | `mirror` | `**` |
| `.fabric/agents/root.md` | `mirror` | `**` |
| `.fabric/agents/packages/cli/index.md` | `mirror` | `packages/cli/**` |
| `.fabric/agents/packages/server/src/commands/index.md` | `mirror` | `packages/server/src/commands/**` |
| `.fabric/agents/_cross/security.md` | `cross-cutting` | `**` |

`scope_glob` 决定“这条规则管谁”，而不是“这条规则放在哪”。例如客户端请求 `packages/server/src/index.ts` 时，`fab_get_rules` 会用 `scope_glob` 匹配 `packages/server/**` 与 `**`，再返回命中的 mirror 节点和 cross-cutting 节点。

最重要的一条是业务目录零规则文件：

- `packages/cli/AGENTS.md` 不应继续存在。
- `packages/server/AGENTS.md` 不应继续存在。
- `src/AGENTS.md` 或任何同类 colocated rule file 都不应继续存在。

规则只应存在于 `.fabric/agents/` 与 `.fabric/agents/_cross/`，不需要桥接文件，也不需要 `@import` 聚合层。

## 客户端兼容性与迁移 / Client Compatibility & Migration

Fabric requires MCP-capable client。更直接地说：如果 client 不能稳定调用 `fab_get_rules`、`fab_update_registry` 和 `fab_append_intent`，它就无法完整执行 Fabric Protocol。

| Client | MCP 能力 | 是否兼容 Fabric | 说明 |
| --- | --- | --- | --- |
| Claude Code | 有 | ✅ | 可直接消费 `.claude/` bootstrap 与 Fabric MCP tools |
| Cursor w/ MCP | 有 | ✅ | 需要把 Fabric server 配进 MCP 列表 |
| Codex | 有 | ✅ | 能调用同一组 MCP tools，适合作为并行实现 client |
| Gemini CLI | 有 | ✅ | 只要接入同一个 MCP server，即可走相同协议 |
| legacy Cursor（无 MCP） | 无 | ❌ | 无法可靠调用 `fab_get_rules`，会回到 perception-phase vacuum |
| 纯 IDE | 无 | ❌ | 只能看文件，不能执行 Fabric runtime protocol |

迁移到 Shadow Mirroring 时，按下面四步走即可：

1. 将 `packages/X/AGENTS.md` 的语义内容迁移到 `.fabric/agents/packages/X/index.md`。例如把 `packages/server/AGENTS.md` 的边界规则移到 `.fabric/agents/packages/server/index.md`。
2. 删除原来的 colocated `AGENTS.md`，确保业务目录恢复为 ZERO rule files。
3. 运行 `fab sync-meta`，让 `.fabric/agents.meta.json` 重新生成 `layer`、`topology_type` 与 `scope_glob`。
4. 用 `fab_get_rules` 验证迁移结果。例如请求 `packages/server/src/index.ts`，预期返回至少包含 `AGENTS.md`、`.fabric/agents/root.md` 与 `.fabric/agents/packages/server/index.md`，而不再返回 `packages/server/AGENTS.md`。

如果迁移后仍然看到 colocated `AGENTS.md` 被命中，说明镜像树还没收敛完成；先清理旧节点，再重新执行 `fab sync-meta` 和 `fab_get_rules` 验证。

## 参考链接

- [`agents-md-init` skill template](../templates/claude-skills/agents-md-init/SKILL.md)
- [`agents-md-init` Stop hook template](../templates/claude-hooks/agents-md-init-reminder.cjs)
- [`fab init` implementation](../packages/cli/src/commands/init.ts)
