import { cancel, confirm, group, intro, isCancel, log, note, outro, select } from "@clack/prompts";

import type { ClaudeMcpScope } from "../config/json.js";
import type { DetectedClientSupport } from "../config/resolver.js";
import { t } from "../i18n.js";
import type { InitOptions, InitStageName } from "../commands/install.js";
import { printInitPlanSummary } from "./install-summary.js";
import { promptReceipt } from "./theme-clack.js";

export type McpInstallMode = "global" | "local";

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

export type InitWizardAdapter = {
  run(context: InitWizardContext): Promise<InitWizardSelection | null>;
};

const INIT_WIZARD_GROUP_CANCELLED = Symbol("init-wizard-group-cancelled");

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

      // flat-design-system Wave4 (TASK-004): print the flat ✓ receipt of the chosen
      // stages AFTER the clack `group` has fully resolved — printing mid-group would
      // interleave with clack's group rendering. The group's controls stay native
      // (C-006); this is a separate gutter-free line.
      const enabledStageLabels = [
        groupedSelection.bootstrap ? t("cli.install.wizard.stage.bootstrap.short") : null,
        groupedSelection.mcp ? t("cli.install.wizard.stage.mcp.short") : null,
        groupedSelection.hooks ? t("cli.install.wizard.stage.hooks.short") : null,
      ].filter((label): label is string => label !== null);
      promptReceipt(
        "selected",
        enabledStageLabels.length > 0 ? enabledStageLabels.join(", ") : t("cli.shared.none"),
      );

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
        // flat-design-system Wave4 (TASK-004): No / cancel → flat red x receipt.
        promptReceipt("cancelled");
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

function formatInitModeBadge(options: InitOptions): string {
  if (options.planOnly) {
    return t("cli.install.mode.badge.plan");
  }

  return t("cli.install.mode.badge.default");
}
