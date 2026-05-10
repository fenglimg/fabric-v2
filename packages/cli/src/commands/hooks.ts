import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { defineCommand } from "citty";

import { t } from "../i18n.js";

type HooksInstallArgs = {
  target: string;
};

type InstallHooksOptions = {
  force?: boolean;
};

type HookAction = "created" | "appended" | "skipped" | "overwritten";
type PrepareAction = "added" | "left";

export type InstallHooksResult = {
  installed: string[];
  skipped: string[];
  hookPath: string;
  packageJsonPath: string;
  hookAction: HookAction;
  prepareAction: PrepareAction;
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
        await installHooks(args.target);
      },
    }),
  },
});

export default hooksCommand;

// v2/rc.2: husky pre-commit installer is removed. The `templates/husky/`
// directory was deleted in TASK-003 because the v2 hook story is owned by
// per-client mechanisms (Claude Code Stop/SessionStart hooks, Codex CLI
// hooks.json), not by a husky pre-commit shim. The function is kept as a
// throwing stub so existing callers (init.ts hooks stage, config command
// surface) get a clear error instead of a templating crash. rc.4 will
// revisit whether `fab hooks install` is restored under a v2 design or
// removed entirely.
export async function installHooks(
  target: string,
  _options: InstallHooksOptions = {},
): Promise<InstallHooksResult> {
  const normalizedTarget = normalizeTarget(target);
  assertExistingDirectory(normalizedTarget);
  throw new Error(
    `fab hooks install is not available in v2 (husky pre-commit template removed). ` +
      `Use per-client hooks under .claude/ and .codex/ instead. Target: ${normalizedTarget}`,
  );
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(t("cli.shared.target-invalid", { target }));
  }
}
