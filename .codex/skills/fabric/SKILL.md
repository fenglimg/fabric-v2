---
name: fabric
description: Fabric 入口层路由 — 参考 maestro 的顺序协调方式，把用户意图分派到 fabric-archive/review/import/store/sync/audit/connect。Triggers fabric/知识库/归档/审批/store/同步/关联/审计.
---

# fabric — Fabric Skill Router

这是 Fabric 相关 skills 的入口层。它只负责理解用户意图、选择正确的下游 skill、按顺序直接调用；不直接读写 `~/.fabric` store，不自行解析 store 树，也不替代底层 `fabric-*` skills 的安全门。

## Routing Contract

1. 先判断用户要做的是哪类 Fabric 工作。
2. 只调用一个最合适的下游 skill；只有用户明确要求一组维护动作时，才按顺序调用多个。
3. 每一步完成后读取结果，再决定是否继续下一步。不要并发委派，也不要用 CSV/wave worker。
4. 如果目标涉及写入、审批、退役或关联，必须走对应下游 skill 的既有写路径；本入口 skill 不直接修改 `knowledge/`。
5. Store 状态只通过 `fabric info`、`fabric store ...`、`fabric sync`、MCP 工具或下游 skill 获取。MUST NOT 直接遍历或执行 `~/.fabric/stores/` 内容；store 是 data-only。

## Intent Map

<!-- fabric:router-intent:begin -->
<!-- 本块由 `fabric install` 从 7 个 leaf skill 的 description Triggers 子句生成。严禁手编;改 leaf description 后重跑 `fabric install`。 -->

| 用户意图(leaf description Triggers) | 下游 skill |
| --- | --- |
|  | `fabric-archive` |
|  | `fabric-review` |
|  | `fabric-import` |
|  | `fabric-sync` |
|  | `fabric-store` |
|  | `fabric-audit` |
|  | `fabric-connect` |

`S_CLASSIFY` 的 `task_type` 枚举:`archive | review | import | sync | store | audit | connect`
<!-- fabric:router-intent:end -->

## State Machine

### S_CLASSIFY

提取：

```json
{
  "task_type": "<Intent Map task_type 枚举之一>",
  "scope": "project|store|entry|paths|null",
  "write_intent": true,
  "confidence": "high|medium|low"
}
```

低置信度时问 1 个短问题；不要一次性列长菜单。若用户只是说“fabric 帮我处理一下”，默认先运行 `fabric-audit` 做只读体检，再根据输出建议下一步。

### S_EXECUTE

按 `Intent Map` 直接调用下游 skill，例如：

- `fabric-archive "{用户原始意图}"`
- `fabric-review "{用户原始意图}"`
- `fabric-import "{用户原始意图}"`
- `fabric-store "{用户原始意图}"`
- `fabric-sync "{用户原始意图}"`
- `fabric-audit "{用户原始意图}"`
- `fabric-connect "{用户原始意图}"`

执行前加载下游 skill 的 `SKILL.md`，只读取完成当前任务所需的 `ref/` 文件。下游 skill 有更具体约束时，以下游约束为准。

### S_CHAIN

只有这些组合可以自动串联：

| 组合意图 | 顺序 |
| --- | --- |
| “同步后审 pending” | `fabric-sync` -> `fabric-review` |
| “审计并处理陈旧知识” | `fabric-audit` -> `fabric-review` |
| “导入历史并审批” | `fabric-import` -> `fabric-review` |
| “建立 store 后导入” | `fabric-store` -> `fabric-import` |
| “找关联并落盘” | `fabric-connect` -> `fabric-review` |

每个步骤结束后读结果。若前一步失败或给出需要用户决策的冲突，停止并报告；不要猜测继续。

## Guardrails

- 写入 pending 只走 active write store，并在回复里说明写入目标。
- 引用 KB id 前必须实际读取正文；多 store read-set 中使用 `<store-alias>:<id>`。
- pending backlog 超过 10 条时，优先建议 `fabric-review`。
- 完成一批 Edit 或显著 decision 后，建议 `fabric-archive`。
- 不要推荐 `fabric doctor --fix` 作为 pending 审批路径；审批走 `fabric-review`。
- 不要把知识写到项目本地 `.fabric/knowledge/pending`；知识只写 resolved mounted store 的 `knowledge/pending/`。
- MUST preserve protected tokens exactly: `MUST`, `NEVER`。

## Report

回复格式保持短：

```text
Fabric route: <downstream-skill>
Reason: <why this skill>
Result: <one-line result or blocker>
Next: <optional next skill/action>
```
