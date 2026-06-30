import { defineCommand } from "citty";

import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import { t } from "../i18n.js";
import { runGlobalInstall } from "../install/run-global-install.js";
import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import { paint } from "../colors.js";

// Import the new pipeline
import { InstallPipeline } from "../install/pipeline/index.js";
import type { InitArgs, InstallContext } from "../install/pipeline/index.js";
import { PreflightStage } from "../install/pipeline/preflight.stage.js";
import { EnvStage } from "../install/pipeline/env.stage.js";
import { StoreStage } from "../install/pipeline/store.stage.js";
import { HooksStage } from "../install/pipeline/hooks.stage.js";
import { McpStage } from "../install/pipeline/mcp.stage.js";
import { ValidateStage } from "../install/pipeline/validate.stage.js";
import { GuidanceStage } from "../install/pipeline/guidance.stage.js";

// Import the TUI renderer (W3-A: theme.ts-backed, non-Ink)
import { createInstallRenderer } from "../tui/index.js";
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
      description: t("cli.install.args.global.description"),
      default: false,
    },
    url: {
      type: "string",
      description: t("cli.install.args.url.description"),
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
    verbose: {
      type: "boolean",
      description: t("cli.install.args.verbose.description"),
      default: false,
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
    if (args["dry-run"] === true) {
      console.log("Fabric install dry run: no global files will be written.");
      console.log("Planned: ensure global Fabric config and personal store exist.");
      if (args.url !== undefined) {
        console.log(`Planned: clone and mount store from ${args.url}.`);
      }
      return;
    }
    await runGlobalInstall({ url: args.url });
    return;
  }

  const resolution = resolveDevMode(args.target, process.cwd());

  logger(`init target source: ${resolution.source}`);
  for (const step of resolution.chain) {
    logger(step);
  }

  // Build the install context with TUI renderer
  const terminalInteractive = isInteractiveInit();
  const renderer = shouldUseInstallRenderer(args, terminalInteractive)
    ? createInstallRenderer({ verbose: args.debug })
    : undefined;
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

}

// ---------------------------------------------------------------------------
// Context Creation
// ---------------------------------------------------------------------------

function createInstallContext(args: InitArgs, target: string, renderer?: OutputRenderer): InstallContext {
  const terminalInteractive = isInteractiveInit();
  const planOnly = args["dry-run"] === true;

  // TASK-004: distinguish first-ever install (no global config yet) from a
  // re-install, set EARLY so the pipeline intro can pick the onboarding tone and
  // the end-pass collapse can refuse to fold a first install. The signal is the
  // same `globalConfig === null` the store stage uses (read here read-only); the
  // store stage re-affirms it once it has loaded the config in-stage.
  const firstInstall = loadGlobalConfig(resolveGlobalRoot()) === null;

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
    state: { firstInstall },
    renderer,
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

export function shouldUseInstallRenderer(_args: InitArgs, terminalInteractive: boolean): boolean {
  // F1 (grill GRL-20260625-install-flatness): the renderer carries the static
  // richness (section bars, step badges, summary card, error box) and is pure
  // print-and-go — it does NOT animate, so it never fights the interactive clack
  // prompts. The old gate reserved it for --yes/--dry-run, which left every real
  // interactive install on the bare console.log fallback (the "平淡" path the
  // grill diagnosed). Enable it for EVERY interactive run; only non-TTY
  // (pipes/CI) keeps the plain numbered fallback.
  return terminalInteractive;
}

function isInteractiveInit(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
}
