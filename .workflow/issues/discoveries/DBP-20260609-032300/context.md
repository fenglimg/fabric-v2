# Issue Discovery Report

## Summary
- Session: DBP-20260609-032300
- Mode: by-prompt tail sweep
- Raw findings: 10
- Unique issues appended: 10
- Severity: critical=0, high=0, medium=9, low=1

## Breakdown by Perspective
| Perspective | Findings | Severity Distribution |
|---|---|---|
| issue-registry-metadata | 扫过 existing registry（含 ISS-20260609-001..049）、.workflow/issues JSON/JSONL、discovery-state/discovery-issues 计数与 packages/docs 中 source/status/history 协议痕迹。新增 1 个 distinct 元数据问题：master registry 中 16 条 resolved 记录未同步 issue_history。 | {"critical":0,"high":0,"medium":1,"low":0} |
| platform-path-tail | 扫过 registry（重点 001..049）、packages/scripts/.github 指定后缀，并按 path separator、absolute/relative、symlink、file URL、exec/shell 边界做 rg 窄扫。避开已登记的 Windows modify-layer、alias traversal、CI smoke/bin、CLI flag、frontmatter path round-trip 等重复项；发现 2 个新的 platform path tail issue。 | {"critical":0,"high":0,"medium":2,"low":0} |
| store-config-resolution-tail | 新增 3 个 distinct tail case。已核对 ISS-20260609-001..049，避开 025/026/032/035/036：重点扫了 store resolver、resolve input、bindings snapshot、store ops、cross-store recall、schema/docs。发现 write target 可落到 read-set 外、$personal sentinel 被 resolver 当 missing、alias+UUID 双声明导致 read-set 重复。 | {"critical":0,"high":0,"medium":2,"low":1} |
| command-state-tail | 已读 registry 并避开 ISS-20260609-043 install global dry-run、044 sync continue/abort 等重复项。扫过 CLI 命令参数、dry-run/yes/json/exit/warning、store/sync/install 状态路径，发现 2 个新 distinct tail issue：当前 project install --dry-run 实际写盘；除 info/status/whoami 外的写命令仍会吞未知 flags。 | {"critical":0,"high":0,"medium":2,"low":0} |
| docs-runtime-contract-tail | 已读 issues.jsonl 并去重 ISS-20260609-001..049，扫描 docs/README/CHANGELOG/AGENTS/CLAUDE、packages md/json/ts 与 cli templates。新增 2 个 distinct tail drift：packaged Skill 模板仍教旧 .fabric/knowledge/agents.meta 路径；当前 CHANGELOG 顶部仍发布 5-tool MCP surface。 | {"critical":0,"high":0,"medium":2,"low":0} |

## Issues Created
- ISS-20260609-050 [medium] Resolved issues in the master registry do not record resolved transitions in issue_history — .workflow/issues/issues.jsonl:47
- ISS-20260609-051 [medium] Windows drive-letter absolute paths bypass plan_context path sandbox — packages/server/src/services/plan-context.ts:242
- ISS-20260609-052 [medium] Store executable guard follows store-controlled symlinks outside the store — packages/shared/src/resolver/store-disk-reader.ts:132
- ISS-20260609-053 [medium] Write target can resolve outside the project's read-set — packages/shared/src/resolver/contracts.ts:131; packages/shared/src/resolver/store-resolver.ts:127; packages/cli/src/store/store-ops.ts:469; packages/server/src/services/cross-store-recall.ts:100
- ISS-20260609-054 [medium] $personal required-store sentinel is accepted but treated as a missing shared store — packages/shared/src/schemas/fabric-config.ts:92; packages/shared/src/schemas/store.ts:123; packages/shared/src/schemas/store-contracts.test.ts:45; packages/shared/src/store/resolve-input.ts:39; packages/shared/src/resolver/store-resolver.ts:66
- ISS-20260609-055 [low] Alias and UUID declarations for the same store duplicate read-set entries — packages/shared/src/store/store-lifecycle.ts:87; packages/shared/src/resolver/store-resolver.ts:65; packages/shared/src/resolver/store-resolver.ts:95; packages/server/src/services/cross-store-recall.ts:110
- ISS-20260609-056 [medium] fabric install --dry-run 的 project pipeline 仍执行真实写入 — packages/cli/src/commands/install-v2.ts:145; packages/cli/src/install/pipeline/env.stage.ts:48; packages/cli/src/install/pipeline/env.stage.ts:114; packages/cli/src/install/pipeline/store.stage.ts:59; packages/cli/src/install/pipeline/hooks.stage.ts:66
- ISS-20260609-057 [medium] Mutating CLI commands silently ignore misspelled safety flags — packages/cli/src/lib/unknown-flags.ts:10; packages/cli/src/commands/sync.ts:35; packages/cli/src/commands/sync.ts:43; packages/cli/src/commands/store.ts:224; packages/cli/src/commands/store.ts:337
- ISS-20260609-058 [medium] Packaged Fabric skills still instruct agents to inspect retired project-local .fabric/knowledge trees — packages/cli/templates/skills/fabric-review/SKILL.md:62; packages/cli/templates/skills/fabric-review/SKILL.md:76; packages/cli/templates/skills/fabric-import/SKILL.md:21; packages/cli/templates/skills/fabric-import/SKILL.md:60; packages/shared/src/schemas/store.ts:179
- ISS-20260609-059 [medium] Current changelog top-level highlights still publish the pre-archive-scan 5-tool MCP surface — CHANGELOG.md:34; README.md:59; docs/RUNTIME-CONTRACTS.md:41; packages/server/src/index.ts:221

## Output Files
- .workflow/.csv-wave/20260609-discover-by-prompt-tail-sweep-032300/results.csv
- .workflow/issues/discoveries/DBP-20260609-032300/discovery-issues.jsonl
