import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

describe("AI client policy docs drift guard", () => {
  it("keeps public onboarding docs aligned with store-backed knowledge and current hook surfaces", () => {
    const publicDocs = [
      "README.md",
      "docs/USER-QUICKSTART.md",
      "packages/cli/templates/hooks/configs/README.md",
    ]
      .map((rel) => `${rel}\n${read(rel)}`)
      .join("\n\n---\n\n");

    expect(publicDocs).not.toContain("Fabric exposes six MCP tools and three Skills");
    expect(publicDocs).not.toContain("UserPromptSubmit cite-policy hook");
    expect(publicDocs).not.toContain("<repo>/.fabric/knowledge/pending");
    expect(publicDocs).not.toContain("~/.fabric/knowledge/pending");
  });

  it("keeps bootstrap policy free of retired agents.meta developer guidance", () => {
    const bootstrapDocs = [
      "packages/shared/src/templates/bootstrap-canonical.ts",
      ".fabric/AGENTS.md",
      "AGENTS.md",
      ".cursor/rules/fabric-bootstrap.mdc",
    ]
      .map((rel) => `${rel}\n${read(rel)}`)
      .join("\n\n---\n\n");

    expect(bootstrapDocs).not.toContain("手编 `.fabric/agents.meta.json`");
    expect(bootstrapDocs).not.toContain("`.fabric/agents.meta.json` 严禁手动编辑");
  });

  it("keeps current archive trigger docs on fabric-hint.cjs", () => {
    const archiveGateDocs = [
      "packages/cli/templates/skills/fabric-archive/ref/phase-1-5-onboard.md",
      "packages/cli/__tests__/integration/archive-skill-trigger-gate.test.ts",
    ]
      .map((rel) => `${rel}\n${read(rel)}`)
      .join("\n\n---\n\n");

    expect(archiveGateDocs).toContain("fabric-hint.cjs");
    expect(archiveGateDocs).not.toContain("from `archive-hint.cjs`");
    expect(archiveGateDocs).not.toContain("from archive-hint.cjs");
  });

  it("does not claim Fabric installs Cursor skill directories", () => {
    const parityMatrix = read("packages/shared/src/parity/parity-matrix.json");

    expect(parityMatrix).not.toMatch(/\.cursor\/skills\/fabric-/);
    expect(parityMatrix).toContain("Fabric does not install .cursor/skills");
  });
});
