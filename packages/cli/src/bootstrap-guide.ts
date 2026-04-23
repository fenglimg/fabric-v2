import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FrameworkInfo } from "./scanner/detector.js";
import { createScanReport } from "./commands/scan.js";
import { t } from "./i18n.js";

type PackageJson = {
  name?: string;
};

const AGENTS_TEMPLATE_BY_FRAMEWORK: Partial<Record<FrameworkInfo["kind"], string>> = {
  "cocos-creator": "templates/agents-md/variants/cocos.md",
  vite: "templates/agents-md/variants/vite.md",
  next: "templates/agents-md/variants/next.md",
};

export const FABRIC_GUIDE_PATH = ".fabric/bootstrap/README.md";

export async function buildFabricBootstrapGuide(target: string): Promise<string> {
  const workspaceRoot = normalizeTarget(target);
  const scanReport = await createScanReport(workspaceRoot);
  const template = readFileSync(findBootstrapTemplatePath(scanReport.framework.kind), "utf8");
  const packageName = readPackageName(workspaceRoot) ?? parse(workspaceRoot).base;

  return ensureTrailingNewline(
    template
      .replaceAll("{ projectName }", packageName)
      .replaceAll("{ frameworkKind }", scanReport.framework.kind),
  );
}

export async function ensureFabricBootstrapGuide(workspaceRoot: string, force?: boolean): Promise<void> {
  const guidePath = resolve(workspaceRoot, FABRIC_GUIDE_PATH);
  if (existsSync(guidePath) && !force) {
    return;
  }

  mkdirSync(dirname(guidePath), { recursive: true });
  writeFileSync(guidePath, await buildFabricBootstrapGuide(workspaceRoot), "utf8");
}

function findBootstrapTemplatePath(frameworkKind: FrameworkInfo["kind"]): string {
  const relativePath = AGENTS_TEMPLATE_BY_FRAMEWORK[frameworkKind] ?? "templates/agents-md/AGENTS.md.template";
  return findTemplatePath(relativePath);
}

function readPackageName(target: string): string | undefined {
  const packageJsonPath = join(target, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
    return packageJson.name;
  } catch {
    return undefined;
  }
}

function findTemplatePath(relativePath: string): string {
  const currentModuleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...templateCandidatesFrom(process.cwd(), relativePath),
    ...templateCandidatesFrom(currentModuleDir, relativePath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(t("cli.shared.template-not-found", { path: relativePath }));
}

function templateCandidatesFrom(start: string, relativePath: string): string[] {
  const candidates: string[] = [];
  let current = resolve(start);

  while (true) {
    candidates.push(join(current, ...relativePath.split("/")));

    const parent = dirname(current);
    if (parent === current || parse(current).root === current) {
      break;
    }

    current = parent;
  }

  return candidates.reverse();
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}
