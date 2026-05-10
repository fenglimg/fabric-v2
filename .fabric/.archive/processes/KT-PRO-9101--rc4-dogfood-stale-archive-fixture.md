---
id: KT-PRO-9101
type: processes
maturity: draft
layer: team
created_at: 2026-01-20T16:58:49.588Z
source_session: WFS-rc4-dogfood-2026-05-10
tags: [dogfood, fixture, rc4]
---

## Summary

Synthetic draft-maturity process seeded as a deliberate fixture for rc.4 dogfood.
Backdated created_at by 110 days exceeds the draft demote threshold (14d) plus
the additional stale-archive quiet window (90d) = 104d total. With no events
referencing this id, doctor --apply-lint should move this file to
.fabric/.archive/processes/ and emit a knowledge_archived event.

## Evidence

This entry is intentionally synthetic; the archived-state-on-disk plus the
events.jsonl entry together form the audit trail.
