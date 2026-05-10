---
id: KT-DEC-0008
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [decay, lint, rc4-scope]
---

# Decay thresholds: 90 / 30 / 14 days (1/4 of Tencent article baselines)

## Decision

Knowledge entry decay lint thresholds (for rc.4 `doctor --lint`):
- `proven` entries: warn after 90 days without review.
- `verified` entries: warn after 30 days without review.
- `draft` entries: warn after 14 days without review.

## Alternatives considered

- **Tencent article baselines** (12 months / 6 months / N months):
  Designed for multi-repo, low-frequency knowledge stores accessed
  across large teams. Too lenient for a single-repo high-frequency environment.
- **Fixed 30 days for all maturity levels**:
  Ignores the signal that `proven` entries have demonstrated stability
  and should not generate noisy warnings as frequently.

## Rationale

Single-repo, high-frequency use demands tighter cadence than multi-repo
enterprise references. Dividing the Tencent baselines by approximately 4
gives thresholds that match the expected commit frequency of an active project.
`draft` entries decay fastest because they represent unvalidated AI proposals
that should be resolved promptly.

## Tradeoffs

Tighter thresholds may generate more review prompts in the first weeks of
adoption. This is acceptable — over-reviewing is safer than neglecting stale
knowledge. Users can tune thresholds via `.fabric/config.json` once rc.4 ships.

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot, Q7 (decay thresholds,
single-repo scaling factor confirmed as 1/4 of Tencent article).
