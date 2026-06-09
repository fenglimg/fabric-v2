# Issue Discovery Report

## Summary
- Session: DBP-20260609-023700
- Mode: by-prompt inconsistency sweep
- Raw findings: 11
- Unique issues appended: 11
- Severity: critical=0, high=2, medium=7, low=2

## Breakdown by Perspective
| Perspective | Findings | Severity Distribution |
|---|---|---|
| declared-vs-implementation | 确认 4 条新的 declared-vs-implementation drift：experimental HTTP 包继续引用 server 已移除 exports；doctor 公开文案硬编码 48 checks 但实现只有约 46/47；tooling manifest 的 protected-token 输入路径指向不存在的 root templates；server npm metadata 仍描述旧 .fabric/agents.meta 知识库。 | {"critical":0,"high":0,"medium":3,"low":1} |
| producer-consumer | 发现 1 个新的 producer/consumer drift：store-aware MCP 契约/测试声称 6 个工具输出 store edge，但实际 runtime schemas/services 只输出旧字段或 alias-only store 信息。 | {"critical":0,"high":1,"medium":0,"low":0} |
| round-trip-invariants | 发现 2 个 round-trip invariant 问题：project-scoped route-write 写入后不会被 archive/review 写路径实际使用；fab_recall include_related 的 bare related-id 契约与 store-qualified 候选 id 不匹配。已避开现有 switch-write snapshot、doctor 集成、G11 stale 等重复 issue。 | {"critical":0,"high":1,"medium":1,"low":0} |
| state-error-isolation | 发现 2 个未登记的 state/error isolation 风险：shutdown drain 单槽等待器会在跨信号并发时覆盖等待状态；metrics flush window 使用全局 interval，跨 projectRoot 串状态。 | {"critical":0,"high":0,"medium":1,"low":1} |
| test-gate-drift | 发现 2 个 test gate drift：CI perf gate 使用 legacy/minimal fixture 可漏掉 mounted-store 冷启动退化；root 暴露的 rc6:gate 已与当前文件/配置漂移，作为 release helper 会产生失真 gate 信号。 | {"critical":0,"high":0,"medium":2,"low":0} |

## Issues Created
- ISS-20260609-021 [medium] Experimental HTTP APIs import server barrel exports that the server explicitly removed — packages/server-http-experimental/src/api/knowledge.ts:1
- ISS-20260609-022 [medium] Doctor CLI/README still advertise 48 checks after the implementation changed — packages/cli/src/commands/doctor.ts:773
- ISS-20260609-023 [medium] Tooling manifest protected-token inputs point at obsolete template roots — docs/tooling-manifest.json:72
- ISS-20260609-024 [low] Published server package metadata still describes retired .fabric/agents.meta storage — packages/server/package.json:4
- ISS-20260609-025 [high] Store-aware MCP contract advertises provenance and written_to_store fields that runtime outputs do not produce — Producer: packages/shared/src/schemas/mcp-store-contracts.ts:17, packages/shared/test/store/mcp-store-contracts.test.ts:11, packages/shared/src/parity/parity-matrix.json:167; Consumer/runtime: packages/shared/src/schemas/api-contracts.ts:329, packages/shared/src/schemas/api-contracts.ts:480, packages/shared/src/schemas/api-contracts.ts:826, packages/server/src/services/recall.ts:196, packages/server/src/services/extract-knowledge.ts:464
- ISS-20260609-026 [high] Project route-write is ignored by archive/review write-target resolution — packages/server/src/services/cross-store-write.ts:60
- ISS-20260609-027 [medium] fab_recall include_related only works with store-qualified related IDs despite bare-id contract — packages/server/src/services/recall.ts:132
- ISS-20260609-028 [medium] In-flight drain uses a single waiter slot, so concurrent shutdown drains can overwrite each other — packages/server/src/services/in-flight-tracker.ts:10
- ISS-20260609-029 [low] Metrics flush window is global mutable state shared across project roots — packages/server/src/services/metrics.ts:43
- ISS-20260609-030 [medium] CI perf benchmark uses a legacy minimal fixture instead of the mounted-store workflow — scripts/perf-benchmark.mjs:54
- ISS-20260609-031 [medium] Exposed rc6 gate is stale against current hook/config files — scripts/rc6-coverage-gate.mjs:439

## Output Files
- .workflow/.csv-wave/20260609-discover-by-prompt-inconsistency-sweep-023700/results.csv
- .workflow/issues/discoveries/DBP-20260609-023700/discovery-issues.jsonl
