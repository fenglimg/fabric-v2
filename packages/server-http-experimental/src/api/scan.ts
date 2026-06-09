import { access, readFile, readdir, stat } from "node:fs/promises";
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
  const readmeQuality = await getReadmeQuality(target);
  const hasContributing = await pathExists(join(target, "CONTRIBUTING.md"));
  // v2.0: presence of `.fabric/` is the canonical "Fabric initialized" signal —
  // the legacy `.fabric/bootstrap/README.md` is no longer authoritative.
  const hasExistingFabric = await pathExists(join(target, ".fabric"));
  const walkResult = await walkFiles(target, DEFAULT_IGNORES);

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

async function getReadmeQuality(target: string): Promise<ReadmeQuality> {
  const readmePath = join(target, "README.md");
  const contents = await readFile(readmePath, "utf8").catch((error: unknown) => {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  });
  if (contents === null) {
    return "stub";
  }

  const wordCount = contents
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return wordCount >= 200 ? "ok" : "stub";
}

async function walkFiles(root: string, ignorePatterns: string[]): Promise<{ fileCount: number; ignoredCount: number }> {
  const rootStat = await stat(root).catch((error: unknown) => {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  });
  if (rootStat === null || !rootStat.isDirectory()) {
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

    for (const entry of await readdir(current, { withFileTypes: true })) {
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

async function pathExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
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
