import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";

import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import { createScanReport } from "./scan.js";

type PackageJson = {
  name?: string;
};

type AgentsMeta = {
  revision: string;
  nodes: {
    L0: {
      file: "AGENTS.md";
      scope_glob: "**";
      deps: [];
      priority: "high";
      hash: string;
    };
  };
};

type InitArgs = {
  target?: string;
  debug?: boolean;
};

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Initialize Fabric in a target project.",
  },
  args: {
    target: {
      type: "string",
      description: "Target project path. Defaults to CLI target, EXTERNAL_FIXTURE_PATH, fabric.config.json, or cwd.",
    },
    debug: {
      type: "boolean",
      description: "Print target resolution details to stderr.",
      default: false,
    },
  },
  async run({ args }: { args: InitArgs }) {
    const logger = createDebugLogger(args.debug);
    const resolution = resolveDevMode(args.target, process.cwd());
    const target = normalizeTarget(resolution.target);

    logger(`init target source: ${resolution.source}`);
    for (const step of resolution.chain) {
      logger(step);
    }

    const created = initFabric(target);

    console.log(`Created ${created.agentsPath}`);
    console.log(`Created ${created.metaPath}`);
    console.log(`Created ${created.humanLockPath}`);
    console.log("Next: run fab hooks install to add the Day 4 pre-commit pipeline.");
  },
});

export default initCommand;

export function initFabric(target: string): {
  agentsPath: string;
  metaPath: string;
  humanLockPath: string;
} {
  assertExistingDirectory(target);

  const agentsPath = join(target, "AGENTS.md");
  const fabricDir = join(target, ".fabric");

  if (existsSync(agentsPath)) {
    throw new Error(`ABORT: ${agentsPath} already exists. fab init is non-destructive.`);
  }

  if (existsSync(fabricDir)) {
    throw new Error(`ABORT: ${fabricDir} already exists. fab init is non-destructive.`);
  }

  const scanReport = createScanReport(target);
  const template = readFileSync(findTemplatePath("templates/agents-md/AGENTS.md.template"), "utf8");
  const humanLockTemplate = readFileSync(findTemplatePath("templates/fabric/human-lock.json"), "utf8");
  const packageName = readPackageName(target) ?? "// TODO: project name";
  const agentsContent = template
    .replaceAll("{ projectName }", packageName)
    .replaceAll("{ frameworkKind }", scanReport.framework.kind);
  const agentsHash = sha256(agentsContent);
  const meta = createInitialMeta(agentsHash);
  const metaPath = join(fabricDir, "agents.meta.json");
  const humanLockPath = join(fabricDir, "human-lock.json");

  mkdirSync(fabricDir, { recursive: false });
  writeNewFile(agentsPath, agentsContent);
  writeNewFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  writeNewFile(humanLockPath, humanLockTemplate.endsWith("\n") ? humanLockTemplate : `${humanLockTemplate}\n`);

  return { agentsPath, metaPath, humanLockPath };
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Target must be an existing directory: ${target}`);
  }
}

function createInitialMeta(agentsHash: string): AgentsMeta {
  return {
    revision: sha256(agentsHash),
    nodes: {
      L0: {
        file: "AGENTS.md",
        scope_glob: "**",
        deps: [],
        priority: "high",
        hash: agentsHash,
      },
    },
  };
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

  throw new Error(`Template not found: ${relativePath}`);
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

  return candidates;
}

function writeNewFile(path: string, content: string): void {
  if (existsSync(path)) {
    throw new Error(`ABORT: ${path} already exists. fab init is non-destructive.`);
  }

  writeFileSync(path, content, "utf8");
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
