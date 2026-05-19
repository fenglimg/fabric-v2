# Fabric Bootstrap

本项目使用 Fabric 管理跨客户端 AI 知识与行为规则。本文件由 `fab install` 同步到三端 managed block,**不要手动编辑三端的 block**,只改这里 + 重跑 `fab install`。

## 行为规则
- **修改任何文件前**:两步调用——先 `fab_plan_context(paths=[<被改文件>])` 拿到 `selection_token` 与候选 `entries`(挑 `selectable===true` 的 `stable_id`),再 `fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>...] })` 取规则正文。
- **`.fabric/agents.meta.json` 严禁手动编辑**;engine 会自动同步派生状态,显式 reconcile 跑 `fab doctor --fix`。

## 知识库(KB)
- **Discovery**:SessionStart hook 列 broad-scoped 条目;edit 文件时 PreToolUse hook 可能触发 narrow hint。
- **Usage**:两步式——`fab_plan_context(paths=[...])` 返回 `selection_token` + 候选 entries,再 `fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>...] })` 拉全文;`selection_token` 必须来自最近一次 `fab_plan_context`,不可凭空编造。
- **session_id**: 调用 `fab_plan_context` 时, 务必把当前 client session id 作为 `session_id` 参数传入(Claude Code 的 session id 在 stdin payload 中, Codex 的对应 identifier 同理)。这能让 `fab doctor --archive-history` 与 archive-hint hook 准确识别跨会话 debt 状态。
- **Write flows**:`fabric-archive` / `fabric-review` / `fabric-import` 三个 Skills。
- **Language**:渲染按 `.fabric/fabric-config.json` 的 `fabric_language` 字段。

## Self-archive policy

- **触发**: 本会话出现以下任一信号, 在该 turn 回复末尾自主调用 `fabric-archive` skill (E3-strong mode):
  1. **Normative 语言** — 用户消息出现 `以后` / `always` / `never` / `from now on` / `下次注意` / `记一下` / `永远不要`
  2. **Wrong-turn-and-revert** — AI 尝试 path X, 反思后改走 path Y (尤其当 path X 是非显然踩坑)
  3. **Decision confirmation** — 用户在 ≥2 候选中权衡后给出 rationale 锁定方向
  4. **Explicit dismissal with reason** — 用户拒了某建议**并**说了原因

- **Anti-trigger** (明确不触发):
  - 用户纯询问 (无 normative 表达)
  - 简单 refactor / typo fix
  - AI 自己产生的'洞察' (必须由用户消息中信号触发)

- **Anti-loop 三条防护**:
  - 同 turn 最多自调 1 次
  - 同 session 同 outcome 不重复 (若 user_dismissed, 本会话不再自调相同主题)
  - Phase 0.5 viability gate 兜底 (skill 内部仍跑 gate, AI 判错不会乱写 pending)

- **呈现模板** (turn 末尾插入, 两行: 先 marker 行供 Phase 0.4 检测, 再 user-facing 提示):
  ```
  self-archive policy triggered by signal: <Normative|Wrong-turn-and-revert|Decision confirmation|Explicit dismissal>
  顺手归档: 注意到你说 `<触发短语>`, 已调用 fabric-archive 抓 N 条候选 → .fabric/knowledge/pending/...
  若不该记, 答 '撤销' 我会调 fab_review reject。
  ```
  第一行是 Phase 0.4 Trigger Gate 用来识别 E3 入口的 structured marker (verbatim 字符串 `self-archive policy triggered by signal`, 后接冒号 + 触发信号名)。第二行起是给用户看的中文提示。两行都必须出现; 缺 marker 行 Phase 0.4 无法路由到 E3_ai_self_trigger。

## Cite policy

- **触发**: 做 edit / decide / propose plan 之前,**回复首行**必须写 `KB: <id> (<≤8字 用法>) [planned|recalled|chained-from <id>|dismissed:<reason>]` 或 `KB: none [<reason>]`。
- **`[recalled]` 验证**: 必须紧跟两步调用——先 `fab_plan_context(paths=[...])` 拿 `selection_token`,再 `fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>] })`,防止编造 id。
- **用户口头提规则没给 id**: 先调 `fab_extract_knowledge` 或 `search_context` 反查。
- **dismissed reason**: 枚举 `scope-mismatch | outdated | not-applicable | other:<text>`。
- **`KB: none` sentinel**: 枚举两种合规理由——`[no-relevant]` 已调 `fab_plan_context`(或 hook 输出可见)但无可用条目;`[not-applicable]` 当前动作不在 cite 范围(纯探索 / Bash 只读 / 用户问答)。裸 `KB: none`(无后缀)仍然 valid,归类为 `[unspecified]`(legacy 兼容,鼓励后续补注)。
- **稽核**: `fab doctor --cite-coverage [--since=7d] [--client=cc|codex|all]` 输出 cite 覆盖率,含 `KB: none` sentinel 拆分。本规则不阻断你工作,只记录。
