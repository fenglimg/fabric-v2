import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";

import { t } from "../i18n.js";

type HooksInstallArgs = {
  target: string;
};

type InstallHooksOptions = {
  force?: boolean;
};

type PackageJson = {
  scripts?: Record<string, string>;
  [key: string]: unknown;
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
        const result = await installHooks(args.target);

        if (result.hookAction === "skipped") {
          writeStderr(t("cli.hooks.install.hook-skipped", { path: result.hookPath }));
        } else if (result.hookAction === "appended") {
          writeStderr(t("cli.hooks.install.hook-appended", { path: result.hookPath }));
        } else {
          writeStderr(t("cli.hooks.install.hook-created", { path: result.hookPath }));
        }
        if (result.prepareAction === "left") {
          writeStderr(t("cli.hooks.install.prepare-left", { path: result.packageJsonPath }));
        } else {
          writeStderr(t("cli.hooks.install.prepare-added", { path: result.packageJsonPath }));
        }
      },
    }),
  },
});

export default hooksCommand;

export async function installHooks(
  target: string,
  options: InstallHooksOptions = {},
): Promise<InstallHooksResult> {
  const normalizedTarget = normalizeTarget(target);
  assertExistingDirectory(normalizedTarget);

  const huskyDir = join(normalizedTarget, ".husky");
  const hookPath = join(huskyDir, "pre-commit");
  const packageJsonPath = join(normalizedTarget, "package.json");

  if (!existsSync(packageJsonPath)) {
    throw new Error(t("cli.hooks.errors.package-json-required", { path: packageJsonPath }));
  }

  mkdirSync(huskyDir, { recursive: true });
  const templateContent = readFileSync(findTemplatePath("templates/husky/pre-commit"), "utf8");
  const hookAction = installHookFile(hookPath, templateContent, options.force);
  chmodSync(hookPath, 0o755);

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
  const scripts =
    packageJson.scripts && typeof packageJson.scripts === "object" && !Array.isArray(packageJson.scripts)
      ? packageJson.scripts
      : {};
  const hadPrepare = typeof scripts.prepare === "string" && scripts.prepare.trim().length > 0;

  let prepareAction: PrepareAction = "left";
  if (!hadPrepare) {
    scripts.prepare = "husky install";
    packageJson.scripts = scripts;
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    prepareAction = "added";
  }

  const installed: string[] = [];
  const skipped: string[] = [];

  if (hookAction === "skipped") {
    skipped.push(hookPath);
  } else {
    installed.push(hookPath);
  }

  if (prepareAction === "left") {
    skipped.push(packageJsonPath);
  } else {
    installed.push(packageJsonPath);
  }

  return {
    installed,
    skipped,
    hookPath,
    packageJsonPath,
    hookAction,
    prepareAction,
  };
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(t("cli.shared.target-invalid", { target }));
  }
}

function installHookFile(hookPath: string, templateContent: string, force?: boolean): HookAction {
  if (existsSync(hookPath)) {
    if (force) {
      writeFileSync(hookPath, templateContent, "utf8");
      return "overwritten";
    }

    const existing = readFileSync(hookPath, "utf8");
    if (existing.includes("FAB_BIN=")) {
      return "skipped";
    }

    const fabricBlock = templateContent.replace(/^#!\/bin\/sh\n/, "");
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(hookPath, `${existing}${separator}# --- Fabric ---\n${fabricBlock}`, "utf8");
    return "appended";
  }

  writeFileSync(hookPath, templateContent, "utf8");
  return "created";
}

function findTemplatePath(relativePath: string): string {
  const currentModuleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...templateCandidatesFrom(process.cwd(), relativePath),
    ...templateCandidatesFrom(currentModuleDir, relativePath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(t("cli.shared.template-not-found", { path: relativePath }));
}

function templateCandidatesFrom(start: string, relativePath: string): string[] {
  const candidates: string[] = [];
  let current = resolve(start);

  while (true) {
    candidates.push(join(current, ...relativePath.split("/")));

    const parent = dirname(current);
    if (parent === current || parse(current).root === current) {
      break;
    }

    current = parent;
  }

  return candidates.reverse();
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
