# Fabric 品牌

本文定义面向公开 package 页面、仓库文档、README 嵌入与轻量产品界面的最低 v1.0 brand system。

## 命名三形式

| 形式 | 用途 | 规则 |
|---|---|---|
| `fab` | CLI binary 与命令示例 | 指可执行命令、子命令或终端输出时，使用小写 monospace。 |
| `Fabric` | 产品名 | 在正文、文档、release notes 与 package 描述中使用 title case。 |
| `fabric` | UI wordmark | 仅用于视觉 wordmark、sidebar 品牌标签与 logo 邻近组合时使用小写。 |

除非作为 environment variable 前缀或 shell 常量，否则不要用 `FABRIC` 作为产品名。

## 色板

来源：`packages/dashboard/src/styles/tokens.css`。

| Token | Hex | 用途 |
|---|---:|---|
| `--color-surface-canvas` | `#0b1016` | 产品界面与截图的主暗色 canvas。 |
| `--color-surface-panel` | `#0f172a` | Sidebar 与 panel 基底。 |
| `--color-text-primary` | `#f8fafc` | 暗色界面主文字与 avatar lettermark。 |
| `--color-text-muted` | `#94a3b8` | 次要 metadata、说明与弱化 UI 标签。 |
| `--color-source-ai-accent` | `#6366f1` | AI 侧强调色与 v1.0 avatar 背景。 |
| `--color-source-human-accent` | `#14b8a6` | Human 侧强调色与协作对比色。 |
| `--color-action-primary` | `#22c55e` | Primary action 与成功激活状态。 |
| `--color-state-locked-accent` | `#f59e0b` | 受保护或 human-locked 状态强调色。 |

wordmark SVG 使用 `currentColor`，宿主可设置文字颜色以适配浅色或深色背景，而无需改 asset。

## 字体栈

CLI 与 protocol 相关界面使用 `--font-family-mono` 的 monospace stack：

```text
"Space Mono", "JetBrains Mono", "SF Mono", "Monaco", "Consolas", ui-monospace, monospace
```

Dashboard 与长文 UI 正文使用 `--font-family-sans` 的 sans stack：

```text
"Inter", -apple-system, "Segoe UI", system-ui, sans-serif
```

命令、ledger 字段、protocol key 与紧凑产品标记用 monospace；解释性 UI 标签、表格与文档正文用 sans。

## Tone-of-voice

中文基调:

- 精准: 说明规则、状态、失败原因和下一步，不使用模糊承诺。
- 协作: 明确 AI Agent、Fabric Ledger、Human Developer 的边界与交接点。
- 透明: 展示可审计证据，例如 CLI 输出、ledger entry、metadata revision。

英文基调:

- 精准：点名 rule、state、failure reason 与 next action，不做模糊承诺。
- 协作：把 AI Agent、Fabric Ledger、Human Developer 的职责写清楚。
- 透明：展示可审计证据，例如 CLI output、ledger entries、metadata revisions。
