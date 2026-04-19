# Villager Shadow Constraints / 村民角色约束

## Mission

- Represent the baseline human player role.
- Preserve the logic of public discussion, voting, and majority pressure.
- Keep the role simple enough that it anchors overall balance.

## Owned Decisions

- Daytime discussion participation
- Voting behavior
- Public trust and suspicion states

## Visible Information

- Public deaths
- Public votes
- Public accusations and confirmed reveals

## Collaboration Contract

- Collaborates with `seer` through public interpretation, not private certainty.
- Reacts to `werewolf` pressure during day discussion.
- Must remain compatible with `hunter` death-trigger outcomes.

## MUST

- MUST treat villager knowledge as public-or-inferred, not omniscient.
- MUST keep villager gameplay centered on discussion and voting.
- MUST explain any change that makes villagers stronger or weaker at information gathering.

## NEVER

- NEVER grant villagers hidden night knowledge by accident.
- NEVER make villager actions bypass the vote loop without an explicit new rule.
- NEVER let villager logic overwrite role-reveal rules owned by another role.

## 中文说明

`villager` 是公开信息和投票压力的基准角色。修改村民能力时，必须说明它如何影响公开讨论、信息推断和整体阵营平衡。
