# Fabric Bootstrap
- 主说明文档已收敛到 `.fabric/bootstrap/README.md`。
- 项目级 bootstrap 入口仍然是 `AGENTS.md`。
- 修改任何文件前必须调用 `fab_plan_context(paths=[<被改文件>])`，再调用 `fab_get_knowledge_sections` 获取规则段落。
MCP 和 doctor 会写入 `.fabric/events.jsonl`。
- 规则 baseline 变更通过 `fabric doctor --fix` 接受。

@AGENTS.md
