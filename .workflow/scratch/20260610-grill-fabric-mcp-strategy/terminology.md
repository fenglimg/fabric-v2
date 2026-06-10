# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| 一次调用 (one-call) | fab_recall 单次返回候选+全文 body 的模式 | `services/recall.ts:86-202` | locked |
| 两步法 (two-step) | plan_context(菜单)→get_sections(取body),AI 中间挑 id | `tools/plan-context.ts` + `tools/knowledge-sections.ts` | locked |
| relevance 阈值门 | 按排序分数只对 top-N 返全文、其余返描述的截断策略 | 当前不存在 (proposed) | open |
| body-tier (分层灌正文) | 全候选返描述 + 仅高分候选返 body 的混合策略 | proposed | open |
| top_k | plan_context 返回候选数上限,balanced=24 | `shared/src/retrieval-budget.ts:43` | locked |
| payload hard ceiling | MCP 返回体硬上限,超限抛 413,balanced=64KB | `shared/src/node/mcp-payload-guard.ts:25` | locked |
| no-server-filter | 设计哲学:服务端不预测 LLM 选谁,返全候选让 LLM 决策 | `tools/recall.ts:32` (注释) | locked |
