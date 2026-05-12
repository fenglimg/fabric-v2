// v2.0 integration tests (TASK-005) — exercise the public MCP service
// surface (planContext + getKnowledgeSections) end-to-end against a v2.0
// dual-root layout. These complement the unit tests under
// `services/*.test.ts` by going through the full code path that
// `fab_plan_context` and `fab_get_knowledge_sections` invoke at runtime.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { contextCache } from "../cache.js";
import { planContext } from "../services/plan-context.js";
import { getKnowledgeSections } from "../services/knowledge-sections.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(async () => {
  // Redirect personal-root scans into a tempdir so we don't poke ~/.fabric/.
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-mcp-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  // The meta-reader caches by projectRoot — wipe it between tests so each
  // tempdir gets a fresh read.
  contextCache.invalidate("file_watch");
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("mcp-server integration (v2.0 dual-root)", () => {
  it("plan_context_returns_layer_tagged_index — team + personal entries surface with correct layer tags", async () => {
    const projectRoot = await createV2Project();
    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const indexById = new Map(
      result.shared.description_index.map((item) => [item.stable_id, item] as const),
    );

    expect(indexById.get("KT-DEC-0001")).toMatchObject({
      type: "decision",
      maturity: "verified",
      layer: "team",
    });
    expect(indexById.get("KP-GLD-0001")).toMatchObject({
      type: "guideline",
      maturity: "draft",
      layer: "personal",
    });

    // Sanity: both layers present in the merged index.
    const layers = new Set(result.shared.description_index.map((item) => item.layer));
    expect(layers).toEqual(new Set(["team", "personal"]));
  });

  it("get_rule_sections_works_against_v2_layout — fetches sections from both roots", async () => {
    const projectRoot = await createV2Project();
    const plan = await planContext(projectRoot, { paths: ["src/index.ts"] });

    // Both knowledge entries are L1 in the v2.0 layout (depth 1 under
    // .fabric/agents/<subdir>/) so they're AI-selectable. Pick both.
    const result = await getKnowledgeSections(projectRoot, {
      selection_token: plan.selection_token,
      sections: ["MANDATORY_INJECTION"],
      ai_selected_stable_ids: plan.shared.ai_selectable_stable_ids,
      ai_selection_reasons: Object.fromEntries(
        plan.shared.ai_selectable_stable_ids.map((id) => [id, "exercised in test"]),
      ),
    });

    const ids = result.rules.map((r) => r.stable_id).sort();
    expect(ids).toContain("KT-DEC-0001");
    expect(ids).toContain("KP-GLD-0001");

    // Each fetched rule resolved to its declared section content (proves the
    // file read crossed both team/project root and personal/home root).
    const byId = new Map(result.rules.map((r) => [r.stable_id, r] as const));
    expect(byId.get("KT-DEC-0001")?.sections.MANDATORY_INJECTION).toContain("Team mandatory.");
    expect(byId.get("KP-GLD-0001")?.sections.MANDATORY_INJECTION).toContain("Personal mandatory.");
  });
});

async function createV2Project(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-mcp-project-"));
  tempDirs.push(projectRoot);
  const fakeHome = process.env.FABRIC_HOME!;

  // .fabric scaffolding
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "human-lock.json"),
    `${JSON.stringify({ locked: [] }, null, 2)}\n`,
  );

  // Team-layer fixture under the project's .fabric/knowledge/
  await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "knowledge", "decisions", "team-auth.md"),
    [
      "---",
      "summary: Team JWT decision",
      "id: KT-DEC-0001",
      "type: decision",
      "maturity: verified",
      "layer: team",
      "created_at: 2026-05-10T08:00:00Z",
      "---",
      "# Team JWT",
      "",
      "## [MANDATORY_INJECTION]",
      "Team mandatory.",
      "",
    ].join("\n"),
  );

  // Personal-layer fixture under FABRIC_HOME/.fabric/knowledge/
  await mkdir(join(fakeHome, ".fabric", "knowledge", "guidelines"), { recursive: true });
  await writeFile(
    join(fakeHome, ".fabric", "knowledge", "guidelines", "personal-style.md"),
    [
      "---",
      "summary: Personal coding style",
      "id: KP-GLD-0001",
      "type: guideline",
      "maturity: draft",
      "layer: personal",
      "created_at: 2026-05-10T08:00:00Z",
      "---",
      "# Personal style",
      "",
      "## [MANDATORY_INJECTION]",
      "Personal mandatory.",
      "",
    ].join("\n"),
  );

  // Pre-seed agents.meta.json with both nodes (mirrors what computeKnowledgeBasedAgentsMeta
  // would emit) so planContext/getKnowledgeSections see them via readAgentsMeta.
  await writeFile(
    join(projectRoot, ".fabric", "agents.meta.json"),
    `${JSON.stringify(
      {
        revision: "rev-v2-integration",
        nodes: {
          "L1/team/decisions/team-auth": {
            stable_id: "KT-DEC-0001",
            file: ".fabric/knowledge/decisions/team-auth.md",
            content_ref: ".fabric/knowledge/decisions/team-auth.md",
            scope_glob: "**",
            deps: [],
            priority: "medium",
            level: "L1",
            layer: "L1",
            topology_type: "domain",
            hash: "sha256:team-auth",
            identity_source: "declared",
            description: {
              summary: "Team JWT decision",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "Team JWT decision",
              id: "KT-DEC-0001",
              knowledge_type: "decision",
              maturity: "verified",
              knowledge_layer: "team",
              created_at: "2026-05-10T08:00:00Z",
            },
          },
          "L1/personal/guidelines/personal-style": {
            stable_id: "KP-GLD-0001",
            file: "~/.fabric/knowledge/guidelines/personal-style.md",
            content_ref: "~/.fabric/knowledge/guidelines/personal-style.md",
            scope_glob: "**",
            deps: [],
            priority: "medium",
            level: "L1",
            layer: "L1",
            topology_type: "domain",
            hash: "sha256:personal-style",
            identity_source: "declared",
            description: {
              summary: "Personal coding style",
              intent_clues: [],
              tech_stack: [],
              impact: [],
              must_read_if: "Personal coding style",
              id: "KP-GLD-0001",
              knowledge_type: "guideline",
              maturity: "draft",
              knowledge_layer: "personal",
              created_at: "2026-05-10T08:00:00Z",
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  return projectRoot;
}
