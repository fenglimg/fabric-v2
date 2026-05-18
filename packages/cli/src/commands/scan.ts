import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  KnowledgeIdAllocator,
  appendEventLedgerEvent,
  writeKnowledgeMeta,
} from "@fenglimg/fabric-server";
import {
  formatKnowledgeId,
  type ForensicReport,
  type KnowledgeType,
  type Layer,
  type Maturity,
  type StableId,
} from "@fenglimg/fabric-shared";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

import { readFabricConfig } from "../dev-mode.js";
import { t } from "../i18n.js";

// ---------------------------------------------------------------------------
// rc.15 TASK-004 (C7): The top-level `fab scan` command was deleted; its
// behaviour is folded into `fab doctor --rescan` (TASK-003). This module now
// exports only the pure helpers — `runInitScan`, `detectExistingLanguage`,
// and the `__testing__` builder bundle — consumed by:
//   * packages/cli/src/commands/install.ts (init-scan stage)
//   * packages/cli/src/commands/doctor.ts  (--rescan flag)
//   * packages/cli/__tests__/scan-init.test.ts + scan-builders.test.ts
//
// The legacy v1 surface (createScanReport, walkFiles, buildRecommendations,
// getReadmeQuality, matchesIgnorePattern, etc.) was removed clean-slate; its
// only consumer (scan-edge-cases.test.ts) was deleted in the same commit.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// v2.0 rc.1 init-scan: deterministic baseline knowledge entries
//
// `runInitScan` reads the forensic.json snapshot produced by `fab install`
// (TASK-008) and emits 4-7 markdown knowledge entries under
// `.fabric/knowledge/{models,guidelines,processes}/`. Each entry has v2.0
// frontmatter (id KP-/KT-, type, layer, maturity, layer_reason, created_at)
// and uses MISSION_STATEMENT / CONTEXT_INFO sections (plus type-specific
// sections per knowledge-sections.ts contract).
//
// Idempotency: a sidecar at `.fabric/knowledge/.scan-state.json` records the
// content-hash for each stable_id; on re-run unchanged entries are skipped.
// Counters in agents.meta.json are monotonic — deleted files do NOT free
// their counter slot.
// ---------------------------------------------------------------------------

const KNOWLEDGE_DIR = ".fabric/knowledge";
const SCAN_STATE_FILE = ".scan-state.json";
const FORENSIC_FILE = ".fabric/forensic.json";
const AGENTS_META_FILE = ".fabric/agents.meta.json";
const LAYER_REASON = "project artifact (deterministic init scan)";

// v2.0-rc.22 T5: baseline filename unification — every baseline knowledge file
// emitted by `fab scan` now uses `${id}--${slug}.md` (matching the format the
// fabric-archive Skill writes for user-promoted entries). The bare-slug
// filename format (`code-style.md`, `tech-stack.md`, …) shipped through
// rc.21 and is now deprecated; `migrateLegacyBaselineFilenames` (below) runs
// at the start of every `fab scan` and renames any surviving bare-slug
// baseline files in-place. Pre-user clean-slate: no compat fallback — the
// old format is unsupported the moment a `fab scan` runs.
const KNOWN_BASELINE_IDS = new Set<string>([
  "KT-MOD-0001", // tech-stack
  "KT-MOD-0002", // module-structure
  "KT-MOD-0003", // readme-first-paragraph
  "KT-PRO-0001", // build-config
  "KT-PRO-0002", // ci-config (allocated after build-config in the deterministic order)
  "KT-GLD-0001", // code-style
]);

// Slug allowlist mirroring the baseline builders. The migration matches
// `${bare_slug}.md` against this set as a safety belt — a stray file under
// `.fabric/knowledge/**/foo.md` with an unrelated id in KNOWN_BASELINE_IDS
// (impossible in practice, but cheap to guard) is left untouched.
const KNOWN_BASELINE_SLUGS = new Set<string>([
  "tech-stack",
  "module-structure",
  "build-config",
  "code-style",
  "ci-config",
  "readme-first-paragraph",
  "project-brief",
]);

// Match `${id}--${slug}.md` filenames the new emit path produces, e.g.
// `KT-MOD-0001--tech-stack.md`. Used to skip already-migrated files.
const ID_PREFIXED_FILENAME_PATTERN = /^KT-[A-Z]+-\d+--.+\.md$/u;

// v2.0 (grill-followup TASK-008) / rc.12 broad-gate-fabric-lang: bilingual
// init-scan templates. Resolved at scan start from
// `fabric.config.json#fabric_language`. `'match-existing'` is resolved against
// the repo's README / docs prose; an empty repo defaults to `'en'`. The
// supported variants are en + zh-CN (Q3 scope decision); rc.12 additionally
// introduces `'zh-CN-hybrid'` for projects that author Chinese narrative prose
// while preserving English technical terms verbatim — auto-detected as the
// default for any CJK-heavy repo, since real-world CJK projects almost always
// preserve English tech terms. Templates for `'zh-CN-hybrid'` reuse the
// `'zh-CN'` registry (same Chinese narrative body, English headings + tech
// terms preserved by the existing template contract); the enum value remains
// observable downstream so skills can distinguish strict vs hybrid intent.
export type ResolvedLanguage = "en" | "zh-CN" | "zh-CN-hybrid";
type BaselineSlug =
  | "tech-stack"
  | "module-structure"
  | "build-config"
  | "code-style"
  | "readme-first-paragraph";

type TargetSubdir = "models" | "guidelines" | "processes";

interface MarkdownEntry {
  type: KnowledgeType;
  layer: Layer; // always 'team' for this scan
  maturity: Maturity;
  layer_reason: string;
  created_at: string;
  title: string;
  body: string;
  target_subdir: TargetSubdir;
  slug: string;
  // v2/rc.2: derived from forensic tech-stack; used by rc.3 review skill tag-filter.
  tags: string[];
  // v2.0-rc.7 T2: per-builder relevance scope. Five baseline builders
  // (tech-stack, module-structure, build-config, code-style, ci-config) know
  // their canonical paths mechanically and emit narrow + a concrete
  // relevance_paths list so the PreToolUse hook fires on edits to those
  // files. README/project-brief builders stay broad — README is a repo-root
  // singleton that the Phase 1.5 blacklist already covers, and project
  // brief is a cross-cutting description with no path-anchor.
  relevance_scope: "narrow" | "broad";
  relevance_paths: string[];
}

interface BuiltEntry extends MarkdownEntry {
  id: StableId;
}

type ScanState = Record<string, string>;

export interface InitScanResult {
  written_stable_ids: string[];
  skipped_stable_ids: string[];
  total_entries: number;
  duration_ms: number;
}

/**
 * Run the deterministic init-scan against `target`. Throws if forensic.json
 * is missing. Atomic per-file writes; idempotent across re-runs.
 *
 * Exposed for tests and (eventually) the init pipeline orchestrator.
 */
export async function runInitScan(
  targetInput: string,
  options: { now?: Date; source?: "init" | "scan" | "doctor_fix" | "doctor-rescan" } = {},
): Promise<InitScanResult> {
  const startTs = Date.now();
  const target = normalizeTarget(targetInput);
  const forensicPath = join(target, FORENSIC_FILE);

  if (!existsSync(forensicPath)) {
    throw new Error(t("cli.scan.error.missing-forensic", { path: forensicPath }));
  }

  // v2.0-rc.22 T5: rename any legacy bare-slug baseline files to the
  // canonical `${id}--${slug}.md` form BEFORE the emit loop, so the existence
  // check inside the loop sees the new path and re-uses the existing id
  // (no counter regression) instead of allocating a fresh slot.
  await migrateLegacyBaselineFilenames(target);

  const forensic = await readForensic(forensicPath);
  const nowIso = (options.now ?? new Date()).toISOString();

  // v2.0-rc.22 TASK-007 (Scope C / γ): baseline tag derivation removed.
  // Every baseline frontmatter now emits `tags: []` unconditionally —
  // rationale: the previous `deriveTagsFromForensic` derivation accumulated
  // four mis-tagging bugs (unknown framework leak, typescript over-tag,
  // etc.); γ-strategy eliminates the bug class entirely. Consumers
  // (review.ts searchEntries) still work — baselines just no longer
  // tag-match, which is intended since callers can filter by `type` instead.

  // v2.0 grill-followup TASK-008 / rc.12: read fabric_language once at scan
  // start and dispatch every baseline emission through the resolved language.
  // CI config + project brief stay EN-only for now (out of the 5 explicit
  // slugs covered by Q3); they are non-baseline / optional entries.
  const fabricConfig = readFabricConfig(target);
  const fabricLanguage = fabricConfig.fabric_language ?? "match-existing";
  const resolvedLanguage = resolveFabricLanguage(fabricLanguage, target);

  // Build candidate entries (some may be null when source data is missing).
  const candidates: Array<MarkdownEntry | null> = [
    buildTechStackEntry(forensic, nowIso, resolvedLanguage),
    buildModuleStructureEntry(forensic, nowIso, resolvedLanguage),
    buildBuildConfigEntry(forensic, nowIso, resolvedLanguage),
    buildCodeStyleEntry(forensic, nowIso, resolvedLanguage),
    buildCIConfigEntry(forensic, nowIso),
    buildReadmeFirstParaEntry(target, forensic, nowIso, resolvedLanguage),
    buildProjectBriefEntry(target, forensic, nowIso),
  ];
  const entries = candidates.filter((e): e is MarkdownEntry => e !== null);

  const sidecarPath = join(target, KNOWLEDGE_DIR, SCAN_STATE_FILE);
  const sidecar = await readScanState(sidecarPath);

  const allocator = new KnowledgeIdAllocator(join(target, AGENTS_META_FILE));
  const written: StableId[] = [];
  const skipped: StableId[] = [];
  // Tracked for the agents.meta.json patch step below — order mirrors the
  // entries[] iteration order so the id at index i maps to entries[i].
  const placedEntries: BuiltEntry[] = [];

  for (const entry of entries) {
    // v2.0-rc.22 T5: the on-disk filename now embeds the id
    // (`${id}--${slug}.md`). Re-use the existing id by scanning the subdir
    // for any `*--${slug}.md` file whose frontmatter id is sidecar-tracked;
    // this preserves the no-counter-regression contract across re-runs and
    // makes the loop tolerant of the migration step above (which may have
    // just renamed a bare-slug file into this exact shape).
    const subdirAbs = join(target, KNOWLEDGE_DIR, entry.target_subdir);
    const existingId = findExistingIdBySlug(sidecar, subdirAbs, entry.slug);
    const id = existingId ?? (await allocator.allocate(entry.layer, entry.type));
    const built: BuiltEntry = { ...entry, id };
    placedEntries.push(built);

    const targetPath = join(subdirAbs, `${id}--${entry.slug}.md`);

    const fullContent = renderMarkdown(built);
    const bodyHash = sha256(stripFrontmatter(fullContent));
    const sidecarKey = id;

    if (sidecar[sidecarKey] === bodyHash && existsSync(targetPath)) {
      skipped.push(id);
      continue;
    }

    await ensureParentDirectory(targetPath);
    await atomicWriteText(targetPath, fullContent);
    sidecar[sidecarKey] = bodyHash;
    written.push(id);
  }

  await ensureParentDirectory(sidecarPath);
  await atomicWriteJson(sidecarPath, sidecar);

  // Refresh agents.meta.json. writeKnowledgeMeta walks `.fabric/knowledge/`, so
  // knowledge entries are picked up automatically and keyed by their
  // declared KP-/KT-... id. We still call registerKnowledgeNodesInMeta to
  // persist a deterministic node shape (cross-cutting topology, scope_glob
  // '**') for entries init-scan just placed.
  //
  // v2.0 follow-up (rc.1 fix #2): order is REGISTER → WRITE. Previously the
  // calls ran WRITE → REGISTER, which left agents.meta.json with a revision
  // hash computed by registerKnowledgeNodesInMeta's (different) algorithm.
  // Doctor's recomputation via buildKnowledgeMeta uses computeRevision() and
  // therefore always disagreed, surfacing as agents_meta_stale post-init.
  // Reversing the order lets writeKnowledgeMeta own the canonical revision write
  // while still preserving the patched node shape via spread-merge in
  // computeKnowledgeBasedAgentsMeta (existing nodes override defaults).
  await registerKnowledgeNodesInMeta(target, placedEntries);
  await writeKnowledgeMeta(target, { source: "doctor_fix" });

  const durationMs = Date.now() - startTs;
  await appendEventLedgerEvent(target, {
    event_type: "init_scan_completed",
    written_stable_ids: written,
    duration_ms: durationMs,
    source: options.source ?? "scan",
  });

  return {
    written_stable_ids: written,
    skipped_stable_ids: skipped,
    total_entries: entries.length,
    duration_ms: durationMs,
  };
}

// ---------------------------------------------------------------------------
// Bilingual baseline templates (TASK-008)
//
// Each of the 5 baseline slugs has parallel EN + zh-CN bodies. Section
// headings (e.g. `[MISSION_STATEMENT]`, `[CONTEXT_INFO]`) and inline tech
// terms (Node.js, TypeScript, pnpm, framework names, etc.) are preserved
// verbatim in both languages — only narrative prose is localized. This keeps
// the knowledge-sections contract uniform across languages and lets downstream
// review skills tag-filter without language-specific regex.
//
// Resolution order at scan time:
//   1. `fabric.config.json#fabric_language` is read once.
//   2. `'en'` / `'zh-CN'` / `'zh-CN-hybrid'` lock the templates regardless of
//      repo content.
//   3. `'match-existing'` (default) calls `detectExistingLanguage(target)`,
//      which scans the repo's README.md (top-level) and docs/ prose for
//      zh-CN characters (Unicode U+4E00..U+9FFF). When zh-CN ratio > 30%
//      of letter-equivalents the result is `'zh-CN-hybrid'` (rc.12: the
//      auto-detect default, since real-world CJK projects preserve English
//      tech terms); otherwise (including empty repo with no README and no
//      docs/) the result is `'en'`. Pure `'zh-CN'` is intentional opt-in
//      via the config field — never auto-detected.
// ---------------------------------------------------------------------------

interface TechStackInputs {
  projectName: string;
  frameworkSummary: string;
  topExtensionsLine: string;
  evidenceLines: string[];
}

interface ModuleStructureInputs {
  projectName: string;
  totalFiles: number;
  maxDepth: number;
  dirsBlock: string;
  entriesBlock: string;
}

interface BuildConfigInputs {
  projectName: string;
  framework: string;
  configBlock: string;
}

interface CodeStyleInputs {
  projectName: string;
  rulesBlock: string;
  patternsBlock: string;
}

interface ReadmeFirstParaInputs {
  lineCount: number;
  quality: string;
  excerpt: string;
}

interface BaselineTemplate<I> {
  title: string | ((inputs: I) => string);
  build(inputs: I): {
    mission: string;
    context: string;
    mandatoryInjection?: string;
    businessLogic?: string;
  };
}

interface BaselineTemplateRegistry {
  "tech-stack": BaselineTemplate<TechStackInputs>;
  "module-structure": BaselineTemplate<ModuleStructureInputs>;
  "build-config": BaselineTemplate<BuildConfigInputs>;
  "code-style": BaselineTemplate<CodeStyleInputs>;
  "readme-first-paragraph": BaselineTemplate<ReadmeFirstParaInputs>;
}

// rc.12 broad-gate-fabric-lang: `'zh-CN-hybrid'` reuses the `'zh-CN'`
// registry (same Chinese narrative body; English headings + tech terms
// preserved by the template contract). We declare `en` + `zh-CN` inline as
// the strict-pair registry, then alias the hybrid key post-literal so we
// do not duplicate ~150 lines of template definition. The runtime
// invariant — `BASELINE_TEMPLATES["zh-CN-hybrid"] === BASELINE_TEMPLATES["zh-CN"]`
// — is asserted in scan-builders.test.ts.
const STRICT_BASELINE_TEMPLATES: Record<"en" | "zh-CN", BaselineTemplateRegistry> = {
  en: {
    "tech-stack": {
      title: ({ frameworkSummary }) => `Tech stack: ${frameworkSummary}`,
      build: ({ projectName, frameworkSummary, topExtensionsLine, evidenceLines }) => ({
        mission: `Track the primary tech stack and runtime surface used by ${projectName}.`,
        context: [
          `Framework: ${frameworkSummary}`,
          `Top file extensions: ${topExtensionsLine}`,
          `Evidence:`,
          ...evidenceLines.map((line) => `- ${line}`),
        ].join("\n"),
      }),
    },
    "module-structure": {
      title: "Module structure",
      build: ({ projectName, totalFiles, maxDepth, dirsBlock, entriesBlock }) => ({
        mission: `Map the high-level module layout and primary entry points of ${projectName}.`,
        context: [
          `Total files: ${totalFiles}`,
          `Max directory depth: ${maxDepth}`,
          "",
          "Key directories:",
          dirsBlock,
          "",
          "Entry points:",
          entriesBlock,
        ].join("\n"),
      }),
    },
    "build-config": {
      title: "Build configuration",
      build: ({ projectName, framework, configBlock }) => ({
        mission: `Document the deterministic build/bootstrap configuration anchoring ${projectName}.`,
        businessLogic: [
          `1. Detect framework: \`${framework}\`.`,
          `2. Read configuration files in declared order.`,
          `3. Honor compiler/bundler boundaries before generating new code.`,
          `4. Treat config drift as a fact-check signal — re-run \`fab scan\` after edits.`,
        ].join("\n"),
        context: [
          `Framework: ${framework}`,
          "",
          "Configuration files:",
          configBlock,
        ].join("\n"),
      }),
    },
    "code-style": {
      title: "Code style guidelines",
      build: ({ projectName, rulesBlock, patternsBlock }) => ({
        mission: `Codify the recurring authoring conventions observed in ${projectName}.`,
        mandatoryInjection: [
          "When generating or modifying source files in this repo, AI agents MUST:",
          rulesBlock,
        ].join("\n"),
        context: [
          "Detected patterns:",
          patternsBlock,
        ].join("\n"),
      }),
    },
    "readme-first-paragraph": {
      title: "README first paragraph",
      build: ({ lineCount, quality, excerpt }) => ({
        mission: `Preserve the README headline and first paragraph as the canonical project elevator pitch.`,
        context: [
          `Source: README.md (${lineCount} lines, quality=${quality})`,
          "",
          "Excerpt:",
          "> " + excerpt.split("\n").join("\n> "),
        ].join("\n"),
      }),
    },
  },
  "zh-CN": {
    "tech-stack": {
      title: ({ frameworkSummary }) => `Tech stack: ${frameworkSummary}`,
      build: ({ projectName, frameworkSummary, topExtensionsLine, evidenceLines }) => ({
        mission: `记录 ${projectName} 所使用的主要 tech stack 与运行时面。`,
        context: [
          `Framework：${frameworkSummary}`,
          `主要文件后缀：${topExtensionsLine}`,
          `证据：`,
          ...evidenceLines.map((line) => `- ${line}`),
        ].join("\n"),
      }),
    },
    "module-structure": {
      title: "Module structure",
      build: ({ projectName, totalFiles, maxDepth, dirsBlock, entriesBlock }) => ({
        mission: `梳理 ${projectName} 的高层 module 布局与主要 entry point。`,
        context: [
          `文件总数：${totalFiles}`,
          `最大目录深度：${maxDepth}`,
          "",
          "关键目录：",
          dirsBlock,
          "",
          "Entry points：",
          entriesBlock,
        ].join("\n"),
      }),
    },
    "build-config": {
      title: "Build configuration",
      build: ({ projectName, framework, configBlock }) => ({
        mission: `记录 ${projectName} 所依赖的、确定性的 build / bootstrap 配置。`,
        businessLogic: [
          `1. 探测 framework：\`${framework}\`。`,
          `2. 按声明顺序读取 configuration files。`,
          `3. 在生成新代码之前，尊重 compiler / bundler 的边界。`,
          `4. 把 config 漂移视为 fact-check 信号 —— 修改后重新运行 \`fab scan\`。`,
        ].join("\n"),
        context: [
          `Framework：${framework}`,
          "",
          "Configuration files：",
          configBlock,
        ].join("\n"),
      }),
    },
    "code-style": {
      title: "Code style guidelines",
      build: ({ projectName, rulesBlock, patternsBlock }) => ({
        mission: `固化 ${projectName} 中反复出现的写码约定。`,
        mandatoryInjection: [
          "在本仓库内生成或修改源码文件时，AI agent 必须：",
          rulesBlock,
        ].join("\n"),
        context: [
          "观察到的模式：",
          patternsBlock,
        ].join("\n"),
      }),
    },
    "readme-first-paragraph": {
      title: "README first paragraph",
      build: ({ lineCount, quality, excerpt }) => ({
        mission: `把 README 的标题与首段保留为项目对外的 canonical elevator pitch。`,
        context: [
          `来源：README.md（${lineCount} 行，quality=${quality}）`,
          "",
          "摘录：",
          "> " + excerpt.split("\n").join("\n> "),
        ].join("\n"),
      }),
    },
  },
};

// rc.12 broad-gate-fabric-lang: `'zh-CN-hybrid'` is the canonical hybrid
// variant (Chinese narrative prose + English technical terms preserved
// verbatim). The existing `'zh-CN'` registry already encodes the hybrid
// contract — section headings + tech terms (Node.js, TypeScript, pnpm, MCP
// tool names, file paths, etc.) stay English while narrative strings are
// Chinese — so we alias the hybrid variant to the same registry. The enum
// distinction remains observable in the config + scan dispatch so downstream
// skills can branch on intent (strict zh-CN vs hybrid) if needed.
const BASELINE_TEMPLATES: Record<ResolvedLanguage, BaselineTemplateRegistry> = {
  en: STRICT_BASELINE_TEMPLATES.en,
  "zh-CN": STRICT_BASELINE_TEMPLATES["zh-CN"],
  "zh-CN-hybrid": STRICT_BASELINE_TEMPLATES["zh-CN"],
};

function resolveTemplateTitle<I>(template: BaselineTemplate<I>, inputs: I): string {
  return typeof template.title === "function" ? template.title(inputs) : template.title;
}

/**
 * Resolve the configured `fabric_language` value to a concrete `'en'`,
 * `'zh-CN'`, or `'zh-CN-hybrid'`. Pure dispatch for explicit values;
 * delegates to `detectExistingLanguage` for `'match-existing'`.
 *
 * rc.12 broad-gate-fabric-lang: input domain widened from the 3-value
 * (`match-existing | en | zh-CN`) set to the 4-value enum that also
 * accepts `'zh-CN-hybrid'`, matching `fabricLanguageSchema` in
 * `@fenglimg/fabric-shared`.
 */
function resolveFabricLanguage(
  configured: "match-existing" | "en" | "zh-CN" | "zh-CN-hybrid",
  target: string,
): ResolvedLanguage {
  if (configured === "en" || configured === "zh-CN" || configured === "zh-CN-hybrid") {
    return configured;
  }
  return detectExistingLanguage(target);
}

/**
 * Heuristic language detection used when `fabric_language` is set to
 * `'match-existing'` (the default).
 *
 * Reads README.md (top-level) and the `docs/` directory (one level deep) and
 * counts characters in the CJK Unified Ideographs range U+4E00..U+9FFF
 * (zh-CN, ja, ko share this block; we treat any CJK-heavy prose as Chinese
 * for v2.0 since Q3 scope explicitly limits us to en + zh-CN).
 *
 * rc.12 broad-gate-fabric-lang: returns `'zh-CN-hybrid'` (NOT pure
 * `'zh-CN'`) when CJK characters account for more than 30 % of the
 * combined CJK + ASCII letter count. The hybrid variant renders Chinese
 * narrative prose while preserving English technical terms verbatim,
 * which is what real-world CJK projects almost always want — pure
 * `'zh-CN'` is intentional opt-in via the config field and is never
 * auto-detected. Otherwise returns `'en'`. An empty repo (no README, no
 * docs/) defaults to `'en'`. The 30 % threshold is deliberately liberal
 * so a short bilingual README with a sizeable zh-CN section still
 * resolves to hybrid; pure-EN docs sit well below it.
 */
export function detectExistingLanguage(target: string): ResolvedLanguage {
  const ZH_CN_RATIO_THRESHOLD = 0.3;
  const samples: string[] = [];

  const readmePath = join(target, "README.md");
  if (existsSync(readmePath)) {
    try {
      samples.push(readFileSync(readmePath, "utf8"));
    } catch {
      // unreadable README — treat as missing
    }
  }

  const docsDir = join(target, "docs");
  if (existsSync(docsDir)) {
    try {
      const stat = statSync(docsDir);
      if (stat.isDirectory()) {
        for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          if (!/\.(md|mdx|txt)$/iu.test(entry.name)) continue;
          try {
            samples.push(readFileSync(join(docsDir, entry.name), "utf8"));
          } catch {
            // skip unreadable doc files
          }
        }
      }
    } catch {
      // unreadable docs/ — treat as absent
    }
  }

  if (samples.length === 0) {
    // Empty-repo default. Documented contract: no README + no docs/ → 'en'.
    return "en";
  }

  let cjkCount = 0;
  let asciiLetterCount = 0;
  for (const sample of samples) {
    for (const ch of sample) {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 0x4e00 && code <= 0x9fff) {
        cjkCount += 1;
      } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
        asciiLetterCount += 1;
      }
    }
  }

  const denominator = cjkCount + asciiLetterCount;
  if (denominator === 0) {
    return "en";
  }

  const ratio = cjkCount / denominator;
  // rc.12 broad-gate-fabric-lang: CJK signal → 'zh-CN-hybrid' (not 'zh-CN').
  // Real-world CJK projects preserve English technical terms; pure 'zh-CN'
  // is intentional opt-in via the config field, never auto-detected.
  return ratio > ZH_CN_RATIO_THRESHOLD ? "zh-CN-hybrid" : "en";
}

// ---------------------------------------------------------------------------
// Builder helpers — each takes the parsed forensic data + ISO timestamp and
// returns a MarkdownEntry (or null when source data is absent).
//
// Section conventions (knowledge-sections.ts SECTION_NAMES contract):
//   - Always include MISSION_STATEMENT + CONTEXT_INFO
//   - Add MANDATORY_INJECTION when type === 'guideline'
//   - Add BUSINESS_LOGIC_CHUNKS when type === 'process'
//
// TASK-008 / rc.12: the 5 baseline builders dispatch through
// `BASELINE_TEMPLATES` using the resolved fabric_language. Section headings
// + tech terms are preserved verbatim across languages; only narrative
// prose is localized.
// ---------------------------------------------------------------------------

function buildTechStackEntry(
  forensic: ForensicReport,
  nowIso: string,
  language: ResolvedLanguage = "en",
): MarkdownEntry {
  const framework = forensic.framework;
  const byExt = forensic.topology.by_ext ?? {};
  const topExtensions = Object.entries(byExt)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([ext, count]) => `${ext} (${count})`);

  const frameworkSummary = `${framework.kind}${framework.version ? ` ${framework.version}` : ""}${framework.subkind ? ` / ${framework.subkind}` : ""}`;
  const topExtensionsLine = topExtensions.length > 0 ? topExtensions.join(", ") : "(none)";
  const evidenceLines =
    framework.evidence.length > 0 ? framework.evidence.slice(0, 6) : ["(no explicit framework evidence)"];

  const inputs: TechStackInputs = {
    projectName: forensic.project_name,
    frameworkSummary,
    topExtensionsLine,
    evidenceLines,
  };
  const template = BASELINE_TEMPLATES[language]["tech-stack"];
  const sections = template.build(inputs);
  const body = renderSections(sections);

  // v2.0-rc.7 T2: tech-stack is anchored on the manifests that describe it.
  // package.json is the universal signal; pnpm-workspace.yaml widens it to
  // monorepo roots. The glob `**/package.json` is intentionally NOT used —
  // we want the narrow injection to fire on root-manifest edits, not on
  // every dependency's vendored manifest under node_modules.
  const relevancePaths = ["package.json", "pnpm-workspace.yaml"];

  return {
    type: "model",
    layer: "team",
    maturity: "verified",
    layer_reason: LAYER_REASON,
    created_at: nowIso,
    title: resolveTemplateTitle(template, inputs),
    body,
    target_subdir: "models",
    slug: "tech-stack",
    tags: [],
    relevance_scope: "narrow",
    relevance_paths: relevancePaths,
  };
}

function buildModuleStructureEntry(
  forensic: ForensicReport,
  nowIso: string,
  language: ResolvedLanguage = "en",
): MarkdownEntry {
  const keyDirs = forensic.topology.key_dirs ?? [];
  const entryPoints = forensic.entry_points ?? [];
  const totalFiles = forensic.topology.total_files ?? 0;

  const dirsBlock = keyDirs.length > 0
    ? keyDirs.slice(0, 12).map((dir) => `- ${dir}`).join("\n")
    : "- (no key directories detected)";
  const entriesBlock = entryPoints.length > 0
    ? entryPoints.slice(0, 8).map((ep) => `- ${ep.path} — ${ep.reason}`).join("\n")
    : "- (no entry points detected)";

  const inputs: ModuleStructureInputs = {
    projectName: forensic.project_name,
    totalFiles,
    maxDepth: forensic.topology.max_depth ?? 0,
    dirsBlock,
    entriesBlock,
  };
  const template = BASELINE_TEMPLATES[language]["module-structure"];
  const body = renderSections(template.build(inputs));

  // v2.0-rc.7 T2: module structure is anchored on the per-package manifests
  // in a workspace. `packages/**/package.json` is the canonical monorepo
  // signal; for single-package repos it just won't match, which is fine —
  // narrow_paths is allowed to be a forecast as long as the entry stays
  // useful in the workspaces where it does match. Single-package layouts
  // get their tech-stack hint via the broader `package.json` glob above.
  const relevancePaths = ["packages/**/package.json"];

  return {
    type: "model",
    layer: "team",
    maturity: "verified",
    layer_reason: LAYER_REASON,
    created_at: nowIso,
    title: resolveTemplateTitle(template, inputs),
    body,
    target_subdir: "models",
    slug: "module-structure",
    tags: [],
    relevance_scope: "narrow",
    relevance_paths: relevancePaths,
  };
}

function buildBuildConfigEntry(
  forensic: ForensicReport,
  nowIso: string,
  language: ResolvedLanguage = "en",
): MarkdownEntry {
  const configFiles = (forensic.candidate_files ?? [])
    .filter((entry) => entry.family === "config")
    .map((entry) => entry.path);
  const framework = forensic.framework.kind;

  const configBlock = configFiles.length > 0
    ? configFiles.map((file) => `- ${file}`).join("\n")
    : "- (no config files detected)";

  const inputs: BuildConfigInputs = {
    projectName: forensic.project_name,
    framework,
    configBlock,
  };
  const template = BASELINE_TEMPLATES[language]["build-config"];
  const body = renderSections(template.build(inputs));

  // v2.0-rc.7 T2: build-config narrows onto the build manifests the forensic
  // scan already discovered. We use those as path anchors directly so the
  // hook fires on edits to exactly the files this entry documents. Falls
  // back to a small canonical list when forensic surfaced none — better to
  // hint over-eagerly than to silently stay broad.
  const discovered = configFiles.filter((path) => isBuildConfigPath(path));
  const relevancePaths = discovered.length > 0
    ? Array.from(new Set(discovered))
    : ["tsconfig.json", "tsconfig.*.json", "vite.config.*", "rollup.config.*", "webpack.config.*"];

  return {
    type: "process",
    layer: "team",
    maturity: "verified",
    layer_reason: LAYER_REASON,
    created_at: nowIso,
    title: resolveTemplateTitle(template, inputs),
    body,
    target_subdir: "processes",
    slug: "build-config",
    tags: [],
    relevance_scope: "narrow",
    relevance_paths: relevancePaths,
  };
}

function buildCodeStyleEntry(
  forensic: ForensicReport,
  nowIso: string,
  language: ResolvedLanguage = "en",
): MarkdownEntry {
  const dominantPatterns = (forensic.assertions ?? [])
    .filter((a) => a.type === "pattern" || a.type === "domain")
    .slice(0, 4)
    .map((a) => `- ${a.statement}`);

  const proposedRules = (forensic.assertions ?? [])
    .map((a) => a.proposed_rule)
    .filter((rule): rule is string => typeof rule === "string" && rule.length > 0)
    .slice(0, 4);

  const patternsBlock = dominantPatterns.length > 0 ? dominantPatterns.join("\n") : "- (no dominant patterns detected)";
  const rulesBlock = proposedRules.length > 0
    ? proposedRules.map((rule) => `- ${rule}`).join("\n")
    : "- Follow existing module/file patterns; do not introduce new conventions without team agreement.";

  const inputs: CodeStyleInputs = {
    projectName: forensic.project_name,
    rulesBlock,
    patternsBlock,
  };
  const template = BASELINE_TEMPLATES[language]["code-style"];
  const body = renderSections(template.build(inputs));

  // v2.0-rc.7 T2: code-style narrows onto the canonical lint/format config
  // files. The list is deterministic — these paths are conventional for
  // every Node/JS workspace, regardless of which tool is actually in use.
  // Editing any of them is the natural moment to surface this entry.
  const relevancePaths = [
    ".prettierrc",
    ".prettierrc.*",
    ".editorconfig",
    "eslint.config.*",
    ".eslintrc",
    ".eslintrc.*",
  ];

  return {
    type: "guideline",
    layer: "team",
    maturity: "verified",
    layer_reason: LAYER_REASON,
    created_at: nowIso,
    title: resolveTemplateTitle(template, inputs),
    body,
    target_subdir: "guidelines",
    slug: "code-style",
    tags: [],
    relevance_scope: "narrow",
    relevance_paths: relevancePaths,
  };
}

function buildCIConfigEntry(forensic: ForensicReport, nowIso: string): MarkdownEntry | null {
  const ciFiles = (forensic.candidate_files ?? [])
    .map((entry) => entry.path)
    .filter((path) => isCIConfigPath(path));

  // Also scan topology evidence for CI hints (assertions may not surface them).
  const ciExtensions = forensic.topology.by_ext ?? {};
  const hasCISignal =
    ciFiles.length > 0 ||
    Object.keys(ciExtensions).some((ext) => ext === ".yml" || ext === ".yaml") &&
      (forensic.assertions ?? []).some((a) => /ci|workflow|pipeline/i.test(a.statement));

  if (!hasCISignal) {
    return null;
  }

  const filesBlock = ciFiles.length > 0
    ? ciFiles.map((file) => `- ${file}`).join("\n")
    : "- (CI configuration inferred from repository topology)";

  const body = renderSections({
    mission: `Document the CI / continuous-verification pipeline guarding ${forensic.project_name}.`,
    businessLogic: [
      "1. Pull request opens → CI workflow triggers.",
      "2. Lint + typecheck + unit tests must pass before review.",
      "3. Failing checks block merge until resolved.",
      "4. Updates to CI configuration should accompany the change they enable.",
    ].join("\n"),
    context: [
      "CI configuration sources:",
      filesBlock,
    ].join("\n"),
  });

  // v2.0-rc.7 T2: CI config narrows onto the workflow directories the major
  // platforms use. GitHub Actions is the most common, but we cover GitLab,
  // CircleCI, and Jenkins in case the repo migrates.
  const relevancePaths = [
    ".github/workflows/**",
    ".gitlab-ci.yml",
    ".circleci/**",
    "Jenkinsfile",
  ];

  return {
    type: "process",
    layer: "team",
    maturity: "verified",
    layer_reason: LAYER_REASON,
    created_at: nowIso,
    title: "CI configuration",
    body,
    target_subdir: "processes",
    slug: "ci-config",
    tags: [],
    relevance_scope: "narrow",
    relevance_paths: relevancePaths,
  };
}

function buildReadmeFirstParaEntry(
  target: string,
  forensic: ForensicReport,
  nowIso: string,
  language: ResolvedLanguage = "en",
): MarkdownEntry | null {
  if (forensic.readme.quality === "missing") {
    return null;
  }

  const readmePath = join(target, "README.md");
  if (!existsSync(readmePath)) {
    return null;
  }

  const readme = readFileSync(readmePath, "utf8");
  const firstPara = extractFirstParagraph(readme);
  if (firstPara === null) {
    return null;
  }

  const inputs: ReadmeFirstParaInputs = {
    lineCount: forensic.readme.line_count,
    quality: forensic.readme.quality,
    excerpt: firstPara,
  };
  const template = BASELINE_TEMPLATES[language]["readme-first-paragraph"];
  const body = renderSections(template.build(inputs));

  return {
    type: "model",
    layer: "team",
    maturity: "verified",
    layer_reason: LAYER_REASON,
    created_at: nowIso,
    title: resolveTemplateTitle(template, inputs),
    body,
    target_subdir: "models",
    slug: "readme-first-paragraph",
    tags: [],
    // v2.0-rc.7 T2: broad by design — single repo-root file, the Phase 1.5
    // PreToolUse blacklist already covers README. Anchoring this entry to
    // README.md would surface it on every README edit, which is noise.
    relevance_scope: "broad",
    relevance_paths: [],
  };
}

function buildProjectBriefEntry(
  target: string,
  forensic: ForensicReport,
  nowIso: string,
): MarkdownEntry | null {
  if (forensic.readme.quality === "missing") {
    return null;
  }

  const readmePath = join(target, "README.md");
  if (!existsSync(readmePath)) {
    return null;
  }

  const readme = readFileSync(readmePath, "utf8");
  const description = extractExplicitDescription(readme);
  if (description === null) {
    return null;
  }

  const body = renderSections({
    mission: `Capture the explicit project description declared by README.md.`,
    context: [
      `Project: ${forensic.project_name}`,
      "",
      "Declared description:",
      "> " + description.split("\n").join("\n> "),
    ].join("\n"),
  });

  return {
    type: "model",
    layer: "team",
    maturity: "verified",
    layer_reason: LAYER_REASON,
    created_at: nowIso,
    title: "Project brief",
    body,
    target_subdir: "models",
    slug: "project-brief",
    tags: [],
    // v2.0-rc.7 T2: broad — project brief is a cross-cutting description
    // with no path anchor. Narrowing it to README.md would duplicate the
    // readme-first-paragraph surface; keeping it broad lets the
    // SessionStart broad hint do the right thing.
    relevance_scope: "broad",
    relevance_paths: [],
  };
}

// ---------------------------------------------------------------------------
// Markdown / frontmatter rendering
// ---------------------------------------------------------------------------

function renderMarkdown(entry: BuiltEntry): string {
  const frontmatter = renderFrontmatter(entry);
  return `${frontmatter}\n\n# ${entry.title}\n\n${entry.body}\n`;
}

function renderFrontmatter(entry: BuiltEntry): string {
  const tagsLine = entry.tags.length > 0
    ? `tags: [${entry.tags.join(", ")}]`
    : "tags: []";
  // v2.0-rc.7 T2: emit relevance_scope + relevance_paths so the doctor
  // line-based parser (RELEVANCE_SCOPE_LINE_PATTERN / RELEVANCE_PATHS_LINE_
  // PATTERN in packages/server/src/services/doctor.ts) picks them up, and
  // the meta-builder forwards them into description.relevance_paths for
  // PreToolUse narrow-injection matching. Flow-style array matches the
  // exact shape RELEVANCE_PATHS_LINE_PATTERN expects.
  const relevancePathsLine = entry.relevance_paths.length > 0
    ? `relevance_paths: [${entry.relevance_paths.map((p) => quoteIfNeeded(p)).join(", ")}]`
    : "relevance_paths: []";
  const lines = [
    "---",
    `id: ${entry.id}`,
    `type: ${entry.type}`,
    `layer: ${entry.layer}`,
    `maturity: ${entry.maturity}`,
    `layer_reason: ${quoteIfNeeded(entry.layer_reason)}`,
    `created_at: ${entry.created_at}`,
    tagsLine,
    `relevance_scope: ${entry.relevance_scope}`,
    relevancePathsLine,
    "---",
  ];
  return lines.join("\n");
}

function renderSections(input: {
  mission: string;
  context: string;
  mandatoryInjection?: string;
  businessLogic?: string;
}): string {
  const parts: string[] = [];
  parts.push(`## [MISSION_STATEMENT]\n\n${input.mission}`);
  if (input.mandatoryInjection !== undefined) {
    parts.push(`## [MANDATORY_INJECTION]\n\n${input.mandatoryInjection}`);
  }
  if (input.businessLogic !== undefined) {
    parts.push(`## [BUSINESS_LOGIC_CHUNKS]\n\n${input.businessLogic}`);
  }
  parts.push(`## [CONTEXT_INFO]\n\n${input.context}`);
  return parts.join("\n\n");
}

function quoteIfNeeded(value: string): string {
  // YAML scalar safety: quote when the value contains any of YAML's reserved
  // chars or starts with a reserved indicator. We always quote here for
  // simplicity and because the deterministic layer_reason text contains '('.
  return `"${value.replace(/"/g, '\\"')}"`;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?\r?\n---\s*\r?\n?/u, "");
}

// ---------------------------------------------------------------------------
// Forensic reading + helpers
// ---------------------------------------------------------------------------

// v2.0-rc.22 TASK-007 (Scope C / γ): `deriveTagsFromForensic` deleted.
// The legacy helper mapped framework.kind + top file-extensions into a 5-tag
// list for baseline frontmatter, but produced four recurring mis-tags. The
// γ-strategy eliminates the bug class: baselines now emit `tags: []` (see
// `runInitScan` builder call site). If tag-style filtering is ever needed
// for baselines, prefer filtering by `type` / `slug` instead — they already
// carry the relevant semantics deterministically.

async function readForensic(forensicPath: string): Promise<ForensicReport> {
  const raw = await readFile(forensicPath, "utf8");
  // We don't re-validate via zod here; forensic.json is produced by `fabric
  // init` and is validated at write time. If the file is corrupt, JSON.parse
  // will throw — surfaced as an error in the CLI run() handler.
  return JSON.parse(raw) as ForensicReport;
}

async function readScanState(sidecarPath: string): Promise<ScanState> {
  if (!existsSync(sidecarPath)) {
    return {};
  }
  try {
    const raw = await readFile(sidecarPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      return {};
    }
    const result: ScanState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * v2.0-rc.22 T5: rename any surviving bare-slug baseline files
 * (`code-style.md`, `tech-stack.md`, …) to the canonical
 * `${id}--${slug}.md` form. Runs once at the start of every `fab scan` so
 * one command completes the migration end-to-end — there is no separate
 * codemod.
 *
 * Allowlist is intentionally hardcoded (KNOWN_BASELINE_IDS + KNOWN_BASELINE_SLUGS):
 *   * id must be in the baseline id allowlist
 *   * basename minus `.md` must be in the baseline slug allowlist
 *
 * Both must match; this guards against an unrelated user file that happens to
 * declare one of the baseline ids in its frontmatter. User-promoted entries
 * (KP-* or KT-* outside the allowlist) are left untouched.
 *
 * Side effects:
 *   * `unlink` the old path
 *   * `atomicWriteText` the same content at the new path (no body mutation)
 * Returns the migration report so callers (and tests) can assert the set.
 */
export async function migrateLegacyBaselineFilenames(
  target: string,
): Promise<{ migrated: Array<{ from: string; to: string; id: string }> }> {
  const knowledgeRoot = join(target, KNOWLEDGE_DIR);
  if (!existsSync(knowledgeRoot)) {
    return { migrated: [] };
  }

  const migrated: Array<{ from: string; to: string; id: string }> = [];
  const subdirs: TargetSubdir[] = ["models", "guidelines", "processes"];

  for (const sub of subdirs) {
    const subdirPath = join(knowledgeRoot, sub);
    if (!existsSync(subdirPath)) continue;

    let entries: string[];
    try {
      entries = readdirSync(subdirPath);
    } catch {
      continue;
    }

    for (const name of entries) {
      if (!name.endsWith(".md")) continue;

      // v2.0-rc.22 hotfix (Finding 1 / Scope B+C interplay): even files
      // that were already migrated to the canonical `${id}--${slug}.md`
      // form may carry pre-T7 stale tags in their frontmatter (the
      // body-hash skip gate in runInitScan short-circuits the rewrite
      // when the rendered body is unchanged). Scrub those in-place
      // here, before the gate runs, so one `fab scan` cleans them.
      if (ID_PREFIXED_FILENAME_PATTERN.test(name)) {
        const idMatch = /^(KT-[A-Z]+-\d+)--(.+)\.md$/u.exec(name);
        if (idMatch === null) continue;
        const [, fileId, fileSlug] = idMatch;
        if (!KNOWN_BASELINE_IDS.has(fileId)) continue;
        if (!KNOWN_BASELINE_SLUGS.has(fileSlug)) continue;
        const onDiskPath = join(subdirPath, name);
        let onDiskRaw: string;
        try {
          onDiskRaw = readFileSync(onDiskPath, "utf8");
        } catch {
          continue;
        }
        const scrubbed = stripStaleTagsLine(onDiskRaw);
        if (scrubbed !== onDiskRaw) {
          await atomicWriteText(onDiskPath, scrubbed);
        }
        continue;
      }

      const bareSlug = name.slice(0, -".md".length);
      if (!KNOWN_BASELINE_SLUGS.has(bareSlug)) continue;

      const oldPath = join(subdirPath, name);
      let raw: string;
      try {
        raw = readFileSync(oldPath, "utf8");
      } catch {
        continue;
      }

      const id = extractFrontmatterId(raw);
      if (id === null || !KNOWN_BASELINE_IDS.has(id)) continue;

      const newName = `${id}--${bareSlug}.md`;
      const newPath = join(subdirPath, newName);

      // v2.0-rc.22 hotfix (Finding 1 / Scope B+C interplay): clear any stale
      // `tags:` line from the legacy frontmatter during the rename so the
      // body-hash skip gate in runInitScan cannot leave pre-T7 tags
      // (`tags: [unknown, typescript, csv, ndjson, [none]]` etc.) on disk
      // when the rendered body is unchanged. T7 (Scope C / γ) made baseline
      // tags unconditionally `[]`, but the existing rendered-body hash
      // matches the new emit and the skip gate short-circuits before any
      // rewrite, so without this strip the stale tags survive forever.
      // Idempotent: `tags: []` is the canonical T7 form, so re-running this
      // migration on an already-clean file is a no-op string replacement.
      const cleanedRaw = stripStaleTagsLine(raw);

      // Idempotent: if the target already exists (e.g. previous interrupted
      // migration left both files behind), just drop the legacy bare-slug
      // file. atomicWriteText would overwrite the new path with stale content
      // otherwise, since `raw` here is the legacy file.
      if (existsSync(newPath)) {
        try {
          await unlink(oldPath);
        } catch {
          // best-effort — leave the stale legacy file in place if unlink fails
        }
        continue;
      }

      await atomicWriteText(newPath, cleanedRaw);
      try {
        await unlink(oldPath);
      } catch {
        // best-effort — atomicWriteText already placed the new file; a stale
        // duplicate is recoverable by re-running scan.
      }

      migrated.push({ from: oldPath, to: newPath, id });
    }
  }

  return { migrated };
}

/**
 * v2.0-rc.22 hotfix (Finding 1): replace any `tags:` line inside the
 * frontmatter block with the canonical `tags: []` form. Used by
 * `migrateLegacyBaselineFilenames` to scrub pre-T7 stale tags
 * (`tags: [unknown, typescript, csv, ndjson, [none]]`, etc.) during the
 * rename so the body-hash skip gate in `runInitScan` cannot leave them on
 * disk when the rendered body is unchanged.
 *
 * Defensive against both YAML styles:
 *   - flow style (single line):  `tags: [a, b, c]` or `tags: []`
 *   - block style (multi-line):  `tags:\n  - a\n  - b\n`
 *   - bare empty:                `tags:` (treated as null/empty)
 *
 * Operates strictly within the leading `---\n...\n---` frontmatter block; if
 * no frontmatter is present (or it is malformed), returns `raw` unchanged.
 * Always emits `tags: []` — never deletes the line — so downstream parsers
 * see a stable, idempotent shape.
 */
function stripStaleTagsLine(raw: string): string {
  const fmMatch = /^(---\r?\n)([\s\S]*?)(\r?\n---\s*(?:\r?\n|$))/u.exec(raw);
  if (fmMatch === null) return raw;
  const head = fmMatch[1];
  const body = fmMatch[2];
  const tail = fmMatch[3];
  const rest = raw.slice(fmMatch[0].length);

  // 1) Try flow-style first: `tags: [...]` on a single line. The bracket
  // contents may contain other brackets (the historical pre-T7 bug emitted
  // `[unknown, typescript, csv, ndjson, [none]]`), so we greedily consume
  // up to the last `]` on the line rather than requiring a flat character
  // class — safe because we anchor the line via the `m` flag.
  const flowPattern = /^tags:[ \t]*\[[^\n]*\][ \t]*$/mu;
  if (flowPattern.test(body)) {
    const replaced = body.replace(flowPattern, "tags: []");
    return `${head}${replaced}${tail}${rest}`;
  }

  // 2) Block-style: `tags:` followed by indented `- value` lines.
  const blockPattern = /^tags:[ \t]*\r?\n(?:[ \t]+-[ \t]+.+\r?\n?)+/mu;
  if (blockPattern.test(body)) {
    // Re-anchor without consuming the trailing newline so we keep block layout.
    const replaced = body.replace(blockPattern, "tags: []\n");
    // Normalize duplicate trailing newlines that the substitution may produce.
    return `${head}${replaced.replace(/\n{2,}$/u, "\n")}${tail}${rest}`;
  }

  // 3) Bare empty: `tags:` with nothing after (null scalar). Normalize to [].
  const barePattern = /^tags:[ \t]*$/mu;
  if (barePattern.test(body)) {
    const replaced = body.replace(barePattern, "tags: []");
    return `${head}${replaced}${tail}${rest}`;
  }

  // No tags line present — caller's frontmatter is already minimal, leave
  // untouched. The init-scan emit path will add `tags: []` on next rewrite.
  return raw;
}

/**
 * Pull the frontmatter `id:` value out of a raw markdown string, or null when
 * the file has no frontmatter / no id line. Mirrors the regex used by
 * `findExistingIdForFile` but returns the string id (caller validates against
 * the baseline allowlist).
 */
function extractFrontmatterId(raw: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
  if (match === null) return null;
  const idLine = /^id:\s*(.+)$/mu.exec(match[1]);
  if (idLine === null) return null;
  return idLine[1].replace(/^["'](.*)["']$/u, "$1").trim();
}

/**
 * If the sidecar contains a key whose entry was previously written for the
 * given target file path (matched by file existence), return that id so we do
 * NOT allocate a fresh counter on re-run for an unchanged-but-renamed slot.
 *
 * For the deterministic builders the slug is stable, so the file path stays
 * the same; the simpler "look for any sidecar entry whose path matches" logic
 * suffices and avoids burning counter slots when content drifts.
 */
/**
 * v2.0-rc.22 T5: locate an existing id-prefixed baseline file by slug.
 *
 * Scans `subdirAbs` for any file matching `^KT-[A-Z]+-\d+--${slug}\.md$`,
 * reads its frontmatter id, and returns it iff the id is recorded in the
 * sidecar (i.e. this scan emitted it on a previous run). Returns null when
 * no matching file exists, multiple match (defensive — should never happen
 * with the deterministic builder set), or the on-disk id is not
 * sidecar-tracked.
 *
 * Replaces the path-keyed `findExistingIdForFile` call previously used in
 * the runInitScan loop; the legacy helper is preserved (and still exported
 * via tests) but no longer reachable from the main flow.
 */
function findExistingIdBySlug(sidecar: ScanState, subdirAbs: string, slug: string): StableId | null {
  if (!existsSync(subdirAbs)) {
    return null;
  }
  let entries: string[];
  try {
    entries = readdirSync(subdirAbs);
  } catch {
    return null;
  }

  // Escape slug for the regex (slugs are plain `a-z0-9-` today, but defensive).
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`^(KT-[A-Z]+-\\d+)--${escapedSlug}\\.md$`, "u");

  const matches: Array<{ id: string; file: string }> = [];
  for (const name of entries) {
    const m = pattern.exec(name);
    if (m === null) continue;
    matches.push({ id: m[1], file: name });
  }

  if (matches.length !== 1) {
    return null;
  }

  // Cross-check on-disk frontmatter id against the filename id; mismatch
  // means a hand-edited or corrupted file — fall back to fresh allocation.
  const filenameId = matches[0].id;
  try {
    const raw = readFileSync(join(subdirAbs, matches[0].file), "utf8");
    const frontmatterId = extractFrontmatterId(raw);
    if (frontmatterId !== filenameId) {
      return null;
    }
  } catch {
    return null;
  }

  if (!/^K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d{4,}$/u.test(filenameId)) {
    return null;
  }
  if (sidecar[filenameId] === undefined) {
    // Unknown to sidecar — this is the first run after a manual file drop;
    // treat as fresh and allocate a new counter slot to keep semantics
    // identical to the legacy path-keyed lookup.
    return null;
  }
  return filenameId as StableId;
}

function findExistingIdForFile(sidecar: ScanState, targetPath: string, target: string): StableId | null {
  if (!existsSync(targetPath)) {
    return null;
  }
  // Read the on-disk file to extract its declared id from frontmatter.
  try {
    const raw = readFileSync(targetPath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
    if (match === null) {
      return null;
    }
    const idLine = /^id:\s*(.+)$/mu.exec(match[1]);
    if (idLine === null) {
      return null;
    }
    const candidate = idLine[1].replace(/^["'](.*)["']$/u, "$1").trim();
    if (/^K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d{4,}$/.test(candidate) && sidecar[candidate] !== undefined) {
      return candidate as StableId;
    }
    return null;
  } catch {
    void target;
    return null;
  }
}

function isCIConfigPath(path: string): boolean {
  return (
    path.startsWith(".github/workflows/") ||
    path.startsWith(".gitlab-ci") ||
    path === "azure-pipelines.yml" ||
    path === ".circleci/config.yml" ||
    path === "Jenkinsfile" ||
    path === ".travis.yml"
  );
}

// v2.0-rc.7 T2: tightly-scoped predicate for the build-config builder's
// relevance_paths derivation. Mirrors isCIConfigPath in shape: matches the
// file basenames + extension patterns we want the PreToolUse hook to fire
// on, while excluding lint/style configs (those belong to code-style).
function isBuildConfigPath(path: string): boolean {
  const lower = path.toLowerCase();
  // Strip directory prefix for basename checks.
  const basename = lower.split("/").pop() ?? lower;
  if (basename.startsWith("tsconfig") && basename.endsWith(".json")) return true;
  if (basename === "package.json") return true;
  if (basename === "pnpm-workspace.yaml" || basename === "pnpm-workspace.yml") return true;
  if (basename.startsWith("vite.config.")) return true;
  if (basename.startsWith("rollup.config.")) return true;
  if (basename.startsWith("webpack.config.")) return true;
  if (basename.startsWith("vitest.config.")) return true;
  if (basename === "turbo.json" || basename === "nx.json") return true;
  return false;
}

function extractFirstParagraph(readme: string): string | null {
  // Skip leading blank lines and an optional title heading.
  const lines = readme.split(/\r?\n/);
  let i = 0;

  // Skip BOM-only / blank lines.
  while (i < lines.length && lines[i].trim().length === 0) i += 1;

  // Skip h1 heading line(s) immediately following.
  while (i < lines.length && /^#{1,2}\s/.test(lines[i].trim())) {
    i += 1;
    while (i < lines.length && lines[i].trim().length === 0) i += 1;
  }

  if (i >= lines.length) {
    return null;
  }

  const collected: string[] = [];
  while (i < lines.length && lines[i].trim().length > 0) {
    // Stop on subsequent headings.
    if (/^#{1,6}\s/.test(lines[i].trim())) break;
    collected.push(lines[i]);
    i += 1;
  }

  const paragraph = collected.join("\n").trim();
  return paragraph.length > 0 ? paragraph : null;
}

/**
 * Pull an explicit project description from README — looks for a "Description"
 * heading or the value following an italic/bold label like "**About**:".
 * Returns null when no explicit description marker is present (so the
 * project-brief entry is optional, per task spec).
 */
function extractExplicitDescription(readme: string): string | null {
  // Pattern 1: a heading literally named Description / About / Overview followed by a paragraph.
  const headingMatch =
    /^#{1,6}\s+(?:Description|About|Overview|Summary)\s*\r?\n+([^#][\s\S]*?)(?:\r?\n\r?\n|\r?\n#{1,6}\s|$)/imu.exec(readme);
  if (headingMatch !== null) {
    const text = headingMatch[1].trim();
    if (text.length > 0) return text;
  }

  // Pattern 2: a bold label like "**Description:**" or "**About**:".
  const labelMatch =
    /^\*\*(?:Description|About|Overview|Summary)\*\*\s*:?\s*(.+?)(?:\r?\n\r?\n|$)/imu.exec(readme);
  if (labelMatch !== null) {
    const text = labelMatch[1].trim();
    if (text.length > 0) return text;
  }

  return null;
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/**
 * Patch agents.meta.json so each knowledge file is recorded as a node with
 * identity_source='declared' and stable_id matching its frontmatter id.
 *
 * The init-scan owns the meta-registration step for newly-placed knowledge
 * files, ensuring nodes carry the canonical cross-cutting topology
 * (scope_glob '**') even before the next rule-meta refresh.
 */
async function registerKnowledgeNodesInMeta(target: string, entries: BuiltEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const metaPath = join(target, AGENTS_META_FILE);
  let meta: Record<string, unknown>;
  try {
    const raw = await readFile(metaPath, "utf8");
    meta = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    meta = {};
  }

  const nodes = (typeof meta.nodes === "object" && meta.nodes !== null
    ? (meta.nodes as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  for (const entry of entries) {
    // v2.0-rc.22 T5: content_ref mirrors the new on-disk filename
    // (`${id}--${slug}.md`). Drives PreToolUse narrow-injection lookups via
    // meta.nodes[id].content_ref, so it must stay aligned with the actual
    // file written by runInitScan above.
    const contentRef = `${KNOWLEDGE_DIR}/${entry.target_subdir}/${entry.id}--${entry.slug}.md`;
    const absPath = join(target, contentRef);
    let hash = "";
    try {
      const raw = readFileSync(absPath, "utf8");
      hash = sha256(raw);
    } catch {
      // file may have been removed concurrently — leave hash empty
    }

    nodes[entry.id] = {
      file: contentRef,
      content_ref: contentRef,
      scope_glob: "**",
      deps: [],
      priority: "medium",
      level: "L1",
      layer: "L1",
      topology_type: "cross-cutting",
      hash,
      stable_id: entry.id,
      identity_source: "declared",
    };
  }

  meta.nodes = nodes;
  // v2.0 follow-up (rc.1 fix #2): do NOT touch revision here. The canonical
  // revision is owned by writeKnowledgeMeta() / computeRevision() in the
  // knowledge-meta-builder module — its algorithm is the one doctor recomputes
  // for staleness detection. Earlier this function wrote
  // `sha256(JSON.stringify(nodes))`, which used a different keying and
  // therefore always disagreed with doctor's recomputation. The single
  // owner of the revision field is now writeKnowledgeMeta(), invoked AFTER this
  // function in runInitScan. We deliberately leave any pre-existing
  // revision in place (or drop it on first write); writeKnowledgeMeta will
  // overwrite it with the canonical value.

  await ensureParentDirectory(metaPath);
  await atomicWriteJson(metaPath, meta);
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

// Allow formatKnowledgeId to be referenced downstream tests via re-export.
export { formatKnowledgeId };

// Test-only exports — used by unit tests in __tests__/scan-builders.test.ts
// to exercise individual deterministic builders without invoking runInitScan.
export const __testing__ = {
  buildTechStackEntry,
  buildModuleStructureEntry,
  buildBuildConfigEntry,
  buildCodeStyleEntry,
  buildCIConfigEntry,
  buildReadmeFirstParaEntry,
  buildProjectBriefEntry,
  renderMarkdown,
  stripFrontmatter,
  isCIConfigPath,
  isBuildConfigPath,
  extractFirstParagraph,
  extractExplicitDescription,
  // TASK-008 / rc.12: bilingual template registry + language detection
  detectExistingLanguage,
  resolveFabricLanguage,
  BASELINE_TEMPLATES,
  // v2.0-rc.22 hotfix (Finding 1): stale-tag scrub used during migration
  stripStaleTagsLine,
};
