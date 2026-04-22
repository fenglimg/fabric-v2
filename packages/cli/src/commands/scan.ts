import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { defineCommand } from "citty";

import { displayWidth, padEnd, paint, symbol } from "../colors.js";
import { createDebugLogger, readFabricConfig, resolveDevMode } from "../dev-mode.js";
import { t } from "../i18n.js";
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
  const hasExistingFabric = existsSync(join(target, ".fabric", "bootstrap", "README.md")) || existsSync(join(target, ".fabric"));
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

function printPrettyReport(report: ScanReport, debug: boolean): void {
  console.log(paint.ai(t("cli.scan.report.title")));

  const rows: Array<[string, string]> = [
    [t("cli.scan.report.target"), paint.human(report.target)],
    [t("cli.scan.report.framework"), paint.ai(report.framework.kind)],
    [
      t("cli.scan.report.readme-quality"),
      report.readmeQuality === "ok"
        ? paint.success(t("cli.scan.readme-quality.ok"))
        : paint.warn(t("cli.scan.readme-quality.stub")),
    ],
    [
      t("cli.scan.report.contributing"),
      report.hasContributing ? paint.success(t("cli.shared.present")) : paint.warn(t("cli.shared.absent")),
    ],
    [t("cli.scan.report.files-counted"), String(report.fileCount)],
    [t("cli.scan.report.ignored-entries"), report.ignoredCount > 0 ? paint.muted(String(report.ignoredCount)) : "0"],
    [
      t("cli.scan.report.existing-fabric"),
      report.hasExistingFabric ? paint.warn(t("cli.shared.yes")) : paint.success(t("cli.shared.no")),
    ],
  ];

  if (debug) {
    rows.splice(2, 0, [
      t("cli.scan.report.evidence"),
      report.framework.evidence.length > 0 ? paint.muted(report.framework.evidence.join(", ")) : paint.muted(t("cli.shared.none")),
    ]);
  }

  const labelWidth = Math.max(...rows.map(([key]) => displayWidth(key)));
  for (const [key, value] of rows) {
    console.log(`${paint.muted(padEnd(key, labelWidth))} ${value}`);
  }

  console.log(paint.muted(t("cli.scan.report.recommendations")));
  for (const recommendation of report.recommendations) {
    console.log(`${symbol.warn} ${paint.drift(recommendation)}`);
  }
}
