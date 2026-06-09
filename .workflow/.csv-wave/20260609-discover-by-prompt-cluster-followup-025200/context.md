# Issue Discovery Report

## Summary
- Session: DBP-20260609-025200
- Mode: by-prompt cluster follow-up
- Parent session: DBP-20260609-023700
- Raw findings: 11
- Unique issues appended: 11
- Severity: critical=0, high=2, medium=8, low=1

## Breakdown by Perspective
| Perspective | Findings | Severity Distribution |
|---|---|---|
| mcp-store-contract-runtime | 发现 2 个新 distinct issue：global_ref 的 UUID schema 与 alias-based runtime/test 冲突；fab_archive_scan 被合同误归类为会写 store 的工具。 | {"critical":0,"high":0,"medium":2,"low":0} |
| write-routing-metadata | 发现 3 个新 distinct 问题：Windows 路径可让 pending modify-layer 绕过 approve gate；单次写入多次解析 write-target 可在并发 route/switch 时拆分 path/visibility/counters；fab_review 只看当前 write-target pending，切换写库后旧 pending 会从 review 队列消失。 | {"critical":0,"high":1,"medium":2,"low":0} |
| related-graph-retrieval | 发现 3 个新 distinct related-graph 问题：store-qualified personal 边绕过 KT→KP 隐私过滤、fabric-connect/archive 宣称的 review 写边路径实际缺失、related 扩展未应用 layer-flip redirect。 | {"critical":0,"high":1,"medium":2,"low":0} |
| release-perf-gates | 发现 1 个新 distinct issue：tag release 工作流复用 build/typecheck/lint/coverage/NO_COLOR gate，但漏跑普通 CI 已启用的 perf p95 gate，发布可绕过 CLI/hook 冷启动性能门禁。 | {"critical":0,"high":0,"medium":1,"low":0} |
| legacy-surface-drift | 发现 2 个新 distinct legacy-surface drift：发布版 server README 漏列现行 MCP 工具，quarantined HTTP README 仍描述已过期的 Part 2/CI 布局；已排除 ISS-20260609-021/024、ISS-20260608-046/059/006 等同类已登记问题。 | {"critical":0,"high":0,"medium":1,"low":1} |

## Issues Created
- ISS-20260609-032 [medium] global_ref schema requires store UUID while runtime and tests use store aliases as the qualified reference — packages/shared/src/schemas/store-stable-id.ts:50
- ISS-20260609-033 [medium] fab_archive_scan is marked as a store-writing MCP tool although the registered runtime is read-only — packages/shared/src/schemas/mcp-store-contracts.ts:73
- ISS-20260609-034 [high] Windows store paths let pending modify-layer bypass the approve gate — packages/server/src/services/review.ts:932
- ISS-20260609-035 [medium] Write paths re-resolve write-target metadata instead of using one target snapshot — packages/server/src/services/extract-knowledge.ts:336; packages/server/src/services/extract-knowledge.ts:359; packages/server/src/services/review.ts:607; packages/server/src/services/review.ts:620; packages/server/src/services/cross-store-write.ts:60
- ISS-20260609-036 [medium] fab_review strands pending entries outside the current write-target store — packages/shared/src/store/core.ts:186; packages/server/src/services/review.ts:173; packages/server/src/services/review.ts:377; packages/server/src/services/review.ts:520
- ISS-20260609-037 [high] Store-qualified personal related IDs bypass the KT→KP topology-leak guard — packages/server/src/services/knowledge-meta-builder.ts:1107
- ISS-20260609-038 [medium] fabric-connect/archive cannot persist related edges through fab_review despite documenting that path — packages/shared/src/schemas/api-contracts.ts:884
- ISS-20260609-039 [medium] Related-edge expansion ignores knowledge_id_redirect mappings after layer flips — packages/server/src/services/recall.ts:97
- ISS-20260609-040 [medium] Release workflow omits the CI perf benchmark gate before publish — .github/workflows/release.yml:51
- ISS-20260609-041 [medium] Published server README omits the registered fab_archive_scan MCP tool — packages/server/README.md:5; packages/server/src/index.ts:221; docs/RUNTIME-CONTRACTS.md:47
- ISS-20260609-042 [low] Quarantined HTTP README still describes the pre-Part-2 layout and workspace skip model — packages/server-http-experimental/README.md:20; packages/server-http-experimental/README.md:43; packages/server-http-experimental/README.md:47; packages/server-http-experimental/tsconfig.json:2

## Output Files
- .workflow/.csv-wave/20260609-discover-by-prompt-cluster-followup-025200/results.csv
- .workflow/issues/discoveries/DBP-20260609-025200/discovery-issues.jsonl
