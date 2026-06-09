# Fabric Testing

本文是测试策略入口。测试事实以 package scripts、Vitest tests、CI 和 drift gates 为准；测试方法论以既有 Maestro 收敛产物为准，不在本文重新发明。

## Authority

测试策略按 3 层读取：

1. **项目当前事实**：本文件、根 `package.json`、各 package `vitest.config.ts`、`.github/workflows/reusable-validate.yml`、`.github/workflows/ci.yml`。
2. **全面测试方法论**：[test-methodology-v6.md](../.workflow/.maestro/20260602-test-methodology-optimize/scratchpad/test-methodology-v6.md)。这是 v0→v6 多轮冷评、回测、human frame-challenge 后的 incumbent。
3. **Fabric E2E/dogfood 方法论**：[e2e-methodology-FINAL.md](../.workflow/.scratchpad/e2e-methodology-FINAL.md)。这是 v2.1 多 store 后的端到端旅程方法论。

方法论调研材料：

- [mainstream-research.md](../.workflow/.maestro/20260602-test-methodology-optimize/scratchpad/mainstream-research.md)：ISO 25010、HTSM、探索式测试、风险驱动、fitness functions、RAGAS、agent trajectory eval。
- [samespace-research.md](../.workflow/.maestro/20260602-test-methodology-optimize/scratchpad/samespace-research.md)：mem0/Letta/Zep、Braintrust/LangSmith/Langfuse、MCP Inspector。
- [trackd-research.md](../.workflow/.maestro/20260602-test-methodology-optimize/scratchpad/trackd-research.md)：OWASP LLM Top 10、LLM/agent 红队、成本和 loop 失控防护。
- [backtest-answer-set.md](../.workflow/.maestro/20260602-test-methodology-optimize/scratchpad/backtest-answer-set.md)：confirmed/refuted 回测答案集。
- [discovery-rubric.md](../.workflow/.maestro/20260602-test-methodology-optimize/scratchpad/discovery-rubric.md)：发现力评分规约。

## Commands

根目录脚本：

- `pnpm -r build`
- `pnpm -r test`
- `pnpm -r --if-present test:coverage`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:strategy`
- `pnpm test:store-only-e2e`
- `pnpm rc6:gate`

包级脚本见各 `package.json`。

## Package Boundaries

- CLI tests：`packages/cli/__tests__/`
- server tests：`packages/server/src/**/*.test.ts` 和 `packages/server/__tests__/`
- shared tests：`packages/shared/test/` 和 `packages/shared/src/**/*.test.ts`
- quarantined HTTP tests：`packages/server-http-experimental/`，不属于主线 release gate，除非显式恢复该 package

## Strategy Model

全面测试先按 `test-methodology-v6.md` 的四赛道 × 认识论轴分解：

| 赛道 | 问题 | 当前 repo 落点 |
| --- | --- | --- |
| A 正确性 | 有没有 / 对不对 / 接没接线 | unit、contract、schema、round-trip、drift snapshot |
| B 完备性 | 漏没漏 | J-META/surface census、issue/changelog/KB census、coverage gap、declared-vs-impl |
| C 效能 | 做了到底有没有用 | store-only E2E、recall/perf、agent trace、消融/反事实、LLM-judge |
| D 安全·可控 | 会不会做坏事 / 失控 | prompt injection、store privacy boundary、MCP/tool 越权、payload/cost/loop budget |

每个赛道再按 3 种 oracle 来源检查：

- **Examination**：代码、schema、docs、tests、CI、ISO/OWASP 等内部参照。
- **Reality**：dogfood、store-only E2E、真实 trace、chaos/offline/scale/concurrency 注入。
- **Intent-interrogation**：拷问需求本身，确认“正确实现的功能”是否仍然是对的目标。

必须先做 **Phase 0 历史先验 census**：读 issue、changelog、KB、pitfalls、postmortem、既有 maestro artifacts。已 confirmed 的项转成 regression/backtest anchors；已 refuted 的项不得复活成误报。

## Scenario Matrix

每个 public behavior 变更至少映射到下列 1 个场景；跨 package、store、client、agent behavior 或 release surface 的变更必须覆盖多个场景。

| 场景 | 适用变化 | 首选测试层 | 必跑命令 |
| --- | --- | --- | --- |
| Pure shared contract | Zod schema、i18n key、atomic write、resolver、payload guard | `packages/shared/test/` 或 `packages/shared/src/**/*.test.ts` | `pnpm --filter @fenglimg/fabric-shared test` |
| Server service/tool | MCP tool、store routing、doctor service、recall/review/extract service | `packages/server/src/**/*.test.ts` 或 `packages/server/__tests__/` | `pnpm --filter @fenglimg/fabric-server test` |
| CLI command/surface | citty command、help 文案、install/store/sync/doctor 命令行为 | `packages/cli/__tests__/`，必要时 snapshot | `NO_COLOR=1 pnpm --filter @fenglimg/fabric-cli test` |
| Cross-client hooks | Claude/Codex/Cursor hook config、hook `.cjs`、bootstrap managed block | hook unit tests + install parity tests | `pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/knowledge-hint-broad.test.ts __tests__/knowledge-hint-narrow.test.ts __tests__/hooks-install-validate.test.ts` |
| Store-only workflow | mounted store create/bind/write/review/recall round trip | built-artifact E2E | `pnpm -r build && pnpm test:store-only-e2e` |
| Agent-in-the-loop behavior | skill/hook/MCP 是否改变 agent 行为、cite/self-archive 遵循、fallback/skip/retry | trace dataset + deterministic scorer + LLM-judge | 先补可观测事件；再按 `e2e-methodology-FINAL.md` 的 J-EXP-META 执行 |
| Security/control | prompt injection、KB 投毒、cross-store 泄漏、MCP 越权、unbounded consumption | red-team matrix + privacy/budget tests | package test + targeted red-team/eval harness |
| Release drift gate | release-candidate scoped structural contract | rc gate script + package tests | `pnpm rc6:gate` |
| Cross-platform path risk | path handling、tmpdir、shebang、CLI smoke | Windows smoke in CI | GitHub Actions `windows-smoke` |
| Documentation/runtime contract | docs command names、runtime contract wording、strategy drift | grep or strategy gate | `pnpm test:strategy` |

不要把 coverage percentage 当作充分证明。Coverage gates 回答 “代码跑没跑”；scenario tests 回答 “用户可见契约是否还成立”；methodology backtest 回答 “第一遍冷跑是否能暴露已知深层问题并驳回已知误报”。

## TDD Write-Red Discipline

Use write-red for behavior changes, bug fixes, and release-gate additions. Documentation-only edits may skip red execution, but must run `pnpm test:strategy` when they touch this file or documented commands.

Required loop for code behavior:

1. Add or narrow a test that fails for the intended reason.
2. Capture the failing command and the smallest relevant failure line in the task notes or PR description.
3. Implement the minimal fix.
4. Re-run the exact red command until green.
5. Run the nearest package test, then the gate from the scenario matrix if the change crosses package/client/store/release boundaries.

Acceptable red forms:

- `expect(...).toEqual(...)` regression test for a bug.
- `it.fails` only for an intentionally staged ratchet; remove it in the phase that implements the behavior.
- Snapshot update only after reviewing the diff and confirming it is the intended public contract.
- Property-based test for parser, schema, budget, tokenization, path, or boundary behavior where examples are too narrow.
- Methodology backtest red：confirmed 项未被方法论浮出，或 refuted 项被复活成误报。

Unacceptable red substitutes:

- Adding a test after the implementation without ever seeing it fail.
- Counting a TypeScript compile error as the red test for runtime behavior.
- Updating snapshots before inspecting the mismatch.
- Broad `pnpm -r test` failure with unrelated pre-existing failures and no narrowed failing case.

## Fabric E2E/Dogfood

Fabric 端到端策略以 `e2e-methodology-FINAL.md` 为准：

- 深度轴：每条 journey 必须 grounded 在真实 anchor，不能臆造 CLI/API。
- 广度轴：J1-J24 + J-META，从真实声明源抽 inventory，断言每项进入 journey/parity/waiver。
- 交互轴：J-EXP-META，观测 real agent 行为，覆盖优雅降级、用户控制、权威平衡、主动时机、一致性、跨端体验、透明、可发现、谨慎适应。
- 可观测性边界：T1-ledger、T1-online、T2-需补事件、T3-LLM-judge；“无法评价”本身是一等 finding。

## Drift Gates

已知 drift gates：

- CLI surface snapshot：`packages/cli/__tests__/cli-surface.test.ts`
- API/schema contracts：`packages/shared/src/schemas/*.ts` 相关测试
- server tool registration：`packages/server/src/tools/*.test.ts` 和 `packages/server/src/index.test.ts`
- bootstrap managed block：shared template 与 install / doctor 测试
- strategy drift：`scripts/test-strategy-gate.mjs`

注意：当前 CLI surface snapshot 仍只覆盖一部分命令定义。完整 command registry 的事实源是 `packages/cli/src/commands/index.ts`；不要在文档中声称测试已经覆盖所有 top-level commands，除非先扩展测试。

## Gate Map

CI 主线 gate 在 `.github/workflows/reusable-validate.yml`：

- build：`pnpm -r build`
- typecheck：`pnpm -r exec tsc --noEmit`
- lint：`pnpm lint`
- package coverage：`pnpm -r --if-present test:coverage`
- strategy drift：`pnpm test:strategy`
- store-only E2E：`pnpm test:store-only-e2e`
- protected-token lint：`node --experimental-strip-types scripts/lint-protected-tokens.ts`
- NO_COLOR snapshot：`NO_COLOR=1 pnpm --filter @fenglimg/fabric-cli test`
- perf benchmark：`node scripts/perf-benchmark.mjs`

Windows smoke 在 `.github/workflows/ci.yml`，只覆盖 shared tests 和 built CLI `--help` / `--version`，不替代 Linux 全量 gate。

## Coverage Policy

新增或修改 public behavior 时，至少覆盖：

- happy path
- error path
- idempotency or no-write path，若命令会写文件
- drift-sensitive snapshot，若行为暴露为 CLI help、MCP schema、bootstrap 文本或 generated config
- round-trip 或 producer→consumer assertion，若行为跨写入、读取、hook、MCP、agent 行为边界
- safety/control negative path，若行为触及 store privacy、prompt injection、tool authority、payload/cost/loop budget

文档变更本身不要求跑全量测试，但必须跑 `pnpm test:strategy`，并做定向 grep，确认没有继续引用已移除命令或旧 contract。
