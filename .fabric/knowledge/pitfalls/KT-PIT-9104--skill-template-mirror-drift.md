---
id: KT-PIT-9104
type: pitfalls
maturity: verified
layer: team
created_at: 2026-05-14T02:58:24.934Z
source_sessions: ["WFS-2026-05-14-fabric-skills-contract-fix"]
proposed_reason: wrong-turn-revert
tags: []
---

## Summary

fabric skill 体系三镜像（templates/.claude/.codex）只在 fab init/reapply 时通过 SKILL_DESTINATIONS 复制同步，没有 prebuild/derivation 脚本。开发者手动编辑 template 时若忘记 propagate，.claude/.codex 漂移会无声累积。本次任务发现 fabric-import/archive/review 三个 skill 的 .claude/.codex 已经持有 rc.3-era 残留达 311 行，跟 template 严重脱节。install-skills-and-hooks.test.ts 是兜底（init 时检测 byte-identity），但平时编辑 template 没人触发。

## Why proposed

wrong-turn-revert — 尝试某路径后回退，错误路径本身是值得记录的 pitfall。

## Session context

Session goal: 三 skill SKILL.md 修改（scope rename / config load / i18n / protected tokens / narrowing-imported / proposed_reason / state.json atomic）。
Turning point: TASK-002 实施时发现 .claude 和 .codex 镜像与 templates 漂移 311 行，要么先做 catch-up 要么 byte-identity 校验过不去；后续每个 SKILL.md task 都顺手 mirror。
Result: 三镜像同步策略 = "总是 overwrite"，且 fab init/reapply 是唯一 propagate 时点。
Implication: 编辑 packages/cli/templates/skills/**/*.md 时必须立即 cp 到 .claude/skills 和 .codex/skills，不依赖 fab init 兜底；CI 应增加 pre-commit hook 校验三镜像 byte-identity，避免漂移累积。

## Evidence

Recent paths:

- packages/cli/templates/skills/fabric-import/SKILL.md
- packages/cli/templates/skills/fabric-archive/SKILL.md
- packages/cli/templates/skills/fabric-review/SKILL.md
- .claude/skills/fabric-import/SKILL.md
- .claude/skills/fabric-archive/SKILL.md
- .claude/skills/fabric-review/SKILL.md
- .codex/skills/fabric-import/SKILL.md
- .codex/skills/fabric-archive/SKILL.md
- .codex/skills/fabric-review/SKILL.md
- packages/cli/src/install/skills-and-hooks.ts
- packages/cli/__tests__/integration/install-skills-and-hooks.test.ts

Notes:

- fabric skill 体系三镜像（templates/.claude/.codex）只在 fab init/reapply 时通过 SKILL_DESTINATIONS 复制同步，没有 prebuild/derivation 脚本。开发者手动编辑 template 时若忘记 propagate，.claude/.codex 漂移会无声累积。本次任务发现 fabric-import/archive/review 三个 skill 的 .claude/.codex 已经持有 rc.3-era 残留达 311 行，跟 template 严重脱节。install-skills-and-hooks.test.ts 是兜底（init 时检测 byte-identity），但平时编辑 template 没人触发。
