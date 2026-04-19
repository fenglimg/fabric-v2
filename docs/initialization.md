# Initialization Guide

> Start with the canonical onboarding guide: [Getting Started](./getting-started.md). This document is the deep-dive technical reference for the `fab init` state machine, Claude handoff, and initialization internals.

`fab init` is the first half of initialization, not the whole story. It equips the project with the evidence and protocol that let Claude Code finish a project-specific `AGENTS.md` through the `agents-md-init` skill.

## Overview

`fab init` does three things in one command:

1. Evidence: scans the repo and writes `.fabric/forensic.json`.
2. Protocol install: writes the fallback `AGENTS.md`, `.fabric/agents.meta.json`, `.fabric/human-lock.json`, and Claude integration files under `.claude/`.
3. Trigger: prints a reason line for same-session handoff and installs a Stop hook for cross-session handoff.

That split is intentional: Fabric keeps the CLI step fast and deterministic, then lets the AI client finish the semantic initialization.

## Prerequisites

- Install the CLI once:

  ```bash
  npm install -g @fenglimg/fabric-cli
  ```

- Run `fab init` from the target project root.
- Start from a clean project state for initialization:
  - `AGENTS.md` must not already exist.
  - `.fabric/` must not already exist.
- Claude Code is required for the full Stage 3 to Stage 6 flow.
- The running example below uses `werewolf-minigame`, a Cocos Creator 3.8 TypeScript project.

## 7-Stage Journey

### Stage 1: Installation

Install Fabric once on your machine:

```bash
npm install -g @fenglimg/fabric-cli
```

At this point the project itself is unchanged. There is still no `.fabric/` directory, no `.claude/` initialization assets, and no generated `AGENTS.md`.

---

### Stage 2: Run `fab init`

From the project root:

```bash
cd ~/projects/werewolf-minigame
fab init
```

What happens during this step:

- Fabric scans the repo and writes `.fabric/forensic.json`.
- Fabric writes a safe fallback `AGENTS.md` plus metadata files.
- Fabric installs `.claude/skills/agents-md-init/SKILL.md`, `.claude/hooks/agents-md-init-reminder.cjs`, and `.claude/settings.json`.

Real output from a disposable `werewolf-minigame` example run:

```text
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/AGENTS.md
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.fabric/agents.meta.json
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.fabric/human-lock.json
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.fabric/forensic.json
Installed /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.claude/skills/agents-md-init/SKILL.md
Installed /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.claude/hooks/agents-md-init-reminder.cjs
Created /tmp/werewolf-minigame-init-guide-example/werewolf-minigame/.claude/settings.json with Claude Stop hook.
Next: run fab hooks install to add the Day 4 pre-commit pipeline.
Reason: .fabric/forensic.json is ready; use the agents-md-init skill to finish AGENTS.md initialization.
```

After Stage 2, the project is ready for AI takeover, but initialization is still pending until `.fabric/init-context.json` exists.

---

### Stage 3: AI Takeover

Open the same repo in Claude Code and send a normal message. Two trigger paths are supported:

- Same-session path: if `fab init` was run from Claude Code's Bash tool, the model sees the reason line from Stage 2 and triggers `agents-md-init`.
- Cross-session path: if `fab init` was run in an external terminal, the Stop hook checks for `.fabric/forensic.json` without `.fabric/init-context.json` and blocks until `agents-md-init` runs.

Example prompt:

```text
I just ran fab init in this repo. Finish AGENTS.md initialization.
```

The important mental model is: Stage 2 equips the repo, Stage 3 hands the repo to the skill.

---

### Stage 4: Phase 1 Framework Confirm

`agents-md-init` starts by reading `.fabric/forensic.json` and confirming the detected framework assumptions.

Example `werewolf-minigame` exchange:

```text
AI: I detected a Cocos Creator 3.8 project with scripts under assets/scripts.
    It looks like a TypeScript Component-based codebase using @ccclass.
    Please confirm:
    1. Is this TypeScript rather than JavaScript?
    2. Do node references usually come from @property(Node) injection?

Developer: Yes. It is TypeScript, and we mainly use @property(Node).
```

This phase is short on purpose. The goal is to validate the framework model before Fabric asks for hard constraints.

---

### Stage 5: Phase 2 Invariants

Next, the skill collects project rules that must become L0 constraints in `AGENTS.md`.

Example `werewolf-minigame` exchange:

```text
AI: I need to lock the project invariants:
    1. Ban async/await inside update() and lateUpdate()?
    2. Require every Component class to use @ccclass(name)?
    3. Protect assets/prefabs/** and assets/scenes/** from AI edits?
    4. Protect all **/*.meta files?
    5. Must network traffic go through NetworkManager?

Developer: Yes to all five.
```

This phase should produce hard rules, not preferences. If a rule is uncertain, leave it out and add it later during daily maintenance.

---

### Stage 6: Phase 3 Generate

After the interview, the skill writes the semantic initialization outputs:

- `.fabric/init-context.json`
- a complete project-specific `AGENTS.md`
- an updated `.fabric/agents.meta.json` hash

For `werewolf-minigame`, the generated result should encode details such as:

- Cocos Creator 3.8 with `@ccclass + extends Component`
- no `async/await` inside `update()` or `lateUpdate()`
- protected paths for `assets/prefabs/**`, `assets/scenes/**`, and `**/*.meta`
- `NetworkManager` as the required network boundary

When this stage succeeds, initialization is complete because both state artifacts now exist:

- `.fabric/forensic.json`
- `.fabric/init-context.json`

---

### Stage 7: Daily Dev

From this point on, treat `AGENTS.md` as a maintained project contract rather than a one-time scaffold.

Typical follow-up commands:

```bash
fab hooks install
fab sync-meta
```

Use the ongoing `agents-md` workflow whenever project architecture, invariants, or protected paths change. The initialization skill is one-time setup; daily development is about keeping `AGENTS.md` and `.fabric/agents.meta.json` aligned with the codebase.

## State Machine

```text
[empty project]
    |
    | fab init
    v
[forensic.json exists] + [init-context.json missing]
    |   ^
    |   | Stop hook blocks here until initialization is finished
    |
    | Claude Code + agents-md-init
    v
[forensic.json exists] + [init-context.json exists] + [AGENTS.md completed]
    |
    | ongoing edits + agents-md maintenance
    v
[AGENTS.md stays in sync with code]
```

## Compatibility Matrix

| Scenario | Trigger mechanism | Result |
| --- | --- | --- |
| `fab init` run from Claude Code Bash tool | The model reads the Stage 2 reason line from the tool result | `agents-md-init` can trigger immediately in the same session |
| `fab init` run in an external terminal | Claude Code Stop hook sees `forensic.json` without `init-context.json` | The next Claude Code session is blocked until initialization continues |
| `fab init` run in CI or another non-TTY environment | No interactive takeover; the command only writes files and logs the reason line | The fallback `AGENTS.md` and `.fabric/` artifacts are still valid, but `.fabric/init-context.json` will not be created automatically |
| Non-Claude clients | `.claude/` files are harmless no-ops outside Claude Code | The scaffolded `AGENTS.md` still works as a fallback, but there is no automatic `agents-md-init` handoff today |

## Troubleshooting

### The hook did not trigger

Check the sentinel state first:

```bash
test -f .fabric/forensic.json && echo "forensic: ok"
test ! -f .fabric/init-context.json && echo "init-context: missing"
test -f .claude/hooks/agents-md-init-reminder.cjs && echo "hook: ok"
```

Then confirm that `.claude/settings.json` contains the Stop hook entry for `.claude/hooks/agents-md-init-reminder.cjs`. If all three files exist, open the repo in Claude Code and send a message such as:

```text
Use the agents-md-init skill to finish this project's initialization.
```

### `.fabric/forensic.json` is missing

Initialization never completed Stage 2. Go back to the project root and run:

```bash
fab init
```

If the command aborts because `AGENTS.md` or `.fabric/` already exists, inspect those files first instead of overwriting them. `fab init` is intentionally non-destructive.

### `AGENTS.md` was not generated, or it is still only the scaffold

`fab init` always writes a fallback `AGENTS.md` in Stage 2. The richer version is generated later by `agents-md-init`.

If `AGENTS.md` is missing completely, Stage 2 did not finish. If `AGENTS.md` exists but still looks generic, Stage 3 to Stage 6 have not finished yet. Open Claude Code in the repo and continue the initialization interview.

### `init-context.json` is invalid or incomplete

The Stop hook only blocks while `.fabric/init-context.json` is missing. If the file exists but is malformed, move it aside and rerun the initialization interview:

```bash
mv .fabric/init-context.json .fabric/init-context.invalid.json
```

Then reopen Claude Code in the project and ask it to use `agents-md-init` again. Keep `.fabric/forensic.json` in place so the skill can reuse the original evidence pack.

## Reference Links

- [`agents-md-init` skill template](../templates/claude-skills/agents-md-init/SKILL.md)
- [`agents-md-init` Stop hook template](../templates/claude-hooks/agents-md-init-reminder.cjs)
- [`fab init` implementation](../packages/cli/src/commands/init.ts)
