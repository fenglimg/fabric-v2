---
id: KT-DEC-9001
type: decisions
maturity: draft
layer: team
created_at: 2026-05-10T15:28:03.164Z
source_session: WFS-rc3-dogfood-2026-05-10
tags: [dogfood, fallback]
---

## Summary

Synthetic decision file created via direct filesystem write (no fab_review approve)
to exercise rc.3 doctor's filesystem-edit fallback. Doctor should detect this
orphan and synthesize a knowledge_promoted event with reason
'[synthesized] filesystem-edit-fallback'. A second doctor run should be a no-op.

## Evidence

This entry is intentionally synthetic and may be removed by future cleanup.
