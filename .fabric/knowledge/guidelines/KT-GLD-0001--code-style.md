---
id: KT-GLD-0001
type: guideline
layer: team
semantic_scope: team
visibility_store: "team"
maturity: verified
layer_reason: "project artifact (deterministic init scan)"
created_at: 2026-05-10T05:24:25.169Z
tags: []
---

# Code style guidelines

## [MISSION_STATEMENT]

固化 fabric-monorepo 中反复出现的写码约定。

## [MANDATORY_INJECTION]

在本仓库内生成或修改源码文件时，AI agent 必须：
- 把 scripts 目录视为 initialization 阶段的主执行边界。
- 未经用户明确确认，不要修改或删除 .meta sidecar 文件。
- 在生成新规则或新项目结构之前，先读 bootstrap 与 compiler config。

## [CONTEXT_INFO]

观察到的模式：
- 抽样到的 entry 文件看起来是通用的源码 entry。
- Entry 样本集中在 scripts 目录，说明这里是稳定的主源码边界。
