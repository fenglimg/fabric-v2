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
    decision: "block",
    reason:
      "fab init 已经收集完当前仓库的初始化依据，但后续初始化还没完成。请先确认 Codex 已启用 features.codex_hooks = true，然后查看 .fabric/forensic.json 和 .fabric/bootstrap/README.md，并使用仓库内的 .agents/skills/fabric-init/SKILL.md 继续初始化。",
  }),
);
