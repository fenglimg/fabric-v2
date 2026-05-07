import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contextCache } from "../cache.js";
import { ensureRulesFresh, reconcileRules } from "./rule-sync.js";

const tempDirs: string[] = [];

async function createProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `rule-sync-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

async function writeProjectFile(projectRoot: string, relPath: string, content: string): Promise<void> {
  const abs = join(projectRoot, relPath);
  const dir = abs.slice(0, abs.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(abs, content, "utf8");
}

function makeRuleMd(summary: string = "A rule"): string {
  return [
    "---",
    `summary: ${summary}`,
    "intent_clues: [general]",
    "tech_stack: [TypeScript]",
    "impact: [Runtime]",
    `must_read_if: ${summary}`,
    "---",
    `# ${summary}`,
    "Some content.",
    "",
  ].join("\n");
}

function makeMetaJson(entries: Array<{ nodeId: string; relPath: string; stableId: string; hash: string }>): string {
  const nodes: Record<string, object> = {};
  for (const { nodeId, relPath, stableId, hash } of entries) {
    nodes[nodeId] = {
      file: relPath,
      content_ref: relPath,
      hash,
      stable_id: stableId,
      scope_glob: "**",
      deps: ["L0"],
      priority: "medium",
      layer: "L1",
      topology_type: "mirror",
    };
  }
  return JSON.stringify({ revision: "sha256:abc", nodes }, null, 2);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (d) => rm(d, { recursive: true, force: true })),
  );
});

// ---------------------------------------------------------------------------

describe("rule-sync", () => {
  // Test 1: Fresh path
  it("returns fresh when meta and disk are in sync", async () => {
    const projectRoot = await createProject("fresh");

    const ruleContent = makeRuleMd("Fresh rule");
    await writeProjectFile(projectRoot, ".fabric/rules/test/rule.md", ruleContent);

    // Compute hash the same way the implementation does (sha256 prefix)
    const { createHash } = await import("node:crypto");
    const hash = `sha256:${createHash("sha256").update(ruleContent).digest("hex")}`;

    await writeProjectFile(
      projectRoot,
      ".fabric/agents.meta.json",
      makeMetaJson([
        {
          nodeId: "L1/test/rule",
          relPath: ".fabric/rules/test/rule.md",
          stableId: "test/rule",
          hash,
        },
      ]),
    );

    const report = await ensureRulesFresh(projectRoot);

    expect(report.status).toBe("fresh");
    expect(report.events).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  // Test 2: Stale incremental path
  it("emits rule_content_changed event when rule file changes", async () => {
    const projectRoot = await createProject("stale");

    await writeProjectFile(projectRoot, ".fabric/rules/core/rule.md", makeRuleMd("Original"));

    await writeProjectFile(
      projectRoot,
      ".fabric/agents.meta.json",
      makeMetaJson([
        {
          nodeId: "L1/core/rule",
          relPath: ".fabric/rules/core/rule.md",
          stableId: "core/rule",
          hash: "sha256:oldhash000000000000000000000000000000000000000000000000000000000000",
        },
      ]),
    );

    const report = await ensureRulesFresh(projectRoot);

    expect(report.status).toBe("reconciled");
    expect(report.events).toHaveLength(1);
    const event = report.events[0];
    expect(event.type).toBe("rule_content_changed");
    expect(event.stable_id).toBe("core/rule");
    expect(event.path).toBe(".fabric/rules/core/rule.md");
    expect(event.prev_hash).toBe("sha256:oldhash000000000000000000000000000000000000000000000000000000000000");
    expect(event.new_hash).toMatch(/^sha256:/);
    expect(event.new_hash).not.toBe("sha256:oldhash000000000000000000000000000000000000000000000000000000000000");
    expect(event.source).toBe("ensureRulesFresh");
  });

  // Test 3: Full scan / reconcileRules
  it("reconcileRules walks all files and is idempotent after first reconcile", async () => {
    const projectRoot = await createProject("reconcile");

    const content = makeRuleMd("Reconcile rule");
    await writeProjectFile(projectRoot, ".fabric/rules/pkg/rule.md", content);

    // No meta at all — first reconcile should detect rule_added
    const report1 = await reconcileRules(projectRoot);
    expect(report1.status).toBe("reconciled");
    expect(report1.events.length).toBeGreaterThan(0);
    expect(report1.events[0].type).toBe("rule_added");

    // Write up-to-date meta so second call sees no drift
    const { createHash } = await import("node:crypto");
    const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    await writeProjectFile(
      projectRoot,
      ".fabric/agents.meta.json",
      makeMetaJson([
        {
          nodeId: "L1/pkg/rule",
          relPath: ".fabric/rules/pkg/rule.md",
          stableId: "pkg/rule",
          hash,
        },
      ]),
    );

    // Force debounce window to pass by backdating
    // (We re-import module-scope map via re-run — clear via waiting or calling again after window)
    // Wait 510ms so the debounce window expires
    await new Promise((r) => setTimeout(r, 510));

    const report2 = await reconcileRules(projectRoot);
    expect(report2.status).toBe("fresh");
    expect(report2.events).toHaveLength(0);
  });

  // Test 4: Debounce dedup — 3 hash-identical writes within 500ms -> at most 1 event
  it("deduplicates hash-identical writes within 500ms debounce window", async () => {
    const projectRoot = await createProject("debounce");

    const content = makeRuleMd("Debounce rule");
    await writeProjectFile(projectRoot, ".fabric/rules/deb/rule.md", content);

    // First call: no meta -> rule_added (1 event)
    const r1 = await ensureRulesFresh(projectRoot);
    expect(r1.events.length).toBe(1);

    // Write same content again (hash-identical) immediately
    await writeProjectFile(projectRoot, ".fabric/rules/deb/rule.md", content);
    const r2 = await ensureRulesFresh(projectRoot);

    // Write same content again immediately
    await writeProjectFile(projectRoot, ".fabric/rules/deb/rule.md", content);
    const r3 = await ensureRulesFresh(projectRoot);

    // Total events across r2 + r3 should be 0 (debounced / hash-identical)
    expect(r2.events.length + r3.events.length).toBe(0);
  });

  // Test 5: Invalid frontmatter throws RuleError
  it("throws RuleValidationError with fab doctor --fix hint on broken frontmatter", async () => {
    const projectRoot = await createProject("invalid-fm");

    // Unterminated frontmatter (missing closing ---)
    const brokenContent = "---\nsummary: broken\nno-closing-delimiter\n";
    await writeProjectFile(projectRoot, ".fabric/rules/broken/rule.md", brokenContent);

    await expect(ensureRulesFresh(projectRoot)).rejects.toMatchObject({
      actionHint: expect.stringContaining("fab doctor --fix"),
    });
  });

  // Test 6: Hash-identical save (mtime changes, content unchanged) -> no event
  it("produces no event when file content is unchanged despite mtime change", async () => {
    const projectRoot = await createProject("mtime");

    const content = makeRuleMd("Mtime rule");
    await writeProjectFile(projectRoot, ".fabric/rules/mt/rule.md", content);

    const { createHash } = await import("node:crypto");
    const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;

    await writeProjectFile(
      projectRoot,
      ".fabric/agents.meta.json",
      makeMetaJson([
        {
          nodeId: "L1/mt/rule",
          relPath: ".fabric/rules/mt/rule.md",
          stableId: "mt/rule",
          hash,
        },
      ]),
    );

    // Touch the file (rewrite same content -> mtime changes, hash same)
    await writeFile(join(projectRoot, ".fabric/rules/mt/rule.md"), content, "utf8");

    const report = await ensureRulesFresh(projectRoot);
    expect(report.status).toBe("fresh");
    expect(report.events).toHaveLength(0);
  });

  // Test 7: contextCache.invalidate called after successful reconcile with events
  it("calls contextCache.invalidate with file_watch after producing events", async () => {
    const projectRoot = await createProject("cache-inv");

    await writeProjectFile(projectRoot, ".fabric/rules/ci/rule.md", makeRuleMd("Cache inv rule"));

    const spy = vi.spyOn(contextCache, "invalidate");

    const report = await ensureRulesFresh(projectRoot);

    expect(report.events.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledWith("file_watch", projectRoot);

    spy.mockRestore();
  });

  // Test 8: Structured warning shape
  it("returns structured warning with code, file, and action_hint fields", async () => {
    const projectRoot = await createProject("warn-shape");

    // Frontmatter with invalid YAML line (no colon, not a list item)
    const badContent = "---\nbadline\n---\n# Title\n";
    await writeProjectFile(projectRoot, ".fabric/rules/bad/rule.md", badContent);

    let caught: unknown;
    let report: Awaited<ReturnType<typeof ensureRulesFresh>> | undefined;

    try {
      report = await ensureRulesFresh(projectRoot);
    } catch (err) {
      caught = err;
    }

    // Either the error is thrown (RuleValidationError), or collected as warning
    if (caught !== undefined) {
      // Thrown — verify it has the right shape
      expect(caught).toMatchObject({
        actionHint: expect.stringContaining("fab doctor --fix"),
      });
    } else {
      // Collected as warning
      expect(report).toBeDefined();
      expect(report!.warnings.length).toBeGreaterThan(0);
      const warning = report!.warnings[0];
      expect(warning).toHaveProperty("code");
      expect(warning).toHaveProperty("file");
      expect(warning).toHaveProperty("action_hint");
      expect(typeof warning.code).toBe("string");
      expect(typeof warning.file).toBe("string");
      expect(typeof warning.action_hint).toBe("string");
    }
  });
});
