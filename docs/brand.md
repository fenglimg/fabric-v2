# Fabric Brand

This document defines the minimum v1.0 brand system for public package pages, repository documentation, README embeds, and lightweight product surfaces.

## 命名三形式

| Form | Use | Rule |
|---|---|---|
| `fab` | CLI binary and command examples | Use lowercase monospace when referring to executable commands, subcommands, or terminal output. |
| `Fabric` | Product name | Use title case in prose, docs, release notes, and package descriptions. |
| `fabric` | UI wordmark | Use lowercase only for the visual wordmark, sidebar brand label, and logo-adjacent lockups. |

Do not use `FABRIC` as a product name unless it is an environment variable prefix or shell constant.

## 色板

Source: `packages/dashboard/src/styles/tokens.css`.

| Token | Hex | Usage |
|---|---:|---|
| `--color-surface-canvas` | `#0b1016` | Primary dark canvas for product surfaces and screenshots. |
| `--color-surface-panel` | `#0f172a` | Sidebar and panel base. |
| `--color-text-primary` | `#f8fafc` | Primary text on dark surfaces and avatar lettermark. |
| `--color-text-muted` | `#94a3b8` | Secondary metadata, captions, and subdued UI labels. |
| `--color-source-ai-accent` | `#6366f1` | AI-side accent and v1.0 avatar background. |
| `--color-source-human-accent` | `#14b8a6` | Human-side accent and collaboration contrast color. |
| `--color-action-primary` | `#22c55e` | Primary action and successful activation state. |
| `--color-state-locked-accent` | `#f59e0b` | Protected or human-locked state accent. |

The wordmark SVG uses `currentColor` so hosts can set text color for light or dark backgrounds without editing the asset.

## 字体栈

CLI and protocol surfaces use the monospace stack from `--font-family-mono`:

```text
"Space Mono", "JetBrains Mono", "SF Mono", "Monaco", "Consolas", ui-monospace, monospace
```

Dashboard and long-form UI copy use the sans stack from `--font-family-sans`:

```text
"Inter", -apple-system, "Segoe UI", system-ui, sans-serif
```

Use monospace for commands, ledger fields, protocol keys, and compact product marks. Use sans for explanatory UI labels, tables, and documentation prose.

## Tone-of-voice

中文基调:

- 精准: 说明规则、状态、失败原因和下一步，不使用模糊承诺。
- 协作: 明确 AI Agent、Fabric Ledger、Human Developer 的边界与交接点。
- 透明: 展示可审计证据，例如 CLI 输出、ledger entry、metadata revision。

English tone:

- Precise: name the rule, state, failure reason, and next action without vague promises.
- Collaborative: make the AI Agent, Fabric Ledger, and Human Developer responsibilities explicit.
- Transparent: expose auditable evidence such as CLI output, ledger entries, and metadata revisions.
