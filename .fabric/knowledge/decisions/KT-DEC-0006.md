---
id: KT-DEC-0006
type: decision
maturity: proven
layer: team
semantic_scope: team
visibility_store: "team"
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [ux-design, review-skill]
---

# Review mode inferred from context, not solicited via AskUserQuestion

## Decision

Review skill 通过观察调用上下文（最近的 events、用户消息内容、pending
条目数量、距离上次 review 的时间）来推断当前应该进入哪种 review mode
（pending / topic / health / revisit），而不是通过 `AskUserQuestion`
让用户选 mode。

## Alternatives considered

- **Explicit mode selection via AskUserQuestion**：每次进 review 都弹一个
  菜单让用户选择。否决——`AskUserQuestion` 应当留给那些必须由用户拍板的
  真实决策（例如「是否 approve 这条 entry？」）；mode 选择本身可以从
  context 推断出来，每次都弹菜单只会徒增摩擦。
- **Separate skill commands per mode**：拆成 `fabric review-pending`、
  `fabric review-topic` 等独立命令。否决——入口太多，而 mode 之间的边界在
  实际使用中本来就模糊。

## Rationale

`AskUserQuestion` 应该被严格保留给「agent 在没有用户输入时确实无法决定
正确动作」的场景。Review mode 完全可以从可观察的 context 推断出来；
让 skill 安静地自行判断既能减少摩擦，也能让 review 在 agent 流程里被
inline 地调用而不打断节奏。

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot，Q7（review skill
设计，mode inference 优于显式选择已确认）。
