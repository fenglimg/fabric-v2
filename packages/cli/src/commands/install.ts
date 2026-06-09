import { randomUUID } from "node:crypto";
import * as childProcess from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { cancel, confirm, group, intro, isCancel, log, note, outro, select, text } from "@clack/prompts";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";
import { defineCommand } from "citty";
// v2.0.0-rc.37 Wave A2: serve-lock preflight import removed. With `fabric serve`
// quarantined to packages/server-http-experimental/, no main-line process
// writes `.fabric/.serve.lock`, so the install vs serve race condition this
// guarded against can no longer happen. See KB
// [[fabric-serve-quarantine-not-delete]] for the design decision.

import { displayWidth, paint, padEnd } from "../colors.js";
import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import type { ClaudeMcpScope } from "../config/json.js";
import { t } from "../i18n.js";
import * as configCommand from "./config.js";
import { installHooks } from "../install/hooks-orchestrator.js";
import { enableSemanticSearch, renderSemanticSearchInstructions } from "../install/semantic-search.js";
import { mountStoreFromRemote, runGlobalInstall } from "../install/run-global-install.js";
import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import {
  storeBind,
  storeCreate,
  storeList,
  storeSetWriteRoute,
  storeSwitchWrite,
  unboundAvailableStores,
} from "../store/store-ops.js";
import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import { loadProjectConfig } from "../store/project-config-io.js";
import { writeFabricAgentsSnapshot } from "../install/write-bootstrap-snapshot.js";
import { detectExistingLanguage, type ResolvedLanguage } from "../lib/detect-language.js";
import { buildForensicReport } from "../scanner/forensic.js";
import { detectClientSupports, type DetectedClientSupport } from "../config/resolver.js";
import {
  cleanupDeprecatedSkills,
  installArchiveHintHook,
  installCitePolicyEvictHook,
  installFabricArchiveSkill,
  installFabricSkill,
  installFabricAuditSkill,
  installFabricConnectSkill,
  installFabricImportSkill,
  installFabricReviewSkill,
  installFabricStoreSkill,
  installFabricSyncSkill,
  installHookLibs,
  installKnowledgeHintBroadHook,
  installKnowledgeHintNarrowHook,
  installSessionEndMarkerHook,
  installPostTooluseMutationHook,
  installSharedSkillLib,
  mergeClaudeCodeHookConfig,
  mergeCodexHookConfig,
  mergeCursorHookConfig,
  readFabricLanguagePreference,
  writeClaudeBootstrapThinShell,
  writeCodexBootstrapManagedBlock,
  writeCursorBootstrapManagedBlock,
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
  // .codex/.cursor and preservation of user permissions + custom hook entries),
  // so it is the safe way to absorb new skill/hook templates — no dedicated
  // escape hatch needed.
  // v2.1 ③ vector-chinese-model (P3): opt-in "enable semantic search" step.
  // Default OFF (skip path). When set, flips embed_enabled + pins embed_model in
  // fabric.config.json and prints the fastembed install + cache-warm + reindex
  // instructions. `--embed-model` overrides the light-Chinese default pin.
  "enable-embed"?: boolean;
  "embed-model"?: string;
};

type InitOptions = {
  skipBootstrap?: boolean;
  skipMcp?: boolean;
  skipHooks?: boolean;
  planOnly?: boolean;
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
//                           (byte-mismatch or structural-mismatch); the run
//                           aborts unconditionally with a helpful message
//   - "user-modified"     : managed location holds something canonically
//                           unexpected (e.g. .fabric/ is a file, or a managed
//                           file location is occupied by a directory); same
//                           abort semantics as "drifted"
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
//   - "always-rewrite" : the file is a snapshot, never user-edited — always
//                        treat the existing file as canonical for diff but
//                        always rewrite at the write boundary (e.g.
//                        forensic.json)
//
// The "structural" strategy (JSON schema sanity-check for the retired
// agents.meta.json) was removed in W5 I1 alongside the agents.meta scaffold.
type DiffDetectStrategy = "presence" | "always-rewrite";

type ClassifiedFreshPathResult = {
  path: string;
  state: DiffFileState;
  reason?: string;
};

// v2.0 follow-up (rc.1 fix #1): AGENTS.md at the repo root is the universal
// MCP-agnostic bootstrap anchor. Cursor, Codex CLI, and Claude Code all read
// it; doctor's `bootstrap_anchor_missing` check requires either AGENTS.md or
// CLAUDE.md to be present. We write a minimal default on a fresh init and
// PRESERVE any pre-existing file verbatim. The intent
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
const LOCAL_FABRIC_SERVER_PATH = join("node_modules", "@fenglimg", "fabric-server", "dist", "index.js");
const FABRIC_SERVER_PACKAGE = "@fenglimg/fabric-server";
const INIT_WIZARD_GROUP_CANCELLED = Symbol("init-wizard-group-cancelled");

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
    console.log(paint.muted("More: docs/ARCHITECTURE.md explains CLI / Skill / MCP boundaries."));

    // W1 (install --url top-level): one-command "join a team store". Mount the
    // remote store globally (idempotent — reuse an already-mounted clone of the
    // same remote), bind it to this project, and set it as the active write
    // target. Replaces the old two-step
    // `install --global --url … && store bind … && store switch-write …`.
    // Runs BEFORE the unbound-store nudge below so the freshly-bound store is
    // not then reported as unbound.
    if (typeof args.url === "string" && args.url.length > 0) {
      bindRemoteStoreToProject(resolution.target, args.url);
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

/**
 * Idempotently enable vector semantic search (flip embed config) and print the
 * host-side install instructions. Shared by the `--enable-embed` flag path and
 * the interactive wizard step so both behave identically.
 */
function enableSemanticSearchAndReport(projectRoot: string, model?: string): void {
  const enabled = enableSemanticSearch(projectRoot, model === undefined ? {} : { model });
  console.log("");
  if (enabled.alreadyEnabled) {
    console.log(paint.muted(`语义搜索已是启用状态 (embed_model=${enabled.model})，未改动 ${enabled.configPath}。`));
    return;
  }
  for (const line of renderSemanticSearchInstructions(enabled.model)) {
    console.log(line);
  }
}

/**
 * W5 (install embed step) — interactive "enable semantic search?" prompt. Off by
 * default; cancelling / declining is a clean no-op. The non-interactive
 * equivalent is the `--enable-embed` flag.
 */
async function promptSemanticSearch(projectRoot: string): Promise<void> {
  const enable = await confirm({
    message: "Enable vector semantic search? (downloads an embedding model on first use)",
    initialValue: false,
  });
  if (isCancel(enable) || !enable) {
    return;
  }
  enableSemanticSearchAndReport(projectRoot);
}

/**
 * W1 (install --url top-level) — mount a shared store from a git remote, bind it
 * to this project, and set it as the active write target in one step.
 *
 * This is the "join my team's knowledge store" flow. The primitives already
 * existed as separate `store` subcommands (`add` / `bind` / `switch-write`);
 * install just wires them together so the common onboarding path is a single
 * command instead of three the user must sequence by hand.
 *
 * Idempotent: a re-run with the same remote reuses the already-mounted clone
 * (matched by `remote` url) rather than cloning again. The global config is
 * guaranteed to exist by the caller (runInitCommand mints it before the per-repo
 * pipeline), so the resolved global root always points at a valid install.
 *
 * `globalRoot` is injectable (mirrors `storeAdd` / `storeBind` convention) so the
 * flow is testable against an isolated global root.
 */
export function bindRemoteStoreToProject(
  projectRoot: string,
  url: string,
  globalRoot: string = resolveGlobalRoot(),
): void {
  const already = storeList(globalRoot).find((store) => store.remote === url);
  const mounted = already ?? mountStoreFromRemote(url, globalRoot);
  storeBind(projectRoot, { id: mounted.alias, suggested_remote: url }, { globalRoot });
  storeSwitchWrite(projectRoot, mounted.alias, { globalRoot });
  const activeProject = loadProjectConfig(projectRoot)?.active_project;
  if (typeof activeProject === "string" && activeProject.length > 0) {
    storeSetWriteRoute(projectRoot, `project:${activeProject}`, mounted.alias, { globalRoot });
  }
  // Refresh the resolved-bindings snapshot so P4 hooks read a consistent
  // read-set / write-target without re-resolving (mirrors `store bind`).
  regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString(), globalRoot });
  console.log("");
  console.log(
    paint.success(
      `bound store '${mounted.alias}' to this project and set it as the write target.`,
    ),
  );
}

/**
 * W2 (install store onboarding) — create a brand-new LOCAL store, bind it to this
 * project, and set it as the active write target in one step. The "start a new
 * team store" counterpart to {@link bindRemoteStoreToProject} ("join an existing
 * one"). `remote`, when given, is wired into the new store's git repo so it can
 * push/pull later (F-SYNC-REMOTE).
 *
 * Composes the existing `store create` / `bind` / `switch-write` primitives so
 * the interactive install wizard's store step is a single call. `globalRoot` is
 * injectable for tests (mirrors the sibling helpers).
 */
export function bindCreatedStoreToProject(
  projectRoot: string,
  alias: string,
  options: { remote?: string; globalRoot?: string } = {},
): void {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  storeCreate(alias, new Date().toISOString(), {
    ...(options.remote === undefined ? {} : { remote: options.remote }),
    globalRoot,
  });
  storeBind(
    projectRoot,
    options.remote === undefined ? { id: alias } : { id: alias, suggested_remote: options.remote },
    { globalRoot },
  );
  storeSwitchWrite(projectRoot, alias, { globalRoot });
  const activeProject = loadProjectConfig(projectRoot)?.active_project;
  if (typeof activeProject === "string" && activeProject.length > 0) {
    storeSetWriteRoute(projectRoot, `project:${activeProject}`, alias, { globalRoot });
  }
  regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString(), globalRoot });
  console.log("");
  console.log(
    paint.success(
      `created store '${alias}', bound it to this project, and set it as the write target.`,
    ),
  );
}

/**
 * W2 (install store onboarding) — interactive "set up a team store" step.
 *
 * Runs in the post-setup phase (project config already scaffolded, so bind
 * works). Offers three branches: skip (personal-only, the default), join an
 * existing shared store from a git remote, or create a fresh local store
 * (optionally remote-backed). Each non-skip branch composes the existing store
 * primitives via {@link bindRemoteStoreToProject} / {@link bindCreatedStoreToProject}.
 *
 * Idempotent: skipped entirely when this project already has an active write
 * store (a re-install must not re-prompt). Cancelling any prompt is a clean
 * no-op — store onboarding is optional, never a gate (KT-DEC-0007).
 */
async function promptStoreOnboarding(projectRoot: string): Promise<void> {
  const config = loadProjectConfig(projectRoot);
  if (typeof config?.active_write_store === "string" && config.active_write_store.length > 0) {
    return; // already onboarded a team/shared write store — do not re-prompt.
  }

  const choice = await select({
    message: "Set up a team / shared knowledge store for this project?",
    initialValue: "skip",
    options: [
      { value: "skip", label: "skip", hint: "personal store only (default)" },
      { value: "join", label: "join existing", hint: "clone + bind a shared store from a git remote" },
      { value: "create", label: "create new", hint: "start a fresh local store (optionally remote-backed)" },
    ],
  });
  if (isCancel(choice) || choice === "skip") {
    return;
  }

  if (choice === "join") {
    const url = await text({
      message: "Shared store git remote (url):",
      placeholder: "git@github.com:org/knowledge.git",
    });
    if (isCancel(url) || typeof url !== "string" || url.length === 0) {
      return;
    }
    bindRemoteStoreToProject(projectRoot, url);
    return;
  }

  // choice === "create"
  const alias = await text({ message: "Local alias for the new store:", initialValue: "team" });
  if (isCancel(alias) || typeof alias !== "string" || alias.length === 0) {
    return;
  }
  const remote = await text({
    message: "Git remote to back it (optional — leave blank to skip):",
    placeholder: "git@github.com:org/knowledge.git",
  });
  const remoteStr =
    !isCancel(remote) && typeof remote === "string" && remote.length > 0 ? remote : undefined;
  bindCreatedStoreToProject(projectRoot, alias, remoteStr === undefined ? {} : { remote: remoteStr });
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
 * we invoke `detectExistingLanguage(targetRoot)` (lib/detect-language.ts)
 * once on a fresh init, which scans `README.md` + `docs/*.md` for the CJK
 * ratio and resolves to `"zh-CN"` (ratio > 0.3) or `"en"`.
 * The literal `"match-existing"` placeholder is no longer written — users
 * who want a different language flip the field to `"zh-CN"` or `"en"` after
 * init. The empty-repo default is `"zh-CN"` (matches `detectExistingLanguage`'s
 * contract).
 *
 * Idempotent: writes ONLY when the file does not exist. NEVER merges
 * missing fields into an existing file. NEVER overwrites user edits. Every
 * `fabric install` invocation shares this helper with identical semantics —
 * re-runs preserve user customisations verbatim.
 */
// ISS-042: the per-dev activity ledgers and caches are described throughout the
// codebase as "gitignored" (events.jsonl, metrics.jsonl, cite-rollup.jsonl,
// .cache/, advisory `.lock` files, `.corrupted.*` forensic sidecars), but
// nothing ever wrote a .gitignore — so they would be committed by default. The
// scaffold now drops a `.fabric/.gitignore`. Idempotent: written only when
// absent, never overwriting user edits (mirrors writeDefaultFabricConfig).
const FABRIC_GITIGNORE_CONTENT = [
  "# Fabric per-dev activity ledgers & caches — auto-generated, not shared.",
  "# Managed by `fabric install`; edit freely (re-install never overwrites this).",
  "events.jsonl",
  "metrics.jsonl",
  "cite-rollup.jsonl",
  "injections.jsonl",
  ".cache/",
  "*.lock",
  "*.corrupted.*",
  "",
].join("\n");

function writeDefaultGitignore(fabricDir: string): void {
  const target = join(fabricDir, ".gitignore");
  if (existsSync(target)) return;
  mkdirSync(fabricDir, { recursive: true });
  writeFileSync(target, FABRIC_GITIGNORE_CONTENT, "utf8");
}

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
    throw new Error(
      t("cli.install.diff.drift-abort", { path: plan.scaffold.fabricDir }),
    );
  }

  // rc.15 (formerly rc.14 TASK-002) — unconditional drift-abort gate. Fires
  // at mutation time (i.e. not planOnly) when any scaffold path is in a
  // non-canonical state. No legacy escape hatch — the message points to
  // `fabric doctor` (inspect) and `fabric uninstall && fabric install` (reset).
  const drifted = scaffoldStates.find(
    (entry) => entry.state === "drifted" || entry.state === "user-modified",
  );
  if (drifted !== undefined) {
    throw new Error(t("cli.install.diff.drift-abort", { path: drifted.path }));
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
    mkdirSync(dirname(plan.eventsPath), { recursive: true });
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
        // hook configs across all three supported clients (claude / codex /
        // cursor) + the pointer line in CLAUDE.md / AGENTS.md / .cursor/rules.
        // Each step
        // is best-effort: a single failure (e.g. one client's directory is
        // unreadable) is logged but does not abort init — other clients
        // and downstream stages continue.
        const installResults: InstallStepResult[] = [];
        // rc.35 TASK-03 (P2-6): remove deprecated skill subtrees (e.g.
        // fabric-init) before installing modern skills, so rc.30 → rc.35
        // upgraders see deprecation cleanup as part of the install diff.
        installResults.push(...await runBestEffort("skill-deprecated-cleanup", () => cleanupDeprecatedSkills(plan.target)));
        installResults.push(...await runBestEffort("skill-install", () => installFabricArchiveSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-fabric-install", () => installFabricSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-review-install", () => installFabricReviewSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-import-install", () => installFabricImportSkill(plan.target)));
        // F7: the bootstrap stage previously installed only archive/review/import
        // (3 of 7 skills). installHooks() covered the rest, but a bootstrap-only
        // invocation (hooks stage skipped) shipped an incomplete skill set.
        // Mirror installHooks' full set here: sync/store/audit/connect + the
        // shared skill lib they depend on.
        installResults.push(...await runBestEffort("skill-sync-install", () => installFabricSyncSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-store-install", () => installFabricStoreSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-audit-install", () => installFabricAuditSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-connect-install", () => installFabricConnectSkill(plan.target)));
        installResults.push(...await runBestEffort("skill-shared-lib", () => installSharedSkillLib(plan.target)));
        installResults.push(...await runBestEffort("hook-script", () => installArchiveHintHook(plan.target)));
        // rc.6 TASK-019 (E1): SessionStart broad-injection hook script.
        installResults.push(...await runBestEffort("hook-broad-script", () => installKnowledgeHintBroadHook(plan.target)));
        // rc.6 TASK-020 (E2 + E4): PreToolUse narrow-injection hook + edit-counter sidecar.
        installResults.push(...await runBestEffort("hook-narrow-script", () => installKnowledgeHintNarrowHook(plan.target)));
        // F4: rc.34 TASK-06 UserPromptSubmit cite-policy-evict.cjs. The hook
        // CONFIG merges below register it across all three clients, but the
        // bootstrap stage previously never copied the SCRIPT — so a
        // bootstrap-only install (e.g. init without the downstream `hooks`
        // stage) left configs pointing at a missing file. Inlined here too,
        // mirroring the cursor-hook-config note below.
        installResults.push(...await runBestEffort("hook-cite-policy-evict-script", () => installCitePolicyEvictHook(plan.target)));
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
        // rc.5 TASK-010 cursor parity (rc.6 also writes the SessionStart slot
        // via the same merged template). Missing from the rc.5 bootstrap-stage
        // wiring — the `hooks` stage downstream calls installHooks() which
        // covered it, but bootstrap-only invocations (e.g. partial-resilience
        // tests) need it inlined here too.
        installResults.push(await runBestEffortSingle("cursor-hook-config", () => mergeCursorHookConfig(plan.target)));
        // rc.19 TASK-002: L1 bootstrap snapshot — materialize the canonical
        // `.fabric/AGENTS.md` from BOOTSTRAP_CANONICAL. Idempotent + atomic.
        // This snapshot is the source-of-truth that the three propagation
        // writers below fan out into per-client thin shells.
        installResults.push(await runBestEffortSingle("bootstrap-snapshot", () => writeFabricAgentsSnapshot(plan.target)));
        // rc.19 TASK-003: three-end propagation. Each writer consumes the L1
        // snapshot (plus optional `.fabric/project-rules.md`) and writes the
        // appropriate per-client output:
        //   - Claude Code: real `@`-import directives in CLAUDE.md
        //   - Codex CLI:   byte-copy managed block in root AGENTS.md
        //   - Cursor:      byte-copy managed block + YAML front-matter in
        //                  `.cursor/rules/fabric-bootstrap.mdc`
        installResults.push(await runBestEffortSingle("bootstrap-claude", () => writeClaudeBootstrapThinShell(plan.target)));
        installResults.push(await runBestEffortSingle("bootstrap-codex", () => writeCodexBootstrapManagedBlock(plan.target)));
        installResults.push(await runBestEffortSingle("bootstrap-cursor", () => writeCursorBootstrapManagedBlock(plan.target)));
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
        const result = await installHooks(plan.target);
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

// rc.15 (formerly rc.14 TASK-002) — `shouldReplaceWritableDirectory` formerly
// threw on a non-directory at .fabric/. Under diff-mode, classify it as
// user-modified (planning never throws); the abort gate inside
// `executeInitExecutionPlan` surfaces a single helpful drift-abort message
// before any write. With --force removed in rc.15, this always returns
// false — recovery from a file-where-dir-belongs is `fabric uninstall && fab
// install`.
function shouldReplaceWritableDirectory(path: string, _options?: InitOptions): boolean {
  if (!existsSync(path)) {
    return false;
  }

  if (statSync(path).isDirectory()) {
    return false;
  }

  // Non-directory at a managed-directory location. The diff-mode abort gate
  // in executeInitExecutionPlan rejects the run with the user-modified
  // message before any write happens.
  return false;
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
 *   - "always-rewrite" : the file is a snapshot regenerated every run, so any
 *                        existing copy is treated as canonical for the diff
 *                        (forensic.json)
 */
function classifyFreshPath(
  path: string,
  _strategy: DiffDetectStrategy,
): ClassifiedFreshPathResult {
  if (!existsSync(path)) {
    return { path, state: "missing" };
  }

  // If a managed FILE location is occupied by a directory (or vice versa),
  // that is user-modification — diff-mode aborts unconditionally.
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

  // Both remaining strategies ("presence", "always-rewrite") treat any present,
  // well-formed file as canonical. events.jsonl is append-only (preserve
  // verbatim); forensic.json is a snapshot (always rewritten at the write
  // boundary regardless of diff classification).
  return { path, state: "present-canonical" };
}

/**
 * rc.15 (formerly rc.14 TASK-002) — translate DiffFileState to InitWriteAction
 * at the rendering / writing boundary. Used inside `executeInitFabricPlan` so
 * the existing `formatInitPathAction` switch stays exhaustive. With the
 * removal of --force/--reapply (rc.15 Phase 2), every write the helper is
 * allowed to perform is a fresh `created` action — present-canonical paths
 * are skipped at the caller; drifted / user-modified paths are intercepted
 * upstream by the drift-abort gate.
 */
function diffStateToWriteAction(_state: DiffFileState): InitWriteAction {
  return "created";
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

function formatPromptDefault(value: boolean): string {
  return value ? "Y/n" : "y/N";
}

function formatInitModeBanner(options: InitOptions): string {
  if (options.planOnly) {
    return t("cli.install.plan.mode-banner.plan");
  }

  return t("cli.install.plan.mode-banner.default");
}

function formatInitModeBadge(options: InitOptions): string {
  if (options.planOnly) {
    return t("cli.install.mode.badge.plan");
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
  // v2.0.0-rc.37 NEW-22: post-install restart banner. The MCP server is
  // spawned by the client when it boots; an already-running Claude Code /
  // Cursor / Codex session won't pick up the new mcp config until restart,
  // so users hit a confusing "tools missing" failure mode without this
  // explicit nudge. Single-line bilingual hint added after the capability
  // table where users naturally look for "what next?".
  console.log("");
  console.log(t("cli.install.restart-banner"));
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
  return paint.warn(t("cli.install.label.overwritten"));
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
