/**
 * Unit tests for the deterministic init-scan builders.
 *
 * These tests exercise the individual builder helpers exported from
 * scan.ts via the `__testing__` namespace. They do NOT touch the
 * filesystem (apart from optional README reads handled per-test).
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ForensicReport } from "@fenglimg/fabric-shared";

import { __testing__ } from "../src/commands/scan.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `scan-builders-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

const NOW = "2026-05-10T00:00:00.000Z";

function makeForensic(overrides: Partial<ForensicReport> = {}): ForensicReport {
  const base: ForensicReport = {
    version: "1.0",
    generated_at: "2026-05-10T00:00:00.000Z",
    generated_by: "fab-cli@test",
    target: "/fixture",
    project_name: "fixture-project",
    framework: {
      kind: "vite",
      version: "5.0.0",
      subkind: "react",
      evidence: ["package.json:vite", "vite.config.ts"],
    },
    topology: {
      total_files: 42,
      by_ext: { ".ts": 20, ".tsx": 10, ".json": 5, ".md": 3, ".yml": 2, ".css": 2 },
      key_dirs: ["src", "src/components", "src/lib"],
      max_depth: 4,
    },
    entry_points: [
      { path: "src/main.ts", reason: "application entry", size_bytes: 256 },
      { path: "src/App.tsx", reason: "application entry", size_bytes: 1024 },
    ],
    code_samples: [],
    assertions: [
      {
        type: "framework",
        statement: "Project topology aligns with a Vite-style application bootstrap.",
        confidence: "HIGH",
        evidence: [{ file: "src/main.ts", line: "1", snippet: "import { createRoot } from 'react-dom/client'" }],
        coverage: { ratio: 1, total: 2, matched: 2, co_occurring_patterns: ["react-root"] },
        proposed_rule: "Keep primary bootstrapping logic inside src/main.*.",
      },
      {
        type: "pattern",
        statement: "Sampled entry files use the conventional Vite main entrypoint.",
        confidence: "HIGH",
        evidence: [{ file: "src/main.ts", line: "1", snippet: "" }],
        coverage: { ratio: 1, total: 2, matched: 2, co_occurring_patterns: ["main-entry"] },
        proposed_rule: "Keep root rendering aligned with React entry conventions.",
      },
    ],
    candidate_files: [
      { path: "package.json", family: "config", rationale: "Bootstrap config" },
      { path: "tsconfig.json", family: "config", rationale: "Compiler config" },
      { path: "vite.config.ts", family: "config", rationale: "Bundler config" },
      { path: "src/main.ts", family: "entry", rationale: "Vite entry" },
    ],
    sampling_budget: { max_files: 15, max_lines_per_file: 100 },
    readme: { quality: "ok", line_count: 42, has_contributing: false },
  };
  return { ...base, ...overrides };
}

describe("scan builders — deterministic baseline knowledge", () => {
  it("build_tech_stack_entry_returns_model", () => {
    const forensic = makeForensic();
    const entry = __testing__.buildTechStackEntry(forensic, NOW);

    expect(entry).not.toBeNull();
    expect(entry.type).toBe("model");
    expect(entry.layer).toBe("team");
    expect(entry.maturity).toBe("verified");
    expect(entry.target_subdir).toBe("models");
    expect(entry.slug).toBe("tech-stack");
    expect(entry.body).toContain("[MISSION_STATEMENT]");
    expect(entry.body).toContain("[CONTEXT_INFO]");
    expect(entry.body).toContain("vite");
    expect(entry.body).not.toContain("[MANDATORY_INJECTION]");
    expect(entry.body).not.toContain("[BUSINESS_LOGIC_CHUNKS]");
  });

  it("build_module_structure_entry_returns_model", () => {
    const forensic = makeForensic();
    const entry = __testing__.buildModuleStructureEntry(forensic, NOW);

    expect(entry.type).toBe("model");
    expect(entry.target_subdir).toBe("models");
    expect(entry.slug).toBe("module-structure");
    expect(entry.body).toContain("src/components");
    expect(entry.body).toContain("src/main.ts");
    expect(entry.body).toContain("[MISSION_STATEMENT]");
    expect(entry.body).toContain("[CONTEXT_INFO]");
  });

  it("build_build_config_entry_returns_process", () => {
    const forensic = makeForensic();
    const entry = __testing__.buildBuildConfigEntry(forensic, NOW);

    expect(entry.type).toBe("process");
    expect(entry.target_subdir).toBe("processes");
    expect(entry.slug).toBe("build-config");
    expect(entry.body).toContain("[MISSION_STATEMENT]");
    expect(entry.body).toContain("[BUSINESS_LOGIC_CHUNKS]");
    expect(entry.body).toContain("[CONTEXT_INFO]");
    expect(entry.body).toContain("package.json");
    expect(entry.body).toContain("tsconfig.json");
  });

  it("build_code_style_entry_returns_guideline", () => {
    const forensic = makeForensic();
    const entry = __testing__.buildCodeStyleEntry(forensic, NOW);

    expect(entry.type).toBe("guideline");
    expect(entry.target_subdir).toBe("guidelines");
    expect(entry.slug).toBe("code-style");
    expect(entry.body).toContain("[MISSION_STATEMENT]");
    expect(entry.body).toContain("[MANDATORY_INJECTION]");
    expect(entry.body).toContain("[CONTEXT_INFO]");
    expect(entry.body).not.toContain("[BUSINESS_LOGIC_CHUNKS]");
  });

  it("build_ci_config_returns_null_when_absent", () => {
    const forensic = makeForensic({
      candidate_files: [
        { path: "package.json", family: "config", rationale: "" },
        { path: "tsconfig.json", family: "config", rationale: "" },
      ],
      assertions: [], // no CI-related assertions
    });
    const entry = __testing__.buildCIConfigEntry(forensic, NOW);
    expect(entry).toBeNull();
  });

  it("build_ci_config_returns_process_when_present", () => {
    const forensic = makeForensic({
      candidate_files: [
        { path: ".github/workflows/ci.yml", family: "config", rationale: "" },
      ],
    });
    const entry = __testing__.buildCIConfigEntry(forensic, NOW);
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe("process");
    expect(entry!.target_subdir).toBe("processes");
    expect(entry!.slug).toBe("ci-config");
  });

  it("build_readme_para_returns_null_when_absent", () => {
    const forensic = makeForensic({ readme: { quality: "missing", line_count: 0, has_contributing: false } });
    const target = makeTempDir("no-readme");

    const entry = __testing__.buildReadmeFirstParaEntry(target, forensic, NOW);
    expect(entry).toBeNull();
  });

  it("build_readme_para_returns_model_when_present", () => {
    const target = makeTempDir("with-readme");
    writeFileSync(
      join(target, "README.md"),
      "# Fixture project\n\nThis is the deterministic fixture used to validate scan output.\nIt has multiple sentences.\n\n## Usage\n\n```sh\nnpm test\n```\n",
      "utf8",
    );

    const forensic = makeForensic({
      readme: { quality: "ok", line_count: 8, has_contributing: false },
    });
    const entry = __testing__.buildReadmeFirstParaEntry(target, forensic, NOW);

    expect(entry).not.toBeNull();
    expect(entry!.type).toBe("model");
    expect(entry!.target_subdir).toBe("models");
    expect(entry!.slug).toBe("readme-first-paragraph");
    expect(entry!.body).toContain("deterministic fixture");
  });

  it("build_project_brief_returns_null_when_no_explicit_description", () => {
    const target = makeTempDir("no-brief");
    writeFileSync(join(target, "README.md"), "# Project\n\nJust a heading.\n", "utf8");
    const forensic = makeForensic();

    const entry = __testing__.buildProjectBriefEntry(target, forensic, NOW);
    expect(entry).toBeNull();
  });

  it("build_project_brief_returns_model_when_description_heading_present", () => {
    const target = makeTempDir("brief-heading");
    writeFileSync(
      join(target, "README.md"),
      "# Project\n\n## Description\n\nA fixture for the deterministic init-scan that validates output.\n\n## Usage\n\nnpm test\n",
      "utf8",
    );
    const forensic = makeForensic();

    const entry = __testing__.buildProjectBriefEntry(target, forensic, NOW);
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe("model");
    expect(entry!.slug).toBe("project-brief");
    expect(entry!.body).toContain("fixture for the deterministic");
  });

  it("isCIConfigPath classifies common CI surfaces", () => {
    expect(__testing__.isCIConfigPath(".github/workflows/ci.yml")).toBe(true);
    expect(__testing__.isCIConfigPath(".gitlab-ci.yml")).toBe(true);
    expect(__testing__.isCIConfigPath("Jenkinsfile")).toBe(true);
    expect(__testing__.isCIConfigPath("README.md")).toBe(false);
    expect(__testing__.isCIConfigPath("package.json")).toBe(false);
  });

  it("extractFirstParagraph skips heading and returns the first body paragraph", () => {
    const sample = "# Title\n\nFirst para line one.\nFirst para line two.\n\nSecond para.";
    expect(__testing__.extractFirstParagraph(sample)).toBe("First para line one.\nFirst para line two.");
  });

  it("extractExplicitDescription returns null when no description marker is present", () => {
    const sample = "# Title\n\nSome random text.\n";
    expect(__testing__.extractExplicitDescription(sample)).toBeNull();
  });

  it("renderMarkdown emits frontmatter with all 7 v2.0 fields (including tags)", () => {
    const built = {
      type: "model" as const,
      layer: "team" as const,
      maturity: "verified" as const,
      layer_reason: "test reason",
      created_at: NOW,
      title: "Hello",
      body: "## [MISSION_STATEMENT]\n\nbody text\n\n## [CONTEXT_INFO]\n\ncontext text",
      target_subdir: "models" as const,
      slug: "hello",
      id: "KT-MOD-0001" as const,
      tags: ["typescript", "vite"],
    };
    const md = __testing__.renderMarkdown(built);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("id: KT-MOD-0001");
    expect(md).toContain("type: model");
    expect(md).toContain("layer: team");
    expect(md).toContain("maturity: verified");
    expect(md).toContain('layer_reason: "test reason"');
    expect(md).toContain(`created_at: ${NOW}`);
    expect(md).toContain("tags: [typescript, vite]");
    expect(md).toContain("# Hello");
  });

  it("renderMarkdown emits tags: [] when tags is empty", () => {
    const built = {
      type: "model" as const,
      layer: "team" as const,
      maturity: "verified" as const,
      layer_reason: "test reason",
      created_at: NOW,
      title: "Empty tags",
      body: "## [MISSION_STATEMENT]\n\nbody\n\n## [CONTEXT_INFO]\n\nctx",
      target_subdir: "models" as const,
      slug: "empty-tags",
      id: "KT-MOD-0002" as const,
      tags: [],
    };
    const md = __testing__.renderMarkdown(built);
    expect(md).toContain("tags: []");
  });

  it("stripFrontmatter removes leading YAML block", () => {
    const md = "---\nid: KT-MOD-0001\n---\n\n# Title\n\nbody";
    const stripped = __testing__.stripFrontmatter(md);
    expect(stripped).toBe("# Title\n\nbody");
  });

  // Sanity check: ensure deterministic mkdir helper does not throw on shared usage.
  it("test setup mkdir helper works", () => {
    const dir = makeTempDir("mkdir");
    mkdirSync(join(dir, "nested"), { recursive: true });
    expect(tempDirs.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // TASK-008: detectExistingLanguage helper
  // -------------------------------------------------------------------------

  it("detectExistingLanguage returns 'en' for an empty repo", () => {
    const target = makeTempDir("detect-empty");
    expect(__testing__.detectExistingLanguage(target)).toBe("en");
  });

  it("detectExistingLanguage returns 'en' for an EN-only README", () => {
    const target = makeTempDir("detect-en");
    writeFileSync(
      join(target, "README.md"),
      "# Hello\n\nThis project ships a deterministic scan pipeline that emits baseline knowledge entries.\n",
      "utf8",
    );
    expect(__testing__.detectExistingLanguage(target)).toBe("en");
  });

  it("detectExistingLanguage returns 'zh-CN' when README is CJK-heavy", () => {
    const target = makeTempDir("detect-zh");
    writeFileSync(
      join(target, "README.md"),
      // Heavy zh-CN body with EN tech terms inline (M3 style — what fabric repos
      // typically look like once TASK-007 dogfood rewrites are applied).
      "# 项目简介\n\n这是一个用于演示 fabric 扫描管线的最小仓库。它会输出确定性的 knowledge entries，并保留 EN tech terms。\n",
      "utf8",
    );
    expect(__testing__.detectExistingLanguage(target)).toBe("zh-CN");
  });

  it("detectExistingLanguage scans docs/ in addition to README", () => {
    const target = makeTempDir("detect-docs");
    // No README, but docs/ has zh-CN prose.
    mkdirSync(join(target, "docs"), { recursive: true });
    writeFileSync(
      join(target, "docs", "overview.md"),
      "# 概览\n\n本目录记录了项目的核心设计与实现细节，包含若干模块说明。\n",
      "utf8",
    );
    expect(__testing__.detectExistingLanguage(target)).toBe("zh-CN");
  });

  it("resolveKnowledgeLanguage passes through explicit values", () => {
    const target = makeTempDir("resolve-explicit");
    expect(__testing__.resolveKnowledgeLanguage("en", target)).toBe("en");
    expect(__testing__.resolveKnowledgeLanguage("zh-CN", target)).toBe("zh-CN");
  });

  it("BASELINE_TEMPLATES has en + zh-CN entries for all 5 baseline slugs", () => {
    const slugs = ["tech-stack", "module-structure", "build-config", "code-style", "readme-first-paragraph"] as const;
    for (const lang of ["en", "zh-CN"] as const) {
      for (const slug of slugs) {
        expect(__testing__.BASELINE_TEMPLATES[lang][slug]).toBeDefined();
        expect(typeof __testing__.BASELINE_TEMPLATES[lang][slug].build).toBe("function");
      }
    }
  });
});
