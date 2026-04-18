import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";

type HooksInstallArgs = {
  target: string;
};

type PackageJson = {
  scripts?: Record<string, string>;
  [key: string]: unknown;
};

export const hooksCommand = defineCommand({
  meta: {
    name: "hooks",
    description: "Manage Fabric git hook templates.",
  },
  subCommands: {
    install: defineCommand({
      meta: {
        name: "install",
        description: "Install the Fabric Husky pre-commit hook template.",
      },
      args: {
        target: {
          type: "string",
          description: "Target project path. Defaults to the current working directory.",
          default: process.cwd(),
        },
      },
      async run({ args }: { args: HooksInstallArgs }) {
        const target = normalizeTarget(args.target);
        assertExistingDirectory(target);

        const huskyDir = join(target, ".husky");
        const hookPath = join(huskyDir, "pre-commit");
        const packageJsonPath = join(target, "package.json");

        if (!existsSync(packageJsonPath)) {
          throw new Error(`package.json is required to install hooks: ${packageJsonPath}`);
        }

        mkdirSync(huskyDir, { recursive: true });
        writeFileSync(hookPath, readFileSync(findTemplatePath("templates/husky/pre-commit"), "utf8"), "utf8");
        chmodSync(hookPath, 0o755);

        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
        const scripts =
          packageJson.scripts && typeof packageJson.scripts === "object" && !Array.isArray(packageJson.scripts)
            ? packageJson.scripts
            : {};
        const hadPrepare = typeof scripts.prepare === "string" && scripts.prepare.trim().length > 0;

        if (!hadPrepare) {
          scripts.prepare = "husky install";
          packageJson.scripts = scripts;
          writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
        }

        writeStderr(`Installed ${hookPath}`);
        if (hadPrepare) {
          writeStderr(`Left existing prepare script unchanged in ${packageJsonPath}`);
        } else {
          writeStderr(`Added prepare script to ${packageJsonPath}`);
        }
      },
    }),
  },
});

export default hooksCommand;

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Target must be an existing directory: ${target}`);
  }
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

  throw new Error(`Template not found: ${relativePath}`);
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

  return candidates;
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
