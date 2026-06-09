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
The pending file lands under \`knowledge/pending/\` (\`pending_path\` in response).
Each call carries \`relevance_scope\`, \`relevance_paths\`, \`source_sessions\` array,
\`proposed_reason\` enum, and a multi-line \`session_context\` per Phase 1.5 / T6.

Layer values: \`layer\` ∈ {\`team\`, \`personal\`}.
Personal layer auto-degrades narrow → broad, emitting \`knowledge_scope_degraded\`.

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
    const source = `MUST do things. NEVER skip. knowledge/pending matters.`;
    expect(validateSkillFile(filePath, source)).toContainEqual({
      filePath,
      message: "template is missing protected token fab_review",
    });
  });

  it("flags fabric-archive missing the Phase 1.5 contract fields (relevance_scope / relevance_paths)", () => {
    const filePath = "/tmp/skills/fabric-archive/SKILL.md";
    // Has the universal anchors + fab_extract_knowledge, but lacks the
    // Phase 1.5 contract surface that fabric-archive must pin verbatim.
    const source = `MUST do things. NEVER skip. knowledge/pending matters. fab_extract_knowledge call.`;
    const violations = validateSkillFile(filePath, source);
    expect(violations).toContainEqual({
      filePath,
      message: "template is missing protected token relevance_scope",
    });
    expect(violations).toContainEqual({
      filePath,
      message: "template is missing protected token relevance_paths",
    });
  });

  // TASK-008 D1: per-skill registry was extended with T5/T6 contract fields
  // (source_sessions / proposed_reason / session_context), layer enums
  // (layer / team / personal / pending_path), scope enums (narrow / broad)
  // and the personal-degrade event (knowledge_scope_degraded). The three
  // tests below assert that the lint flags absence of the new tokens per
  // skill so future edits cannot silently drop them.

  it("flags fabric-archive missing T5/T6 + layer-enum tokens (TASK-008 D1)", () => {
    const filePath = "/tmp/skills/fabric-archive/SKILL.md";
    const source = `MUST do things. NEVER skip. knowledge/pending matters. fab_extract_knowledge call. relevance_scope. relevance_paths.`;
    const violations = validateSkillFile(filePath, source);
    for (const token of [
      "pending_path",
      "layer",
      "team",
      "personal",
      "proposed_reason",
      "session_context",
      "source_sessions",
      "knowledge_scope_degraded",
    ]) {
      expect(violations).toContainEqual({
        filePath,
        message: `template is missing protected token ${token}`,
      });
    }
  });

  it("flags fabric-import missing T5/T6 contract tokens (TASK-008 D1)", () => {
    const filePath = "/tmp/skills/fabric-import/SKILL.md";
    const source = `MUST do things. NEVER skip. knowledge/pending matters. fab_extract_knowledge call. fab_review call.`;
    const violations = validateSkillFile(filePath, source);
    for (const token of [
      "proposed_reason",
      "session_context",
      "source_sessions",
    ]) {
      expect(violations).toContainEqual({
        filePath,
        message: `template is missing protected token ${token}`,
      });
    }
  });

  it("flags fabric-review missing scope-enum + T6 tokens (TASK-008 D1)", () => {
    const filePath = "/tmp/skills/fabric-review/SKILL.md";
    const source = `MUST do things. NEVER skip. knowledge/pending matters. fab_review call.`;
    const violations = validateSkillFile(filePath, source);
    for (const token of [
      "relevance_scope",
      "relevance_paths",
      "narrow",
      "broad",
      "proposed_reason",
      "session_context",
      "knowledge_scope_degraded",
    ]) {
      expect(violations).toContainEqual({
        filePath,
        message: `template is missing protected token ${token}`,
      });
    }
  });

  it("only enforces universal SKILL tokens for unknown skill directories", () => {
    const filePath = "/tmp/skills/unknown-skill/SKILL.md";
    const source = `MUST do things. NEVER skip. knowledge/pending matters.`;
    expect(validateSkillFile(filePath, source)).toEqual([]);
  });
});
