import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentsMetaSchema, knowledgeTestIndexSchema } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildKnowledgeMeta,
  computeKnowledgeTestIndex,
  computeKnowledgeBasedAgentsMeta,
  loadKbIdTypeMap,
  writeKnowledgeMeta,
  __knowledgeTestIndexCacheStats,
  __resetKnowledgeTestIndexCache,
  __knowledgeMetaCacheStats,
  __resetKnowledgeMetaCache,
} from "./knowledge-meta-builder.js";
import { KnowledgeIdAllocator } from "./knowledge-id-allocator.js";

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
        "## Summary",
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
      // v2.0.0-rc.23 TASK-013 (F8b): the heading extractor now reads B-set
      // plain `## <Title>` headings; the A-set `## [BRACKET]` enum was retired.
      sections: ["Summary"],
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
        "type: decisions",
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
      knowledge_type: "decisions",
      maturity: "verified",
      knowledge_layer: "team",
      layer_reason: "shared across services",
      created_at: "2026-05-10T08:00:00Z",
    });
  });

  it("parses_baseline_frontmatter_without_summary — heading-derived summary + knowledge fields populated (rc.22 Finding 2)", async () => {
    // v2.0-rc.22 hotfix (Finding 2 / B1): the deterministic init-scan
    // baselines (KT-MOD-*, KT-GLD-*, KT-PRO-*) embed their title in the
    // markdown h1 rather than a `summary:` field, then declare knowledge
    // fields (type/maturity/layer/...) in frontmatter. Before this fix,
    // extractDescriptionFromFrontmatter early-returned undefined whenever
    // summary was absent, dropping callers into a heading-only fallback
    // that hardcoded knowledge_type/maturity/knowledge_layer to undefined.
    // Result: plan-context-hint surfaced baselines with empty type/maturity
    // while user-promoted KP-* entries (which always author `summary:`)
    // displayed correctly. The fix: heading-only fallback ALSO calls
    // extractKnowledgeFieldsFromFrontmatter and merges the parsed fields.
    const projectRoot = await createProject("rules-builder-v2-no-summary");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/guidelines/KT-GLD-0001--code-style.md",
      [
        "---",
        "id: KT-GLD-0001",
        "type: guidelines",
        "layer: team",
        "maturity: verified",
        'layer_reason: "project artifact (deterministic init scan)"',
        "created_at: 2026-05-10T00:00:00.000Z",
        "tags: []",
        "relevance_scope: narrow",
        "relevance_paths: [.prettierrc, .editorconfig]",
        "---",
        "# Code style guidelines",
        "",
        "Body text.",
        "",
      ].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const node = Object.values(meta.nodes).find(
      (n) => n.file === ".fabric/knowledge/guidelines/KT-GLD-0001--code-style.md",
    );
    expect(node).toBeDefined();
    // Heading provides the summary in the fallback path.
    expect(node?.description?.summary).toBe("Code style guidelines");
    // Knowledge fields pulled from frontmatter rather than dropped.
    expect(node?.description?.id).toBe("KT-GLD-0001");
    expect(node?.description?.knowledge_type).toBe("guidelines");
    expect(node?.description?.maturity).toBe("verified");
    expect(node?.description?.knowledge_layer).toBe("team");
    expect(node?.description?.layer_reason).toBe("project artifact (deterministic init scan)");
    expect(node?.description?.created_at).toBe("2026-05-10T00:00:00.000Z");
    // Relevance fields honor declared values (not the broad/[] defaults).
    expect(node?.description?.relevance_scope).toBe("narrow");
    expect(node?.description?.relevance_paths).toEqual([".prettierrc", ".editorconfig"]);
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
          "type: decisions",
          "---",
          "# Bad id",
          "",
        ].join("\n"),
      );

      const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
      const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/bad.md");

      expect(node?.description?.id).toBeUndefined();
      expect(node?.description?.knowledge_type).toBe("decisions");
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
          "type: decisions",
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
      expect(node?.description?.knowledge_type).toBe("decisions");
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
        "type: decisions",
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
      "type: guidelines",
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
        "type: decisions",
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
        "type: guidelines",
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

  // ---------------------------------------------------------------------------
  // v2.0-rc.5 (C1): relevance_scope + relevance_paths frontmatter fixtures
  //
  // The parser must recognize two new flat fields and default to safe values
  // (broad + []) whenever they are absent or malformed, so the existing 16
  // canonical entries continue to parse cleanly with no migration required.
  // ---------------------------------------------------------------------------

  it("test_parse_relevance_scope_narrow — explicit narrow scope + paths array are read", async () => {
    const projectRoot = await createProject("rules-builder-rc5-c1-narrow");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/scoped.md",
      [
        "---",
        "summary: Narrow rule",
        "relevance_scope: narrow",
        "relevance_paths: [src/foo.ts, src/bar/]",
        "---",
        "# Narrow rule",
        "",
      ].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/scoped.md");

    expect(node?.description?.relevance_scope).toBe("narrow");
    expect(node?.description?.relevance_paths).toEqual(["src/foo.ts", "src/bar/"]);
  });

  it("test_parse_relevance_paths_array — explicit broad scope with empty paths array", async () => {
    const projectRoot = await createProject("rules-builder-rc5-c1-broad-explicit");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/broad.md",
      [
        "---",
        "summary: Broad rule",
        "relevance_scope: broad",
        "relevance_paths: []",
        "---",
        "# Broad rule",
        "",
      ].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/broad.md");

    expect(node?.description?.relevance_scope).toBe("broad");
    expect(node?.description?.relevance_paths).toEqual([]);
  });

  it("test_default_when_absent — both fields omitted default to broad + []", async () => {
    const projectRoot = await createProject("rules-builder-rc5-c1-absent");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/no-relevance.md",
      [
        "---",
        "summary: Rule without relevance fields",
        "---",
        "# Rule without relevance fields",
        "",
      ].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const node = Object.values(meta.nodes).find(
      (n) => n.file === ".fabric/knowledge/decisions/no-relevance.md",
    );

    expect(node?.description?.relevance_scope).toBe("broad");
    expect(node?.description?.relevance_paths).toEqual([]);
  });

  // v2.2 H2-related (W1-T7): `related` graph-edge field round-trips through
  // frontmatter → meta description.
  it("test_parse_related_graph_edges — related stable_ids are read into description", async () => {
    const projectRoot = await createProject("rules-builder-h2-related");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/linked.md",
      [
        "---",
        "summary: Linked decision",
        "related: [KT-DEC-0001, KT-PIT-0002]",
        "---",
        "# Linked decision",
        "",
      ].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/linked.md");

    expect(node?.description?.related).toEqual(["KT-DEC-0001", "KT-PIT-0002"]);
  });

  it("test_related_absent — related stays undefined when the field is omitted", async () => {
    const projectRoot = await createProject("rules-builder-h2-related-absent");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/unlinked.md",
      ["---", "summary: Unlinked decision", "---", "# Unlinked decision", ""].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const node = Object.values(meta.nodes).find((n) => n.file === ".fabric/knowledge/decisions/unlinked.md");

    expect(node?.description?.related).toBeUndefined();
  });

  it("test_malformed_value_falls_back_to_default — bogus relevance_scope falls back to broad", async () => {
    const projectRoot = await createProject("rules-builder-rc5-c1-malformed");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/malformed.md",
      [
        "---",
        "summary: Malformed relevance scope",
        "relevance_scope: bogus",
        "---",
        "# Malformed",
        "",
      ].join("\n"),
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const node = Object.values(meta.nodes).find(
      (n) => n.file === ".fabric/knowledge/decisions/malformed.md",
    );

    // Forgiving default: malformed value parses as 'broad' so the entry stays
    // surfaced rather than dropping out of the registry.
    expect(node?.description?.relevance_scope).toBe("broad");
    expect(node?.description?.relevance_paths).toEqual([]);
  });
});

// v2.0-rc.24 TASK-07: cite-coverage routing loader. The map is consumed by
// `runDoctorCiteCoverage` to route cites by knowledge_type. We assert the
// singular-form enum contract explicitly so a future plural rename in the
// schema would surface here first.
describe("loadKbIdTypeMap", () => {
  it("returns team-layer KT-* entries with their singular knowledge_type", async () => {
    const projectRoot = await createProject("kb-idtype-team-only");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/KT-DEC-0001.md",
      [
        "---",
        "id: KT-DEC-0001",
        "type: decisions",
        "maturity: proven",
        "layer: team",
        "created_at: 2026-05-19T00:00:00.000Z",
        "summary: Team decision one",
        "---",
        "# Team decision one",
        "",
      ].join("\n"),
    );
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/pitfalls/KT-PIT-0001.md",
      [
        "---",
        "id: KT-PIT-0001",
        "type: pitfalls",
        "maturity: verified",
        "layer: team",
        "created_at: 2026-05-19T00:00:00.000Z",
        "summary: Team pitfall one",
        "---",
        "# Team pitfall one",
        "",
      ].join("\n"),
    );
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const map = await loadKbIdTypeMap(projectRoot);

    expect(map.size).toBe(2);
    expect(map.get("KT-DEC-0001")).toBe("decisions");
    expect(map.get("KT-PIT-0001")).toBe("pitfalls");
  });

  it("includes personal-layer KP-* entries alongside team entries (dual-root)", async () => {
    const projectRoot = await createProject("kb-idtype-dual-layer");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/models/KT-MOD-0001.md",
      [
        "---",
        "id: KT-MOD-0001",
        "type: models",
        "maturity: draft",
        "layer: team",
        "created_at: 2026-05-19T00:00:00.000Z",
        "summary: Team model",
        "---",
        "# Team model",
        "",
      ].join("\n"),
    );
    // Personal-layer entry under the FABRIC_HOME-redirected fake home dir.
    const personalGuidelinesDir = join(process.env.FABRIC_HOME!, ".fabric", "knowledge", "guidelines");
    await mkdir(personalGuidelinesDir, { recursive: true });
    await writeFile(
      join(personalGuidelinesDir, "KP-GLD-0001.md"),
      [
        "---",
        "id: KP-GLD-0001",
        "type: guidelines",
        "maturity: draft",
        "layer: personal",
        "created_at: 2026-05-19T00:00:00.000Z",
        "summary: Personal guideline",
        "---",
        "# Personal guideline",
        "",
      ].join("\n"),
    );
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const map = await loadKbIdTypeMap(projectRoot);

    expect(map.get("KT-MOD-0001")).toBe("models");
    expect(map.get("KP-GLD-0001")).toBe("guidelines");
  });

  it("returns an empty map when agents.meta.json is missing (graceful)", async () => {
    const projectRoot = await createProject("kb-idtype-missing-meta");
    // No writeKnowledgeMeta call → no .fabric/agents.meta.json exists.

    const map = await loadKbIdTypeMap(projectRoot);

    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
  });

  it("returns an empty map when agents.meta.json is malformed JSON (no throw)", async () => {
    const projectRoot = await createProject("kb-idtype-malformed-json");
    await writeProjectFile(projectRoot, ".fabric/agents.meta.json", "{not valid json at all");

    const map = await loadKbIdTypeMap(projectRoot);

    expect(map.size).toBe(0);
  });

  it("skips nodes lacking description.knowledge_type without throwing", async () => {
    const projectRoot = await createProject("kb-idtype-missing-field");
    // Hand-craft meta with one valid node and one node whose description
    // lacks knowledge_type. The loader must skip the malformed one and still
    // surface the well-formed one.
    await writeProjectFile(
      projectRoot,
      ".fabric/agents.meta.json",
      JSON.stringify(
        {
          revision: "sha256:test",
          nodes: {
            "KT-DEC-0042": {
              file: ".fabric/knowledge/decisions/KT-DEC-0042.md",
              content_ref: ".fabric/knowledge/decisions/KT-DEC-0042.md",
              scope_glob: "decisions/KT-DEC-0042/**",
              hash: "sha256:abc",
              stable_id: "KT-DEC-0042",
              identity_source: "declared",
              description: {
                summary: "Valid decision",
                intent_clues: [],
                tech_stack: [],
                impact: [],
                must_read_if: "valid",
                knowledge_type: "decisions",
                relevance_scope: "broad",
                relevance_paths: [],
              },
            },
            "KT-DEC-0099": {
              file: ".fabric/knowledge/decisions/KT-DEC-0099.md",
              content_ref: ".fabric/knowledge/decisions/KT-DEC-0099.md",
              scope_glob: "decisions/KT-DEC-0099/**",
              hash: "sha256:def",
              stable_id: "KT-DEC-0099",
              identity_source: "declared",
              description: {
                summary: "Description but no knowledge_type",
                intent_clues: [],
                tech_stack: [],
                impact: [],
                must_read_if: "no-type",
                relevance_scope: "broad",
                relevance_paths: [],
              },
            },
            "rules/legacy": {
              file: ".fabric/agents/legacy.md",
              scope_glob: "**",
              hash: "sha256:legacy",
              stable_id: "rules/legacy",
              identity_source: "derived",
            },
          },
        },
        null,
        2,
      ),
    );

    const map = await loadKbIdTypeMap(projectRoot);

    expect(map.get("KT-DEC-0042")).toBe("decisions");
    expect(map.has("KT-DEC-0099")).toBe(false);
    // Legacy non-knowledge nodes (no KP-/KT- stable_id) are excluded.
    expect(map.has("rules/legacy")).toBe(false);
    expect(map.size).toBe(1);
  });

  it("returns values from the canonical plural KnowledgeType enum (rc.29 BUG-C1: no singular drift)", async () => {
    const projectRoot = await createProject("kb-idtype-enum-canonical");
    const expected: Array<{ id: string; type: "models" | "decisions" | "guidelines" | "pitfalls" | "processes"; dir: string }> = [
      { id: "KT-MOD-0001", type: "models", dir: "models" },
      { id: "KT-DEC-0001", type: "decisions", dir: "decisions" },
      { id: "KT-GLD-0001", type: "guidelines", dir: "guidelines" },
      { id: "KT-PIT-0001", type: "pitfalls", dir: "pitfalls" },
      { id: "KT-PRO-0001", type: "processes", dir: "processes" },
    ];
    for (const { id, type, dir } of expected) {
      await writeProjectFile(
        projectRoot,
        `.fabric/knowledge/${dir}/${id}.md`,
        [
          "---",
          `id: ${id}`,
          `type: ${type}`,
          "maturity: proven",
          "layer: team",
          "created_at: 2026-05-19T00:00:00.000Z",
          `summary: ${type} summary`,
          "---",
          `# ${type} entry`,
          "",
        ].join("\n"),
      );
    }
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const map = await loadKbIdTypeMap(projectRoot);

    for (const { id, type } of expected) {
      expect(map.get(id)).toBe(type);
    }
    // Plural contract — no singular form should ever appear as a value.
    const values = new Set(map.values());
    for (const singular of ["model", "decision", "guideline", "pitfall", "process"]) {
      expect(values.has(singular as never)).toBe(false);
    }
  });

  it("rc.29 BUG-C1: legacy singular frontmatter (`type: decision`) is normalized to plural", async () => {
    // Disk corpora pre-dating the unification carry singular `type:` values
    // (e.g. KT-DEC-0001..0007 on this repo). The SINGULAR_TO_PLURAL normalizer
    // in parseFrontmatter maps them to the canonical plural before safeParse;
    // verify the map surfaces the plural form so downstream callers (doctor
    // cite-coverage) see one shape.
    const projectRoot = await createProject("kb-idtype-legacy-singular");
    const legacy: Array<{ id: string; singular: string; plural: string; dir: string }> = [
      { id: "KT-MOD-0001", singular: "model", plural: "models", dir: "models" },
      { id: "KT-DEC-0001", singular: "decision", plural: "decisions", dir: "decisions" },
      { id: "KT-GLD-0001", singular: "guideline", plural: "guidelines", dir: "guidelines" },
      { id: "KT-PIT-0001", singular: "pitfall", plural: "pitfalls", dir: "pitfalls" },
      { id: "KT-PRO-0001", singular: "process", plural: "processes", dir: "processes" },
    ];
    for (const { id, singular, dir } of legacy) {
      await writeProjectFile(
        projectRoot,
        `.fabric/knowledge/${dir}/${id}.md`,
        [
          "---",
          `id: ${id}`,
          `type: ${singular}`,
          "maturity: proven",
          "layer: team",
          "created_at: 2026-05-19T00:00:00.000Z",
          `summary: legacy ${singular} summary`,
          "---",
          `# ${singular} legacy entry`,
          "",
        ].join("\n"),
      );
    }
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    const map = await loadKbIdTypeMap(projectRoot);

    for (const { id, plural } of legacy) {
      expect(map.get(id)).toBe(plural);
    }
  });
});

// W1-04 (ISS-003): computeKnowledgeTestIndex must not re-read+re-hash every
// test file on every recall. An mtime/size cache bounds content reads to
// changed files while keeping the result byte-identical to a full scan.
describe("computeKnowledgeTestIndex test-file cache (ISS-003)", () => {
  it("cache hit yields an identical index with zero additional content reads", async () => {
    __resetKnowledgeTestIndexCache();
    const projectRoot = await createProject("rmb-cache-equiv");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/server-core.md",
      "<!-- fab:rule-id rules/server-core -->\n# Server rules\n",
    );
    await writeProjectFile(
      projectRoot,
      "packages/a.test.ts",
      "// @fabric-verify rules/server-core\nexpect(true).toBe(true);\n",
    );
    await writeProjectFile(
      projectRoot,
      "packages/b.test.ts",
      "// @fabric-verify rules/other\nexpect(true).toBe(true);\n",
    );

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const first = await computeKnowledgeTestIndex(projectRoot, meta);
    const readsAfterFirst = __knowledgeTestIndexCacheStats.contentReads;
    expect(readsAfterFirst).toBe(2); // one read per test file on cold scan

    const second = await computeKnowledgeTestIndex(projectRoot, meta, first);
    // Cache hit: no file content re-read.
    expect(__knowledgeTestIndexCacheStats.contentReads).toBe(readsAfterFirst);
    // Equivalent to a full scan.
    expect(second.links).toEqual(first.links);
    expect(second.orphan_annotations).toEqual(first.orphan_annotations);
  });

  it("re-reads only the changed file when one test file is edited", async () => {
    __resetKnowledgeTestIndexCache();
    const projectRoot = await createProject("rmb-cache-invalidate");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/server-core.md",
      "<!-- fab:rule-id rules/server-core -->\n# Server rules\n",
    );
    await writeProjectFile(
      projectRoot,
      "packages/a.test.ts",
      "// @fabric-verify rules/server-core\nexpect(true).toBe(true);\n",
    );
    await writeProjectFile(projectRoot, "packages/b.test.ts", "// no annotation\n");

    const meta = await computeKnowledgeBasedAgentsMeta(projectRoot);
    await computeKnowledgeTestIndex(projectRoot, meta);
    const readsAfterFirst = __knowledgeTestIndexCacheStats.contentReads;

    // Edit only a.test.ts — its mtime/size changes.
    await writeProjectFile(
      projectRoot,
      "packages/a.test.ts",
      "// @fabric-verify rules/server-core\n// edited\nexpect(true).toBe(true);\nexpect(2).toBe(2);\n",
    );
    const meta2 = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const after = await computeKnowledgeTestIndex(projectRoot, meta2, undefined);
    // Exactly one additional content read (the edited file), not a full rescan.
    expect(__knowledgeTestIndexCacheStats.contentReads).toBe(readsAfterFirst + 1);
    // The edited annotation moved to line 1 still maps to the same rule.
    expect(after.links[0]?.annotation_line).toBe(1);
  });
});

// W1-05 (ISS-004): computeKnowledgeBasedAgentsMeta must not re-read+re-hash
// every knowledge .md on every read-path call. A content-signature cache
// (per-file mtime/size + previous meta revision) returns the cached meta with
// zero file reads when nothing changed, and recomputes when a file is edited.
describe("computeKnowledgeBasedAgentsMeta knowledge-file cache (ISS-004)", () => {
  it("repeated calls return an identical meta with zero re-reads when nothing changed", async () => {
    __resetKnowledgeMetaCache();
    const projectRoot = await createProject("rmb-meta-cache");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/a.md",
      "---\nstable_id: KT-DEC-0001\n---\n# A\n",
    );
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/pitfalls/b.md",
      "---\nstable_id: KT-PIT-0001\n---\n# B\n",
    );

    const first = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const readsAfterFirst = __knowledgeMetaCacheStats.fileReads;
    expect(readsAfterFirst).toBe(2);

    const second = await computeKnowledgeBasedAgentsMeta(projectRoot);
    expect(__knowledgeMetaCacheStats.fileReads).toBe(readsAfterFirst); // cache hit — no re-read
    expect(second.revision).toBe(first.revision);
    expect(second.nodes).toEqual(first.nodes);
  });

  it("recomputes (re-reads) and yields a new revision after a knowledge file is edited", async () => {
    __resetKnowledgeMetaCache();
    const projectRoot = await createProject("rmb-meta-invalidate");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/a.md",
      "---\nstable_id: KT-DEC-0001\n---\n# A\n",
    );

    const first = await computeKnowledgeBasedAgentsMeta(projectRoot);
    const readsAfterFirst = __knowledgeMetaCacheStats.fileReads;

    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/a.md",
      "---\nstable_id: KT-DEC-0001\n---\n# A (edited body)\n",
    );

    const second = await computeKnowledgeBasedAgentsMeta(projectRoot);
    expect(__knowledgeMetaCacheStats.fileReads).toBeGreaterThan(readsAfterFirst); // re-read on change
    expect(second.revision).not.toBe(first.revision); // content change reflected
  });

  // F39 (ISS-20260531-047) / F30 / F31: writeKnowledgeMeta rebuilds the meta and
  // carries the counters envelope through verbatim, but it used to do its
  // read→rebuild→write WITHOUT taking the allocator's `${metaPath}.lock`. A
  // writeKnowledgeMeta that read meta before a concurrent allocate's counter
  // bump landed would atomically clobber the bump back to its stale value,
  // re-minting an already-handed-out stable_id. With the lock, the two
  // operations serialize: every allocation persists and no rebuild lowers the
  // counter. The invariant below (final counter == #allocations, all ids
  // distinct) holds only when both writers share the lock.
  it("F39 counter-clobber: concurrent writeKnowledgeMeta never overwrites an allocate() counter bump", async () => {
    const projectRoot = await createProject("rmb-f39-clobber");
    await writeProjectFile(
      projectRoot,
      ".fabric/knowledge/decisions/seed.md",
      "---\nstable_id: KT-DEC-0900\ndescription: seed\n---\n# Seed\n## Summary\nseed\n",
    );
    // Baseline meta with zeroed counters.
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
    __resetKnowledgeMetaCache();

    const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
    const allocator = new KnowledgeIdAllocator(metaPath);

    const N = 8;
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < N; i++) {
      // Each allocate() bumps counters.KT.DEC by one under the allocator lock.
      ops.push(allocator.allocate("team", "decisions"));
      // Each writeKnowledgeMeta() adds a fresh node (so result.changed === true
      // and it actually rewrites the meta file — the exact path that could
      // clobber a concurrent counter bump).
      ops.push(
        (async () => {
          await writeProjectFile(
            projectRoot,
            `.fabric/knowledge/decisions/extra-${i}.md`,
            `---\nstable_id: KT-DEC-09${String(i + 10)}\ndescription: extra ${i}\n---\n# Extra ${i}\n## Summary\nx\n`,
          );
          return writeKnowledgeMeta(projectRoot, { source: "sync_meta" });
        })(),
      );
    }
    const results = await Promise.all(ops);

    const allocatedIds = results.filter((_value, idx) => idx % 2 === 0) as string[];
    expect(new Set(allocatedIds).size).toBe(N); // every minted id is distinct

    const finalMeta = agentsMetaSchema.parse(JSON.parse(await readFile(metaPath, "utf8")));
    // No writeKnowledgeMeta clobbered a bump back to a stale value: the counter
    // reflects all N allocations.
    expect(finalMeta.counters?.KT?.DEC).toBe(N);
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
