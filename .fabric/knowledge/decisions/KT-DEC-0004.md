---
id: KT-DEC-0004
type: decision
maturity: proven
layer: team
semantic_scope: team
visibility_store: "team"
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [identity, stable-id, counters]
---

# stable_id format K[PT]-(DEC|MOD|GLD|PIT|PRO)-NNNN with monotonic counter

## Decision

Knowledge entry 的身份编码为 `K[PT]-(DEC|MOD|GLD|PIT|PRO)-NNNN`，其中：
- `K` = Fabric knowledge 前缀（常量）。
- `P|T` = scope：personal（`~/.fabric`）或 team（`<repo>/.fabric`）。
- type code：`DEC`=decision、`MOD`=model、`GLD`=guideline、`PIT`=pitfall、
  `PRO`=process。
- `NNNN` = monotonic counter（4+ 位、零填充、永不复用）。

Counters 持久化在 `agents.meta.json.counters.{KP|KT}.{type-code}`。

## Alternatives considered

- **Path-derived ID**：用文件路径推导 ID（例如 `decisions/my-file`）。
  否决：任何一次 rename 都会破坏身份——这恰恰违背了 stable_id 的初衷。
- **UUID**：每条随机 UUID。否决：在 git diff 里完全不可读，没有隐式
  排序，也不携带 type / layer 信号。

## Rationale

Path-decoupled identity 让条目可以在目录之间自由迁移（甚至通过 layer
flip 在 personal 与 team root 之间互换），而 stable_id 保持不变。
Monotonic counter 保证了历史唯一性：删除一条不会释放它的 counter slot，
ID 永远不会被回收。

## Constraints

- Counter 永不递减。
- Layer flip（`KP` <-> `KT`）是对 id prefix 唯一合法的修改方式。
- Type code 在创建之后不可变。

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot，Q7（stable_id
path-decoupled 设计已确认）。
