import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { cancel, confirm, group, intro, isCancel, log, note, outro, select, text } from "@clack/prompts";
import { defineCommand } from "citty";

import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import type { ClaudeMcpScope } from "../config/json.js";
import { t } from "../i18n.js";
import { runGlobalInstall } from "../install/run-global-install.js";
import { loadGlobalConfig } from "../store/global-config-io.js";
import { storeBind, storeCreate, storeList, storeSwitchWrite, unboundAvailableStores } from "../store/store-ops.js";
import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import { loadProjectConfig } from "../store/project-config-io.js";
import { detectExistingLanguage, type ResolvedLanguage } from "../lib/detect-language.js";
import { detectClientSupports, type DetectedClientSupport } from "../config/resolver.js";
import { enableSemanticSearch, renderSemanticSearchInstructions } from "../install/semantic-search.js";
import { mountStoreFromRemote } from "../install/run-global-install.js";
import { resolveGlobalRoot } from "../store/global-config-io.js";
import { paint } from "../colors.js";

// Import the new pipeline
import { InstallPipeline, stageRan, stageSkipped, stageFailed, stageFailedFromError } from "../install/pipeline/index.js";
import type {
  InitArgs,
  InitOptions,
  InstallContext,
  PipelineResult,
  StageName,
} from "../install/pipeline/index.js";
import { PreflightStage } from "../install/pipeline/preflight.stage.js";
import { EnvStage } from "../install/pipeline/env.stage.js";
import { StoreStage } from "../install/pipeline/store.stage.js";
import { HooksStage } from "../install/pipeline/hooks.stage.js";
import { McpStage } from "../install/pipeline/mcp.stage.js";
import { ValidateStage } from "../install/pipeline/validate.stage.js";
import { GuidanceStage } from "../install/pipeline/guidance.stage.js";

// Import the TUI renderer (EPIC-005/006/007/008)
import { createInkRenderer } from "../tui/index.js";
import type { OutputRenderer } from "../tui/types.js";

// ---------------------------------------------------------------------------
// Install Command
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main Install Command Entry Point
// ---------------------------------------------------------------------------

export async function runInitCommand(args: InitArgs): Promise<void> {
  const logger = createDebugLogger(args.debug);

  // Handle --global flag: set up global home only (no project wiring)
  if (args.global === true) {
    await runGlobalInstall({ url: args.url });
    return;
  }

  const resolution = resolveDevMode(args.target, process.cwd());

  logger(`init target source: ${resolution.source}`);
  for (const step of resolution.chain) {
    logger(step);
  }

  // Build the install context with TUI renderer
  const renderer = isInteractiveInit() ? createInkRenderer({ verbose: args.debug }) : undefined;
  const context = createInstallContext(args, resolution.target, renderer);

  // Build and execute the pipeline
  const pipeline = new InstallPipeline()
    .addStage(new PreflightStage())
    .addStage(new EnvStage())
    .addStage(new StoreStage())
    .addStage(new HooksStage())
    .addStage(new McpStage())
    .addStage(new ValidateStage())
    .addStage(new GuidanceStage());

  const result = await pipeline.execute(context);

  // Cleanup renderer
  if (renderer) {
    await renderer.cleanup();
  }

  // Handle pipeline result
  if (!result.success) {
    if (result.error && !renderer) {
      // Fallback to console.error when no renderer handled it
      console.error(paint.error(result.error.message));
    }
    process.exitCode = 1;
    return;
  }

  // Post-install steps (preserved from original implementation)
  if (!context.options.planOnly) {
    // Handle --url flag for store binding
    if (typeof args.url === "string" && args.url.length > 0) {
      bindRemoteStoreToProject(resolution.target, args.url);
    } else if (context.wizardEnabled) {
      await promptStoreOnboarding(resolution.target);
    }

    // Warn about unbound stores
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

    // Handle semantic search
    if (args["enable-embed"] === true) {
      enableSemanticSearchAndReport(resolution.target, args["embed-model"]);
    } else if (context.wizardEnabled) {
      await promptSemanticSearch(resolution.target);
    }
  }
}

// ---------------------------------------------------------------------------
// Context Creation
// ---------------------------------------------------------------------------

function createInstallContext(args: InitArgs, target: string, renderer?: OutputRenderer): InstallContext {
  const terminalInteractive = isInteractiveInit();
  const planOnly = args["dry-run"] === true;

  return {
    target,
    args,
    options: {
      planOnly,
      skipBootstrap: false,
      skipMcp: false,
      skipHooks: false,
    },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    interactive: terminalInteractive && !args.yes,
    wizardEnabled: terminalInteractive && !args.yes && !planOnly,
    stageResults: [],
    rollbackStack: [],
    state: {},
    renderer,
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function isInteractiveInit(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
}

/**
 * Enable semantic search and print instructions.
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
 * Interactive prompt for semantic search.
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
 * Mount and bind a remote store to the project.
 */
export function bindRemoteStoreToProject(
  projectRoot: string,
  url: string,
  globalRoot: string = resolveGlobalRoot(),
): void {
  const already = storeList(globalRoot).find((store) => store.remote === url);
  const mounted = already ?? mountStoreFromRemote(url, globalRoot);
  storeBind(projectRoot, { id: mounted.alias, suggested_remote: url });
  storeSwitchWrite(projectRoot, mounted.alias);
  regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString(), globalRoot });
  console.log("");
  console.log(
    paint.success(`bound store '${mounted.alias}' to this project and set it as the write target.`),
  );
}

/**
 * Create and bind a new store to the project.
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
  );
  storeSwitchWrite(projectRoot, alias);
  regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString(), globalRoot });
  console.log("");
  console.log(
    paint.success(`created store '${alias}', bound it to this project, and set it as the write target.`),
  );
}

/**
 * Interactive store onboarding prompt.
 */
async function promptStoreOnboarding(projectRoot: string): Promise<void> {
  const config = loadProjectConfig(projectRoot);
  if (typeof config?.active_write_store === "string" && config.active_write_store.length > 0) {
    return; // already has a write store
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
  const remoteStr = !isCancel(remote) && typeof remote === "string" && remote.length > 0 ? remote : undefined;
  bindCreatedStoreToProject(projectRoot, alias, remoteStr === undefined ? {} : { remote: remoteStr });
}
