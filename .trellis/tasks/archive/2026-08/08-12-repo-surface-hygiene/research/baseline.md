# 基线(2026-08-12,步骤 0)

> A5「行为等价」比的是**这组数字**,不是「绿不绿」。纯移动最危险的失败模式是
> 「测试还是绿的,但少跑了一批」—— 只有逐包用例数相等才能咬住它。

## 类型检查

```
pnpm -r exec tsc --noEmit   →  exit 0
```

## 测试用例数(A5 硬判据)

| 包 | Test Files | Tests |
|---|---|---|
| shared | 53 passed / 1 skipped (54) | **646 passed / 6 skipped (652)** |
| server | 101 passed / 1 skipped (102) | **1159 passed / 2 skipped (1161)** |
| cli | 143 passed / 1 skipped (144) | **1473 passed / 5 skipped (1478)** |

三包退出码均为 0。

## 门禁

| 门禁 | 基线状态 |
|---|---|
| `scripts/lint-dangling-refs.mjs` | PASS — 418 tracked files, 0 dangling |
| `pnpm lint`(knip) | **exit 1(预先存在,非本任务引入)** — 2 个未用依赖:`tree-sitter-javascript` / `web-tree-sitter`,均在 `packages/cli/package.json` |

⚠️ knip 基线就是红的。A6「无新增告警」的判据是**与这 2 条比对**,不是「变绿」。
本任务不修这 2 条(超出门面范围,属依赖治理)。

## 结构计数(A3 / A4 基线)

| 指标 | 基线 | 目标 |
|---|---|---|
| `ls packages/server/src/services` 顶层条目 | **179** | < 40 |
| 新克隆根目录跟踪条目 | **25** | < 25 |

## 环境噪声备忘

本次基线跑在主 checkout,未命中已知的 worktree 假红(嵌套 worktree 存在时
`hooks-runtime-generated` 假红 / `.claude/worktrees/` 内跑 hook 测试 21 个假失败)。
后续复跑若出现,先确认是否在 worktree 内,不要当回归。
