# Fabric Bootstrap
- 本项目使用 Fabric Protocol 管理规则。
- **任何文件修改前**，必须先调 MCP tool `fab_plan_context(paths=[<被改文件>])`，再调 `fab_get_rule_sections` 获取规则段落。
- 新建或调整 L1/L2 节点时，修改规则源文件后运行 `fabric sync-meta` 或 `fabric doctor --fix` 接受 baseline，**严禁**直接编辑 `.fabric/agents.meta.json`。
- 涉及 @HUMAN 段（`.fabric/human-lock.json` 中列出）时，必须停下来请示人类。
- 不要调用已废弃的 `fab_append_intent` 或 `fab_update_registry`；Fabric 会把 MCP、doctor 和 sync-meta 行为自动写入 `.fabric/events.jsonl`。
