import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { defineCommand } from "citty";

import { createDebugLogger, readFabricConfig, resolveDevMode } from "../dev-mode.js";
import { detectFramework, type FrameworkInfo } from "../scanner/detector.js";
import { resolveIgnores } from "../scanner/ignores.js";

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

export function createScanReport(
  targetInput: string = process.cwd(),
  fabricConfig?: { scanIgnores?: string[] },
): ScanReport {
  const target = normalizeTarget(targetInput);
  const framework = detectFramework(target);
  const readmeQuality = getReadmeQuality(target);
  const hasContributing = existsSync(join(target, "CONTRIBUTING.md"));
  const hasExistingFabric = existsSync(join(target, "AGENTS.md")) || existsSync(join(target, ".fabric"));
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

export const scanCommand = defineCommand({
  meta: {
    name: "scan",
    description: "Scan a project for Fabric bootstrap candidates.",
  },
  args: {
    target: {
      type: "string",
      description: "Absolute target path to scan. Defaults to CLI target, EXTERNAL_FIXTURE_PATH, fabric.config.json, or cwd.",
    },
    debug: {
      type: "boolean",
      description: "Print detector evidence in pretty output.",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print the diagnostic report as JSON.",
      default: false,
    },
  },
  async run({ args }: { args: ScanArgs }) {
    const workspaceRoot = process.cwd();
    const logger = createDebugLogger(args.debug);
    const resolution = resolveDevMode(args.target, workspaceRoot);
    const fabricConfig = readFabricConfig(workspaceRoot);

    logger(`scan target source: ${resolution.source}`);
    for (const step of resolution.chain) {
      logger(step);
    }

    const report = createScanReport(resolution.target, fabricConfig);

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    printPrettyReport(report, Boolean(args.debug));
  },
});

export default scanCommand;

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function getReadmeQuality(target: string): ReadmeQuality {
  const readmePath = join(target, "README.md");
  if (!existsSync(readmePath)) {
    return "stub";
  }

  const wordCount = readFileSync(readmePath, "utf8")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return wordCount >= 200 ? "ok" : "stub";
}

function walkFiles(root: string, ignorePatterns: string[]): WalkResult {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Target must be an existing directory: ${root}`);
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
    recommendations.push("L0: Run fab init to scaffold AGENTS.md with TODO markers.");
  }

  if (input.readmeQuality === "stub") {
    recommendations.push("L0: Expand README.md before promoting project facts into AGENTS.md references.");
  }

  if (!input.hasContributing) {
    recommendations.push("L0: Add CONTRIBUTING.md or leave an AGENTS.md TODO reference for contribution flow.");
  }

  if (input.framework.kind === "unknown") {
    recommendations.push("L1: Add tech-stack TODOs manually because no framework marker was detected.");
  } else {
    recommendations.push(`L1: Review ${input.framework.kind} directories for future scoped AGENTS.md files.`);
  }

  return recommendations;
}

function printPrettyReport(report: ScanReport, debug: boolean): void {
  console.log("Fabric scan report");
  console.log(`Target: ${report.target}`);
  console.log(`Framework: ${report.framework.kind}`);
  if (debug) {
    console.log(`Evidence: ${report.framework.evidence.length > 0 ? report.framework.evidence.join(", ") : "none"}`);
  }
  console.log(`README quality: ${report.readmeQuality}`);
  console.log(`CONTRIBUTING.md: ${report.hasContributing ? "present" : "missing"}`);
  console.log(`Files counted: ${report.fileCount}`);
  console.log(`Ignored entries: ${report.ignoredCount}`);
  console.log(`Existing Fabric files: ${report.hasExistingFabric ? "yes" : "no"}`);
  console.log("Recommendations:");
  for (const recommendation of report.recommendations) {
    console.log(`- ${recommendation}`);
  }
}
