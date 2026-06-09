# Issue Discovery Report

## Summary
- Session: DBP-20260609-031000
- Mode: by-prompt reverse-oracle sweep
- Raw findings: 7
- Unique issues appended: 7
- Severity: critical=0, high=0, medium=6, low=1
- Dedup note: local fallback used because spawned dedup worker did not call report_agent_job_result.

## Breakdown by Perspective
| Perspective | Findings | Severity Distribution |
|---|---|---|
| cli-arg-contracts | 已读 registry 并排除 ISS-20260609-021..042、ISS-20260531-114、ISS-20260608-031/034 等同类旧项；扫描 packages/cli 命令定义、shared i18n、README/docs 和 CLI surface snapshots。新增 2 个 distinct CLI 参数契约问题：install global 分支绕过 dry-run；sync continue/abort 互斥缺失。 | {"critical":0,"high":0,"medium":2,"low":0} |
| schema-serializer-roundtrip | 已读 registry 并去重 ISS-20260609-021..042 及旧 frontmatter/YAML/JSONL issue；用 rg/rg --files 扫过 packages/scripts/docs 的 schema、extract/review/meta-builder、TOML/JSON config、events/metrics JSONL。新增 1 个 distinct：frontmatter serializer 已会 quote，但 parser 仍按逗号硬拆且只剥引号，schema-valid 字符串无法 round-trip。 | {"critical":0,"high":0,"medium":1,"low":0} |
| audit-history-lifecycle | 扫过 registry 021..042 及 audit/lifecycle 旧项，并检查 review、event-ledger、archive-scan、doctor/issue 相关状态转换。新增 2 个 distinct 问题：defer ledger 事件缺目标身份，search 的 include_rejected 契约与 rejected/ 目录实现不一致。 | {"critical":0,"high":0,"medium":2,"low":0} |
| cross-client-generated-parity | 已读 registry 并核对 021..042 及 parity/生成物旧项；扫了 packages/cli templates/install pipeline、packages/shared parity-matrix、active .claude/.codex hooks/skills、相关测试。新增 1 个 distinct issue：parity matrix/E2E 枚举漏掉已安装的 audit/connect skills 与 cite/session-end/post-tooluse hooks，导致矩阵门禁可在生成产物漂移时仍通过。 | {"critical":0,"high":0,"medium":1,"low":0} |
| workspace-package-boundaries | 已去重 ISS-20260609-021..042 及 workspace/package 旧 issue；扫描 pnpm-workspace、root/package manifests、package exports/imports、tsconfig、release/CI 与版本脚本。新增 1 个低危 CI/package 边界问题：Windows smoke 声称覆盖 shebang 与 --help，但实际只用 node 直跑 --version，绕过 package bin/shebang 和 help 渲染。 | {"critical":0,"high":0,"medium":0,"low":1} |

## Issues Created
- ISS-20260609-043 [medium] fabric install --global ignores the declared --dry-run no-write contract — packages/cli/src/commands/install-v2.ts:38; packages/cli/src/commands/install-v2.ts:87; packages/cli/src/install/run-global-install.ts:117; packages/cli/src/install/run-global-install.ts:135
- ISS-20260609-044 [medium] fabric sync accepts --continue and --abort together and silently prioritizes continue — packages/cli/src/commands/sync.ts:29; packages/cli/src/commands/sync.ts:35
- ISS-20260609-045 [medium] Quoted frontmatter arrays do not round-trip through line-based parsers — packages/shared/src/schemas/api-contracts.ts:891; packages/shared/src/schemas/api-contracts.ts:898; packages/server/src/services/review.ts:1395; packages/server/src/services/review.ts:1520; packages/server/src/services/knowledge-meta-builder.ts:1288; packages/server/src/services/knowledge-meta-builder.ts:1294
- ISS-20260609-046 [medium] knowledge_deferred ledger events do not identify the deferred entry — packages/server/src/services/review.ts:1279; packages/shared/src/schemas/event-ledger.ts:368
- ISS-20260609-047 [medium] fab_review search cannot surface rejected entries despite include_rejected contract — packages/server/src/services/review.ts:1111; packages/shared/src/schemas/api-contracts.ts:1045
- ISS-20260609-048 [medium] Parity matrix E2E omits installed hooks and skills from the generated-output sweep — packages/cli/src/install/skills-and-hooks.ts:158; packages/cli/src/install/skills-and-hooks.ts:226; packages/shared/src/parity/parity-matrix.json:6; packages/shared/src/parity/parity-matrix.json:300; packages/cli/__tests__/integration/parity-matrix-e2e.test.ts:31; packages/cli/__tests__/integration/parity-matrix-e2e.test.ts:45
- ISS-20260609-049 [low] Windows smoke bypasses the published CLI bin and promised --help coverage — .github/workflows/ci.yml:68; .github/workflows/ci.yml:102; packages/cli/package.json:29

## Output Files
- .workflow/.csv-wave/20260609-discover-by-prompt-reverse-oracles-031000/results.csv
- .workflow/issues/discoveries/DBP-20260609-031000/discovery-issues.jsonl
