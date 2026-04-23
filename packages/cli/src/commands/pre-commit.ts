import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { agentsMetaSchema, type AgentsMeta } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";
import { minimatch } from "minimatch";
import { LEGACY_LEDGER_PATH, LEDGER_PATH } from "@fenglimg/fabric-server";

import { resolveDevModeTarget } from "../dev-mode.js";
import { t } from "../i18n.js";
import humanLintModule from "./human-lint.js";
import ledgerAppendModule from "./ledger-append.js";
import syncMetaModule from "./sync-meta.js";

type CmdLike = { run?: (ctx: { args: Record<string, unknown> }) => unknown | Promise<unknown> };

async function runOrFail(name: string, cmd: CmdLike, args: Record<string, unknown>): Promise<void> {
  try {
    await cmd.run?.({ args });
  } catch (err) {
    process.stderr.write(
      `${t("cli.pre-commit.run-failed", { name, message: (err as Error).message })}\n`,
    );
    process.exit(1);
  }
}

function getStagedFiles(target: string): string[] {
  try {
    const output = execSync("git diff --cached --name-only --no-renames", {
      cwd: target,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // If git command fails, fall through to full checks.
    return [];
  }
}

function tryReadAgentsMeta(target: string): AgentsMeta | null {
  const metaPath = join(target, ".fabric", "agents.meta.json");

  try {
    const raw = readFileSync(metaPath, "utf8");
    return agentsMetaSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function matchesFabricScope(stagedFiles: string[], meta: AgentsMeta): boolean {
  const scopeGlobs = Object.values(meta.nodes)
    .filter((node) => node.file !== ".fabric/bootstrap/README.md" && node.file !== "AGENTS.md")
    .map((node) => node.scope_glob);

  return stagedFiles.some((file) =>
    file === ".fabric/bootstrap/README.md" ||
    file === "AGENTS.md" ||
    file === ".fabric/agents.meta.json" ||
    file === ".fabric/human-lock.json" ||
    file === LEDGER_PATH ||
    file === LEGACY_LEDGER_PATH ||
    scopeGlobs.some((pattern) => minimatch(file, pattern, { dot: true })),
  );
}

export default defineCommand({
  meta: {
    name: "pre-commit",
    description: t("cli.pre-commit.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.pre-commit.args.target.description"),
    },
  },
  async run({ args }) {
    const target = resolveDevModeTarget(args.target as string | undefined);

    // Fast-path: skip all checks if no staged files match any fabric-managed scope_glob.
    const stagedFiles = getStagedFiles(target);
    const meta = tryReadAgentsMeta(target);

    if (stagedFiles.length > 0 && meta !== null && !matchesFabricScope(stagedFiles, meta)) {
      process.stderr.write("No fabric-managed files staged, skipping checks\n");
      return;
    }

    // 1. sync-meta --check-only — fail if drift detected
    await runOrFail("sync-meta --check-only", syncMetaModule as CmdLike, {
      target,
      "check-only": true,
    });

    // 2. human-lint — fail if @HUMAN sections modified
    await runOrFail("human-lint", humanLintModule as CmdLike, { target });

    // 3. ledger-append --staged — append intent entry for this commit
    //    Only runs when there is actually a staged diff (handled inside ledger-append).
    await runOrFail("ledger-append --staged", ledgerAppendModule as CmdLike, {
      target,
      staged: true,
    });

    // Exit 0 implicitly — caller (.husky/pre-commit) handles the .fabric/agents.meta.json guard separately.
  },
});
