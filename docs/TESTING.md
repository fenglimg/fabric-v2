# Fabric Testing

本文是测试策略入口。测试事实以 package scripts、Vitest tests 和 drift gates 为准。

## Commands

根目录脚本：

- `pnpm -r build`
- `pnpm -r test`
- `pnpm -r --if-present test:coverage`
- `pnpm typecheck`
- `pnpm lint`

包级脚本见各 `package.json`。

## Package Boundaries

- CLI tests：`packages/cli/__tests__/`
- server tests：`packages/server/src/**/*.test.ts`
- shared tests：`packages/shared/test/` 和 `packages/shared/src/**/*.test.ts`
- quarantined HTTP tests：`packages/server-http-experimental/`，不属于主线 release gate，除非显式恢复该 package

## Drift Gates

已知 drift gates：

- CLI surface snapshot：`packages/cli/__tests__/cli-surface.test.ts`
- API/schema contracts：`packages/shared/src/schemas/*.ts` 相关测试
- server tool registration：`packages/server/src/tools/*.test.ts` 和 `packages/server/src/index.test.ts`
- bootstrap managed block：shared template 与 install / doctor 测试

注意：当前 CLI surface snapshot 仍只覆盖一部分命令定义。完整 command registry 的事实源是 `packages/cli/src/commands/index.ts`；不要在文档中声称测试已经覆盖所有 top-level commands，除非先扩展测试。

## Coverage Policy

新增或修改 public behavior 时，至少覆盖：

- happy path
- error path
- idempotency or no-write path，若命令会写文件
- drift-sensitive snapshot，若行为暴露为 CLI help、MCP schema、bootstrap 文本或 generated config

文档变更本身不要求跑全量测试，但必须做定向 grep，确认没有继续引用已移除命令或旧 contract。
