---
type: pitfalls
maturity: draft
layer: team
created_at: 2026-05-30T07:40:58.962Z
source_sessions: ["20260530-v22-pool-critique"]
proposed_reason: wrong-turn-revert
summary: "批判 v2.2 候选时, HK4-hygiene 被包标 P0(3 个 hook bug)。codex 冷评 grep 反驳称多数已修, gemini 未验代码直接信包判 absorb。"
tags: ["audit-verification", "grounding", "multi-llm", "hook"]
relevance_scope: broad
impact: ["claimed-P0 bug 实为已修, 不验直接实施 = reimplemented noop 浪费整个 wave", "未读代码的冷评 LLM 会信 audit 包的过期 grounding 误判 absorb"]
must_read_if: "实施任何外部 audit / bug list / 候选包前, 先 grep/读真代码验证 grounding 声明仍成立"
x-fabric-idempotency-key: sha256:8f5a03ab22547d4257645acad5b860e8c1f31fa1d0e7783053adaca7d4b5a19d
---

## Summary

批判 v2.2 候选时, HK4-hygiene 被包标 P0(3 个 hook bug)。codex 冷评 grep 反驳称多数已修, gemini 未验代码直接信包判 absorb。

## Why proposed

wrong-turn-revert — 尝试某路径后回退，错误路径本身是值得记录的 pitfall。

## Session context

HK4-hygiene claimed P0 三个 hook bug: 亲验后全已修 — cite-tag drift→LEGACY_CITE_TAG_REMAP(cite-line-parser.ts:83 recalled→applied); archive-hint "未注册"→实折进 Stop hook fabric-hint.cjs(claude-code.json:9 已注册); broad 多窗去重→broad hook 本设计 "No dedup, 一 session 渲一次"(:8-13)无互抑。gemini 未读 hook 代码误判 absorb-P0, codex grep refute 正确, 我亲验确认 → reject。教训: audit 声明实施前必 grep 验证, 防 reimplemented noop。

## Evidence

Recent paths:

- packages/shared/src/cite-line-parser.ts
- packages/cli/templates/hooks/fabric-hint.cjs
- packages/cli/templates/hooks/knowledge-hint-broad.cjs
- packages/cli/templates/hooks/configs/claude-code.json

Notes:

- 批判 v2.2 候选时, HK4-hygiene 被包标 P0(3 个 hook bug)。codex 冷评 grep 反驳称多数已修, gemini 未验代码直接信包判 absorb。
