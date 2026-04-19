# Getting Started with Fabric

Fabric v1.0 gives maintainers one canonical onboarding path from local install to the first ledger-backed collaboration event. If you are evaluating Fabric for the first time, start here.

If you need contribution and local repo setup details, see [Contributing](./contributing.md). If you need the deeper `fab init` mechanics and state machine, see [Initialization Guide](./initialization.md). If you want the product-facing narrative version, see [Launch Story](./launch-story.md).

## Stage 1: Install Fabric

Install the CLI once on your machine:

```bash
npm install -g @fenglimg/fabric-cli
```

If you are validating Fabric from this monorepo instead of npm, build the workspace first:

```bash
pnpm install
pnpm -r build
```

You should now have the `fab` command available:

```text
$ fab --help
Fabric CLI - AI 智能体协作框架 (fab v1.0.0)
USAGE fab bootstrap|init|scan|serve|sync-meta|human-lint|ledger-append|hooks|config|pre-commit
```

## Stage 2: Initialize Fabric

Move into the project that will adopt Fabric. For a first run, use a disposable repository or a clean branch.

```bash
cd ~/projects/my-app
git status --short
fab init
```

Recommended preconditions:

- `AGENTS.md` does not already exist.
- `.fabric/` does not already exist.
- Existing `.claude/`, `.cursor/`, `.codex/`, `.windsurf/`, or `.roo/` config is reviewed before any write step.

Chinese-localized stdout example from the v1.0 launch story:

```text
$ fab init

Fabric v1.0 · control plane

正在扫描项目根目录...
检测到项目类型: Cocos Creator 3.8 TypeScript Component project
检测依据:
  - project.config.json
  - creator.version = 3.8.0
  - assets/scripts/*.ts
  - @ccclass + extends Component

正在生成证据包...
证据包摘要 / `.fabric/forensic.json`
  - `framework.kind`: `cocos-creator`
  - `framework.version`: `3.8.0`
  - `framework.subkind`: `typescript-component`
  - `entry_points[0].path`: `assets/scripts/Game.ts`
  - `topology.by_ext[".ts"]`: 3
  - `recommendations_for_skill`: 6 items

Created `AGENTS.md`
Created `.fabric/agents.meta.json`
Created `.fabric/human-lock.json`
Created `.fabric/forensic.json`

正在安装 Claude Code 初始化接力...
Installed `.claude/skills/agents-md-init/SKILL.md`
Installed `.claude/hooks/agents-md-init-reminder.cjs`
Created `.claude/settings.json` with Claude Stop hook

已完成首轮落规。
说明:
  - 已写入 fallback `AGENTS.md`
  - 已写入 evidence artifact，供后续 AI interview 复用
  - 当前状态 = initialization pending

Reason: `.fabric/forensic.json` is ready; use the `agents-md-init` skill to finish `AGENTS.md` initialization.
Next: 在 Claude Code 中输入「我刚执行了 fab init，请使用 agents-md-init 完成当前项目初始化。」
Next: 如需先接入提交守卫，继续执行 `fab hooks install`
```

After this stage, the repo has the fallback contract and evidence pack, but semantic initialization is not complete until the client-side interview finishes.

## Stage 3: Complete the AI Handoff

Open the same repository in Claude Code and continue the initialization transaction with a normal message:

```text
I just ran fab init in this repo. Finish AGENTS.md initialization.
```

Expected outcome:

- `agents-md-init` reads `.fabric/forensic.json`.
- The maintainer confirms framework facts and invariants.
- Fabric writes `.fabric/init-context.json` and updates `AGENTS.md` for the actual project.

For the deeper interview flow, including the framework-confirm and invariants phases, see [Initialization Guide](./initialization.md).

## Stage 4: Configure Agents and Hooks

Install the Git hook pipeline and bootstrap prompts first:

```bash
fab hooks install
fab bootstrap install --clients claude,cursor,windsurf,roo,gemini,codex
```

Typical output:

```text
Installed <project>/.husky/pre-commit
Added prepare script to <project>/package.json
Installed <project>/CLAUDE.md
Installed <project>/.cursor/rules/fabric-bootstrap.mdc
Installed <project>/.windsurf/rules/fabric.md
Installed <project>/.roo/rules/fabric.md
Installed <project>/GEMINI.md
Prepended <project>/AGENTS.md
```

Then preview MCP config writes:

```bash
fab config install --clients claude,cursor,windsurf,roo,gemini,codex --dry-run
```

Expected output shape:

```text
[dry-run] ClaudeCodeCLI: would write <path>
[dry-run] Cursor: would write <project>/.cursor/mcp.json
[dry-run] Windsurf: would write <project>/.windsurf/mcp.json
[dry-run] RooCode: would write <project>/.roo/mcp.json
[dry-run] GeminiCLI: would write <path>
[dry-run] CodexCLI: would write <path>
```

If you are running from this monorepo and need an explicit server entry, see [Contributing](./contributing.md#fabric_server_path-for-local-development).

## Stage 5: Start the Local Control Plane

Launch the local Fabric HTTP server:

```bash
fab serve
```

Actual CLI output from the current implementation:

```text
Fabric Dashboard: http://127.0.0.1:7373
```

This is the local control-plane session for maintainers. Keep it running while you verify MCP clients or inspect the Dashboard.

## Stage 6: Verify MCP Is Active

Restart each configured client so it reloads the Fabric MCP entry, then confirm the Fabric tools are present:

- `fab_get_rules`
- `fab_append_intent`
- `fab_update_registry`

Minimal smoke prompt:

```text
Before editing any file, call fab_get_rules for README.md and summarize the active Fabric rules.
```

What success looks like:

- The client invokes `fab_get_rules`.
- The response includes `revision_hash`.
- The response includes L0 rules from `AGENTS.md`.

If tools do not appear, verify that the MCP config file contains `mcpServers.fabric` or `[mcp.servers.fabric]`, then restart the client again.

## Stage 7: Record the First Ledger Entry

Make a small staged change and let Fabric append the first intent ledger entry through the hook pipeline:

```bash
git add README.md
FABRIC_INTENT="docs: refine onboarding copy" fab ledger-append --staged
```

Result:

```text
.intent-ledger.jsonl receives a new append-only JSON line with parent_sha, intent, affected_paths, and diff_stat.
```

At this point the repo has completed the v1.0 onboarding loop:

1. Fabric is installed.
2. The project is initialized.
3. Client rules are distributed through MCP.
4. The first collaboration event is recorded in the ledger.

## Next Reads

- [Launch Story](./launch-story.md)
- [Dashboard Tour](./dashboard-tour.md)
- [Contributing](./contributing.md)
- [Initialization Guide](./initialization.md)
- [Roadmap](./roadmap.md)
