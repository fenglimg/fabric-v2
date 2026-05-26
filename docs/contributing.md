# 参与 Fabric 贡献

本指南涵盖本地开发前置条件、推荐的 pnpm 工作流，以及从 README 迁出的环境说明，便于 npm 用户把落地页聚焦在产品上手。

## 前置条件

- Node.js 20 或更高版本
- pnpm 9 或更高版本
- Git
- 至少一种 MCP client 用于本地验证：Claude Code、Cursor 或 Codex CLI

在仓库根目录安装 workspace 依赖：

```bash
pnpm install
```

## 开发环境

在测试 CLI 流程前先构建 workspace：

```bash
pnpm -r build
```

迭代 package 代码时使用 monorepo 开发循环：

```bash
pnpm dev
```

常用定向命令：

```bash
pnpm --filter @fenglimg/fabric-cli test
pnpm --filter @fenglimg/fabric-server build
```

## FAB_SERVER_PATH

`fabric install` 会把 MCP client config 指向已打包的 server entry。若在本 monorepo 内测试，希望 client config 指向本地构建的 server，请显式设置 `FAB_SERVER_PATH`：

```bash
export FAB_SERVER_PATH="$PWD/packages/server/dist/index.js"
```

在目标测试仓库中运行初始化预览：

```bash
FAB_SERVER_PATH="$FAB_SERVER_PATH" node "$PWD/packages/cli/dist/index.js" init --plan
```

然后执行 Fabric 初始化：

```bash
FAB_SERVER_PATH="$FAB_SERVER_PATH" node "$PWD/packages/cli/dist/index.js" init
```

若文件不存在，请先重建 server package：

```bash
pnpm --filter @fenglimg/fabric-server build
```

## 贡献流程

1. 为单一聚焦的改动创建分支。
2. 编辑前阅读相关文档与命令实现。
3. 提交小而可 review 的 commit，保留既有 client config 与仓库状态。
4. 开 PR 前运行测试与校验命令。
5. 行为或预期 CLI 输出变化时更新文档。

## 校验清单

先运行能覆盖你改动的最窄检查，再在面向 release 的合并前重跑更宽的 workspace 检查：

```bash
pnpm test
pnpm -r build
```

若以文档驱动的上手路径有改动，同时验证关键入口：

```bash
rg -n "Placeholder workflow|FAB_SERVER_PATH" README.md docs
```

## 对 Release 敏感的区域

编辑时请保守处理：

- `README.md` 与 `docs/getting-started.md`：面向 npm 的上手路径
- `packages/cli/src/commands/*.ts`：用户可见的命令行为与输出
- `packages/server/src/**`：MCP runtime 行为
- `packages/cli/templates/**`：跨 client 的 bootstrap 与 hook 兼容性
