# Fabric Bootstrap

本项目使用 Fabric 管理跨客户端 AI 知识与行为规则。本文件由 `fab install` 同步到三端 managed block,**不要手动编辑三端的 block**,只改这里 + 重跑 `fab install`。

## 行为规则
- **修改任何文件前**:两步调用——先 `fab_plan_context(paths=[<被改文件>])` 拿到 `selection_token` 与候选 `entries`(挑 `selectable===true` 的 `stable_id`),再 `fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>...] })` 取规则正文。
- **`.fabric/agents.meta.json` 严禁手动编辑**;engine 会自动同步派生状态,显式 reconcile 跑 `fab doctor --fix`。

## 知识库(KB)
- **Discovery**:SessionStart hook 列 broad-scoped 条目;edit 文件时 PreToolUse hook 可能触发 narrow hint。
- **Usage**:两步式——`fab_plan_context(paths=[...])` 返回 `selection_token` + 候选 entries,再 `fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>...] })` 拉全文;`selection_token` 必须来自最近一次 `fab_plan_context`,不可凭空编造。
- **Write flows**:`fabric-archive` / `fabric-review` / `fabric-import` 三个 Skills。
- **Language**:渲染按 `.fabric/fabric-config.json` 的 `fabric_language` 字段。

## Cite policy

- **触发**: 做 edit / decide / propose plan 之前,**回复首行**必须写 `KB: <id> (<≤8字 用法>) [planned|recalled|chained-from <id>|dismissed:<reason>]` 或 `KB: none [<reason>]`。
- **`[recalled]` 验证**: 必须紧跟两步调用——先 `fab_plan_context(paths=[...])` 拿 `selection_token`,再 `fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>] })`,防止编造 id。
- **用户口头提规则没给 id**: 先调 `fab_extract_knowledge` 或 `search_context` 反查。
- **dismissed reason**: 枚举 `scope-mismatch | outdated | not-applicable | other:<text>`。
- **`KB: none` sentinel**: 枚举两种合规理由——`[no-relevant]` 已调 `fab_plan_context`(或 hook 输出可见)但无可用条目;`[not-applicable]` 当前动作不在 cite 范围(纯探索 / Bash 只读 / 用户问答)。裸 `KB: none`(无后缀)仍然 valid,归类为 `[unspecified]`(legacy 兼容,鼓励后续补注)。
- **稽核**: `fab doctor --cite-coverage [--since=7d] [--client=cc|codex|all]` 输出 cite 覆盖率,含 `KB: none` sentinel 拆分。本规则不阻断你工作,只记录。
