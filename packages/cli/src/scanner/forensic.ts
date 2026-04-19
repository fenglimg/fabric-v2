import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import { forensicReportSchema, type ForensicEntryPoint, type ForensicReport } from "@fenglimg/fabric-shared";

import { detectFramework } from "./detector.js";

declare const __CLI_VERSION__: string | undefined;

type PackageJson = {
  name?: string;
};

type FileInfo = {
  relativePath: string;
  sizeBytes: number;
};

type TopologyResult = {
  total_files: number;
  by_ext: Record<string, number>;
  key_dirs: string[];
  max_depth: number;
  files: FileInfo[];
};

type ReadmeInfo = ForensicReport["readme"];

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
const SAMPLE_LIMIT = 5;
const SAMPLE_LINE_LIMIT = 30;

export function buildForensicReport(targetInput: string): ForensicReport {
  const target = normalizeTarget(targetInput);
  const framework = detectFramework(target);
  const topology = buildTopology(target);
  const entryPoints = collectEntryPoints(topology.files);
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
    code_samples: buildCodeSamples(target, entryPoints),
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

function buildCodeSamples(target: string, entryPoints: ForensicEntryPoint[]): ForensicReport["code_samples"] {
  return entryPoints.slice(0, SAMPLE_LIMIT).map((entryPoint) => {
    const absolutePath = join(target, ...entryPoint.path.split("/"));
    const sample = readFirstLines(absolutePath, SAMPLE_LINE_LIMIT);

    return {
      path: entryPoint.path,
      lines: `1-${sample.lineCount}`,
      snippet: sample.snippet,
      pattern_hint: inferPatternHint(entryPoint.path, sample.snippet),
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

function inferPatternHint(relativePath: string, snippet: string): string {
  if (snippet.includes("_decorator") || snippet.includes("extends Component")) {
    return "cocos-component-class";
  }

  if (snippet.includes("createRoot(") || snippet.includes("ReactDOM.render(")) {
    return "react-root";
  }

  if (relativePath.startsWith("app/") || relativePath.startsWith("pages/")) {
    return "next-route-component";
  }

  if (relativePath === "src/main.ts" || relativePath === "src/main.js") {
    return "vite-main-entry";
  }

  return "source-entry";
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
