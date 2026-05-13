import { describe, expect, it } from "vitest";

import {
  validateBootstrapFile,
  validateSkillFile,
} from "../../../scripts/lint-protected-tokens.ts";

const VALID_BOOTSTRAP_SOURCE = `# Fabric Bootstrap
- 修改任何文件前必须调用 \`fab_plan_context(paths=[<被改文件>])\`，再调用 \`fab_get_knowledge_sections\` 获取规则段落。
- MCP 和 doctor 会写入 \`.fabric/events.jsonl\`。
`;

const VALID_SKILL_SOURCE = `---
name: fabric-archive
description: Archive worth-keeping knowledge from the current session.
---

## Phase 2 — Persist

For each user-confirmed candidate, call \`fab_extract_knowledge\` ONCE.
The pending file lands under \`.fabric/knowledge/pending/\`.

MUST: Re-read the digest before classifying.
NEVER: Batch multiple candidates into one MCP call.
`;

describe("validateBootstrapFile", () => {
  it("returns no violations when all required tokens are present", () => {
    expect(validateBootstrapFile("/tmp/CLAUDE.md", VALID_BOOTSTRAP_SOURCE)).toEqual([]);
  });

  it("flags a missing MCP tool token", () => {
    const source = VALID_BOOTSTRAP_SOURCE.replace("fab_plan_context", "计划上下文");
    expect(validateBootstrapFile("/tmp/CLAUDE.md", source)).toContainEqual({
      filePath: "/tmp/CLAUDE.md",
      message: "template is missing protected token fab_plan_context",
    });
  });

  it("flags a missing event ledger path token", () => {
    const source = VALID_BOOTSTRAP_SOURCE.replace(".fabric/events.jsonl", ".fabric/事件.jsonl");
    expect(validateBootstrapFile("/tmp/CLAUDE.md", source)).toContainEqual({
      filePath: "/tmp/CLAUDE.md",
      message: "template is missing protected token .fabric/events.jsonl",
    });
  });
});

describe("validateSkillFile", () => {
  it("returns no violations for fabric-archive when all required tokens are present", () => {
    const filePath = "/tmp/skills/fabric-archive/SKILL.md";
    expect(validateSkillFile(filePath, VALID_SKILL_SOURCE)).toEqual([]);
  });

  it("flags missing MUST/NEVER hard-rule keywords", () => {
    const filePath = "/tmp/skills/fabric-archive/SKILL.md";
    const source = VALID_SKILL_SOURCE.replace(/MUST/g, "应该").replace(/NEVER/g, "禁止");
    const violations = validateSkillFile(filePath, source);
    expect(violations).toContainEqual({
      filePath,
      message: "template is missing protected token MUST",
    });
    expect(violations).toContainEqual({
      filePath,
      message: "template is missing protected token NEVER",
    });
  });

  it("flags a missing per-skill MCP tool token (fabric-review must mention fab_review)", () => {
    const filePath = "/tmp/skills/fabric-review/SKILL.md";
    // Source missing fab_review entirely.
    const source = `MUST do things. NEVER skip. .fabric/knowledge/ matters.`;
    expect(validateSkillFile(filePath, source)).toContainEqual({
      filePath,
      message: "template is missing protected token fab_review",
    });
  });

  it("only enforces universal SKILL tokens for unknown skill directories", () => {
    const filePath = "/tmp/skills/unknown-skill/SKILL.md";
    const source = `MUST do things. NEVER skip. .fabric/knowledge/ matters.`;
    expect(validateSkillFile(filePath, source)).toEqual([]);
  });
});
