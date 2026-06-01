---
name: fabric-store
description: 知识 store 运维门面 — 创建 / 挂载 / 绑定 / 列出 / 切换写目标。CLI `fabric store …` 做事，本 skill 按用户意图选命令。NOT for git-managing 用户自己的产品仓。Triggers 创建 store/挂载 store/绑定知识库/store 列表/切换写库/set up knowledge store.
---

# fabric-store — 知识 store 运维

每个「知识 store」操作的对话入口。CLI (`fabric store …`) 是引擎；本 skill 按用户意图挑命令。*store* 是 `~/.fabric/stores/<uuid>/` 下的平行 git 仓 —— 与用户的产品仓不同。同步 (pull+push) 见姊妹 skill `fabric-sync`。

## When to use

- 「创建团队 store」「建个人知识 store」
- 「挂载团队 store」「这个项目要绑团队 store」
- 「列出挂了哪些 store?」「我的共享决策写到哪个 store?」

## When NOT to use

- git 同步用户自己的产品仓 (那是普通 `git`)。
- 同步知识 store (pull/push 冲突解决) → 用 `fabric-sync` skill。
- 写知识条目 → 用 `fabric-archive` / `fabric-review`。

## 意图 → 命令映射

| 意图 | 命令 |
|---|---|
| 创建全新本地 store | `fabric store create --alias <a> [--remote <url>]` |
| 挂载已存在的磁盘 store | `fabric store add --uuid <u> --alias <a> [--remote <url>]` |
| 本项目声明需要某 store | `fabric store bind <alias-or-uuid>` |
| 列出挂载的 store | `fabric store list` |
| 设置非 personal scope 的写目标 | `fabric store switch-write <alias>` |
| 解释某 alias 如何解析 | `fabric store explain <alias>` |
| 同步 (pull+push) | 见 `fabric-sync` skill |

## Precondition

已 `fabric install --global` (存在 `~/.fabric` + 全局 store registry)。无全局配置 → 提示先 `fabric install --global`，停止。

## Constraints

- `store remove` 是 *detach ≠ delete*：从 registry 卸载但 MUST 保留磁盘 git 树。
- `store add` MUST 拒绝磁盘无 store 树的 uuid (无「幽灵挂载」) —— 先 clone (`fabric install --global --url <remote>`) 或 `store create`。
- 知识条目写在各 store 的 `.fabric/knowledge/` 下；本 skill 只管 store 生命周期,不写条目。
- Personal-scope 写永远落在隐式 personal store，与 active write store 无关。
- Hook/skill NEVER 直接解析 store 或执行 store 内文件 (S65 RCE 防线：store 是数据-only)；所有 store 状态 MUST 经 CLI JSON 输出获取。
