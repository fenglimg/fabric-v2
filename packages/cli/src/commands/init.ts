import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentsMeta } from "@fabric/shared";
import { defineCommand } from "citty";

import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import type { FrameworkInfo } from "../scanner/detector.js";
import { buildForensicReport } from "../scanner/forensic.js";
import { createScanReport } from "./scan.js";

type PackageJson = {
  name?: string;
};

type InitArgs = {
  target?: string;
  debug?: boolean;
};

type ClaudeHookAction = "created" | "skipped";

type ClaudeSettingsAction = "created" | "updated" | "skipped" | "skipped-invalid";

type ClaudeSettings = {
  hooks?: {
    Stop?: ClaudeStopHookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ClaudeStopHookEntry = {
  matcher: string;
  hooks: ClaudeCommandHook[];
  [key: string]: unknown;
};

type ClaudeCommandHook = {
  type: string;
  command: string;
  [key: string]: unknown;
};

const AGENTS_TEMPLATE_BY_FRAMEWORK: Partial<Record<FrameworkInfo["kind"], string>> = {
  "cocos-creator": "templates/agents-md/variants/cocos.md",
  vite: "templates/agents-md/variants/vite.md",
  next: "templates/agents-md/variants/next.md",
};

const CLAUDE_INIT_SKILL_TEMPLATE = "templates/claude-skills/agents-md-init/SKILL.md";
const CLAUDE_INIT_REMINDER_HOOK_TEMPLATE = "templates/claude-hooks/agents-md-init-reminder.cjs";
const CLAUDE_INIT_REMINDER_COMMAND = ".claude/hooks/agents-md-init-reminder.cjs";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "在目标项目中初始化 Fabric。",
  },
  args: {
    target: {
      type: "string",
      description: "目标项目路径，默认依次使用 CLI 参数、EXTERNAL_FIXTURE_PATH、fabric.config.json 或当前目录。",
    },
    debug: {
      type: "boolean",
      description: "将目标解析详情输出到 stderr。",
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
    console.log(`Created ${created.forensicPath}`);
    writeStderr(
      created.claudeSkillAction === "created"
        ? `Installed ${created.claudeSkillPath}`
        : `Skipped ${created.claudeSkillPath}: already exists.`,
    );
    writeStderr(
      created.claudeHookAction === "created"
        ? `Installed ${created.claudeHookPath}`
        : `Skipped ${created.claudeHookPath}: already exists.`,
    );
    writeStderr(formatClaudeSettingsAction(created.claudeSettingsPath, created.claudeSettingsAction));
    console.log("Next: run fab hooks install to add the Day 4 pre-commit pipeline.");
    console.log("Reason: .fabric/forensic.json is ready; use the agents-md-init skill to finish AGENTS.md initialization.");
  },
});

export default initCommand;

export function initFabric(target: string): {
  agentsPath: string;
  metaPath: string;
  humanLockPath: string;
  forensicPath: string;
  claudeSkillPath: string;
  claudeSkillAction: ClaudeHookAction;
  claudeHookPath: string;
  claudeHookAction: ClaudeHookAction;
  claudeSettingsPath: string;
  claudeSettingsAction: ClaudeSettingsAction;
} {
  assertExistingDirectory(target);

  const agentsPath = join(target, "AGENTS.md");
  const fabricDir = join(target, ".fabric");
  const forensicPath = join(fabricDir, "forensic.json");
  const claudeSkillPath = join(target, ".claude", "skills", "agents-md-init", "SKILL.md");
  const claudeHookPath = join(target, ".claude", "hooks", "agents-md-init-reminder.cjs");
  const claudeSettingsPath = join(target, ".claude", "settings.json");

  if (existsSync(forensicPath)) {
    throw new Error(`ABORT: ${forensicPath} already exists. fab init is non-destructive.`);
  }

  if (existsSync(agentsPath)) {
    throw new Error(`ABORT: ${agentsPath} already exists. fab init is non-destructive.`);
  }

  if (existsSync(fabricDir)) {
    throw new Error(`ABORT: ${fabricDir} already exists. fab init is non-destructive.`);
  }

  const scanReport = createScanReport(target);
  const forensicReport = buildForensicReport(target);
  const template = readFileSync(findAgentsTemplatePath(scanReport.framework.kind), "utf8");
  const humanLockTemplate = readFileSync(findTemplatePath("templates/fabric/human-lock.json"), "utf8");
  const packageName = readPackageName(target) ?? parse(target).base;
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
  writeNewFile(forensicPath, `${JSON.stringify(forensicReport, null, 2)}\n`);
  const claudeSkillAction = copyTemplateIfMissing(findTemplatePath(CLAUDE_INIT_SKILL_TEMPLATE), claudeSkillPath);
  const claudeHookAction = copyExecutableTemplateIfMissing(
    findTemplatePath(CLAUDE_INIT_REMINDER_HOOK_TEMPLATE),
    claudeHookPath,
  );
  const claudeSettingsAction = mergeClaudeStopHook(claudeSettingsPath);

  return {
    agentsPath,
    metaPath,
    humanLockPath,
    forensicPath,
    claudeSkillPath,
    claudeSkillAction,
    claudeHookPath,
    claudeHookAction,
    claudeSettingsPath,
    claudeSettingsAction,
  };
}

function findAgentsTemplatePath(frameworkKind: FrameworkInfo["kind"]): string {
  // This selection only powers the non-AI fallback scaffold. The agents-md-init
  // skill can replace it later with a richer project-specific AGENTS.md.
  const relativePath = AGENTS_TEMPLATE_BY_FRAMEWORK[frameworkKind] ?? "templates/agents-md/AGENTS.md.template";
  return findTemplatePath(relativePath);
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

function copyTemplateIfMissing(templatePath: string, targetPath: string): "created" | "skipped" {
  mkdirSync(dirname(targetPath), { recursive: true });

  if (existsSync(targetPath)) {
    return "skipped";
  }

  copyFileSync(templatePath, targetPath);
  return "created";
}

function copyExecutableTemplateIfMissing(templatePath: string, targetPath: string): ClaudeHookAction {
  const action = copyTemplateIfMissing(templatePath, targetPath);
  if (action === "created") {
    chmodSync(targetPath, 0o755);
  }

  return action;
}

function mergeClaudeStopHook(settingsPath: string): ClaudeSettingsAction {
  mkdirSync(dirname(settingsPath), { recursive: true });

  let settings: ClaudeSettings;
  let action: ClaudeSettingsAction = "updated";

  if (!existsSync(settingsPath)) {
    settings = {};
    action = "created";
  } else {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
      if (!isRecord(parsed)) {
        writeStderr(`Skipped ${settingsPath}: expected a JSON object.`);
        return "skipped-invalid";
      }

      settings = parsed as ClaudeSettings;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown parse error";
      writeStderr(`Skipped ${settingsPath}: invalid JSON (${reason}).`);
      return "skipped-invalid";
    }
  }

  if (settings.hooks !== undefined && !isRecord(settings.hooks)) {
    writeStderr(`Skipped ${settingsPath}: "hooks" must be a JSON object.`);
    return "skipped-invalid";
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const stopHooksValue = hooks.Stop;
  if (stopHooksValue !== undefined && !Array.isArray(stopHooksValue)) {
    writeStderr(`Skipped ${settingsPath}: "hooks.Stop" must be an array.`);
    return "skipped-invalid";
  }

  const stopHooks = Array.isArray(stopHooksValue) ? stopHooksValue : [];
  if (hasClaudeInitReminderHook(stopHooks)) {
    return "skipped";
  }

  stopHooks.push({
    matcher: "*",
    hooks: [
      {
        type: "command",
        command: CLAUDE_INIT_REMINDER_COMMAND,
      },
    ],
  } satisfies ClaudeStopHookEntry);

  settings.hooks = {
    ...hooks,
    Stop: stopHooks as ClaudeStopHookEntry[],
  };
  writeJsonAtomically(settingsPath, settings);
  return action;
}

function hasClaudeInitReminderHook(stopHooks: unknown[]): boolean {
  return stopHooks.some((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      return false;
    }

    return entry.hooks.some(
      (hook) =>
        isRecord(hook) &&
        hook.type === "command" &&
        typeof hook.command === "string" &&
        hook.command.includes("agents-md-init-reminder.cjs"),
    );
  });
}

function writeJsonAtomically(path: string, value: unknown): void {
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatClaudeSettingsAction(settingsPath: string, action: ClaudeSettingsAction): string {
  switch (action) {
    case "created":
      return `Created ${settingsPath} with Claude Stop hook.`;
    case "updated":
      return `Updated ${settingsPath} with Claude Stop hook.`;
    case "skipped":
      return `Skipped ${settingsPath}: Claude Stop hook already present.`;
    case "skipped-invalid":
      return `Skipped ${settingsPath}: unable to merge Claude Stop hook.`;
    default:
      return `Updated ${settingsPath}`;
  }
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
