import { createHash, randomUUID } from "node:crypto";
import * as childProcess from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cancel, confirm, group, intro, isCancel, log, note, outro, select } from "@clack/prompts";
import type { AgentsMeta } from "@fenglimg/fabric-shared";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";
import { defineCommand } from "citty";
import { checkLockOrThrow } from "@fenglimg/fabric-server";

import { buildFabricBootstrapGuide } from "../bootstrap-guide.js";
import { displayWidth, paint, padEnd } from "../colors.js";
import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import type { ClaudeMcpScope } from "../config/json.js";
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
  yes?: boolean;
  plan?: boolean;
  reapply?: boolean;
  bootstrap?: boolean;
  mcp?: boolean;
  hooks?: boolean;
  interactive?: boolean;
  "mcp-install"?: string;
  scope?: string;
  skipBootstrap?: boolean;
  skipMcp?: boolean;
  skipHooks?: boolean;
};

type InitOptions = {
  force?: boolean;
  skipBootstrap?: boolean;
  skipMcp?: boolean;
  skipHooks?: boolean;
  planOnly?: boolean;
  reapply?: boolean;
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

export type InitScaffoldResult = {
  bootstrapPath: string;
  bootstrapAction: InitWriteAction;
  metaPath: string;
  metaAction: InitWriteAction;
  taxonomyPath: string;
  taxonomyAction: InitWriteAction;
  eventsPath: string;
  eventsAction: InitWriteAction;
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

type InitExecutionPhaseName = "preflight" | "scaffold" | InitStageName | "post-setup";

type InitExecutionStep =
  | { name: "preflight" }
  | { name: "scaffold" }
  | { name: "bootstrap"; skipped: boolean }
  | { name: "mcp"; skipped: boolean }
  | { name: "hooks"; skipped: boolean }
  | { name: "post-setup" };

type InitStagePlan =
  | { name: "bootstrap"; skipped: boolean }
  | { name: "mcp"; skipped: boolean; installMode: McpInstallMode; claudeMcpScope: ClaudeMcpScope; localServerPath?: string; packageManager?: "pnpm" | "npm" | "yarn" }
  | { name: "hooks"; skipped: boolean };

type InitWizardSelection = {
  bootstrap: boolean;
  mcp: boolean;
  hooks: boolean;
  mcpInstallMode: McpInstallMode;
  claudeMcpScope: ClaudeMcpScope;
};

type InitWizardContext = {
  target: string;
  options: InitOptions;
  supports: DetectedClientSupport[];
  mcpInstallMode: McpInstallMode;
  claudeMcpScope: ClaudeMcpScope;
  lockedStages: InitStageName[];
};

type InitWizardAdapter = {
  run(context: InitWizardContext): Promise<InitWizardSelection | null>;
};

type InitCliIntent = {
  target: string;
  options: InitOptions;
  mcpInstallMode: McpInstallMode;
  claudeMcpScope: ClaudeMcpScope;
  interactiveSummary: boolean;
  wizardEnabled: boolean;
};

type InitOptionalTemplateWritePlan = {
  path: string;
  action: ClaudeHookAction;
  templatePath: string;
  executable?: boolean;
};

type InitJsonWritePlan = {
  path: string;
  action: CodexHooksAction;
  value: unknown;
};

type InitClaudeSettingsWritePlan =
  | {
      path: string;
      action: Extract<ClaudeSettingsAction, "created" | "updated" | "overwritten">;
      value: ClaudeSettings;
    }
  | {
      path: string;
      action: Extract<ClaudeSettingsAction, "skipped" | "skipped-invalid">;
      value: null;
    };

export type InitScaffoldPlan = {
  target: string;
  options?: InitOptions;
  fabricDir: string;
  replaceFabricDir: boolean;
  bootstrapPath: string;
  bootstrapAction: InitWriteAction;
  bootstrapContent: string;
  metaPath: string;
  metaAction: InitWriteAction;
  meta: AgentsMeta;
  taxonomyPath: string;
  taxonomyAction: InitWriteAction;
  taxonomyContent: string;
  rulesDir: string;
  eventsPath: string;
  eventsAction: InitWriteAction;
  forensicPath: string;
  forensicAction: InitWriteAction;
  forensicReport: Awaited<ReturnType<typeof buildForensicReport>>;
  claudeSkill: InitOptionalTemplateWritePlan;
  codexSkill: InitOptionalTemplateWritePlan;
  codexSessionStartHook: InitOptionalTemplateWritePlan;
  codexStopHook: InitOptionalTemplateWritePlan;
  codexHooksConfig: InitJsonWritePlan;
  claudeHook: InitOptionalTemplateWritePlan;
  claudeSettings: InitClaudeSettingsWritePlan;
};

export type InitExecutionPlan = {
  target: string;
  options: InitOptions;
  mcpInstallMode: McpInstallMode;
  claudeMcpScope: ClaudeMcpScope;
  interactive: boolean;
  supports: DetectedClientSupport[];
  scaffold: InitScaffoldPlan;
  stages: InitStagePlan[];
  steps: InitExecutionStep[];
};

export type InitExecutionResult = {
  plan: InitExecutionPlan;
  created: InitScaffoldResult;
  stageResults: InitStageRecord[];
  finalSupports: DetectedClientSupport[];
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
const INIT_WIZARD_GROUP_CANCELLED = Symbol("init-wizard-group-cancelled");

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
    yes: {
      type: "boolean",
      description: t("cli.init.args.yes.description"),
      default: false,
    },
    plan: {
      type: "boolean",
      description: t("cli.init.args.plan.description"),
      default: false,
    },
    reapply: {
      type: "boolean",
      description: t("cli.init.args.reapply.description"),
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
    scope: {
      type: "string",
      description: t("cli.init.mcp.scope.description"),
    },
  },
  async run({ args }: { args: InitArgs }) {
    await runInitCommand(args);
  },
});

export default initCommand;

async function runInitCommand(args: InitArgs): Promise<InitExecutionResult> {
  const logger = createDebugLogger(args.debug);
  const resolution = resolveDevMode(args.target, process.cwd());
  const intent = resolveInitCliIntent(args, resolution.target);

  // Preflight: when --reapply is used, refuse if a serve process is actively holding the lock
  // unless --force is explicitly passed. Check-only (no lock acquisition) is sufficient here.
  if (args.reapply === true) {
    checkLockOrThrow(intent.target, { force: args.force });
  }

  logger(`init target source: ${resolution.source}`);
  for (const step of resolution.chain) {
    logger(step);
  }

  if (intent.options.planOnly) {
    writeStderr(t("cli.init.compat.plan"));
  }

  if (args.interactive === false) {
    writeStderr(t("cli.init.compat.interactive"));
  }

  if (args.bootstrap === false || args.mcp === false || args.hooks === false) {
    writeStderr(t("cli.init.compat.legacy-stage-flags"));
  }

  const supports = detectClientSupports(intent.target);
  const basePlan = await buildInitExecutionPlan({
    target: intent.target,
    options: intent.options,
    mcpInstallMode: intent.mcpInstallMode,
    claudeMcpScope: intent.claudeMcpScope,
    interactive: intent.interactiveSummary && !intent.wizardEnabled,
    supports,
  });
  const plan = intent.wizardEnabled
    ? await resolveInitExecutionPlanWithWizard(basePlan, args, createDefaultInitWizardAdapter())
    : basePlan;

  if (plan === null) {
    writeStderr(t("cli.init.wizard.cancelled"));
    throw new Error(t("cli.init.wizard.cancelled"));
  }

  return executeInitExecutionPlan(plan);
}

function resolveInitCliIntent(args: InitArgs, targetInput: string): InitCliIntent {
  const target = normalizeTarget(targetInput);
  const mcpInstallMode = resolveMcpInstallMode(args["mcp-install"]);
  const claudeMcpScope = resolveClaudeMcpScope(args.scope);
  const terminalInteractive = isInteractiveInit();
  const planOnly = args.plan === true;
  const reapply = args.reapply === true;
  const options: InitOptions = {
    force: reapply ? true : args.force,
    skipBootstrap: args.bootstrap === false ? true : args.skipBootstrap,
    skipMcp: args.mcp === false ? true : args.skipMcp,
    skipHooks: args.hooks === false ? true : args.skipHooks,
    planOnly,
    reapply,
  };

  return {
    target,
    options,
    mcpInstallMode,
    claudeMcpScope,
    interactiveSummary: args.interactive !== false && terminalInteractive,
    wizardEnabled: shouldUseInitWizard(args, terminalInteractive) && !planOnly,
  };
}

function resolveClaudeMcpScope(raw: string | undefined): ClaudeMcpScope {
  if (raw === undefined || raw === "project") {
    return "project";
  }
  if (raw === "user") {
    return "user";
  }
  writeStderr(t("cli.init.mcp.scope.invalid", { value: raw }));
  return "project";
}

export async function buildInitExecutionPlan(input: {
  target: string;
  options?: InitOptions;
  mcpInstallMode?: McpInstallMode;
  claudeMcpScope?: ClaudeMcpScope;
  interactive?: boolean;
  supports?: DetectedClientSupport[];
}): Promise<InitExecutionPlan> {
  const options = input.options ?? {};
  const scaffold = await buildInitFabricPlan(input.target, options);
  const supports = input.supports ?? detectClientSupports(input.target);
  const mcpInstallMode = input.mcpInstallMode ?? "global";
  const claudeMcpScope: ClaudeMcpScope = input.claudeMcpScope ?? "project";
  const stages: InitStagePlan[] = [
    { name: "bootstrap", skipped: Boolean(options.skipBootstrap) },
    {
      name: "mcp",
      skipped: Boolean(options.skipMcp),
      installMode: mcpInstallMode,
      claudeMcpScope,
      localServerPath: mcpInstallMode === "local" ? LOCAL_FABRIC_SERVER_PATH : undefined,
      packageManager: mcpInstallMode === "local" ? detectPackageManager(input.target) : undefined,
    },
    { name: "hooks", skipped: Boolean(options.skipHooks) },
  ];

  return {
    target: input.target,
    options,
    mcpInstallMode,
    claudeMcpScope,
    interactive: input.interactive ?? false,
    supports,
    scaffold,
    stages,
    steps: [
      { name: "preflight" },
      { name: "scaffold" },
      ...stages.map((stage) => ({ name: stage.name, skipped: stage.skipped }) as InitExecutionStep),
      { name: "post-setup" },
    ],
  };
}

export async function executeInitExecutionPlan(plan: InitExecutionPlan): Promise<InitExecutionResult> {
  if (plan.options.force) {
    writeStderr(t("cli.init.force.warning", { path: plan.target }));
  }

  if (plan.options.reapply && !plan.options.planOnly && !plan.interactive) {
    writeStderr(formatInitModeBanner(plan.options));
  }

  if (plan.interactive) {
    printInitPlanSummary(plan.target, plan.options, plan.mcpInstallMode, plan.supports);
  }

  if (plan.options.planOnly) {
    printInitPlanPreview(plan);
    return {
      plan,
      created: buildPlanOnlyScaffoldResult(plan.scaffold),
      stageResults: plan.stages.map((stage) => ({ name: stage.name, disposition: "skipped" })),
      finalSupports: plan.supports,
    };
  }

  let created: InitScaffoldResult | null = null;
  const stageResults: InitStageRecord[] = [];
  let finalSupports = plan.supports;

  for (const step of plan.steps) {
    switch (step.name) {
      case "preflight":
        break;
      case "scaffold":
        created = await executeInitFabricPlan(plan.scaffold);
        printInitScaffoldResult(created);
        break;
      case "bootstrap":
      case "mcp":
      case "hooks":
        stageResults.push(await executeInitStagePlan(plan, step.name));
        break;
      case "post-setup":
        finalSupports = detectClientSupports(plan.target);
        printInitPostSetup(plan, stageResults, finalSupports);
        break;
      default:
        exhaustiveInitExecutionStep(step);
    }
  }

  return {
    plan,
    created: created ?? unreachableInitScaffold(),
    stageResults,
    finalSupports,
  };
}

export async function buildInitFabricPlan(target: string, options?: InitOptions): Promise<InitScaffoldPlan> {
  assertExistingDirectory(target);

  const fabricDir = join(target, ".fabric");
  const bootstrapPath = join(fabricDir, "bootstrap", "README.md");
  const forensicPath = join(fabricDir, "forensic.json");
  const taxonomyPath = join(fabricDir, "INITIAL_TAXONOMY.md");
  const rulesDir = join(fabricDir, "rules");
  const eventsPath = join(fabricDir, "events.jsonl");
  const claudeSkillPath = join(target, ".claude", "skills", "agents-md-init", "SKILL.md");
  const codexSkillPath = join(target, ".agents", "skills", "fabric-init", "SKILL.md");
  const codexSessionStartHookPath = join(target, ".codex", "hooks", "fabric-session-start.cjs");
  const codexStopHookPath = join(target, ".codex", "hooks", "fabric-stop-reminder.cjs");
  const codexHooksConfigPath = join(target, ".codex", "hooks.json");
  const claudeHookPath = join(target, ".claude", "hooks", "agents-md-init-reminder.cjs");
  const claudeSettingsPath = join(target, ".claude", "settings.json");
  const metaPath = join(fabricDir, "agents.meta.json");

  const replaceFabricDir = shouldReplaceWritableDirectory(fabricDir, options);
  const bootstrapAction = planFreshPath(bootstrapPath, options);
  const metaAction = planFreshPath(metaPath, options);
  const taxonomyAction = planFreshPath(taxonomyPath, options);
  const eventsAction = planFreshPath(eventsPath, options);
  const forensicAction = planFreshPath(forensicPath, options);

  const forensicReport = await buildForensicReport(target);
  const bootstrapContent = await buildFabricBootstrapGuide(target);
  const taxonomyContent = buildInitialTaxonomyMarkdown(forensicReport);
  const bootstrapHash = sha256(bootstrapContent);
  const meta = createInitialMeta(bootstrapHash);

  return {
    target,
    options,
    fabricDir,
    replaceFabricDir,
    bootstrapPath,
    bootstrapAction,
    bootstrapContent,
    metaPath,
    metaAction,
    meta,
    taxonomyPath,
    taxonomyAction,
    taxonomyContent,
    rulesDir,
    eventsPath,
    eventsAction,
    forensicPath,
    forensicAction,
    forensicReport,
    claudeSkill: buildOptionalTemplateWritePlan(claudeSkillPath, findTemplatePath(CLAUDE_INIT_SKILL_TEMPLATE), options),
    codexSkill: buildOptionalTemplateWritePlan(codexSkillPath, findTemplatePath(CODEX_INIT_SKILL_TEMPLATE), options),
    codexSessionStartHook: buildOptionalTemplateWritePlan(
      codexSessionStartHookPath,
      findTemplatePath(CODEX_SESSION_START_HOOK_TEMPLATE),
      options,
      true,
    ),
    codexStopHook: buildOptionalTemplateWritePlan(
      codexStopHookPath,
      findTemplatePath(CODEX_STOP_HOOK_TEMPLATE),
      options,
      true,
    ),
    codexHooksConfig: buildCodexHooksConfigPlan(codexHooksConfigPath, options),
    claudeHook: buildOptionalTemplateWritePlan(
      claudeHookPath,
      findTemplatePath(CLAUDE_INIT_REMINDER_HOOK_TEMPLATE),
      options,
      true,
    ),
    claudeSettings: buildClaudeSettingsWritePlan(claudeSettingsPath, options),
  };
}

export async function executeInitFabricPlan(plan: InitScaffoldPlan): Promise<InitScaffoldResult> {
  const isReapply = plan.options?.reapply === true;

  // Determine rules presence before any writes (needed for Change B and ledger event).
  const existingRules = isReapply && existsSync(plan.rulesDir)
    ? readdirSync(plan.rulesDir).filter((f) => f.endsWith(".md"))
    : [];
  const preserveMeta = isReapply && existingRules.length > 0;

  if (plan.replaceFabricDir) {
    rmSync(plan.fabricDir, { force: true });
  }

  mkdirSync(plan.fabricDir, { recursive: true });
  mkdirSync(dirname(plan.bootstrapPath), { recursive: true });

  preparePlannedPath(plan.bootstrapPath, plan.bootstrapAction);
  writeFileSync(plan.bootstrapPath, plan.bootstrapContent, "utf8");

  // Change B: skip agents.meta.json regen when --reapply and rules/*.md already exist.
  if (!preserveMeta) {
    preparePlannedPath(plan.metaPath, plan.metaAction);
    writeFileSync(plan.metaPath, `${JSON.stringify(plan.meta, null, 2)}\n`, "utf8");
  }

  preparePlannedPath(plan.taxonomyPath, plan.taxonomyAction);
  writeFileSync(plan.taxonomyPath, ensureTrailingNewline(plan.taxonomyContent), "utf8");

  mkdirSync(plan.rulesDir, { recursive: true });

  // Change A: on --reapply, preserve events.jsonl byte-identically; only create it if missing.
  if (isReapply) {
    if (!existsSync(plan.eventsPath)) {
      mkdirSync(dirname(plan.eventsPath), { recursive: true });
      writeFileSync(plan.eventsPath, "", "utf8");
    }
    // Existing file content is intentionally left untouched — no truncation.
  } else {
    preparePlannedPath(plan.eventsPath, plan.eventsAction);
    writeFileSync(plan.eventsPath, "", "utf8");
  }

  preparePlannedPath(plan.forensicPath, plan.forensicAction);
  writeFileSync(plan.forensicPath, `${JSON.stringify(plan.forensicReport, null, 2)}\n`, "utf8");

  applyOptionalTemplateWritePlan(plan.claudeSkill);
  applyOptionalTemplateWritePlan(plan.codexSkill);
  applyOptionalTemplateWritePlan(plan.codexSessionStartHook);
  applyOptionalTemplateWritePlan(plan.codexStopHook);
  await applyJsonWritePlan(plan.codexHooksConfig);
  applyOptionalTemplateWritePlan(plan.claudeHook);
  await applyClaudeSettingsWritePlan(plan.claudeSettings);

  // Change C: append reapply_completed ledger event after successful --reapply.
  if (isReapply) {
    appendReapplyLedgerEvent(plan.eventsPath, {
      preserved_ledger: true,
      preserved_meta: preserveMeta,
      rules_count: existingRules.length,
    });
  }

  return {
    bootstrapPath: plan.bootstrapPath,
    bootstrapAction: plan.bootstrapAction,
    metaPath: plan.metaPath,
    metaAction: plan.metaAction,
    taxonomyPath: plan.taxonomyPath,
    taxonomyAction: plan.taxonomyAction,
    eventsPath: plan.eventsPath,
    eventsAction: plan.eventsAction,
    forensicPath: plan.forensicPath,
    forensicAction: plan.forensicAction,
    claudeSkillPath: plan.claudeSkill.path,
    claudeSkillAction: plan.claudeSkill.action,
    codexSkillPath: plan.codexSkill.path,
    codexSkillAction: plan.codexSkill.action,
    codexSessionStartHookPath: plan.codexSessionStartHook.path,
    codexSessionStartHookAction: plan.codexSessionStartHook.action,
    codexStopHookPath: plan.codexStopHook.path,
    codexStopHookAction: plan.codexStopHook.action,
    codexHooksConfigPath: plan.codexHooksConfig.path,
    codexHooksConfigAction: plan.codexHooksConfig.action,
    claudeHookPath: plan.claudeHook.path,
    claudeHookAction: plan.claudeHook.action,
    claudeSettingsPath: plan.claudeSettings.path,
    claudeSettingsAction: plan.claudeSettings.action,
  };
}

export async function initFabric(target: string, options?: InitOptions): Promise<InitScaffoldResult> {
  return await executeInitFabricPlan(await buildInitFabricPlan(target, options));
}

export function shouldUseInitWizard(
  args: Pick<InitArgs, "interactive" | "yes">,
  terminalInteractive = isInteractiveInit(),
): boolean {
  return terminalInteractive && args.interactive !== false && args.yes !== true;
}

export async function resolveInitExecutionPlanWithWizard(
  basePlan: InitExecutionPlan,
  args: Pick<InitArgs, "bootstrap" | "mcp" | "hooks">,
  wizardAdapter: InitWizardAdapter,
): Promise<InitExecutionPlan | null> {
  const selection = await wizardAdapter.run({
    target: basePlan.target,
    options: basePlan.options,
    supports: basePlan.supports,
    mcpInstallMode: basePlan.mcpInstallMode,
    claudeMcpScope: basePlan.claudeMcpScope,
    lockedStages: collectLockedWizardStages(args),
  });

  if (selection === null) {
    return null;
  }

  return buildInitExecutionPlan({
    target: basePlan.target,
    options: {
      ...basePlan.options,
      skipBootstrap: !selection.bootstrap,
      skipMcp: !selection.mcp,
      skipHooks: !selection.hooks,
    },
    mcpInstallMode: selection.mcp ? selection.mcpInstallMode : basePlan.mcpInstallMode,
    claudeMcpScope: selection.claudeMcpScope,
    interactive: false,
    supports: basePlan.supports,
  });
}

function unreachableInitScaffold(): never {
  throw new Error("Init scaffold step did not execute");
}

function exhaustiveInitExecutionStep(value: never): never {
  throw new Error(`Unsupported init execution step: ${JSON.stringify(value)}`);
}

function exhaustiveInitStagePlan(value: never): never {
  throw new Error(`Unsupported init stage plan: ${JSON.stringify(value)}`);
}

function printInitScaffoldResult(created: InitScaffoldResult): void {
  console.log(formatInitPathAction(created.bootstrapPath, created.bootstrapAction));
  console.log(formatInitPathAction(created.metaPath, created.metaAction));
  console.log(formatInitPathAction(created.taxonomyPath, created.taxonomyAction));
  console.log(formatInitPathAction(created.eventsPath, created.eventsAction));
  console.log(formatInitPathAction(created.forensicPath, created.forensicAction));
  writeStderr(formatOptionalInitPathAction(created.claudeSkillPath, created.claudeSkillAction));
  writeStderr(formatOptionalInitPathAction(created.codexSkillPath, created.codexSkillAction));
  writeStderr(
    formatOptionalInitPathAction(created.codexSessionStartHookPath, created.codexSessionStartHookAction),
  );
  writeStderr(
    formatOptionalInitPathAction(created.codexStopHookPath, created.codexStopHookAction),
  );
  writeStderr(formatCodexHooksAction(created.codexHooksConfigPath, created.codexHooksConfigAction));
  writeStderr(formatOptionalInitPathAction(created.claudeHookPath, created.claudeHookAction));
  writeStderr(formatClaudeSettingsAction(created.claudeSettingsPath, created.claudeSettingsAction));
}

function printInitPostSetup(
  plan: InitExecutionPlan,
  stageResults: InitStageRecord[],
  finalSupports: DetectedClientSupport[],
): void {
  if (shouldPrintHooksNextStep(plan.options, stageResults)) {
    console.log(
      t("cli.init.next-step", {
        label: nextLabel(),
        message: paint.muted(t("cli.init.next-step.message")),
      }),
    );
  }

  console.log(
    t("cli.init.reason-message", {
      label: reasonLabel(),
      message: paint.muted(formatInitReasonMessage(finalSupports)),
    }),
  );
  printInitStageSummary(stageResults);
  printInitCapabilitySummary(finalSupports, stageResults, plan.options);
}

function printInitPlanPreview(plan: InitExecutionPlan): void {
  console.log(t("cli.init.plan.preview-title"));
  printInitPlanSummary(plan.target, plan.options, plan.mcpInstallMode, plan.supports);
  console.log(
    t("cli.init.plan.preview-result", {
      mode: plan.options.reapply ? t("cli.init.mode.reapply") : t("cli.init.mode.default"),
      bootstrap: yesNoLabel(!plan.options.skipBootstrap),
      mcp: yesNoLabel(!plan.options.skipMcp),
      hooks: yesNoLabel(!plan.options.skipHooks),
    }),
  );
}

function buildPlanOnlyScaffoldResult(plan: InitScaffoldPlan): InitScaffoldResult {
  return {
    bootstrapPath: plan.bootstrapPath,
    bootstrapAction: plan.bootstrapAction,
    metaPath: plan.metaPath,
    metaAction: plan.metaAction,
    taxonomyPath: plan.taxonomyPath,
    taxonomyAction: plan.taxonomyAction,
    eventsPath: plan.eventsPath,
    eventsAction: plan.eventsAction,
    forensicPath: plan.forensicPath,
    forensicAction: plan.forensicAction,
    claudeSkillPath: plan.claudeSkill.path,
    claudeSkillAction: plan.claudeSkill.action,
    codexSkillPath: plan.codexSkill.path,
    codexSkillAction: plan.codexSkill.action,
    codexSessionStartHookPath: plan.codexSessionStartHook.path,
    codexSessionStartHookAction: plan.codexSessionStartHook.action,
    codexStopHookPath: plan.codexStopHook.path,
    codexStopHookAction: plan.codexStopHook.action,
    codexHooksConfigPath: plan.codexHooksConfig.path,
    codexHooksConfigAction: plan.codexHooksConfig.action,
    claudeHookPath: plan.claudeHook.path,
    claudeHookAction: plan.claudeHook.action,
    claudeSettingsPath: plan.claudeSettings.path,
    claudeSettingsAction: plan.claudeSettings.action,
  };
}

async function executeInitStagePlan(
  plan: InitExecutionPlan,
  stageName: InitStageName,
): Promise<InitStageRecord> {
  const stage = plan.stages.find((entry) => entry.name === stageName);
  if (stage === undefined) {
    throw new Error(`Missing init stage plan: ${stageName}`);
  }

  if (stage.skipped) {
    return { name: stageName, disposition: "skipped" };
  }

  console.log(formatInitStageHeader(t(`cli.init.stages.${stageName}`)));

  try {
    switch (stage.name) {
      case "bootstrap": {
        const result = await installBootstrap(plan.target, { force: plan.options.force });
        if (result.details.length === 0) {
          console.log(formatInitStageResult("bootstrap", "skipped", 0, 0, t("cli.bootstrap.install.no-targets")));
          return { name: "bootstrap", disposition: "skipped" };
        }

        console.log(
          formatInitStageResult("bootstrap", "completed", result.installed.length, result.skipped.length),
        );
        return { name: "bootstrap", disposition: "ran" };
      }
      case "mcp": {
        if (stage.installMode === "local") {
          const manager = stage.packageManager ?? detectPackageManager(plan.target);
          writeStderr(t("cli.init.mcp.install.local"));
          writeStderr(t("cli.init.mcp.local.installing", { manager }));
          installLocalFabricServer(plan.target, manager);
          writeStderr(t("cli.init.mcp.local.installed"));
        } else {
          writeStderr(t("cli.init.mcp.install.global"));
        }

        const result = await configCommand.installMcpClients(plan.target, {
          force: plan.options.force,
          localServerPath: stage.localServerPath,
          claudeMcpScope: stage.claudeMcpScope,
        });
        if (result.details.length === 0) {
          console.log(formatInitStageResult("mcp", "skipped", 0, 0, t("cli.config.install.no-configs")));
          return { name: "mcp", disposition: "skipped" };
        }

        console.log(formatInitStageResult("mcp", "completed", result.installed.length, result.skipped.length));
        return { name: "mcp", disposition: "ran" };
      }
      case "hooks": {
        const result = await installHooks(plan.target, { force: plan.options.force });
        console.log(formatInitStageResult("hooks", "completed", result.installed.length, result.skipped.length));
        return { name: "hooks", disposition: "ran" };
      }
      default:
        return exhaustiveInitStagePlan(stage);
    }
  } catch (error: unknown) {
    writeStderr(formatInitStageFailure(stageName, error));
    return { name: stageName, disposition: "failed" };
  }
}

function shouldReplaceWritableDirectory(path: string, options?: InitOptions): boolean {
  if (!existsSync(path)) {
    return false;
  }

  if (statSync(path).isDirectory()) {
    return false;
  }

  if (!options?.force) {
    throw new Error(t("cli.init.errors.abort-existing", { path }));
  }

  return true;
}

function planFreshPath(path: string, options?: InitOptions): InitWriteAction {
  if (!existsSync(path)) {
    return "created";
  }

  if (!options?.force) {
    throw new Error(t("cli.init.errors.abort-existing", { path }));
  }

  return "overwritten";
}

function preparePlannedPath(path: string, action: InitWriteAction): void {
  mkdirSync(dirname(path), { recursive: true });
  if (action === "overwritten" && existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function buildOptionalTemplateWritePlan(
  path: string,
  templatePath: string,
  options?: InitOptions,
  executable = false,
): InitOptionalTemplateWritePlan {
  const existed = existsSync(path);
  if (existed && !options?.force) {
    return { path, action: "skipped", templatePath, executable };
  }

  return {
    path,
    action: existed ? "overwritten" : "created",
    templatePath,
    executable,
  };
}

function applyOptionalTemplateWritePlan(plan: InitOptionalTemplateWritePlan): void {
  if (plan.action === "skipped") {
    return;
  }

  mkdirSync(dirname(plan.path), { recursive: true });
  copyFileSync(plan.templatePath, plan.path);
  if (plan.executable) {
    chmodSync(plan.path, 0o755);
  }
}

function buildCodexHooksConfigValue(): CodexHooksConfig {
  return {
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
}

function buildCodexHooksConfigPlan(configPath: string, options?: InitOptions): InitJsonWritePlan {
  const action = !existsSync(configPath)
    ? "created"
    : options?.force
      ? "overwritten"
      : "skipped";

  return {
    path: configPath,
    action,
    value: buildCodexHooksConfigValue(),
  };
}

async function applyJsonWritePlan(plan: InitJsonWritePlan): Promise<void> {
  if (plan.action === "skipped") {
    return;
  }

  mkdirSync(dirname(plan.path), { recursive: true });
  await atomicWriteJson(plan.path, plan.value);
}

function buildClaudeSettingsWritePlan(settingsPath: string, options?: InitOptions): InitClaudeSettingsWritePlan {
  let settings: ClaudeSettings;
  let action: Extract<ClaudeSettingsAction, "created" | "updated" | "overwritten"> = "updated";

  if (!existsSync(settingsPath)) {
    settings = {};
    action = "created";
  } else {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
      if (!isRecord(parsed)) {
        writeStderr(t("cli.init.claude-settings.invalid-object", { label: skippedLabel(), path: settingsPath }));
        return { path: settingsPath, action: "skipped-invalid", value: null };
      }

      settings = parsed as ClaudeSettings;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown parse error";
      writeStderr(t("cli.init.claude-settings.invalid-json", { label: skippedLabel(), path: settingsPath, reason }));
      return { path: settingsPath, action: "skipped-invalid", value: null };
    }
  }

  if (settings.hooks !== undefined && !isRecord(settings.hooks)) {
    writeStderr(t("cli.init.claude-settings.invalid-hooks", { label: skippedLabel(), path: settingsPath }));
    return { path: settingsPath, action: "skipped-invalid", value: null };
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const stopHooksValue = hooks.Stop;
  if (stopHooksValue !== undefined && !Array.isArray(stopHooksValue)) {
    writeStderr(t("cli.init.claude-settings.invalid-stop-array", { label: skippedLabel(), path: settingsPath }));
    return { path: settingsPath, action: "skipped-invalid", value: null };
  }

  const stopHooks = Array.isArray(stopHooksValue) ? stopHooksValue : [];
  const hasExistingFabricHook = hasClaudeInitReminderHook(stopHooks);
  if (hasExistingFabricHook && !options?.force) {
    return { path: settingsPath, action: "skipped", value: null };
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

  const nextSettings: ClaudeSettings = {
    ...settings,
    hooks: {
      ...hooks,
      Stop: nextStopHooks as ClaudeStopHookEntry[],
    },
  };

  return {
    path: settingsPath,
    action: hasExistingFabricHook && options?.force ? "overwritten" : action,
    value: nextSettings,
  };
}

async function applyClaudeSettingsWritePlan(plan: InitClaudeSettingsWritePlan): Promise<void> {
  if (plan.value === null) {
    return;
  }

  mkdirSync(dirname(plan.path), { recursive: true });
  await atomicWriteJson(plan.path, plan.value);
}

export function createDefaultInitWizardAdapter(): InitWizardAdapter {
  return {
    async run(context) {
      intro(t("cli.init.wizard.intro"));
      note(
        t("cli.init.wizard.overview.body", {
          target: context.target,
          mode: formatInitModeBadge(context.options),
        }),
        t("cli.init.wizard.overview.title"),
      );
      printInitPlanSummary(context.target, context.options, context.mcpInstallMode, context.supports);

      log.step(t("cli.init.wizard.step.target"));
      const continueWithTarget = await confirm({
        message: t("cli.init.wizard.target.confirm", { target: context.target }),
        initialValue: true,
      });
      if (isCancel(continueWithTarget) || !continueWithTarget) {
        emitInitWizardCancellation();
        return null;
      }

      log.step(t("cli.init.wizard.step.plan"));
      let groupedSelection: InitWizardSelection;
      try {
        groupedSelection = await group<InitWizardSelection>(
          {
            bootstrap: async () =>
              context.lockedStages.includes("bootstrap")
                ? false
                : confirmInGroup({
                  message: t("cli.init.wizard.stage.bootstrap", {
                    defaultValue: formatPromptDefault(!context.options.skipBootstrap),
                  }),
                  initialValue: !context.options.skipBootstrap,
                }),
            mcp: async () =>
              context.lockedStages.includes("mcp")
                ? false
                : confirmInGroup({
                  message: t("cli.init.wizard.stage.mcp", {
                    defaultValue: formatPromptDefault(!context.options.skipMcp),
                  }),
                  initialValue: !context.options.skipMcp,
                }),
            mcpInstallMode: async ({ results }) =>
              results.mcp
                ? selectMcpInstallModeInGroup({
                  message: t("cli.init.wizard.mcp-install", { defaultValue: context.mcpInstallMode }),
                  initialValue: context.mcpInstallMode,
                  options: [
                    { value: "global", label: "global", hint: t("cli.init.mcp.install.global") },
                    { value: "local", label: "local", hint: t("cli.init.mcp.install.local") },
                  ],
                })
                : context.mcpInstallMode,
            claudeMcpScope: async ({ results }) =>
              results.mcp
                ? selectClaudeMcpScopeInGroup({
                  message: t("cli.init.wizard.mcp-scope", { defaultValue: context.claudeMcpScope }),
                  initialValue: context.claudeMcpScope,
                  options: [
                    { value: "project" as ClaudeMcpScope, label: "project", hint: t("cli.init.mcp.scope.project") },
                    { value: "user" as ClaudeMcpScope, label: "user", hint: t("cli.init.mcp.scope.user") },
                  ],
                })
                : context.claudeMcpScope,
            hooks: async () =>
              context.lockedStages.includes("hooks")
                ? false
                : confirmInGroup({
                  message: t("cli.init.wizard.stage.hooks", {
                    defaultValue: formatPromptDefault(!context.options.skipHooks),
                  }),
                  initialValue: !context.options.skipHooks,
                }),
          },
          {
            onCancel() {
              throw INIT_WIZARD_GROUP_CANCELLED;
            },
          },
        );
      } catch (error) {
        if (error === INIT_WIZARD_GROUP_CANCELLED) {
          emitInitWizardCancellation();
          return null;
        }

        throw error;
      }

      if (groupedSelection === null) {
        emitInitWizardCancellation();
        return null;
      }

      const previewOptions: InitOptions = {
        ...context.options,
        skipBootstrap: !groupedSelection.bootstrap,
        skipMcp: !groupedSelection.mcp,
        skipHooks: !groupedSelection.hooks,
      };
      log.step(t("cli.init.wizard.step.review"));
      printInitPlanSummary(context.target, previewOptions, groupedSelection.mcpInstallMode, context.supports);

      const confirmed = await confirm({
        message: t("cli.init.wizard.execute.confirm"),
        initialValue: true,
      });
      if (isCancel(confirmed) || !confirmed) {
        emitInitWizardCancellation();
        return null;
      }

      outro(t("cli.init.wizard.outro"));

      return groupedSelection;
    },
  };
}

function emitInitWizardCancellation(): void {
  cancel(t("cli.init.wizard.cancelled"));
}

async function confirmInGroup(options: { message: string; initialValue: boolean }): Promise<boolean> {
  const result = await confirm(options);
  if (isCancel(result)) {
    throw INIT_WIZARD_GROUP_CANCELLED;
  }

  return result;
}

async function selectMcpInstallModeInGroup(options: {
  message: string;
  initialValue: McpInstallMode;
  options: Array<{ value: McpInstallMode; label?: string; hint?: string; disabled?: boolean }>;
}): Promise<McpInstallMode> {
  const result = await select({
    message: options.message,
    initialValue: options.initialValue,
    options: options.options,
  });

  if (isCancel(result)) {
    throw INIT_WIZARD_GROUP_CANCELLED;
  }

  return result;
}

async function selectClaudeMcpScopeInGroup(options: {
  message: string;
  initialValue: ClaudeMcpScope;
  options: Array<{ value: ClaudeMcpScope; label?: string; hint?: string; disabled?: boolean }>;
}): Promise<ClaudeMcpScope> {
  const result = await select({
    message: options.message,
    initialValue: options.initialValue,
    options: options.options,
  });

  if (isCancel(result)) {
    throw INIT_WIZARD_GROUP_CANCELLED;
  }

  return result;
}

function collectLockedWizardStages(args: Pick<InitArgs, "bootstrap" | "mcp" | "hooks">): InitStageName[] {
  const lockedStages: InitStageName[] = [];

  if (args.bootstrap === false) {
    lockedStages.push("bootstrap");
  }

  if (args.mcp === false) {
    lockedStages.push("mcp");
  }

  if (args.hooks === false) {
    lockedStages.push("hooks");
  }

  return lockedStages;
}

function formatPromptDefault(value: boolean): string {
  return value ? "Y/n" : "y/N";
}

function formatInitModeBanner(options: InitOptions): string {
  if (options.planOnly && options.reapply) {
    return t("cli.init.plan.mode-banner.plan-reapply");
  }

  if (options.planOnly) {
    return t("cli.init.plan.mode-banner.plan");
  }

  if (options.reapply) {
    return t("cli.init.plan.mode-banner.reapply");
  }

  return t("cli.init.plan.mode-banner.default");
}

function formatInitModeBadge(options: InitOptions): string {
  if (options.planOnly && options.reapply) {
    return t("cli.init.mode.badge.plan-reapply");
  }

  if (options.planOnly) {
    return t("cli.init.mode.badge.plan");
  }

  if (options.reapply) {
    return t("cli.init.mode.badge.reapply");
  }

  return t("cli.init.mode.badge.default");
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

function appendReapplyLedgerEvent(
  eventsPath: string,
  payload: { preserved_ledger: boolean; preserved_meta: boolean; rules_count: number },
): void {
  const event = {
    kind: "fabric-event",
    id: `event:${randomUUID()}`,
    ts: Date.now(),
    schema_version: 1,
    event_type: "reapply_completed",
    preserved_ledger: payload.preserved_ledger,
    preserved_meta: payload.preserved_meta,
    rules_count: payload.rules_count,
  };
  const line = `${JSON.stringify(event)}\n`;
  appendFileSync(eventsPath, line, "utf8");
}

function buildInitialTaxonomyMarkdown(
  forensicReport: Awaited<ReturnType<typeof buildForensicReport>>,
): string {
  const frameworkInfo = forensicReport.framework;
  const framework = [frameworkInfo?.kind ?? "unknown", frameworkInfo?.subkind ?? ""]
    .filter((value) => value.trim() !== "")
    .join(" / ") || "unknown";
  const keyDirs = forensicReport.topology?.key_dirs?.slice(0, 8) ?? [];
  const candidateFiles = forensicReport.candidate_files?.slice(0, 8) ?? [];
  const generatedAt = forensicReport.generated_at ?? new Date().toISOString();

  return `# Fabric Initial Taxonomy

**Date**: ${generatedAt}
**Base Architecture**: L0/L1/L2 Tiered System
**Detected Framework**: ${framework}

## Origin Logic

- **L0 判定**: 全局协作稳定性规则。典型来源包括仓库根配置、package metadata、Fabric 内部协议和不可随局部业务漂移的约束。
- **L1 判定**: 领域/模块级规则。依据技术栈、目录职责、框架特征和功能模块划分，而不是路径深度。
- **L2 判定**: 具体脚本、资源或局部业务状态规则。用于承载特定文件、资源、历史补丁和局部处理细则。

## Initial L1 Buckets

${formatInitialL1Buckets(keyDirs)}

## L2 Candidate Signals

${formatInitialL2Signals(candidateFiles)}

## Evolution Guide

- 涉及全仓协作稳定性的规则进入 L0。
- 涉及技术领域、框架模块或功能模块的规则进入 L1。
- 涉及具体文件、具体资源或局部业务状态的规则进入 L2。
- 冲突时执行解释固定为 L2 > L1 > L0；同层内才使用 priority 排序。
`;
}

function formatInitialL1Buckets(keyDirs: string[]): string {
  if (keyDirs.length === 0) {
    return "- **L1-General**: 初始化时未检测到稳定目录轴线，后续依据技术栈和模块职责演进。";
  }

  return keyDirs
    .map((dir) => `- **L1-${sanitizeTaxonomyLabel(dir)}**: 挂载依据——forensic topology detected \`${dir}\`.`)
    .join("\n");
}

function formatInitialL2Signals(candidateFiles: Awaited<ReturnType<typeof buildForensicReport>>["candidate_files"]): string {
  if (candidateFiles.length === 0) {
    return "- 暂未识别明确 L2 候选文件。";
  }

  return candidateFiles
    .map((entry) => `- \`${entry.path}\`: ${entry.family} — ${entry.rationale}`)
    .join("\n");
}

function sanitizeTaxonomyLabel(value: string): string {
  const sanitized = value
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return sanitized === "" ? "General" : sanitized;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
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
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
}

function printInitPlanSummary(
  target: string,
  options: InitOptions,
  mcpInstallMode: McpInstallMode,
  supports: DetectedClientSupport[],
): void {
  console.log(t("cli.init.plan.title"));
  console.log(formatInitModeBanner(options));
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
  console.log(`  - ${target}/.fabric/INITIAL_TAXONOMY.md`);
  console.log(`  - ${target}/.fabric/events.jsonl`);
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
