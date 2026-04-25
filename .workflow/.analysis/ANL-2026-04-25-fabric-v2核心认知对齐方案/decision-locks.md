# Decision Locks

**Session**: ANL-2026-04-25-fabric-v2核心认知对齐方案  
**Date**: 2026-04-25  
**Status**: User-confirmed design locks before TDD planning.

## Locked Decisions

1. **Rule content directory**
   - New rule bodies use `.fabric/rules/`.
   - No forced compatibility with `.fabric/agents/` is required for this refactor because the product has no external users yet.

2. **Description identity**
   - Keep the existing `stable_id` identity model.
   - Do not introduce or migrate to `Description.id`.
   - `RuleDescription` is matching metadata only; it must not define its own identity field.

3. **L1 candidate pool**
   - L1 rules may enter the global candidate pool.
   - L1 rules must be selected through ranking before they can influence rule section injection.

4. **Requirement Profile**
   - Needs explicit implementation design before coding.
   - Expected design is documented in `requirement-profile-design.md`.

5. **Section API**
   - Add a new `fab_get_rule_sections` tool.
   - The old `fab_get_rules` can be discarded instead of preserved.

6. **Initial taxonomy artifact**
   - `.fabric/INITIAL_TAXONOMY.md` is Markdown-only for now.
   - No machine-readable JSON sidecar in the first implementation.

7. **L0 migration**
   - L0 can migrate directly into the new rule/content model.
   - No need to keep `.fabric/bootstrap/README.md` as a permanent special case.

8. **Priority and precedence**
   - `priority` only sorts rules within the same layer.
   - Cross-layer precedence is fixed: `L2 > L1 > L0`.

## Consequence

The TDD plan can be simpler than the previous compatibility-oriented proposal:

- Remove legacy-preservation work from the critical path.
- Define a fresh registry-first schema centered on `.fabric/rules/`.
- Replace `fab_get_rules` with `fab_get_rule_sections` instead of maintaining both.
- Treat L0/L1/L2 as explicit semantic levels, never as path-depth derivations.
