# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| theme.ts | 渲染真源:7 语义角色色板 + paint + symbol,纯字符串无 Ink | `packages/shared/src/theme.ts` | locked |
| 鲜明多色 | 7 语义角色 truecolor(success/warn/error/drift/ai/human/accent),禁渐变/bg | `theme.ts:PALETTE` | locked |
| 退 Ink | 删 ink+react,仅 install wizard(install-v2→tui/*.tsx ×10)重写为 @clack | `tui/*.tsx` + `InkOutputRenderer.ts` | locked |
| 焕然一新 | 全面 theme 皮肤,差异化靠结构(tree/grid/badge)非色彩;独立于退 Ink | `grill-report.md#Q1.2,Q2.1` | locked |
| HUD 共享层 | CLI `context` ⊥ SessionStart hook byte-identical 渲染,保 parity-trivial 复杂度 | `theme.ts` ↔ `lib/theme.cjs` + parity test | locked |
| 结构基元分层 | HUD-shared(theme+cjs+parity)/ CLI-only(复杂 tree/grid) | `grill-report.md#Q2.2` | locked |
| paint(token,text) | 按语义 token 上色,colorOn=false 裸返(byte 契约) | `theme.ts:55` | locked |
| isColorEnabled | NO_COLOR/FORCE_COLOR/isTTY 二档开关,无 256/16 降级 | `theme.ts:45` | locked |
| colors.ts | 老色彩系统(picocolors,14 消费者)—— 待并入 theme.ts 后删除 | `packages/cli/src/colors.ts` | locked(待删) |
| @clack 包上下文 | 仅 theme 化 intro/outro/log/error,prompt 控件保 @clack 默认 | `grill-report.md#Q4.2` | locked |
| ASCII fallback | 结构字符(tree/box/badge)在 NO_COLOR/非TTY/窄终端降纯 ASCII | `theme.ts:symbol` 模式扩展 | locked |
