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
        "Fabric initialization is still pending in this repository. Read .fabric/forensic.json, .fabric/bootstrap/README.md, and use the repo skill at .codex/skills/fabric-init/SKILL.md before proceeding. If Codex hooks are not firing, ensure features.codex_hooks = true is enabled in your Codex config.",
    },
  }),
);
