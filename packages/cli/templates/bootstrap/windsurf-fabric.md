# Fabric Bootstrap
- 本项目使用 Fabric Protocol 管理规则。
- **任何文件修改前**，必须调 MCP tool `fab_get_rules(path=<被改文件>)` 获取规则。
- 新建 L1/L2 节点时，必须调 `fab_update_registry`，**严禁**直接编辑 `.fabric/agents.meta.json`。
- 涉及 @HUMAN 段（`.fabric/human-lock.json` 中列出）时，必须停下来请示人类。
- 每次完整任务结束，调 `fab_append_intent` 写一条意图记录。
