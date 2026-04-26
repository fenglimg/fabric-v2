import { describe, expect, it } from "vitest";

import { validateBootstrapFile } from "../../../scripts/lint-protected-tokens.ts";

const VALID_BOOTSTRAP_CORE = `# Fabric Bootstrap

## CORE RULES (DO NOT TRANSLATE)

MUST: Treat this file as the Fabric Protocol bootstrap for this repository.
MUST: Before ANY code reading, architecture planning, or logic modification, call the MCP tool \`fab_plan_context(paths=[<target file>])\`, then call \`fab_get_rule_sections\` with selected L1 stable_ids before editing.
MUST: Treat \`.fabric/events.jsonl\` as the automatic typed Event Ledger; MCP tools, \`fabric doctor --fix\`, and \`fabric sync-meta\` write records without manual \`ledger_entry\` calls.
MUST: When creating or changing an L1/L2 rule node, update rule sources and run \`fabric sync-meta\` or \`fabric doctor --fix\`; keep \`.fabric/agents.meta.json\` as the generated \`agent_meta\` baseline.
MUST: Stop and ask the human before editing any \`@HUMAN\` protected range listed in \`.fabric/human-lock.json\`.
MUST: Preserve protected tokens exactly: \`AGENTS.md\`, \`FABRIC.md\`, \`.fabric/agents/\`, \`.fabric/agents.meta.json\`, \`.fabric/human-lock.json\`, \`.fabric/events.jsonl\`, \`ledger_entry\`, \`agent_meta\`, \`shadow constraints\`, \`Shadow Mirroring\`, \`MUST\`, \`NEVER\`.
NEVER: Translate, rename, or paraphrase MCP tool names, JSON keys, file paths, or the keywords \`MUST\` and \`NEVER\`.
NEVER: Reason about or modify code before obtaining local shadow constraints via MCP.
NEVER: Edit \`.fabric/agents.meta.json\` directly.
NEVER: Ignore stale, human-lock, doctor, or sync-meta warnings returned by Fabric tools.

## 使用说明 / Explanation

- test
`;

describe("lint-protected-tokens stable-id headers", () => {
  it("accepts a leading fab:rule-id comment header", () => {
    const source = `<!-- fab:rule-id bootstrap/codex -->\n${VALID_BOOTSTRAP_CORE}`;

    expect(validateBootstrapFile("/tmp/AGENTS.md", source)).toEqual([]);
  });

  it("rejects bootstrap files without a leading fab:rule-id comment header", () => {
    const source = VALID_BOOTSTRAP_CORE;

    expect(validateBootstrapFile("/tmp/AGENTS.md", source)).toContainEqual({
      filePath: "/tmp/AGENTS.md",
      message: "missing leading '<!-- fab:rule-id <stable-id> -->' header comment",
    });
  });

  it("accepts a fab:rule-id header immediately after frontmatter", () => {
    const source = `---\nalwaysApply: true\ndescription: Fabric Protocol bootstrap rules\n---\n<!-- fab:rule-id bootstrap/cursor -->\n${VALID_BOOTSTRAP_CORE}`;

    expect(validateBootstrapFile("/tmp/cursor-fabric-bootstrap.mdc", source)).toEqual([]);
  });
});
