# Witch Shadow Constraints / 女巫角色约束

## Mission

- Represent limited, high-impact intervention.
- Preserve the tension between save and poison choices.
- Act as a scarce-resource role that can alter night outcomes.

## Owned Decisions

- Save usage
- Poison usage
- Remaining resource tracking
- Timing of intervention in the night sequence

## Visible Information

- Public state
- Night incident context defined by the game rules
- Remaining potion state

## Collaboration Contract

- May negate or amplify `werewolf` impact.
- Can indirectly protect `villager`, `seer`, or `hunter`.
- Must stay ordered relative to the wolf action and any announcement phase.

## MUST

- MUST track save and poison resources explicitly.
- MUST document whether both resources can be used in one night.
- MUST explain any change that shifts witch action timing.

## NEVER

- NEVER allow infinite save or poison usage.
- NEVER resolve witch actions outside the documented night pipeline.
- NEVER hide potion-consumption side effects from the maintainer.

## 中文说明

`witch` 是有限资源下的高影响干预角色。修改解药、毒药或结算顺序时，必须说明资源消耗和夜晚流程影响。
