# Day 4 Pre-commit Pipeline 测试

本测试计划验证 Day 4 pre-commit 三重：

1. `fab sync-meta --check-only`
2. `fab human-lint`
3. `fab ledger-append --staged`

同时验证 `.fabric/agents.meta.json` 手工编辑 guard，以及在 trivial diff 上 `<300ms` 的 timing 目标。

## 前置条件

- 在 Fabric 仓库根目录运行。
- 测试前构建 CLI：`pnpm --filter @fenglimg/fabric-cli build`
- 使用 disposable local repository 进行 hook 检查。

## Scenario A：新仓库通过并追加 Ledger

1. 创建临时仓库并初始化：

   ```bash
   mkdir /tmp/fabric-day4
   cd /tmp/fabric-day4
   git init
   printf '{\n  "name": "fabric-day4",\n  "private": true\n}\n' > package.json
   node /Users/wepie/Desktop/personal-projects/pcf/packages/cli/dist/index.js init --target .
   node /Users/wepie/Desktop/personal-projects/pcf/packages/cli/dist/index.js hooks install --target .
   printf 'demo\n' > README.md
   git add .
   ```

2. 直接运行 hook：

   ```bash
   ./.husky/pre-commit
   ```

3. 预期结果：
   - Exit code 为 `0`。
   - 存在 `.intent-ledger.jsonl`。
   - `git diff --cached --name-only` 包含 `.intent-ledger.jsonl`。

4. 预期终端输出：

   ```text
   Installed /tmp/fabric-day4/.husky/pre-commit
   Added prepare script to /tmp/fabric-day4/package.json
   ```

5. 检查 ledger：

   ```bash
   cat .intent-ledger.jsonl
   ```

6. 预期 JSON 行形态：

   ```json
   {"ts":1713410000000,"parent_sha":"root","intent":"auto: README.md","affected_paths":["README.md"],"diff_stat":" README.md | 1 +\n 1 file changed, 1 insertion(+)"}
   ```

## Scenario B：Locked Human Section Drift 阻止 Commit

1. 将 `.fabric/human-lock.json` 替换为指向 `AGENTS.md` 的真实 lock entry：

   ```bash
   node <<'EOF'
   const { createHash } = require("node:crypto");
   const { readFileSync, writeFileSync } = require("node:fs");
   const content = readFileSync("AGENTS.md", "utf8").split(/\r?\n/).slice(16, 20).join("\n");
   const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
   writeFileSync(".fabric/human-lock.json", JSON.stringify({
     $schema: "https://fabric.local/schemas/human-lock.json",
     locked: [{ file: "AGENTS.md", start_line: 17, end_line: 20, hash }],
     examples: []
   }, null, 2) + "\n");
   EOF
   git add .fabric/human-lock.json AGENTS.md
   ```

2. 在锁定范围内编辑一行并 stage：

   ```bash
   perl -0pi -e 's/AI must not rewrite locked sentences\./AI must never rewrite locked sentences./' AGENTS.md
   git add AGENTS.md
   ./.husky/pre-commit
   ```

3. 预期结果：
   - Exit code 为 `1`。
   - 在 `ledger-append` 之前 commit 被阻止。

4. 预期终端输出包含：

   ```text
   Human-locked content drift detected. Revert the edit or update approved hashes before committing.
   Location                         Expected            Got
   AGENTS.md:17-20                 sha256:...          sha256:...
   ```

## Scenario C：手工编辑 `agents.meta.json` 被阻止

1. 直接编辑 `.fabric/agents.meta.json` 并 stage：

   ```bash
   perl -0pi -e 's/"priority": "high"/"priority": "low"/' .fabric/agents.meta.json
   git add .fabric/agents.meta.json
   ./.husky/pre-commit
   ```

2. 无 override 时的预期结果：
   - Exit code 为 `1`。
   - Guard message 打印到 `stderr`。

3. 预期终端输出：

   ```text
   .fabric/agents.meta.json cannot be manually edited; use fab_update_registry
   ```

4. Override 检查：

   ```bash
   FAB_ALLOW_META_EDIT=1 ./.husky/pre-commit
   ```

5. Override 预期结果：
   - Hook 越过 guard 继续。
   - 若无其他 drift，exit code 为 `0`。

## Scenario D：Timing Budget 保持在 300ms 以下

1. Reset 到 trivial staged diff：

   ```bash
   git reset
   printf 'tiny\n' >> README.md
   git add README.md
   ```

2. 测量 hook 运行时间：

   ```bash
   time ./.husky/pre-commit
   ```

3. 预期结果：
   - 在已预热的本地机器上，trivial diff 的总 wall-clock 时间应低于 `0.300s`。

4. 预期 `time` 输出形态：

   ```text
   real    0m0.2xxs
   user    0m0.xxxs
   sys     0m0.xxxs
   ```

## 备注

- 首次 commit 时 `ledger-append` 使用 `parent_sha: "root"`，因为 `HEAD` 尚不存在。
- 若 Scenario C 过早失败并提示 `meta drift; run: fab sync-meta`，运行 `fab sync-meta`，重新 stage `.fabric/agents.meta.json`，再重跑 guard 检查。
- Hook template 由 `fab hooks install` 以 mode `755` 写入；安装后无需手工 `chmod`。
