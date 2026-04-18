# Day 7 Inner Track: Stub E2E Runbook

This runbook validates Fabric against the disposable `examples/werewolf-minigame-stub` fixture. It is an operational checklist; record results in `docs/day7-kill-switch-tracking.md`.

Do not run these steps against `/Users/wepie/Desktop/projects/werewolf-minigame/`. That project is covered by the outer-track runbook.

## Prerequisites

- Run from the Fabric repository root: `/Users/wepie/Desktop/personal-projects/pcf`.
- Use the disposable target: `examples/werewolf-minigame-stub`.
- Confirm the six clients are installed or available for manual testing:
  - Claude Code
  - Cursor
  - Windsurf
  - Roo Code
  - Gemini CLI
  - Codex CLI
- Build Fabric before starting manual client checks:

  ```bash
  pnpm install
  pnpm -r build
  pnpm -C packages/server bundle
  ```

- Expected build artifacts:
  - `packages/cli/dist/index.js` exists.
  - `packages/server/dist/index.js` exists.
  - If `pnpm -C packages/server bundle` is not available in the current workspace, stop and confirm the Day 7 build command with the maintainer before continuing.

## Step 1: Initialize and Scan the Stub

1. Set the target path once:

   ```bash
   STUB_TARGET="$PWD/examples/werewolf-minigame-stub"
   ```

2. Initialize Fabric on the stub:

   ```bash
   pnpm -C packages/cli exec fab init --target ./examples/werewolf-minigame-stub
   ```

   If path resolution fails when using `pnpm -C packages/cli`, use the absolute target:

   ```bash
   pnpm -C packages/cli exec fab init --target "$STUB_TARGET"
   ```

3. Expected `fab init` output shape:

   ```text
   Created .../examples/werewolf-minigame-stub/AGENTS.md
   Created .../examples/werewolf-minigame-stub/.fabric/agents.meta.json
   Created .../examples/werewolf-minigame-stub/.fabric/human-lock.json
   Next: run fab hooks install to add the Day 4 pre-commit pipeline.
   ```

4. Scan the stub and request JSON diagnostics:

   ```bash
   fab scan --target ./examples/werewolf-minigame-stub --json --debug
   ```

   Equivalent CLI-package invocation:

   ```bash
   pnpm -C packages/cli exec fab scan --target "$STUB_TARGET" --json --debug
   ```

5. Expected JSON diagnostic:

   ```json
   {
     "framework": {
       "kind": "cocos-creator",
       "evidence": ["project.config.json"]
     },
     "readmeQuality": "stub",
     "hasExistingFabric": true,
     "ignoredCount": 3
   }
   ```

6. Acceptance notes:
   - `framework.kind` must be `cocos-creator`.
   - `framework.evidence` should include `project.config.json`.
   - `readmeQuality` may be `stub` for the intentionally small fixture README, or `ok` if the README has been expanded.
   - `ignoredCount` should include Cocos `.meta` sidecar files.

## Step 2: Install Bootstrap and MCP Config for the Stub

1. Move into the stub so workspace-local client files are written under the fixture:

   ```bash
   cd "$STUB_TARGET"
   ```

2. Install all six bootstrap prompts:

   ```bash
   FABRIC_REPO="/Users/wepie/Desktop/personal-projects/pcf"
   node "$FABRIC_REPO/packages/cli/dist/index.js" bootstrap install --clients claude,cursor,windsurf,roo,gemini,codex
   ```

3. Expected bootstrap output shape:

   ```text
   Installed .../CLAUDE.md
   Installed .../.cursor/rules/fabric-bootstrap.mdc
   Installed .../.windsurf/rules/fabric.md
   Installed .../.roo/rules/fabric.md
   Installed .../GEMINI.md
   Prepended .../AGENTS.md
   ```

4. Preview MCP config writes:

   ```bash
   FAB_SERVER_PATH="$FABRIC_REPO/packages/server/dist/index.js" \
     node "$FABRIC_REPO/packages/cli/dist/index.js" config install --clients claude,cursor,windsurf,roo,gemini,codex --dry-run
   ```

5. Expected dry-run output shape:

   ```text
   [dry-run] ClaudeCodeCLI: would write ...
   [dry-run] Cursor: would write .../.cursor/mcp.json
   [dry-run] Windsurf: would write .../.windsurf/mcp.json
   [dry-run] RooCode: would write .../.roo/mcp.json
   [dry-run] GeminiCLI: would write ...
   [dry-run] CodexCLI: would write ...
   ```

6. Install MCP config entries:

   ```bash
   FAB_SERVER_PATH="$FABRIC_REPO/packages/server/dist/index.js" \
     node "$FABRIC_REPO/packages/cli/dist/index.js" config install --clients claude,cursor,windsurf,roo,gemini,codex
   ```

7. Expected install output shape:

   ```text
   ClaudeCodeCLI: wrote ...
   Cursor: wrote .../.cursor/mcp.json
   Windsurf: wrote .../.windsurf/mcp.json
   RooCode: wrote .../.roo/mcp.json
   GeminiCLI: wrote ...
   CodexCLI: wrote ...
   ```

8. Abort conditions:
   - Any client config loses existing non-Fabric settings.
   - Any existing `mcpServers` entry other than `fabric` disappears.
   - `FAB_SERVER_PATH` does not point to `packages/server/dist/index.js`.

## Step 3: Six-Client Smoke Loop

Run five attempts per client. Record every attempt in `docs/day7-kill-switch-tracking.md`.

For each client:

1. Restart the client so MCP configuration reloads.
2. Open or navigate to `examples/werewolf-minigame-stub`.
3. Confirm the client can see Fabric MCP tools if it has a tools view.
4. Give this exact task:

   ```text
   Add a Timer.ts component to this Cocos Creator stub.
   ```

5. Observe whether the AI invokes `fab_get_rules` before creating or editing files.
6. Record:
   - Client
   - Attempt number
   - Task given
   - Called `fab_get_rules`? `Y` or `N`
   - Time-to-first-tool-call
   - Notes
7. Revert the fixture changes between attempts so each attempt starts from the same state.

Client checklist:

| Client | Stub Directory | Task Given | Evidence to Capture |
|---|---|---|---|
| Claude Code | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | Tool-call transcript or screenshot |
| Cursor | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | Composer/agent log |
| Windsurf | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | Cascade/tool log |
| Roo Code | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | Roo tool trace |
| Gemini CLI | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | CLI transcript |
| Codex CLI | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | CLI transcript |

## Step 4: Kill Switch 1 Tracking Sheet

Use the canonical table in `docs/day7-kill-switch-tracking.md`.

Minimum sample size:

- 6 clients
- 5 attempts per client
- 30 total attempts

Success criterion:

```text
fab_get_rules call rate >= 60%
```

Calculation:

```text
call_rate = attempts_with_fab_get_rules / 30
```

Pass example:

```text
18 / 30 = 60%: PASS
```

Fail example:

```text
17 / 30 = 56.7%: KS-1 FAIL
```

## Step 5: Kill Switch 2 Stdio Latency

Measure every observed `fab_get_rules` call.

Procedure:

1. Wrap or timestamp each `fab_get_rules` call with:
   - Start time immediately before the tool call is sent.
   - End time immediately after the tool result is visible to the client.
2. Record latency in milliseconds in `docs/day7-kill-switch-tracking.md`.
3. Compute p95 after all attempts complete.

Success criterion:

```text
p95(fab_get_rules latency) < 2000ms
```

Failure response:

- If p95 is `>= 2000ms`, mark KS-2 failed.
- Do not tune client behavior during the sample.
- Open a follow-up task to evaluate HTTP transport plus keepalive.

## Step 6: Kill Switch 3 Codex MCP Liveness

Codex liveness was verified earlier in Day 2, but Day 7 must re-confirm it.

Procedure:

1. Restart Codex CLI.
2. Open `examples/werewolf-minigame-stub`.
3. Run Codex's MCP `tools/list` equivalent.
4. Confirm all three Fabric tools are listed:
   - `fab_get_rules`
   - `fab_append_intent`
   - `fab_update_registry`
5. Record the result in `docs/day7-kill-switch-tracking.md`.

Success criterion:

```text
Codex tools/list includes all 3 Fabric tools.
```

Failure response:

- If `tools/list` fails or any Fabric tool is missing, mark KS-3 failed.
- Use the fallback plan from Brainstorm Section 6: Codex degrades to native `AGENTS.md` reading.

## Rollback Procedure if KS-1 Fails

If KS-1 call rate is below 60%, stop the Day 7 validation and do not continue to outer-track testing.

Apply this remediation plan in a separate implementation task:

1. Add a `fab_write_file` MCP gate.
2. Require `fab_write_file` to reject writes unless `fab_get_rules` has been called in the same session for the target path.
3. Modify Fabric tool descriptions with a stronger `MANDATORY` prefix.
4. Revisit the five-line breathing prompt from Brainstorm Section 4.2.
5. Re-run the full 30-attempt KS-1 sample after the remediation is implemented.

Do not mark Day 7 as passed until KS-1, KS-2, and KS-3 all pass.
