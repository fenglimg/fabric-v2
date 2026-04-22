# Day 7 Outer Track：真实狼人杀项目 操作手册

本 runbook 针对真实项目 `/Users/wepie/Desktop/projects/werewolf-minigame/` 验证 Fabric。

## 严重警告

该项目已包含用户创建的私有 `.claude/`、`.cursor/`、`.codex/` config。Fabric **必须保留**它们。**不要**运行破坏性命令。若任一步骤修改既有私有 config 文件，**立即停止**并通知用户。

除非某步骤显式允许 Fabric 拥有的 additive write，否则将 `/Users/wepie/Desktop/projects/werewolf-minigame/` 视为只读。切勿删除、reset、重写、重新格式化或替换私有 user configuration。

## 前置条件

- Fabric MVP 在 `/Users/wepie/Desktop/personal-projects/pcf` 已构建。
- 真实项目在 `/Users/wepie/Desktop/projects/werewolf-minigame/` 可访问。
- 操作者在任何真实写入步骤前有明确批准。
- 从干净或已充分理解的真实项目 worktree 开始：

  ```bash
  cd /Users/wepie/Desktop/projects/werewolf-minigame
  git status --short
  ```

- 若 `git status --short` 显示无关用户工作，测试前先记录且不要覆盖。
- 设置共享变量：

  ```bash
  FABRIC_REPO="/Users/wepie/Desktop/personal-projects/pcf"
  REAL_TARGET="/Users/wepie/Desktop/projects/werewolf-minigame"
  ```

## Phase A：Dry-Run Scan 与 Private Config 检测

Task intent 命令：

```bash
EXTERNAL_FIXTURE_PATH=/Users/wepie/Desktop/projects/werewolf-minigame node "$FABRIC_REPO/packages/cli/dist/index.js" scan --debug
```

当前 CLI 说明：

- `--target` 后不要传空值；预期行为是让 `EXTERNAL_FIXTURE_PATH` 提供 target。
- `fab scan` 为只读，当前使用 `--debug` 与可选 `--json`；不需要破坏性 dry-run mode。

在 Fabric 仓库使用以下只读等价命令：

```bash
cd "$FABRIC_REPO"
EXTERNAL_FIXTURE_PATH="$REAL_TARGET" node "$FABRIC_REPO/packages/cli/dist/index.js" scan --debug --json
```

预期 scan diagnostics：

```json
{
  "framework": {
    "kind": "cocos-creator",
    "evidence": ["project.config.json"]
  },
  "readmeQuality": "ok"
}
```

预期操作者观察：

- `framework.kind` 为 `cocos-creator`。
- Detector evidence 包含 `project.config.json`。
- `fileCount` 报告已处理文件数。
- `ignoredCount` 报告被忽略条目数。
- 真实项目中存在既有 `docs/` 文件夹。
- `.claude/` 检测为 private，scan 期间不得修改。
- `.cursor/` 检测为 private，scan 期间不得修改。
- `.codex/` 检测为 private，scan 期间不得修改。
- 记录备注：`private - will not be modified`。

中止条件：

- Scan 尝试写入任何文件。
- Scan 输出指示非 Cocos framework。
- 既有 private config 目录意外缺失。

## Phase B：Performance Benchmark

运行只读 timing 检查：

```bash
cd "$FABRIC_REPO"
EXTERNAL_FIXTURE_PATH="$REAL_TARGET" time node "$FABRIC_REPO/packages/cli/dist/index.js" scan --debug
```

预期结果：

- Wall-clock time `<10s`。
- `Framework: cocos-creator`。
- `Files counted: <processed file count>`。
- `Ignored entries: <ignoredCount>`。
- 因 Cocos asset 树可能含数千 `.meta` sidecar，`ignoredCount` 预期较高。

记录：

| Metric | Value |
|---|---|
| Wall-clock time |  |
| Processed file count |  |
| ignoredCount |  |
| 关于被忽略 `.meta` 文件的 Notes |  |

中止条件：

- Scan 超过 `10s`。
- `ignoredCount` 对已知 Cocos asset 树明显过低。
- Scan 遍历了本应忽略的 generated 或 dependency 目录。

## Phase C：Client Config 的 Dual-Write Safety

本阶段安全关键：真实项目含私有 user config。在 dry-run 与 visual diff plan 审阅前不要运行真实 install。

1. 进入真实项目：

   ```bash
   cd "$REAL_TARGET"
   ```

2. 在任何写入前检查私有 config 目录：

   ```bash
   git status --short -- .claude .cursor .codex .windsurf .roo GEMINI.md CLAUDE.md AGENTS.md
   ```

3. Dry-run MCP config installation：

   ```bash
   FAB_SERVER_PATH="$FABRIC_REPO/packages/server/dist/index.js" \
     node "$FABRIC_REPO/packages/cli/dist/index.js" config install --clients claude,cursor,windsurf,roo,gemini,codex --dry-run
   ```

4. 预期 dry-run 输出形态：

   ```text
   [dry-run] ClaudeCodeCLI: would write ...
   [dry-run] Cursor: would write ...
   [dry-run] Windsurf: would write ...
   [dry-run] RooCode: would write ...
   [dry-run] GeminiCLI: would write ...
   [dry-run] CodexCLI: would write ...
   ```

5. 真实 install 前，目视确认计划写入：
   - 不会 wholesale 替换任何私有文件。
   - 既有 `mcpServers` entry 将保留。
   - 仅添加或更新 `mcpServers.fabric` 或 `[mcp_servers.fabric]`。
   - 在可能范围内，既有非 Fabric key 保持 byte-for-byte。

6. 当且仅当用户批准 additive config writes 时运行：

   ```bash
   FAB_SERVER_PATH="$FABRIC_REPO/packages/server/dist/index.js" \
     node "$FABRIC_REPO/packages/cli/dist/index.js" config install --clients claude,cursor,windsurf,roo,gemini,codex
   ```

7. 立即验证 diff：

   ```bash
   git diff -- .claude .cursor .codex .windsurf .roo GEMINI.md CLAUDE.md AGENTS.md
   ```

8. 预期 diff：
   - 对 JSON client 为 additive `mcpServers.fabric` entry。
   - 对 Codex TOML 为 additive `[mcp_servers.fabric]` entry。
   - 不删除既有 `mcpServers` entry。
   - 不删除私有 user settings。
   - config file format writer 正常序列化之外，无不相关 formatting churn。

9. 若任一既有私有 config 出现破坏性变更、移除 key、无关重写或意外 normalization，**立即停止**。

## Phase D：AGENTS.md 与 Sync-Meta

本阶段在不覆盖既有 human-maintained `AGENTS.md` 的前提下验证 Fabric metadata。

1. 进入真实项目：

   ```bash
   cd "$REAL_TARGET"
   ```

2. 非破坏性 `fab init` guard：

   ```bash
   test -e AGENTS.md && echo "SKIP fab init: AGENTS.md already exists"
   test -d .fabric && echo "SKIP fab init: .fabric already exists"
   ```

3. 若 `AGENTS.md` 或 `.fabric/` 已存在，跳过 `fab init`。不要覆盖。

4. 若两者都不存在且用户批准 additive Fabric 文件，运行：

   ```bash
   node "$FABRIC_REPO/packages/cli/dist/index.js" init --target "$REAL_TARGET"
   ```

5. 预期 `fab init` 输出形态：

   ```text
   Created /Users/wepie/Desktop/projects/werewolf-minigame/AGENTS.md
   Created /Users/wepie/Desktop/projects/werewolf-minigame/.fabric/agents.meta.json
   Created /Users/wepie/Desktop/projects/werewolf-minigame/.fabric/human-lock.json
   Next: run fab hooks install to add the Day 4 pre-commit pipeline.
   ```

6. 仅在已批准的 Fabric scope 内、且 path 尚不存在时创建临时测试 `AGENTS.md`。推荐 probe：

   ```bash
   test -e docs/day7-sync-meta-probe/AGENTS.md && echo "SKIP probe: docs/day7-sync-meta-probe/AGENTS.md already exists"
   mkdir -p docs/day7-sync-meta-probe
   printf '# Day 7 Sync Meta Probe\n' > docs/day7-sync-meta-probe/AGENTS.md
   node "$FABRIC_REPO/packages/cli/dist/index.js" sync-meta --target "$REAL_TARGET"
   ```

7. 预期 sync-meta 结果：

   ```text
   Updated /Users/wepie/Desktop/projects/werewolf-minigame/.fabric/agents.meta.json
   ```

8. 验证 `.fabric/agents.meta.json` 包含 `docs/day7-sync-meta-probe/AGENTS.md` 的节点，然后仅通过 rollback procedure 或显式批准的 cleanup 移除 probe。

中止条件：

- `fab init` 覆盖既有 `AGENTS.md`。
- `fab init` 覆盖既有 `.fabric/`。
- `sync-meta` 意外移除既有 metadata node。

## Phase E：Pre-Commit 行为与既有 Husky Hooks

真实项目可能已有 `.husky/` hooks。Fabric 必须与之共存。

1. 检查既有 hooks：

   ```bash
   cd "$REAL_TARGET"
   test -d .husky && find .husky -maxdepth 1 -type f -print
   test -f .husky/pre-commit && sed -n '1,200p' .husky/pre-commit
   ```

2. 若 `.husky/pre-commit` 已存在，优先在真实项目的 disposable copy 上测试 hook 行为。

3. 仅在 disposable copy 上或经用户显式批准后执行既有 hook 安全检查：

   ```bash
   cp .husky/pre-commit /tmp/werewolf-minigame-pre-commit.before
   shasum .husky/pre-commit
   node "$FABRIC_REPO/packages/cli/dist/index.js" hooks install --target "$REAL_TARGET"
   git diff -- .husky/pre-commit package.json
   ```

4. 预期既有 hook 结果：
   - 既有 hook 命令仍存在。
   - Fabric 命令被 append 或以其他方式组合。
   - Hook 未被 wholesale 替换。
   - 若存在既有 `prepare` script，保持不变。

5. 若不存在 `.husky/pre-commit` 且用户批准 additive hook install，运行：

   ```bash
   node "$FABRIC_REPO/packages/cli/dist/index.js" hooks install --target "$REAL_TARGET"
   ```

6. 预期输出形态：

   ```text
   Installed /Users/wepie/Desktop/projects/werewolf-minigame/.husky/pre-commit
   Added prepare script to /Users/wepie/Desktop/projects/werewolf-minigame/package.json
   ```

   或若 `prepare` 已存在：

   ```text
   Installed /Users/wepie/Desktop/projects/werewolf-minigame/.husky/pre-commit
   Left existing prepare script unchanged in /Users/wepie/Desktop/projects/werewolf-minigame/package.json
   ```

7. 验证 hook composition：

   ```bash
   git diff -- .husky/pre-commit package.json
   ```

8. 预期 diff：
   - 若曾存在 hook，保留既有 hook 内容。
   - Fabric 命令被 append 或组合。
   - 若存在，保留既有 `prepare` script。

中止条件：

- 覆盖既有 `.husky/pre-commit`。
- 既有 hook 命令消失。
- 意外移除或重新格式化既有 `package.json` scripts。

## 中止条件

若任一步骤导致以下情况，**停止**并 revert：

- 修改 `AGENTS.md`、`.fabric/`、`.intent-ledger.jsonl` 或已批准的 bootstrap/config 文件之外的任何文件。
- 对 `.claude/`、`.cursor/`、`.codex/`、`.windsurf/`、`.roo/`、`CLAUDE.md`、`GEMINI.md` 或 `AGENTS.md` 的破坏性修改。
- 删除既有私有 settings。
- 丢失既有 `mcpServers` entry。
- Phase A 或 Phase B 期间的任何写入。
- Phase E 中的 hook wholesale 覆盖。

任何 abort 后，在继续前通知用户。

## 回滚流程

不要盲目运行 rollback 命令。先审阅 `git status --short`，且仅 revert 用户批准的 Fabric Day 7 变更。

1. 检查当前变更：

   ```bash
   cd "$REAL_TARGET"
   git status --short
   git diff -- AGENTS.md .fabric .intent-ledger.jsonl CLAUDE.md GEMINI.md .claude .cursor .codex .windsurf .roo .husky package.json
   ```

2. Revert Day 7 创建的 tracked file 变更：

   ```bash
   git restore --worktree --staged -- AGENTS.md .intent-ledger.jsonl CLAUDE.md GEMINI.md package.json
   git restore --worktree --staged -- .claude .cursor .codex .windsurf .roo .husky .fabric
   ```

3. 在确认非用户编写后，移除 Day 7 创建的 untracked Fabric 文件：

   ```bash
   git clean -fd -- AGENTS.md .fabric .intent-ledger.jsonl CLAUDE.md GEMINI.md
   git clean -fd -- docs/day7-sync-meta-probe
   git clean -fd -- .cursor/rules/fabric-bootstrap.mdc .windsurf/rules/fabric.md .roo/rules/fabric.md
   ```

4. 验证 rollback 干净：

   ```bash
   git status --short
   ```

5. 若 rollback 会触及既有用户文件，停止并请用户选择要 restore 的确切文件。
