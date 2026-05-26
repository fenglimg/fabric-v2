# Dashboard 导览

> v2.0 功能
>
> Dashboard 已重构为只读的诊断观测面。
> 本文记录它如何通过四大核心主题（Readiness、Rules Explain、Timeline、Health）承接已落盘的规则、账本与健康状态。

Dashboard 不是第二个编辑器，也不是另一个配置中心。
它更像 Fabric 的观察面板：

- CLI 负责把规则织进仓库并执行修复。
- MCP 负责运行时将上下文分发给 AI 客户端。
- Dashboard 负责把规则生态与健康状态展开给维护者看。

当前仓库实现里，`fabric serve` 默认会打印本地地址：

```text
Fabric Dashboard: http://127.0.0.1:7373
```

## 页面定位

维护者打开 Dashboard 的第一目标，不是立即改配置，
而是快速回答四个问题：

1. **Readiness**: 这个项目准备好使用 Fabric 了吗？
2. **Rules Explain**: 为什么某个路径会命中这些规则，当前的规则拓扑是怎样的？
3. **Timeline**: 过去发生了哪些人机协作或审查注释（Audit Annotation）事件？
4. **Health**: 当前系统的健康状态如何，需要哪些 CLI 操作来修复？

[截图占位：Dashboard shell，含四大一级导航、版本徽章、CONNECTED 状态]

建议的首屏元素：

- `fabric` wordmark 与 `F` lettermark
- 当前版本徽章
- `CONNECTED` (MCP Runtime) 状态
- 中文主标签 / 英文副标签的双语导航

## Readiness (准备情况)

> 回答：「项目准备好使用 Fabric 了吗？」

Readiness 主题聚焦于项目的高维扫描（Scan）结果，完全只读。
包含信息：

- **Framework**: 探测到的框架和版本。
- **Files**: 项目文件与忽略文件计数。
- **Fabric Status**: 是否已初始化 `.fabric` 目录。
- **Readiness Evidence**: `README.md` 与 `CONTRIBUTING.md` 质量。
- **Recommendations**: 根据扫描结果给出的下一步建议（以纯文本 CLI 命令的形式提供）。

## Rules Explain (规则解析)

> 回答：「为什么命中这条规则，规则系统全貌如何？」

取代了早期独立的 Rules View 和 Topology View，融合为沉浸式的分屏面板。

- **Registry Tree (左侧)**: `.fabric/rules/` 的文件层级拓扑展示。
- **Context & Heatmap (右侧)**: 
  - **Hit Reason**: 根据输入的样本路径，展示 L0/L1/L2 与 description stubs 命中详情。
  - **Coverage Heatmap**: 展现当前规则系统的目录覆盖率。

这里**不会**提供规则的增删改查（CRUD）功能。

## Timeline (时间线)

> 回答：「过去发生了什么，状态如何演变？」

取代了早期独立的 Ledger 和 History 视图。

- **Intent Timeline**: 按时间倒序排列的意图账本，过滤 AI 和 Human 来源。
- **Audit Annotation**: 允许人类维护者添加审计备注（不再使用 "Approval" 语义）。
- **History Replay**: 在侧边栏选择历史节点，实时渲染出该节点时刻的规则树（Registry Tree）状态快照。

Timeline 将「谁改了什么」升级为「谁出于什么意图，在什么语义边界上做了改动」。

## Health (系统健康)

> 回答：「系统健康吗，我需要怎么做？」

结合了 Doctor 和运行时连接状态监测。

- **Control Plane Boundaries**: 明确界定 Dashboard 仅作为查看器（Viewer），任何修复动作（如漂移修正）必须通过复制 `$ fabric doctor --fix` 等命令在 CLI 中执行。
- **Doctor Summary**: 快速查看 Fixable Errors / Manual Errors / Warnings 的数量，以及元数据版本信息。
- **Issue List**: 具体按错误类别列出的诊断列表。
- **MCP Connection**: 实时侦测并展示当前 SSE 运行时的存活状态。

## 与早期版本的关系

Dashboard 在演进过程中，彻底移除了 "Approval"（审批）和 "Human Lock"（人工锁定）等存在歧义的写操作控制流，将 Web 端的定位收敛为纯粹的只读可观测平台（Viewer）。
写操作的职责全权交由 CLI（例如 `fabric sync-meta`、`fabric doctor --fix`）与 MCP 工具处理。

Dashboard 的协议边界和源码入口见 [SPEC_INTERNAL](./SPEC_INTERNAL.md) 与 [CODEBASE_LANDSCAPE](./CODEBASE_LANDSCAPE.md)。
