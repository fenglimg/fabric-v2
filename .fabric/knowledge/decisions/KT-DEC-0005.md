---
id: KT-DEC-0005
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [schema-design, frontmatter]
---

# 5-type / 3-maturity / 2-layer schema with flat scalar frontmatter

## Decision

Frontmatter 限定为扁平 scalar 与 flow-style 数组，禁止嵌套 YAML 对象。
schema 为：

- 5 种 knowledge type：`model`、`decision`、`guideline`、`pitfall`、`process`。
- 3 个 maturity 级别：`draft`、`verified`、`proven`。
- 2 个 layer：`personal`、`team`。

必填字段：`id`、`type`、`layer`、`maturity`、`layer_reason`、`created_at`。
可选字段：`tags`（flow-style 数组）。

## Alternatives considered

- **Nested YAML objects**（例如 `meta: { reviewer: alice, session: S01 }`）：
  否决——`rule-meta-builder.ts` 里的手写 regex parser 只支持 flat scalar
  与 flow-style 数组。引入嵌套对象意味着必须接入完整的 YAML 库，体积和
  parse-error 面都会随之膨胀。
- **7+ types**：曾考虑把 `guideline` 拆成 `recommend` 与 `avoid`。否决——
  单一 `guideline` type 加上 body 层面的写作约定已经够用；对一个 5-type
  taxonomy 来说，MECE 比颗粒度更值得守。

## Rationale

Flat scalar 是现有 parser 在不引入额外库依赖的前提下能承受的最大复杂度。
5-type / 3-maturity / 2-layer 的组合本身就是 MECE，足以覆盖一个软件项目
里所有预期会出现的 knowledge 形态。

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot，Q6（schema
forward-compat：增加 `tags`，冻结 nested-object 的扩张空间）。
