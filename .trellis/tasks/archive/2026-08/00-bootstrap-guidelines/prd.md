# Bootstrap Task: Fill Project Development Guidelines

**You (the AI) are running this task. The developer does not read this file.**

The developer just ran `trellis init` on this project for the first time.
`.trellis/` now exists with empty spec scaffolding, and this bootstrap task
exists under `.trellis/tasks/`. When they want to work on it, they should start
this task from a session that provides Trellis session identity.

**Your job**: help them populate `.trellis/spec/` with the team's real
coding conventions. Every future AI session — this project's
`trellis-implement` and `trellis-check` sub-agents — auto-loads spec files
listed in per-task jsonl manifests. Empty spec = sub-agents write generic
code. Real spec = sub-agents match the team's actual patterns.

Don't dump instructions. Open with a short greeting, figure out if the repo
has any existing convention docs (CLAUDE.md, .cursorrules, etc.), and drive
the rest conversationally.

---

## Status (update the checkboxes as you complete each item)

- [x] Fill guidelines for @fenglimg/fabric-cli — `.trellis/spec/fabric-cli/` 13 份
- [x] Fill guidelines for @fenglimg/fabric-server — `.trellis/spec/fabric-server/` 13 份
- [x] Fill guidelines for @fenglimg/fabric-shared — `.trellis/spec/fabric-shared/` 13 份
- [~] ~~Fill guidelines for @fenglimg/fabric-server-http-experimental~~ —
      **该包已不存在**(现存三个包:cli / server / shared)。这一行是
      `trellis init` 当时的包清单快照,包删掉后没人回来改这份 PRD。
- [~] Add code examples — 42 份 spec 里 **9 份含代码块**。部分完成,未逐份补齐。

---

## 关闭说明(2026-08-12)

本任务从未被"执行"过 —— 但它的产出**已经通过 `trellis-spec-bootstrap` 以另一条
路径完成**:`.trellis/spec/` 现有 42 份文档,三个现存包各 13 份 + guides 3 份,
`get_context.py` 正在消费它们。清单一直挂着未勾选,是因为**做事的路径和记账的
路径不是同一条** —— 这本身就是一条要记的账:一个长期 `in_progress` 的任务,
它的状态可能不是"没做",而是"做了但没人回来划勾"。

按实际状态勾选后归档。剩余的 "code examples" 缺口(33/42 份无代码块)不作为
阻塞项 —— 需要时按包单开任务补,而不是让这个 bootstrap 任务无限期挂着。

---

## Spec files to populate

### Package: @fenglimg/fabric-cli (`spec/fabric-cli/`)

- Backend guidelines: `.trellis/spec/fabric-cli/backend/`

- Frontend guidelines: `.trellis/spec/fabric-cli/frontend/`

### Package: @fenglimg/fabric-server (`spec/fabric-server/`)

- Backend guidelines: `.trellis/spec/fabric-server/backend/`

- Frontend guidelines: `.trellis/spec/fabric-server/frontend/`

### Package: @fenglimg/fabric-shared (`spec/fabric-shared/`)

- Backend guidelines: `.trellis/spec/fabric-shared/backend/`

- Frontend guidelines: `.trellis/spec/fabric-shared/frontend/`

### Package: @fenglimg/fabric-server-http-experimental (`spec/fabric-server-http-experimental/`)

- Frontend guidelines: `.trellis/spec/fabric-server-http-experimental/frontend/`


### Thinking guides (already populated)

`.trellis/spec/guides/` contains general thinking guides pre-filled with
best practices. Customize only if something clearly doesn't fit this project.

---

## How to fill the spec

### Step 1: Import from existing convention files first (preferred)

Search the repo for existing convention docs. If any exist, read them and
extract the relevant rules into the matching `.trellis/spec/` files —
usually much faster than documenting from scratch.

| File / Directory | Tool |
|------|------|
| `CLAUDE.md` / `CLAUDE.local.md` | Claude Code |
| `AGENTS.md` | Codex / Claude Code / agent-compatible tools |
| `.cursorrules` | Cursor |
| `.cursor/rules/*.mdc` | Cursor (rules directory) |
| `.windsurfrules` | Windsurf |
| `.clinerules` | Cline |
| `.roomodes` | Roo Code |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.vscode/settings.json` → `github.copilot.chat.codeGeneration.instructions` | VS Code Copilot |
| `CONVENTIONS.md` / `.aider.conf.yml` | aider |
| `CONTRIBUTING.md` | General project conventions |
| `.editorconfig` | Editor formatting rules |

### Step 2: Analyze the codebase for anything not covered by existing docs

Scan real code to discover patterns. Before writing each spec file:
- Find 2-3 real examples of each pattern in the codebase.
- Reference real file paths (not hypothetical ones).
- Document anti-patterns the team clearly avoids.

### Step 3: Document reality, not ideals

**Critical**: write what the code *actually does*, not what it should do.
Sub-agents match the spec, so aspirational patterns that don't exist in the
codebase will cause sub-agents to write code that looks out of place.

If the team has known tech debt, document the current state — improvement
is a separate conversation, not a bootstrap concern.

---

## Quick explainer of the runtime (share when they ask "why do we need spec at all")

- Every AI coding task spawns two sub-agents: `trellis-implement` (writes
  code) and `trellis-check` (verifies quality).
- Each task has `implement.jsonl` / `check.jsonl` manifests listing which
  spec files to load.
- The platform hook auto-injects those spec files + the task's `prd.md`
  into every sub-agent prompt, so the sub-agent codes/reviews per team
  conventions without anyone pasting them manually.
- Source of truth: `.trellis/spec/`. That's why filling it well now pays
  off forever.

---

## Completion

When the developer confirms the checklist items above are done with real
examples (not placeholders), guide them to run:

```bash
python3 ./.trellis/scripts/task.py finish
python3 ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
```

After archive, every new developer who joins this project will get a
`00-join-<slug>` onboarding task instead of this bootstrap task.

---

## Suggested opening line

"Welcome to Trellis! Your init just set me up to help you fill the project
spec — a one-time setup so every future AI session follows the team's
conventions instead of writing generic code. Before we start, do you have
any existing convention docs (CLAUDE.md, .cursorrules, CONTRIBUTING.md,
etc.) I can pull from, or should I scan the codebase from scratch?"
