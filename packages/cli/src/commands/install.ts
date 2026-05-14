import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import * as childProcess from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { detectExistingLanguage, runInitScan, type ResolvedLanguage } from "./scan.js";
import { buildForensicReport } from "../scanner/forensic.js";
import { detectClientSupports, type DetectedClientSupport } from "../config/resolver.js";
import {
  addFabricKnowledgeBaseSection,
  installArchiveHintHook,
  installFabricArchiveSkill,
  installFabricImportSkill,
  installFabricReviewSkill,
  installKnowledgeHintBroadHook,
  installKnowledgeHintNarrowHook,
  mergeClaudeCodeHookConfig,
  mergeCodexHookConfig,
  mergeCursorHookConfig,
  readFabricLanguagePreference,
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

// rc.14 TASK-002 (Bug V + Bug Z) — diff-mode classification.
//
// `DiffFileState` is the per-file classification computed during
// `buildInitFabricPlan` (non-throwing) and consumed during
// `executeInitExecutionPlan` (gates writes and abort behavior). It is
// intentionally separate from `InitWriteAction` ("created" | "overwritten")
// so that the existing `formatInitPathAction` switch stays exhaustive and
// the rendering boundary translates state -> write action at exactly one
// point (executeInitFabricPlan, when actually writing).
//
//   - "missing"           : path absent on disk; canonical write proceeds
//   - "present-canonical" : on-disk content matches the canonical state
//                           (per the per-file detection rule); no write
//   - "drifted"           : on-disk content differs from canonical state
//                           (byte-mismatch or structural-mismatch); without
//                           --force, the run aborts with a helpful message
//   - "user-modified"     : managed location holds something canonically
//                           unexpected (e.g. .fabric/ is a file, agents.meta
//                           .json fails to parse as AgentsMeta); same abort
//                           semantics as "drifted" without --force
export type DiffFileState =
  | "missing"
  | "present-canonical"
  | "drifted"
  | "user-modified";

// rc.14 TASK-002 — per-file detection strategy. Each scaffold-stage path
// uses one of these strategies in classifyFreshPath():
//
//   - "presence"       : any existing file is canonical (e.g. events.jsonl
//                        which is an append-only ledger)
//   - "structural"     : parse as JSON, sanity-check schema fields; do NOT
//                        byte-compare (e.g. agents.meta.json which mutates
//                        immediately after install via runInitScan)
//   - "always-rewrite" : the file is a snapshot, never user-edited — always
//                        treat the existing file as canonical for diff but
//                        always rewrite at the write boundary (e.g.
//                        forensic.json)
type DiffDetectStrategy = "presence" | "structural" | "always-rewrite";

type ClassifiedFreshPathResult = {
  path: string;
  state: DiffFileState;
  reason?: string;
};

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
  // rc.14 TASK-002 — per-file DiffFileState classifications computed during
  // planning. Consumed by (a) the planOnly preview branch (renders a diff
  // table without writing), (b) the drift-abort gate inside
  // executeInitExecutionPlan, and (c) the diff-mode summary printed on the
  // canonical-no-op happy path.
  metaState: DiffFileState;
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
// then `fab install` only emits MCP-agnostic state (knowledge dirs, AGENTS.md,
// forensic.json, events.jsonl).
const LOCAL_FABRIC_SERVER_PATH = join("node_modules", "@fenglimg", "fabric-server", "dist", "index.js");
const FABRIC_SERVER_PACKAGE = "@fenglimg/fabric-server";
const INIT_WIZARD_GROUP_CANCELLED = Symbol("init-wizard-group-cancelled");

export const installCommand = defineCommand({
  meta: {
    name: "install",
    description: t("cli.install.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.install.args.target.description"),
    },
    debug: {
      type: "boolean",
      description: t("cli.install.args.debug.description"),
      default: false,
    },
    force: {
      type: "boolean",
      description: t("cli.install.args.force.description"),
      default: false,
    },
    yes: {
      type: "boolean",
      description: t("cli.install.args.yes.description"),
      default: false,
    },
    plan: {
      type: "boolean",
      description: t("cli.install.args.plan.description"),
      default: false,
    },
    reapply: {
      type: "boolean",
      description: t("cli.install.args.reapply.description"),
      default: false,
    },
    bootstrap: {
      type: "boolean",
      default: true,
      negativeDescription: t("cli.install.args.no-bootstrap.description"),
    },
    mcp: {
      type: "boolean",
      default: true,
      negativeDescription: t("cli.install.args.no-mcp.description"),
    },
    hooks: {
      type: "boolean",
      default: true,
      negativeDescription: t("cli.install.args.no-hooks.description"),
    },
    interactive: {
      type: "boolean",
      description: t("cli.install.args.interactive.description"),
      default: true,
    },
    "mcp-install": {
      type: "string",
      default: "global",
      description: t("cli.install.mcp.install.prompt"),
    },
    scope: {
      type: "string",
      description: t("cli.install.mcp.scope.description"),
    },
  },
  async run({ args }: { args: InitArgs }) {
    await runInitCommand(args);
  },
});

export default installCommand;

export async function runInitCommand(args: InitArgs): Promise<InitExecutionResult | void> {
  const logger = createDebugLogger(args.debug);
  const resolution = resolveDevMode(args.target, process.cwd());
  const intent = resolveInitCliIntent(args, resolution.target);

  // rc.14 TASK-002 — Preflight lock check expanded from --reapply-only to
  // ALL install runs on an already-initialized workspace. Diff-mode default
  // appends ledger events on every run (install_diff_applied) which opens
  // events.jsonl, so a running `fab serve` holding the lock would race the
  // write. --force is the legitimate bypass for the legacy escape hatch.
  const fabricInitialized = existsSync(join(intent.target, ".fabric", "events.jsonl"));
  if (args.reapply === true || fabricInitialized) {
    checkLockOrThrow(intent.target, { force: args.force });
  }

  logger(`init target source: ${resolution.source}`);
  for (const step of resolution.chain) {
    logger(step);
  }

  if (intent.options.planOnly) {
    writeStderr(t("cli.install.compat.plan"));
  }

  if (args.interactive === false) {
    writeStderr(t("cli.install.compat.interactive"));
  }

  if (args.bootstrap === false || args.mcp === false || args.hooks === false) {
    writeStderr(t("cli.install.compat.legacy-stage-flags"));
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

  const result = await executeInitExecutionPlan(plan);
  // rc.7 T3: surfaces-doc cross-reference footer. Printed unconditionally
  // on the success path (plan-only excepted) so users discover the
  // CLI/Skill/MCP boundary doc the first time they install Fabric. The
  // line is intentionally a single console.log — paint.muted-only so it
  // doesn't compete with the capability table above it.
  if (!intent.options.planOnly) {
    console.log(paint.muted("More: docs/surfaces.md explains when to use CLI vs Skill vs MCP."));
  }
  return result;
}

/**
 * Scaffold a default `.fabric/fabric-config.json` containing every
 * reader-consumed config field with its documented default value.
 *
 * Source-of-truth for the field list:
 *   - packages/shared/src/schemas/fabric-config.ts (Zod schema with defaults)
 *   - packages/cli/templates/hooks/fabric-hint.cjs (the readers themselves —
 *     `_readConfigNumber`, `readArchiveHintHours`, `readReviewHintPendingCount`,
 *     `readReviewHintPendingAgeDays`, `readMaintenanceHintDays`,
 *     `readMaintenanceHintCooldownDays`, `readCooldownHours`,
 *     `readUnderseedThreshold`, plus `readArchiveEditThreshold`)
 *
 * MAINTENANCE NOTE: when adding a new reader for a new fabric-config.json
 * field, add the field to FABRIC_CONFIG_DEFAULTS below too — otherwise it
 * remains invisible to fresh-init users (silent default-on-missing).
 *
 * The `fabric_language` field is fixated at init time (TASK-006 / C1):
 * we invoke scan.ts's `detectExistingLanguage(targetRoot)` once on a fresh
 * init, which scans `README.md` + `docs/*.md` for the CJK ratio and resolves
 * to `"zh-CN"` (ratio > 0.3) or `"en"` (default). The literal
 * `"match-existing"` placeholder is no longer written — users who want a
 * different language flip the field to `"zh-CN"` or `"en"` after init. The
 * empty-repo default is `"en"` (matches `detectExistingLanguage`'s contract).
 *
 * Idempotent: writes ONLY when the file does not exist. NEVER merges
 * missing fields into an existing file. NEVER overwrites user edits.
 * Both the regular init path AND the `--reapply` path share this helper
 * with identical semantics — re-runs preserve user customisations
 * verbatim.
 */
function writeDefaultFabricConfig(fabricDir: string, targetRoot: string): void {
  const target = join(fabricDir, "fabric-config.json");
  if (existsSync(target)) return;

  // TASK-006 (C1): probe README + docs to fixate fabric_language on a
  // fresh init. The detector accepts the project-root path and returns
  // "zh-CN" or "en" — never "match-existing". Idempotency is preserved by
  // the early return above: existing user configs are never overwritten.
  const detectedLanguage: ResolvedLanguage = detectExistingLanguage(targetRoot);

  const FABRIC_CONFIG_DEFAULTS = {
    // Scan/import language policy. Fixated at init time by probing
    // README.md + docs/*.md (CJK ratio > 0.3 → "zh-CN", else "en"). Users
    // can edit `.fabric/fabric-config.json` to override. See
    // packages/shared/src/schemas/fabric-config.ts for the enum.
    fabric_language: detectedLanguage,
    // fabric-hint Stop hook Signal A (archive): time-branch threshold, hours
    // since last knowledge_proposed event.
    archive_hint_hours: 24,
    // fabric-hint Stop hook cooldown after ANY signal fires, in hours.
    archive_hint_cooldown_hours: 12,
    // fabric-hint Stop hook Signal B (review): pending-count cutoff.
    review_hint_pending_count: 10,
    // fabric-hint Stop hook Signal B (review): pending-age cutoff in days.
    review_hint_pending_age_days: 7,
    // fabric-hint Stop hook Signal D (maintenance): days since last doctor.
    maintenance_hint_days: 14,
    // fabric-hint Stop hook Signal D (maintenance): cooldown between
    // reminders, in days.
    maintenance_hint_cooldown_days: 7,
    // fabric-hint Stop hook Signal A (archive): edit-count branch threshold;
    // PreToolUse fires recorded in .fabric/.cache/edit-counter since the
    // last knowledge_proposed event.
    archive_edit_threshold: 20,
    // fabric-hint Stop hook Signal C (import) + doctor lint #22: canonical
    // knowledge node count below this value flags an underseeded workspace.
    underseed_node_threshold: 10,
    // rc.9+ (skill-contract-fix B1): fabric-import first-run git-history
    // window in months. Default 60 captures the bulk of a mature repo's
    // signal in one pass; lower to 12-24 for fresh / small repos.
    import_window_first_run_months: 60,
    // rc.9+ (skill-contract-fix B1): fabric-import rerun window in months.
    // Default 2; raise to 6 if the workspace pauses imports for long stretches.
    import_window_rerun_months: 2,
    // rc.9+ (skill-contract-fix B1): hard cap on pending entries produced
    // per fabric-import invocation. Default 10 matches one-sitting triage.
    import_max_pending_per_run: 10,
    // rc.9+ (skill-contract-fix B1): hard cap on commits scanned per
    // fabric-import invocation. Default 500 covers ~2 months of typical churn.
    import_max_commits_scan: 500,
    // rc.9+ (skill-contract-fix B1): canonical-node count above which
    // fabric-import suggests review over importing more. Default 50.
    import_skip_canonical_threshold: 50,
    // rc.9+ (skill-contract-fix B1): max candidates per fabric-archive batch.
    // Default 8 keeps each batch reviewable in one sitting.
    archive_max_candidates_per_batch: 8,
    // rc.9+ (skill-contract-fix B1): max recently-touched paths in
    // fabric-archive's relevance digest. Default 20.
    archive_max_recent_paths: 20,
    // rc.9+ (skill-contract-fix B1): max prior fabric-archive sessions
    // summarised in the digest the skill loads on start. Default 10.
    archive_digest_max_sessions: 10,
    // rc.9+ (skill-contract-fix B1): max review results per topic cluster
    // in fabric-review. Default 8.
    review_topic_result_cap: 8,
    // rc.9+ (skill-contract-fix B1): age (days) above which a pending entry
    // is considered stale by fabric-review. Default 14.
    review_stale_pending_days: 14,
  };

  mkdirSync(fabricDir, { recursive: true });
  writeFileSync(target, JSON.stringify(FABRIC_CONFIG_DEFAULTS, null, 2) + "\n", "utf8");

  // TASK-006 (C1): surface the fixated value so users know what was
  // detected and how to override it. clack's `log.info` works outside an
  // `intro()` block — it prints a single labeled line and does not
  // interfere with the scaffold path summary below.
  log.info(
    `Detected and fixated fabric_language = ${detectedLanguage}; edit ${target} to override.`,
  );
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
  writeStderr(t("cli.install.mcp.scope.invalid", { value: raw }));
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
    writeStderr(t("cli.install.force.warning", { path: plan.target }));
    // rc.14 TASK-002 — legacy escape hatch deprecation warning. --force /
    // --reapply will be removed in v2.0.0-rc.15 (Phase 2 CLI contraction).
    writeStderr(t("cli.install.diff.deprecation-force"));
  }
  if (plan.options.reapply) {
    writeStderr(t("cli.install.diff.deprecation-reapply"));
  }

  if (plan.options.reapply && !plan.options.planOnly && !plan.interactive) {
    writeStderr(formatInitModeBanner(plan.options));
  }

  if (plan.interactive) {
    printInitPlanSummary(plan.target, plan.options, plan.mcpInstallMode, plan.supports);
  }

  // rc.14 TASK-002 — diff-mode classification table is rendered in BOTH the
  // planOnly preview branch (always) and the no-op canonical confirmation
  // path (below). For planOnly we exit 0 regardless of drift; for the
  // mutation path we abort if drift is detected and --force is not set.
  const scaffoldStates: Array<{ path: string; state: DiffFileState }> = [
    { path: plan.scaffold.metaPath, state: plan.scaffold.metaState },
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

  // rc.14 TASK-002 — drift-abort gate. Fires only at mutation time (i.e. not
  // planOnly) when any scaffold path is in a non-canonical state AND --force
  // is NOT set. --reapply also bypasses the gate (legacy escape hatch). The
  // message points to `fab doctor` (inspect) and `fab uninstall && fab install`
  // (reset) per the rc.14 plan.
  if (!plan.options.force && !plan.options.reapply) {
    const drifted = scaffoldStates.find(
      (entry) => entry.state === "drifted" || entry.state === "user-modified",
    );
    if (drifted !== undefined) {
      throw new Error(t("cli.install.diff.drift-abort", { path: drifted.path }));
    }
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

  // rc.14 TASK-002 — canonical-no-op one-line confirmation. Printed when
  // every scaffold-stage path was already canonical AND --force / --reapply
  // were not passed (legacy paths get their own banner above). Better UX
  // than silent success for users still learning the workflow.
  if (
    !plan.options.force
    && !plan.options.reapply
    && scaffoldStates.every((entry) => entry.state === "present-canonical")
  ) {
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

  // rc.14 TASK-002 — diff-mode classification. NEVER throws during planning.
  // The drift-abort gate inside `executeInitExecutionPlan` is the single
  // throw site, and it only fires when actually writing (i.e. not planOnly)
  // AND at least one path is drifted/user-modified AND --force is not set.
  const metaClassification = classifyFreshPath(metaPath, "structural");
  const eventsClassification = classifyFreshPath(eventsPath, "presence");
  const forensicClassification = classifyFreshPath(forensicPath, "always-rewrite");

  const force = Boolean(options?.force);
  const metaAction = diffStateToWriteAction(metaClassification.state, force);
  const eventsAction = diffStateToWriteAction(eventsClassification.state, force);
  const forensicAction = diffStateToWriteAction(forensicClassification.state, force);

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
    metaState: metaClassification.state,
    eventsState: eventsClassification.state,
    forensicState: forensicClassification.state,
  };
}

export async function executeInitFabricPlan(plan: InitScaffoldPlan): Promise<InitScaffoldResult> {
  const isReapply = plan.options?.reapply === true;

  if (plan.replaceFabricDir) {
    rmSync(plan.fabricDir, { force: true });
  }

  mkdirSync(plan.fabricDir, { recursive: true });

  // Scaffold a discoverable default fabric-config.json listing every
  // reader-consumed field at its documented default. Idempotent: never
  // overwrites pre-existing user edits, even on --reapply. See the
  // helper's JSDoc for the source-of-truth field list. TASK-006 (C1):
  // the helper now also probes plan.target's README/docs to fixate
  // fabric_language on fresh init.
  writeDefaultFabricConfig(plan.fabricDir, plan.target);

  // v2.0 follow-up (rc.1 fix #1): write the repo-root AGENTS.md anchor when
  // it does not already exist. This satisfies doctor's bootstrap_anchor_missing
  // check on a fresh init while remaining strictly idempotent — pre-existing
  // content is never overwritten, so user customizations survive `fab install
  // --reapply` and re-runs of `fab install`. Writing via atomicWriteText keeps
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

  // rc.14 TASK-002 — diff-mode write semantics for the three scaffold files.
  //
  //   agents.meta.json:
  //     - missing               → write the empty initial meta
  //     - present-canonical     → SKIP (idempotent re-run); runInitScan will
  //                               keep it in sync if it fires below
  //     - drifted/user-modified → only reachable here when --force / --reapply
  //                               was set (the drift-abort gate intercepts
  //                               otherwise); overwrite verbatim
  //
  //   events.jsonl: presence-canonical. Existing files are preserved verbatim
  //   (append-only ledger). Only create when missing.
  //
  //   forensic.json: always-rewrite. The file is a snapshot regenerated every
  //   run regardless of diff classification.
  const force = Boolean(plan.options?.force);
  if (plan.metaState === "missing" || force) {
    preparePlannedPath(plan.metaPath, plan.metaAction);
    await atomicWriteJson(plan.metaPath, plan.meta);
  }

  // events.jsonl preservation: under diff-mode default and under --reapply
  // (legacy escape hatch) we preserve any existing file byte-identically.
  // Only create when missing.
  if (plan.eventsState === "missing") {
    preparePlannedPath(plan.eventsPath, plan.eventsAction);
    mkdirSync(dirname(plan.eventsPath), { recursive: true });
    writeFileSync(plan.eventsPath, "", "utf8");
  } else if (isReapply && !existsSync(plan.eventsPath)) {
    // Belt-and-suspenders: --reapply on a state classified as missing already
    // hit the branch above; this covers any edge where classification raced
    // a delete (rare). Existing file content is intentionally left untouched.
    mkdirSync(dirname(plan.eventsPath), { recursive: true });
    writeFileSync(plan.eventsPath, "", "utf8");
  }
  // events.jsonl present-canonical → no write, preserves ledger.

  // forensic.json: always rewrite — it's a snapshot, not user state.
  preparePlannedPath(plan.forensicPath, plan.forensicAction);
  await atomicWriteJson(plan.forensicPath, plan.forensicReport);

  // v2.0 stage (b) scan: invoke runInitScan programmatically so a fresh init
  // produces 4-7 baseline knowledge entries + an init_scan_completed ledger
  // event. Failure is best-effort (e.g. a read-only home) — the layout above
  // is already complete and `fab scan` can be re-run to populate entries.
  //
  // rc.14 TASK-002 — skip the scan on a canonical diff-mode re-run. If the
  // workspace was already canonical (agents.meta.json present-canonical AND
  // events.jsonl present-canonical), scanning would mutate the meta file
  // and break the idempotency contract. Force / reapply runs still scan
  // (legacy semantics). Fresh installs always scan (meta was just created).
  const wasCanonicalReRun =
    plan.metaState === "present-canonical"
    && plan.eventsState === "present-canonical";
  if (!plan.options?.reapply && !wasCanonicalReRun) {
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
  } else {
    // rc.14 TASK-002 — diff-mode default emits install_diff_applied with a
    // per-file breakdown so doctor/forensic tooling can see whether the run
    // was a no-op, restored missing pieces, or applied drift overwrites.
    // Emitted only on the non-reapply path; the legacy --reapply path keeps
    // its distinct reapply_completed event for rc.14 (both retired in rc.15).
    if (existsSync(plan.eventsPath)) {
      const applied: string[] = [];
      const canonical: string[] = [];
      const drifted: string[] = [];
      for (const entry of [
        { path: plan.metaPath, state: plan.metaState },
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

  // rc.12 broad-gate-fabric-lang TASK-006: one-line install-end UX hint that
  // surfaces the resolved fabric_language and tells the user where to change
  // it. Reads from .fabric/fabric-config.json after the bootstrap stage so
  // the value reflects what was written (or detected) during this run.
  const fabricLanguage = readFabricLanguagePreference(plan.target);
  console.log(
    paint.muted(t("cli.install.language_preference_hint", { value: fabricLanguage })),
  );
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
      mode: plan.options.reapply ? t("cli.install.mode.reapply") : t("cli.install.mode.default"),
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

  console.log(formatInitStageHeader(t(`cli.install.stages.${stageName}`)));

  try {
    switch (stage.name) {
      case "bootstrap": {
        // v2/rc.2+rc.3+rc.4+rc.5: bootstrap installs the fabric-archive /
        // fabric-review / fabric-import Skill templates + fabric-hint Stop
        // hook script (rc.5 TASK-010 rename from archive-hint) + per-client
        // hook configs across all three supported clients (claude / codex /
        // cursor) + the pointer line in CLAUDE.md / AGENTS.md / .cursor/rules.
        // Each step
        // is best-effort: a single failure (e.g. one client's directory is
        // unreadable) is logged but does not abort init — other clients
        // and downstream stages continue.
        const installResults: InstallStepResult[] = [];
        installResults.push(...await runBestEffort("skill-install", () => installFabricArchiveSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-review-install", () => installFabricReviewSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-import-install", () => installFabricImportSkill(plan.target)));
        installResults.push(...await runBestEffort("hook-script", () => installArchiveHintHook(plan.target)));
        // rc.6 TASK-019 (E1): SessionStart broad-injection hook script.
        installResults.push(...await runBestEffort("hook-broad-script", () => installKnowledgeHintBroadHook(plan.target)));
        // rc.6 TASK-020 (E2 + E4): PreToolUse narrow-injection hook + edit-counter sidecar.
        installResults.push(...await runBestEffort("hook-narrow-script", () => installKnowledgeHintNarrowHook(plan.target)));
        installResults.push(await runBestEffortSingle("claude-hook-config", () => mergeClaudeCodeHookConfig(plan.target)));
        installResults.push(await runBestEffortSingle("codex-hook-config", () => mergeCodexHookConfig(plan.target)));
        // rc.5 TASK-010 cursor parity (rc.6 also writes the SessionStart slot
        // via the same merged template). Missing from the rc.5 bootstrap-stage
        // wiring — the `hooks` stage downstream calls installHooks() which
        // covered it, but bootstrap-only invocations (e.g. partial-resilience
        // tests) need it inlined here too.
        installResults.push(await runBestEffortSingle("cursor-hook-config", () => mergeCursorHookConfig(plan.target)));
        // rc.12 broad-gate-fabric-lang TASK-006: managed-section writer
        // replaces the rc.4-era POINTER_LINE substring appender. The
        // fabric_language value is read from the .fabric/fabric-config.json
        // that writeDefaultFabricConfig() wrote earlier in this same plan
        // execution — by this point in the bootstrap stage the file is
        // guaranteed to exist (created in executeInitFabricPlan).
        const fabricLanguage = readFabricLanguagePreference(plan.target);
        installResults.push(...await runBestEffort("section", () => addFabricKnowledgeBaseSection(plan.target, fabricLanguage)));
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

// rc.14 TASK-002 — `shouldReplaceWritableDirectory` formerly threw on a
// non-directory at .fabric/. Under diff-mode, classify it as user-modified
// (planning never throws); the abort gate inside `executeInitExecutionPlan`
// surfaces a single helpful drift-abort message before any write. Returns
// `true` (i.e. the run will rm + recreate the path) only when --force is set
// and the path exists as a non-directory.
function shouldReplaceWritableDirectory(path: string, options?: InitOptions): boolean {
  if (!existsSync(path)) {
    return false;
  }

  if (statSync(path).isDirectory()) {
    return false;
  }

  // Non-directory at a managed-directory location. Without --force, the
  // diff-mode abort gate in executeInitExecutionPlan rejects the run with
  // the user-modified message; with --force (legacy escape hatch) we rm+
  // recreate. Either way, no throw during plan construction.
  return Boolean(options?.force);
}

/**
 * rc.14 TASK-002 — non-throwing classifier replacing the binary planFreshPath.
 *
 * Inspects the on-disk state of `path` and returns a `DiffFileState` according
 * to `strategy`. NEVER throws — even for unreadable files (returns
 * "user-modified" in that case so the abort gate downstream can produce a
 * helpful message).
 *
 * Per-file detection strategies are picked by callers:
 *   - "presence"       : the file is canonical-by-presence (events.jsonl)
 *   - "structural"     : the file is JSON, sanity-check its shape only
 *                        (agents.meta.json — its content mutates immediately
 *                        post-install via runInitScan, so byte-compare would
 *                        always flag drift)
 *   - "always-rewrite" : the file is a snapshot regenerated every run, so any
 *                        existing copy is treated as canonical for the diff
 *                        (forensic.json)
 */
function classifyFreshPath(
  path: string,
  strategy: DiffDetectStrategy,
): ClassifiedFreshPathResult {
  if (!existsSync(path)) {
    return { path, state: "missing" };
  }

  // If a managed FILE location is occupied by a directory (or vice versa),
  // that is user-modification — diff-mode aborts unless --force is passed.
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (error: unknown) {
    return {
      path,
      state: "user-modified",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!stat.isFile()) {
    return { path, state: "user-modified", reason: "expected a file" };
  }

  if (strategy === "presence" || strategy === "always-rewrite") {
    // Any present, well-formed file is canonical. events.jsonl is append-
    // only (preserve verbatim); forensic.json is a snapshot (always
    // rewritten at the write boundary regardless of diff classification).
    return { path, state: "present-canonical" };
  }

  // Structural compare for agents.meta.json. Verifies it parses as JSON and
  // exposes the schema_version-equivalent fields (revision + nodes +
  // counters) — does NOT byte-compare against createInitialMeta() because
  // runInitScan mutates the file immediately after install, so any
  // canonical post-install state diverges byte-wise from the initial empty
  // template.
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { path, state: "user-modified", reason: "not a JSON object" };
    }
    const record = parsed as Record<string, unknown>;
    const hasRevision = typeof record["revision"] === "string";
    const hasNodes =
      record["nodes"] !== undefined
      && record["nodes"] !== null
      && typeof record["nodes"] === "object"
      && !Array.isArray(record["nodes"]);
    const hasCounters =
      record["counters"] !== undefined
      && record["counters"] !== null
      && typeof record["counters"] === "object"
      && !Array.isArray(record["counters"]);
    if (!hasRevision || !hasNodes || !hasCounters) {
      return { path, state: "drifted", reason: "missing required AgentsMeta fields" };
    }
    return { path, state: "present-canonical" };
  } catch (error: unknown) {
    return {
      path,
      state: "user-modified",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * rc.14 TASK-002 — translate DiffFileState to InitWriteAction at the
 * rendering / writing boundary. Used inside `executeInitFabricPlan` so the
 * existing `formatInitPathAction` switch stays exhaustive.
 *
 *   - "missing"                          → "created"
 *   - "present-canonical"                → "overwritten" only when --force;
 *                                          otherwise the write path is
 *                                          skipped entirely (see callers).
 *   - "drifted" / "user-modified" (force) → "overwritten" (legacy bypass)
 */
function diffStateToWriteAction(state: DiffFileState, force: boolean): InitWriteAction {
  if (state === "missing") {
    return "created";
  }
  return force ? "overwritten" : "created";
}

function formatDiffFileState(state: DiffFileState): string {
  return t(`cli.install.diff.state.${state}`);
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
      intro(t("cli.install.wizard.intro"));
      note(
        t("cli.install.wizard.overview.body", {
          target: context.target,
          mode: formatInitModeBadge(context.options),
        }),
        t("cli.install.wizard.overview.title"),
      );
      printInitPlanSummary(context.target, context.options, context.mcpInstallMode, context.supports);

      log.step(t("cli.install.wizard.step.target"));
      const continueWithTarget = await confirm({
        message: t("cli.install.wizard.target.confirm", { target: context.target }),
        initialValue: true,
      });
      if (isCancel(continueWithTarget) || !continueWithTarget) {
        emitInitWizardCancellation();
        return null;
      }

      log.step(t("cli.install.wizard.step.plan"));
      let groupedSelection: InitWizardSelection;
      try {
        groupedSelection = await group<InitWizardSelection>(
          {
            bootstrap: async () =>
              context.lockedStages.includes("bootstrap")
                ? false
                : confirmInGroup({
                  message: t("cli.install.wizard.stage.bootstrap", {
                    defaultValue: formatPromptDefault(!context.options.skipBootstrap),
                  }),
                  initialValue: !context.options.skipBootstrap,
                }),
            mcp: async () =>
              context.lockedStages.includes("mcp")
                ? false
                : confirmInGroup({
                  message: t("cli.install.wizard.stage.mcp", {
                    defaultValue: formatPromptDefault(!context.options.skipMcp),
                  }),
                  initialValue: !context.options.skipMcp,
                }),
            mcpInstallMode: async ({ results }) =>
              results.mcp
                ? selectMcpInstallModeInGroup({
                  message: t("cli.install.wizard.mcp-install", { defaultValue: context.mcpInstallMode }),
                  initialValue: context.mcpInstallMode,
                  options: [
                    { value: "global", label: "global", hint: t("cli.install.mcp.install.global") },
                    { value: "local", label: "local", hint: t("cli.install.mcp.install.local") },
                  ],
                })
                : context.mcpInstallMode,
            claudeMcpScope: async ({ results }) =>
              results.mcp
                ? selectClaudeMcpScopeInGroup({
                  message: t("cli.install.wizard.mcp-scope", { defaultValue: context.claudeMcpScope }),
                  initialValue: context.claudeMcpScope,
                  options: [
                    { value: "project" as ClaudeMcpScope, label: "project", hint: t("cli.install.mcp.scope.project") },
                    { value: "user" as ClaudeMcpScope, label: "user", hint: t("cli.install.mcp.scope.user") },
                  ],
                })
                : context.claudeMcpScope,
            hooks: async () =>
              context.lockedStages.includes("hooks")
                ? false
                : confirmInGroup({
                  message: t("cli.install.wizard.stage.hooks", {
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
      log.step(t("cli.install.wizard.step.review"));
      printInitPlanSummary(context.target, previewOptions, groupedSelection.mcpInstallMode, context.supports);

      const confirmed = await confirm({
        message: t("cli.install.wizard.execute.confirm"),
        initialValue: true,
      });
      if (isCancel(confirmed) || !confirmed) {
        emitInitWizardCancellation();
        return null;
      }

      outro(t("cli.install.wizard.outro"));

      return groupedSelection;
    },
  };
}

function emitInitWizardCancellation(): void {
  cancel(t("cli.install.wizard.cancelled"));
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
    return t("cli.install.plan.mode-banner.plan-reapply");
  }

  if (options.planOnly) {
    return t("cli.install.plan.mode-banner.plan");
  }

  if (options.reapply) {
    return t("cli.install.plan.mode-banner.reapply");
  }

  return t("cli.install.plan.mode-banner.default");
}

function formatInitModeBadge(options: InitOptions): string {
  if (options.planOnly && options.reapply) {
    return t("cli.install.mode.badge.plan-reapply");
  }

  if (options.planOnly) {
    return t("cli.install.mode.badge.plan");
  }

  if (options.reapply) {
    return t("cli.install.mode.badge.reapply");
  }

  return t("cli.install.mode.badge.default");
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

  writeStderr(t("cli.install.mcp.install.invalid", { value: rawMode }));
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

/**
 * rc.14 TASK-002 — emit `install_diff_applied` per non-reapply install run.
 *
 * The payload's three buckets cover the full scaffold-stage diff classification
 * (every scaffold path lands in exactly one). Doctor / forensic tooling can
 * read these events to surface idempotent re-runs vs. apply-missing-pieces
 * runs vs. drift-overwritten runs without re-running the classifier.
 *
 * Distinct from `reapply_completed` (which stays in rc.14 as the legacy
 * --reapply marker). Both event types are slated for unification in rc.15
 * when --reapply is removed.
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
    ? paint.success(t("cli.install.stages.summary.ran"))
    : disposition === "skipped"
      ? paint.muted(t("cli.install.stages.summary.skipped"))
      : paint.error(t("cli.install.stages.summary.failed"));
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
  console.log(t("cli.install.plan.title"));
  console.log(formatInitModeBanner(options));
  console.log(t("cli.install.plan.target", { target }));
  console.log(
    t("cli.install.plan.actions", {
      bootstrap: yesNoLabel(!options.skipBootstrap),
      mcp: yesNoLabel(!options.skipMcp),
      hooks: yesNoLabel(!options.skipHooks),
      mcpInstall: mcpInstallMode,
    }),
  );

  const detected = supports.filter((support) => support.detected);
  console.log(
    t("cli.install.plan.detected", {
      clients: detected.length > 0 ? detected.map((support) => support.label).join(", ") : t("cli.shared.none"),
    }),
  );
  console.log(t("cli.install.plan.writes"));
  console.log(`  - ${target}/.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes,pending}/`);
  console.log(`  - ${target}/.fabric/agents.meta.json`);
  console.log(`  - ${target}/.fabric/events.jsonl`);
  console.log(`  - ${target}/.fabric/forensic.json`);
  console.log(`  - ${target}/.fabric/fabric-config.json`);
}

function printInitCapabilitySummary(
  supports: DetectedClientSupport[],
  stageResults: InitStageRecord[],
  options: InitOptions,
): void {
  const detected = supports.filter((support) => support.detected);
  if (detected.length === 0) {
    console.log(t("cli.install.capabilities.none"));
    return;
  }

  console.log(t("cli.install.capabilities.title"));
  const rows = detected.map((support) => toCapabilityRow(support, stageResults, options));
  const headers: InitCapabilityRow = {
    client: t("cli.install.capabilities.header.client"),
    bootstrap: t("cli.install.capabilities.header.bootstrap"),
    mcp: t("cli.install.capabilities.header.mcp"),
    hook: t("cli.install.capabilities.header.hook"),
    skill: t("cli.install.capabilities.header.skill"),
    followUp: t("cli.install.capabilities.header.follow-up"),
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
    : t("cli.install.capabilities.status.na");
  const mcp = support.capabilities.mcp
    ? capabilityStatus(options.skipMcp ? "skipped" : stage("mcp"))
    : t("cli.install.capabilities.status.na");
  const hook = capabilityInstallStatus(support, "hook");
  const skill = capabilityInstallStatus(support, "skill");

  return {
    client: support.label,
    bootstrap,
    mcp,
    hook,
    skill,
    followUp: hasInstalledCapability(support, "skill")
      ? t("cli.install.capabilities.follow-up.ready")
      : support.capabilities.skill
        ? t("cli.install.capabilities.follow-up.install")
        : t("cli.install.capabilities.follow-up.manual"),
  };
}

function capabilityInstallStatus(
  support: DetectedClientSupport,
  capability: "hook" | "skill",
): string {
  if (!support.capabilities[capability]) {
    return t("cli.install.capabilities.status.na");
  }

  return hasInstalledCapability(support, capability)
    ? t("cli.install.capabilities.status.installed")
    : t("cli.install.capabilities.status.supported");
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
      return t("cli.install.capabilities.status.ready");
    case "skipped":
      return t("cli.install.capabilities.status.skipped");
    case "failed":
      return t("cli.install.capabilities.status.failed");
    case null:
      return t("cli.install.capabilities.status.na");
    default:
      return t("cli.install.capabilities.status.ready");
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
    return t("cli.install.reason-message.installable-body");
  }

  return t("cli.install.reason-message.manual-body");
}

function yesNoLabel(value: boolean): string {
  return value ? t("cli.shared.yes") : t("cli.shared.no");
}

function formatInitPathAction(path: string, action: InitWriteAction): string {
  return t("cli.install.created-path", { label: labelForInitWriteAction(action), path });
}

// v2.0 follow-up (rc.1 fix #1): AGENTS.md uses a `preserved` action variant
// that no other plan path needs. We render it through the same created-path
// i18n shell with a localized "preserved" label so output stays uniform.
function formatAgentsMdAction(path: string, action: AgentsMdAction): string {
  if (action === "preserved") {
    return t("cli.install.skipped-existing-path", { label: skippedLabel(), path });
  }
  return t("cli.install.created-path", { label: createdLabel(), path });
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
  return paint.warn(t("cli.install.force.overwritten"));
}

function completedStageLabel(): string {
  return paint.success(t("cli.install.stages.completed"));
}

function skippedStageLabel(): string {
  return paint.muted(t("cli.install.stages.skipped"));
}

function failedStageLabel(): string {
  return paint.error(t("cli.install.stages.failed"));
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

