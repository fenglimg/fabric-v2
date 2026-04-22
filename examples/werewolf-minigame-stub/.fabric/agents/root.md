# Root Shadow Constraints / 根级 Shadow Constraints

## Repository Identity

- Project type: Cocos Creator 3.8 TypeScript component stub
- Fixture purpose: minimal example for Fabric multi-agent collaboration
- Primary maintainer persona: repository maintainer / AI enablement owner
- Runtime language for humans: zh-CN first-class
- Protected token layer for AI: English hard rules only
- Package scope convention: `@fenglimg/fabric-*`

## Scope Map

- Bootstrap contract:
  - `AGENTS.md`
- Shadow constraint root:
  - `.fabric/agents/root.md`
- Mirrored role constraints:
  - `.fabric/agents/assets/scripts/villager.md`
  - `.fabric/agents/assets/scripts/werewolf.md`
  - `.fabric/agents/assets/scripts/seer.md`
  - `.fabric/agents/assets/scripts/witch.md`
  - `.fabric/agents/assets/scripts/hunter.md`
- Cross-cutting constraints:
  - `.fabric/agents/_cross/role-balance.md`
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
- MUST keep `.fabric/agents.meta.json` synchronized with `.fabric/agents/` when repository rules change.

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
- If the explanation layer conflicts with the hard-rule layer, the hard-rule layer wins until a maintainer edits the shadow constraints.
- If code and the shadow constraints disagree, stop and ask a human before continuing.

## Collaboration Model

This fixture encodes five semantic agents rather than five source-code modules.
The purpose is to demonstrate how Fabric can preserve role boundaries,
decision ownership, and communication protocols inside a small multi-agent game.

Each mirrored role file defines:

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

## Cross-Agent Safety Rules

- Any role-balance edit requires human review.
- Any change to resolution order requires a written explanation.
- Any change to private-information flow requires a maintainer sign-off.
- If a role definition becomes ambiguous, prefer pausing over guessing.
- Detailed cross-cutting balance rules live in `.fabric/agents/_cross/role-balance.md`.

## Drift Expectations

- If `.fabric/agents/` changes, run `fab sync-meta`.
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

这些 shadow constraints 的目标不是增加摩擦。
它的目标是让 Claude Code、Cursor、Codex、Windsurf、Roo、Gemini
这些客户端在同一个仓库里，对“谁负责什么、谁不能越界、为什么”
形成一致理解。
