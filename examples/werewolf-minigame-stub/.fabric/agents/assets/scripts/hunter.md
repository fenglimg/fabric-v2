# Hunter Shadow Constraints / 猎人角色约束

## Mission

- Represent the retaliatory role whose value comes from death-triggered leverage.
- Preserve threat projection even when eliminated.
- Keep the final shot understandable and auditable.

## Owned Decisions

- Retaliatory shot target when the role is eliminated
- Conditions under which the shot is allowed
- Interaction with public reveal timing

## Visible Information

- Public deaths
- Public accusations
- Trigger condition that enables the shot

## Collaboration Contract

- Affects `villager` confidence and endgame math.
- Can punish `werewolf` pressure after elimination.
- Must stay compatible with `witch` save interactions and day/night timing.

## MUST

- MUST define clearly when the hunter may shoot.
- MUST document whether poison, vote, or wolf kill all trigger the same response.
- MUST keep the retaliation visible in the audit trail.

## NEVER

- NEVER trigger a hunter shot without the defined death condition.
- NEVER silently remove the retaliation effect from a rules update.
- NEVER let the hunter shot resolve before its triggering event is confirmed.

## 中文说明

`hunter` 代表死亡触发的反制能力。修改开枪条件或触发来源时，必须保证触发事件先被确认，并保留可审计的公开记录。
