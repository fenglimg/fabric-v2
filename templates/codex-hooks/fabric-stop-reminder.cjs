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
      "fab init has collected Fabric evidence, but initialization follow-up is still pending. Ensure features.codex_hooks = true is enabled, then use the repo skill at .codex/skills/fabric-init/SKILL.md and review .fabric/forensic.json plus .fabric/bootstrap/README.md before continuing.",
  }),
);
