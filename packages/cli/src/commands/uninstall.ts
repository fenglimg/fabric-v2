import { existsSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { cancel, confirm, group, intro, isCancel, log, note, outro } from "@clack/prompts";
import { defineCommand } from "citty";
import { checkLockOrThrow } from "@fenglimg/fabric-server";

import { paint } from "../colors.js";
import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import { detectClientSupports, resolveClients, type DetectedClientSupport } from "../config/resolver.js";
import type { ClientConfigWriter, RemoveResult } from "../config/writer.js";
import { t } from "../i18n.js";
import { hasActionHint, renderFabricError } from "../lib/error-render.js";
import {
  uninstallBootstrapStage,
  type UninstallOptions as BootstrapUninstallOptions,
  type UninstallStepResult,
} from "../install/uninstall-skills-and-hooks.js";

/**
 * `fabric uninstall` — symmetric inverse of `fabric install`.
 *
 * Three-stage pipeline mirroring init (reverse order is enforced by the
 * stage helpers themselves; this orchestrator dispatches them):
 *   1. scaffold   — best-effort rm of `.fabric/agents.meta.json`,
 *                   `.fabric/events.jsonl`, `.fabric/forensic.json`, and the
 *                   `.gitkeep` markers under `.fabric/knowledge/<subdir>/`.
 *                   The knowledge subdir contents themselves are ALWAYS
 *                   preserved (and `~/.fabric/knowledge/` is never touched).
 *   2. bootstrap  — Skills + hook scripts + hook-config un-merge + pointer-line
 *                   strip. Delegates to {@link uninstallBootstrapStage}.
 *   3. mcp        — Per-client `writer.remove('fabric')` against the JSON /
 *                   TOML configs.
 *
 * Hard invariants (clarifications #1, #2):
 *   - `.fabric/knowledge/` is ALWAYS preserved (rc.15 TASK-002 — --purge gone).
 *   - `~/.fabric/knowledge/` (personal root) is NEVER touched, regardless of
 *     any flag — encoded as a guard in {@link buildUninstallFabricPlan}.
 *   - Best-effort everywhere: missing artifacts log as `skipped`, never throw.
 */

type UninstallArgs = {
  target?: string;
  debug?: boolean;
  yes?: boolean;
  "dry-run"?: boolean;
};

export type UninstallOptions = {
  skipBootstrap?: boolean;
  skipMcp?: boolean;
  skipScaffold?: boolean;
  planOnly?: boolean;
};

type UninstallStageName = "scaffold" | "bootstrap" | "mcp";

type UninstallStageDisposition = "ran" | "skipped" | "failed";

type UninstallStageRecord = {
  name: UninstallStageName;
  disposition: UninstallStageDisposition;
  // Per-step records produced by the stage's helpers (skipped path counts,
  // removed counts). Surfaced in the post-run summary.
  steps: UninstallStepResult[];
};

type UninstallScaffoldEntry = {
  path: string;
  // `state-file` covers events.jsonl / forensic.json / agents.meta.json;
  // `gitkeep` covers .gitkeep markers under the team knowledge subdirs.
  // The knowledge subdir contents themselves are unconditionally preserved
  // (rc.15 TASK-002 dropped --purge).
  kind: "state-file" | "gitkeep";
  // When true, the path will be skipped because it does not exist on disk.
  absent: boolean;
};

export type UninstallScaffoldPlan = {
  target: string;
  fabricDir: string;
  personalKnowledgeDir: string;
  options: UninstallOptions;
  entries: UninstallScaffoldEntry[];
};

type UninstallMcpStagePlan = {
  name: "mcp";
  skipped: boolean;
};

type UninstallBootstrapStagePlan = {
  name: "bootstrap";
  skipped: boolean;
};

type UninstallScaffoldStagePlan = {
  name: "scaffold";
  skipped: boolean;
};

type UninstallStagePlan =
  | UninstallBootstrapStagePlan
  | UninstallMcpStagePlan
  | UninstallScaffoldStagePlan;

export type UninstallExecutionPlan = {
  target: string;
  options: UninstallOptions;
  interactive: boolean;
  supports: DetectedClientSupport[];
  scaffold: UninstallScaffoldPlan;
  stages: UninstallStagePlan[];
};

export type UninstallExecutionResult = {
  plan: UninstallExecutionPlan;
  stageResults: UninstallStageRecord[];
};

type UninstallCliIntent = {
  target: string;
  options: UninstallOptions;
  interactiveSummary: boolean;
  wizardEnabled: boolean;
};

type UninstallWizardSelection = {
  scaffold: boolean;
  bootstrap: boolean;
  mcp: boolean;
};

type UninstallWizardContext = {
  target: string;
  options: UninstallOptions;
  supports: DetectedClientSupport[];
  lockedStages: UninstallStageName[];
};

export type UninstallWizardAdapter = {
  run(context: UninstallWizardContext): Promise<UninstallWizardSelection | null>;
};

type McpRemovalDetail = {
  client: ClientConfigWriter["clientKind"];
  status: RemoveResult["status"] | "dry-run";
  path?: string;
  message?: string;
};

const UNINSTALL_WIZARD_GROUP_CANCELLED = Symbol("uninstall-wizard-group-cancelled");

const KNOWLEDGE_SUBDIRS = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
  "pending",
] as const;

// Top-level `.fabric/` state files written by `fabric install`. The default scaffold
// stage prunes these — knowledge subdir contents are ALWAYS preserved
// (rc.15 TASK-002 removed --purge; team knowledge is now unconditionally kept).
const FABRIC_STATE_FILES = ["agents.meta.json", "events.jsonl", "forensic.json"] as const;

export const uninstallCommand = defineCommand({
  meta: {
    name: "uninstall",
    description: t("cli.uninstall.description"),
  },
  args: {
    debug: {
      type: "boolean",
      description: t("cli.uninstall.args.debug.description"),
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: t("cli.uninstall.args.dry-run.description"),
      default: false,
    },
    target: {
      type: "string",
      description: t("cli.uninstall.args.target.description"),
    },
    yes: {
      type: "boolean",
      description: t("cli.uninstall.args.yes.description"),
      default: false,
    },
  },
  async run({ args }: { args: UninstallArgs }) {
    await runUninstallCommand(args);
  },
});

export default uninstallCommand;

export async function runUninstallCommand(args: UninstallArgs): Promise<UninstallExecutionResult | void> {
  const logger = createDebugLogger(args.debug);
  const resolution = resolveDevMode(args.target, process.cwd());
  const intent = resolveUninstallCliIntent(args, resolution.target);

  logger(`uninstall target source: ${resolution.source}`);
  for (const step of resolution.chain) {
    logger(step);
  }

  // Lock safety: refuse if a serve process holds the lock.
  // rc.15 TASK-007: explicitly render `.actionHint` from FabricError-shaped
  // failures (citty's default handler prints `.message` only).
  try {
    checkLockOrThrow(intent.target);
  } catch (err) {
    if (hasActionHint(err)) {
      renderFabricError(err);
      process.exit(1);
    }
    throw err;
  }

  const supports = detectClientSupports(intent.target);
  const basePlan = await buildUninstallExecutionPlan(intent.target, {
    ...intent.options,
    // Carry through interactive flag for plan-summary printing.
  });
  const planWithSupports: UninstallExecutionPlan = {
    ...basePlan,
    interactive: intent.interactiveSummary && !intent.wizardEnabled,
    supports,
  };

  const finalPlan = intent.wizardEnabled
    ? await resolveUninstallExecutionPlanWithWizard(planWithSupports, createDefaultUninstallWizardAdapter())
    : planWithSupports;

  if (finalPlan === null) {
    process.exitCode = 130;
    return;
  }

  if (finalPlan.options.planOnly) {
    printUninstallPlanPreview(finalPlan);
    return {
      plan: finalPlan,
      stageResults: finalPlan.stages.map((stage) => ({
        name: stage.name,
        disposition: "skipped" as const,
        steps: [],
      })),
    };
  }

  // Confirm prompt for destructive runs in interactive shells unless --yes.
  if (intent.interactiveSummary && !intent.wizardEnabled && args.yes !== true) {
    const proceed = await confirmDestructive(finalPlan);
    if (!proceed) {
      process.exitCode = 130;
      return;
    }
  }

  const result = await executeUninstallExecutionPlan(finalPlan);
  printUninstallSummary(result);
  return result;
}

function resolveUninstallCliIntent(args: UninstallArgs, targetInput: string): UninstallCliIntent {
  const target = normalizeTarget(targetInput);
  const terminalInteractive = isInteractiveUninstall();
  const planOnly = args["dry-run"] === true;
  const options: UninstallOptions = {
    planOnly,
  };

  return {
    target,
    options,
    interactiveSummary: terminalInteractive,
    wizardEnabled: shouldUseUninstallWizard(args, terminalInteractive) && !planOnly,
  };
}

export function shouldUseUninstallWizard(
  args: Pick<UninstallArgs, "yes">,
  terminalInteractive = isInteractiveUninstall(),
): boolean {
  return terminalInteractive && args.yes !== true;
}

export async function buildUninstallExecutionPlan(
  target: string,
  options: UninstallOptions = {},
): Promise<UninstallExecutionPlan> {
  const scaffold = buildUninstallFabricPlan(target, options);
  const supports = detectClientSupports(target);

  const stages: UninstallStagePlan[] = [
    { name: "scaffold", skipped: Boolean(options.skipScaffold) },
    { name: "bootstrap", skipped: Boolean(options.skipBootstrap) },
    { name: "mcp", skipped: Boolean(options.skipMcp) },
  ];

  return {
    target,
    options,
    interactive: false,
    supports,
    scaffold,
    stages,
  };
}

/**
 * Enumerate scaffold artifacts that will be removed by the scaffold stage.
 * Encodes the hard invariants from clarifications #1+#2:
 *   - `.fabric/knowledge/` (team) is ALWAYS preserved (rc.15 — --purge gone).
 *   - `~/.fabric/knowledge/` (personal root) is NEVER included. Any candidate
 *     whose absolute form starts with the resolved personal root is silently
 *     filtered out as defense-in-depth.
 */
export function buildUninstallFabricPlan(
  target: string,
  options: UninstallOptions = {},
): UninstallScaffoldPlan {
  const absTarget = normalizeTarget(target);
  const fabricDir = join(absTarget, ".fabric");
  const personalKnowledgeDir = resolve(resolvePersonalFabricRoot(), ".fabric", "knowledge");

  const entries: UninstallScaffoldEntry[] = [];

  // Top-level state files (always candidates under default scaffold).
  for (const name of FABRIC_STATE_FILES) {
    const p = join(fabricDir, name);
    entries.push({ path: p, kind: "state-file", absent: !existsSync(p) });
  }

  // Knowledge subdir .gitkeep markers — always candidates; subdir contents
  // themselves are unconditionally preserved (rc.15 TASK-002 dropped --purge).
  for (const sub of KNOWLEDGE_SUBDIRS) {
    const gk = join(fabricDir, "knowledge", sub, ".gitkeep");
    entries.push({ path: gk, kind: "gitkeep", absent: !existsSync(gk) });
  }

  // Hard guard: refuse any path whose absolute form falls inside the personal
  // fabric root. Defense-in-depth — the candidates above are all under
  // `target/.fabric/`, but a misconfigured FABRIC_HOME or symlink could
  // theoretically alias the two.
  const safeEntries = entries.filter((entry) => !isInsidePersonalRoot(entry.path, personalKnowledgeDir));

  return {
    target: absTarget,
    fabricDir,
    personalKnowledgeDir,
    options,
    entries: safeEntries,
  };
}

/**
 * Execute the scaffold sub-plan. Best-effort: every rm is try/catch-wrapped;
 * an entry that fails contributes an `error` step result and the executor
 * proceeds to the next entry. Knowledge subdir contents are never enumerated
 * (rc.15 TASK-002 dropped --purge — team knowledge is unconditionally kept).
 */
export async function executeUninstallFabricPlan(
  plan: UninstallScaffoldPlan,
): Promise<UninstallStepResult[]> {
  const results: UninstallStepResult[] = [];

  for (const entry of plan.entries) {
    if (entry.absent) {
      results.push({
        step: scaffoldStepLabel(entry.kind),
        path: entry.path,
        status: "skipped",
        message: "absent",
      });
      continue;
    }

    try {
      await rm(entry.path, { force: true });
      results.push({ step: scaffoldStepLabel(entry.kind), path: entry.path, status: "removed" });
    } catch (error: unknown) {
      results.push({
        step: scaffoldStepLabel(entry.kind),
        path: entry.path,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

function scaffoldStepLabel(kind: UninstallScaffoldEntry["kind"]): string {
  switch (kind) {
    case "state-file":
      return "scaffold-state";
    case "gitkeep":
      return "scaffold-gitkeep";
  }
}

/**
 * Per-client MCP un-registration loop, mirror of `installMcpClients`. For each
 * detected writer:
 *   - `detect()` returns null → record `skipped` with reason `no-config-path`.
 *   - dry-run → record `dry-run`.
 *   - else call `writer.remove('fabric', workspaceRoot)` → forward result.
 *
 * Best-effort per client: a thrown error from a single writer becomes an
 * `error` detail entry and the loop continues to the next client.
 */
export async function uninstallMcpClients(
  target: string,
  options: { dryRun?: boolean } = {},
): Promise<{ details: McpRemovalDetail[]; results: UninstallStepResult[] }> {
  const workspaceRoot = resolve(target);
  const writers = resolveClients(workspaceRoot, {});
  const details: McpRemovalDetail[] = [];
  const results: UninstallStepResult[] = [];

  for (const writer of writers) {
    let configPath: string | null;
    try {
      configPath = await writer.detect(workspaceRoot);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      details.push({ client: writer.clientKind, status: "error", message });
      results.push({
        step: `mcp-${writer.clientKind}`,
        path: "",
        status: "error",
        message,
      });
      continue;
    }

    if (configPath === null) {
      details.push({ client: writer.clientKind, status: "skipped", message: "no-config-path" });
      results.push({
        step: `mcp-${writer.clientKind}`,
        path: "",
        status: "skipped",
        message: "no-config-path",
      });
      continue;
    }

    if (options.dryRun === true) {
      details.push({ client: writer.clientKind, status: "dry-run", path: configPath });
      results.push({
        step: `mcp-${writer.clientKind}`,
        path: configPath,
        status: "skipped",
        message: "dry-run",
      });
      continue;
    }

    let removeResult: RemoveResult;
    try {
      removeResult = await writer.remove("fabric", workspaceRoot);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      details.push({ client: writer.clientKind, status: "error", path: configPath, message });
      results.push({
        step: `mcp-${writer.clientKind}`,
        path: configPath,
        status: "error",
        message,
      });
      continue;
    }

    details.push({
      client: writer.clientKind,
      status: removeResult.status,
      path: removeResult.path,
      message: removeResult.message,
    });
    results.push({
      step: `mcp-${writer.clientKind}`,
      path: removeResult.path ?? configPath,
      status: removeResult.status === "removed" ? "removed" : removeResult.status === "error" ? "error" : "skipped",
      message: removeResult.message,
    });
  }

  return { details, results };
}

/**
 * Execute the full plan. Each stage is invoked in order; a stage that throws
 * is reported as `failed` but does not abort the pipeline — subsequent stages
 * still run. Mirrors init's executeInitExecutionPlan contract.
 */
export async function executeUninstallExecutionPlan(
  plan: UninstallExecutionPlan,
): Promise<UninstallExecutionResult> {
  const stageResults: UninstallStageRecord[] = [];

  for (const stage of plan.stages) {
    if (stage.skipped) {
      stageResults.push({ name: stage.name, disposition: "skipped", steps: [] });
      continue;
    }

    console.log(formatUninstallStageHeader(stage.name));
    try {
      const steps = await executeUninstallStage(plan, stage.name);
      const disposition: UninstallStageDisposition = steps.some((s) => s.status === "error") ? "failed" : "ran";
      stageResults.push({ name: stage.name, disposition, steps });
      console.log(formatUninstallStageResult(stage.name, steps));
    } catch (error: unknown) {
      stageResults.push({
        name: stage.name,
        disposition: "failed",
        steps: [
          {
            step: stage.name,
            path: plan.target,
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
      writeStderr(formatUninstallStageFailure(stage.name, error));
    }
  }

  return { plan, stageResults };
}

async function executeUninstallStage(
  plan: UninstallExecutionPlan,
  stageName: UninstallStageName,
): Promise<UninstallStepResult[]> {
  switch (stageName) {
    case "scaffold":
      return executeUninstallFabricPlan(plan.scaffold);
    case "bootstrap": {
      const opts: BootstrapUninstallOptions = {};
      return uninstallBootstrapStage(plan.target, opts);
    }
    case "mcp": {
      const { results } = await uninstallMcpClients(plan.target);
      return results;
    }
  }
}

/**
 * Top-level entrypoint exposed for tests / programmatic callers. Builds and
 * executes the full plan in one call. Mirrors `initFabric()`.
 */
export async function uninstallFabric(
  target: string,
  options: UninstallOptions = {},
): Promise<UninstallExecutionResult> {
  const plan = await buildUninstallExecutionPlan(target, options);
  return executeUninstallExecutionPlan(plan);
}

// -----------------------------------------------------------------------
// Wizard
// -----------------------------------------------------------------------

export async function resolveUninstallExecutionPlanWithWizard(
  basePlan: UninstallExecutionPlan,
  wizardAdapter: UninstallWizardAdapter,
): Promise<UninstallExecutionPlan | null> {
  const selection = await wizardAdapter.run({
    target: basePlan.target,
    options: basePlan.options,
    supports: basePlan.supports,
    lockedStages: [],
  });

  if (selection === null) {
    return null;
  }

  const nextOptions: UninstallOptions = {
    ...basePlan.options,
    skipScaffold: !selection.scaffold,
    skipBootstrap: !selection.bootstrap,
    skipMcp: !selection.mcp,
  };

  const rebuilt = await buildUninstallExecutionPlan(basePlan.target, nextOptions);
  return {
    ...rebuilt,
    interactive: false,
    supports: basePlan.supports,
  };
}

export function createDefaultUninstallWizardAdapter(): UninstallWizardAdapter {
  return {
    async run(context) {
      intro(t("cli.uninstall.wizard.intro"));
      note(
        t("cli.uninstall.wizard.overview.body", {
          target: context.target,
        }),
        t("cli.uninstall.wizard.overview.title"),
      );
      printUninstallPlanSummary(context.target, context.options, context.supports);

      log.step(t("cli.uninstall.wizard.step.target"));
      const continueWithTarget = await confirm({
        message: t("cli.uninstall.wizard.target.confirm", { target: context.target }),
        initialValue: true,
      });
      if (isCancel(continueWithTarget) || !continueWithTarget) {
        emitUninstallWizardCancellation();
        return null;
      }

      log.step(t("cli.uninstall.wizard.step.plan"));
      let groupedSelection: UninstallWizardSelection;
      try {
        groupedSelection = await group<UninstallWizardSelection>(
          {
            scaffold: async () =>
              context.lockedStages.includes("scaffold")
                ? false
                : confirmInGroup({
                    message: t("cli.uninstall.wizard.stage.scaffold", {
                      defaultValue: formatPromptDefault(!context.options.skipScaffold),
                    }),
                    initialValue: !context.options.skipScaffold,
                  }),
            bootstrap: async () =>
              context.lockedStages.includes("bootstrap")
                ? false
                : confirmInGroup({
                    message: t("cli.uninstall.wizard.stage.bootstrap", {
                      defaultValue: formatPromptDefault(!context.options.skipBootstrap),
                    }),
                    initialValue: !context.options.skipBootstrap,
                  }),
            mcp: async () =>
              context.lockedStages.includes("mcp")
                ? false
                : confirmInGroup({
                    message: t("cli.uninstall.wizard.stage.mcp", {
                      defaultValue: formatPromptDefault(!context.options.skipMcp),
                    }),
                    initialValue: !context.options.skipMcp,
                  }),
          },
          {
            onCancel() {
              throw UNINSTALL_WIZARD_GROUP_CANCELLED;
            },
          },
        );
      } catch (error) {
        if (error === UNINSTALL_WIZARD_GROUP_CANCELLED) {
          emitUninstallWizardCancellation();
          return null;
        }
        throw error;
      }

      const previewOptions: UninstallOptions = {
        ...context.options,
        skipScaffold: !groupedSelection.scaffold,
        skipBootstrap: !groupedSelection.bootstrap,
        skipMcp: !groupedSelection.mcp,
      };
      log.step(t("cli.uninstall.wizard.step.review"));
      printUninstallPlanSummary(context.target, previewOptions, context.supports);

      const confirmed = await confirm({
        message: t("cli.uninstall.wizard.execute.confirm"),
        initialValue: true,
      });
      if (isCancel(confirmed) || !confirmed) {
        emitUninstallWizardCancellation();
        return null;
      }

      outro(t("cli.uninstall.wizard.outro"));

      return groupedSelection;
    },
  };
}

function emitUninstallWizardCancellation(): void {
  cancel(t("cli.uninstall.wizard.cancelled"));
}

async function confirmInGroup(options: { message: string; initialValue: boolean }): Promise<boolean> {
  const result = await confirm(options);
  if (isCancel(result)) {
    throw UNINSTALL_WIZARD_GROUP_CANCELLED;
  }
  return result;
}

// -----------------------------------------------------------------------
// Confirmation prompt (non-wizard interactive path)
// -----------------------------------------------------------------------

async function confirmDestructive(plan: UninstallExecutionPlan): Promise<boolean> {
  printUninstallPlanSummary(plan.target, plan.options, plan.supports);
  const answer = await confirm({
    message: t("cli.uninstall.confirm.proceed", { target: plan.target }),
    initialValue: false,
  });
  if (isCancel(answer)) {
    return false;
  }
  return answer === true;
}

// -----------------------------------------------------------------------
// Output formatting
// -----------------------------------------------------------------------

function printUninstallPlanPreview(plan: UninstallExecutionPlan): void {
  console.log(t("cli.uninstall.plan.preview-title"));
  printUninstallPlanSummary(plan.target, plan.options, plan.supports);
  console.log(
    t("cli.uninstall.plan.preview-result", {
      scaffold: yesNoLabel(!plan.options.skipScaffold),
      bootstrap: yesNoLabel(!plan.options.skipBootstrap),
      mcp: yesNoLabel(!plan.options.skipMcp),
    }),
  );

  // Enumerate scaffold entries for transparency. Helps the user verify what
  // will actually be touched before they commit.
  if (!plan.options.skipScaffold && plan.scaffold.entries.length > 0) {
    console.log(t("cli.uninstall.plan.scaffold-entries.title"));
    for (const entry of plan.scaffold.entries) {
      const marker = entry.absent ? paint.muted("(absent)") : paint.success("(present)");
      console.log(`  - ${entry.path} ${marker}`);
    }
  }
}

function printUninstallPlanSummary(
  target: string,
  options: UninstallOptions,
  supports: DetectedClientSupport[],
): void {
  console.log(t("cli.uninstall.plan.title"));
  console.log(t("cli.uninstall.plan.target", { target }));
  console.log(
    t("cli.uninstall.plan.actions", {
      scaffold: yesNoLabel(!options.skipScaffold),
      bootstrap: yesNoLabel(!options.skipBootstrap),
      mcp: yesNoLabel(!options.skipMcp),
    }),
  );
  const detected = supports.filter((support) => support.detected);
  console.log(
    t("cli.uninstall.plan.detected", {
      clients: detected.length > 0 ? detected.map((support) => support.label).join(", ") : t("cli.shared.none"),
    }),
  );
  console.log(t("cli.uninstall.plan.preserves"));
  console.log(`  - ${target}/.fabric/knowledge/  ${paint.muted(t("cli.uninstall.plan.preserves.knowledge"))}`);
  console.log(`  - ~/.fabric/knowledge/  ${paint.muted(t("cli.uninstall.plan.preserves.personal"))}`);
}

function printUninstallSummary(result: UninstallExecutionResult): void {
  const removed = result.stageResults.flatMap((stage) =>
    stage.steps.filter((s) => s.status === "removed"),
  ).length;
  const skipped = result.stageResults.flatMap((stage) =>
    stage.steps.filter((s) => s.status === "skipped"),
  ).length;
  const errors = result.stageResults.flatMap((stage) =>
    stage.steps.filter((s) => s.status === "error"),
  ).length;

  note(
    t("cli.uninstall.summary.body", {
      removed: String(removed),
      skipped: String(skipped),
      errors: String(errors),
    }),
    t("cli.uninstall.summary.title"),
  );

  // Surface error details so users can react.
  for (const stage of result.stageResults) {
    for (const step of stage.steps) {
      if (step.status === "error") {
        writeStderr(`${paint.error(t("cli.shared.error"))} ${stage.name}/${step.step} ${step.path}: ${step.message ?? "unknown error"}`);
      }
    }
  }
}

function formatUninstallStageHeader(stageName: UninstallStageName): string {
  return `${paint.ai(t("cli.shared.next"))} ${paint.muted(t(`cli.uninstall.stages.${stageName}`))}`;
}

function formatUninstallStageResult(
  stageName: UninstallStageName,
  steps: UninstallStepResult[],
): string {
  const removedCount = steps.filter((s) => s.status === "removed").length;
  const skippedCount = steps.filter((s) => s.status === "skipped").length;
  const errorCount = steps.filter((s) => s.status === "error").length;
  const counts = `removed=${removedCount} skipped=${skippedCount} errors=${errorCount}`;
  const label = errorCount > 0
    ? paint.warn(t("cli.uninstall.stages.completed-with-errors"))
    : paint.success(t("cli.uninstall.stages.completed"));
  return `${label} ${stageName}: ${counts}`;
}

function formatUninstallStageFailure(stage: UninstallStageName, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${paint.error(t("cli.uninstall.stages.failed"))} ${stage}: ${message}`;
}

// -----------------------------------------------------------------------
// Misc helpers
// -----------------------------------------------------------------------

function resolvePersonalFabricRoot(): string {
  return process.env.FABRIC_HOME ?? homedir();
}

/**
 * True when `candidate` resolves to a path that is `personalKnowledgeDir`
 * itself or sits underneath it. Used by {@link buildUninstallFabricPlan} as
 * the hard guard preventing personal-root paths from ever entering the
 * scaffold removal list.
 */
function isInsidePersonalRoot(candidate: string, personalKnowledgeDir: string): boolean {
  const candidateAbs = resolve(candidate);
  const rootAbs = resolve(personalKnowledgeDir);
  if (candidateAbs === rootAbs) {
    return true;
  }
  const rel = relative(rootAbs, candidateAbs);
  // `relative()` returning a path that does not start with `..` and is not
  // absolute means `candidate` is a descendant of `root`.
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes("..");
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(t("cli.uninstall.errors.target-not-directory", { path: target }));
  }
}

function isInteractiveUninstall(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
}

function formatPromptDefault(value: boolean): string {
  return value ? "Y/n" : "y/N";
}

function yesNoLabel(value: boolean): string {
  return value ? t("cli.shared.yes") : t("cli.shared.no");
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

// Expose for tests / future docs commands.
export { assertExistingDirectory, isInsidePersonalRoot };
