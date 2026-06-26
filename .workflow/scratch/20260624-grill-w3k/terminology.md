# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| MCP 工具(tool) | AI agent 通过 MCP 协议调用的命名能力端点;Fabric 注册 4 个 | `packages/server/src/index.ts:239` | locked |
| `fab_review` | 审核/修改 pending 知识的写工具(action 判别 8 值) | `packages/server/src/tools/review.ts:24` | locked |
| `fab_pending` | (新)拟从 fab_review 抽出的只读工具,承接 list/search | proposed — K2,尚未存在 | open |
| `fab_recall` | AI 直调的一次性只读召回工具 | `packages/server/src/tools/recall.ts:26` | locked |
| `fab_archive_scan` | 确定性只读事件账本扫描(找归档候选) | `packages/server/src/tools/archive-scan.ts:21` | locked |
| `fab_propose` | 写入 pending 知识条目的工具 | `packages/server/src/tools/extract-knowledge.ts:25` | locked |
| action 判别(discriminator) | fab_review 用 `action` 字段路由 8 个子操作 | `api-contracts.ts:1022` | locked |
| readOnlyHint | MCP annotation,声明工具只读不改(可被 host 放心调) | recall/archive-scan annotations | locked |
| double-payload | 工具同时发 structuredContent + content[].text(后者为前者完整 JSON 抄本)致体积翻倍 | recall.ts:88 等 4 处 JSON.stringify | locked |
| structuredContent | MCP 返回的结构化数据载荷(AI 真正消费的那份) | recall.ts:97 | locked |
| layer-flip | 把知识条目 semantic layer 在 team↔personal 间切换(会重分配 stable_id) | review.ts:915 `changes.layer` 路由 | locked |
| `modify-content` / `modify-layer` | rc.37 显式拆分:前者只改字段绝不翻 layer,后者必翻 | `api-contracts.ts:982,988` | locked |
| action_hint | 警告/错误回执里"该怎么改"的可纠错指引 | `payload-warning.ts`(warnings[]) | locked |
| `dropped[]{id,reason}` | 结构化的"被丢弃项 + 原因枚举"形态(archive_scan 已有,拟推广) | `archiveScanOutputSchema` (api-contracts.ts) | locked |
| SCOPE_COORDINATE_PATTERN | audience/scope 字段的正则(小写+冒号,如 `project:fabric-v2`) | `api-contracts.ts:701` | locked |
| migrate-before-delete | 改/删工具名前先迁所有调用点(skill/policy/ref/fixture)再删旧名 | shared-policy.md(protected token) | locked |
