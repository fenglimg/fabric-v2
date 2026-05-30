import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { detectFramework, type FrameworkInfo } from "@fenglimg/fabric-shared/node";
// ISS-021: route through the shared, i18n-keyed recommendation builder so this
// (quarantined) http scan no longer forks its own English-only strings.
import { buildScanRecommendations, createTranslator, resolveFabricLocale } from "@fenglimg/fabric-shared";

import { type FabricHttpApp, sendUnknownError } from "./_error.js";

type ReadmeQuality = "stub" | "ok";

type ScanReport = {
  target: string;
  framework: FrameworkInfo;
  readmeQuality: ReadmeQuality;
  hasContributing: boolean;
  fileCount: number;
  ignoredCount: number;
  hasExistingFabric: boolean;
  recommendations: string[];
};

const DEFAULT_IGNORES = [
  "**/*.meta",
  "library/**",
  "temp/**",
  "build/**",
  "settings/**",
  "profiles/**",
  "node_modules/**",
  "dist/**",
  ".git/**",
  ".fabric/**",
];

export function registerScanApi(app: FabricHttpApp, projectRoot: string): void {
  app.get("/api/scan", async (_req, res) => {
    try {
      res.json(await createScanReport(projectRoot));
    } catch (error) {
      sendUnknownError(res, error);
    }
  });
}

async function createScanReport(targetInput: string = process.cwd()): Promise<ScanReport> {
  const target = normalizeTarget(targetInput);
  const framework = detectFramework(target);
  const readmeQuality = getReadmeQuality(target);
  const hasContributing = existsSync(join(target, "CONTRIBUTING.md"));
  // v2.0: presence of `.fabric/` is the canonical "Fabric initialized" signal —
  // the legacy `.fabric/bootstrap/README.md` is no longer authoritative.
  const hasExistingFabric = existsSync(join(target, ".fabric"));
  const walkResult = walkFiles(target, DEFAULT_IGNORES);

  return {
    target,
    framework,
    readmeQuality,
    hasContributing,
    fileCount: walkResult.fileCount,
    ignoredCount: walkResult.ignoredCount,
    hasExistingFabric,
    recommendations: buildScanRecommendations(
      {
        frameworkKind: framework.kind,
        readmeOk: readmeQuality === "ok",
        hasContributing,
        hasExistingFabric,
      },
      createTranslator(resolveFabricLocale(target)),
    ),
  };
}

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

function walkFiles(root: string, ignorePatterns: string[]): { fileCount: number; ignoredCount: number } {
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
