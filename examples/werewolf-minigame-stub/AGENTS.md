# werewolf-minigame-stub / Fabric v1.0

> 人机协作的语义共识平面 / The Consensus Plane for AI-Human Collaboration
>
> Product naming: `fab` command / `Fabric` product / `fabric` UI wordmark
>
> Planes: CLI = control plane / MCP = runtime dispatch / Dashboard = observability plane (v1.1)

## Repository Identity

- Project type: Cocos Creator 3.8 TypeScript component stub
- Fixture purpose: minimal example for Fabric multi-agent collaboration
- Primary maintainer persona: repository maintainer / AI enablement owner
- Runtime language for humans: zh-CN first-class
- Protected token layer for AI: English hard rules only
- Package scope convention: `@fenglimg/fabric-*`

## Scope Map

- Root contract:
  - `AGENTS.md`
- Fixture project files:
  - `project.config.json`
  - `package.json`
  - `tsconfig.json`
- Protected surfaces:
  - `assets/prefabs/**`
  - `assets/scenes/**`
  - `**/*.meta`
- Semantic roster:
  - villager
  - werewolf
  - seer
  - witch
  - hunter

## Hard Rules

### MUST

- MUST call `fab_get_rules(path=<file>)` before editing any file when MCP is available.
- MUST preserve the repository identity as a Cocos Creator 3.8 TypeScript stub.
- MUST keep gameplay explanations concrete to the werewolf domain.
- MUST treat `.meta` files as immutable.
- MUST treat `assets/prefabs/**` and `assets/scenes/**` as protected surfaces.
- MUST keep changes small, reviewable, and easy to revert.
- MUST explain gameplay impact before changing role distribution, night resolution, public information, or win condition rules.
- MUST keep Chinese explanation layers readable for maintainers while preserving English hard-rule tokens for AI clients.
- MUST stop and ask for human approval before editing any human-locked range.
- MUST update `.fabric/agents.meta.json` together with `AGENTS.md` when repository rules change.

### NEVER

- NEVER rewrite a `@HUMAN`-locked range without explicit maintainer approval.
- NEVER flatten werewolf-specific roles into anonymous `entity`, `unit`, or `actor` placeholders.
- NEVER move role semantics into transport-only language that hides day/night meaning.
- NEVER edit any `**/*.meta` file.
- NEVER silently change the meaning of `night`, `day`, `seer-check`, `wolf-kill`, `witch-save`, or `hunter-shot`.
- NEVER claim a role owns a decision that belongs to another role.
- NEVER use vague summaries when a concrete role name would be more accurate.

## Working Contract

- Human-readable explanations may be Chinese.
- Protected constraint lines stay in English.
- If the explanation layer conflicts with the hard-rule layer, the hard-rule layer wins until a maintainer edits this file.
- If code and this file disagree, stop and ask a human before continuing.

## Collaboration Model

This fixture encodes five semantic agents rather than five source-code modules.
The purpose is to demonstrate how Fabric can preserve role boundaries,
decision ownership, and communication protocols inside a small multi-agent game.

Each agent section below defines:

- mission
- owned decisions
- visible information
- communication expectations
- forbidden actions

## Shared Match Contract

- The match alternates between `night` and `day`.
- Public state changes must remain traceable.
- Private role information must not be leaked without an explicit rule.
- Elimination order matters and must remain explainable.
- Any new feature must state whether it changes balance, information flow, or victory conditions.

## Communication Protocol

### Global Protocol

- All roles may read public state updates.
- Private role actions resolve during `night` unless a rule states otherwise.
- Discussion outcomes resolve during `day`.
- If two role actions conflict, the maintainer must choose the precedence explicitly.
- If an agent proposes a balance change, it must explain the impact on both sides.

### Resolution Order

1. Werewolf proposes a night elimination target.
2. Seer performs a role inspection.
3. Witch may save or poison according to remaining resources.
4. Day discussion publishes deaths and public clues.
5. Hunter may trigger a retaliatory shot if the role is eliminated.

### Human Review Triggers

- Role count changes
- Win-condition changes
- Hidden-information changes
- New abilities that alter resolution order
- Any edit to a human-locked balance block

## Agent: Villager

### Mission

- Represent the baseline human player role.
- Preserve the logic of public discussion, voting, and majority pressure.
- Keep the role simple enough that it anchors overall balance.

### Owned Decisions

- Daytime discussion participation
- Voting behavior
- Public trust and suspicion states

### Visible Information

- Public deaths
- Public votes
- Public accusations and confirmed reveals

### Collaboration Contract

- Collaborates with `seer` through public interpretation, not private certainty.
- Reacts to `werewolf` pressure during day discussion.
- Must remain compatible with `hunter` death-trigger outcomes.

### MUST

- MUST treat villager knowledge as public-or-inferred, not omniscient.
- MUST keep villager gameplay centered on discussion and voting.
- MUST explain any change that makes villagers stronger or weaker at information gathering.

### NEVER

- NEVER grant villagers hidden night knowledge by accident.
- NEVER make villager actions bypass the vote loop without an explicit new rule.
- NEVER let villager logic overwrite role-reveal rules owned by another role.

## Agent: Werewolf

### Mission

- Represent the adversarial night role with coordinated elimination power.
- Preserve deception, coalition pressure, and hidden identity.
- Act as a source of nightly threat without replacing the whole game model.

### Owned Decisions

- Night elimination target selection
- Wolf-side hidden coordination state
- Pressure strategy against public discussion

### Visible Information

- Wolf team membership
- Chosen elimination target
- Public day outcomes after resolution

### Collaboration Contract

- Interacts with `villager` through deception and vote shaping.
- Competes with `seer` over information asymmetry.
- Can be countered by `witch` saves or poison actions.

### MUST

- MUST preserve werewolf identity as hidden adversarial knowledge.
- MUST keep wolf actions tied to the night phase unless a new mechanic is documented.
- MUST explain balance impact before changing kill timing or target rules.

### NEVER

- NEVER reveal wolf identity to all roles without a rule change approved by a maintainer.
- NEVER collapse werewolf logic into a generic hostile-state flag.
- NEVER let wolf actions bypass the shared night resolution order silently.

## Agent: Seer

### Mission

- Represent controlled information advantage.
- Reveal one role alignment or role identity signal per allowed inspection.
- Create strategic tension between certainty and public trust.

### Owned Decisions

- Night inspection choice
- Inspection result representation
- How inspected knowledge becomes public, if at all

### Visible Information

- Public state
- Private inspection result
- Previously revealed claims

### Collaboration Contract

- Works against `werewolf` secrecy.
- Informs `villager` strategy only through explainable outputs.
- Can influence `hunter` or `witch` decisions indirectly through public claims.

### MUST

- MUST keep seer information private until disclosed by a documented rule.
- MUST make inspection outputs deterministic and reviewable.
- MUST explain whether the seer sees full role identity or only alignment.

### NEVER

- NEVER let the seer inspect more than the declared rule allows.
- NEVER leak inspection results into global public state by default.
- NEVER blur the difference between `seer-check` and rumor or guesswork.

## Agent: Witch

### Mission

- Represent limited, high-impact intervention.
- Preserve the tension between save and poison choices.
- Act as a scarce-resource role that can alter night outcomes.

### Owned Decisions

- Save usage
- Poison usage
- Remaining resource tracking
- Timing of intervention in the night sequence

### Visible Information

- Public state
- Night incident context defined by the game rules
- Remaining potion state

### Collaboration Contract

- May negate or amplify `werewolf` impact.
- Can indirectly protect `villager`, `seer`, or `hunter`.
- Must stay ordered relative to the wolf action and any announcement phase.

### MUST

- MUST track save and poison resources explicitly.
- MUST document whether both resources can be used in one night.
- MUST explain any change that shifts witch action timing.

### NEVER

- NEVER allow infinite save or poison usage.
- NEVER resolve witch actions outside the documented night pipeline.
- NEVER hide potion-consumption side effects from the maintainer.

## Agent: Hunter

### Mission

- Represent the retaliatory role whose value comes from death-triggered leverage.
- Preserve threat projection even when eliminated.
- Keep the final shot understandable and auditable.

### Owned Decisions

- Retaliatory shot target when the role is eliminated
- Conditions under which the shot is allowed
- Interaction with public reveal timing

### Visible Information

- Public deaths
- Public accusations
- Trigger condition that enables the shot

### Collaboration Contract

- Affects `villager` confidence and endgame math.
- Can punish `werewolf` pressure after elimination.
- Must stay compatible with `witch` save interactions and day/night timing.

### MUST

- MUST define clearly when the hunter may shoot.
- MUST document whether poison, vote, or wolf kill all trigger the same response.
- MUST keep the retaliation visible in the audit trail.

### NEVER

- NEVER trigger a hunter shot without the defined death condition.
- NEVER silently remove the retaliation effect from a rules update.
- NEVER let the hunter shot resolve before its triggering event is confirmed.

## Cross-Agent Safety Rules

- Any role-balance edit requires human review.
- Any change to resolution order requires a written explanation.
- Any change to private-information flow requires a maintainer sign-off.
- If a role definition becomes ambiguous, prefer pausing over guessing.

## `@HUMAN` Lock Range Example

```ts
// file: assets/scripts/Game.ts

// @HUMAN START role-balance-config
const ROLE_SETUP = {
  werewolf: 2,
  villager: 4,
  seer: 1,
  witch: 1,
  hunter: 1,
};
// @HUMAN END role-balance-config
```

- The example above shows the kind of block that belongs to a maintainer.
- AI may read it, summarize it, and explain the impact.
- AI must not edit it without explicit approval.

## Drift Expectations

- If `AGENTS.md` changes, run `fab sync-meta`.
- If a human-lock hash changes, stop normal development until the maintainer approves the new hash.
- If MCP is connected, use `fab_append_intent` for larger semantic changes so the ledger remains traceable.

## Review Checklist

- Did the change preserve werewolf-specific role names?
- Did the change avoid `**/*.meta` edits?
- Did the change keep public and private information boundaries clear?
- Did the change preserve the declared night resolution order?
- Did the change explain balance impact?
- Did the change avoid touching human-locked regions?

## Explanation Layer（中文）

这个样例不是为了模拟一整个可上线的狼人杀项目，
而是为了演示 Fabric 如何把“多人协作里的语义边界”写成仓库契约。

这里最重要的不是某个角色有几个字段，
而是不同角色对信息、动作和结算顺序拥有不同权力。

`villager` 代表公开讨论与投票压力。
`werewolf` 代表隐藏身份与夜晚威胁。
`seer` 代表受控的信息优势。
`witch` 代表有限资源下的高影响干预。
`hunter` 代表带有死亡触发的反制能力。

如果未来这个样例继续扩展，
请优先守住四件事：

第一，角色名不要被“通用化重构”抹平。

第二，夜晚结算顺序必须能被人类复述。

第三，私有信息不能在没有规则说明的前提下泄露成公共状态。

第四，凡是维护者锁住的平衡区块，都应高于当前实现任务。

这份文件的目标不是增加摩擦。
它的目标是让 Claude Code、Cursor、Codex、Windsurf、Roo、Gemini
这些客户端在同一个仓库里，对“谁负责什么、谁不能越界、为什么”
形成一致理解。
