import { existsSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { cancel, confirm, intro, isCancel, multiselect, outro } from "@clack/prompts";
import { defineCommand } from "citty";
// v2.0.0-rc.37 Wave A2: serve-lock preflight removed alongside fabric serve
// quarantine — no main-line process writes `.fabric/.serve.lock` any more.
// See KB [[fabric-serve-quarantine-not-delete]].

import { paint } from "../colors.js";
import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import { detectClientSupports, resolveClients, type DetectedClientSupport } from "../config/resolver.js";
import type { ClientConfigWriter, RemoveResult } from "../config/writer.js";
import { t } from "../i18n.js";
import {
  uninstallBootstrapStage,
  type UninstallOptions as BootstrapUninstallOptions,
  type UninstallStepResult,
} from "../install/uninstall-skills-and-hooks.js";
import { unbindStoreProject } from "../install/uninstall-store.js";
import { HOOK_SCRIPT_DESTINATIONS, SKILL_DESTINATIONS } from "../install/skills-and-hooks.js";

// W4 uninstall-symmetry: `fabric uninstall` is now the visual + semantic inverse
// of the install-v2 pipeline. It drives the SAME TASK-001 OutputRenderer that
// install uses (section bar / step badge / summary card / error box) instead of
// the old bare console.log self-draw, and adds an OPTIONAL store-unbind stage
// symmetric to install's store binding. The orchestration stays uninstall's own
// (NOT the install-coupled `InstallPipeline` class) — rollback/firstInstall
// collapse are meaningless for a best-effort teardown.
import { createInstallRenderer } from "../tui/index.js";
import type { ErrorInfo, OutputRenderer, SummaryDetailRow, SummaryInfo } from "../tui/types.js";

/**
 * `fabric uninstall` — symmetric inverse of `fabric install`.
 *
 * Five-stage pipeline, the reverse of the install-v2 pipeline:
 *   1. bootstrap — Skills + hook scripts + hook-config un-merge + pointer-line
 *                  strip + snapshot removal. Inverse of install's hooks stage.
 *                  Delegates to {@link uninstallBootstrapStage}.
 *   2. mcp       — Per-client `writer.remove('fabric')`. Inverse of install mcp.
 *   3. store     — OPTIONAL (default skipped). Unbinds THIS project from its team
 *                  store (clears required_stores / active_write_store / write_routes
 *                  / active_project) via {@link unbindStoreProject}. Inverse of
 *                  install's store binding. NEVER deletes the global store.
 *   4. scaffold  — best-effort rm of project-local Fabric state files written by
 *                  install. Inverse of install's env scaffold.
 *   5. validate  — confirms the bootstrap artifacts were cleared. Inverse of
 *                  install's validate stage.
 *
 * Hard invariants:
 *   - Global stores under `~/.fabric/stores/` are NEVER touched, regardless of
 *     any flag — encoded as a guard in {@link buildUninstallFabricPlan} and in
 *     {@link unbindStoreProject} (which never imports a global-store mutator).
 *   - Best-effort everywhere: missing artifacts log as `skipped`, never throw.
 */

type UninstallArgs = {
  target?: string;
  debug?: boolean;
  yes?: boolean;
  verbose?: boolean;
  "unbind-store"?: boolean;
  "dry-run"?: boolean;
};

export type UninstallOptions = {
  skipBootstrap?: boolean;
  skipMcp?: boolean;
  skipScaffold?: boolean;
  // store-unbind defaults to SKIPPED: it mutates the project's team binding, an
  // opt-in action (wizard checkbox or --unbind-store). Plan-building treats an
  // unset skipStore as "skip" so the default uninstall never touches the binding.
  skipStore?: boolean;
  skipValidate?: boolean;
  planOnly?: boolean;
};

type UninstallStageName = "bootstrap" | "mcp" | "store" | "scaffold" | "validate";

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
  // `state-file` covers project-local Fabric state written by install.
  kind: "state-file";
  // When true, the path will be skipped because it does not exist on disk.
  absent: boolean;
};

export type UninstallScaffoldPlan = {
  target: string;
  fabricDir: string;
  globalStoresDir: string;
  options: UninstallOptions;
  entries: UninstallScaffoldEntry[];
};

type UninstallStagePlan = {
  name: UninstallStageName;
  skipped: boolean;
};

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
  bootstrap: boolean;
  mcp: boolean;
  scaffold: boolean;
  store: boolean;
};

type UninstallWizardContext = {
  target: string;
  options: UninstallOptions;
  supports: DetectedClientSupport[];
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

// Top-level `.fabric/` state files written by `fabric install`. The scaffold
// stage prunes these. Knowledge content is stored under global stores, not under
// the project-local `.fabric/knowledge` tree, and the binding config
// (`fabric-config.json`) is handled by the optional store stage — never deleted.
const FABRIC_STATE_FILES = ["agents.meta.json", "events.jsonl", "forensic.json"] as const;

// W4: stage visual anchors, mirroring install's STAGE_ICONS (pipeline.ts). The
// StageName stays an English routing key; only the displayed label is localized.
const UNINSTALL_STAGE_ICONS: Record<UninstallStageName, string> = {
  bootstrap: "🧹",
  mcp: "🔌",
  store: "🔗",
  scaffold: "🗑️",
  validate: "✅",
};

// Canonical execution order — the reverse of the install-v2 pipeline.
const UNINSTALL_STAGE_ORDER: readonly UninstallStageName[] = [
  "bootstrap",
  "mcp",
  "store",
  "scaffold",
  "validate",
];

// Wizard-selectable stages (validate always runs; it is a verification closer,
// not a teardown choice). `store` is offered but UNCHECKED by default.
const UNINSTALL_WIZARD_KEYS: readonly Exclude<UninstallStageName, "validate">[] = [
  "bootstrap",
  "mcp",
  "scaffold",
  "store",
];

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
    verbose: {
      type: "boolean",
      description: t("cli.uninstall.args.verbose.description"),
      default: false,
    },
    "unbind-store": {
      type: "boolean",
      description: t("cli.uninstall.args.unbind-store.description"),
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

  const supports = detectClientSupports(intent.target);
  const basePlan = await buildUninstallExecutionPlan(intent.target, intent.options);
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

  // W4: drive the shared OutputRenderer on interactive (TTY) runs — same gate as
  // install's shouldUseInstallRenderer. Non-TTY (pipes/CI) keeps the plain
  // numbered console.log fallback so log scrapers / snapshots stay stable.
  const renderer = shouldUseUninstallRenderer(intent.interactiveSummary)
    ? createInstallRenderer({ verbose: args.verbose === true || args.debug === true })
    : undefined;

  const result = await executeUninstallExecutionPlan(finalPlan, renderer);

  if (renderer) {
    await renderer.cleanup();
  }
  return result;
}

function resolveUninstallCliIntent(args: UninstallArgs, targetInput: string): UninstallCliIntent {
  const target = normalizeTarget(targetInput);
  const terminalInteractive = isInteractiveUninstall();
  const planOnly = args["dry-run"] === true;
  const options: UninstallOptions = {
    planOnly,
    // Non-wizard opt-in: --unbind-store enables the store stage (default skip).
    skipStore: args["unbind-store"] !== true,
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

/**
 * W4: same gate as install's `shouldUseInstallRenderer` — the renderer carries
 * the static richness (section bars, step badges, summary card, error box) and
 * is pure print-and-go, so it never fights interactive clack prompts. Enabled
 * for every interactive run; non-TTY keeps the plain fallback.
 */
export function shouldUseUninstallRenderer(terminalInteractive: boolean): boolean {
  return terminalInteractive;
}

export async function buildUninstallExecutionPlan(
  target: string,
  options: UninstallOptions = {},
): Promise<UninstallExecutionPlan> {
  const scaffold = buildUninstallFabricPlan(target, options);
  const supports = detectClientSupports(target);

  const stages: UninstallStagePlan[] = UNINSTALL_STAGE_ORDER.map((name) => ({
    name,
    skipped: isStagePlanSkipped(options, name),
  }));

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
 * Resolve a stage's default skip disposition from options. `store` is the only
 * stage that defaults to SKIPPED (opt-in unbind); every other stage runs unless
 * explicitly skipped.
 */
function isStagePlanSkipped(options: UninstallOptions, name: UninstallStageName): boolean {
  switch (name) {
    case "bootstrap":
      return Boolean(options.skipBootstrap);
    case "mcp":
      return Boolean(options.skipMcp);
    case "store":
      // Unset → skipped. Only an explicit skipStore===false runs the unbind.
      return options.skipStore !== false;
    case "scaffold":
      return Boolean(options.skipScaffold);
    case "validate":
      return Boolean(options.skipValidate);
  }
}

/**
 * Enumerate scaffold artifacts that will be removed by the scaffold stage.
 * Encodes the hard invariant: global stores under `~/.fabric/stores/` are never
 * included in a project uninstall plan.
 */
export function buildUninstallFabricPlan(
  target: string,
  options: UninstallOptions = {},
): UninstallScaffoldPlan {
  const absTarget = normalizeTarget(target);
  const fabricDir = join(absTarget, ".fabric");
  const globalStoresDir = join(resolvePersonalFabricRoot(), ".fabric", "stores");

  const entries: UninstallScaffoldEntry[] = [];

  // Top-level state files (always candidates under default scaffold).
  for (const name of FABRIC_STATE_FILES) {
    const p = join(fabricDir, name);
    entries.push({ path: p, kind: "state-file", absent: !existsSync(p) });
  }

  // Hard guard: refuse any path whose absolute form falls inside the global
  // stores root. Defense-in-depth — the candidates above are all under
  // `target/.fabric/`, but a misconfigured FABRIC_HOME or symlink could
  // theoretically alias the two.
  const safeEntries = entries.filter((entry) => !isInsideGlobalStoresRoot(entry.path, globalStoresDir));

  return {
    target: absTarget,
    fabricDir,
    globalStoresDir,
    options,
    entries: safeEntries,
  };
}

/**
 * Execute the scaffold sub-plan. Best-effort: every rm is try/catch-wrapped;
 * an entry that fails contributes an `error` step result and the executor
 * proceeds to the next entry. Global stores are never enumerated.
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
 * W4 store stage: project-side unbind, surfaced as uniform step results.
 * Delegates to {@link unbindStoreProject} which never touches the global store.
 */
function executeUninstallStoreStage(target: string): UninstallStepResult[] {
  const configPath = join(target, ".fabric", "fabric-config.json");
  const result = unbindStoreProject(target);
  if (result.status === "skipped") {
    return [{ step: "store-unbind", path: configPath, status: "skipped", message: result.reason }];
  }
  if (result.unboundAliases.length === 0) {
    return [{ step: "store-unbind", path: configPath, status: "removed", message: "binding cleared" }];
  }
  return result.unboundAliases.map((alias) => ({
    step: "store-unbind",
    path: configPath,
    status: "removed" as const,
    message: alias,
  }));
}

/**
 * W4 validate stage: confirm the bootstrap artifacts (skills + hook scripts) are
 * gone. Only meaningful when the bootstrap stage actually ran — when it was
 * deselected, residual skill/hook files are EXPECTED, so validation is scoped
 * out (a single skipped row) rather than flagging false residuals.
 */
function validateUninstallCleared(target: string, bootstrapRan: boolean): UninstallStepResult[] {
  if (!bootstrapRan) {
    return [{ step: "validate", path: target, status: "skipped", message: "validation-scope-skipped" }];
  }
  const residualRels = [
    ...Object.values(SKILL_DESTINATIONS).flat(),
    ...Object.values(HOOK_SCRIPT_DESTINATIONS).flat(),
  ];
  const residuals: UninstallStepResult[] = [];
  for (const rel of residualRels) {
    const p = join(target, rel);
    if (existsSync(p)) {
      residuals.push({ step: "validate-residual", path: p, status: "error", message: "residual artifact" });
    }
  }
  if (residuals.length === 0) {
    return [{ step: "validate", path: target, status: "skipped", message: "cleared" }];
  }
  return residuals;
}

/**
 * Execute the full plan. Each stage is invoked in order; a stage that throws
 * is reported as `failed` but does not abort the pipeline — subsequent stages
 * still run. Mirrors install's executeInitExecutionPlan contract.
 *
 * `renderer` (W4) drives the shared TASK-001 OutputRenderer when present
 * (interactive runs); when undefined the executor falls back to plain
 * console.log so non-TTY / test paths stay stable.
 */
export async function executeUninstallExecutionPlan(
  plan: UninstallExecutionPlan,
  renderer?: OutputRenderer,
): Promise<UninstallExecutionResult> {
  const stageResults: UninstallStageRecord[] = [];
  const totalStages = plan.stages.length;

  // Intro banner — section bar + "runs in N phases" line through the renderer,
  // or the plain banner on the fallback path.
  if (renderer) {
    renderer.renderSection(t("cli.uninstall.pipeline.title"));
    renderer.renderInfo(t("cli.uninstall.plan.phase-banner", { total: String(totalStages) }));
  } else {
    console.log(t("cli.uninstall.plan.phase-banner", { total: String(totalStages) }));
  }

  let stepNum = 0;
  for (const stage of plan.stages) {
    stepNum += 1;

    if (stage.skipped) {
      renderStageSkipped(renderer, stage.name, stepNum, totalStages);
      stageResults.push({ name: stage.name, disposition: "skipped", steps: [] });
      continue;
    }

    renderStageHeader(renderer, stage.name, stepNum, totalStages);
    try {
      const steps = await executeUninstallStage(plan, stage.name, stageResults);
      const disposition: UninstallStageDisposition = steps.some((s) => s.status === "error") ? "failed" : "ran";
      stageResults.push({ name: stage.name, disposition, steps });
      renderStageResult(renderer, stage.name, stepNum, totalStages, steps);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      stageResults.push({
        name: stage.name,
        disposition: "failed",
        steps: [{ step: stage.name, path: plan.target, status: "error", message }],
      });
      renderStageFailure(renderer, stage.name, stepNum, totalStages, error);
    }
  }

  renderUninstallSummary(renderer, { plan, stageResults });
  return { plan, stageResults };
}

async function executeUninstallStage(
  plan: UninstallExecutionPlan,
  stageName: UninstallStageName,
  priorResults: UninstallStageRecord[],
): Promise<UninstallStepResult[]> {
  switch (stageName) {
    case "bootstrap": {
      const opts: BootstrapUninstallOptions = {};
      return uninstallBootstrapStage(plan.target, opts);
    }
    case "mcp": {
      const { results } = await uninstallMcpClients(plan.target);
      return results;
    }
    case "store":
      return executeUninstallStoreStage(plan.target);
    case "scaffold":
      return executeUninstallFabricPlan(plan.scaffold);
    case "validate": {
      const bootstrapRan = priorResults.some((r) => r.name === "bootstrap" && r.disposition === "ran");
      return validateUninstallCleared(plan.target, bootstrapRan);
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
  });

  if (selection === null) {
    return null;
  }

  const nextOptions: UninstallOptions = {
    ...basePlan.options,
    skipBootstrap: !selection.bootstrap,
    skipMcp: !selection.mcp,
    skipScaffold: !selection.scaffold,
    // store-unbind only runs when the user explicitly checks it.
    skipStore: !selection.store,
    skipValidate: false,
  };

  const rebuilt = await buildUninstallExecutionPlan(basePlan.target, nextOptions);
  return {
    ...rebuilt,
    interactive: false,
    supports: basePlan.supports,
  };
}

// grill-6fixes (③) + W4: the uninstall wizard mirrors the install UX — a single
// multiselect of what to remove (pre-checked per the resolved defaults, with the
// store-unbind row UNCHECKED), ONE plan summary of the selection, and ONE final
// confirm.
export function createDefaultUninstallWizardAdapter(): UninstallWizardAdapter {
  return {
    async run(context) {
      intro(t("cli.uninstall.wizard.intro"));

      const initialValues = UNINSTALL_WIZARD_KEYS.filter((key) => !isStagePlanSkipped(context.options, key));

      const picked = await multiselect<Exclude<UninstallStageName, "validate">>({
        message: t("cli.uninstall.wizard.select.prompt", { target: context.target }),
        options: UNINSTALL_WIZARD_KEYS.map((key) => ({
          value: key,
          label: t(`cli.uninstall.wizard.select.${key}.label`),
          hint: t(`cli.uninstall.wizard.select.${key}.hint`),
        })),
        initialValues,
        required: false,
      });
      if (isCancel(picked)) {
        emitUninstallWizardCancellation();
        return null;
      }

      const selected = new Set(picked as Array<Exclude<UninstallStageName, "validate">>);
      const selection: UninstallWizardSelection = {
        bootstrap: selected.has("bootstrap"),
        mcp: selected.has("mcp"),
        scaffold: selected.has("scaffold"),
        store: selected.has("store"),
      };

      // ONE plan summary of the SELECTED plan — no duplicate print.
      const previewOptions: UninstallOptions = {
        ...context.options,
        skipBootstrap: !selection.bootstrap,
        skipMcp: !selection.mcp,
        skipScaffold: !selection.scaffold,
        skipStore: !selection.store,
      };
      printUninstallPlanSummary(context.target, previewOptions, context.supports);

      // ONE final confirm.
      const confirmed = await confirm({
        message: t("cli.uninstall.wizard.execute.confirm"),
        initialValue: true,
      });
      if (isCancel(confirmed) || !confirmed) {
        emitUninstallWizardCancellation();
        return null;
      }

      outro(t("cli.uninstall.wizard.outro"));

      return selection;
    },
  };
}

function emitUninstallWizardCancellation(): void {
  cancel(t("cli.uninstall.wizard.cancelled"));
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

function stageLabel(name: UninstallStageName): string {
  return t(`cli.uninstall.pipeline.label.${name}`);
}

function renderStageHeader(
  renderer: OutputRenderer | undefined,
  name: UninstallStageName,
  stepNum: number,
  total: number,
): void {
  const label = stageLabel(name);
  if (renderer) {
    renderer.renderSection(`${UNINSTALL_STAGE_ICONS[name]} ${label}`);
    renderer.renderStep({ name: label, current: stepNum, total, status: "running" });
  } else {
    console.log(`[${stepNum}/${total}] ${label}`);
  }
}

function renderStageSkipped(
  renderer: OutputRenderer | undefined,
  name: UninstallStageName,
  stepNum: number,
  total: number,
): void {
  const label = stageLabel(name);
  if (renderer) {
    renderer.renderSection(`${UNINSTALL_STAGE_ICONS[name]} ${label}`);
    renderer.renderStep({ name: label, current: stepNum, total, status: "skipped" });
  } else {
    console.log(paint.muted(`[${stepNum}/${total}] ${label} (${t("cli.shared.skipped")})`));
  }
}

function renderStageResult(
  renderer: OutputRenderer | undefined,
  name: UninstallStageName,
  stepNum: number,
  total: number,
  steps: UninstallStepResult[],
): void {
  const removed = steps.filter((s) => s.status === "removed").length;
  const skipped = steps.filter((s) => s.status === "skipped").length;
  const errors = steps.filter((s) => s.status === "error").length;

  // Human body: result + key counts. The renderer step badge carries the status.
  const detail =
    removed === 0 && errors === 0
      ? t("cli.uninstall.stages.uptodate", { count: String(skipped) })
      : t("cli.uninstall.stages.summary", {
          removed: String(removed),
          skipped: String(skipped),
          errors: String(errors),
        });

  if (renderer) {
    renderer.renderStep({
      name: stageLabel(name),
      current: stepNum,
      total,
      status: errors > 0 ? "error" : "success",
      detail,
    });
  } else {
    const label =
      errors > 0
        ? paint.warn(t("cli.uninstall.stages.completed-with-errors"))
        : paint.success(t("cli.uninstall.stages.completed"));
    console.log(`${label} ${name}: ${detail}`);
  }
}

function renderStageFailure(
  renderer: OutputRenderer | undefined,
  name: UninstallStageName,
  stepNum: number,
  total: number,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (renderer) {
    renderer.renderStep({ name: stageLabel(name), current: stepNum, total, status: "error", detail: message });
    const info: ErrorInfo = {
      title: `${stageLabel(name)} ${t("cli.uninstall.stages.failed")}`,
      message,
      hint: t("cli.uninstall.stages.failed-hint"),
    };
    renderer.renderError(info);
  } else {
    writeStderr(`${paint.error(t("cli.uninstall.stages.failed"))} ${name}: ${message}`);
  }
}

function renderUninstallSummary(
  renderer: OutputRenderer | undefined,
  result: UninstallExecutionResult,
): void {
  const allSteps = result.stageResults.flatMap((stage) => stage.steps);
  const removed = allSteps.filter((s) => s.status === "removed").length;
  const skipped = allSteps.filter((s) => s.status === "skipped").length;
  const errors = allSteps.filter((s) => s.status === "error").length;

  // "Nothing to remove" health card — a re-uninstall where every stage skipped
  // or removed nothing. Mirrors install's idempotent health-check collapse.
  const nothingRemoved = removed === 0 && errors === 0;

  if (renderer) {
    if (nothingRemoved) {
      renderer.renderSummaryCard({
        title: t("cli.uninstall.healthcheck.title"),
        successCount: result.stageResults.filter((s) => s.disposition !== "skipped").length,
        skippedCount: result.stageResults.filter((s) => s.disposition === "skipped").length,
        errorCount: 0,
      });
    } else {
      renderer.renderSummaryCard(buildUninstallSummaryCard(result, removed, skipped, errors));
    }
    renderer.renderComplete();
  } else {
    console.log(
      t("cli.uninstall.summary.body", {
        removed: String(removed),
        skipped: String(skipped),
        errors: String(errors),
      }),
    );
  }

  // Surface error details on stderr regardless of renderer so users can react.
  for (const stage of result.stageResults) {
    for (const step of stage.steps) {
      if (step.status === "error") {
        writeStderr(
          `${paint.error(t("cli.shared.error"))} ${stage.name}/${step.step} ${step.path}: ${step.message ?? "unknown error"}`,
        );
      }
    }
  }
}

function buildUninstallSummaryCard(
  result: UninstallExecutionResult,
  removed: number,
  skipped: number,
  errors: number,
): SummaryInfo {
  const details: SummaryDetailRow[] = result.stageResults.map((stage) => {
    const stageRemoved = stage.steps.filter((s) => s.status === "removed").length;
    const stageErrors = stage.steps.filter((s) => s.status === "error").length;
    return {
      label: stageLabel(stage.name),
      value:
        stage.disposition === "skipped"
          ? t("cli.shared.skipped")
          : stageErrors > 0
            ? t("cli.uninstall.stages.summary", {
                removed: String(stageRemoved),
                skipped: String(stage.steps.filter((s) => s.status === "skipped").length),
                errors: String(stageErrors),
              })
            : t("cli.uninstall.stages.removed-count", { count: String(stageRemoved) }),
      status:
        stage.disposition === "skipped"
          ? "skipped"
          : stage.disposition === "failed"
            ? "error"
            : "success",
    };
  });

  return {
    title: t("cli.uninstall.summary.title"),
    successCount: removed,
    skippedCount: skipped,
    errorCount: errors,
    details,
  };
}

function printUninstallPlanPreview(plan: UninstallExecutionPlan): void {
  console.log(t("cli.uninstall.plan.preview-title"));
  printUninstallPlanSummary(plan.target, plan.options, plan.supports);

  // Enumerate scaffold entries for transparency. Helps the user verify what
  // will actually be touched before they commit.
  const scaffoldRuns = !isStagePlanSkipped(plan.options, "scaffold");
  if (scaffoldRuns && plan.scaffold.entries.length > 0) {
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
      bootstrap: yesNoLabel(!isStagePlanSkipped(options, "bootstrap")),
      mcp: yesNoLabel(!isStagePlanSkipped(options, "mcp")),
      scaffold: yesNoLabel(!isStagePlanSkipped(options, "scaffold")),
      store: yesNoLabel(!isStagePlanSkipped(options, "store")),
    }),
  );
  const detected = supports.filter((support) => support.detected);
  console.log(
    t("cli.uninstall.plan.detected", {
      clients: detected.length > 0 ? detected.map((support) => support.label).join(", ") : t("cli.shared.none"),
    }),
  );
  console.log(t("cli.uninstall.plan.preserves"));
  console.log(`  - ~/.fabric/stores/  ${paint.muted(t("cli.uninstall.plan.preserves.stores"))}`);
}

// -----------------------------------------------------------------------
// Misc helpers
// -----------------------------------------------------------------------

function resolvePersonalFabricRoot(): string {
  return process.env.FABRIC_HOME ?? homedir();
}

/**
 * True when `candidate` resolves to a path that is `globalStoresDir`
 * itself or sits underneath it. Used by {@link buildUninstallFabricPlan} as
 * the hard guard preventing global store paths from ever entering the
 * scaffold removal list.
 */
function isInsideGlobalStoresRoot(candidate: string, globalStoresDir: string): boolean {
  const candidateAbs = resolve(candidate);
  const rootAbs = resolve(globalStoresDir);
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

function yesNoLabel(value: boolean): string {
  return value ? t("cli.shared.yes") : t("cli.shared.no");
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

// Expose for tests / future docs commands.
export { assertExistingDirectory, isInsideGlobalStoresRoot };
