# Lite Plan Context

**Session**: wpp-20260422-init向导重构
**Requirement**: 基于 brainstorm handoff spec，重写 `fabric init` 为安装向导，优化 CLI 安装流程
**Source**: `.workflow/.brainstorm/BS-2026-04-22-cli安装流程优化/handoff-spec.json`

## Goal

将当前 `fabric init` 从线性 one-shot 安装器升级为完整 guided installer，并保留 `--yes` 等非交互变体。

## Scope Items

1. 重构 init 为 install state machine
2. 为 init 增加交互式 prompt 层
3. 重写 init 参数与帮助文案
4. 更新文档与测试体系

## Existing Constraints

- 当前 CLI 入口基于 `citty`
- 当前 `init` 已承载主 onboarding 心智
- 当前安装底层函数已经存在，可优先复用
- 本轮允许 breaking change，不以兼容性为第一优先级

## Explore Focus

- E1: install plan / state machine
- E2: prompt stack and UI shell
- E3: command surface redesign
- E4: docs and tests blast radius
