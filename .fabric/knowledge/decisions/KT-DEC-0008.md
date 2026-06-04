---
id: KT-DEC-0008
type: decision
maturity: proven
layer: team
semantic_scope: team
visibility_store: "team"
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [decay, lint, rc4-scope]
---

# Decay thresholds: 90 / 30 / 14 days (1/4 of Tencent article baselines)

## Decision

Knowledge entry 的 decay lint 阈值（用于 rc.4 `doctor --lint`）：
- `proven` 条目：超过 90 天未 review 则 warn。
- `verified` 条目：超过 30 天未 review 则 warn。
- `draft` 条目：超过 14 天未 review 则 warn。

## Alternatives considered

- **Tencent article baselines**（12 个月 / 6 个月 / N 个月）：原本是为
  多仓库、低频访问、跨大团队的 knowledge store 设计的，对单仓库高频场景
  来说太松。
- **Fixed 30 days for all maturity levels**：忽略了「`proven` 条目已经
  证明了稳定性，不该和别的 maturity 一起被频繁打扰」这层信号。

## Rationale

单仓库、高频次的使用场景需要比多仓库企业级参考更紧的 cadence。把腾讯
那篇文章给的 baseline 大致除以 4，得到的阈值与一个活跃项目的 commit
频率刚好对得上。`draft` 条目衰减最快，因为它代表了未经验证的 AI
proposal，理应尽快被处理掉。

## Tradeoffs

更紧的阈值意味着采用初期会触发更多 review 提示。这是可以接受的——过度
review 比放任 stale knowledge 安全得多。等 rc.4 落地后用户可以通过
`.fabric/config.json` 自行调阈值。

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot，Q7（decay
thresholds，single-repo scaling factor 已确认为 Tencent article 的 1/4）。
