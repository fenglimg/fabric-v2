# Brainstorm Session: Fabric CLI Install/Uninstall UX Refactoring

## Session Info
- **Session ID**: brainstorm-fabric-install-ux-ink-tui
- **Created**: 2026-06-06
- **Mode**: Auto (Full Pipeline)
- **Status**: Running

## Topic

Fabric CLI Install/Uninstall UX 重构 + UI 层升级（ink TUI 方案）

## Context Summary

### Current Problems
1. **功能解耦但引导弱** - fabric install 和 fabric store * 命令间缺少智能引导
2. **CLI 输出丑** - console.log/clack/writeStderr 三套体系混用，缺乏视觉锚点
3. **不支持 config 面板** - 需要更强 UI 能力

### Goals (方案 B - ink TUI)
1. **install.ts 重构** - 7 阶段 pipeline（detect-context → global-layer → store-onboarding → project-scaffold → bootstrap → mcp → post-setup）
2. **uninstall.ts 补充** - 新增 store-binding-cleanup 阶段
3. **UI 层升级** - 引入 ink + @inkjs/ui，统一输出层
4. **交互式 wizard** - store-onboarding 阶段智能引导

### Constraints
- 零用户，无需向后兼容
- 全部完成，不留 deferred
- 允许多 Agent 并行工作

## Terminology (Extracted)

| Term | Definition | Category |
|------|------------|----------|
| **ink** | React for CLI - A React-based framework for building CLI apps with declarative components | Technical |
| **TUI** | Terminal User Interface - Interactive terminal applications with widgets and dynamic updates | Technical |
| **Store** | Fabric knowledge store - A git-backed repository for team knowledge (decisions, pitfalls, guidelines) | Core |
| **Store-binding** | Project-to-store association - Links a project to a specific store for knowledge sync | Core |
| **Pipeline Stage** | Atomic execution unit in install/uninstall flow - Each stage has defined scope, actions, and failure mode | Technical |
| **Wizard** | Interactive CLI flow with prompts - Guides users through multi-step configuration | Technical |
| **Visual Anchor** | UI element providing visual structure - Step counters, box separators, section headers | Technical |
| **RFC 2119** | Keywords for requirement levels - MUST, SHOULD, MAY, MUST NOT, SHOULD NOT | Technical |

## Non-Goals

| Non-Goal | Rationale |
|----------|-----------|
| 向后兼容 | 用户明确说零用户，无需考虑兼容性 |
| 渐进式升级方案 A | 用户已选择方案 B（ink TUI），不走渐进式 |
| fabric store * 命令独立优化 | 目标是统一在 install wizard 中，不单独优化 store 命令 |
| 非 CLI GUI（Web/Electron） | 明确是 TUI 方案，不是浏览器或桌面 GUI |

## Session Metadata
```json
{
  "session_id": "brainstorm-fabric-install-ux-ink-tui",
  "created_at": "2026-06-06T04:00:00Z",
  "mode": "auto",
  "selected_roles": [],
  "feature_list": [],
  "review_findings_count": 0,
  "resolutions_applied": 0
}
```
