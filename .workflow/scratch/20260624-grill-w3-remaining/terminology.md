# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| **real leaf skill** | 有独立 LLM 推理工作流 + 完整 gate 机器(i18n/precondition/触发词)的 skill。W3-C 后只有 archive/review 两个。 | `packages/cli/templates/skills/fabric-archive`、`fabric-review` | locked |
| **thin shim (薄 skill)** | skill 层仅做"意图路由→调哪条 CLI",不背 i18n/precondition/触发词重资产;确定性/安全由 CLI 自身的 confirm 门提供。W3-C 后 store/sync 属此。 | `packages/cli/templates/skills/fabric-store`、`fabric-sync`(目标态) | locked |
| **migrate-before-delete** | 删/改名命令前先迁调用点→验证 JSON 形状/行为一致→再删旧名→登记 retired-registry;由 CI lint 结构性保证不裸删活契约。 | W2-2 `retired-reference` lint;`index.test.ts:72` 手写先例 | locked |
| **retired-registry** | 已退役标识符(MCP 工具名/config 字段/命令/skill)的单一登记处,驱动 retired-reference lint 全仓扫描。退役一物 = 加一项。 | W2-2(shared 内登记表);doctor lint | locked |
| **progressive disclosure (渐进披露)** | HUD 开局只给截断索引 + 分组计数(`decision 25 · pitfall 8`),正文等命中编辑路径(narrow)或 fab_recall 再展开。"分层按需"非"分时"。 | `knowledge-hint-broad.cjs`;NS-05 样例 A;KT-GLD-0005 | locked |
| **PreToolUse orchestrator** | 单一 PreToolUse hook 同进程合并 narrow + cite 为单 envelope,使 5 生命周期事件一一映射。W2-6 已落,是 W3-I"6→5"已完成的实证。 | `packages/cli/templates/hooks/knowledge-pretooluse.cjs` | locked |
| **why-not-surfaced** | doctor 诊断命令,对单条知识逐因回答为何(没)浮现:store 绑没绑 / semantic_scope 匹不匹配 / 当前 broad vs narrow 时机。W3-H 本轮唯一交付。 | new(NS-06 §1.1 / §1.3) | open |
| **byte-identical 严验** | W3-G bundle 出的 cjs 必须与现手写渲染输出逐字节一致 + 运行时零外部 TS 依赖;由 round-trip oracle 测试守。 | W3-G;`fabric context` ↔ hook 渲染 | open |
