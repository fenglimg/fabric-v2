# Day 7 Outer Track: Real Werewolf Project Runbook

This runbook validates Fabric against the real project at `/Users/wepie/Desktop/projects/werewolf-minigame/`.

## Critical Warning

This project already contains `.claude/`, `.cursor/`, `.codex/` private configs created by the user. Fabric MUST PRESERVE them. Do NOT run destructive commands. If any test step modifies existing private config files, STOP immediately and notify the user.

Treat `/Users/wepie/Desktop/projects/werewolf-minigame/` as read-only unless a step explicitly allows a Fabric-owned additive write. Never delete, reset, rewrite, reformat, or replace private user configuration.

## Prerequisites

- Fabric MVP is built in `/Users/wepie/Desktop/personal-projects/pcf`.
- The real project is accessible at `/Users/wepie/Desktop/projects/werewolf-minigame/`.
- The operator has explicit approval before any real write step.
- Start from a clean or well-understood real-project worktree:

  ```bash
  cd /Users/wepie/Desktop/projects/werewolf-minigame
  git status --short
  ```

- If `git status --short` shows unrelated user work, record it before testing and do not overwrite it.
- Set shared variables:

  ```bash
  FABRIC_REPO="/Users/wepie/Desktop/personal-projects/pcf"
  REAL_TARGET="/Users/wepie/Desktop/projects/werewolf-minigame"
  ```

## Phase A: Dry-Run Scan and Private Config Detection

Task intent command:

```bash
EXTERNAL_FIXTURE_PATH=/Users/wepie/Desktop/projects/werewolf-minigame pnpm -C packages/cli exec fab scan --target  --debug --dry-run
```

Current CLI note:

- Do not pass an empty value after `--target`; the intended behavior is to let `EXTERNAL_FIXTURE_PATH` provide the target.
- `fab scan` is read-only and currently uses `--debug` and optional `--json`; it does not need a destructive dry-run mode.

Use this read-only equivalent from the Fabric repo:

```bash
cd "$FABRIC_REPO"
EXTERNAL_FIXTURE_PATH="$REAL_TARGET" pnpm --filter @fabric/cli exec fab scan --debug --json
```

Expected scan diagnostics:

```json
{
  "framework": {
    "kind": "cocos-creator",
    "evidence": ["project.config.json"]
  },
  "readmeQuality": "ok"
}
```

Expected operator observations:

- `framework.kind` is `cocos-creator`.
- Detector evidence includes `project.config.json`.
- `fileCount` reports the processed file count.
- `ignoredCount` reports ignored entries.
- Existing `docs/` folder is present in the real project.
- `.claude/` is detected as private and must not be modified during scan.
- `.cursor/` is detected as private and must not be modified during scan.
- `.codex/` is detected as private and must not be modified during scan.
- Record the note: `private - will not be modified`.

Abort conditions:

- Scan attempts to write any file.
- Scan output indicates a non-Cocos framework.
- Existing private config directories are missing unexpectedly.

## Phase B: Performance Benchmark

Run a read-only timing check:

```bash
cd "$FABRIC_REPO"
EXTERNAL_FIXTURE_PATH="$REAL_TARGET" time pnpm --filter @fabric/cli exec fab scan --debug
```

Expected result:

- Wall-clock time is `<10s`.
- `Framework: cocos-creator`.
- `Files counted: <processed file count>`.
- `Ignored entries: <ignoredCount>`.
- `ignoredCount` is expected to be high because the Cocos asset tree may contain thousands of `.meta` sidecar files.

Record:

| Metric | Value |
|---|---|
| Wall-clock time |  |
| Processed file count |  |
| ignoredCount |  |
| Notes on ignored `.meta` files |  |

Abort conditions:

- Scan exceeds `10s`.
- `ignoredCount` is clearly too low for the known Cocos asset tree.
- The scan traverses generated or dependency directories that should be ignored.

## Phase C: Dual-Write Safety for Client Configs

This phase is safety-critical because the real project has private user config. Do not run the real install until the dry-run and visual diff plan are reviewed.

1. Move to the real project:

   ```bash
   cd "$REAL_TARGET"
   ```

2. Inspect private config directories before any write:

   ```bash
   git status --short -- .claude .cursor .codex .windsurf .roo GEMINI.md CLAUDE.md AGENTS.md
   ```

3. Dry-run MCP config installation:

   ```bash
   FAB_SERVER_PATH="$FABRIC_REPO/packages/server/dist/index.js" \
     node "$FABRIC_REPO/packages/cli/dist/index.js" config install --clients claude,cursor,windsurf,roo,gemini,codex --dry-run
   ```

4. Expected dry-run output shape:

   ```text
   [dry-run] ClaudeCodeCLI: would write ...
   [dry-run] Cursor: would write ...
   [dry-run] Windsurf: would write ...
   [dry-run] RooCode: would write ...
   [dry-run] GeminiCLI: would write ...
   [dry-run] CodexCLI: would write ...
   ```

5. Before real install, visually verify the planned writes:
   - No private file will be replaced wholesale.
   - Existing `mcpServers` entries will remain.
   - Only `mcpServers.fabric` or `[mcp.servers.fabric]` will be added or updated.
   - Existing non-Fabric keys will remain byte-for-byte where possible.

6. If and only if the user approves additive config writes, run:

   ```bash
   FAB_SERVER_PATH="$FABRIC_REPO/packages/server/dist/index.js" \
     node "$FABRIC_REPO/packages/cli/dist/index.js" config install --clients claude,cursor,windsurf,roo,gemini,codex
   ```

7. Verify diffs immediately:

   ```bash
   git diff -- .claude .cursor .codex .windsurf .roo GEMINI.md CLAUDE.md AGENTS.md
   ```

8. Expected diff:
   - Additive `mcpServers.fabric` entry for JSON clients.
   - Additive `[mcp.servers.fabric]` entry for Codex TOML.
   - No deletion of existing `mcpServers` entries.
   - No deletion of private user settings.
   - No unrelated formatting churn outside the config file format writer's normal serialization.

9. STOP immediately if any existing private config file shows destructive change, removed keys, unrelated rewrites, or unexpected normalization.

## Phase D: AGENTS.md and Sync-Meta

This phase validates Fabric metadata without overwriting an existing human-maintained `AGENTS.md`.

1. Move to the real project:

   ```bash
   cd "$REAL_TARGET"
   ```

2. Non-destructive `fab init` guard:

   ```bash
   test -e AGENTS.md && echo "SKIP fab init: AGENTS.md already exists"
   test -d .fabric && echo "SKIP fab init: .fabric already exists"
   ```

3. If either `AGENTS.md` or `.fabric/` already exists, skip `fab init`. Do not overwrite.

4. If neither exists and the user approves additive Fabric files, run:

   ```bash
   node "$FABRIC_REPO/packages/cli/dist/index.js" init --target "$REAL_TARGET"
   ```

5. Expected `fab init` output shape:

   ```text
   Created /Users/wepie/Desktop/projects/werewolf-minigame/AGENTS.md
   Created /Users/wepie/Desktop/projects/werewolf-minigame/.fabric/agents.meta.json
   Created /Users/wepie/Desktop/projects/werewolf-minigame/.fabric/human-lock.json
   Next: run fab hooks install to add the Day 4 pre-commit pipeline.
   ```

6. Create a temporary test `AGENTS.md` only if it is within an approved Fabric scope and the path does not already exist. Recommended probe:

   ```bash
   test -e docs/day7-sync-meta-probe/AGENTS.md && echo "SKIP probe: docs/day7-sync-meta-probe/AGENTS.md already exists"
   mkdir -p docs/day7-sync-meta-probe
   printf '# Day 7 Sync Meta Probe\n' > docs/day7-sync-meta-probe/AGENTS.md
   node "$FABRIC_REPO/packages/cli/dist/index.js" sync-meta --target "$REAL_TARGET"
   ```

7. Expected sync-meta result:

   ```text
   Updated /Users/wepie/Desktop/projects/werewolf-minigame/.fabric/agents.meta.json
   ```

8. Verify `.fabric/agents.meta.json` contains a node for `docs/day7-sync-meta-probe/AGENTS.md`, then remove the probe only through the rollback procedure or an explicitly approved cleanup.

Abort conditions:

- `fab init` overwrites an existing `AGENTS.md`.
- `fab init` overwrites an existing `.fabric/`.
- `sync-meta` removes existing metadata nodes unexpectedly.

## Phase E: Pre-Commit Behavior and Existing Husky Hooks

The real project may already have `.husky/` hooks. Fabric must coexist with them.

1. Inspect existing hooks:

   ```bash
   cd "$REAL_TARGET"
   test -d .husky && find .husky -maxdepth 1 -type f -print
   test -f .husky/pre-commit && sed -n '1,200p' .husky/pre-commit
   ```

2. If `.husky/pre-commit` already exists, prefer testing hook behavior on a disposable copy of the real project first.

3. Existing-hook safety check, only on a disposable copy or after explicit user approval:

   ```bash
   cp .husky/pre-commit /tmp/werewolf-minigame-pre-commit.before
   shasum .husky/pre-commit
   node "$FABRIC_REPO/packages/cli/dist/index.js" hooks install --target "$REAL_TARGET"
   git diff -- .husky/pre-commit package.json
   ```

4. Expected existing-hook result:
   - Existing hook commands remain present.
   - Fabric commands are appended or otherwise composed.
   - The hook is not replaced wholesale.
   - Existing `prepare` script remains unchanged if present.

5. If no `.husky/pre-commit` exists and the user approves an additive hook install, run:

   ```bash
   node "$FABRIC_REPO/packages/cli/dist/index.js" hooks install --target "$REAL_TARGET"
   ```

6. Expected output shape:

   ```text
   Installed /Users/wepie/Desktop/projects/werewolf-minigame/.husky/pre-commit
   Added prepare script to /Users/wepie/Desktop/projects/werewolf-minigame/package.json
   ```

   Or, if `prepare` already exists:

   ```text
   Installed /Users/wepie/Desktop/projects/werewolf-minigame/.husky/pre-commit
   Left existing prepare script unchanged in /Users/wepie/Desktop/projects/werewolf-minigame/package.json
   ```

7. Verify hook composition:

   ```bash
   git diff -- .husky/pre-commit package.json
   ```

8. Expected diff:
   - Existing hook content is preserved if a hook existed.
   - Fabric commands are appended or composed.
   - Existing `prepare` script is preserved if present.

Abort conditions:

- Existing `.husky/pre-commit` is overwritten.
- Existing hook commands disappear.
- Existing `package.json` scripts are removed or reformatted unexpectedly.

## Abort Criteria

STOP and revert if any test step causes:

- Any modification to files outside `AGENTS.md`, `.fabric/`, `.intent-ledger.jsonl`, or approved bootstrap/config files.
- Any destructive modification to `.claude/`, `.cursor/`, `.codex/`, `.windsurf/`, `.roo/`, `CLAUDE.md`, `GEMINI.md`, or `AGENTS.md`.
- Any deletion of existing private settings.
- Any loss of existing `mcpServers` entries.
- Any write during Phase A or Phase B.
- Any hook overwrite in Phase E.

Notify the user before proceeding after any abort.

## Rollback Procedure

Do not run rollback commands blindly. Review `git status --short` first and only revert Fabric Day 7 changes that the user approves.

1. Inspect current changes:

   ```bash
   cd "$REAL_TARGET"
   git status --short
   git diff -- AGENTS.md .fabric .intent-ledger.jsonl CLAUDE.md GEMINI.md .claude .cursor .codex .windsurf .roo .husky package.json
   ```

2. Revert tracked file changes created by Day 7:

   ```bash
   git restore --worktree --staged -- AGENTS.md .intent-ledger.jsonl CLAUDE.md GEMINI.md package.json
   git restore --worktree --staged -- .claude .cursor .codex .windsurf .roo .husky .fabric
   ```

3. Remove untracked Fabric files created by Day 7 after confirming they are not user-authored:

   ```bash
   git clean -fd -- AGENTS.md .fabric .intent-ledger.jsonl CLAUDE.md GEMINI.md
   git clean -fd -- docs/day7-sync-meta-probe
   git clean -fd -- .cursor/rules/fabric-bootstrap.mdc .windsurf/rules/fabric.md .roo/rules/fabric.md
   ```

4. Verify clean rollback:

   ```bash
   git status --short
   ```

5. If rollback would touch pre-existing user files, stop and ask the user to choose the exact files to restore.
