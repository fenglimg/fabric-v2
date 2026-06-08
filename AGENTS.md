# Project Knowledge

This project uses [Fabric](https://github.com/fenglimg/fabric) for cross-client AI knowledge management.

Knowledge entries live only in mounted stores under `~/.fabric/stores/`. Use `fabric store bind` and `fabric store switch-write` to select the project read/write stores.
Run `fabric doctor` to verify state.

Use `fabric-archive` and `fabric-review` to create and review decisions, pitfalls, guidelines, models, and processes in the active store.

<!-- fabric:bootstrap:begin -->
# Fabric Bootstrap

本项目使用 Fabric 管理跨客户端 AI 知识与行为规则。本文件由 `fabric install` 同步到三端 managed block；不要手动编辑客户端生成 block，只改 canonical bootstrap 后重跑 `fabric install`。

## For Developers

这个文件是 AI 客户端策略与规约配置。作为 dev，你只需要：在每个 repo 跑一次 `fabric install`；用 `fabric store bind <alias>` 和 `fabric store switch-write <alias>` 接入 store；出问题跑 `fabric doctor`。

知识只允许写入 mounted stores（默认位于 `~/.fabric/stores/`）下的 `knowledge/` tree。不要手写任何非 store knowledge root，也不要手动编辑 `.fabric/agents.meta.json`。

## 知识库(KB)

- **Discovery**：SessionStart hook 列 broad-scoped 条目；edit 文件时 PreToolUse hook 可能触发 narrow hint。
- **Usage**：修改任何文件前优先调用 `fab_recall(paths=[<被改文件>])`。仅当正文过多需要裁剪时才走 `fab_plan_context` → `fab_get_knowledge_sections`。
- **Write path**：AI 提议条目进入当前 write store 的 `knowledge/pending/`；用 `fabric-review` 审核；用 `fabric-store` / `fabric-sync` / `fabric-connect` 运维 store。
- **Review backlog nudge**：当前 read/write store 的 `knowledge/pending/` 累积 >10 条时，主动建议调用 `fabric-review` 批量审。
- **Archive cadence nudge**：完成一批 Edit 或显著 decision 后，主动建议调用 `fabric-archive`。

## Self-Archive

当用户明确表达“以后 / always / never / 下次注意 / 记一下”等规范性意图，或出现明显 wrong-turn-and-revert 时，调用 `fabric-archive` 把候选写入当前 write store 的 `knowledge/pending/`。同 turn 最多自调 1 次；若用户说撤销，则用 `fab_review reject`。

## Cite Policy

引用任何 KB id 前必须先通过 `fab_recall` 或 `fab_plan_context` → `fab_get_knowledge_sections` 实际读取正文。多 store read-set 中如 id 有 shadow，引用使用 store-qualified 形式：`<store-alias>:<id>`。无相关 KB 时可用 `KB: none [no-relevant]` 或 `KB: none [not-applicable]`。
<!-- fabric:bootstrap:end -->
