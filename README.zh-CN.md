# Fabric

[![npm version](https://img.shields.io/npm/v/@fenglimg/fabric-cli.svg)](https://www.npmjs.com/package/@fenglimg/fabric-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

[English](./README.md) | **简体中文**

> **第一次来?** 先看 [`docs/USER-QUICKSTART.md`](./docs/USER-QUICKSTART.md)(5 分钟）——心智模型、四步循环、上手前 30 分钟的排错。

> Fabric —— 面向 AI Coding Agent 的跨客户端知识 sustainment 层。

## 从 AGENTS.md 到一个知识闭环

AI Coding Agent 很强，但它不会“记住”。每开一次新会话，它都要重新理解一遍代码库，重新争论一遍同样的决策。那些你真正希望它记住的东西——为什么选 Postgres 不选 Mongo、上季度坑过我们的认证 bug、CI 里会挂的那个部署步骤——散落在 Slack、PR 评论，以及在 `CLAUDE.md` 和 Codex 配置之间各自漂移的 `AGENTS.md` 里。

`AGENTS.md` 是一个很好的起点：它告诉 Agent **该读什么**。但它没有解决**知识如何被持续沉淀、审核、治理和复用**。规则文件是静态的，会在不同客户端之间分叉，而且没有生命周期——一条记录是一次性的，还是已被反复验证的稳定规则？它过期了吗？该提升、降级，还是归档？

Fabric 就是补上这段闭环的那一层。它是**一个 MCP-first 的知识层，所有受支持的客户端都通过它读写**，外加一个 hook 驱动的提醒层，让知识在该出现的时候真的出现——而不污染 Agent 的上下文。

```text
                ┌───────────────────────────────┐
                │   fabric-knowledge-server     │
                │   (MCP · 5 个工具 · stdio)    │
                └───────────────┬───────────────┘
        ┌───────────────────────┴───────────────────────┐
        ▼                                                ▼
   Claude Code                                       Codex CLI
        │     CLI  ·  Hooks  ·  Skills  ·  MCP           │
        └───────────────────────┬───────────────────────┘
                                 ▼
              ┌──────────────────────────────────────┐
              │  ~/.fabric/stores/<store>/            │
              │    knowledge/{decisions, pitfalls,    │
              │      guidelines, models, processes}   │
              │    + pending/   + events / metrics    │
              │  全局挂载、按 repo 绑定               │
              │  <repo>/.fabric = 仅策略 + 配置       │
              └──────────────────────────────────────┘
```

## 借什么，舍什么

Fabric 与腾讯 AI 团队那篇方法论文章同源（那篇文章帮忙命名了这个问题域），保留了能产生复利的内核：

- **知识类型化** —— 五类：`decisions`、`pitfalls`、`guidelines`、`models`、`processes`（复数目录，schema 枚举强约束）。
- **成熟度** —— 只有三档：`draft` → `verified` → `proven`。
- **生命周期** —— 知识要经历提议、审核、提升、降级、归档。
- **按需消费** —— Agent 先拿索引，相关时才读正文。

同时刻意剔除了那套重型外壳：不强制 16 阶段工作流，不绑定 IDE。核心论点是：**工作流不是目的，知识 sustainment 才是目的。**

## 一个底座，四个面

Fabric 是一个**知识底座**（知识存在哪 + 对谁、何时浮现），通过**四个面**暴露出来：CLI（给人和脚本）、MCP（给运行时的 Agent）、Hooks（在关键时机提醒）、Skills（让 AI 做判断）。

### 底座：可挂载的多 store + 三轴 scope

这是相对早期版本最大的一次演进。知识不再放在固定的 `.fabric/` + `~/.fabric/` 双根里，而是放在 **store** 里：

- 每个 store 在自己的 git 树根持有一个内生、不可变的 UUID，所以换远程地址、换别名身份都不变。store 被**挂载**进 `~/.fabric/fabric-global.json`，再由具体仓库用 `fabric store bind` **按 repo 绑定**。没绑定就不会被读到。
- 因为 store 可以关联 git remote（`fabric store create/bind --remote`），再用 `fabric sync` 做 rebase + push，**一个团队 store 天然就能跨多个 repo 共享**——这正是早期设想里的 “team-knowledge.git”，已经落地。
- 项目本地的 `.fabric/knowledge/` 不再是运行时知识源，它只是一次性导入的输入。运行时真正读写的是挂载的 store。

一条知识会不会浮现给 AI，由**三个互相正交的轴**决定：

| 轴 | 取值 | 决定 |
|---|---|---|
| `semantic_scope`（受众） | `team` / `project:<id>` / `personal` | 谁能看到（个人知识必须待在 personal store——schema 强制的隐私红线） |
| `relevance_scope`（时机） | `broad` / `narrow` | 常驻 vs 仅在你编辑匹配路径时浮现（由 `relevance_paths` 推导） |
| `store`（物理库） | 某个挂载的 store | 到底读不读得到 |

当某条知识没出现时，`fabric audit why-not-surfaced <id>` 会逐轴诊断是哪一轴挡住了。

### CLI —— 确定性，无 LLM 介入

```bash
fabric install                 # 扫描项目，安装 hooks/skills/客户端配置
fabric store bind <id>         # 声明本 repo 要用哪个知识 store
fabric store switch-write <a>  # 设置默认写入目标（按 scope）
fabric sync                    # git 同步挂载的 store（pull --rebase + push）
fabric doctor [--fix]          # 健康检查（+ 确定性修复）
fabric audit cite|conflicts|retired|why-not-surfaced|metrics
fabric info [--global|--recall]  # 身份 / 项目 / 召回引擎状态
fabric inspect                 # 显示本次 SessionStart 实际注入了什么
fabric uninstall               # 对称卸载（不动挂载的 store）
```

`store` / `sync` 是随多 store 架构新增的；旧的 `serve` 已隔离到实验包；`whoami` / `status` / `scope-explain` 并进了 `info`；审计相关 flag 从 `doctor` 拆成了 `audit`。

### MCP —— Agent 的运行时协议（5 个工具）

```text
fab_recall         # AI 直接调用：改文件前先召回相关知识
fab_propose        # 提议一条 pending 知识
fab_archive_scan   # 扫描会话历史，找可归档候选
fab_pending        # 只读浏览 / 搜索 pending + canonical
fab_review         # 写：approve / reject / modify / defer
```

**Lean recall（精简召回）。** `fab_recall(paths)` 一次调用返回候选的*描述 + 磁盘读取路径*，不通过 MCP 灌正文。需要正文时，Agent 自己对路径做一次原生 `Read`。eager 灌正文是一笔恒久的上下文税；真要看正文，一次 `Read` 很便宜。这和 Claude Code 自己的 Memory（`MEMORY.md` 索引 + 按需读取记忆文件）是同一个形状——代码里直接把它的返回结构注释为 “Memory-style shape”。

**混合检索（hybrid retrieval）。** 排序融合两路信号：BM25 词法（带中文分词）+ 一路可选的向量语义（CPU 上的小型 embedding 模型算余弦，中文默认 `fast-bge-small-zh`）。向量**默认开启，但优雅降级**——`fastembed` 是*可选*依赖，构建不了、被关掉、或运行出错时，召回会退回纯 BM25 + 时近 + 路径相关 + 重要度，行为不变。

### Hooks —— 在关键时机提醒（Claude Code + Codex CLI）

- `knowledge-hint-broad.cjs` —— SessionStart：列出 broad 知识 + scope 普查。
- `knowledge-pretooluse.cjs` —— PreToolUse（Edit/Write/MultiEdit）：路径相关的 narrow 提示 + 编辑计数侧记。
- `cite-policy-evict.cjs` —— PreToolUse：改文件前没相关 recall 就给一条软提醒。
- `post-tooluse-mutation.cjs` —— PostToolUse：记录 `file_mutated` 和 `knowledge_body_read`（闭合“浮现 → 引用 → 编辑”漏斗）。
- `fabric-hint.cjs` —— Stop：提醒归档 / 审核 / 冷启动回灌。
- `session-end-marker.cjs` —— SessionEnd：写一条会话结束标记。

hook 只负责提醒和记账——它从不阻塞，判断交给刚经历过上下文的 AI。

### Skills —— 让 AI 做判断（4 个）

- `fabric-archive` —— 从会话里提取值得保留的知识，经 `fab_propose` 写入 `pending`。它的 *source mode* 能从 `git log` + docs 冷启动老项目（吸收了原来的 `fabric-import`）。
- `fabric-review` —— 经 `fab_review` 审核 pending/canonical（approve/reject/modify/defer），外加 `retire`（语义淘汰陈旧/孤儿条目，守“先降级、先抢救，不硬删”）和 `relate`（按需补 `related` 边）。
- `fabric-store` / `fabric-sync` —— 两个薄路由层，把自然语言意图路由到 `fabric store` / `fabric sync` CLI；干活和把守安全门的是 CLI。

知识文件始终是带 frontmatter（`semantic_scope`、`relevance`、`maturity`）的纯 Markdown，存在各个 store 下——可用 Git 管理、可 diff，绝不锁进黑盒数据库。

## 设计原则

下面几条原则解释了大半“Fabric 为什么不做某件事”：

- **store-only** —— 知识只存在于挂载的 store，没有项目内运行时回退，真源唯一。
- **body-on-demand** —— 召回只给描述 + 路径，正文按需读（lean recall）。
- **never-block** —— 所有 Fabric 动作都是建议性的；是 nudge，不是 gate。
- **minimal-install** —— 不背必装重型基础设施（无向量库、无 SQLite、无图库；向量相似度是进程内余弦 + LRU 缓存）。唯一的 embedder（`fastembed`）是*可选*依赖，带完整文本降级。
- **dual-sink injection** —— 知识经 SessionStart + PreToolUse 注入，给 AI 和给人是两条独立通道。
- **clean-slate** —— 不背 legacy（实验性 HTTP server 已隔离到独立包）。
- **honesty iron law** —— 宁可少报不虚报；不自动建边、不自动升级 maturity、不用 usage 排序。
- **agent-native** —— 为 Agent 设计，不是给人看的 Web UI。

## 快速开始

```bash
# 在你的项目仓库里：
pnpm dlx @fenglimg/fabric-cli install
```

```bash
npm install -g @fenglimg/fabric-cli        # 正式版
npm install -g @fenglimg/fabric-cli@next   # 体验版

fabric install                 # hooks + Skills + bootstrap + MCP 客户端配置
fabric store bind <id>         # 绑定本 repo 要用的知识 store
fabric doctor                  # 健康检查（--fix 修可自动修复项）
fabric uninstall               # 移除受管产物（不动挂载的 store）
```

MCP server **只走 stdio** —— `fabric install` 会写好每个客户端的 MCP 配置，客户端在会话开始时自行拉起 server，**不需要单独跑 `fabric serve`**。**`fabric install` 后请重启客户端**：正在运行的会话要重启才会读到新的 MCP 配置；新会话会自动加载。

受支持的客户端：

- **Claude Code** —— 受管 bootstrap + SessionStart/PreToolUse/PostToolUse/Stop/SessionEnd hooks + Skill 模板 + MCP stdio
- **Codex CLI** —— 受管 `AGENTS.md` bootstrap + 同样的 hooks + Skill 模板 + MCP stdio

## Fabric 刻意不做什么

- **不是 5 层存储分类法。** system/project/module/file/function 的深度模型被否决了。Fabric 按三个正交轴（受众 / 时机 / store）划分知识，而不是按嵌套深度。
- **不是 16 阶段工作流注入。** Fabric 是 harness-agnostic 的，它绑定到每个 harness 都已经发出的事件（`SessionStart` / `Stop` / `PreToolUse` / `PostToolUse`），让 harness 保留自己的工作流模型。
- **暂时不是带权限的团队平台。** 跨 repo 的 git store 共享已经能用；角色模型（admin / contributor / reader）和更深的组织级 federation 刻意留到后面。
- **不是重型检索栈。** 没有向量数据库、没有常驻 embedding 基础设施；向量这一路是可选的，能降级到词法检索。

## 与腾讯 AI 团队那篇文章的定位

同源，但架构原创。

| 维度 | 腾讯文章 | Fabric |
|---|---|---|
| 与 harness 耦合 | 16 阶段工作流注入 | 经 hooks + MCP，harness-agnostic |
| 存储 | 5 层深度分类 | 可挂载多 store + 三轴 scope |
| 入口 | 工作流阶段注入上下文 | MCP-first、hook 提醒、Skill 写入 |
| 检索 | —— | BM25 + 可选向量（默认开、可降级） |
| 团队共享 | 隐式按环境 | 今天就有 git-backed 共享 store；角色模型后续 |

## 它是怎么运转的（生命周期）

```text
fabric install + store bind
  ↓
AI 正常开发
  ↓
SessionStart / PreToolUse hook 浮现知识
  ↓
Agent 调 fab_recall → 描述 + 读取路径；按需 Read 正文
  ↓
Stop hook 检测 archive / review 信号
  ↓
fabric-archive → fab_propose 写入当前 store 的 pending/
  ↓
fabric-review → approve 分配稳定 ID，晋升为正式知识
  ↓
fabric doctor / fabric audit 持续保持健康
  ↓
下次任务自动复用
```

`fabric doctor` 一趟跑完知识健康 lint（孤儿降级、陈旧归档、超期 pending、stable-id 重复、layer/scope 不一致、index 漂移、relevance 绑定、节点过少）。maturity 的升级与降级都是 **detection-only**——只提候选；真正改动走 `fabric-review`（人在回路）。默认只报告、不改。

## 文档

- [快速开始](./docs/USER-QUICKSTART.md) —— 5 分钟上手。
- [架构](./docs/ARCHITECTURE.md) —— 包 / 入口 / 安装流水线全景。
- [运行时契约](./docs/RUNTIME-CONTRACTS.md) —— CLI、MCP、schema、配置入口。
- [测试](./docs/TESTING.md) —— 测试策略、漂移闸、test seed 角色。
- [升级](./docs/UPGRADE.md) —— 受支持的升级说明。
- [Changelog](./CHANGELOG.md) —— 版本历史。

## 项目结构

一个 pnpm monorepo：

- `packages/cli` —— `fabric` CLI（`install`、`store`、`sync`、`info`、`doctor`、`audit`、`config`、`inspect`、`uninstall`）。
- `packages/server` —— MCP server `fabric-knowledge-server`（5 个工具，stdio）+ 生命周期服务（recall、review、doctor、lint、事件账本、metrics）。
- `packages/shared` —— CLI 与 server 共享的 schema（事件账本、api 契约、知识 frontmatter、store + scope）。
- `packages/server-http-experimental` —— v1.8 时代的 HTTP/REST/SSE + Dashboard 包，已于 v2.0.0-rc.37 隔离。不构建 / 不测试。
- `packages/cli/templates/skills/` —— `fabric install` 时分发的 Skill 模板（`fabric-archive`、`fabric-review`、`fabric-store`、`fabric-sync`）。
- `packages/cli/templates/hooks/` —— 共享 hook 脚本 + 各客户端配置（`claude-code.json`、`codex-hooks.json`）。

贡献者：clone、`pnpm install`、`pnpm -r build`、`pnpm -r test`。

## 状态

**v2.3.0-rc.3** —— 活跃开发线。升级说明见 [docs/UPGRADE.md](./docs/UPGRADE.md)，版本历史见 [CHANGELOG.md](./CHANGELOG.md)。

仓库：https://github.com/fenglimg/fabric

## 致谢

Fabric 早期设计借鉴了 Agent 规则文件的跨客户端 `AGENTS.md` 框架。知识 sustainment 方向受到 Anthropic、Letta、腾讯 AI 团队等社区方法论文章的启发——感谢这些团队把生命周期问题讲清楚。Fabric 的具体形态（5 个 MCP 工具、5 类知识、三档成熟度、可挂载多 store + 三轴 scope、lean recall、混合检索、hook 提醒层、lint 驱动衰减）是本项目原创。
