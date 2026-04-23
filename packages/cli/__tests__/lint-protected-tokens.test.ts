import { describe, expect, it } from "vitest";

import { validateBootstrapFile } from "../../../scripts/lint-protected-tokens.ts";

describe("lint-protected-tokens stable-id headers", () => {
  it("accepts a leading fab:rule-id comment header", () => {
    const source = `<!-- fab:rule-id bootstrap/codex -->\n# Fabric Bootstrap\n\n## CORE RULES (DO NOT TRANSLATE)\n\nMUST: Treat this file as the Fabric Protocol bootstrap for this repository.\nMUST: Before ANY code reading, architecture planning, or logic modification, call the MCP tool \`fab_get_rules(path=<target file>)\` to retrieve shadow constraints from \`.fabric/agents/\`.\nMUST: When creating or changing an L1/L2 rule node, call \`fab_update_registry\`; keep \`.fabric/agents.meta.json\` synchronized through the tool.\nMUST: Stop and ask the human before editing any \`@HUMAN\` protected range listed in \`.fabric/human-lock.json\`.\nMUST: After each complete task, call \`fab_append_intent\` to write one intent ledger entry.\nMUST: Preserve protected tokens exactly: \`AGENTS.md\`, \`FABRIC.md\`, \`.fabric/agents/\`, \`.fabric/agents.meta.json\`, \`.fabric/human-lock.json\`, \`ledger_entry\`, \`agent_meta\`, \`shadow constraints\`, \`Shadow Mirroring\`, \`MUST\`, \`NEVER\`.\nNEVER: Translate, rename, or paraphrase MCP tool names, JSON keys, file paths, or the keywords \`MUST\` and \`NEVER\`.\nNEVER: Reason about or modify code before obtaining local shadow context via MCP.\nNEVER: Edit \`.fabric/agents.meta.json\` directly.\nNEVER: Ignore stale or human-lock warnings returned by Fabric tools.\n\n## 使用说明 / Explanation\n\n- test\n`;

    expect(validateBootstrapFile("/tmp/AGENTS.md", source)).toEqual([]);
  });

  it("rejects bootstrap files without a leading fab:rule-id comment header", () => {
    const source = `# Fabric Bootstrap\n\n## CORE RULES (DO NOT TRANSLATE)\n\nMUST: Treat this file as the Fabric Protocol bootstrap for this repository.\nMUST: Before ANY code reading, architecture planning, or logic modification, call the MCP tool \`fab_get_rules(path=<target file>)\` to retrieve shadow constraints from \`.fabric/agents/\`.\nMUST: When creating or changing an L1/L2 rule node, call \`fab_update_registry\`; keep \`.fabric/agents.meta.json\` synchronized through the tool.\nMUST: Stop and ask the human before editing any \`@HUMAN\` protected range listed in \`.fabric/human-lock.json\`.\nMUST: After each complete task, call \`fab_append_intent\` to write one intent ledger entry.\nMUST: Preserve protected tokens exactly: \`AGENTS.md\`, \`FABRIC.md\`, \`.fabric/agents/\`, \`.fabric/agents.meta.json\`, \`.fabric/human-lock.json\`, \`ledger_entry\`, \`agent_meta\`, \`shadow constraints\`, \`Shadow Mirroring\`, \`MUST\`, \`NEVER\`.\nNEVER: Translate, rename, or paraphrase MCP tool names, JSON keys, file paths, or the keywords \`MUST\` and \`NEVER\`.\nNEVER: Reason about or modify code before obtaining local shadow context via MCP.\nNEVER: Edit \`.fabric/agents.meta.json\` directly.\nNEVER: Ignore stale or human-lock warnings returned by Fabric tools.\n\n## 使用说明 / Explanation\n\n- test\n`;

    expect(validateBootstrapFile("/tmp/AGENTS.md", source)).toContainEqual({
      filePath: "/tmp/AGENTS.md",
      message: "missing leading '<!-- fab:rule-id <stable-id> -->' header comment",
    });
  });

  it("accepts a fab:rule-id header immediately after frontmatter", () => {
    const source = `---\nalwaysApply: true\ndescription: Fabric Protocol bootstrap rules\n---\n<!-- fab:rule-id bootstrap/cursor -->\n# Fabric Bootstrap\n\n## CORE RULES (DO NOT TRANSLATE)\n\nMUST: Treat this file as the Fabric Protocol bootstrap for this repository.\nMUST: Before ANY code reading, architecture planning, or logic modification, call the MCP tool \`fab_get_rules(path=<target file>)\` to retrieve shadow constraints from \`.fabric/agents/\`.\nMUST: When creating or changing an L1/L2 rule node, call \`fab_update_registry\`; keep \`.fabric/agents.meta.json\` synchronized through the tool.\nMUST: Stop and ask the human before editing any \`@HUMAN\` protected range listed in \`.fabric/human-lock.json\`.\nMUST: After each complete task, call \`fab_append_intent\` to write one intent ledger entry.\nMUST: Preserve protected tokens exactly: \`AGENTS.md\`, \`FABRIC.md\`, \`.fabric/agents/\`, \`.fabric/agents.meta.json\`, \`.fabric/human-lock.json\`, \`ledger_entry\`, \`agent_meta\`, \`shadow constraints\`, \`Shadow Mirroring\`, \`MUST\`, \`NEVER\`.\nNEVER: Translate, rename, or paraphrase MCP tool names, JSON keys, file paths, or the keywords \`MUST\` and \`NEVER\`.\nNEVER: Reason about or modify code before obtaining local shadow context via MCP.\nNEVER: Edit \`.fabric/agents.meta.json\` directly.\nNEVER: Ignore stale or human-lock warnings returned by Fabric tools.\n\n## 使用说明 / Explanation\n\n- test\n`;

    expect(validateBootstrapFile("/tmp/cursor-fabric-bootstrap.mdc", source)).toEqual([]);
  });
});
