import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTranslator } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  inspectRetiredReferences,
  createRetiredReferenceCheck,
  RETIRED_TOKENS,
} from "./doctor-retired-references-lint.js";

let root: string;
const t = createTranslator("en");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fabric-retired-ref-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

describe("doctor retired-reference lint (ux-w2-2)", () => {
  it("the registry covers the W0-1 / W0-2 / W1-1 class of retired tokens", () => {
    const tokens = RETIRED_TOKENS.map((r) => r.token);
    expect(tokens).toContain("fab_plan_context"); // W0-1
    expect(tokens).toContain("fab_extract_knowledge"); // W1-1
    expect(tokens).toContain("hint_broad_budget_chars"); // W1-5
  });

  it("is ok when no agent-facing file references a retired token", async () => {
    write("AGENTS.md", "# Fabric Bootstrap\nUse `fab_recall` then read the path.\n");
    write(".claude/skills/fabric-archive/SKILL.md", "Persist via `fab_propose`.\n");
    const inspection = await inspectRetiredReferences(root);
    expect(inspection.status).toBe("ok");
    expect(inspection.hits).toEqual([]);
    expect(createRetiredReferenceCheck(t, inspection).status).toBe("ok");
  });

  it("flags a stale pointer in the bootstrap anchor (W0-2 class)", async () => {
    // A retired CONFIG field name in agent-facing bootstrap text.
    write("AGENTS.md", "# Fabric Bootstrap\nLanguage is the `cite_evict_interval` field.\n");
    const inspection = await inspectRetiredReferences(root);
    expect(inspection.status).toBe("warn");
    expect(inspection.hits.some((h) => h.token === "cite_evict_interval" && h.path === "AGENTS.md")).toBe(true);
    const check = createRetiredReferenceCheck(t, inspection);
    expect(check.status).toBe("warn");
    expect(check.message).toMatch(/cite_evict_interval/);
  });

  it("flags a live retired pointer in a SKILL.md (W1-1 class)", async () => {
    write(".codex/skills/fabric-import/SKILL.md", "Call `fab_extract_knowledge` to persist.\n");
    const inspection = await inspectRetiredReferences(root);
    expect(inspection.hits.some((h) => h.token === "fab_extract_knowledge")).toBe(true);
  });

  it("flags a live emitted string in a hook but SKIPS a history comment", async () => {
    write(
      ".claude/hooks/knowledge-hint-narrow.cjs",
      [
        "// fab_plan_context → fab_recall is retired (history comment, must be skipped)",
        'lines.push("call fab_plan_context now");', // live string → flagged
      ].join("\n"),
    );
    const inspection = await inspectRetiredReferences(root);
    const hookHits = inspection.hits.filter((h) => h.path.endsWith("knowledge-hint-narrow.cjs"));
    // Exactly the emitted-string line is flagged; the comment line is not.
    expect(hookHits).toHaveLength(1);
    expect(hookHits[0].line).toBe(2);
    expect(hookHits[0].token).toBe("fab_plan_context");
  });

  it("status skipped when there is nothing to scan", async () => {
    const inspection = await inspectRetiredReferences(root);
    expect(inspection.status).toBe("skipped");
  });
});
