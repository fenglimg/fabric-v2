---
type: decisions
maturity: draft
layer: team
created_at: 2026-05-29T13:55:57.021Z
source_sessions: ["9c2ff4f9-95fc-4c42-8251-2b70ebdfb1ff"]
proposed_reason: decision-confirmation
summary: "用户在 v2.1 全局化重构影响面发掘(goal-mode ② session)中,就 g9「~/.fabric 是几个 git 库」在 3 个候选(personal 独立库 / personal 不进库 / 单库.gitignore personal)间权衡后锁定方向:personal 也应该入库,采用单一 git KB 库装所有档(personal/projects/team 同库),personal=uid-scoped 共享适用而非隐私隔离,接受 personal 团队可见的 tradeoff;并要求架构支持后续多团队/组织拓展;目录内容格式参考现项目 5-type(decisions/pitfalls/...)。"
tags: ["v2-architecture", "kb-storage-layout", "scope-tier", "global-refactor"]
relevance_scope: broad
intent_clues: ["when 设计 v2.1 全局 ~/.fabric 存储/scope/install", "when 评估 personal 知识隐私边界", "NOT for v2.0 dual-root 现状代码"]
impact: ["选错存储边界会触及 schema/migration/resolution 引擎大改", "personal 入共享库 = 团队可见, 与 KT-DEC-0003 隐私假设冲突需显式承接"]
must_read_if: "设计或实现 v2.1 全局化 KB 存储模型 / scope 解析 / install 时(决定 ~/.fabric 是单库还是多库)"
x-fabric-idempotency-key: sha256:c4497d496d1430681b2be775531439d7bd83f24487d7152bb07509247bf4b5dd
---

## Summary

用户在 v2.1 全局化重构影响面发掘(goal-mode ② session)中,就 g9「~/.fabric 是几个 git 库」在 3 个候选(personal 独立库 / personal 不进库 / 单库.gitignore personal)间权衡后锁定方向:personal 也应该入库,采用单一 git KB 库装所有档(personal/projects/team 同库),personal=uid-scoped 共享适用而非隐私隔离,接受 personal 团队可见的 tradeoff;并要求架构支持后续多团队/组织拓展;目录内容格式参考现项目 5-type(decisions/pitfalls/...)。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: 在已锁定的全局化架构前提下多轮审计 Fabric v2.1 重构影响面(goal-mode mode② session 20260529-global-refactor-impact, surface S16/S23)。
Turning point: 用户回答 g9 adjudication 时反转了原 northstar 推荐——不走 tier→repo 物理解耦,而是 personal 也入单一 git KB 库,显式接受 personal 对团队可见。
Result: 锁定单库存储模型 + scope-外/type-内目录布局;原物理解耦降级为 config 扩展接口;直接反转 v2.0 KT-DEC-0003 的 personal 永不提交隐私 rationale。

## Evidence

Recent paths:

- .workflow/.maestro/20260529-global-refactor-impact/status.json
- .fabric/knowledge/decisions/KT-DEC-0003.md

Notes:

- 用户在 v2.1 全局化重构影响面发掘(goal-mode ② session)中,就 g9「~/.fabric 是几个 git 库」在 3 个候选(personal 独立库 / personal 不进库 / 单库.gitignore personal)间权衡后锁定方向:personal 也应该入库,采用单一 git KB 库装所有档(personal/projects/team 同库),personal=uid-scoped 共享适用而非隐私隔离,接受 personal 团队可见的 tradeoff;并要求架构支持后续多团队/组织拓展;目录内容格式参考现项目 5-type(decisions/pitfalls/...)。
