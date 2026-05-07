import { existsSync, readFileSync } from "node:fs";
import { join, parse } from "node:path";

import { detectFramework } from "../detector.js";

export const FABRIC_BOOTSTRAP_PATH = ".fabric/bootstrap/README.md";

/**
 * Build the content for .fabric/bootstrap/README.md.
 *
 * Produces the same structured bootstrap guide that `fab init` writes, using
 * the detected framework kind and the project name from package.json.  This
 * lives in shared so both the CLI and the server doctor --fix path can use the
 * identical builder.
 */
export function buildBootstrapContent(projectRoot: string): string {
  const framework = detectFramework(projectRoot);
  const projectName = readProjectName(projectRoot) ?? parse(projectRoot).base;
  const frameworkKind = framework.kind;

  const content = `# ${projectName} — Fabric Bootstrap Protocol

## CORE RULES (DO NOT TRANSLATE)

MUST: Treat this file as the Fabric Protocol bootstrap for this repository.
MUST: Treat \`.fabric/rules/\` as the source of truth for all Fabric rule bodies.
MUST: Before ANY code reading, architecture planning, or logic modification, call \`fab_plan_context(paths=[<target file>])\`, then call \`fab_get_rule_sections\`.
MUST: When creating or changing an L1/L2 rule node, keep \`.fabric/agents.meta.json\` synchronized through Fabric tooling.
MUST: Preserve protected tokens exactly: \`AGENTS.md\`, \`.fabric/rules/\`, \`.fabric/agents.meta.json\`, \`fab_plan_context\`, \`fab_get_rule_sections\`, \`rule sources\`, \`rule source mirroring\`, \`MUST\`, \`NEVER\`.
NEVER: Add import-style directive lines to this bootstrap file.
NEVER: Put framework, domain, repository rule bodies, or submodule rules in this file.
NEVER: Create colocated \`AGENTS.md\` rule files under source directories.

## Usage

- This file bootstraps the Fabric Protocol; it does not carry project-specific rules.
- Detailed bootstrap notes are in \`.fabric/bootstrap/README.md\`.
- Detected framework kind: \`${frameworkKind}\`.
- This repository uses \`rule source mirroring\`: source directories contain ZERO rule files, while \`.fabric/rules/\` mirrors source paths for AI constraints.
- Root-level rules belong in \`.fabric/rules/root.md\`; cross-domain rules in \`.fabric/rules/_cross/\`.
- If \`.fabric/rules/root.md\` is missing, complete the Fabric initialization flow before normal coding.
`;

  return content;
}

function readProjectName(projectRoot: string): string | undefined {
  const packageJsonPath = join(projectRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
    return typeof raw.name === "string" && raw.name.length > 0 ? raw.name : undefined;
  } catch {
    return undefined;
  }
}
