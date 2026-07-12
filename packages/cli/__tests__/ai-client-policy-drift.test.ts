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

  it("keeps bootstrap policy clear that agents.meta is engine-owned", () => {
    const bootstrapDocs = [
      "packages/shared/src/templates/bootstrap-canonical.ts",
      ".fabric/AGENTS.md",
      "AGENTS.md",
    ]
      .map((rel) => `${rel}\n${read(rel)}`)
      .join("\n\n---\n\n");

    expect(bootstrapDocs).toContain("`.fabric/agents.meta.json` 严禁手动编辑");
    expect(bootstrapDocs).not.toContain("agents.meta.json#counters");
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

  it("keeps skill delivery documented in the parity matrix for both clients", () => {
    const parityMatrix = read("packages/shared/src/parity/parity-matrix.json");

    expect(parityMatrix).toMatch(/\.claude\/skills\/fabric-/);
    expect(parityMatrix).toMatch(/\.codex\/skills\/fabric-/);
    expect(parityMatrix).not.toContain(".cursor/skills");
  });
});


describe("peer-micro-transfer consistency", () => {
  it("bootstrap-canonical and fabric-recall-playbook both teach fab_recall(paths=", () => {
    const bootstrap = read("packages/shared/src/templates/bootstrap-canonical.ts");
    const playbook = read("packages/cli/templates/skills/fabric-recall-playbook/SKILL.md");
    expect(bootstrap).toContain("fab_recall(paths=");
    expect(playbook).toContain("fab_recall(paths=");
    expect(playbook).toContain("session_id=");
    expect(bootstrap).toContain("session_id=");
  });

  it("fabric-archive skill template exists with altitude guidance", () => {
    const archive = read("packages/cli/templates/skills/fabric-archive/SKILL.md");
    expect(archive.length).toBeGreaterThan(100);
    expect(archive).toMatch(/altitude|body_altitude|session dump|session dumps/i);
  });
});

