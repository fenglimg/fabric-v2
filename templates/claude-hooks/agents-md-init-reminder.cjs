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
      "fab init 已完成证据收集，但项目 AGENTS.md 初始化尚未完成。调用 agents-md-init skill (通过 Skill 工具) 完成 3 阶段初始化访谈。参考: .claude/skills/agents-md-init/SKILL.md + .fabric/forensic.json",
  }),
);
