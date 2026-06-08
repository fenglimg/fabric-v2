# Issue Discovery Report

## Summary
- Session: DBP-20260608-223607
- Mode: by-prompt
- Perspectives: 5
- Raw findings: 19
- Unique issues: 19

## Breakdown by Perspective
| Perspective | Findings | Critical | High | Medium | Low |
|-------------|----------|----------|------|--------|-----|
| command-surface-drift | 5 | 0 | 0 | 4 | 1 |
| knowledge-tool-terminology-drift | 3 | 0 | 0 | 2 | 1 |
| server-http-surface-drift | 5 | 0 | 0 | 2 | 3 |
| install-hook-skill-source-drift | 3 | 0 | 0 | 3 | 0 |
| schema-issue-metadata-contract-drift | 3 | 0 | 0 | 2 | 1 |

## Severity Distribution
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 13 |
| Low | 6 |

## Perspective Details
### command-surface-drift
发现 5 个未被现有 ISS 明确覆盖的 command-surface 漂移：install/uninstall 旧 flag、已移除 hooks 命令残留、CLI drift gate 覆盖缺口，以及 force-only 安装参数残留。

**Top Issues:**
- (medium) Install 文档和 test seed 仍要求已移除的 --plan/--reapply/--force/--scope 参数 — docs/getting-started.md:45
- (medium) CLI test seed 仍写 fabric uninstall --plan，但实现和测试已迁到 --dry-run — docs/test-seed/cli.md:74
- (medium) Initialization guide 仍把已移除的 fabric hooks 当作可执行命令 — docs/initialization.md:193
- (medium) CLI --help drift gate 没有覆盖当前文档声明的 store/sync/info 公共命令 — packages/cli/__tests__/cli-surface.test.ts:100
- (low) force-only install 参数在文章和 i18n 中残留为当前能力 — docs/articles/agents-md-to-fabric-knowledge-loop.md:212

### knowledge-tool-terminology-drift
手动补扫发现 3 个 knowledge/tool terminology 漂移：MCP runtime annotation 仍叫 rule sections，protected-token lint 仍钉旧两步编辑入口，cocos fixture 仍教授 fab_get_rules/.fabric/agents。

**Top Issues:**
- (medium) fab_get_knowledge_sections runtime contract still calls itself rule-section filtering — packages/shared/src/schemas/api-contracts.ts:379
- (medium) Protected-token lint still protects the retired two-step edit bootstrap instead of fab_recall-first contract — scripts/lint-protected-tokens.ts:24
- (low) Cocos init-context fixture still teaches the removed fab_get_rules and .fabric/agents shadow protocol — packages/cli/__tests__/fixtures/cocos-stub/AGENTS.md:7

### server-http-surface-drift
发现 5 个 server/HTTP surface drift：quarantine 恢复说明过期、dashboard copy 工具清单残留、workspace 声明矛盾、HTTP 测试头仍列已删 endpoint、Dashboard conventions 指向已删除包。

**Top Issues:**
- (medium) HTTP quarantine 恢复说明仍停留在 Part 1，指向已搬走的 mainline HTTP 实现 — packages/server-http-experimental/README.md:43
- (medium) Tooling manifest 仍登记已删除的 dashboard static copy build script — docs/tooling-manifest.md:22
- (low) Root workspace 声明与 pnpm workspace 对 server-http-experimental 的 quarantine 边界不一致 — package.json:5
- (low) HTTP integration test header 仍把已删除的 `/api/intent/annotate` 列为 exercised endpoint — packages/server-http-experimental/__tests__/integration/http-endpoints.test.ts:14
- (low) Conventions 仍把已删除 `packages/dashboard` 当作现行 UI token source — docs/CONVENTIONS.md:59

### install-hook-skill-source-drift
发现 3 个新的 install/hook/skill source drift：Cursor 活跃 bootstrap 副本仍是旧长版规则；fabric-archive gate ref 与测试仍验证 retired archive-hint 名；store-backed 写路径已生效但 archive/review/import skill 热路径仍指向本地 .fabric/knowledge/pending。

**Top Issues:**
- (medium) Active Cursor bootstrap managed block is stale relative to canonical store-only bootstrap — .cursor/rules/fabric-bootstrap.mdc:30
- (medium) fabric-archive trigger-gate docs and tests still validate retired `archive-hint.cjs` — packages/cli/src/install/skills-and-hooks.ts:86
- (medium) Store-backed pending write path conflicts with skill templates that still glob project-local `.fabric/knowledge/pending` — AGENTS.md:5

### schema-issue-metadata-contract-drift
发现 3 个 schema/metadata 合约漂移问题：issue source 值混用、store counters 文档仍指向 retired agents.meta 位置、active_project 未按 scope/project-id 规则校验却被写入 semantic_scope。

**Top Issues:**
- (medium) Issue registry mixes source=discovery and source=discover — .workflow/issues/issues.jsonl:1
- (low) Counter storage documentation still describes retired agents.meta counters — docs/data-schema.md:163
- (medium) active_project config accepts values that violate semantic_scope/project id contract — packages/shared/src/schemas/fabric-config.ts:98

## Issues Created
- ISS-20260608-031 (medium) Install 文档和 test seed 仍要求已移除的 --plan/--reapply/--force/--scope 参数 — docs/getting-started.md:45
- ISS-20260608-032 (medium) CLI test seed 仍写 fabric uninstall --plan，但实现和测试已迁到 --dry-run — docs/test-seed/cli.md:74
- ISS-20260608-033 (medium) Initialization guide 仍把已移除的 fabric hooks 当作可执行命令 — docs/initialization.md:193
- ISS-20260608-034 (medium) CLI --help drift gate 没有覆盖当前文档声明的 store/sync/info 公共命令 — packages/cli/__tests__/cli-surface.test.ts:100
- ISS-20260608-035 (low) force-only install 参数在文章和 i18n 中残留为当前能力 — docs/articles/agents-md-to-fabric-knowledge-loop.md:212
- ISS-20260608-036 (medium) fab_get_knowledge_sections runtime contract still calls itself rule-section filtering — packages/shared/src/schemas/api-contracts.ts:379
- ISS-20260608-037 (medium) Protected-token lint still protects the retired two-step edit bootstrap instead of fab_recall-first contract — scripts/lint-protected-tokens.ts:24
- ISS-20260608-038 (low) Cocos init-context fixture still teaches the removed fab_get_rules and .fabric/agents shadow protocol — packages/cli/__tests__/fixtures/cocos-stub/AGENTS.md:7
- ISS-20260608-039 (medium) HTTP quarantine 恢复说明仍停留在 Part 1，指向已搬走的 mainline HTTP 实现 — packages/server-http-experimental/README.md:43
- ISS-20260608-040 (medium) Tooling manifest 仍登记已删除的 dashboard static copy build script — docs/tooling-manifest.md:22
- ISS-20260608-041 (low) Root workspace 声明与 pnpm workspace 对 server-http-experimental 的 quarantine 边界不一致 — package.json:5
- ISS-20260608-042 (low) HTTP integration test header 仍把已删除的 `/api/intent/annotate` 列为 exercised endpoint — packages/server-http-experimental/__tests__/integration/http-endpoints.test.ts:14
- ISS-20260608-043 (low) Conventions 仍把已删除 `packages/dashboard` 当作现行 UI token source — docs/CONVENTIONS.md:59
- ISS-20260608-044 (medium) Active Cursor bootstrap managed block is stale relative to canonical store-only bootstrap — .cursor/rules/fabric-bootstrap.mdc:30
- ISS-20260608-045 (medium) fabric-archive trigger-gate docs and tests still validate retired `archive-hint.cjs` — packages/cli/src/install/skills-and-hooks.ts:86
- ISS-20260608-046 (medium) Store-backed pending write path conflicts with skill templates that still glob project-local `.fabric/knowledge/pending` — AGENTS.md:5
- ISS-20260608-047 (medium) Issue registry mixes source=discovery and source=discover — .workflow/issues/issues.jsonl:1
- ISS-20260608-048 (low) Counter storage documentation still describes retired agents.meta counters — docs/data-schema.md:163
- ISS-20260608-049 (medium) active_project config accepts values that violate semantic_scope/project id contract — packages/shared/src/schemas/fabric-config.ts:98
