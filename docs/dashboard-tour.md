# Dashboard 导览

> v1.1 功能
>
> Dashboard 明确归入 v1.1，不属于 Fabric v1.0 的发布面承诺。
> 本文记录的是 v1.1 的观测面体验目标，以及它如何承接 v1.0 已落盘的规则、锁和 ledger。

Dashboard 不是第二个编辑器，也不是另一个配置中心。
它是 Fabric 的 observability plane：

- CLI 负责把规则织进仓库。
- MCP 负责运行时分发。
- Dashboard 负责把规则生态展开给维护者看。

当前仓库实现里，`fab serve` 默认会打印本地地址：

```text
Fabric Dashboard: http://127.0.0.1:7373
```

## 页面定位

维护者打开 Dashboard 的第一目标，不是立即改配置，
而是快速回答三个问题：

1. 规则现在是什么状态。
2. 最近发生了哪些人机协作事件。
3. 当前有哪些 agent 或角色在参与这套语义契约。

[截图占位：Dashboard shell，含 header、version badge、CONNECTED 状态]

建议的首屏元素：

- `fabric` wordmark 与 `F` lettermark
- 当前版本徽章
- `CONNECTED` 状态
- 中文主标签 / 英文副标签的双语导航

## Ledger View

> v1.1 Feature：Ledger View 把 append-only intent history 变成维护者可读的时间线。

[截图占位：Ledger view，展示最近的 AI 与 Human entry]

Ledger View 负责解释「最近发生了什么」，而不是只展示原始 JSONL。
它应至少覆盖以下信息：

- Source  
  区分 AI 与 Human 来源。
- Time  
  告诉维护者事件先后顺序。
- Diff Summary  
  用一句话概括变更影响。
- Status  
  显示是否已通过锁校验或需要人工确认。

推荐的展示片段：

| Source | Time | Diff Summary |
| --- | --- | --- |
| AI | 09:14 | `Game.ts`: tighten phase transition guard before daybreak |
| Human | 09:11 | confirm `role-balance-config` remains maintainer-owned |
| AI | 08:56 | `Player.ts`: rename ambiguous `state` field to `roleState` |

Ledger View 的价值在于，它把「谁改了什么」升级为
「谁出于什么意图，在什么语义边界上做了改动」。

## Rules View

> v1.1 Feature：Rules View 让 `AGENTS.md` 第一次从静态文本变成可检查的结构树。

[截图占位：Rules view，含 root scope、revision hash、各 domain 节点]

Rules View 应展示当前规则树及其同步状态：

- `revision_hash`
- 最近一次 `fab sync-meta` 时间
- 根规则与子 scope 的层级关系
- 每个节点的路径、hash、priority 和附近 human lock 状态

近似线框可以是：

```text
root
├─ AGENTS.md                         rev 84f7a2c1   synced 09:06
├─ gameplay
│  ├─ assets/scripts/Game.ts        hash a3b018d9   nearby lock: yes
│  └─ assets/scripts/Player.ts      hash 61cbf7a4   nearby lock: no
└─ network
   └─ assets/scripts/Network.ts     hash 4d9bc771   nearby lock: no
```

Rules View 回答的问题是：
当前仓库的 semantic contract 到底长什么样，
以及它是否仍然和磁盘上的 artifact 保持同步。

## Agents View

> v1.1 Feature：Agents View 让维护者看到 agent roster、职责边界与协作协议，而不是只看文件清单。

[截图占位：Agents view，展示五个狼人杀角色与职责]

对于 `examples/werewolf-minigame-stub` 这样的样例，
Agents View 应至少覆盖 5 个角色 agent：

- Villager
- Werewolf
- Seer
- Witch
- Hunter

每个 agent 卡片应展示：

- Role purpose
- Owned decisions
- Inputs and outputs
- Forbidden actions
- Collaboration partners

这样维护者一眼就能知道：
哪些角色是共享状态消费者，
哪些角色拥有夜晚动作，
哪些角色会对胜负判定产生直接影响。

## Human Lock 与 Drift Signals

[截图占位：Human Lock 卡片，`role-balance-config` 为绿色状态]

Dashboard 不应该只展示「有锁」。
它还要展示锁的健康状态：

- `approved_hash`
- `current_hash`
- drift status
- label
- affected file and line range

当漂移发生时，Ledger View 和 Rules View 也应该同步给出告警信号，
这样维护者不需要依赖口头同步就能追溯风险来源。

## Daily Loop

Dashboard 真正成立，不在于首屏截图，
而在于团队进入日常节奏后仍然有用。

一个典型循环是：

1. AI 在 client 里完成一次小改动。
2. pre-commit 执行 `fab sync-meta --check-only`、`fab human-lint`、`fab ledger-append --staged`。
3. SSE 把新事件推到 Dashboard。
4. 维护者在 Ledger View 看到新增记录，在 Rules View 或 Human Lock 卡片里判断是否存在 drift。

如果一切正常，Dashboard 显示绿色健康状态。
如果有人碰到了 `@HUMAN` 锁或破坏了规则边界，
维护者应该能在一个界面里看到：

- 哪个文件发生了问题
- 来自哪个来源
- 问题属于锁漂移、规则不同步还是 agent 职责越界

## 与 v1.0 的关系

Dashboard 必须清楚标注为 v1.1，
否则会让 v1.0 的发布面看起来承诺过多。

正确的叙事是：

- v1.0 先解决落规和分发。
- v1.1 再解决可观测维护。

如果需要完整的三幕产品叙事，请阅读 [Launch Story](./launch-story.md)。
