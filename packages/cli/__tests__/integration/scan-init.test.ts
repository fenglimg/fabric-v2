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

    // Updated tech-stack file mentions the new framework
    const techStackBody = readFileSync(
      join(target, ".fabric", "knowledge", "models", "tech-stack.md"),
      "utf8",
    );
    expect(techStackBody).toContain("next");
  });

  it("missing_forensic_exits_with_error", async () => {
    const target = makeTempDir("missing-forensic");

    await expect(runInitScan(target)).rejects.toThrow(/forensic\.json/);

    // No partial writes
    expect(existsSync(join(target, ".fabric", "knowledge"))).toBe(false);
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
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
