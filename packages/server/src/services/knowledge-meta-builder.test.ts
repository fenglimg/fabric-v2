import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentsMetaSchema, knowledgeTestIndexSchema } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildKnowledgeMeta,
  computeKnowledgeTestIndex,
  computeKnowledgeBasedAgentsMeta,
  writeKnowledgeMeta,
} from "./knowledge-meta-builder.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

// v2.0: redirect the personal-root scan into a tempdir so tests never touch
// the developer's real ~/.fabric/. Each test gets a fresh isolated home so
// dual-root scans (team + personal) stay deterministic.
beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-rmb-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("knowledge-meta-builder", () => {
  it("builds agents.meta and knowledge-test.index from .fabric/knowledge only", async () => {
    const projectRoot = await createProject("rules-builder-basic");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/server-core.md",
      [
        "---",
        "description: Server rule contract",
        "intent_clues: [server]",
        "tech_stack: [TypeScript]",
        "impact: [Runtime]",
        "must_read_if: Editing server services",
        "---",
        "<!-- fab:rule-id rules/server-core -->",
        "# Server rule contract",
        "## [MANDATORY_INJECTION]",
        "Use the service layer.",
        "",
      ].join("\n"),
    );
    await writeProjectFile(projectRoot, ".fabric/agents/packages/server/rules.md", "# legacy ignored\n");
    await writeProjectFile(
      projectRoot,
      "packages/server/rules.contract.test.ts",
      [
        "import { describe, it } from 'vitest';",
        "",
        "// @fabric-verify rules/server-core",
        "describe('server rule contract', () => {",
        "  it('keeps the contract explicit', () => {});",
        "});",
        "",
      ].join("\n"),
    );

    const result = await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
    const meta = agentsMetaSchema.parse(JSON.parse(await readFile(join(projectRoot, ".fabric/agents.meta.json"), "utf8")));
    const index = knowledgeTestIndexSchema.parse(
      JSON.parse(await readFile(join(projectRoot, ".fabric/.cache/knowledge-test.index.json"), "utf8")),
    );

    expect(result.changed).toBe(true);
    // v2.0: no L0 bootstrap node — knowledge entries are the only nodes.
    expect(Object.values(meta.nodes).map((node) => node.content_ref ?? node.file)).toEqual([
      ".fabric/knowledge/decisions/server-core.md",
    ]);
    expect(Object.values(meta.nodes).some((node) => node.file.startsWith(".fabric/agents/"))).toBe(false);
    const teamNode = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/server-core.md");
    expect(teamNode).toMatchObject({
      file: ".fabric/knowledge/decisions/server-core.md",
      content_ref: ".fabric/knowledge/decisions/server-core.md",
      stable_id: "rules/server-core",
      identity_source: "declared",
      sections: ["MANDATORY_INJECTION"],
      description: {
        summary: "Server rule contract",
        intent_clues: ["server"],
        tech_stack: ["TypeScript"],
        impact: ["Runtime"],
        must_read_if: "Editing server services",
      },
    });
    expect(index).toMatchObject({
      revision: meta.revision,
      links: [
        {
          rule_stable_id: "rules/server-core",
          rule_file: ".fabric/knowledge/decisions/server-core.md",
          rule_hash: teamNode?.hash,
          test_file: "packages/server/rules.contract.test.ts",
          annotation_line: 3,
        },
      ],
      orphan_annotations: [],
    });
  });

  it("preserves stale previous rule and test hashes", async () => {
    const projectRoot = await createProject("rules-builder-previous");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/server-core.md",
      "<!-- fab:rule-id rules/server-core -->\n# Server rules\n",
    );
    await writeProjectFile(
      projectRoot,
      "packages/server/rules.contract.test.ts",
      "// @fabric-verify rules/server-core\nexpect(true).toBe(true);\n",
    );

    const firstMeta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const firstIndex = await computeKnowledgeTestIndex(projectRoot, firstMeta);
    const firstLink = firstIndex.links[0];

    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/server-core.md",
      "<!-- fab:rule-id rules/server-core -->\n# Server rules\n\nChanged.\n",
    );
    await writeProjectFile(
      projectRoot,
      "packages/server/rules.contract.test.ts",
      "// @fabric-verify rules/server-core\nexpect(false).toBe(false);\n",
    );

    const nextMeta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const nextIndex = await computeKnowledgeTestIndex(projectRoot, nextMeta, firstIndex);

    expect(nextIndex.previous_revision).toBe(firstMeta.revision);
    expect(nextIndex.links[0]).toMatchObject({
      previous_rule_hash: firstLink.rule_hash,
      previous_test_hash: firstLink.test_hash,
    });
  });

  it("does not depend on .fabric/agents for target-state generation", async () => {
    const projectRoot = await createProject("rules-builder-no-agents");
    await writeProjectFile(projectRoot, ".fabric/agents/root.md", "<!-- fab:rule-id legacy/root -->\n# Legacy\n");

    const result = await buildKnowledgeMeta(projectRoot);

    // v2.0: no L0 bootstrap node — `.fabric/agents/` is correctly ignored,
    // and an otherwise empty knowledge tree yields an empty meta.nodes map.
    expect(Object.values(result.meta.nodes)).toEqual([]);
    expect(result.knowledgeTestIndex.links).toEqual([]);
    expect(result.knowledgeTestIndex.orphan_annotations).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // v2.0 frontmatter parser fixtures (TASK-004)
  // ---------------------------------------------------------------------------

  it("parses_v2_full_frontmatter — all knowledge fields are read into description", async () => {
    const projectRoot = await createProject("rules-builder-v2-full");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/auth.md",
      [
        "---",
        "summary: Use JWT for auth",
        "id: KT-DEC-0001",
        "type: decision",
        "maturity: verified",
        "layer: team",
        "layer_reason: shared across services",
        "created_at: 2026-05-10T08:00:00Z",
        "---",
        "# Use JWT for auth",
        "",
      ].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/auth.md");
    expect(node).toBeDefined();
    expect(node?.description).toMatchObject({
      summary: "Use JWT for auth",
      id: "KT-DEC-0001",
      knowledge_type: "decision",
      maturity: "verified",
      knowledge_layer: "team",
      layer_reason: "shared across services",
      created_at: "2026-05-10T08:00:00Z",
    });
  });

  it("parses_v1_minimal_frontmatter — knowledge fields stay undefined and no warnings emitted", async () => {
    const projectRoot = await createProject("rules-builder-v1");
    // v2.0 (TASK-004): the parser emits warnings via process.stderr.write
    // (no console.* allowed in server package). Spy on stderr.write rather
    // than console.warn to capture them.
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await writeProjectFile(
        projectRoot,
        ".fabric/knowledge/pending/legacy.md",
        [
          "---",
          "summary: Legacy rule",
          "intent_clues: [server]",
          "tech_stack: [TypeScript]",
          "impact: [Runtime]",
          "must_read_if: Editing server",
          "---",
          "# Legacy rule",
          "",
        ].join("\n"),
      );

      const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
      const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/pending/legacy.md");

      expect(node?.description?.summary).toBe("Legacy rule");
      expect(node?.description?.id).toBeUndefined();
      expect(node?.description?.knowledge_type).toBeUndefined();
      expect(node?.description?.maturity).toBeUndefined();
      expect(node?.description?.knowledge_layer).toBeUndefined();
      expect(node?.description?.layer_reason).toBeUndefined();
      expect(node?.description?.created_at).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns_on_invalid_id_format — id stays undefined, parsing does not throw", async () => {
    const projectRoot = await createProject("rules-builder-v2-bad-id");
    // v2.0 (TASK-004): the parser emits warnings via process.stderr.write
    // (no console.* allowed in server package). Spy on stderr.write rather
    // than console.warn to capture them.
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await writeProjectFile(
        projectRoot,
        ".fabric/knowledge/decisions/bad.md",
        [
          "---",
          "summary: Bad id",
          "id: foo-bar-baz",
          "type: decision",
          "---",
          "# Bad id",
          "",
        ].join("\n"),
      );

      const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
      const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/bad.md");

      expect(node?.description?.id).toBeUndefined();
      expect(node?.description?.knowledge_type).toBe("decision");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid knowledge id format"),
      );
      // Falls back to path-derived identity rather than throwing.
      expect(node?.identity_source).toBe("derived");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns_on_unknown_type — type stays undefined", async () => {
    const projectRoot = await createProject("rules-builder-v2-bad-type");
    // v2.0 (TASK-004): the parser emits warnings via process.stderr.write
    // (no console.* allowed in server package). Spy on stderr.write rather
    // than console.warn to capture them.
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await writeProjectFile(
        projectRoot,
        ".fabric/knowledge/pending/note.md",
        [
          "---",
          "summary: Unknown type",
          "type: opinion",
          "---",
          "# Unknown type",
          "",
        ].join("\n"),
      );

      const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
      const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/pending/note.md");

      expect(node?.description?.knowledge_type).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("unknown knowledge type"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns_on_id_layer_mismatch — both fields drop to avoid corrupt state", async () => {
    const projectRoot = await createProject("rules-builder-v2-mismatch");
    // v2.0 (TASK-004): the parser emits warnings via process.stderr.write
    // (no console.* allowed in server package). Spy on stderr.write rather
    // than console.warn to capture them.
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await writeProjectFile(
        projectRoot,
        ".fabric/knowledge/decisions/mismatch.md",
        [
          "---",
          "summary: Mismatch",
          "id: KP-DEC-0001",
          "type: decision",
          "layer: team",
          "---",
          "# Mismatch",
          "",
        ].join("\n"),
      );

      const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
      const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/mismatch.md");

      expect(node?.description?.id).toBeUndefined();
      expect(node?.description?.knowledge_layer).toBeUndefined();
      // Type and other valid fields survive the cross-validation drop.
      expect(node?.description?.knowledge_type).toBe("decision");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("dropping both"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns_on_malformed_created_at — created_at stays undefined", async () => {
    const projectRoot = await createProject("rules-builder-v2-bad-date");
    // v2.0 (TASK-004): the parser emits warnings via process.stderr.write
    // (no console.* allowed in server package). Spy on stderr.write rather
    // than console.warn to capture them.
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await writeProjectFile(
        projectRoot,
        ".fabric/knowledge/decisions/baddate.md",
        [
          "---",
          "summary: Bad date",
          "created_at: not-a-date",
          "---",
          "# Bad date",
          "",
        ].join("\n"),
      );

      const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
      const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/baddate.md");

      expect(node?.description?.created_at).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("malformed created_at"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("builds_meta_with_declared_knowledge_id — node uses frontmatter id, identity_source=declared", async () => {
    const projectRoot = await createProject("rules-builder-v2-declared");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/auth.md",
      [
        "---",
        "summary: JWT decision",
        "id: KT-DEC-0001",
        "type: decision",
        "maturity: verified",
        "layer: team",
        "created_at: 2026-05-10T08:00:00Z",
        "---",
        "# JWT decision",
        "",
      ].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/auth.md");

    expect(node?.stable_id).toBe("KT-DEC-0001");
    expect(node?.identity_source).toBe("declared");
    // And the parsed description still carries the matching knowledge fields.
    expect(node?.description?.id).toBe("KT-DEC-0001");
    expect(node?.description?.knowledge_layer).toBe("team");
  });

  it("build_meta_honors_declared_knowledge_id — git mv between subdirs preserves stable_id", async () => {
    const projectRoot = await createProject("rules-builder-v2-mv");
    const sharedFrontmatter = [
      "---",
      "summary: OAuth strategy",
      "id: KP-GLD-0003",
      "type: guideline",
      "maturity: verified",
      "layer: personal",
      "created_at: 2026-05-10T08:00:00Z",
      "---",
      "# OAuth strategy",
      "",
    ].join("\n");

    // Initial location.
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/oauth.md",
      sharedFrontmatter,
    );

    const firstMeta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const firstNode = Object.values(firstMeta.nodes).find(
      (n) => n.file === ".fabric/knowledge/decisions/oauth.md",
    );
    expect(firstNode?.stable_id).toBe("KP-GLD-0003");
    expect(firstNode?.identity_source).toBe("declared");

    // Simulate `git mv` to a different subdirectory: same content, new path.
    await rm(join(projectRoot, ".fabric/knowledge/decisions/oauth.md"));
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/guidelines/oauth.md",
      sharedFrontmatter,
    );

    const secondMeta = await computeKnowledgeBasedAgentsMeta(projectRoot, firstMeta);
    const movedNode = Object.values(secondMeta.nodes).find(
      (n) => n.file === ".fabric/knowledge/guidelines/oauth.md",
    );
    expect(movedNode?.stable_id).toBe("KP-GLD-0003");
    expect(movedNode?.identity_source).toBe("declared");
    // Stable_id MUST NOT regenerate from the new path.
    expect(movedNode?.stable_id).not.toMatch(/guidelines/);
  });

  it("writeKnowledgeMeta serializes counters envelope (default zeros for v1.x meta)", async () => {
    const projectRoot = await createProject("rules-builder-v2-counters");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/pending/legacy.md",
      "<!-- fab:rule-id rules/legacy -->\n# Legacy\n",
    );

    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
    const written = JSON.parse(
      await readFile(join(projectRoot, ".fabric/agents.meta.json"), "utf8"),
    ) as { counters?: { KP?: unknown; KT?: unknown } };

    expect(written.counters).toBeDefined();
    expect(written.counters?.KP).toEqual({ MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 });
    expect(written.counters?.KT).toEqual({ MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 });
  });

  // ---------------------------------------------------------------------------
  // v2.0 dual-root scanning (TASK-005)
  // ---------------------------------------------------------------------------

  it("dual_root_scan_merges_entries — team and personal entries surface in the same meta", async () => {
    const projectRoot = await createProject("rules-builder-v2-dual-root");
    const fakeHome = process.env.FABRIC_HOME!; // set by beforeEach to a tempdir

    // Team-layer entry (under repo).
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/team-auth.md",
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
      ].join("\n"),
    );

    // Personal-layer entry (under fake home). Pre-create the subdir since
    // findKnowledgeFiles auto-mkdir runs on its own scan invocation, but
    // here we're writing the fixture *before* the scan.
    await mkdir(join(fakeHome, ".fabric/knowledge/guidelines"), { recursive: true });
    await writeFile(
      join(fakeHome, ".fabric/knowledge/guidelines/personal-style.md"),
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
      ].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);

    const teamNode = Object.values(meta.nodes).find(
      (n) => n.file === ".fabric/knowledge/decisions/team-auth.md",
    );
    const personalNode = Object.values(meta.nodes).find(
      (n) => n.file === "~/.fabric/knowledge/guidelines/personal-style.md",
    );

    expect(teamNode).toBeDefined();
    expect(personalNode).toBeDefined();
    expect(teamNode?.stable_id).toBe("KT-DEC-0001");
    expect(personalNode?.stable_id).toBe("KP-GLD-0001");
    expect(teamNode?.description?.knowledge_layer).toBe("team");
    expect(personalNode?.description?.knowledge_layer).toBe("personal");
  });

  it("auto_mkdir_personal_root_on_first_scan — knowledge subdirs materialize under FABRIC_HOME", async () => {
    const projectRoot = await createProject("rules-builder-v2-auto-mkdir");
    const fakeHome = process.env.FABRIC_HOME!;

    // Sanity: personal root tree should NOT yet exist (beforeEach only made
    // the empty FABRIC_HOME root).
    const existsBefore = await readFile(
      join(fakeHome, ".fabric/knowledge/decisions/.keep"),
    ).then(() => true).catch(() => false);
    expect(existsBefore).toBe(false);

    // Run the scan — auto-mkdir is a side-effect of findKnowledgeFiles.
    await computeKnowledgeBasedAgentsMeta(projectRoot);

    // Each canonical knowledge subdir should now exist under fake home.
    for (const subdir of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
      const dirPath = join(fakeHome, ".fabric", "knowledge", subdir);
      // mkdir with recursive does not create files; we verify the dir is
      // listable as proof of materialization.
      const entries = await mkdir(dirPath, { recursive: true });
      // mkdir returns undefined when the dir already exists (idempotent),
      // which is exactly what we want to assert on the second invocation.
      expect(entries).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------------
  // v2.0-rc.5 TASK-003 (C7): computeRevision excludes pending/ from hash input
  // ---------------------------------------------------------------------------

  it("test_compute_revision_excludes_pending_add — adding a pending entry does not change revision_hash", async () => {
    // Baseline project: one canonical decision, no pending entries.
    const projectRoot = await createProject("rules-builder-rc5-pending-add");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/baseline.md",
      [
        "---",
        "description: Baseline canonical rule",
        "intent_clues: [server]",
        "tech_stack: [TypeScript]",
        "impact: [Runtime]",
        "must_read_if: Editing baseline",
        "---",
        "<!-- fab:rule-id rules/baseline -->",
        "# Baseline",
        "## [MANDATORY_INJECTION]",
        "Keep baseline stable.",
        "",
      ].join("\n"),
    );

    const metaBefore = await computeKnowledgeBasedAgentsMeta(projectRoot);

    // Now add a pending draft — this MUST NOT change revision_hash.
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/pending/draft-one.md",
      [
        "---",
        "summary: Pending draft",
        "---",
        "# Pending draft",
        "",
      ].join("\n"),
    );

    const metaAfter = await computeKnowledgeBasedAgentsMeta(projectRoot);

    // Pending node IS present in the nodes record (for fab_review.list).
    const pendingNode = Object.values(metaAfter.nodes).find(
      (n) => n.file === ".fabric/knowledge/pending/draft-one.md",
    );
    expect(pendingNode).toBeDefined();

    // But revision_hash must NOT have changed.
    expect(metaAfter.revision).toBe(metaBefore.revision);
  });

  it("test_compute_revision_changes_on_approve_to_canonical — moving pending → canonical changes revision_hash", async () => {
    const projectRoot = await createProject("rules-builder-rc5-pending-approve");

    // Start with the entry living under pending/.
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/pending/to-approve.md",
      [
        "---",
        "summary: Awaiting approval",
        "---",
        "# Awaiting approval",
        "",
      ].join("\n"),
    );

    const metaBefore = await computeKnowledgeBasedAgentsMeta(projectRoot);

    // Simulate `fab_review.approve` by moving the file to a canonical subdir.
    // Delete the pending copy and write the same content under decisions/.
    await rm(join(projectRoot, ".fabric/knowledge/pending/to-approve.md"));
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/to-approve.md",
      [
        "---",
        "description: Approved canonical rule",
        "intent_clues: [server]",
        "tech_stack: [TypeScript]",
        "impact: [Runtime]",
        "must_read_if: After approval",
        "---",
        "<!-- fab:rule-id rules/to-approve -->",
        "# Approved",
        "## [MANDATORY_INJECTION]",
        "Honor the approved rule.",
        "",
      ].join("\n"),
    );

    const metaAfter = await computeKnowledgeBasedAgentsMeta(projectRoot);

    // Approval (pending → canonical) MUST change revision_hash so the
    // PreToolUse session-hints cache invalidates correctly.
    expect(metaAfter.revision).not.toBe(metaBefore.revision);
  });
});

async function createProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), `${prefix}-`));
  tempDirs.push(projectRoot);
  // v2.0: no longer pre-seed `.fabric/bootstrap/README.md` — it is no longer
  // recognized as a meta node and would only inflate fixture noise.
  return projectRoot;
}

async function writeProjectFile(projectRoot: string, path: string, content: string): Promise<void> {
  const target = join(projectRoot, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}
