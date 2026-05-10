import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { defineCommand } from "citty";

import { t } from "../i18n.js";
import {
  installArchiveHintHook,
  mergeClaudeCodeHookConfig,
  mergeCodexHookConfig,
  type InstallStepResult,
} from "../install/skills-and-hooks.js";

type HooksInstallArgs = {
  target: string;
};

type InstallHooksOptions = {
  force?: boolean;
};

export type InstallHooksResult = {
  installed: string[];
  skipped: string[];
  errors: string[];
};

export const hooksCommand = defineCommand({
  meta: {
    name: "hooks",
    description: t("cli.hooks.description"),
  },
  subCommands: {
    install: defineCommand({
      meta: {
        name: "install",
        description: t("cli.hooks.install.description"),
      },
      args: {
        target: {
          type: "string",
          description: t("cli.hooks.install.args.target.description"),
          default: process.cwd(),
        },
      },
      async run({ args }: { args: HooksInstallArgs }) {
        const result = await installHooks(args.target);
        for (const path of result.installed) {
          console.log(`installed ${path}`);
        }
        for (const path of result.skipped) {
          console.log(`skipped ${path}`);
        }
        for (const message of result.errors) {
          console.error(`error ${message}`);
        }
      },
    }),
  },
});

export default hooksCommand;

/**
 * v2/rc.2 hook installer. Re-installable from `fabric hooks install` and
 * also invoked from `fabric init` via the bootstrap stage helpers. Performs
 * three steps in sequence (each idempotent):
 *   1. Copy templates/hooks/archive-hint.cjs into .claude/hooks/ + .codex/hooks/
 *   2. Deep-merge templates/hooks/configs/claude-code.json into .claude/settings.json
 *      (hooks.Stop[] array-append-with-dedupe — preserves user entries)
 *   3. Deep-merge templates/hooks/configs/codex-hooks.json into .codex/hooks.json
 *      (events.Stop[] array-append-with-dedupe)
 *
 * Returns the union of paths written, skipped, and any errors. Best-effort:
 * a single client's failure (missing directory, unreadable settings.json)
 * surfaces in `errors` but does not throw — the other client install still
 * runs.
 */
export async function installHooks(
  target: string,
  _options: InstallHooksOptions = {},
): Promise<InstallHooksResult> {
  const normalizedTarget = normalizeTarget(target);
  assertExistingDirectory(normalizedTarget);

  const results: InstallStepResult[] = [];
  results.push(...await runStep(() => installArchiveHintHook(normalizedTarget)));
  results.push(await runSingleStep("claude-hook-config", () => mergeClaudeCodeHookConfig(normalizedTarget)));
  results.push(await runSingleStep("codex-hook-config", () => mergeCodexHookConfig(normalizedTarget)));

  return summarizeResults(results);
}

async function runStep(
  fn: () => Promise<InstallStepResult[]>,
): Promise<InstallStepResult[]> {
  try {
    return await fn();
  } catch (error: unknown) {
    return [
      {
        step: "hook-install",
        path: "",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

async function runSingleStep(
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

function summarizeResults(results: InstallStepResult[]): InstallHooksResult {
  const installed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const r of results) {
    switch (r.status) {
      case "written":
        installed.push(r.path);
        break;
      case "skipped":
        skipped.push(r.path);
        break;
      case "error":
        errors.push(`${r.step} ${r.path}: ${r.message ?? "unknown error"}`);
        break;
    }
  }
  return { installed, skipped, errors };
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(t("cli.shared.target-invalid", { target }));
  }
}
