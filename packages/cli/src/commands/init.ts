import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import * as childProcess from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { cancel, confirm, group, intro, isCancel, log, note, outro, select } from "@clack/prompts";
import { defaultAgentsMetaCounters, type AgentsMeta } from "@fenglimg/fabric-shared";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { defineCommand } from "citty";
import { checkLockOrThrow } from "@fenglimg/fabric-server";

import { displayWidth, paint, padEnd } from "../colors.js";
import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import type { ClaudeMcpScope } from "../config/json.js";
import { t } from "../i18n.js";
import * as configCommand from "./config.js";
import { installHooks } from "./hooks.js";
import { runInitScan } from "./scan.js";
import { buildForensicReport } from "../scanner/forensic.js";
import { detectClientSupports, type DetectedClientSupport } from "../config/resolver.js";
import {
  addArchiveSkillPointer,
  installArchiveHintHook,
  installFabricArchiveSkill,
  installFabricImportSkill,
  installFabricReviewSkill,
  mergeClaudeCodeHookConfig,
  mergeCodexHookConfig,
  type InstallStepResult,
} from "../install/skills-and-hooks.js";

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

// v2.0 follow-up (rc.1 fix #1): AGENTS.md at the repo root is the universal
// MCP-agnostic bootstrap anchor. Cursor, Codex CLI, and Claude Code all read
// it; doctor's `bootstrap_anchor_missing` check requires either AGENTS.md or
// CLAUDE.md to be present. We write a minimal default on a fresh init and
// PRESERVE any pre-existing file verbatim — even with --force. The intent
// is "anchor exists" rather than "anchor is canonical"; once the user has
// customized the file (typically through their AI client flow), init must
// never clobber that work.
type AgentsMdAction = "created" | "preserved";

type ClaudeHookAction = InitWriteAction | "skipped";

type InitStageName = "bootstrap" | "mcp" | "hooks";

type InitStageDisposition = "ran" | "skipped" | "failed";

type InitStageRecord = {
  name: InitStageName;
  disposition: InitStageDisposition;
};

export type InitScaffoldResult = {
  // v2.0 layout: knowledge subdirs (.gitkeep markers) + agents.meta.json
  // (counters envelope) + events.jsonl + forensic.json. Knowledge entries
  // are created by the scan stage. AGENTS.md is also written at the repo
  // root as the universal anchor (idempotent on re-run).
  agentsMdPath: string;
  agentsMdAction: AgentsMdAction;
  knowledgeDir: string;
  knowledgeDirAction: InitWriteAction;
  personalKnowledgeDir: string;
  metaPath: string;
  metaAction: InitWriteAction;
  eventsPath: string;
  eventsAction: InitWriteAction;
  forensicPath: string;
  forensicAction: InitWriteAction;
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

export type InitScaffoldPlan = {
  target: string;
  options?: InitOptions;
  fabricDir: string;
  replaceFabricDir: boolean;
  // v2.0 follow-up (rc.1 fix #1): repo-root AGENTS.md anchor. Written
  // idempotently — pre-existing content is always preserved. See
  // AgentsMdAction comment above for rationale.
  agentsMdPath: string;
  agentsMdAction: AgentsMdAction;
  // v2.0 knowledge layout (team root): .fabric/knowledge/{decisions,pitfalls,
  // guidelines,models,processes,pending}/. The personal root mirrors the same
  // subdirs under ~/.fabric/knowledge/ (overridable via FABRIC_HOME).
  knowledgeDir: string;
  knowledgeDirAction: InitWriteAction;
  personalKnowledgeDir: string;
  metaPath: string;
  metaAction: InitWriteAction;
  meta: AgentsMeta;
  eventsPath: string;
  eventsAction: InitWriteAction;
  forensicPath: string;
  forensicAction: InitWriteAction;
  forensicReport: Awaited<ReturnType<typeof buildForensicReport>>;
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

// v2.0 follow-up (rc.1 fix #1): minimal default contents for the repo-root
// AGENTS.md anchor. Kept deliberately short — the user (or their AI client)
// expands the file with project-specific sections post-init. The CLI's job
// is only to ensure SOME anchor exists post-init so doctor's
// bootstrap_anchor_missing check is clean.
//
// AGENTS.md (rather than CLAUDE.md) was chosen because it is the universal
// MCP-agnostic format: Cursor, Codex CLI, and Claude Code all read it.
// Claude Code in particular treats AGENTS.md as a fallback when CLAUDE.md
// is absent, so this single file unblocks all three supported clients.
const AGENTS_MD_DEFAULT_CONTENT = `# Project Knowledge

This project uses [Fabric](https://github.com/fenglimg/fabric) for cross-client AI knowledge management.

Knowledge entries live in \`.fabric/knowledge/\` (team) and \`~/.fabric/knowledge/\` (personal).
Run \`fabric doctor\` to verify state.

See \`.fabric/knowledge/\` for project decisions, pitfalls, guidelines, models, and processes.
`;

// v2/rc.2: The v1 client-side init skill (and its reminder hooks for Claude
// / Codex) was removed. rc.2/3/4 will introduce v2 skills (fabric-archive,
// fabric-review, fabric-import) with their own templates and wiring; until
// then `fab init` only emits MCP-agnostic state (knowledge dirs, AGENTS.md,
// forensic.json, events.jsonl).
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

export async function runInitCommand(args: InitArgs): Promise<InitExecutionResult | void> {
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
    process.exitCode = 130;
    return;
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

// v2.0 knowledge subdirs (team + personal). The list is shared with rule-meta
// and doctor; mirrored here to keep init dependency-free.
const KNOWLEDGE_SUBDIRS = ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"] as const;

function resolvePersonalFabricRoot(): string {
  return process.env.FABRIC_HOME ?? homedir();
}

export async function buildInitFabricPlan(target: string, options?: InitOptions): Promise<InitScaffoldPlan> {
  assertExistingDirectory(target);

  const fabricDir = join(target, ".fabric");
  const agentsMdPath = join(target, "AGENTS.md");
  // v2.0 follow-up (rc.1 fix #1): AGENTS.md write is always idempotent —
  // we write the default only when the file is absent and never overwrite
  // existing content (even with --force). Capturing the action up front
  // keeps the result schema deterministic for callers/tests.
  const agentsMdAction: AgentsMdAction = existsSync(agentsMdPath) ? "preserved" : "created";
  const knowledgeDir = join(fabricDir, "knowledge");
  const personalKnowledgeDir = join(resolvePersonalFabricRoot(), ".fabric", "knowledge");
  const forensicPath = join(fabricDir, "forensic.json");
  const eventsPath = join(fabricDir, "events.jsonl");
  const metaPath = join(fabricDir, "agents.meta.json");

  const replaceFabricDir = shouldReplaceWritableDirectory(fabricDir, options);
  const knowledgeDirAction: InitWriteAction = existsSync(knowledgeDir) ? "overwritten" : "created";
  const metaAction = planFreshPath(metaPath, options);
  const eventsAction = planFreshPath(eventsPath, options);
  const forensicAction = planFreshPath(forensicPath, options);

  const forensicReport = await buildForensicReport(target);
  const meta = createInitialMeta();

  return {
    target,
    options,
    fabricDir,
    replaceFabricDir,
    agentsMdPath,
    agentsMdAction,
    knowledgeDir,
    knowledgeDirAction,
    personalKnowledgeDir,
    metaPath,
    metaAction,
    meta,
    eventsPath,
    eventsAction,
    forensicPath,
    forensicAction,
    forensicReport,
  };
}

export async function executeInitFabricPlan(plan: InitScaffoldPlan): Promise<InitScaffoldResult> {
  const isReapply = plan.options?.reapply === true;

  if (plan.replaceFabricDir) {
    rmSync(plan.fabricDir, { force: true });
  }

  mkdirSync(plan.fabricDir, { recursive: true });

  // v2.0 follow-up (rc.1 fix #1): write the repo-root AGENTS.md anchor when
  // it does not already exist. This satisfies doctor's bootstrap_anchor_missing
  // check on a fresh init while remaining strictly idempotent — pre-existing
  // content is never overwritten, so user customizations survive `fab init
  // --reapply` and re-runs of `fab init`. Writing via atomicWriteText keeps
  // the half-written-file failure mode out of scope.
  if (plan.agentsMdAction === "created" && !existsSync(plan.agentsMdPath)) {
    await atomicWriteText(plan.agentsMdPath, AGENTS_MD_DEFAULT_CONTENT);
  }

  // v2.0 stage (a) bootstrap: materialize knowledge subdirs (team + personal)
  // with .gitkeep markers so a fresh repo carries the canonical layout even
  // before the first knowledge entry is added.
  mkdirSync(plan.knowledgeDir, { recursive: true });
  for (const sub of KNOWLEDGE_SUBDIRS) {
    const teamSubDir = join(plan.knowledgeDir, sub);
    mkdirSync(teamSubDir, { recursive: true });
    const teamGitkeep = join(teamSubDir, ".gitkeep");
    if (!existsSync(teamGitkeep)) {
      writeFileSync(teamGitkeep, "", "utf8");
    }
  }

  // Personal-root mirror — best-effort. A read-only home / unusual FABRIC_HOME
  // override must not block init; knowledge-meta-builder will retry the mkdir on
  // its first scan.
  try {
    mkdirSync(plan.personalKnowledgeDir, { recursive: true });
    for (const sub of KNOWLEDGE_SUBDIRS) {
      mkdirSync(join(plan.personalKnowledgeDir, sub), { recursive: true });
    }
  } catch {
    // Non-fatal — see comment above.
  }

  preparePlannedPath(plan.metaPath, plan.metaAction);
  await atomicWriteJson(plan.metaPath, plan.meta);

  // Change A: on --reapply, preserve events.jsonl byte-identically; only create it if missing.
  // 0-byte create stays raw — writeFileSync("", "") is atomic by definition.
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
  await atomicWriteJson(plan.forensicPath, plan.forensicReport);

  // v2.0 stage (b) scan: invoke runInitScan programmatically so a fresh init
  // produces 4-7 baseline knowledge entries + an init_scan_completed ledger
  // event. Failure is best-effort (e.g. a read-only home) — the layout above
  // is already complete and `fab scan` can be re-run to populate entries.
  if (!plan.options?.reapply) {
    try {
      await runInitScan(plan.target, { source: "init" });
    } catch (error: unknown) {
      writeStderr(
        `[warn] init-scan failed: ${error instanceof Error ? error.message : String(error)} — re-run \`fab scan\` to populate baseline knowledge entries.`,
      );
    }
  }

  // Change C: append reapply_completed ledger event after successful --reapply.
  if (isReapply) {
    appendReapplyLedgerEvent(plan.eventsPath, {
      preserved_ledger: true,
    });
  }

  return {
    agentsMdPath: plan.agentsMdPath,
    agentsMdAction: plan.agentsMdAction,
    knowledgeDir: plan.knowledgeDir,
    knowledgeDirAction: plan.knowledgeDirAction,
    personalKnowledgeDir: plan.personalKnowledgeDir,
    metaPath: plan.metaPath,
    metaAction: plan.metaAction,
    eventsPath: plan.eventsPath,
    eventsAction: plan.eventsAction,
    forensicPath: plan.forensicPath,
    forensicAction: plan.forensicAction,
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
  console.log(formatAgentsMdAction(created.agentsMdPath, created.agentsMdAction));
  console.log(formatInitPathAction(created.knowledgeDir, created.knowledgeDirAction));
  console.log(formatInitPathAction(created.metaPath, created.metaAction));
  console.log(formatInitPathAction(created.eventsPath, created.eventsAction));
  console.log(formatInitPathAction(created.forensicPath, created.forensicAction));
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
    agentsMdPath: plan.agentsMdPath,
    agentsMdAction: plan.agentsMdAction,
    knowledgeDir: plan.knowledgeDir,
    knowledgeDirAction: plan.knowledgeDirAction,
    personalKnowledgeDir: plan.personalKnowledgeDir,
    metaPath: plan.metaPath,
    metaAction: plan.metaAction,
    eventsPath: plan.eventsPath,
    eventsAction: plan.eventsAction,
    forensicPath: plan.forensicPath,
    forensicAction: plan.forensicAction,
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
        // v2/rc.2: bootstrap installs the fabric-archive Skill template +
        // archive-hint Stop hook script + per-client hook configs + the
        // pointer line in CLAUDE.md / AGENTS.md / .cursor/rules. Each step
        // is best-effort: a single failure (e.g. one client's directory is
        // unreadable) is logged but does not abort init — other clients
        // and downstream stages continue.
        const installResults: InstallStepResult[] = [];
        installResults.push(...await runBestEffort("skill-install", () => installFabricArchiveSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-review-install", () => installFabricReviewSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-import-install", () => installFabricImportSkill(plan.target)));
        installResults.push(...await runBestEffort("hook-script", () => installArchiveHintHook(plan.target)));
        installResults.push(await runBestEffortSingle("claude-hook-config", () => mergeClaudeCodeHookConfig(plan.target)));
        installResults.push(await runBestEffortSingle("codex-hook-config", () => mergeCodexHookConfig(plan.target)));
        installResults.push(...await runBestEffort("pointer", () => addArchiveSkillPointer(plan.target)));
        const installedCount = installResults.filter((r) => r.status === "written").length;
        const skippedCount = installResults.filter((r) => r.status === "skipped").length;
        const errorCount = installResults.filter((r) => r.status === "error").length;
        for (const result of installResults) {
          if (result.status === "error") {
            writeStderr(`bootstrap ${result.step} ${result.path}: ${result.message ?? "unknown error"}`);
          }
        }
        const note = errorCount > 0 ? `errors=${errorCount}` : undefined;
        console.log(formatInitStageResult("bootstrap", "completed", installedCount, skippedCount, note));
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

function createInitialMeta(): AgentsMeta {
  // v2.0: agents.meta.json starts empty (`nodes: {}`) with a zeroed counters
  // envelope. The init-scan stage adds nodes/counters as it places the
  // baseline knowledge entries; subsequent `fab scan` runs and rule-meta
  // synchronization keep the file in sync.
  return {
    revision: "sha256:initial",
    nodes: {},
    counters: defaultAgentsMetaCounters(),
  };
}

function appendReapplyLedgerEvent(
  eventsPath: string,
  payload: { preserved_ledger: boolean },
): void {
  const event = {
    kind: "fabric-event",
    id: `event:${randomUUID()}`,
    ts: Date.now(),
    schema_version: 1,
    event_type: "reapply_completed",
    preserved_ledger: payload.preserved_ledger,
  };
  const line = `${JSON.stringify(event)}\n`;
  appendFileSync(eventsPath, line, "utf8");
}

async function runBestEffort(
  step: string,
  fn: () => Promise<InstallStepResult[]>,
): Promise<InstallStepResult[]> {
  try {
    return await fn();
  } catch (error: unknown) {
    return [
      {
        step,
        path: "",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

async function runBestEffortSingle(
  step: string,
  fn: () => Promise<InstallStepResult>,
): Promise<InstallStepResult> {
  try {
    return await fn();
  } catch (error: unknown) {
    return {
      step,
      path: "",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
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
  console.log(`  - ${target}/.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes,pending}/`);
  console.log(`  - ${target}/.fabric/agents.meta.json`);
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
  // v2/rc.2: the v1 client-side init skill is gone, so the "installed-skill"
  // branches no longer fire. rc.2/3/4 will reintroduce v2 skill wiring; until
  // then we route to installable-body when a client supports skills, otherwise
  // manual-body.
  const detected = supports.filter((support) => support.detected);

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

// v2.0 follow-up (rc.1 fix #1): AGENTS.md uses a `preserved` action variant
// that no other plan path needs. We render it through the same created-path
// i18n shell with a localized "preserved" label so output stays uniform.
function formatAgentsMdAction(path: string, action: AgentsMdAction): string {
  if (action === "preserved") {
    return t("cli.init.skipped-existing-path", { label: skippedLabel(), path });
  }
  return t("cli.init.created-path", { label: createdLabel(), path });
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

