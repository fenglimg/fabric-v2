#!/usr/bin/env node
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const forensicPath = join(process.cwd(), ".fabric", "forensic.json");
const initContextPath = join(process.cwd(), ".fabric", "init-context.json");

if (!existsSync(forensicPath) || existsSync(initContextPath)) {
  process.exit(0);
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      additionalContext:
        "这个仓库的 Fabric 初始化还没完成。继续操作前，请先查看 .fabric/forensic.json 和 .fabric/bootstrap/README.md，并使用仓库内的 .codex/skills/fabric-init/SKILL.md。若 Codex hooks 没有触发，请确认配置里已启用 features.codex_hooks = true。",
    },
  }),
);
