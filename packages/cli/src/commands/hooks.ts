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
    description: "管理 Fabric Git 钩子模板。",
  },
  subCommands: {
    install: defineCommand({
      meta: {
        name: "install",
        description: "安装 Fabric Husky pre-commit 钩子模板。",
      },
      args: {
        target: {
          type: "string",
          description: "目标项目路径，默认为当前工作目录。",
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
        const templateContent = readFileSync(findTemplatePath("templates/husky/pre-commit"), "utf8");

        let hookAction: "created" | "appended" | "skipped";
        if (existsSync(hookPath)) {
          const existing = readFileSync(hookPath, "utf8");
          if (existing.includes("FAB_BIN=")) {
            hookAction = "skipped";
          } else {
            const fabricBlock = templateContent.replace(/^#!\/bin\/sh\n/, "");
            const separator = existing.endsWith("\n") ? "\n" : "\n\n";
            writeFileSync(hookPath, `${existing}${separator}# --- Fabric ---\n${fabricBlock}`, "utf8");
            hookAction = "appended";
          }
        } else {
          writeFileSync(hookPath, templateContent, "utf8");
          hookAction = "created";
        }

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

        if (hookAction === "skipped") {
          writeStderr(`Fabric hook already present in ${hookPath}, skipped.`);
        } else if (hookAction === "appended") {
          writeStderr(`Appended Fabric hook to existing ${hookPath}`);
        } else {
          writeStderr(`Created ${hookPath}`);
        }
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
