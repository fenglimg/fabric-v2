import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  inspectSkillContract,
  inspectSkillDescription,
  inspectSkillTokenBudget,
} from "./doctor-skill-lints.js";

function seedSkill(root: string, slug: string, description: string): void {
  const skillDir = join(root, ".claude", "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${slug}\ndescription: ${description}\n---\n# ${slug}\n`,
    "utf8",
  );
}

function seedInstalledSkill(root: string, client: ".claude" | ".codex", slug: string, body: string): void {
  const skillDir = join(root, client, "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), body, "utf8");
}

// tokens = Math.ceil(chars / 3), so `tokens * 3` chars yields exactly `tokens`.
// inspectSkillTokenBudget reads .claude/skills/<slug>/SKILL.md.
function seedSkillOfTokens(root: string, slug: string, tokens: number): void {
  const skillDir = join(root, ".claude", "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "a".repeat(tokens * 3), "utf8");
}

describe("inspectSkillDescription", () => {
  it("accepts a bilingual description with an explicit anti-trigger boundary", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-desc-ok-"));
    seedSkill(
      root,
      "fabric-archive",
      "归档 session knowledge (NOT code review). Triggers 归档/archive insights.",
    );

    await expect(inspectSkillDescription(root)).resolves.toEqual({
      status: "ok",
      issues: [],
    });
  });

  it("warns when a description has triggers but no anti-trigger boundary", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-desc-anti-trigger-"));
    seedSkill(
      root,
      "fabric-review",
      "审核 pending knowledge and review backlog. Triggers 审核/review pending.",
    );

    const result = await inspectSkillDescription(root);

    expect(result.status).toBe("warn");
    expect(result.issues).toContainEqual({
      slug: "fabric-review",
      problem: "missing_anti_trigger",
      detail: "no explicit non-trigger phrase such as NOT/不是/不要",
    });
  });
});

describe("inspectSkillContract", () => {
  it("accepts intact archive/review contracts and thin store/sync shims", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-contract-ok-"));
    seedInstalledSkill(
      root,
      ".claude",
      "fabric-archive",
      [
        "allowed-tools: mcp__fabric__fab_propose",
        "## Hard Rules",
        "### DISPLAY Rules",
        "### WRITE Rules",
        "the only legal write path is `mcp__fabric__fab_propose`",
        "Drop reached-but-inert candidates.",
      ].join("\n"),
    );
    seedInstalledSkill(
      root,
      ".claude",
      "fabric-review",
      [
        "allowed-tools: mcp__fabric__fab_review",
        "## Hard Rules",
        "### DISPLAY Rules",
        "### WRITE Rules",
        "the only legal mutation path is `mcp__fabric__fab_review`",
        "Flag reached-but-inert entries that do not changes next action.",
        "Check `must_read_if`, `intent_clues`, and `impact`.",
      ].join("\n"),
    );
    seedInstalledSkill(root, ".claude", "fabric-store", "thin shim\nCLI\n本 skill 只指路\nNEVER direct edit");
    seedInstalledSkill(root, ".claude", "fabric-sync", "thin shim\nCLI\n本 skill 只路由\nNEVER direct edit");

    await expect(inspectSkillContract(root)).resolves.toEqual({
      status: "ok",
      issues: [],
    });
  });

  it("warns when archive loses the MCP-only write path token", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-contract-mcp-"));
    seedInstalledSkill(
      root,
      ".claude",
      "fabric-archive",
      [
        "## Hard Rules",
        "### DISPLAY Rules",
        "### WRITE Rules",
        "the only legal write path is delegated elsewhere",
        "Drop reached-but-inert candidates.",
      ].join("\n"),
    );

    const result = await inspectSkillContract(root);

    expect(result.status).toBe("warn");
    expect(result.issues).toContainEqual({
      slug: "fabric-archive",
      client: ".claude",
      problem: "missing_contract_token",
      detail: "mcp__fabric__fab_propose",
    });
  });

  it("warns when a ref file is not reachable from SKILL.md", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-contract-ref-"));
    const skillDir = join(root, ".claude", "skills", "fabric-review");
    mkdirSync(join(skillDir, "ref"), { recursive: true });
    writeFileSync(join(skillDir, "ref", "semantic-check.md"), "# Semantic Check\n", "utf8");
    seedInstalledSkill(
      root,
      ".claude",
      "fabric-review",
      [
        "mcp__fabric__fab_review",
        "## Hard Rules",
        "### DISPLAY Rules",
        "### WRITE Rules",
        "only legal mutation path",
        "reached-but-inert",
        "changes next action",
        "must_read_if",
        "intent_clues",
        "impact",
      ].join("\n"),
    );

    const result = await inspectSkillContract(root);

    expect(result.status).toBe("warn");
    expect(result.issues).toContainEqual({
      slug: "fabric-review",
      client: ".claude",
      problem: "missing_ref_entry",
      detail: "semantic-check.md",
    });
  });

  it("warns when store/sync stop being thin CLI shims", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-contract-thin-"));
    seedInstalledSkill(root, ".codex", "fabric-store", "CLI\n本 skill 只指路\nNEVER direct edit");

    const result = await inspectSkillContract(root);

    expect(result.status).toBe("warn");
    expect(result.issues).toContainEqual({
      slug: "fabric-store",
      client: ".codex",
      problem: "missing_thin_shim_token",
      detail: "thin shim",
    });
  });
});

describe("inspectSkillTokenBudget", () => {
  // The lint watches only fabric-archive/fabric-review (FABRIC_SKILL_SLUGS).
  // These cases pin the warn boundary at 8K (raised from 5K) and error at 10K.
  it("stays ok when the watched skills are under the 8K warn threshold", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-tok-ok-"));
    // 7K sits between the old 5K warn and the new 8K warn — a regression
    // sentinel: if WARN_TOKENS is reverted to 5K, this expectation flips to warn.
    seedSkillOfTokens(root, "fabric-archive", 7_000);
    seedSkillOfTokens(root, "fabric-review", 6_000);

    await expect(inspectSkillTokenBudget(root)).resolves.toEqual({
      status: "ok",
      overSize: [],
    });
  });

  it("treats exactly 8K tokens as within budget (strict > boundary)", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-tok-boundary-"));
    seedSkillOfTokens(root, "fabric-archive", 8_000);

    await expect(inspectSkillTokenBudget(root)).resolves.toEqual({
      status: "ok",
      overSize: [],
    });
  });

  it("warns above 8K but below the 10K error cap", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-tok-warn-"));
    seedSkillOfTokens(root, "fabric-archive", 8_001);

    const result = await inspectSkillTokenBudget(root);

    expect(result.status).toBe("warn");
    expect(result.overSize).toContainEqual({
      slug: "fabric-archive",
      tokens: 8_001,
      severity: "warn",
    });
  });

  it("errors above the 10K hard cap", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-skill-tok-error-"));
    seedSkillOfTokens(root, "fabric-review", 10_001);

    const result = await inspectSkillTokenBudget(root);

    expect(result.status).toBe("error");
    expect(result.overSize).toContainEqual({
      slug: "fabric-review",
      tokens: 10_001,
      severity: "error",
    });
  });
});
