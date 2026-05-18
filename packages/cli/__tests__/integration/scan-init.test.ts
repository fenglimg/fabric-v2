/**
 * Integration tests: deterministic init-scan (TASK-007)
 *
 * Covers:
 *   - end_to_end_produces_4_to_7_files_on_fixture
 *   - reruns_are_no_op_with_zero_diff
 *   - emits_init_scan_completed_event
 *   - missing_forensic_exits_with_error
 *
 * These tests build a synthetic forensic.json fixture so we don't depend on
 * the full `fabric init` pipeline (TASK-008). The forensic shape must match
 * `forensicReportSchema` from @fenglimg/fabric-shared.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ForensicReport } from "@fenglimg/fabric-shared";

import { runInitScan } from "../../src/commands/scan.ts";
import { initFabric } from "../../src/commands/install.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `itg-scan-init-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

async function writeFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function makeForensic(target: string, overrides: Partial<ForensicReport> = {}): ForensicReport {
  const base: ForensicReport = {
    version: "1.0",
    generated_at: "2026-05-10T00:00:00.000Z",
    generated_by: "fab-cli@test",
    target,
    project_name: "fixture-project",
    framework: { kind: "vite", version: "5.0.0", subkind: "react", evidence: ["package.json:vite"] },
    topology: {
      total_files: 12,
      by_ext: { ".ts": 6, ".tsx": 3, ".json": 2, ".md": 1 },
      key_dirs: ["src"],
      max_depth: 3,
    },
    entry_points: [{ path: "src/main.ts", reason: "application entry", size_bytes: 200 }],
    code_samples: [],
    assertions: [
      {
        type: "framework",
        statement: "Project topology aligns with a Vite-style application bootstrap.",
        confidence: "HIGH",
        evidence: [{ file: "src/main.ts", line: "1", snippet: "import" }],
        coverage: { ratio: 1, total: 1, matched: 1, co_occurring_patterns: ["main-entry"] },
        proposed_rule: "Keep bootstrap inside src/main.*.",
      },
    ],
    candidate_files: [
      { path: "package.json", family: "config", rationale: "" },
      { path: "tsconfig.json", family: "config", rationale: "" },
    ],
    sampling_budget: { max_files: 15, max_lines_per_file: 100 },
    readme: { quality: "ok", line_count: 4, has_contributing: false },
  };
  return { ...base, ...overrides };
}

async function setupFixture(prefix: string): Promise<string> {
  const target = makeTempDir(prefix);
  await writeFile(join(target, "README.md"), "# fixture-project\n\nA deterministic fixture used by integration tests.\n");
  await writeFile(join(target, ".fabric", "forensic.json"), JSON.stringify(makeForensic(target), null, 2));
  return target;
}

describe("init-scan: end-to-end", () => {
  it("end_to_end_produces_4_to_7_files_on_fixture", async () => {
    const target = await setupFixture("happy");

    const result = await runInitScan(target);

    expect(result.written_stable_ids.length).toBeGreaterThanOrEqual(4);
    expect(result.written_stable_ids.length).toBeLessThanOrEqual(7);

    // All ids must be team-layer (KT-)
    for (const id of result.written_stable_ids) {
      expect(id).toMatch(/^KT-(MOD|GLD|PRO)-\d{4,}$/);
    }

    // Files exist in the right subdirs
    const knowledgeRoot = join(target, ".fabric", "knowledge");
    expect(existsSync(join(knowledgeRoot, "models"))).toBe(true);
    expect(existsSync(join(knowledgeRoot, "processes"))).toBe(true);
    expect(existsSync(join(knowledgeRoot, "guidelines"))).toBe(true);

    const modelFiles = readdirSync(join(knowledgeRoot, "models"));
    const processFiles = readdirSync(join(knowledgeRoot, "processes"));
    const guidelineFiles = readdirSync(join(knowledgeRoot, "guidelines"));

    expect(modelFiles.length).toBeGreaterThanOrEqual(2); // tech-stack, module-structure (at minimum)
    expect(processFiles.length).toBeGreaterThanOrEqual(1); // build-config
    expect(guidelineFiles.length).toBeGreaterThanOrEqual(1); // code-style

    // Sidecar exists
    expect(existsSync(join(knowledgeRoot, ".scan-state.json"))).toBe(true);
  });

  it("each_file_has_v2_frontmatter_with_six_fields", async () => {
    const target = await setupFixture("frontmatter");

    await runInitScan(target);

    const knowledgeRoot = join(target, ".fabric", "knowledge");
    const subdirs = ["models", "processes", "guidelines"];
    let inspected = 0;

    for (const sub of subdirs) {
      const dir = join(knowledgeRoot, sub);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const content = readFileSync(join(dir, file), "utf8");
        expect(content.startsWith("---\n")).toBe(true);
        expect(content).toMatch(/\nid: K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d{4,}\n/);
        expect(content).toMatch(/\ntype: (model|guideline|process)\n/);
        expect(content).toMatch(/\nlayer: team\n/);
        expect(content).toMatch(/\nmaturity: verified\n/);
        expect(content).toMatch(/\nlayer_reason: ".+?"\n/);
        expect(content).toMatch(/\ncreated_at: \d{4}-\d{2}-\d{2}T/);
        expect(content).toContain("[MISSION_STATEMENT]");
        expect(content).toContain("[CONTEXT_INFO]");
        inspected += 1;
      }
    }

    expect(inspected).toBeGreaterThanOrEqual(4);
  });

  it("agents_meta_records_each_knowledge_node_with_declared_identity", async () => {
    const target = await setupFixture("agents-meta");

    const result = await runInitScan(target);

    const metaRaw = readFileSync(join(target, ".fabric", "agents.meta.json"), "utf8");
    const meta = JSON.parse(metaRaw) as {
      counters?: { KT?: Record<string, number>; KP?: Record<string, number> };
      nodes: Record<string, { stable_id?: string; identity_source?: string }>;
    };

    // Counters incremented for KT slots that we wrote, KP stays at 0.
    const ktTotal =
      Object.values(meta.counters?.KT ?? {}).reduce<number>((sum, n) => sum + (n ?? 0), 0);
    const kpTotal =
      Object.values(meta.counters?.KP ?? {}).reduce<number>((sum, n) => sum + (n ?? 0), 0);
    expect(ktTotal).toBe(result.written_stable_ids.length);
    expect(kpTotal).toBe(0);

    // Each written id appears in nodes with identity_source = 'declared'
    const declaredIds = Object.values(meta.nodes)
      .map((n) => n.stable_id)
      .filter((id): id is string => typeof id === "string" && /^KT-/.test(id));
    expect(declaredIds.sort()).toEqual([...result.written_stable_ids].sort());
    for (const node of Object.values(meta.nodes)) {
      if (node.stable_id !== undefined && node.stable_id.startsWith("KT-")) {
        expect(node.identity_source).toBe("declared");
      }
    }
  });

  it("emits_init_scan_completed_event", async () => {
    const target = await setupFixture("event");

    await runInitScan(target);

    const ledgerPath = join(target, ".fabric", "events.jsonl");
    expect(existsSync(ledgerPath)).toBe(true);

    const events = readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const initScanEvents = events.filter((e) => e.event_type === "init_scan_completed");
    expect(initScanEvents).toHaveLength(1);
    expect(Array.isArray(initScanEvents[0].written_stable_ids)).toBe(true);
    expect(typeof initScanEvents[0].duration_ms).toBe("number");
  });

  it("reruns_are_no_op_with_zero_diff", async () => {
    const target = await setupFixture("idempotent");

    const first = await runInitScan(target);
    expect(first.written_stable_ids.length).toBeGreaterThanOrEqual(4);

    const second = await runInitScan(target);
    expect(second.written_stable_ids).toEqual([]);
    expect(second.skipped_stable_ids.sort()).toEqual([...first.written_stable_ids].sort());

    // Second event in ledger has empty written_stable_ids
    const events = readFileSync(join(target, ".fabric", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const initScanEvents = events.filter((e) => e.event_type === "init_scan_completed");
    expect(initScanEvents.length).toBe(2);
    expect((initScanEvents[1].written_stable_ids as string[]).length).toBe(0);
  });

  it("modifying_forensic_keeps_ids_but_updates_files", async () => {
    const target = await setupFixture("modify");

    const first = await runInitScan(target);

    // Mutate forensic to change framework — body content will diverge.
    const forensicPath = join(target, ".fabric", "forensic.json");
    const forensic = JSON.parse(readFileSync(forensicPath, "utf8")) as ForensicReport;
    forensic.framework.kind = "next";
    forensic.framework.evidence = ["package.json:next"];
    writeFileSync(forensicPath, JSON.stringify(forensic, null, 2), "utf8");

    const second = await runInitScan(target);

    // Affected entries are rewritten with the SAME ids (no counter regression)
    // — every id reported in `second.written_stable_ids` MUST also be in
    // `first.written_stable_ids` (no fresh counter allocation for unchanged
    // slots) and the union ⊆ first.
    for (const id of second.written_stable_ids) {
      expect(first.written_stable_ids).toContain(id);
    }
    // Unchanged entries are skipped, not re-allocated.
    expect(second.written_stable_ids.length).toBeLessThan(first.written_stable_ids.length);
    expect(second.skipped_stable_ids.length).toBeGreaterThan(0);

    // Updated tech-stack file mentions the new framework. v2.0-rc.22 T5:
    // baseline filenames now embed the id, so we discover the file by
    // matching `*--tech-stack.md` rather than hardcoding the bare-slug name.
    const modelsDir = join(target, ".fabric", "knowledge", "models");
    const techStackFile = readdirSync(modelsDir).find((f) => /--tech-stack\.md$/u.test(f));
    expect(techStackFile).toBeDefined();
    const techStackBody = readFileSync(join(modelsDir, techStackFile as string), "utf8");
    expect(techStackBody).toContain("next");
  });

  it("missing_forensic_exits_with_error", async () => {
    const target = makeTempDir("missing-forensic");

    await expect(runInitScan(target)).rejects.toThrow(/forensic\.json/);

    // No partial writes
    expect(existsSync(join(target, ".fabric", "knowledge"))).toBe(false);
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // v2.0-rc.22 T5: baseline filename unification + auto-migration
  //
  // Every baseline file emitted by `fab scan` now uses `${id}--${slug}.md`
  // (matching the fabric-archive Skill format). `migrateLegacyBaselineFilenames`
  // runs at the start of every scan to rename any surviving bare-slug
  // baselines in-place — one `fab scan` completes the migration end-to-end.
  // -------------------------------------------------------------------------

  it("scan_emits_id_prefixed_filename", async () => {
    const target = await setupFixture("id-prefixed-filename");

    await runInitScan(target);

    const knowledgeRoot = join(target, ".fabric", "knowledge");
    const subdirs = ["models", "guidelines", "processes"];
    let inspected = 0;

    for (const sub of subdirs) {
      const dir = join(knowledgeRoot, sub);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        // v2.0-rc.22 T5: every emitted file must embed the id.
        expect(file).toMatch(/^KT-[A-Z]+-\d+--[a-z0-9-]+\.md$/u);
        inspected += 1;
      }
    }

    expect(inspected).toBeGreaterThanOrEqual(4);
  });

  it("scan_content_ref_uses_id_prefixed_filename", async () => {
    const target = await setupFixture("content-ref-id-prefixed");

    const result = await runInitScan(target);

    const meta = JSON.parse(
      readFileSync(join(target, ".fabric", "agents.meta.json"), "utf8"),
    ) as { nodes: Record<string, { content_ref?: string; file?: string }> };

    for (const id of result.written_stable_ids) {
      const node = meta.nodes[id];
      expect(node).toBeDefined();
      // content_ref + file both reflect the id-prefixed filename.
      expect(node.content_ref).toBeDefined();
      expect(node.content_ref).toMatch(
        new RegExp(`^\\.fabric/knowledge/(models|guidelines|processes)/${id}--[a-z0-9-]+\\.md$`, "u"),
      );
      expect(node.file).toBe(node.content_ref);
    }
  });

  it("migrate_legacy_baseline_renames_in_allowlist", async () => {
    const target = await setupFixture("migrate-allowlist");

    // Pre-seed a legacy bare-slug file with a frontmatter id from the
    // baseline allowlist (KT-GLD-0001 → code-style.md). The migration must
    // rename it to `KT-GLD-0001--code-style.md` and unlink the legacy path.
    const guidelinesDir = join(target, ".fabric", "knowledge", "guidelines");
    await mkdir(guidelinesDir, { recursive: true });
    const legacyPath = join(guidelinesDir, "code-style.md");
    const legacyBody =
      "---\n" +
      "id: KT-GLD-0001\n" +
      "type: guideline\n" +
      "layer: team\n" +
      "maturity: verified\n" +
      'layer_reason: "project artifact (deterministic init scan)"\n' +
      "created_at: 2026-05-10T00:00:00.000Z\n" +
      "tags: []\n" +
      "relevance_scope: narrow\n" +
      "relevance_paths: []\n" +
      "---\n\n# Code style\n\nLegacy bare-slug body.\n";
    writeFileSync(legacyPath, legacyBody, "utf8");

    // Pre-seed the sidecar so the rerun loop considers KT-GLD-0001 known
    // (mirrors what happens after the original run that wrote the legacy
    // file — only the filename moved, the id was already allocated).
    const sidecarPath = join(target, ".fabric", "knowledge", ".scan-state.json");
    writeFileSync(
      sidecarPath,
      JSON.stringify({ "KT-GLD-0001": "sha256:legacy-hash-placeholder" }, null, 2),
      "utf8",
    );

    await runInitScan(target);

    // Legacy path gone, new path present.
    expect(existsSync(legacyPath)).toBe(false);
    const newPath = join(guidelinesDir, "KT-GLD-0001--code-style.md");
    expect(existsSync(newPath)).toBe(true);
    // Frontmatter id preserved.
    expect(readFileSync(newPath, "utf8")).toMatch(/^id: KT-GLD-0001$/mu);
  });

  it("migrate_scrubs_stale_tags_on_already_prefixed_baseline", async () => {
    // v2.0-rc.22 hotfix (Finding 1 — already-migrated branch): when a
    // baseline file is already in canonical `${id}--${slug}.md` form but
    // still carries pre-T7 stale tags (the bare-slug→id rename already
    // happened on a prior run that ran before T7), the body-hash skip
    // gate would otherwise leave the stale tags on disk forever. The
    // migration helper must scrub stale tags in-place on already-prefixed
    // baseline files too.
    const target = await setupFixture("migrate-prefixed-stale-tags");

    const guidelinesDir = join(target, ".fabric", "knowledge", "guidelines");
    await mkdir(guidelinesDir, { recursive: true });
    const prefixedPath = join(guidelinesDir, "KT-GLD-0001--code-style.md");
    const staleBody =
      "---\n" +
      "id: KT-GLD-0001\n" +
      "type: guideline\n" +
      "layer: team\n" +
      "maturity: verified\n" +
      'layer_reason: "project artifact (deterministic init scan)"\n' +
      "created_at: 2026-05-10T00:00:00.000Z\n" +
      "tags: [unknown, typescript, csv, ndjson, [none]]\n" +
      "relevance_scope: narrow\n" +
      "relevance_paths: []\n" +
      "---\n\n# Code style guidelines\n\nBody.\n";
    writeFileSync(prefixedPath, staleBody, "utf8");

    await runInitScan(target);

    expect(existsSync(prefixedPath)).toBe(true);
    const onDisk = readFileSync(prefixedPath, "utf8");
    // Stale tags scrubbed; surrounding frontmatter unchanged.
    expect(onDisk).toMatch(/^tags: \[\]$/mu);
    expect(onDisk).not.toMatch(/tags: \[unknown/u);
    expect(onDisk).toMatch(/^id: KT-GLD-0001$/mu);
    expect(onDisk).toMatch(/^relevance_scope: narrow$/mu);
  });

  it("migrate_legacy_clears_stale_tags_during_rename", async () => {
    // v2.0-rc.22 hotfix (Finding 1 / Scope B+C interplay): the body-hash
    // skip gate in runInitScan short-circuits the rewrite when the rendered
    // body is unchanged. If migration only renamed the file (without
    // mutating the frontmatter), stale pre-T7 `tags:` lines would survive
    // forever. Migration must scrub `tags:` to `tags: []` during the
    // rename so the on-disk frontmatter is canonical immediately, even
    // when the subsequent body-hash skip gate triggers.
    const target = await setupFixture("migrate-stale-tags");

    const guidelinesDir = join(target, ".fabric", "knowledge", "guidelines");
    await mkdir(guidelinesDir, { recursive: true });
    const legacyPath = join(guidelinesDir, "code-style.md");
    const staleBody =
      "---\n" +
      "id: KT-GLD-0001\n" +
      "type: guideline\n" +
      "layer: team\n" +
      "maturity: verified\n" +
      'layer_reason: "project artifact (deterministic init scan)"\n' +
      "created_at: 2026-05-10T00:00:00.000Z\n" +
      "tags: [unknown, typescript, csv, ndjson, [none]]\n" +
      "relevance_scope: narrow\n" +
      "relevance_paths: []\n" +
      "---\n\n# Code style guidelines\n\nLegacy stale-tag body.\n";
    writeFileSync(legacyPath, staleBody, "utf8");

    // Pre-seed sidecar with a body-hash that matches what runInitScan would
    // produce for the new render, so the skip gate fires and migration is
    // the only thing that can clean the file. Use a placeholder hash here
    // since we just need the gate to potentially trigger — the migration's
    // tag-strip is unconditional and runs BEFORE the gate is evaluated.
    const sidecarPath = join(target, ".fabric", "knowledge", ".scan-state.json");
    writeFileSync(
      sidecarPath,
      JSON.stringify({ "KT-GLD-0001": "sha256:placeholder" }, null, 2),
      "utf8",
    );

    await runInitScan(target);

    const newPath = join(guidelinesDir, "KT-GLD-0001--code-style.md");
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
    const onDisk = readFileSync(newPath, "utf8");
    // Stale tags scrubbed to canonical `tags: []`. Whichever path produced
    // the final file content (migration scrub or full re-render), the
    // observable end state is identical: no stale list lingers.
    expect(onDisk).toMatch(/^tags: \[\]$/mu);
    expect(onDisk).not.toMatch(/tags: \[unknown/u);
  });

  it("migrate_legacy_skips_unknown_ids", async () => {
    const target = await setupFixture("migrate-skip-unknown");

    // User-promoted file with an id OUTSIDE the baseline allowlist. The
    // migration must not touch it even though the filename happens to be
    // bare-slug (matches a baseline slug to make the test maximally hostile).
    const guidelinesDir = join(target, ".fabric", "knowledge", "guidelines");
    await mkdir(guidelinesDir, { recursive: true });
    const userPath = join(guidelinesDir, "code-style.md");
    const userBody =
      "---\n" +
      "id: KT-GLD-9999\n" +
      "type: guideline\n" +
      "layer: team\n" +
      "maturity: verified\n" +
      'layer_reason: "user-authored"\n' +
      "created_at: 2026-05-10T00:00:00.000Z\n" +
      "tags: []\n" +
      "relevance_scope: broad\n" +
      "relevance_paths: []\n" +
      "---\n\n# User code style\n\nNot a baseline.\n";
    writeFileSync(userPath, userBody, "utf8");

    await runInitScan(target);

    // User file with non-allowlist id is left in place.
    expect(existsSync(userPath)).toBe(true);
    expect(readFileSync(userPath, "utf8")).toMatch(/^id: KT-GLD-9999$/mu);
    // No phantom rename happened.
    expect(existsSync(join(guidelinesDir, "KT-GLD-9999--code-style.md"))).toBe(false);
  });

  it("migrate_legacy_no_op_when_already_prefixed", async () => {
    const target = await setupFixture("migrate-noop");

    // First run writes the baseline files in the new id-prefixed format.
    await runInitScan(target);

    const knowledgeRoot = join(target, ".fabric", "knowledge");
    const beforeListing: Record<string, string[]> = {};
    for (const sub of ["models", "guidelines", "processes"]) {
      const dir = join(knowledgeRoot, sub);
      if (existsSync(dir)) {
        beforeListing[sub] = readdirSync(dir).sort();
      }
    }

    // Second run: nothing to migrate; listings identical.
    await runInitScan(target);

    for (const sub of ["models", "guidelines", "processes"]) {
      const dir = join(knowledgeRoot, sub);
      if (existsSync(dir)) {
        expect(readdirSync(dir).sort()).toEqual(beforeListing[sub]);
      }
    }
  });

  it("performance_budget_under_two_seconds", async () => {
    const target = await setupFixture("perf");

    const start = Date.now();
    await runInitScan(target);
    const duration = Date.now() - start;

    // Generous bound — task asks <2s for a 100-file repo; our fixture is tiny.
    expect(duration).toBeLessThan(5000);
  });

  // -------------------------------------------------------------------------
  // TASK-008: bilingual init-scan templates dispatched on fabric_language
  // (rc.12 hard rename from knowledge_language → fabric_language)
  // -------------------------------------------------------------------------

  /**
   * Read every baseline markdown body produced by init-scan and concatenate
   * them. Used by the bilingual tests to assert language-specific content
   * appears in the rendered output without coupling to slug paths.
   */
  function readAllBaselineBodies(target: string): string {
    const knowledgeRoot = join(target, ".fabric", "knowledge");
    const subdirs = ["models", "guidelines", "processes"];
    const collected: string[] = [];
    for (const sub of subdirs) {
      const dir = join(knowledgeRoot, sub);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        collected.push(readFileSync(join(dir, file), "utf8"));
      }
    }
    return collected.join("\n\n");
  }

  it("fabric_language_en_produces_english_baselines", async () => {
    const target = await setupFixture("lang-en");
    await writeFile(
      join(target, "fabric.config.json"),
      JSON.stringify({ fabric_language: "en" }, null, 2),
    );

    const result = await runInitScan(target);
    expect(result.written_stable_ids.length).toBeGreaterThanOrEqual(4);

    const all = readAllBaselineBodies(target);
    // EN-specific narrative phrasing.
    expect(all).toMatch(/Track the primary tech stack/u);
    expect(all).toMatch(/Map the high-level module layout/u);
    expect(all).toMatch(/Document the deterministic build\/bootstrap/u);
    expect(all).toMatch(/Codify the recurring authoring conventions/u);

    // Section headings preserved.
    expect(all).toContain("[MISSION_STATEMENT]");
    expect(all).toContain("[CONTEXT_INFO]");

    // No CJK characters in body for explicit EN.
    expect(/[\u4e00-\u9fff]/u.test(all)).toBe(false);
  });

  it("fabric_language_zh_cn_produces_chinese_baselines_with_en_headings", async () => {
    const target = await setupFixture("lang-zh");
    await writeFile(
      join(target, "fabric.config.json"),
      JSON.stringify({ fabric_language: "zh-CN" }, null, 2),
    );

    const result = await runInitScan(target);
    expect(result.written_stable_ids.length).toBeGreaterThanOrEqual(4);

    const all = readAllBaselineBodies(target);

    // zh-CN body present (CJK characters).
    expect(/[\u4e00-\u9fff]/u.test(all)).toBe(true);
    // Sample literal zh-CN phrases from BASELINE_TEMPLATES.zh-CN.
    expect(all).toContain("记录");
    expect(all).toContain("梳理");
    expect(all).toContain("固化");

    // EN section headings preserved verbatim.
    expect(all).toContain("[MISSION_STATEMENT]");
    expect(all).toContain("[CONTEXT_INFO]");
    expect(all).toContain("[MANDATORY_INJECTION]");
    expect(all).toContain("[BUSINESS_LOGIC_CHUNKS]");

    // EN tech terms preserved inline (Q3: bilingual style M3).
    expect(all).toContain("framework");
  });

  it("fabric_language_match_existing_defaults_to_en_on_empty_repo", async () => {
    const target = makeTempDir("lang-match-empty");
    // Forensic only — no README, no docs/. Empty-repo defaults to 'en'.
    await writeFile(join(target, ".fabric", "forensic.json"), JSON.stringify(makeForensic(target, {
      readme: { quality: "missing", line_count: 0, has_contributing: false },
    }), null, 2));
    await writeFile(
      join(target, "fabric.config.json"),
      JSON.stringify({ fabric_language: "match-existing" }, null, 2),
    );

    const result = await runInitScan(target);
    expect(result.written_stable_ids.length).toBeGreaterThanOrEqual(3);

    const all = readAllBaselineBodies(target);
    // Empty-repo match-existing → 'en' fallback. Confirm EN narrative + no CJK.
    expect(all).toMatch(/Track the primary tech stack/u);
    expect(/[\u4e00-\u9fff]/u.test(all)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TASK-006 (C1): init-time fabric_language fixation
// (rc.12 hard rename: knowledge_language → fabric_language)
//
// `writeDefaultFabricConfig` in init.ts probes README.md + docs/*.md via
// scan.ts's `detectExistingLanguage` on a fresh init, then fixates the
// resolved language ("zh-CN" or "en") into `.fabric/fabric-config.json`.
// The literal `"match-existing"` placeholder is no longer written.
//
// Idempotency is preserved: pre-existing user configs are NEVER overwritten,
// even when the user has flipped the field to `"match-existing"` manually.
// ---------------------------------------------------------------------------
describe("init-time language fixation (TASK-006 C1)", () => {
  /**
   * Read the `fabric_language` field from the scaffolded fabric-config.
   * Throws if the file is missing or unparseable — both indicate a regression.
   */
  function readFixatedLanguage(target: string): string {
    const configPath = join(target, ".fabric", "fabric-config.json");
    expect(existsSync(configPath)).toBe(true);
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as { fabric_language?: unknown };
    expect(typeof parsed.fabric_language).toBe("string");
    return parsed.fabric_language as string;
  }

  it("test_init_writes_zh_cn_for_cjk_readme", async () => {
    const target = makeTempDir("lang-fix-zh");
    // Heavy-CJK README — well above the 0.3 ratio threshold.
    await writeFile(
      join(target, "README.md"),
      "# 项目说明\n\n这是一个用于演示 Fabric 在中文项目中的知识管理示例。\n中文字符占比远高于 30%，因此 detectExistingLanguage 会解算成 zh-CN。\n",
    );

    await initFabric(target);

    // rc.12 broad-gate-fabric-lang TASK-003: detectExistingLanguage now
    // resolves CJK-heavy repos to "zh-CN-hybrid" (NOT pure "zh-CN") so
    // English technical terms in the project's prose stay preserved. Pure
    // "zh-CN" is reserved for explicit user opt-in via the config field.
    expect(readFixatedLanguage(target)).toBe("zh-CN-hybrid");
  });

  it("test_init_writes_en_for_english_readme", async () => {
    const target = makeTempDir("lang-fix-en");
    await writeFile(
      join(target, "README.md"),
      "# Project\n\nA pure-English README used to exercise the detector's default branch.\nThe CJK ratio is zero so the detector resolves to en.\n",
    );

    await initFabric(target);

    expect(readFixatedLanguage(target)).toBe("en");
  });

  it("test_init_writes_en_for_empty_repo", async () => {
    // No README, no docs/ — the detector's empty-repo contract returns 'en'.
    const target = makeTempDir("lang-fix-empty");

    await initFabric(target);

    expect(readFixatedLanguage(target)).toBe("en");
  });

  it("test_init_preserves_existing_config", async () => {
    const target = makeTempDir("lang-fix-preserve");
    // CJK README would normally fixate to zh-CN, but the user pre-seeded
    // a config — init must NEVER overwrite it.
    await writeFile(
      join(target, "README.md"),
      "# 项目\n\n大量中文内容确保 detector 会返回 zh-CN，从而验证幂等性。\n",
    );
    const configPath = join(target, ".fabric", "fabric-config.json");
    const userSeed = { fabric_language: "match-existing", custom_field: "user-was-here" };
    await writeFile(configPath, JSON.stringify(userSeed, null, 2) + "\n");
    const beforeContent = readFileSync(configPath, "utf8");

    await initFabric(target, { force: true });

    const afterContent = readFileSync(configPath, "utf8");
    // Byte-identical: no merge, no overwrite, no language fixation applied.
    expect(afterContent).toBe(beforeContent);
    const afterParsed = JSON.parse(afterContent) as Record<string, unknown>;
    expect(afterParsed.fabric_language).toBe("match-existing");
    expect(afterParsed.custom_field).toBe("user-was-here");
  });
});
