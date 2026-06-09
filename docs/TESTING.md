# Fabric Testing

本文是测试策略入口。测试事实以 package scripts、Vitest tests、CI 和 drift gates 为准。新增或修改行为时，先按场景矩阵选测试层，再按 TDD 写红纪律证明测试能失败。

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
- server tests：`packages/server/src/**/*.test.ts`
- shared tests：`packages/shared/test/` 和 `packages/shared/src/**/*.test.ts`
- quarantined HTTP tests：`packages/server-http-experimental/`，不属于主线 release gate，除非显式恢复该 package

## Scenario Matrix

每个 public behavior 变更至少映射到下列 1 个场景；跨 package、store、client 或 release surface 的变更必须覆盖多个场景。

| 场景 | 适用变化 | 首选测试层 | 必跑命令 |
| --- | --- | --- | --- |
| Pure shared contract | Zod schema、i18n key、atomic write、resolver、payload guard | `packages/shared/test/` 或 `packages/shared/src/**/*.test.ts` | `pnpm --filter @fenglimg/fabric-shared test` |
| Server service/tool | MCP tool、store routing、doctor service、recall/review/extract service | `packages/server/src/**/*.test.ts` 或 `packages/server/__tests__/` | `pnpm --filter @fenglimg/fabric-server test` |
| CLI command/surface | citty command、help 文案、install/store/sync/doctor 命令行为 | `packages/cli/__tests__/`，必要时 snapshot | `NO_COLOR=1 pnpm --filter @fenglimg/fabric-cli test` |
| Cross-client hooks | Claude/Codex/Cursor hook config、hook `.cjs`、bootstrap managed block | hook unit tests + install parity tests | `pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/knowledge-hint-broad.test.ts __tests__/knowledge-hint-narrow.test.ts __tests__/hooks-install-validate.test.ts` |
| Store-only workflow | mounted store create/bind/write/review/recall round trip | built-artifact E2E | `pnpm -r build && pnpm test:store-only-e2e` |
| Release drift gate | release-candidate scoped structural contract | rc gate script + package tests | `pnpm rc6:gate` |
| Cross-platform path risk | path handling、tmpdir、shebang、CLI smoke | Windows smoke in CI | GitHub Actions `windows-smoke` |
| Documentation/runtime contract | docs command names、runtime contract wording、strategy drift | grep or strategy gate | `pnpm test:strategy` |

Do not treat coverage percentage alone as proof. Coverage gates answer "did code run"; scenario tests answer "did the user-visible contract survive."

## TDD Write-Red Discipline

Use write-red for behavior changes, bug fixes, and release-gate additions. Documentation-only edits may skip red execution, but still run `pnpm test:strategy` when they touch this file or documented commands.

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

Unacceptable red substitutes:

- Adding a test after the implementation without ever seeing it fail.
- Counting a TypeScript compile error as the red test for runtime behavior.
- Updating snapshots before inspecting the mismatch.
- Broad `pnpm -r test` failure with unrelated pre-existing failures and no narrowed failing case.

## Drift Gates

已知 drift gates：

- CLI surface snapshot：`packages/cli/__tests__/cli-surface.test.ts`
- API/schema contracts：`packages/shared/src/schemas/*.ts` 相关测试
- server tool registration：`packages/server/src/tools/*.test.ts` 和 `packages/server/src/index.test.ts`
- bootstrap managed block：shared template 与 install / doctor 测试

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

文档变更本身不要求跑全量测试，但必须做定向 grep，确认没有继续引用已移除命令或旧 contract。
