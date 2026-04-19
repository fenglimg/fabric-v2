# Role Balance Cross-Cutting Constraints / 角色平衡跨域约束

## Scope

- scope_glob: `**`
- topology_type: `cross-cutting`
- Applies to role distribution, resolution order, private-information flow, and human-locked balance blocks.

## Cross-Agent Safety Rules

- Any role-balance edit requires human review.
- Any change to resolution order requires a written explanation.
- Any change to private-information flow requires a maintainer sign-off.
- If a role definition becomes ambiguous, prefer pausing over guessing.

## Human Review Gates

- Role count changes
- Win-condition changes
- Hidden-information changes
- New abilities that alter resolution order
- Any edit to a human-locked balance block

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

## MUST

- MUST stop before editing any human-locked role-balance range.
- MUST explain how balance changes affect both werewolf-side and village-side play.
- MUST preserve the declared night resolution order unless the maintainer approves the change.
- MUST document whether a change affects public information, private information, or victory conditions.

## NEVER

- NEVER silently change role counts, win conditions, hidden information, or resolution order.
- NEVER treat role-balance config as routine implementation detail.
- NEVER bypass maintainer sign-off for private-information flow changes.

## 中文说明

这个文件承载跨角色的 shadow constraints。凡是会影响阵营强弱、夜晚结算顺序、私有信息流或 `@HUMAN` 锁定区块的改动，都应先解释影响并请求维护者确认。
