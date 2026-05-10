---
id: KT-PIT-9101
type: pitfalls
maturity: endorsed
layer: team
created_at: 2026-01-30T16:58:49.587Z
source_session: WFS-rc4-dogfood-2026-05-10
tags: [dogfood, fixture, rc4]
---

## Summary

Synthetic stable-maturity pitfall seeded as a deliberate fixture for rc.4 dogfood.
Backdated created_at by 100 days exceeds the 90-day stable-tier inactivity
threshold; with no recent events referencing this id, doctor --apply-lint
should demote stable -> endorsed and emit a knowledge_demoted event.

## Evidence

This entry is intentionally synthetic and will NOT be cleaned up post-dogfood;
the demoted-state-on-disk plus the events.jsonl entry together form the audit
trail per rc.2/rc.3 dogfood precedent.
