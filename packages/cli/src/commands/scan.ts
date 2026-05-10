import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { defineCommand } from "citty";

import {
  KnowledgeIdAllocator,
  appendEventLedgerEvent,
  writeRuleMeta,
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

import { displayWidth, padEnd, paint, symbol } from "../colors.js";
import { createDebugLogger, readFabricConfig, resolveDevMode } from "../dev-mode.js";
import { t } from "../i18n.js";
import { detectFramework, type FrameworkInfo } from "../scanner/detector.js";
import { resolveIgnores } from "../scanner/ignores.js";

// ---------------------------------------------------------------------------
// Public legacy API — kept because callers depend on it:
//   * packages/cli/__tests__/integration/scan-edge-cases.test.ts
//   * packages/cli/__tests__/init-mcp-scope.test.ts (mocked)
//
// The new init-scan behavior lives in `runInitScan` below and is exposed via
// `scanCommand.run()`. v2.0: the prior bootstrap guide consumer was retired
// alongside `.fabric/bootstrap/README.md`.
// ---------------------------------------------------------------------------

export type ReadmeQuality = "stub" | "ok";

export type ScanReport = {
  target: string;
  framework: FrameworkInfo;
  readmeQuality: ReadmeQuality;
  hasContributing: boolean;
  fileCount: number;
  ignoredCount: number;
  hasExistingFabric: boolean;
  recommendations: string[];
};

type WalkResult = {
  fileCount: number;
  ignoredCount: number;
};

type ScanArgs = {
  target?: string;
  debug?: boolean;
  json?: boolean;
};

export async function createScanReport(
  targetInput: string = process.cwd(),
  fabricConfig?: { scanIgnores?: string[] },
): Promise<ScanReport> {
  const target = normalizeTarget(targetInput);
  const framework = detectFramework(target);
  const readmeQuality = getReadmeQuality(target);
  const hasContributing = existsSync(join(target, "CONTRIBUTING.md"));
  const hasExistingFabric =
    existsSync(join(target, ".fabric", "bootstrap", "README.md")) || existsSync(join(target, ".fabric"));
  const walkResult = walkFiles(target, resolveIgnores(fabricConfig));

  return {
    target,
    framework,
    readmeQuality,
    hasContributing,
    fileCount: walkResult.fileCount,
    ignoredCount: walkResult.ignoredCount,
    hasExistingFabric,
    recommendations: buildRecommendations({
      framework,
      readmeQuality,
      hasContributing,
      hasExistingFabric,
    }),
  };
}

// ---------------------------------------------------------------------------
// v2.0 rc.1 init-scan: deterministic baseline knowledge entries
//
// `fab scan` reads the forensic.json snapshot produced by `fabric init`
// (TASK-008) and emits 4-7 markdown knowledge entries under
// `.fabric/knowledge/{models,guidelines,processes}/`. Each entry has v2.0
// frontmatter (id KP-/KT-, type, layer, maturity, layer_reason, created_at)
// and uses MISSION_STATEMENT / CONTEXT_INFO sections (plus type-specific
// sections per rule-sections.ts contract).
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

// v2.0 (grill-followup TASK-008): bilingual init-scan templates. Resolved at
// scan start from `fabric.config.json#knowledge_language`. `'match-existing'`
// is resolved against the repo's README / docs prose; an empty repo defaults
// to `'en'`. Only en + zh-CN are supported (Q3 scope decision).
type ResolvedLanguage = "en" | "zh-CN";
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
  options: { now?: Date; source?: "init" | "scan" | "doctor_fix" } = {},
): Promise<InitScanResult> {
  const startTs = Date.now();
  const target = normalizeTarget(targetInput);
  const forensicPath = join(target, FORENSIC_FILE);

  if (!existsSync(forensicPath)) {
    throw new Error(t("cli.scan.error.missing-forensic", { path: forensicPath }));
  }

  const forensic = await readForensic(forensicPath);
  const nowIso = (options.now ?? new Date()).toISOString();
  const tags = deriveTagsFromForensic(forensic);

  // v2.0 grill-followup TASK-008: read knowledge_language once at scan start
  // and dispatch every baseline emission through the resolved language. CI
  // config + project brief stay EN-only for now (out of the 5 explicit slugs
  // covered by Q3); they are non-baseline / optional entries.
  const fabricConfig = readFabricConfig(target);
  const knowledgeLanguage = fabricConfig.knowledge_language ?? "match-existing";
  const resolvedLanguage = resolveKnowledgeLanguage(knowledgeLanguage, target);

  // Build candidate entries (some may be null when source data is missing).
  const candidates: Array<MarkdownEntry | null> = [
    buildTechStackEntry(forensic, nowIso, tags, resolvedLanguage),
    buildModuleStructureEntry(forensic, nowIso, tags, resolvedLanguage),
    buildBuildConfigEntry(forensic, nowIso, tags, resolvedLanguage),
    buildCodeStyleEntry(forensic, nowIso, tags, resolvedLanguage),
    buildCIConfigEntry(forensic, nowIso, tags),
    buildReadmeFirstParaEntry(target, forensic, nowIso, tags, resolvedLanguage),
    buildProjectBriefEntry(target, forensic, nowIso, tags),
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
    const targetPath = join(target, KNOWLEDGE_DIR, entry.target_subdir, `${entry.slug}.md`);
    const existingId = findExistingIdForFile(sidecar, targetPath, target);
    const id = existingId ?? (await allocator.allocate(entry.layer, entry.type));
    const built: BuiltEntry = { ...entry, id };
    placedEntries.push(built);

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

  // Refresh agents.meta.json. writeRuleMeta walks `.fabric/knowledge/`, so
  // knowledge entries are picked up automatically and keyed by their
  // declared KP-/KT-... id. We still call registerKnowledgeNodesInMeta to
  // persist a deterministic node shape (cross-cutting topology, scope_glob
  // '**') for entries init-scan just placed.
  //
  // v2.0 follow-up (rc.1 fix #2): order is REGISTER → WRITE. Previously the
  // calls ran WRITE → REGISTER, which left agents.meta.json with a revision
  // hash computed by registerKnowledgeNodesInMeta's (different) algorithm.
  // Doctor's recomputation via buildRuleMeta uses computeRevision() and
  // therefore always disagreed, surfacing as agents_meta_stale post-init.
  // Reversing the order lets writeRuleMeta own the canonical revision write
  // while still preserving the patched node shape via spread-merge in
  // computeRulesBasedAgentsMeta (existing nodes override defaults).
  await registerKnowledgeNodesInMeta(target, placedEntries);
  await writeRuleMeta(target, { source: "doctor_fix" });

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
// citty command
// ---------------------------------------------------------------------------

export const scanCommand = defineCommand({
  meta: {
    name: "scan",
    description: t("cli.scan.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.scan.args.target.description"),
    },
    debug: {
      type: "boolean",
      description: t("cli.scan.args.debug.description"),
      default: false,
    },
    json: {
      type: "boolean",
      description: t("cli.scan.args.json.description"),
      default: false,
    },
  },
  async run({ args }: { args: ScanArgs }) {
    const workspaceRoot = process.cwd();
    const logger = createDebugLogger(args.debug);
    const resolution = resolveDevMode(args.target, workspaceRoot);

    logger(`scan target source: ${resolution.source}`);
    for (const step of resolution.chain) {
      logger(step);
    }

    try {
      const result = await runInitScan(resolution.target, { source: "scan" });

      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printPrettyResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Exit code 1 with a clean message for missing forensic.json (or any
      // other deterministic precondition failure).
      console.error(`${symbol.warn} ${paint.warn(message)}`);
      process.exitCode = 1;
    }
  },
});

export default scanCommand;

// ---------------------------------------------------------------------------
// Bilingual baseline templates (TASK-008)
//
// Each of the 5 baseline slugs has parallel EN + zh-CN bodies. Section
// headings (e.g. `[MISSION_STATEMENT]`, `[CONTEXT_INFO]`) and inline tech
// terms (Node.js, TypeScript, pnpm, framework names, etc.) are preserved
// verbatim in both languages — only narrative prose is localized. This keeps
// the rule-sections contract uniform across languages and lets downstream
// review skills tag-filter without language-specific regex.
//
// Resolution order at scan time:
//   1. `fabric.config.json#knowledge_language` is read once.
//   2. `'en'` / `'zh-CN'` lock the templates regardless of repo content.
//   3. `'match-existing'` (default) calls `detectExistingLanguage(target)`,
//      which scans the repo's README.md (top-level) and docs/ prose for
//      zh-CN characters (Unicode U+4E00..U+9FFF). When zh-CN ratio > 30%
//      of letter-equivalents the result is `'zh-CN'`; otherwise (including
//      empty repo with no README and no docs/) the result is `'en'`.
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

const BASELINE_TEMPLATES: Record<ResolvedLanguage, BaselineTemplateRegistry> = {
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

function resolveTemplateTitle<I>(template: BaselineTemplate<I>, inputs: I): string {
  return typeof template.title === "function" ? template.title(inputs) : template.title;
}

/**
 * Resolve the configured `knowledge_language` value to a concrete `'en'` or
 * `'zh-CN'`. Pure dispatch for explicit values; delegates to
 * `detectExistingLanguage` for `'match-existing'`.
 */
function resolveKnowledgeLanguage(
  configured: "match-existing" | "en" | "zh-CN",
  target: string,
): ResolvedLanguage {
  if (configured === "en" || configured === "zh-CN") {
    return configured;
  }
  return detectExistingLanguage(target);
}

/**
 * Heuristic language detection used when `knowledge_language` is set to
 * `'match-existing'` (the default).
 *
 * Reads README.md (top-level) and the `docs/` directory (one level deep) and
 * counts characters in the CJK Unified Ideographs range U+4E00..U+9FFF
 * (zh-CN, ja, ko share this block; we treat any CJK-heavy prose as zh-CN
 * for v2.0 since Q3 scope explicitly limits us to en + zh-CN).
 *
 * Returns `'zh-CN'` when CJK characters account for more than 30 % of the
 * combined CJK + ASCII letter count; otherwise returns `'en'`. An empty
 * repo (no README, no docs/) defaults to `'en'`. The 30 % threshold is
 * deliberately liberal so a short bilingual README with a sizeable zh-CN
 * section still resolves to zh-CN; pure-EN docs sit well below it.
 */
function detectExistingLanguage(target: string): ResolvedLanguage {
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
  return ratio > ZH_CN_RATIO_THRESHOLD ? "zh-CN" : "en";
}

// ---------------------------------------------------------------------------
// Builder helpers — each takes the parsed forensic data + ISO timestamp and
// returns a MarkdownEntry (or null when source data is absent).
//
// Section conventions (rule-sections.ts SECTION_NAMES contract):
//   - Always include MISSION_STATEMENT + CONTEXT_INFO
//   - Add MANDATORY_INJECTION when type === 'guideline'
//   - Add BUSINESS_LOGIC_CHUNKS when type === 'process'
//
// TASK-008: the 5 baseline builders dispatch through `BASELINE_TEMPLATES`
// using the resolved knowledge_language. Section headings + tech terms are
// preserved verbatim across languages; only narrative prose is localized.
// ---------------------------------------------------------------------------

function buildTechStackEntry(
  forensic: ForensicReport,
  nowIso: string,
  tags: string[],
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
    tags,
  };
}

function buildModuleStructureEntry(
  forensic: ForensicReport,
  nowIso: string,
  tags: string[],
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
    tags,
  };
}

function buildBuildConfigEntry(
  forensic: ForensicReport,
  nowIso: string,
  tags: string[],
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
    tags,
  };
}

function buildCodeStyleEntry(
  forensic: ForensicReport,
  nowIso: string,
  tags: string[],
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
    tags,
  };
}

function buildCIConfigEntry(forensic: ForensicReport, nowIso: string, tags: string[]): MarkdownEntry | null {
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
    tags,
  };
}

function buildReadmeFirstParaEntry(
  target: string,
  forensic: ForensicReport,
  nowIso: string,
  tags: string[],
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
    tags,
  };
}

function buildProjectBriefEntry(
  target: string,
  forensic: ForensicReport,
  nowIso: string,
  tags: string[],
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
    tags,
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
  const lines = [
    "---",
    `id: ${entry.id}`,
    `type: ${entry.type}`,
    `layer: ${entry.layer}`,
    `maturity: ${entry.maturity}`,
    `layer_reason: ${quoteIfNeeded(entry.layer_reason)}`,
    `created_at: ${entry.created_at}`,
    tagsLine,
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

/**
 * Derive up to 5 tag keywords from a forensic report.
 *
 * Priority: framework.kind first, then top file-extension languages derived
 * from by_ext (strip dot, skip 'json'/'md'/'lock'). Tags are lowercased and
 * deduplicated. Used to populate the `tags` frontmatter field on init-scan
 * baseline entries so the rc.3 review skill can filter by tech stack.
 */
export function deriveTagsFromForensic(forensic: ForensicReport): string[] {
  const MAX_TAGS = 5;
  const seen = new Set<string>();
  const tags: string[] = [];

  function add(raw: string): void {
    const normalized = raw.toLowerCase().trim().replace(/\s+/gu, "-");
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      tags.push(normalized);
    }
  }

  // Framework kind takes highest priority (e.g. 'vite', 'next', 'node').
  if (forensic.framework.kind) {
    add(forensic.framework.kind);
  }

  // Map file extensions to language/tool names; skip noise extensions.
  const SKIP_EXTS = new Set([".json", ".md", ".lock", ".yaml", ".yml", ".txt", ".env"]);
  const EXT_MAP: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
  };

  const byExt = forensic.topology.by_ext ?? {};
  const sorted = Object.entries(byExt)
    .filter(([ext]) => !SKIP_EXTS.has(ext))
    .sort(([, a], [, b]) => b - a);

  for (const [ext] of sorted) {
    if (tags.length >= MAX_TAGS) break;
    const mapped = EXT_MAP[ext] ?? ext.replace(/^\./u, "");
    add(mapped);
  }

  return tags.slice(0, MAX_TAGS);
}

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
 * If the sidecar contains a key whose entry was previously written for the
 * given target file path (matched by file existence), return that id so we do
 * NOT allocate a fresh counter on re-run for an unchanged-but-renamed slot.
 *
 * For the deterministic builders the slug is stable, so the file path stays
 * the same; the simpler "look for any sidecar entry whose path matches" logic
 * suffices and avoids burning counter slots when content drifts.
 */
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
    const contentRef = `${KNOWLEDGE_DIR}/${entry.target_subdir}/${entry.slug}.md`;
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
  // revision is owned by writeRuleMeta() / computeRevision() in the
  // rule-meta-builder module — its algorithm is the one doctor recomputes
  // for staleness detection. Earlier this function wrote
  // `sha256(JSON.stringify(nodes))`, which used a different keying and
  // therefore always disagreed with doctor's recomputation. The single
  // owner of the revision field is now writeRuleMeta(), invoked AFTER this
  // function in runInitScan. We deliberately leave any pre-existing
  // revision in place (or drop it on first write); writeRuleMeta will
  // overwrite it with the canonical value.

  await ensureParentDirectory(metaPath);
  await atomicWriteJson(metaPath, meta);
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function printPrettyResult(result: InitScanResult): void {
  const writtenCount = result.written_stable_ids.length;
  const skippedCount = result.skipped_stable_ids.length;

  if (writtenCount === 0) {
    console.log(`${symbol.ok} ${paint.success(t("cli.scan.summary.skipped", { count: String(skippedCount) }))}`);
    return;
  }

  console.log(`${symbol.ok} ${paint.success(t("cli.scan.summary.created", { count: String(writtenCount) }))}`);
  for (const id of result.written_stable_ids) {
    console.log(`  - ${paint.ai(id)}`);
  }
  if (skippedCount > 0) {
    console.log(paint.muted(`(${skippedCount} unchanged, skipped)`));
  }
}

// ---------------------------------------------------------------------------
// Legacy walk/recommendation helpers — supporting createScanReport()
// ---------------------------------------------------------------------------

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function getReadmeQuality(target: string): ReadmeQuality {
  const readmePath = join(target, "README.md");
  if (!existsSync(readmePath)) {
    return "stub";
  }

  const wordCount = readFileSync(readmePath, "utf8").trim().split(/\s+/).filter(Boolean).length;

  return wordCount >= 200 ? "ok" : "stub";
}

function walkFiles(root: string, ignorePatterns: string[]): WalkResult {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(t("cli.shared.target-invalid", { target: root }));
  }

  let fileCount = 0;
  let ignoredCount = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = toPosixPath(relative(root, absolutePath));

      if (shouldIgnore(relativePath, entry.isDirectory(), ignorePatterns)) {
        ignoredCount += 1;
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile()) {
        fileCount += 1;
      }
    }
  }

  return { fileCount, ignoredCount };
}

function shouldIgnore(relativePath: string, isDirectory: boolean, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => matchesIgnorePattern(relativePath, isDirectory, pattern));
}

function matchesIgnorePattern(relativePath: string, isDirectory: boolean, pattern: string): boolean {
  const normalizedPattern = toPosixPath(pattern);

  if (normalizedPattern === "**/*.meta") {
    return relativePath.endsWith(".meta");
  }

  if (normalizedPattern.endsWith("/**")) {
    const directoryPrefix = normalizedPattern.slice(0, -3);
    return (
      relativePath === directoryPrefix ||
      relativePath.startsWith(`${directoryPrefix}/`) ||
      (isDirectory && `${relativePath}/` === directoryPrefix)
    );
  }

  return relativePath === normalizedPattern;
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function buildRecommendations(input: {
  framework: FrameworkInfo;
  readmeQuality: ReadmeQuality;
  hasContributing: boolean;
  hasExistingFabric: boolean;
}): string[] {
  const recommendations: string[] = [];

  if (!input.hasExistingFabric) {
    recommendations.push(t("cli.scan.recommendation.init"));
  }

  if (input.readmeQuality === "stub") {
    recommendations.push(t("cli.scan.recommendation.readme"));
  }

  if (!input.hasContributing) {
    recommendations.push(t("cli.scan.recommendation.contributing"));
  }

  if (input.framework.kind === "unknown") {
    recommendations.push(t("cli.scan.recommendation.unknown-framework"));
  } else {
    recommendations.push(t("cli.scan.recommendation.framework-dirs", { framework: input.framework.kind }));
  }

  return recommendations;
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
  extractFirstParagraph,
  extractExplicitDescription,
  // TASK-008: bilingual template registry + language detection
  detectExistingLanguage,
  resolveKnowledgeLanguage,
  BASELINE_TEMPLATES,
};
