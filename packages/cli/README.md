# @fenglimg/fabric-cli

`fabric` 是 Fabric 的主命令，`fab` 是永久别名，两者等价。

## 快速开始

1. 在 monorepo 根目录运行 `pnpm install`。
2. 用 `pnpm --filter @fenglimg/fabric-cli build` 构建 CLI。
3. 在目标项目运行 `fabric init`，完成一站式初始化。
4. 启动 `fabric serve`，再去客户端里验证 `fab_get_rules`。

`fabric init` 会自动执行 `bootstrap install`、`config install` 和 `hooks install`。只有在需要单独重跑某个阶段时，才需要单独调用它们。

`fabric bootstrap install` 只会刷新 `.fabric/bootstrap/README.md` 里的内部初始化说明，不会再生成根级 `AGENTS.md`、`CLAUDE.md` 或 `GEMINI.md`。

## 常用命令

- `fabric init`
- `fabric serve`
- `fabric doctor --audit`
- `fabric approve --interactive`
- `fabric approve --all`

## 进阶命令

- `fabric bootstrap install`
- `fabric config install`
- `fabric hooks install`

`fabric approve` 会在审查完成后更新 `.fabric/human-lock.json` 中已经发生漂移的条目。需要逐项确认时使用 `--interactive`，只有在别处已经完成审查时才使用 `--all`。
