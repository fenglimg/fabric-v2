import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import {
  forensicReportSchema,
  type CandidateFileEntry,
  type ForensicAssertion,
  type ForensicEntryPoint,
  type ForensicEvidenceAnchor,
  type ForensicReport,
} from "@fenglimg/fabric-shared";

import { detectFramework } from "./detector.js";

declare const __CLI_VERSION__: string | undefined;

type PackageJson = {
  name?: string;
};

export type FileInfo = {
  relativePath: string;
  sizeBytes: number;
};

export type TopologyResult = {
  total_files: number;
  by_ext: Record<string, number>;
  key_dirs: string[];
  max_depth: number;
  files: FileInfo[];
};

type ReadmeInfo = ForensicReport["readme"];

export type PatternHintResult = {
  pattern: string;
  type: ForensicAssertion["type"];
  confidence: ForensicAssertion["confidence"];
  evidence_lines: string[];
  co_occurring: string[];
  family: CandidateFileEntry["family"];
  ast_level: boolean;
  statement: string;
  proposed_rule?: string;
  alternatives?: string[];
  rationale: string;
};

export type CodeSampleResult = ForensicReport["code_samples"][number] & {
  pattern_analysis: PatternHintResult;
  evidence: ForensicEvidenceAnchor[];
};

const IGNORED_DIRECTORIES = new Set([
  ".fabric",
  ".git",
  ".next",
  ".turbo",
  "Library",
  "Temp",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const KEY_DIRECTORY_NAMES = new Set([
  "app",
  "components",
  "pages",
  "prefabs",
  "scenes",
  "scripts",
  "src",
]);

const SCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const DOMAIN_FILE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".md"]);
const EXPECTED_CONFIG_FILES_BY_FRAMEWORK: Record<string, string[]> = {
  "cocos-creator": ["package.json", "project.config.json", "tsconfig.json"],
  next: ["package.json", "tsconfig.json"],
  vite: ["package.json", "tsconfig.json"],
};
const SAMPLE_LIMIT = 5;
const SAMPLE_LINE_LIMIT = 30;
const ENTRY_FAMILY_LIMIT = 1;
const FAMILY_LIMIT = 3;
const CANDIDATE_FILE_LIMIT = 12;
const DEFAULT_SAMPLING_BUDGET: ForensicReport["sampling_budget"] = {
  max_files: 15,
  max_lines_per_file: 100,
};

export function buildForensicReport(targetInput: string): ForensicReport {
  const target = normalizeTarget(targetInput);
  const framework = detectFramework(target);
  const topology = buildTopology(target);
  const entryPoints = collectEntryPoints(topology.files);
  const codeSamples = buildCodeSamples(target, entryPoints);
  const assertions = buildAssertions(framework.kind, topology, codeSamples);
  const candidateFiles = buildCandidateFiles(topology, codeSamples, entryPoints);
  const readme = readReadmeInfo(target);
  const report: ForensicReport = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    generated_by: `fab-cli@${getCliVersion()}`,
    target,
    project_name: readProjectName(target),
    framework,
    topology: {
      total_files: topology.total_files,
      by_ext: topology.by_ext,
      key_dirs: topology.key_dirs,
      max_depth: topology.max_depth,
    },
    entry_points: entryPoints,
    code_samples: codeSamples.map(({ pattern_analysis: _patternAnalysis, evidence: _evidence, ...sample }) => sample),
    assertions,
    candidate_files: candidateFiles,
    sampling_budget: DEFAULT_SAMPLING_BUDGET,
    readme,
    recommendations_for_skill: buildSkillRecommendations(framework.kind, topology, readme),
  };

  const validation = forensicReportSchema.safeParse(report);
  if (!validation.success) {
    throw new Error(`ForensicReport schema validation failed: ${validation.error.message}`);
  }

  return validation.data;
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function buildTopology(root: string): TopologyResult {
  assertExistingDirectory(root);

  const byExt: Record<string, number> = {};
  const keyDirs = new Set<string>();
  const files: FileInfo[] = [];
  let totalFiles = 0;
  let maxDepth = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = toPosixPath(relative(root, absolutePath));

      if (relativePath.length === 0) {
        continue;
      }

      const depth = relativePath.split("/").length;
      maxDepth = Math.max(maxDepth, depth);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        if (isKeyDirectory(relativePath)) {
          keyDirs.add(relativePath);
        }

        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = statSync(absolutePath);
      const extension = extname(entry.name) || "[none]";
      byExt[extension] = (byExt[extension] ?? 0) + 1;
      totalFiles += 1;
      files.push({
        relativePath,
        sizeBytes: stats.size,
      });
    }
  }

  return {
    total_files: totalFiles,
    by_ext: sortRecord(byExt),
    key_dirs: [...keyDirs].sort(),
    max_depth: maxDepth,
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Target must be an existing directory: ${target}`);
  }
}

function isKeyDirectory(relativePath: string): boolean {
  const name = basename(relativePath);
  return KEY_DIRECTORY_NAMES.has(name);
}

function collectEntryPoints(files: FileInfo[]): ForensicEntryPoint[] {
  const entryPoints: ForensicEntryPoint[] = [];

  for (const file of files) {
    const reason = getEntryPointReason(file.relativePath);
    if (reason === null) {
      continue;
    }

    entryPoints.push({
      path: file.relativePath,
      reason,
      size_bytes: file.sizeBytes,
    });
  }

  return entryPoints;
}

function getEntryPointReason(relativePath: string): string | null {
  if (!SCRIPT_EXTENSIONS.has(extname(relativePath))) {
    return null;
  }

  const directory = posix.dirname(relativePath);
  const fileName = basename(relativePath);
  const fileBase = basename(relativePath, extname(relativePath));

  if (directory === "assets/scripts" || directory === "scripts") {
    return "top-level script";
  }

  if (directory === "src" && /^(App|app|index|main)$/.test(fileBase)) {
    return "application entry";
  }

  if ((directory === "app" || directory.startsWith("app/")) && /^(layout|page|route)$/.test(fileBase)) {
    return "next app route";
  }

  if ((directory === "pages" || directory.startsWith("pages/")) && fileName !== "_app.d.ts") {
    return "next page route";
  }

  return null;
}

function buildCodeSamples(target: string, entryPoints: ForensicEntryPoint[]): CodeSampleResult[] {
  return entryPoints.slice(0, SAMPLE_LIMIT).map((entryPoint) => {
    const absolutePath = join(target, ...entryPoint.path.split("/"));
    const sample = readFirstLines(absolutePath, SAMPLE_LINE_LIMIT);
    const patternAnalysis = inferPatternHint(entryPoint.path, sample.snippet);

    return {
      path: entryPoint.path,
      lines: `1-${sample.lineCount}`,
      snippet: sample.snippet,
      pattern_hint: patternAnalysis.pattern,
      pattern_analysis: patternAnalysis,
      evidence: buildEvidenceAnchors(entryPoint.path, sample.snippet, patternAnalysis.evidence_lines),
    };
  });
}

function readFirstLines(path: string, lineLimit: number): { snippet: string; lineCount: number } {
  try {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    if (lines.at(-1) === "") {
      lines.pop();
    }

    const sampledLines = lines.slice(0, lineLimit);
    return {
      snippet: sampledLines.join("\n"),
      lineCount: sampledLines.length,
    };
  } catch {
    return {
      snippet: "",
      lineCount: 0,
    };
  }
}

function inferPatternHint(relativePath: string, snippet: string): PatternHintResult {
  const cocosCoOccurring = compactPatternNames([
    snippet.includes('from "cc"') || snippet.includes("from 'cc'") ? "cc-import" : null,
    snippet.includes("@ccclass(") || snippet.includes("ccclass(") ? "ccclass-decorator" : null,
    snippet.includes("extends Component") ? "component-base" : null,
    snippet.includes("const { ccclass } = _decorator") ? "decorator-destructure" : null,
  ]);

  if (cocosCoOccurring.length > 0) {
    const astLevel = snippet.includes("@ccclass(");
    return {
      pattern: "cocos-component-class",
      type: "pattern",
      confidence: determineConfidence(1, cocosCoOccurring, astLevel),
      evidence_lines: compactPatternNames([
        snippet.includes("_decorator") ? "_decorator" : null,
        snippet.includes("@ccclass(") ? "@ccclass(" : null,
        snippet.includes("extends Component") ? "extends Component" : null,
      ]),
      co_occurring: cocosCoOccurring,
      family: "component",
      ast_level: astLevel,
      statement: "Sampled entry files use Cocos Creator component classes.",
      proposed_rule: "Treat assets/scripts/*.ts and adjacent .meta files as framework-owned structure unless the user says otherwise.",
      alternatives: ["Generic TypeScript utility module"],
      rationale: "Cocos-specific decorators and Component inheritance co-occur in sampled entry files.",
    };
  }

  const reactCoOccurring = compactPatternNames([
    snippet.includes("createRoot(") ? "create-root" : null,
    snippet.includes("ReactDOM.render(") ? "react-dom-render" : null,
    snippet.includes('from "react-dom"') || snippet.includes("from 'react-dom'") ? "react-dom-import" : null,
  ]);

  if (reactCoOccurring.length > 0) {
    return {
      pattern: "react-root",
      type: "pattern",
      confidence: determineConfidence(1, reactCoOccurring, false),
      evidence_lines: compactPatternNames([
        snippet.includes("createRoot(") ? "createRoot(" : null,
        snippet.includes("ReactDOM.render(") ? "ReactDOM.render(" : null,
      ]),
      co_occurring: reactCoOccurring,
      family: "entry",
      ast_level: false,
      statement: "Sampled entry files bootstrap a React DOM root.",
      proposed_rule: "Keep root rendering logic in the main application entry file.",
      alternatives: ["Server-rendered route module"],
      rationale: "React DOM root markers identify a frontend entrypoint.",
    };
  }

  if (relativePath.startsWith("app/") || relativePath.startsWith("pages/")) {
    const coOccurring = compactPatternNames([
      relativePath.startsWith("app/") ? "app-router" : null,
      relativePath.startsWith("pages/") ? "pages-router" : null,
      snippet.includes("export default") ? "default-export-route" : null,
    ]);

    return {
      pattern: "next-route-component",
      type: "pattern",
      confidence: determineConfidence(1, coOccurring, false),
      evidence_lines: compactPatternNames([
        relativePath.startsWith("app/") ? "app/" : null,
        relativePath.startsWith("pages/") ? "pages/" : null,
      ]),
      co_occurring: coOccurring,
      family: "entry",
      ast_level: false,
      statement: "Sampled entry files align with Next.js route modules.",
      proposed_rule: "Preserve route-segment boundaries when editing app/ or pages/ files.",
      alternatives: ["Generic source module"],
      rationale: "Route directory placement anchors these files to the Next.js request surface.",
    };
  }

  if (relativePath === "src/main.ts" || relativePath === "src/main.js") {
    const coOccurring = compactPatternNames([
      "main-entry",
      snippet.includes("import.meta") ? "import-meta" : null,
      snippet.includes("createRoot(") ? "react-root" : null,
    ]);

    return {
      pattern: "vite-main-entry",
      type: "pattern",
      confidence: determineConfidence(1, coOccurring, false),
      evidence_lines: ["src/main"],
      co_occurring: coOccurring,
      family: "entry",
      ast_level: false,
      statement: "Sampled entry files use the conventional Vite main entrypoint.",
      proposed_rule: "Keep primary bootstrapping logic inside src/main.*.",
      alternatives: ["Alternative bundler entrypoint"],
      rationale: "src/main.* is the expected Vite bootstrap path.",
    };
  }

  return {
    pattern: "source-entry",
    type: "pattern",
    confidence: "LOW",
    evidence_lines: [basename(relativePath)],
    co_occurring: [],
    family: "domain",
    ast_level: false,
    statement: "Sampled entry file appears to be a generic source entry.",
    alternatives: ["Framework-specific entrypoint"],
    rationale: "No strong framework markers were detected in the sampled snippet.",
  };
}

function readReadmeInfo(target: string): ReadmeInfo {
  const readmePath = join(target, "README.md");
  const hasContributing = existsSync(join(target, "CONTRIBUTING.md"));

  if (!existsSync(readmePath)) {
    return {
      quality: "missing",
      line_count: 0,
      has_contributing: hasContributing,
    };
  }

  const readme = readFileSync(readmePath, "utf8");
  const wordCount = readme
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return {
    quality: wordCount >= 200 ? "ok" : "stub",
    line_count: readme.length === 0 ? 0 : readme.split(/\r?\n/).length,
    has_contributing: hasContributing,
  };
}

export function buildAssertions(
  frameworkKind: ForensicReport["framework"]["kind"],
  topology: TopologyResult,
  codeSamples: CodeSampleResult[],
): ForensicAssertion[] {
  const assertions = [
    buildFrameworkAssertion(frameworkKind, topology, codeSamples),
    buildDominantPatternAssertion(codeSamples),
    buildEntryDirectoryAssertion(frameworkKind, codeSamples),
    buildMetaSidecarAssertion(frameworkKind, topology),
    buildConfigAssertion(frameworkKind, topology),
    buildDomainAssertion(codeSamples),
  ];

  return assertions.filter((assertion): assertion is ForensicAssertion => assertion !== null);
}

export function buildCandidateFiles(
  topology: TopologyResult,
  codeSamples: CodeSampleResult[],
  entryPoints: ForensicEntryPoint[],
): CandidateFileEntry[] {
  const selected = new Map<string, CandidateFileEntry>();
  const codeSamplesByPath = new Map(codeSamples.map((sample) => [sample.path, sample]));
  const configFiles = topology.files.filter((file) => isConfigFile(file.relativePath));
  const testFiles = topology.files.filter((file) => isTestFile(file.relativePath));
  const domainFiles = topology.files.filter((file) => isDomainFile(file.relativePath));
  const componentSamples = codeSamples
    .filter((sample) => sample.pattern_analysis.family === "component")
    .sort((left, right) => compareCandidateScore(buildComponentCandidateScore(right), buildComponentCandidateScore(left)));

  addCandidateFamily(
    selected,
    entryPoints
      .map((entryPoint) => ({
        path: entryPoint.path,
        family: "entry" as const,
        rationale: `Representative ${entryPoint.reason} used as an application entry surface.`,
        score: buildEntryCandidateScore(entryPoint),
      }))
      .sort((left, right) => compareCandidateScore(right.score, left.score)),
    ENTRY_FAMILY_LIMIT,
  );

  addCandidateFamily(
    selected,
    componentSamples.map((sample) => ({
      path: sample.path,
      family: "component" as const,
      rationale: sample.pattern_analysis.rationale,
      score: buildComponentCandidateScore(sample),
    })),
    FAMILY_LIMIT,
  );

  addCandidateFamily(
    selected,
    configFiles
      .map((file) => ({
        path: file.relativePath,
        family: "config" as const,
        rationale: "Bootstrap or compiler configuration file used to infer framework and project boundaries.",
        score: buildConfigCandidateScore(file.relativePath),
      }))
      .sort((left, right) => compareCandidateScore(right.score, left.score)),
    FAMILY_LIMIT,
  );

  addCandidateFamily(
    selected,
    testFiles
      .map((file) => ({
        path: file.relativePath,
        family: "test" as const,
        rationale: "Existing test coverage surface that captures behavior expectations.",
        score: file.relativePath.includes("__tests__") ? 2 : 1,
      }))
      .sort((left, right) => compareCandidateScore(right.score, left.score)),
    FAMILY_LIMIT,
  );

  addCandidateFamily(
    selected,
    domainFiles
      .filter((file) => !codeSamplesByPath.has(file.relativePath))
      .map((file) => ({
        path: file.relativePath,
        family: "domain" as const,
        rationale: "Representative domain file outside entry/config/test hotspots.",
        score: buildDomainCandidateScore(file.relativePath),
      }))
      .sort((left, right) => compareCandidateScore(right.score, left.score)),
    FAMILY_LIMIT,
  );

  return [...selected.values()].slice(0, CANDIDATE_FILE_LIMIT);
}

function buildFrameworkAssertion(
  frameworkKind: ForensicReport["framework"]["kind"],
  topology: TopologyResult,
  codeSamples: CodeSampleResult[],
): ForensicAssertion | null {
  if (frameworkKind === "unknown") {
    return createAssertion({
      type: "framework",
      statement: "Framework could not be determined from the sampled topology.",
      evidence: codeSamples.flatMap((sample) => sample.evidence).slice(0, 3),
      matched: 0,
      total: codeSamples.length,
      coOccurring: [],
      alternatives: ["Ask the user to confirm the primary framework"],
    });
  }

  const matchedSamples = codeSamples.filter((sample) => matchesFrameworkPattern(frameworkKind, sample.pattern_analysis.pattern));
  const coOccurring = compactPatternNames([
    ...matchedSamples.flatMap((sample) => sample.pattern_analysis.co_occurring),
    hasFile(topology.files, "project.config.json") ? "project-config-json" : null,
    (topology.by_ext[".meta"] ?? 0) > 0 ? "meta-sidecars" : null,
    hasFile(topology.files, "package.json") ? "package-json" : null,
  ]);
  const evidence = [
    ...matchedSamples.flatMap((sample) => sample.evidence),
    ...buildTopologyEvidence(topology, getExpectedConfigFiles(frameworkKind)),
  ].slice(0, 3);

  return createAssertion({
    type: "framework",
    statement: buildFrameworkStatement(frameworkKind),
    evidence,
    matched: matchedSamples.length,
    total: codeSamples.length,
    coOccurring,
    astLevel: matchedSamples.some((sample) => sample.pattern_analysis.ast_level),
    proposedRule: buildFrameworkRule(frameworkKind),
    alternatives: frameworkKind === "cocos-creator" ? ["Generic TypeScript utility modules"] : ["Alternative framework entry layout"],
  });
}

function buildDominantPatternAssertion(codeSamples: CodeSampleResult[]): ForensicAssertion | null {
  if (codeSamples.length === 0) {
    return null;
  }

  const counts = new Map<string, CodeSampleResult[]>();
  for (const sample of codeSamples) {
    const existing = counts.get(sample.pattern_analysis.pattern) ?? [];
    existing.push(sample);
    counts.set(sample.pattern_analysis.pattern, existing);
  }

  const dominant = [...counts.entries()].sort((left, right) => right[1].length - left[1].length)[0];
  if (dominant === undefined) {
    return null;
  }

  const [, samples] = dominant;
  const first = samples[0];

  return createAssertion({
    type: first.pattern_analysis.type,
    statement: first.pattern_analysis.statement,
    evidence: samples.flatMap((sample) => sample.evidence).slice(0, 3),
    matched: samples.length,
    total: codeSamples.length,
    coOccurring: compactPatternNames(samples.flatMap((sample) => sample.pattern_analysis.co_occurring)),
    astLevel: samples.some((sample) => sample.pattern_analysis.ast_level),
    proposedRule: first.pattern_analysis.proposed_rule,
    alternatives: first.pattern_analysis.alternatives,
  });
}

function buildEntryDirectoryAssertion(
  frameworkKind: ForensicReport["framework"]["kind"],
  codeSamples: CodeSampleResult[],
): ForensicAssertion | null {
  if (codeSamples.length === 0) {
    return null;
  }

  const directoryGroups = new Map<string, CodeSampleResult[]>();
  for (const sample of codeSamples) {
    const directory = posix.dirname(sample.path);
    const existing = directoryGroups.get(directory) ?? [];
    existing.push(sample);
    directoryGroups.set(directory, existing);
  }

  const primaryDirectory = [...directoryGroups.entries()].sort((left, right) => right[1].length - left[1].length)[0];
  if (primaryDirectory === undefined) {
    return null;
  }

  const [directory, samples] = primaryDirectory;

  return createAssertion({
    type: "pattern",
    statement: `Entry samples are concentrated in ${directory}, indicating a stable primary source boundary.`,
    evidence: samples.flatMap((sample) => sample.evidence).slice(0, 3),
    matched: samples.length,
    total: codeSamples.length,
    coOccurring: compactPatternNames([
      directory === "." ? "root-entry" : directory,
      frameworkKind !== "unknown" ? frameworkKind : null,
      ...samples.flatMap((sample) => sample.pattern_analysis.co_occurring.slice(0, 1)),
    ]),
    proposedRule: directory === "." ? "Keep primary entry files at the repository root only if the framework expects it." : `Treat ${directory} as the main execution boundary during initialization.`,
  });
}

function buildMetaSidecarAssertion(
  frameworkKind: ForensicReport["framework"]["kind"],
  topology: TopologyResult,
): ForensicAssertion | null {
  const relevantScripts = topology.files.filter((file) => SCRIPT_EXTENSIONS.has(extname(file.relativePath)));
  if (relevantScripts.length === 0) {
    return null;
  }

  const matchedScripts = relevantScripts.filter((file) => hasFile(topology.files, `${file.relativePath}.meta`));
  if (matchedScripts.length === 0 && frameworkKind !== "cocos-creator") {
    return null;
  }

  return createAssertion({
    type: "invariant",
    statement: matchedScripts.length > 0
      ? "Script files have adjacent .meta sidecars, which should be treated as coupled assets."
      : "No .meta sidecars were detected for sampled scripts.",
    evidence: matchedScripts.length > 0
      ? matchedScripts.slice(0, 3).map((file) => makeSyntheticEvidence(`${file.relativePath}.meta`, `${file.relativePath}.meta sidecar present`))
      : buildTopologyEvidence(topology, relevantScripts.slice(0, 1).map((file) => file.relativePath)),
    matched: matchedScripts.length,
    total: relevantScripts.length,
    coOccurring: compactPatternNames([
      matchedScripts.length > 0 ? "meta-sidecar" : null,
      frameworkKind === "cocos-creator" ? "cocos-creator" : null,
      relevantScripts.some((file) => file.relativePath.startsWith("assets/scripts/")) ? "assets-scripts" : null,
    ]),
    proposedRule: matchedScripts.length > 0
      ? "Do not edit or delete .meta sidecars without explicit user confirmation."
      : undefined,
  });
}

function buildConfigAssertion(
  frameworkKind: ForensicReport["framework"]["kind"],
  topology: TopologyResult,
): ForensicAssertion | null {
  const expectedFiles = getExpectedConfigFiles(frameworkKind);
  if (expectedFiles.length === 0) {
    return null;
  }

  const matchedFiles = expectedFiles.filter((file) => hasFile(topology.files, file));

  return createAssertion({
    type: "invariant",
    statement: `Project configuration is anchored by ${expectedFiles.join(", ")}.`,
    evidence: buildTopologyEvidence(topology, matchedFiles),
    matched: matchedFiles.length,
    total: expectedFiles.length,
    coOccurring: compactPatternNames(matchedFiles.map(normalizeConfigPattern)),
    proposedRule: "Read bootstrap and compiler config before generating new rules or project structure.",
  });
}

function buildDomainAssertion(codeSamples: CodeSampleResult[]): ForensicAssertion | null {
  if (codeSamples.length === 0) {
    return null;
  }

  const namedSamples = codeSamples.filter((sample) => {
    const fileBase = basename(sample.path, extname(sample.path));
    return sample.snippet.includes(`class ${fileBase}`) || sample.snippet.includes(`class ${sanitizeIdentifier(fileBase)}`);
  });

  if (namedSamples.length === 0) {
    return null;
  }

  const namedModules = compactPatternNames(namedSamples.map((sample) => basename(sample.path, extname(sample.path))));

  return createAssertion({
    type: "domain",
    statement: `Sampled modules are named as concrete domain concepts (${namedModules.join(", ")}).`,
    evidence: namedSamples.flatMap((sample) => sample.evidence).slice(0, 3),
    matched: namedSamples.length,
    total: codeSamples.length,
    coOccurring: compactPatternNames([
      namedSamples.every((sample) => /^[A-Z]/.test(basename(sample.path))) ? "pascal-case-modules" : null,
      namedModules.length >= 2 ? "domain-named-components" : null,
      namedSamples.some((sample) => sample.snippet.includes("start():")) ? "lifecycle-hook" : null,
    ]),
    proposedRule: "Preserve domain-specific module names when mirroring structure into AGENTS.md or .fabric/agents/.",
  });
}

function createAssertion(input: {
  type: ForensicAssertion["type"];
  statement: string;
  evidence: ForensicEvidenceAnchor[];
  matched: number;
  total: number;
  coOccurring: string[];
  astLevel?: boolean;
  proposedRule?: string;
  alternatives?: string[];
}): ForensicAssertion {
  const coverage = {
    ratio: input.total === 0 ? 0 : roundCoverageRatio(input.matched / input.total),
    total: input.total,
    matched: input.matched,
    co_occurring_patterns: compactPatternNames(input.coOccurring),
  };

  return {
    type: input.type,
    statement: input.statement,
    confidence: determineConfidence(coverage.ratio, coverage.co_occurring_patterns, input.astLevel ?? false),
    evidence: dedupeEvidence(input.evidence),
    coverage,
    proposed_rule: input.proposedRule,
    alternatives: input.alternatives,
  };
}

function buildEvidenceAnchors(relativePath: string, snippet: string, evidenceLines: string[]): ForensicEvidenceAnchor[] {
  const lines = snippet.split("\n");
  const anchors: ForensicEvidenceAnchor[] = [];
  const seen = new Set<string>();

  for (const pattern of evidenceLines) {
    const lineIndex = lines.findIndex((line) => line.includes(pattern));
    if (lineIndex === -1) {
      continue;
    }

    const key = `${relativePath}:${lineIndex + 1}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    anchors.push({
      file: relativePath,
      line: String(lineIndex + 1),
      snippet: lines[lineIndex]?.trim() ?? "",
    });
  }

  if (anchors.length > 0) {
    return anchors;
  }

  const fallbackIndex = lines.findIndex((line) => line.trim().length > 0);
  return [
    {
      file: relativePath,
      line: String(fallbackIndex === -1 ? 1 : fallbackIndex + 1),
      snippet: fallbackIndex === -1 ? "" : lines[fallbackIndex]?.trim() ?? "",
    },
  ];
}

function addCandidateFamily(
  selected: Map<string, CandidateFileEntry>,
  candidates: Array<CandidateFileEntry & { score: number }>,
  familyLimit: number,
): void {
  let added = 0;
  for (const candidate of candidates) {
    if (selected.size >= CANDIDATE_FILE_LIMIT || added >= familyLimit || selected.has(candidate.path)) {
      continue;
    }

    selected.set(candidate.path, {
      path: candidate.path,
      family: candidate.family,
      rationale: candidate.rationale,
    });
    added += 1;
  }
}

function buildTopologyEvidence(topology: TopologyResult, preferredPaths: string[]): ForensicEvidenceAnchor[] {
  return preferredPaths
    .filter((path) => hasFile(topology.files, path))
    .slice(0, 3)
    .map((path) => makeSyntheticEvidence(path, `${path} present in project topology`));
}

function makeSyntheticEvidence(file: string, snippet: string): ForensicEvidenceAnchor {
  return {
    file,
    line: "1",
    snippet,
  };
}

function dedupeEvidence(evidence: ForensicEvidenceAnchor[]): ForensicEvidenceAnchor[] {
  const seen = new Set<string>();
  const deduped: ForensicEvidenceAnchor[] = [];

  for (const entry of evidence) {
    const key = `${entry.file}:${entry.line}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped.slice(0, 3);
}

function matchesFrameworkPattern(frameworkKind: string, pattern: string): boolean {
  if (frameworkKind === "cocos-creator") {
    return pattern === "cocos-component-class";
  }

  if (frameworkKind === "next") {
    return pattern === "next-route-component";
  }

  if (frameworkKind === "vite") {
    return pattern === "vite-main-entry" || pattern === "react-root";
  }

  return pattern !== "source-entry";
}

function buildFrameworkStatement(frameworkKind: string): string {
  if (frameworkKind === "cocos-creator") {
    return "Project strongly matches a Cocos Creator TypeScript component layout.";
  }

  if (frameworkKind === "next") {
    return "Project topology and entry samples align with a Next.js route-driven application.";
  }

  if (frameworkKind === "vite") {
    return "Project topology aligns with a Vite-style application bootstrap.";
  }

  return `Project surfaces align with ${frameworkKind}.`;
}

function buildFrameworkRule(frameworkKind: string): string | undefined {
  if (frameworkKind === "cocos-creator") {
    return "Preserve Cocos component decorators, lifecycle methods, and paired .meta files during initialization.";
  }

  if (frameworkKind === "next") {
    return "Respect app/pages route boundaries when generating instructions or edits.";
  }

  if (frameworkKind === "vite") {
    return "Keep bootstrap logic centered on src/main.* and surrounding config files.";
  }

  return undefined;
}

function determineConfidence(
  ratio: number,
  coOccurringPatterns: string[],
  astLevel: boolean,
  hasConflict = false,
): ForensicAssertion["confidence"] {
  if (hasConflict) {
    return "LOW";
  }

  if (astLevel) {
    return "HIGH";
  }

  if (ratio < 0.5) {
    return "LOW";
  }

  if (ratio >= 0.8 && coOccurringPatterns.length >= 2) {
    return "HIGH";
  }

  return "MEDIUM";
}

function compactPatternNames(patterns: Array<string | null | undefined>): string[] {
  return [...new Set(patterns.filter((pattern): pattern is string => pattern !== null && pattern !== undefined && pattern.length > 0))];
}

function roundCoverageRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getExpectedConfigFiles(frameworkKind: string): string[] {
  return EXPECTED_CONFIG_FILES_BY_FRAMEWORK[frameworkKind] ?? ["package.json"];
}

function hasFile(files: FileInfo[], relativePath: string): boolean {
  return files.some((file) => file.relativePath === relativePath);
}

function normalizeConfigPattern(relativePath: string): string {
  return relativePath.replace(/\./g, "-");
}

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_$]/g, "");
}

function compareCandidateScore(left: number, right: number): number {
  return left - right;
}

function buildEntryCandidateScore(entryPoint: ForensicEntryPoint): number {
  let score = 0;
  if (entryPoint.reason === "application entry") {
    score += 3;
  }
  if (entryPoint.reason.includes("route")) {
    score += 2;
  }
  if ((entryPoint.size_bytes ?? 0) > 0) {
    score += 1;
  }
  return score;
}

function buildComponentCandidateScore(sample: CodeSampleResult): number {
  let score = sample.pattern_analysis.co_occurring.length;
  if (sample.pattern_analysis.ast_level) {
    score += 3;
  }
  if (sample.pattern_analysis.confidence === "HIGH") {
    score += 2;
  }
  return score;
}

function buildConfigCandidateScore(relativePath: string): number {
  if (relativePath === "project.config.json") {
    return 4;
  }
  if (relativePath === "package.json") {
    return 3;
  }
  if (relativePath === "tsconfig.json") {
    return 2;
  }
  return 1;
}

function buildDomainCandidateScore(relativePath: string): number {
  let score = 0;
  if (relativePath.startsWith("src/") || relativePath.startsWith("assets/")) {
    score += 2;
  }
  if (SCRIPT_EXTENSIONS.has(extname(relativePath))) {
    score += 1;
  }
  if (relativePath.includes("/domain/") || relativePath.includes("/models/")) {
    score += 1;
  }
  return score;
}

function isConfigFile(relativePath: string): boolean {
  return /(^|\/)(package\.json|project\.config\.json|tsconfig\.json|vite\.config\.[^.]+|next\.config\.[^.]+)$/.test(relativePath);
}

function isTestFile(relativePath: string): boolean {
  return /(^|\/)(__tests__|tests)(\/|$)/.test(relativePath) || /\.(test|spec)\.[^.]+$/.test(relativePath);
}

function isDomainFile(relativePath: string): boolean {
  const extension = extname(relativePath);
  if (!DOMAIN_FILE_EXTENSIONS.has(extension)) {
    return false;
  }

  return !isConfigFile(relativePath) && !isTestFile(relativePath);
}

/**
 * @deprecated Transitional migration helper. Prefer buildAssertions() for structured confidence/evidence output.
 */
function buildSkillRecommendations(
  frameworkKind: ForensicReport["framework"]["kind"],
  topology: TopologyResult,
  readme: ReadmeInfo,
): string[] {
  const recommendations: string[] = [];

  if (frameworkKind === "cocos-creator") {
    recommendations.push("建议向用户确认 Cocos Creator Component 生命周期(onLoad/onEnable/start)顺序。");
    recommendations.push("建议询问 assets/prefabs 和 assets/scenes 是否属于 @HUMAN 保护区域。");

    if ((topology.by_ext[".meta"] ?? 0) > 0) {
      recommendations.push("检测到 .meta 文件,建议在 @HUMAN 锁定 .meta 不被 AI 改动。");
    }
  } else if (frameworkKind === "next") {
    recommendations.push("建议确认 app/pages 路由边界和服务端组件约束。");
  } else if (frameworkKind === "vite") {
    recommendations.push("建议确认 src/main 入口、组件目录和构建脚本的维护边界。");
  } else if (frameworkKind === "unknown") {
    recommendations.push("未检测到明确框架,建议先让用户确认技术栈和主要入口。");
  } else {
    recommendations.push(`建议围绕 ${frameworkKind} 的主要入口和生成目录确认 AGENTS.md 分层边界。`);
  }

  if (readme.quality !== "ok") {
    recommendations.push("README 信息不足,建议在初始化访谈中补齐项目目标、运行方式和禁改区域。");
  }

  return recommendations;
}

function readProjectName(target: string): string {
  const packageJsonPath = join(target, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
      if (packageJson.name !== undefined && packageJson.name.trim().length > 0) {
        return packageJson.name;
      }
    } catch {
      return basename(target);
    }
  }

  return basename(target);
}

function getCliVersion(): string {
  return typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "unknown";
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}
