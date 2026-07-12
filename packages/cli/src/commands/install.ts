import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { log } from "@clack/prompts";
import { GenericIOError } from "@fenglimg/fabric-shared/errors";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";
import { defineCommand } from "citty";
// v2.0.0-rc.37 Wave A2: serve-lock preflight import removed. With `fabric serve`
// quarantined to packages/server-http-experimental/, no main-line process
// writes `.fabric/.serve.lock`, so the install vs serve race condition this
// guarded against can no longer happen. See KB
// [[fabric-serve-quarantine-not-delete]] for the design decision.

import { paint } from "../colors.js";
import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import type { ClaudeMcpScope } from "../config/json.js";
import { t } from "../i18n.js";
import * as configCommand from "./config.js";
import { installHooks } from "../install/hooks-orchestrator.js";
import { runGlobalInstall } from "../install/run-global-install.js";
import { loadGlobalConfig } from "../store/global-config-io.js";
import { unboundAvailableStores } from "../store/store-ops.js";
import { writeFabricAgentsSnapshot } from "../install/write-bootstrap-snapshot.js";
import { buildForensicReport } from "../scanner/forensic.js";
import { detectClientSupports, type DetectedClientSupport } from "../config/resolver.js";
import { detectPackageManager } from "../lib/package-manager.js";
export { detectPackageManager } from "../lib/package-manager.js";
import {
  nextLabel,
  reasonLabel,
  writeStderr,
} from "../install/install-labels.js";
import {
  formatInitReasonMessage,
  printInitCapabilitySummary,
  printInitPlanSummary,
  yesNoLabel,
} from "../install/install-summary.js";
import {
  formatInitStageFailure,
  formatInitStageHeader,
  formatInitStageResult,
  printInitStageSummary,
  shouldPrintHooksNextStep,
} from "../install/install-stage-output.js";
import { formatAgentsMdAction, formatInitPathAction } from "../install/install-path-output.js";
import {
  classifyFreshPath,
  diffStateToWriteAction,
  formatDiffFileState,
  installDriftAbortError,
  preparePlannedPath,
  shouldReplaceWritableDirectory,
  type DiffFileState,
} from "../install/install-diff.js";
export type { DiffFileState } from "../install/install-diff.js";
import { installLocalFabricServer, LOCAL_FABRIC_SERVER_PATH } from "../install/install-local-server.js";
import { writeDefaultFabricConfig, writeDefaultGitignore } from "../install/install-scaffold-config.js";
import {
  createDefaultInitWizardAdapter,
  type InitWizardAdapter,
  type McpInstallMode,
} from "../install/install-wizard.js";
export { createDefaultInitWizardAdapter } from "../install/install-wizard.js";
import {
  bindRemoteStoreToProject,
  enableSemanticSearchAndReport,
  promptSemanticSearch,
  promptStoreOnboarding,
} from "../install/install-onboarding.js";
export { bindCreatedStoreToProject, bindRemoteStoreToProject } from "../install/install-onboarding.js";
import {
  cleanupDeprecatedSkills,
  installArchiveHintHook,
  installCitePolicyEvictHook,
  installFabricArchiveSkill,
  installFabricReviewSkill,
  installFabricStoreSkill,
  installFabricRecallPlaybookSkill,
  installFabricSyncSkill,
  installHookLibs,
  installKnowledgeHintBroadHook,
  installKnowledgeHintNarrowHook,
  installKnowledgePretoolUseHook,
  installSessionEndMarkerHook,
  installPostTooluseMutationHook,
  installSharedSkillLib,
  mergeClaudeCodeHookConfig,
  mergeCodexHookConfig,
  writeClaudeBootstrapThinShell,
  writeCodexBootstrapManagedBlock,
  type InstallStepResult,
} from "../install/skills-and-hooks.js";

type InitArgs = {
  target?: string;
  debug?: boolean;
  yes?: boolean;
  "dry-run"?: boolean;
  // v2.1.0-rc.1 P3 (S4/S8): global multi-store install. `--global` sets up
  // ~/.fabric (uid + personal store + global config) and, when `url` is given,
  // clones + mounts that shared store. Fast-paths before the per-repo pipeline.
  global?: boolean;
  url?: string;
  // W5b: the `--force-skills-only` / `--force-hooks-only` single-slice refresh
  // flags were removed. A plain `fabric install` re-run is idempotent (the
  // install-skills-and-hooks idempotency test proves zero diff in .claude/
  // .codex and preservation of user permissions + custom hook entries),
  // so it is the safe way to absorb new skill/hook templates — no dedicated
  // escape hatch needed.
  // v2.1 ③ vector-chinese-model (P3): opt-in "enable semantic search" step.
  // Default OFF (skip path). When set, flips embed_enabled + pins embed_model in
  // fabric.config.json and prints the fastembed install + cache-warm + reindex
  // instructions. `--embed-model` overrides the light-Chinese default pin.
  "enable-embed"?: boolean;
  "embed-model"?: string;
};

export type InitOptions = {
  skipBootstrap?: boolean;
  skipMcp?: boolean;
  skipHooks?: boolean;
  planOnly?: boolean;
};

export type InitWriteAction = "created" | "overwritten";

// v2.0 follow-up (rc.1 fix #1): AGENTS.md at the repo root is the universal
// MCP-agnostic bootstrap anchor. Codex CLI and Claude Code both read
// it; doctor's `bootstrap_anchor_missing` check requires either AGENTS.md or
// CLAUDE.md to be present. We write a minimal default on a fresh init and
// PRESERVE any pre-existing file verbatim. The intent
// is "anchor exists" rather than "anchor is canonical"; once the user has
// customized the file (typically through their AI client flow), init must
// never clobber that work.
export type AgentsMdAction = "created" | "preserved";

type ClaudeHookAction = InitWriteAction | "skipped";

export type InitStageName = "bootstrap" | "mcp" | "hooks";

export type InitStageDisposition = "ran" | "skipped" | "failed";

export type InitStageRecord = {
  name: InitStageName;
  disposition: InitStageDisposition;
};

export type InitScaffoldResult = {
  // v2.0 layout: events.jsonl + forensic.json event ledgers. W5 I1 retired the
  // co-location knowledge cabinet (.fabric/knowledge/*) and agents.meta.json
  // scaffold — team knowledge now lives in a mounted store (~/.fabric/stores/
  // <uuid>/knowledge) created by `fabric store create` / `install --global`,
  // and the read path reads the store directly. AGENTS.md is also written at
  // the repo root as the universal anchor (idempotent on re-run).
  agentsMdPath: string;
  agentsMdAction: AgentsMdAction;
  eventsPath: string;
  eventsAction: InitWriteAction;
  forensicPath: string;
  forensicAction: InitWriteAction;
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
  eventsPath: string;
  eventsAction: InitWriteAction;
  forensicPath: string;
  forensicAction: InitWriteAction;
  forensicReport: Awaited<ReturnType<typeof buildForensicReport>>;
  // rc.14 TASK-002 — per-file DiffFileState classifications computed during
  // planning. Consumed by (a) the planOnly preview branch (renders a diff
  // table without writing), (b) the drift-abort gate inside
  // executeInitExecutionPlan, and (c) the diff-mode summary printed on the
  // canonical-no-op happy path.
  eventsState: DiffFileState;
  forensicState: DiffFileState;
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

// rc.19 TASK-003: root AGENTS.md ownership moved from scaffold-stage to
// bootstrap-stage. The legacy `AGENTS_MD_DEFAULT_CONTENT` constant and the
// scaffold-stage write that consumed it are deleted — the file is now
// produced (with the canonical fabric:bootstrap managed block) by
// `writeCodexBootstrapManagedBlock` in the bootstrap stage.
//
// v2/rc.2: The v1 client-side init skill (and its reminder hooks for Claude
// / Codex) was removed. rc.2/3/4 will introduce v2 skills (fabric-archive,
// fabric-review, fabric-import) with their own templates and wiring; until
// then `fabric install` only emits MCP-agnostic state (knowledge dirs, AGENTS.md,
// forensic.json, events.jsonl).
export const installCommand = defineCommand({
  meta: {
    name: "install",
    description: t("cli.install.description"),
  },
  args: {
    debug: {
      type: "boolean",
      description: t("cli.install.args.debug.description"),
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: t("cli.install.args.dry-run.description"),
      default: false,
    },
    target: {
      type: "string",
      description: t("cli.install.args.target.description"),
    },
    yes: {
      type: "boolean",
      description: t("cli.install.args.yes.description"),
      default: false,
    },
    global: {
      type: "boolean",
      description: "Set up global Fabric (~/.fabric: uid + personal store + config)",
      default: false,
    },
    url: {
      type: "string",
      description:
        "Clone + mount a shared store remote. In a project install: also binds it to this project and sets it as the write target. With --global: mounts it machine-wide only.",
    },
    "enable-embed": {
      type: "boolean",
      description: t("cli.install.args.enable-embed.description"),
      default: false,
    },
    "embed-model": {
      type: "string",
      description: t("cli.install.args.embed-model.description"),
    },
  },
  async run({ args }: { args: InitArgs }) {
    await runInitCommand(args);
  },
});

export default installCommand;


export async function runInitCommand(args: InitArgs): Promise<InitExecutionResult | void> {
  const logger = createDebugLogger(args.debug);

  // W3: `--global` is the "Layer 1 only" modifier — set up the machine-wide
  // global home (uid + personal store + config) and, with a url, mount a shared
  // store machine-wide. It does NOT touch any project (no scaffold / bind /
  // client wiring). A bare `fabric install` (below) instead ensures Layer 1
  // exists (minting it when absent, 1a) and then runs the per-repo Layer 2/3.
  // So global is not a separate command — it is one layer of the same install.
  if (args.global === true) {
    await runGlobalInstall({ url: args.url });
    return;
  }

  const resolution = resolveDevMode(args.target, process.cwd());

  // W5b: the --force-skills-only / --force-hooks-only single-slice fast-paths
  // were removed. Absorbing new skill/hook templates is done by re-running the
  // full `fabric install`, which is idempotent (zero diff on unchanged
  // artifacts, preserves user-customised hooks/settings).

  const intent = resolveInitCliIntent(args, resolution.target);

  // v2.0.0-rc.37 Wave A2: rc.15 serve-lock preflight removed alongside
  // `fabric serve` quarantine. No main-line process writes `.fabric/.serve.lock`
  // any more, so the install-vs-serve race this guarded against cannot occur.
  // Legacy lock files left over from rc ≤36 will be reaped by the doctor's
  // stale-serve-lock advisory + `fabric doctor --fix` unlink path.

  logger(`init target source: ${resolution.source}`);
  for (const step of resolution.chain) {
    logger(step);
  }

  // v2.2 全砍 Stage 1 (1a): the write path is going store-only — a per-repo
  // install MUST guarantee a global config + personal store exists, otherwise
  // the first knowledge write would hard-fail with no resolvable target. Mint
  // the global home (uid + personal store + config) idempotently when absent.
  // runGlobalInstall is a no-op ("already installed") when it is already there.
  if (loadGlobalConfig() === null) {
    logger("no global Fabric config found — minting ~/.fabric (uid + personal store)");
    await runGlobalInstall({});
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
    ? await resolveInitExecutionPlanWithWizard(basePlan, createDefaultInitWizardAdapter())
    : basePlan;

  if (plan === null) {
    process.exitCode = 130;
    return;
  }

  const result = await executeInitExecutionPlan(plan);
  // rc.7 T3: surfaces-doc cross-reference footer. Printed unconditionally
  // on the success path (plan-only excepted) so users discover the
  // CLI/Skill/MCP boundary doc the first time they install Fabric. The
  // line is intentionally a single console.log — paint.muted-only so it
  // doesn't compete with the capability table above it.
  if (!intent.options.planOnly) {
    // v2.0.0-rc.38 UX-10 (onboarding cliff fix): bridge the "installed → first
    // value" gap. Both ≥2 LLM fresh-eyes judges rated reach <30% because the
    // success output stated status but never the next action that gets the user
    // to value. This concrete 3-step block closes that cliff.
    console.log("");
    console.log(t("cli.install.next-steps"));
    console.log("");
    console.log(paint.muted("More: docs/surfaces.md explains when to use CLI vs Skill vs MCP."));

    // W1 (install --url top-level): one-command "join a team store". Mount the
    // remote store globally (idempotent — reuse an already-mounted clone of the
    // same remote), bind it to this project, and set it as the active write
    // target. Replaces the old two-step
    // `install --global --url … && store bind … && store switch-write …`.
    // Runs BEFORE the unbound-store nudge below so the freshly-bound store is
    // not then reported as unbound.
    if (typeof args.url === "string" && args.url.length > 0) {
      await bindRemoteStoreToProject(resolution.target, args.url);
    } else if (intent.wizardEnabled) {
      // W2: interactive store onboarding. Only in the guided (TTY, non --yes)
      // flow and only when --url did not already handle it. The non-interactive
      // equivalents are `--url` (join) and the `store create` subcommand.
      await promptStoreOnboarding(resolution.target);
    }

    // Wave A (D4/F3 onboarding nudge): a team/shared store is mounted globally
    // but this project never bound it, so its knowledge stays invisible to
    // recall and team writes fall back to the deprecated co-location path.
    // Surface a reminder pointing at `store bind` (+ switch-write). Reminder
    // only — never blocks the install (KT-DEC-0007).
    const unboundStores = unboundAvailableStores(resolution.target);
    if (unboundStores.length > 0) {
      console.log("");
      console.log(
        t("cli.install.store-bind-nudge", {
          aliases: unboundStores.map((s) => `'${s.alias}'`).join(", "),
          first: unboundStores[0].alias,
        }),
      );
    }

    // v2.1 ③ vector-chinese-model (P3): opt-in semantic search (L3 step).
    // Default OFF (never touches embed config). Two entry points:
    //   - non-interactive: `--enable-embed` flag (optionally `--embed-model`).
    //   - interactive (W5): a wizard step offering to enable it.
    if (args["enable-embed"] === true) {
      enableSemanticSearchAndReport(resolution.target, args["embed-model"]);
    } else if (intent.wizardEnabled) {
      await promptSemanticSearch(resolution.target);
    }
  }
  return result;
}

function resolveInitCliIntent(args: InitArgs, targetInput: string): InitCliIntent {
  const target = normalizeTarget(targetInput);
  const mcpInstallMode: McpInstallMode = "global";
  const claudeMcpScope: ClaudeMcpScope = "project";
  const terminalInteractive = isInteractiveInit();
  const planOnly = args["dry-run"] === true;
  const options: InitOptions = {
    planOnly,
  };

  return {
    target,
    options,
    mcpInstallMode,
    claudeMcpScope,
    interactiveSummary: terminalInteractive,
    wizardEnabled: shouldUseInitWizard(args, terminalInteractive) && !planOnly,
  };
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
  if (plan.interactive) {
    printInitPlanSummary(plan.target, plan.options, plan.mcpInstallMode, plan.supports);
  }

  // rc.15 (formerly rc.14 TASK-002) — diff-mode classification table is
  // rendered in BOTH the planOnly preview branch (always) and the no-op
  // canonical confirmation path (below). For planOnly we exit 0 regardless
  // of drift; for the mutation path we abort unconditionally if drift is
  // detected.
  const scaffoldStates: Array<{ path: string; state: DiffFileState }> = [
    { path: plan.scaffold.eventsPath, state: plan.scaffold.eventsState },
    { path: plan.scaffold.forensicPath, state: plan.scaffold.forensicState },
  ];

  if (plan.options.planOnly) {
    printInitPlanPreview(plan);
    printInitDiffStateTable(scaffoldStates);
    return {
      plan,
      created: buildPlanOnlyScaffoldResult(plan.scaffold),
      stageResults: plan.stages.map((stage) => ({ name: stage.name, disposition: "skipped" })),
      finalSupports: plan.supports,
    };
  }

  // rc.15 (formerly rc.14 TASK-004 Finding 1) — type-collision pre-check.
  // If `.fabric` itself exists as a non-directory (regular file, symlink to
  // a non-dir, etc.), the per-inner-file classifier marks every inner path
  // as "missing" (because existsSync(".fabric/events.jsonl") returns
  // false when ".fabric" is a file), which bypasses the per-file drift-abort
  // gate below and leads to mkdirSync raising native ENOTDIR/EEXIST at
  // write time. Surface the friendly drift-abort message instead — recovery
  // from a file-where-dir-belongs is `fabric uninstall && fabric install`.
  if (
    existsSync(plan.scaffold.fabricDir)
    && !statSync(plan.scaffold.fabricDir).isDirectory()
  ) {
    throw installDriftAbortError(plan.scaffold.fabricDir);
  }

  // rc.15 (formerly rc.14 TASK-002) — unconditional drift-abort gate. Fires
  // at mutation time (i.e. not planOnly) when any scaffold path is in a
  // non-canonical state. No legacy escape hatch — the message points to
  // `fabric doctor` (inspect) and `fabric uninstall && fabric install` (reset).
  const drifted = scaffoldStates.find(
    (entry) => entry.state === "drifted" || entry.state === "user-modified",
  );
  if (drifted !== undefined) {
    throw installDriftAbortError(drifted.path);
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

  // rc.15 (formerly rc.14 TASK-002) — canonical-no-op one-line confirmation.
  // Printed when every scaffold-stage path was already canonical. Better UX
  // than silent success for users still learning the workflow.
  if (scaffoldStates.every((entry) => entry.state === "present-canonical")) {
    console.log(
      t("cli.install.diff.canonical", { count: String(scaffoldStates.length) }),
    );
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
  const agentsMdPath = join(target, "AGENTS.md");
  // v2.0 follow-up (rc.1 fix #1): AGENTS.md write is always idempotent —
  // we write the default only when the file is absent and never overwrite
  // existing content. Capturing the action up front keeps the result schema
  // deterministic for callers/tests.
  const agentsMdAction: AgentsMdAction = existsSync(agentsMdPath) ? "preserved" : "created";
  const forensicPath = join(fabricDir, "forensic.json");
  const eventsPath = join(fabricDir, "events.jsonl");

  const replaceFabricDir = shouldReplaceWritableDirectory(fabricDir, options);

  // rc.15 (formerly rc.14 TASK-002) — diff-mode classification. NEVER throws
  // during planning. The drift-abort gate inside `executeInitExecutionPlan`
  // is the single throw site, and it only fires when actually writing
  // (i.e. not planOnly) and at least one path is drifted/user-modified.
  const eventsClassification = classifyFreshPath(eventsPath, "presence");
  const forensicClassification = classifyFreshPath(forensicPath, "always-rewrite");

  const eventsAction = diffStateToWriteAction(eventsClassification.state);
  const forensicAction = diffStateToWriteAction(forensicClassification.state);

  // ISS-035: the forensic scan recursively walks the tree + lazily loads
  // tree-sitter parsers, so on a large repo the wizard looked frozen between
  // the target and plan steps. Emit a progress nudge to stderr — gated on a
  // TTY so piped/CI/test/dry-run-capture contexts stay silent (no snapshot
  // churn) while interactive users get feedback.
  const showScanProgress = process.stderr.isTTY === true;
  if (showScanProgress) {
    process.stderr.write(`${t("cli.install.scanning")}\n`);
  }
  const forensicReport = await buildForensicReport(target);
  if (showScanProgress) {
    process.stderr.write(`${t("cli.install.scan-complete")}\n`);
  }
  return {
    target,
    options,
    fabricDir,
    replaceFabricDir,
    agentsMdPath,
    agentsMdAction,
    eventsPath,
    eventsAction,
    forensicPath,
    forensicAction,
    forensicReport,
    eventsState: eventsClassification.state,
    forensicState: forensicClassification.state,
  };
}

export async function executeInitFabricPlan(plan: InitScaffoldPlan): Promise<InitScaffoldResult> {
  if (plan.replaceFabricDir) {
    rmSync(plan.fabricDir, { force: true });
  }

  mkdirSync(plan.fabricDir, { recursive: true });

  // Scaffold a discoverable default fabric-config.json listing every
  // reader-consumed field at its documented default. Idempotent: never
  // overwrites pre-existing user edits. See the helper's JSDoc for the
  // source-of-truth field list. TASK-006 (C1): the helper now also probes
  // plan.target's README/docs to fixate fabric_language on fresh init.
  writeDefaultFabricConfig(plan.fabricDir, plan.target);

  // ISS-042: ignore the per-dev activity ledgers/caches that install + runtime
  // generate under .fabric/ so they are never accidentally committed.
  writeDefaultGitignore(plan.fabricDir);

  // rc.19 TASK-003: root AGENTS.md is no longer written in the scaffold
  // stage. Ownership moved to `writeCodexBootstrapManagedBlock` in the
  // bootstrap stage so the canonical fabric:bootstrap managed block is
  // included on the first write rather than retroactively patched in by
  // the section writer. `plan.agentsMdAction` / `plan.agentsMdPath` are
  // still computed and surfaced through the install reporter for parity
  // with other anchors, but the file itself is created downstream.

  // W5 I1: no longer scaffold the co-location knowledge cabinet
  // (.fabric/knowledge/{decisions,pitfalls,...}/ with .gitkeep markers) nor
  // the empty agents.meta.json counter envelope. Team knowledge now lives in
  // a mounted store (~/.fabric/stores/<uuid>/knowledge) created by
  // `fabric store create` / `install --global`; the read path reads the store
  // directly. The retired co-location agents.meta derived index had no writer
  // and no reader after the W5 read-side cutover, so scaffolding it produced a
  // dead artifact. The personal dual-root (~/.fabric/knowledge) was already
  // retired in v2.2 (B2 cutover) — personal knowledge lives in the personal
  // STORE minted by `install --global`.

  // rc.15 (formerly rc.14 TASK-002) — diff-mode write semantics for the
  // two remaining scaffold files. drifted/user-modified states are intercepted
  // by the drift-abort gate upstream; only missing → write, present-canonical
  // → skip survives here.
  //
  //   events.jsonl:     presence-canonical. Existing files are preserved
  //                     verbatim (append-only ledger). Only create when missing.
  //   forensic.json:    always-rewrite. The file is a snapshot regenerated
  //                     every run regardless of diff classification.

  // events.jsonl preservation: under diff-mode default we preserve any
  // existing file byte-identically. Only create when missing.
  if (plan.eventsState === "missing") {
    preparePlannedPath(plan.eventsPath, plan.eventsAction);
    writeFileSync(plan.eventsPath, "", "utf8");
  }
  // events.jsonl present-canonical → no write, preserves ledger.

  // forensic.json: always rewrite — it's a snapshot, not user state.
  preparePlannedPath(plan.forensicPath, plan.forensicAction);
  await atomicWriteJson(plan.forensicPath, plan.forensicReport);

  // W5 I1: install no longer scaffolds any knowledge cabinet or agents.meta
  // index. KB on fresh install lives in mounted stores; the install scaffold
  // is purely the event ledgers + AGENTS.md anchor + client bootstrap.

  // rc.15 (formerly rc.14 TASK-002) — diff-mode emits install_diff_applied
  // with a per-file breakdown so doctor/forensic tooling can see whether
  // the run was a no-op, restored missing pieces, or applied drift overwrites.
  if (existsSync(plan.eventsPath)) {
    const applied: string[] = [];
    const canonical: string[] = [];
    const drifted: string[] = [];
    for (const entry of [
      { path: plan.eventsPath, state: plan.eventsState },
      { path: plan.forensicPath, state: plan.forensicState },
    ]) {
      if (entry.state === "missing") {
        applied.push(entry.path);
      } else if (entry.state === "present-canonical") {
        canonical.push(entry.path);
      } else {
        drifted.push(entry.path);
      }
    }
    appendInstallDiffLedgerEvent(plan.eventsPath, { applied, canonical, drifted });
  }

  return {
    agentsMdPath: plan.agentsMdPath,
    agentsMdAction: plan.agentsMdAction,
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
  args: Pick<InitArgs, "yes">,
  terminalInteractive = isInteractiveInit(),
): boolean {
  return terminalInteractive && args.yes !== true;
}

export async function resolveInitExecutionPlanWithWizard(
  basePlan: InitExecutionPlan,
  wizardAdapter: InitWizardAdapter,
): Promise<InitExecutionPlan | null> {
  const selection = await wizardAdapter.run({
    target: basePlan.target,
    options: basePlan.options,
    supports: basePlan.supports,
    mcpInstallMode: basePlan.mcpInstallMode,
    claudeMcpScope: basePlan.claudeMcpScope,
    lockedStages: [],
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
      t("cli.install.next-step", {
        label: nextLabel(),
        message: paint.muted(t("cli.install.next-step.message")),
      }),
    );
  }

  console.log(
    t("cli.install.reason-message", {
      label: reasonLabel(),
      message: paint.muted(formatInitReasonMessage(finalSupports)),
    }),
  );
  printInitStageSummary(stageResults);
  printInitCapabilitySummary(finalSupports, stageResults, plan.options);

  // grill-6fixes (D1): the install-end "Fabric 语言偏好：{value}" hint was
  // removed. Language is the single machine-wide tone picked once by the
  // install language selector (StoreStage), not surfaced as a per-install
  // preference line here.
}

// rc.14 TASK-002 — diff-mode classification table rendered in --dry-run and
// (optionally) on the canonical-no-op path. Each row maps a scaffold path to
// its DiffFileState label so the user sees which files are missing /
// canonical / drifted without any writes.
function printInitDiffStateTable(entries: Array<{ path: string; state: DiffFileState }>): void {
  for (const entry of entries) {
    console.log(`  ${formatDiffFileState(entry.state)}  ${entry.path}`);
  }
}

function printInitPlanPreview(plan: InitExecutionPlan): void {
  console.log(t("cli.install.plan.preview-title"));
  printInitPlanSummary(plan.target, plan.options, plan.mcpInstallMode, plan.supports);
  console.log(
    t("cli.install.plan.preview-result", {
      mode: t("cli.install.mode.default"),
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

  console.log(formatInitStageHeader(t(`cli.install.stages.${stageName}`)));

  try {
    switch (stage.name) {
      case "bootstrap": {
        // v2/rc.2+rc.3+rc.4+rc.5: bootstrap installs the fabric-archive /
        // fabric-review / fabric-import Skill templates + fabric-hint Stop
        // hook script (rc.5 TASK-010 rename from archive-hint) + per-client
        // hook configs across both supported clients (claude / codex)
        // + the pointer line in CLAUDE.md / AGENTS.md. Each step
        // is best-effort: a single failure (e.g. one client's directory is
        // unreadable) is logged but does not abort init — other clients
        // and downstream stages continue.
        const installResults: InstallStepResult[] = [];
        // rc.35 TASK-03 (P2-6): remove deprecated skill subtrees (e.g.
        // fabric-init) before installing modern skills, so rc.30 → rc.35
        // upgraders see deprecation cleanup as part of the install diff.
        installResults.push(...await runBestEffort("skill-deprecated-cleanup", () => cleanupDeprecatedSkills(plan.target)));
        // W3-C: 5-skill terminal set (0 router) — archive (real, +source mode) /
        // review (real, +retire +relate) / sync / store (thin shims) + shared lib.
        installResults.push(...await runBestEffort("skill-install", () => installFabricArchiveSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-review-install", () => installFabricReviewSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-sync-install", () => installFabricSyncSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-store-install", () => installFabricStoreSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-recall-playbook-install", () => installFabricRecallPlaybookSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-shared-lib", () => installSharedSkillLib(plan.target)));
        installResults.push(...await runBestEffort("hook-script", () => installArchiveHintHook(plan.target)));
        // rc.6 TASK-019 (E1): SessionStart broad-injection hook script.
        installResults.push(...await runBestEffort("hook-broad-script", () => installKnowledgeHintBroadHook(plan.target)));
        // rc.6 TASK-020 (E2 + E4): PreToolUse narrow-injection hook + edit-counter sidecar.
        installResults.push(...await runBestEffort("hook-narrow-script", () => installKnowledgeHintNarrowHook(plan.target)));
        // F4: rc.34 TASK-06 UserPromptSubmit cite-policy-evict.cjs. The hook
        // CONFIG merges below register it across both clients, but the
        // bootstrap stage previously never copied the SCRIPT — so a
        // bootstrap-only install (e.g. init without the downstream `hooks`
        // stage) left configs pointing at a missing file. Inlined here too,
        // mirroring the hook-config note below.
        installResults.push(...await runBestEffort("hook-cite-policy-evict-script", () => installCitePolicyEvictHook(plan.target)));
        // ux-w2-6: the single PreToolUse orchestrator (the config wires THIS;
        // narrow + cite above are its runtime libs). Copy it here too so a
        // bootstrap-only install doesn't leave the config pointing at a missing file.
        installResults.push(...await runBestEffort("hook-pretooluse-script", () => installKnowledgePretoolUseHook(plan.target)));
        // lifecycle-refactor W2-T2/T3: SessionEnd + PostToolUse marker hook
        // scripts. Mirror the sibling hook-script copies (config merges below
        // register these events; the SCRIPT must be on disk for a bootstrap-
        // only install too, else configs point at a missing file).
        installResults.push(...await runBestEffort("hook-session-end-script", () => installSessionEndMarkerHook(plan.target)));
        installResults.push(...await runBestEffort("hook-post-tooluse-script", () => installPostTooluseMutationHook(plan.target)));
        // rc.16 TASK-004 (F2-tests): copy shared hook-lib helpers
        // (banner-i18n.cjs, session-digest-writer.cjs) into each client's
        // <client>/hooks/lib/ directory. Same best-effort discipline as the
        // sibling hook-script copies; missing lib files would crash the
        // Stop hook at runtime in user workspaces (banner-i18n is hard-
        // required from fabric-hint.cjs and knowledge-hint-broad.cjs).
        installResults.push(...await runBestEffort("hook-lib", () => installHookLibs(plan.target)));
        installResults.push(await runBestEffortSingle("claude-hook-config", () => mergeClaudeCodeHookConfig(plan.target)));
        installResults.push(await runBestEffortSingle("codex-hook-config", () => mergeCodexHookConfig(plan.target)));
        // rc.19 TASK-002: L1 bootstrap snapshot — materialize the canonical
        // `.fabric/AGENTS.md` from BOOTSTRAP_CANONICAL. Idempotent + atomic.
        // This snapshot is the source-of-truth that the three propagation
        // writers below fan out into per-client thin shells.
        installResults.push(await runBestEffortSingle("bootstrap-snapshot", () => writeFabricAgentsSnapshot(plan.target)));
        // rc.19 TASK-003: two-end propagation. Each writer consumes the L1
        // snapshot (plus optional `.fabric/project-rules.md`) and writes the
        // appropriate per-client output:
        //   - Claude Code: real `@`-import directives in CLAUDE.md
        //   - Codex CLI:   byte-copy managed block in root AGENTS.md
        installResults.push(await runBestEffortSingle("bootstrap-claude", () => writeClaudeBootstrapThinShell(plan.target)));
        installResults.push(await runBestEffortSingle("bootstrap-codex", () => writeCodexBootstrapManagedBlock(plan.target)));
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
          writeStderr(t("cli.install.mcp.install.local"));
          writeStderr(t("cli.install.mcp.local.installing", { manager }));
          installLocalFabricServer(plan.target, manager);
          writeStderr(t("cli.install.mcp.local.installed"));
        } else {
          writeStderr(t("cli.install.mcp.install.global"));
        }

        const result = await configCommand.installMcpClients(plan.target, {
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
        // ISS-20260711-257: installHooks is best-effort and returns errors[]
        // without throwing. Mirror the v2 hooks.stage — surface failures and
        // mark the stage failed so operators don't see a green "completed/ran"
        // when hook scripts or path validation actually errored.
        const result = await installHooks(plan.target);
        for (const err of result.errors) {
          writeBound(`hooks ${err}`);
        }
        if (result.errors.length > 0) {
          console.log(
            formatInitStageResult(
              "hooks",
              "completed",
              result.installed.length,
              result.skipped.length,
              `errors=${result.errors.length}`,
            ),
          );
          return { name: "hooks", disposition: "failed" };
        }
        console.log(
          formatInitStageResult("hooks", "completed", result.installed.length, result.skipped.length),
        );
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


function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new GenericIOError(t("cli.shared.target-invalid", { target }), {
      actionHint: t("cli.shared.target-invalid.action-hint", { target }),
      details: { target },
    });
  }
}

/**
 * rc.15 (formerly rc.14 TASK-002) — emit `install_diff_applied` per install run.
 *
 * The payload's three buckets cover the full scaffold-stage diff classification
 * (every scaffold path lands in exactly one). Doctor / forensic tooling can
 * read these events to surface idempotent re-runs vs. apply-missing-pieces
 * runs without re-running the classifier. The legacy `reapply_completed`
 * event type was retired in rc.15 along with --reapply itself.
 */
function appendInstallDiffLedgerEvent(
  eventsPath: string,
  payload: { applied: string[]; canonical: string[]; drifted: string[] },
): void {
  const event = {
    kind: "fabric-event",
    id: `event:${randomUUID()}`,
    ts: Date.now(),
    schema_version: 1,
    event_type: "install_diff_applied",
    applied: payload.applied,
    canonical: payload.canonical,
    drifted: payload.drifted,
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

function isInteractiveInit(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
}
