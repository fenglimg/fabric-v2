import { createHash } from "node:crypto";
import * as childProcess from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentsMeta } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { buildFabricBootstrapGuide } from "../bootstrap-guide.js";
import { displayWidth, paint, padEnd } from "../colors.js";
import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import { t } from "../i18n.js";
import { installBootstrap } from "./bootstrap.js";
import * as configCommand from "./config.js";
import { installHooks } from "./hooks.js";
import { buildForensicReport } from "../scanner/forensic.js";
import { detectClientSupports, type DetectedClientSupport } from "../config/resolver.js";

type InitArgs = {
  target?: string;
  debug?: boolean;
  force?: boolean;
  bootstrap?: boolean;
  mcp?: boolean;
  hooks?: boolean;
  interactive?: boolean;
  "mcp-install"?: string;
  skipBootstrap?: boolean;
  skipMcp?: boolean;
  skipHooks?: boolean;
};

type InitOptions = {
  force?: boolean;
  skipBootstrap?: boolean;
  skipMcp?: boolean;
  skipHooks?: boolean;
};

type InitWriteAction = "created" | "overwritten";

type ClaudeHookAction = InitWriteAction | "skipped";

type ClaudeSettingsAction = "created" | "overwritten" | "skipped" | "skipped-invalid" | "updated";
type CodexHooksAction = "created" | "overwritten" | "skipped";

type InitStageName = "bootstrap" | "mcp" | "hooks";

type InitStageDisposition = "ran" | "skipped" | "failed";

type InitStageRecord = {
  name: InitStageName;
  disposition: InitStageDisposition;
};

type InitCapabilityRow = {
  client: string;
  bootstrap: string;
  mcp: string;
  hook: string;
  skill: string;
  followUp: string;
};

type McpInstallMode = "global" | "local";

type ClaudeSettings = {
  hooks?: {
    Stop?: ClaudeStopHookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type CodexHooksConfig = {
  hooks: {
    SessionStart: Array<{ matcher: string; hooks: Array<{ type: "command"; command: string }> }>;
    Stop: Array<{ matcher: string; hooks: Array<{ type: "command"; command: string }> }>;
  };
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

const CLAUDE_INIT_SKILL_TEMPLATE = "templates/claude-skills/agents-md-init/SKILL.md";
const CLAUDE_INIT_REMINDER_HOOK_TEMPLATE = "templates/claude-hooks/agents-md-init-reminder.cjs";
const CLAUDE_INIT_REMINDER_COMMAND = ".claude/hooks/agents-md-init-reminder.cjs";
const CODEX_INIT_SKILL_TEMPLATE = "templates/codex-skills/fabric-init/SKILL.md";
const CODEX_SESSION_START_HOOK_TEMPLATE = "templates/codex-hooks/fabric-session-start.cjs";
const CODEX_STOP_HOOK_TEMPLATE = "templates/codex-hooks/fabric-stop-reminder.cjs";
const CODEX_SESSION_START_COMMAND = ".codex/hooks/fabric-session-start.cjs";
const CODEX_STOP_COMMAND = ".codex/hooks/fabric-stop-reminder.cjs";
const LOCAL_FABRIC_SERVER_PATH = join("node_modules", "@fenglimg", "fabric-server", "dist", "index.js");
const FABRIC_SERVER_PACKAGE = "@fenglimg/fabric-server";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: t("cli.init.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.init.args.target.description"),
    },
    debug: {
      type: "boolean",
      description: t("cli.init.args.debug.description"),
      default: false,
    },
    force: {
      type: "boolean",
      description: t("cli.init.args.force.description"),
      default: false,
    },
    bootstrap: {
      type: "boolean",
      default: true,
      negativeDescription: t("cli.init.args.no-bootstrap.description"),
    },
    mcp: {
      type: "boolean",
      default: true,
      negativeDescription: t("cli.init.args.no-mcp.description"),
    },
    hooks: {
      type: "boolean",
      default: true,
      negativeDescription: t("cli.init.args.no-hooks.description"),
    },
    interactive: {
      type: "boolean",
      description: t("cli.init.args.interactive.description"),
      default: true,
    },
    "mcp-install": {
      type: "string",
      default: "global",
      description: t("cli.init.mcp.install.prompt"),
    },
  },
  async run({ args }: { args: InitArgs }) {
    const logger = createDebugLogger(args.debug);
    const resolution = resolveDevMode(args.target, process.cwd());
    const target = normalizeTarget(resolution.target);
    const mcpInstallMode = resolveMcpInstallMode(args["mcp-install"]);
    const options: InitOptions = {
      force: args.force,
      skipBootstrap: args.bootstrap === false ? true : args.skipBootstrap,
      skipMcp: args.mcp === false ? true : args.skipMcp,
      skipHooks: args.hooks === false ? true : args.skipHooks,
    };

    logger(`init target source: ${resolution.source}`);
    for (const step of resolution.chain) {
      logger(step);
    }

    const supports = detectClientSupports(target);
    const interactive = args.interactive !== false && isInteractiveInit();

    if (options.force) {
      writeStderr(t("cli.init.force.warning", { path: target }));
    }

    if (interactive) {
      printInitPlanSummary(target, options, mcpInstallMode, supports);
    }

    const created = initFabric(target, options);

    console.log(formatInitPathAction(created.bootstrapPath, created.bootstrapAction));
    console.log(formatInitPathAction(created.metaPath, created.metaAction));
    console.log(formatInitPathAction(created.humanLockPath, created.humanLockAction));
    console.log(formatInitPathAction(created.forensicPath, created.forensicAction));
    writeStderr(
      formatOptionalInitPathAction(created.claudeSkillPath, created.claudeSkillAction),
    );
    writeStderr(
      formatOptionalInitPathAction(created.claudeHookPath, created.claudeHookAction),
    );
    writeStderr(
      formatOptionalInitPathAction(created.codexSessionStartHookPath, created.codexSessionStartHookAction),
    );
    writeStderr(
      formatOptionalInitPathAction(created.codexStopHookPath, created.codexStopHookAction),
    );
    writeStderr(formatCodexHooksAction(created.codexHooksConfigPath, created.codexHooksConfigAction));
    writeStderr(formatClaudeSettingsAction(created.claudeSettingsPath, created.claudeSettingsAction));
    const stageResults: InitStageRecord[] = [];

    if (options.skipBootstrap) {
      stageResults.push({ name: "bootstrap", disposition: "skipped" });
    } else {
      console.log(formatInitStageHeader(t("cli.init.stages.bootstrap")));
      try {
        const result = await installBootstrap(target, { force: options.force });
        if (result.details.length === 0) {
          console.log(formatInitStageResult("bootstrap", "skipped", 0, 0, t("cli.bootstrap.install.no-targets")));
          stageResults.push({ name: "bootstrap", disposition: "skipped" });
        } else {
          console.log(
            formatInitStageResult("bootstrap", "completed", result.installed.length, result.skipped.length),
          );
          stageResults.push({ name: "bootstrap", disposition: "ran" });
        }
      } catch (error: unknown) {
        writeStderr(formatInitStageFailure("bootstrap", error));
        stageResults.push({ name: "bootstrap", disposition: "failed" });
      }
    }

    if (options.skipMcp) {
      stageResults.push({ name: "mcp", disposition: "skipped" });
    } else {
      console.log(formatInitStageHeader(t("cli.init.stages.mcp")));
      try {
        let localServerPath: string | undefined;

        if (mcpInstallMode === "local") {
          const manager = detectPackageManager(target);
          writeStderr(t("cli.init.mcp.install.local"));
          writeStderr(t("cli.init.mcp.local.installing", { manager }));
          installLocalFabricServer(target, manager);
          writeStderr(t("cli.init.mcp.local.installed"));
          localServerPath = LOCAL_FABRIC_SERVER_PATH;
        } else {
          writeStderr(t("cli.init.mcp.install.global"));
        }

        const result = await configCommand.installMcpClients(target, {
          force: options.force,
          localServerPath,
        });
        if (result.details.length === 0) {
          console.log(formatInitStageResult("mcp", "skipped", 0, 0, t("cli.config.install.no-configs")));
          stageResults.push({ name: "mcp", disposition: "skipped" });
        } else {
          console.log(formatInitStageResult("mcp", "completed", result.installed.length, result.skipped.length));
          stageResults.push({ name: "mcp", disposition: "ran" });
        }
      } catch (error: unknown) {
        writeStderr(formatInitStageFailure("mcp", error));
        stageResults.push({ name: "mcp", disposition: "failed" });
      }
    }

    if (options.skipHooks) {
      stageResults.push({ name: "hooks", disposition: "skipped" });
    } else {
      console.log(formatInitStageHeader(t("cli.init.stages.hooks")));
      try {
        const result = await installHooks(target, { force: options.force });
        console.log(formatInitStageResult("hooks", "completed", result.installed.length, result.skipped.length));
        stageResults.push({ name: "hooks", disposition: "ran" });
      } catch (error: unknown) {
        writeStderr(formatInitStageFailure("hooks", error));
        stageResults.push({ name: "hooks", disposition: "failed" });
      }
    }

    if (shouldPrintHooksNextStep(options, stageResults)) {
      console.log(
        t("cli.init.next-step", {
          label: nextLabel(),
          message: paint.muted(t("cli.init.next-step.message")),
        }),
      );
    }

    const finalSupports = detectClientSupports(target);

    console.log(
      t("cli.init.reason-message", {
        label: reasonLabel(),
        message: paint.muted(formatInitReasonMessage(finalSupports)),
      }),
    );
    printInitStageSummary(stageResults);
    printInitCapabilitySummary(finalSupports, stageResults, options);
  },
});

export default initCommand;

export function initFabric(target: string, options?: InitOptions): {
  bootstrapPath: string;
  bootstrapAction: InitWriteAction;
  metaPath: string;
  metaAction: InitWriteAction;
  humanLockPath: string;
  humanLockAction: InitWriteAction;
  forensicPath: string;
  forensicAction: InitWriteAction;
  claudeSkillPath: string;
  claudeSkillAction: ClaudeHookAction;
  codexSkillPath: string;
  codexSkillAction: ClaudeHookAction;
  codexSessionStartHookPath: string;
  codexSessionStartHookAction: ClaudeHookAction;
  codexStopHookPath: string;
  codexStopHookAction: ClaudeHookAction;
  codexHooksConfigPath: string;
  codexHooksConfigAction: CodexHooksAction;
  claudeHookPath: string;
  claudeHookAction: ClaudeHookAction;
  claudeSettingsPath: string;
  claudeSettingsAction: ClaudeSettingsAction;
} {
  assertExistingDirectory(target);

  const fabricDir = join(target, ".fabric");
  const bootstrapPath = join(fabricDir, "bootstrap", "README.md");
  const forensicPath = join(fabricDir, "forensic.json");
  const claudeSkillPath = join(target, ".claude", "skills", "agents-md-init", "SKILL.md");
  const codexSkillPath = join(target, ".agents", "skills", "fabric-init", "SKILL.md");
  const codexSessionStartHookPath = join(target, ".codex", "hooks", "fabric-session-start.cjs");
  const codexStopHookPath = join(target, ".codex", "hooks", "fabric-stop-reminder.cjs");
  const codexHooksConfigPath = join(target, ".codex", "hooks.json");
  const claudeHookPath = join(target, ".claude", "hooks", "agents-md-init-reminder.cjs");
  const claudeSettingsPath = join(target, ".claude", "settings.json");
  const metaPath = join(fabricDir, "agents.meta.json");
  const humanLockPath = join(fabricDir, "human-lock.json");

  prepareWritableDirectory(fabricDir, options);
  const bootstrapAction = prepareFreshPath(bootstrapPath, options);
  const metaAction = prepareFreshPath(metaPath, options);
  const humanLockAction = prepareFreshPath(humanLockPath, options);
  const forensicAction = prepareFreshPath(forensicPath, options);

  const forensicReport = buildForensicReport(target);
  const humanLockTemplate = readFileSync(findTemplatePath("templates/fabric/human-lock.json"), "utf8");
  const bootstrapContent = buildFabricBootstrapGuide(target);
  const bootstrapHash = sha256(bootstrapContent);
  const meta = createInitialMeta(bootstrapHash);

  mkdirSync(fabricDir, { recursive: true });
  mkdirSync(dirname(bootstrapPath), { recursive: true });
  writeNewFile(bootstrapPath, bootstrapContent, options);
  writeNewFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, options);
  writeNewFile(humanLockPath, humanLockTemplate.endsWith("\n") ? humanLockTemplate : `${humanLockTemplate}\n`, options);
  writeNewFile(forensicPath, `${JSON.stringify(forensicReport, null, 2)}\n`, options);
  const claudeSkillAction = copyTemplateIfMissing(findTemplatePath(CLAUDE_INIT_SKILL_TEMPLATE), claudeSkillPath, options);
  const codexSkillAction = copyTemplateIfMissing(findTemplatePath(CODEX_INIT_SKILL_TEMPLATE), codexSkillPath, options);
  const codexSessionStartHookAction = copyExecutableTemplateIfMissing(
    findTemplatePath(CODEX_SESSION_START_HOOK_TEMPLATE),
    codexSessionStartHookPath,
    options,
  );
  const codexStopHookAction = copyExecutableTemplateIfMissing(
    findTemplatePath(CODEX_STOP_HOOK_TEMPLATE),
    codexStopHookPath,
    options,
  );
  const codexHooksConfigAction = writeCodexHooksConfig(codexHooksConfigPath, options);
  const claudeHookAction = copyExecutableTemplateIfMissing(
    findTemplatePath(CLAUDE_INIT_REMINDER_HOOK_TEMPLATE),
    claudeHookPath,
    options,
  );
  const claudeSettingsAction = mergeClaudeStopHook(claudeSettingsPath, options);

  return {
    bootstrapPath,
    bootstrapAction,
    metaPath,
    metaAction,
    humanLockPath,
    humanLockAction,
    forensicPath,
    forensicAction,
    claudeSkillPath,
    claudeSkillAction,
    codexSkillPath,
    codexSkillAction,
    codexSessionStartHookPath,
    codexSessionStartHookAction,
    codexStopHookPath,
    codexStopHookAction,
    codexHooksConfigPath,
    codexHooksConfigAction,
    claudeHookPath,
    claudeHookAction,
    claudeSettingsPath,
    claudeSettingsAction,
  };
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Target must be an existing directory: ${target}`);
  }
}

export function detectPackageManager(cwd: string): "pnpm" | "npm" | "yarn" {
  const workspaceRoot = resolve(cwd);

  if (existsSync(join(workspaceRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (existsSync(join(workspaceRoot, "yarn.lock"))) {
    return "yarn";
  }

  if (existsSync(join(workspaceRoot, "package-lock.json"))) {
    return "npm";
  }

  return "npm";
}

function resolveMcpInstallMode(rawMode: string | undefined): McpInstallMode {
  if (rawMode === undefined || rawMode === "global" || rawMode === "local") {
    return rawMode ?? "global";
  }

  writeStderr(t("cli.init.mcp.install.invalid", { value: rawMode }));
  return "global";
}

function installLocalFabricServer(target: string, manager: "pnpm" | "npm" | "yarn"): void {
  const installArgs = manager === "npm"
    ? ["install", "-D", FABRIC_SERVER_PACKAGE]
    : ["add", "-D", FABRIC_SERVER_PACKAGE];

  childProcess.execFileSync(manager, installArgs, {
    cwd: target,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function createInitialMeta(agentsHash: string): AgentsMeta {
  return {
    revision: sha256(agentsHash),
    nodes: {
      L0: {
        file: ".fabric/bootstrap/README.md",
        scope_glob: "**",
        deps: [],
        priority: "high",
        layer: "L0",
        topology_type: "mirror",
        hash: agentsHash,
      },
    },
  };
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

function prepareFreshPath(path: string, options?: InitOptions): InitWriteAction {
  if (!existsSync(path)) {
    return "created";
  }

  if (!options?.force) {
    throw new Error(t("cli.init.errors.abort-existing", { path }));
  }

  rmSync(path, { recursive: true, force: true });
  return "overwritten";
}

function prepareWritableDirectory(path: string, options?: InitOptions): void {
  if (!existsSync(path) || statSync(path).isDirectory()) {
    return;
  }

  if (!options?.force) {
    throw new Error(t("cli.init.errors.abort-existing", { path }));
  }

  rmSync(path, { force: true });
}

function writeNewFile(path: string, content: string, options?: InitOptions): InitWriteAction {
  const existed = existsSync(path);
  if (existed && !options?.force) {
    throw new Error(t("cli.init.errors.abort-existing", { path }));
  }

  writeFileSync(path, content, "utf8");
  return existed ? "overwritten" : "created";
}

function copyTemplateIfMissing(templatePath: string, targetPath: string, options?: InitOptions): ClaudeHookAction {
  mkdirSync(dirname(targetPath), { recursive: true });

  const existed = existsSync(targetPath);
  if (existed && !options?.force) {
    return "skipped";
  }

  copyFileSync(templatePath, targetPath);
  return existed ? "overwritten" : "created";
}

function copyExecutableTemplateIfMissing(templatePath: string, targetPath: string, options?: InitOptions): ClaudeHookAction {
  const action = copyTemplateIfMissing(templatePath, targetPath, options);
  if (action !== "skipped") {
    chmodSync(targetPath, 0o755);
  }

  return action;
}

function writeCodexHooksConfig(configPath: string, options?: InitOptions): CodexHooksAction {
  mkdirSync(dirname(configPath), { recursive: true });

  const nextConfig: CodexHooksConfig = {
    hooks: {
      SessionStart: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: CODEX_SESSION_START_COMMAND }],
        },
      ],
      Stop: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: CODEX_STOP_COMMAND }],
        },
      ],
    },
  };

  if (!existsSync(configPath)) {
    writeJsonAtomically(configPath, nextConfig);
    return "created";
  }

  if (!options?.force) {
    return "skipped";
  }

  writeJsonAtomically(configPath, nextConfig);
  return "overwritten";
}

function mergeClaudeStopHook(settingsPath: string, options?: InitOptions): ClaudeSettingsAction {
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
        writeStderr(t("cli.init.claude-settings.invalid-object", { label: skippedLabel(), path: settingsPath }));
        return "skipped-invalid";
      }

      settings = parsed as ClaudeSettings;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown parse error";
      writeStderr(t("cli.init.claude-settings.invalid-json", { label: skippedLabel(), path: settingsPath, reason }));
      return "skipped-invalid";
    }
  }

  if (settings.hooks !== undefined && !isRecord(settings.hooks)) {
    writeStderr(t("cli.init.claude-settings.invalid-hooks", { label: skippedLabel(), path: settingsPath }));
    return "skipped-invalid";
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const stopHooksValue = hooks.Stop;
  if (stopHooksValue !== undefined && !Array.isArray(stopHooksValue)) {
    writeStderr(t("cli.init.claude-settings.invalid-stop-array", { label: skippedLabel(), path: settingsPath }));
    return "skipped-invalid";
  }

  const stopHooks = Array.isArray(stopHooksValue) ? stopHooksValue : [];
  const hasExistingFabricHook = hasClaudeInitReminderHook(stopHooks);
  if (hasExistingFabricHook && !options?.force) {
    return "skipped";
  }

  const nextStopHooks = hasExistingFabricHook && options?.force ? removeClaudeInitReminderHook(stopHooks) : [...stopHooks];
  nextStopHooks.push({
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
    Stop: nextStopHooks as ClaudeStopHookEntry[],
  };
  writeJsonAtomically(settingsPath, settings);
  return hasExistingFabricHook && options?.force ? "overwritten" : action;
}

function hasClaudeInitReminderHook(stopHooks: unknown[]): boolean {
  return stopHooks.some((entry) => isClaudeInitReminderStopEntry(entry));
}

function removeClaudeInitReminderHook(stopHooks: unknown[]): unknown[] {
  return stopHooks.filter((entry) => !isClaudeInitReminderStopEntry(entry));
}

function isClaudeInitReminderStopEntry(entry: unknown): boolean {
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
      return t("cli.init.claude-settings.created", { label: createdLabel(), path: settingsPath });
    case "updated":
      return t("cli.init.claude-settings.updated", { label: updatedLabel(), path: settingsPath });
    case "overwritten":
      return t("cli.init.claude-settings.updated", { label: overwrittenLabel(), path: settingsPath });
    case "skipped":
      return t("cli.init.claude-settings.skipped", { label: skippedLabel(), path: settingsPath });
    case "skipped-invalid":
      return t("cli.init.claude-settings.skipped-invalid", { label: skippedLabel(), path: settingsPath });
    default:
      return t("cli.init.claude-settings.updated", { label: updatedLabel(), path: settingsPath });
  }
}

function formatInitStageHeader(message: string): string {
  return `${nextLabel()} ${paint.muted(message)}`;
}

function formatInitStageResult(
  stage: InitStageName,
  status: "completed" | "skipped",
  installedCount: number,
  skippedCount: number,
  note?: string,
): string {
  const label = status === "completed" ? completedStageLabel() : skippedStageLabel();
  const counts = `installed=${installedCount} skipped=${skippedCount}`;
  const suffix = note ? ` ${paint.muted(`(${note})`)}` : "";
  return `${label} ${stage}: ${counts}${suffix}`;
}

function formatInitStageFailure(stage: InitStageName, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${failedStageLabel()} ${stage}: ${message}`;
}

function printInitStageSummary(stageResults: InitStageRecord[]): void {
  console.log(formatInitStageSummaryLine("ran", collectInitStageNames(stageResults, "ran")));
  console.log(formatInitStageSummaryLine("skipped", collectInitStageNames(stageResults, "skipped")));
  console.log(formatInitStageSummaryLine("failed", collectInitStageNames(stageResults, "failed")));
}

function formatInitStageSummaryLine(
  disposition: InitStageDisposition,
  stages: string[],
): string {
  const label = disposition === "ran"
    ? paint.success(t("cli.init.stages.summary.ran"))
    : disposition === "skipped"
      ? paint.muted(t("cli.init.stages.summary.skipped"))
      : paint.error(t("cli.init.stages.summary.failed"));
  return `${label}: ${stages.length > 0 ? stages.join(", ") : t("cli.shared.none")}`;
}

function collectInitStageNames(stageResults: InitStageRecord[], disposition: InitStageDisposition): string[] {
  return stageResults
    .filter((stage) => stage.disposition === disposition)
    .map((stage) => stage.name);
}

function shouldPrintHooksNextStep(options: InitOptions, stageResults: InitStageRecord[]): boolean {
  return Boolean(options.skipHooks) || stageResults.some((stage) => stage.name === "hooks" && stage.disposition === "failed");
}

function isInteractiveInit(): boolean {
  return Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
}

function printInitPlanSummary(
  target: string,
  options: InitOptions,
  mcpInstallMode: McpInstallMode,
  supports: DetectedClientSupport[],
): void {
  console.log(t("cli.init.plan.title"));
  console.log(t("cli.init.plan.target", { target }));
  console.log(
    t("cli.init.plan.actions", {
      bootstrap: yesNoLabel(!options.skipBootstrap),
      mcp: yesNoLabel(!options.skipMcp),
      hooks: yesNoLabel(!options.skipHooks),
      mcpInstall: mcpInstallMode,
    }),
  );

  const detected = supports.filter((support) => support.detected);
  console.log(
    t("cli.init.plan.detected", {
      clients: detected.length > 0 ? detected.map((support) => support.label).join(", ") : t("cli.shared.none"),
    }),
  );
  console.log(t("cli.init.plan.writes"));
  console.log(`  - ${target}/.fabric/bootstrap/README.md`);
  console.log(`  - ${target}/.fabric/agents.meta.json`);
  console.log(`  - ${target}/.fabric/human-lock.json`);
  console.log(`  - ${target}/.fabric/forensic.json`);
}

function printInitCapabilitySummary(
  supports: DetectedClientSupport[],
  stageResults: InitStageRecord[],
  options: InitOptions,
): void {
  const detected = supports.filter((support) => support.detected);
  if (detected.length === 0) {
    console.log(t("cli.init.capabilities.none"));
    return;
  }

  console.log(t("cli.init.capabilities.title"));
  const rows = detected.map((support) => toCapabilityRow(support, stageResults, options));
  const headers: InitCapabilityRow = {
    client: t("cli.init.capabilities.header.client"),
    bootstrap: t("cli.init.capabilities.header.bootstrap"),
    mcp: t("cli.init.capabilities.header.mcp"),
    hook: t("cli.init.capabilities.header.hook"),
    skill: t("cli.init.capabilities.header.skill"),
    followUp: t("cli.init.capabilities.header.follow-up"),
  };

  const widths = {
    client: Math.max(displayWidth(headers.client), ...rows.map((row) => displayWidth(row.client))),
    bootstrap: Math.max(displayWidth(headers.bootstrap), ...rows.map((row) => displayWidth(row.bootstrap))),
    mcp: Math.max(displayWidth(headers.mcp), ...rows.map((row) => displayWidth(row.mcp))),
    hook: Math.max(displayWidth(headers.hook), ...rows.map((row) => displayWidth(row.hook))),
    skill: Math.max(displayWidth(headers.skill), ...rows.map((row) => displayWidth(row.skill))),
    followUp: Math.max(displayWidth(headers.followUp), ...rows.map((row) => displayWidth(row.followUp))),
  };

  console.log(formatCapabilityTableRow(headers, widths));
  console.log(formatCapabilityDivider(widths));
  for (const row of rows) {
    console.log(formatCapabilityTableRow(row, widths));
  }
}

function formatCodexHooksAction(configPath: string, action: CodexHooksAction): string {
  switch (action) {
    case "created":
      return t("cli.init.codex-hooks.created", { label: createdLabel(), path: configPath });
    case "overwritten":
      return t("cli.init.codex-hooks.updated", { label: overwrittenLabel(), path: configPath });
    case "skipped":
      return t("cli.init.codex-hooks.skipped", { label: skippedLabel(), path: configPath });
    default:
      return t("cli.init.codex-hooks.updated", { label: updatedLabel(), path: configPath });
  }
}

function toCapabilityRow(
  support: DetectedClientSupport,
  stageResults: InitStageRecord[],
  options: InitOptions,
): InitCapabilityRow {
  const stage = (name: InitStageName): InitStageDisposition | null =>
    stageResults.find((entry) => entry.name === name)?.disposition ?? null;
  const bootstrap = support.capabilities.bootstrap
    ? capabilityStatus(options.skipBootstrap ? "skipped" : stage("bootstrap"))
    : t("cli.init.capabilities.status.na");
  const mcp = support.capabilities.mcp
    ? capabilityStatus(options.skipMcp ? "skipped" : stage("mcp"))
    : t("cli.init.capabilities.status.na");
  const hook = capabilityInstallStatus(support, "hook");
  const skill = capabilityInstallStatus(support, "skill");

  return {
    client: support.label,
    bootstrap,
    mcp,
    hook,
    skill,
    followUp: hasInstalledCapability(support, "skill")
      ? t("cli.init.capabilities.follow-up.ready")
      : support.capabilities.skill
        ? t("cli.init.capabilities.follow-up.install")
        : t("cli.init.capabilities.follow-up.manual"),
  };
}

function capabilityInstallStatus(
  support: DetectedClientSupport,
  capability: "hook" | "skill",
): string {
  if (!support.capabilities[capability]) {
    return t("cli.init.capabilities.status.na");
  }

  return hasInstalledCapability(support, capability)
    ? t("cli.init.capabilities.status.installed")
    : t("cli.init.capabilities.status.supported");
}

function hasInstalledCapability(
  support: DetectedClientSupport,
  capability: "hook" | "skill",
): boolean {
  return support.installedCapabilities?.[capability] === true;
}

function capabilityStatus(disposition: InitStageDisposition | "ran" | "skipped" | null): string {
  switch (disposition) {
    case "ran":
      return t("cli.init.capabilities.status.ready");
    case "skipped":
      return t("cli.init.capabilities.status.skipped");
    case "failed":
      return t("cli.init.capabilities.status.failed");
    case null:
      return t("cli.init.capabilities.status.na");
    default:
      return t("cli.init.capabilities.status.ready");
  }
}

function formatCapabilityTableRow(
  row: InitCapabilityRow,
  widths: Record<keyof InitCapabilityRow, number>,
): string {
  return [
    padEnd(row.client, widths.client),
    padEnd(row.bootstrap, widths.bootstrap),
    padEnd(row.mcp, widths.mcp),
    padEnd(row.hook, widths.hook),
    padEnd(row.skill, widths.skill),
    padEnd(row.followUp, widths.followUp),
  ].join("  ");
}

function formatCapabilityDivider(widths: Record<keyof InitCapabilityRow, number>): string {
  return [
    "".padEnd(widths.client, "-"),
    "".padEnd(widths.bootstrap, "-"),
    "".padEnd(widths.mcp, "-"),
    "".padEnd(widths.hook, "-"),
    "".padEnd(widths.skill, "-"),
    "".padEnd(widths.followUp, "-"),
  ].join("  ");
}

function formatInitReasonMessage(supports: DetectedClientSupport[]): string {
  const detected = supports.filter((support) => support.detected);
  const installedSkillClients = detected.filter((support) => hasInstalledCapability(support, "skill"));
  const hasClaudeSkill = installedSkillClients.some((support) => support.clientKind === "ClaudeCodeCLI");
  const hasCodexSkill = installedSkillClients.some((support) => support.clientKind === "CodexCLI");

  if (hasClaudeSkill && hasCodexSkill) {
    return t("cli.init.reason-message.multi-body");
  }

  if (hasClaudeSkill) {
    return t("cli.init.reason-message.claude-body");
  }

  if (hasCodexSkill) {
    return t("cli.init.reason-message.codex-body");
  }

  if (detected.some((support) => support.capabilities.skill)) {
    return t("cli.init.reason-message.installable-body");
  }

  return t("cli.init.reason-message.manual-body");
}

function yesNoLabel(value: boolean): string {
  return value ? t("cli.shared.yes") : t("cli.shared.no");
}

function formatInitPathAction(path: string, action: InitWriteAction): string {
  return t("cli.init.created-path", { label: labelForInitWriteAction(action), path });
}

function formatOptionalInitPathAction(path: string, action: ClaudeHookAction): string {
  if (action === "skipped") {
    return t("cli.init.skipped-existing-path", { label: skippedLabel(), path });
  }

  return formatInitPathAction(path, action);
}

function labelForInitWriteAction(action: InitWriteAction): string {
  return action === "overwritten" ? overwrittenLabel() : createdLabel();
}

function createdLabel(): string {
  return paint.success(t("cli.shared.created"));
}

function skippedLabel(): string {
  return paint.muted(t("cli.shared.skipped"));
}

function nextLabel(): string {
  return paint.ai(t("cli.shared.next"));
}

function reasonLabel(): string {
  return paint.human(t("cli.shared.reason"));
}

function updatedLabel(): string {
  return paint.success(t("cli.shared.updated"));
}

function overwrittenLabel(): string {
  return paint.warn(t("cli.init.force.overwritten"));
}

function completedStageLabel(): string {
  return paint.success(t("cli.init.stages.completed"));
}

function skippedStageLabel(): string {
  return paint.muted(t("cli.init.stages.skipped"));
}

function failedStageLabel(): string {
  return paint.error(t("cli.init.stages.failed"));
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
