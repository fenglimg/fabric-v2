import { execSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import { defineCommand } from "citty";

type LedgerAppendArgs = {
  target: string;
  staged?: boolean;
};

type LedgerEntry = {
  ts: number;
  parent_sha: string;
  intent: string;
  affected_paths: string[];
  diff_stat: string;
};

const LEDGER_FILE = ".intent-ledger.jsonl";
const INITIAL_PARENT_SHA = "root";

export const ledgerAppendCommand = defineCommand({
  meta: {
    name: "ledger-append",
    description: "向 Fabric 意图日志添加一条记录。",
  },
  args: {
    target: {
      type: "string",
      description: "目标项目路径，默认为当前工作目录。",
      default: process.cwd(),
    },
    staged: {
      type: "boolean",
      description: "从暂存变更中推导记录（用于 pre-commit 阶段）。",
      default: false,
    },
  },
  async run({ args }: { args: LedgerAppendArgs }) {
    const target = normalizeTarget(args.target);
    assertExistingDirectory(target);

    if (!args.staged) {
      writeStderr("requires --staged in pre-commit context");
      process.exitCode = 1;
      return;
    }

    const stagedFiles = getStagedFiles(target).filter((file) => file !== LEDGER_FILE);

    if (stagedFiles.length === 0) {
      return;
    }

    const intent = deriveIntent(stagedFiles);
    const diffStat = readDiffStat(target).trim();
    const entry: LedgerEntry = {
      ts: Date.now(),
      parent_sha: readParentSha(target),
      intent,
      affected_paths: stagedFiles,
      diff_stat: diffStat,
    };

    if (hasMatchingTailEntry(target, entry)) {
      return;
    }

    appendFileSync(join(target, LEDGER_FILE), `${JSON.stringify(entry)}\n`, "utf8");
    execGit(target, `git add ${LEDGER_FILE}`);
  },
});

export default ledgerAppendCommand;

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Target must be an existing directory: ${target}`);
  }
}

function getStagedFiles(target: string): string[] {
  const output = execGit(target, "git diff --cached --name-only --no-renames");

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readDiffStat(target: string): string {
  return execGit(target, "git diff --cached --stat");
}

function readParentSha(target: string): string {
  try {
    return execGit(target, "git rev-parse --short HEAD").trim();
  } catch {
    return INITIAL_PARENT_SHA;
  }
}

function deriveIntent(stagedFiles: string[]): string {
  const explicitIntent = process.env.FABRIC_INTENT?.trim();

  if (explicitIntent) {
    return explicitIntent;
  }

  const uniqueNames = Array.from(new Set(stagedFiles.map((file) => basename(file))));
  const head = uniqueNames.slice(0, 2).join(", ");
  const suffix = uniqueNames.length > 2 ? ` +${uniqueNames.length - 2} more` : "";

  return `auto: ${head}${suffix}`;
}

function hasMatchingTailEntry(target: string, entry: LedgerEntry): boolean {
  const ledgerPath = join(target, LEDGER_FILE);

  if (!existsSync(ledgerPath)) {
    return false;
  }

  const tail = readFileSync(ledgerPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-1)[0];

  if (!tail) {
    return false;
  }

  try {
    const parsed = JSON.parse(tail) as Partial<LedgerEntry>;

    return (
      parsed.parent_sha === entry.parent_sha &&
      parsed.intent === entry.intent &&
      Array.isArray(parsed.affected_paths) &&
      parsed.affected_paths.length === entry.affected_paths.length &&
      parsed.affected_paths.every((value, index) => value === entry.affected_paths[index]) &&
      normalizeDiffStat(parsed.diff_stat) === normalizeDiffStat(entry.diff_stat)
    );
  } catch {
    return false;
  }
}

function normalizeDiffStat(diffStat: unknown): string {
  if (typeof diffStat !== "string") {
    return "";
  }

  return diffStat
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/\s+\|\s+/g, " | "))
    .map((line) => line.replace(/\s+/g, " "))
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes(LEDGER_FILE))
    .filter((line) => !/\d+ files? changed(?:, \d+ insertions?\(\+\))?(?:, \d+ deletions?\(-\))?$/.test(line.trim()))
    .join("\n");
}

function execGit(target: string, command: string): string {
  return execSync(command, {
    cwd: target,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
