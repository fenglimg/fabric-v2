# Fabric 中文命名基线

本文用于统一 Fabric 在中文语境里的产品命名、界面文案和用户文档表达。

目标只有两个：

- 用户看到主界面和上手文档时可以直接读懂，不需要先翻译一遍。
- CLI、Dashboard、文档使用同一套中文口径，不再一处一个说法。

## 三层命名

### 1. 用户词

用于界面标题、按钮、状态、空态、上手文档主叙事。

要求：

- 先说功能和动作，再说内部机制。
- 优先用自然中文，不把英文概念直接贴到主界面上。
- 同一概念只保留一个主叫法。

示例：

- `Rule Topology` -> `规则命中`
- `Rules Tree` -> `规则树`
- `History Replay` -> `历史回放`
- `Human Lock` -> `人工保护`
- `follow-up` / `handoff` -> `后续初始化`

### 2. 技术词

用于 API、调试面板、深入文档、测试描述。

要求：

- 可以保留英文原词，但要放在解释层，不要抢占主标题。
- 仅在必须区分协议名、字段名、文件名时保留英文。

示例：

- `scope_glob`
- `activation.tier`
- `ledger`
- `revision`
- `description stub`

### 3. 内部词

仅用于代码、日志、实现注释、内部讨论，不直接面向普通用户。

这类词包括但不限于：

- `canonical`
- `semantic initialization`
- `evidence pack`
- `ritual writes`
- `cognitive forensic`

如果必须对外出现，必须先翻成用户词，再在下一层解释技术含义。

## 文案规则

- 页面标题只说用户要完成什么，不说模块编号。
- 副标题只补充用途，不堆字段名和内部模型。
- 状态行先给可读信息，再给技术元数据。
- 文档主叙事先讲“现在要做什么”，再讲“内部如何实现”。
- 一段中文里尽量只保留一类英文：命令、路径、协议字段三者之外的英文尽量收掉。

## 推荐译名

| 当前常见说法 | 推荐说法 | 备注 |
| --- | --- | --- |
| `canonical --plan` | `标准 --plan 模式` | CLI 提示用语 |
| `重塑初始化计划` | `调整初始化计划` | 避免翻译腔 |
| `Rule Topology` | `规则命中` 或 `规则拓扑` | 用户界面优先前者，深入文档可用后者 |
| `Coverage Heatmap` | `覆盖热力图` | 可保留 |
| `Hit Reason Panel` | `命中原因` | 不必保留 `Panel` |
| `Rules Tree Browser` | `规则树` | 界面标题不必加 `Browser` |
| `Human Lock Vault` | `人工保护` | 避免“仓库”“金库”这类误导词 |
| `ritual writes only` | `变更前需人工确认` | 用动作要求替代黑话 |
| `History Replay` | `历史回放` | 可保留 |
| `ledger {id} · commit {sha}` | `记录 {id} · 提交 {sha}` | 技术详情保留在次级信息 |
| `rev {revision}` | `版本 {revision}` | 避免把缩写当主文案 |
| `semantic initialization` | `后续初始化` | 技术说明里再解释 |
| `evidence pack` | `初始化依据` | 文档表达优先 |
| `client-side review` | `在客户端继续确认` | 先说动作 |

## 禁用倾向

以下表达默认不要直接出现在中文主界面和用户向文档里：

- `模块 A / 模块 B / 模块 C / 模块 D`
- `认知取证`
- `历史账本`
- `仪式化写入`
- `Canonical init 心智模型`
- `semantic initialization`
- `evidence pack`

## 落地顺序

1. 先改共享 i18n 和界面主文案。
2. 再改用户向文档。
3. 最后扫描遗留术语，确保同一概念没有并存说法。
