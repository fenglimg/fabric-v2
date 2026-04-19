# Day 7 Inner Track：Stub E2E 操作手册

本 runbook 针对 disposable fixture `examples/werewolf-minigame-stub` 验证 Fabric。这是操作清单；结果记录在 `docs/day7-kill-switch-tracking.md`。

不要对 `/Users/wepie/Desktop/projects/werewolf-minigame/` 运行这些步骤。该项目由 outer-track runbook 覆盖。

## 前置条件

- 在 Fabric 仓库根目录运行：`/Users/wepie/Desktop/personal-projects/pcf`。
- 使用 disposable target：`examples/werewolf-minigame-stub`。
- 确认六种 client 已安装或可用于手工测试：
  - Claude Code
  - Cursor
  - Windsurf
  - Roo Code
  - Gemini CLI
  - Codex CLI
- 在开始手工 client 检查前构建 Fabric：

  ```bash
  pnpm install
  pnpm -r build
  pnpm -C packages/server bundle
  ```

- 预期 build artifact：
  - 存在 `packages/cli/dist/index.js`。
  - 存在 `packages/server/dist/index.js`。
  - 若当前 workspace 无 `pnpm -C packages/server bundle`，停止并在继续前与 maintainer 确认 Day 7 build 命令。

## Step 1：初始化并扫描 Stub

1. 一次性设置 target path：

   ```bash
   STUB_TARGET="$PWD/examples/werewolf-minigame-stub"
   ```

2. 在 stub 上初始化 Fabric：

   ```bash
   pnpm -C packages/cli exec fab init --target ./examples/werewolf-minigame-stub
   ```

   若使用 `pnpm -C packages/cli` 时 path 解析失败，使用绝对 target：

   ```bash
   pnpm -C packages/cli exec fab init --target "$STUB_TARGET"
   ```

3. 预期 `fab init` 输出形态：

   ```text
   Created .../examples/werewolf-minigame-stub/AGENTS.md
   Created .../examples/werewolf-minigame-stub/.fabric/agents.meta.json
   Created .../examples/werewolf-minigame-stub/.fabric/human-lock.json
   Next: run fab hooks install to add the Day 4 pre-commit pipeline.
   ```

4. 扫描 stub 并请求 JSON diagnostics：

   ```bash
   fab scan --target ./examples/werewolf-minigame-stub --json --debug
   ```

   等价的 CLI package 调用：

   ```bash
   pnpm -C packages/cli exec fab scan --target "$STUB_TARGET" --json --debug
   ```

5. 预期 JSON diagnostic：

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

6. 验收说明：
   - `framework.kind` 必须为 `cocos-creator`。
   - `framework.evidence` 应包含 `project.config.json`。
   - 对刻意精简的 fixture README，`readmeQuality` 可为 `stub`；若 README 已扩展可为 `ok`。
   - `ignoredCount` 应包含 Cocos `.meta` sidecar 文件。

## Step 2：为 Stub 安装 Bootstrap 与 MCP Config

1. 进入 stub，使 workspace-local client 文件写在 fixture 下：

   ```bash
   cd "$STUB_TARGET"
   ```

2. 安装全部六种 bootstrap prompts：

   ```bash
   FABRIC_REPO="/Users/wepie/Desktop/personal-projects/pcf"
   node "$FABRIC_REPO/packages/cli/dist/index.js" bootstrap install --clients claude,cursor,windsurf,roo,gemini,codex
   ```

3. 预期 bootstrap 输出形态：

   ```text
   Installed .../CLAUDE.md
   Installed .../.cursor/rules/fabric-bootstrap.mdc
   Installed .../.windsurf/rules/fabric.md
   Installed .../.roo/rules/fabric.md
   Installed .../GEMINI.md
   Prepended .../AGENTS.md
   ```

4. 预览 MCP config 写入：

   ```bash
   FAB_SERVER_PATH="$FABRIC_REPO/packages/server/dist/index.js" \
     node "$FABRIC_REPO/packages/cli/dist/index.js" config install --clients claude,cursor,windsurf,roo,gemini,codex --dry-run
   ```

5. 预期 dry-run 输出形态：

   ```text
   [dry-run] ClaudeCodeCLI: would write ...
   [dry-run] Cursor: would write .../.cursor/mcp.json
   [dry-run] Windsurf: would write .../.windsurf/mcp.json
   [dry-run] RooCode: would write .../.roo/mcp.json
   [dry-run] GeminiCLI: would write ...
   [dry-run] CodexCLI: would write ...
   ```

6. 安装 MCP config entry：

   ```bash
   FAB_SERVER_PATH="$FABRIC_REPO/packages/server/dist/index.js" \
     node "$FABRIC_REPO/packages/cli/dist/index.js" config install --clients claude,cursor,windsurf,roo,gemini,codex
   ```

7. 预期 install 输出形态：

   ```text
   ClaudeCodeCLI: wrote ...
   Cursor: wrote .../.cursor/mcp.json
   Windsurf: wrote .../.windsurf/mcp.json
   RooCode: wrote .../.roo/mcp.json
   GeminiCLI: wrote ...
   CodexCLI: wrote ...
   ```

8. 中止条件：
   - 任何 client config 丢失既有非 Fabric settings。
   - 任何既有 `mcpServers` entry（`fabric` 以外）消失。
   - `FAB_SERVER_PATH` 未指向 `packages/server/dist/index.js`。

## Step 3：六 Client Smoke Loop

每个 client 运行五次尝试。每次尝试记录在 `docs/day7-kill-switch-tracking.md`。

对每个 client：

1. 重启 client 以重新加载 MCP configuration。
2. 打开或导航到 `examples/werewolf-minigame-stub`。
3. 若 client 有 tools 视图，确认可见 Fabric MCP tools。
4. 给出完全相同的任务：

   ```text
   Add a Timer.ts component to this Cocos Creator stub.
   ```

5. 观察 AI 是否在创建或编辑文件之前调用 `fab_get_rules`。
6. 记录：
   - Client
   - Attempt number
   - Task given
   - 是否调用 `fab_get_rules`？`Y` 或 `N`
   - Time-to-first-tool-call
   - Notes
7. 在尝试之间 revert fixture 改动，使每次尝试从相同状态开始。

Client checklist：

| Client | Stub Directory | Task Given | Evidence to Capture |
|---|---|---|---|
| Claude Code | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | Tool-call transcript 或 screenshot |
| Cursor | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | Composer/agent log |
| Windsurf | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | Cascade/tool log |
| Roo Code | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | Roo tool trace |
| Gemini CLI | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | CLI transcript |
| Codex CLI | `examples/werewolf-minigame-stub` | `Add a Timer.ts component to this Cocos Creator stub.` | CLI transcript |

## Step 4：Kill Switch 1 Tracking Sheet

使用 `docs/day7-kill-switch-tracking.md` 中的 canonical table。

最小样本量：

- 6 clients
- 每个 client 5 次尝试
- 共 30 次尝试

成功判据：

```text
fab_get_rules call rate >= 60%
```

计算：

```text
call_rate = attempts_with_fab_get_rules / 30
```

通过示例：

```text
18 / 30 = 60%: PASS
```

失败示例：

```text
17 / 30 = 56.7%: KS-1 FAIL
```

## Step 5：Kill Switch 2 Stdio Latency

测量每次观察到的 `fab_get_rules` 调用。

流程：

1. 为每次 `fab_get_rules` 调用包裹或打时间戳：
   - 在 tool call 发送前立即记录 start time。
   - 在 client 可见 tool result 后立即记录 end time。
2. 以毫秒为单位将 latency 记入 `docs/day7-kill-switch-tracking.md`。
3. 全部尝试结束后计算 p95。

成功判据：

```text
p95(fab_get_rules latency) < 2000ms
```

失败响应：

- 若 p95 `>= 2000ms`，标记 KS-2 失败。
- 在采样期间不要调优 client 行为。
- 打开 follow-up task 评估 HTTP transport 与 keepalive。

## Step 6：Kill Switch 3 Codex MCP Liveness

Codex liveness 在 Day 2 已验证过，但 Day 7 必须再次确认。

流程：

1. 重启 Codex CLI。
2. 打开 `examples/werewolf-minigame-stub`。
3. 运行 Codex 的 MCP `tools/list` 等价操作。
4. 确认列出全部三种 Fabric tools：
   - `fab_get_rules`
   - `fab_append_intent`
   - `fab_update_registry`
5. 将结果记入 `docs/day7-kill-switch-tracking.md`。

成功判据：

```text
Codex tools/list includes all 3 Fabric tools.
```

失败响应：

- 若 `tools/list` 失败或缺少任一 Fabric tool，标记 KS-3 失败。
- 使用 Brainstorm Section 6 的 fallback plan：Codex 降级为原生读取 `AGENTS.md`。

## 若 KS-1 失败的 Rollback Procedure

若 KS-1 call rate 低于 60%，停止 Day 7 验证，不要继续 outer-track testing。

在单独的 implementation task 中应用以下 remediation plan：

1. 增加 `fab_write_file` MCP gate。
2. 要求 `fab_write_file` 除非在同 session 已对 target path 调用过 `fab_get_rules`，否则拒绝写入。
3. 用更强的 `MANDATORY` 前缀修改 Fabric tool descriptions。
4. 回顾 Brainstorm Section 4.2 的 five-line breathing prompt。
5. remediation 实现后重新跑完整 30 次 KS-1 采样。

在 KS-1、KS-2、KS-3 全部通过前，不要将 Day 7 标为通过。
