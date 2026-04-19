import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { defineCommand } from "citty";

type HumanLintArgs = {
  target: string;
};

type HumanLockEntry = {
  file: string;
  start_line: number;
  end_line: number;
  hash: string;
};

type HumanLockFile = {
  locked?: HumanLockEntry[];
};

type FileSnapshot = {
  file: string;
  content: string | null;
};

type Violation = {
  location: string;
  expected: string;
  actual: string;
};

export const humanLintCommand = defineCommand({
  meta: {
    name: "human-lint",
    description: "验证锁定的人工编辑区块。",
  },
  args: {
    target: {
      type: "string",
      description: "目标项目路径，默认为当前工作目录。",
      default: process.cwd(),
    },
  },
  async run({ args }: { args: HumanLintArgs }) {
    const target = normalizeTarget(args.target);
    const humanLockPath = join(target, ".fabric", "human-lock.json");

    if (!existsSync(humanLockPath)) {
      return;
    }

    const parsed = JSON.parse(await readFile(humanLockPath, "utf8")) as HumanLockFile;
    const locked = Array.isArray(parsed.locked) ? parsed.locked : [];

    if (locked.length === 0) {
      return;
    }

    const snapshots = await Promise.all(
      Array.from(new Set(locked.map((entry) => entry.file))).map(async (file): Promise<FileSnapshot> => {
        try {
          return {
            file,
            content: await readFile(join(target, file), "utf8"),
          };
        } catch {
          return {
            file,
            content: null,
          };
        }
      }),
    );
    const snapshotByFile = new Map(snapshots.map((snapshot) => [snapshot.file, snapshot]));
    const violations: Violation[] = [];

    for (const entry of locked) {
      const snapshot = snapshotByFile.get(entry.file);
      const actual = snapshot?.content === null || snapshot === undefined ? "missing" : hashLockedContent(snapshot.content, entry);

      if (actual !== entry.hash) {
        violations.push({
          location: `${entry.file}:${entry.start_line}-${entry.end_line}`,
          expected: shortenHash(entry.hash),
          actual: shortenHash(actual),
        });
      }
    }

    if (violations.length === 0) {
      return;
    }

    writeStderr("Human-locked content drift detected. Revert the edit or update approved hashes before committing.");
    writeStderr("Location                         Expected            Got");

    for (const violation of violations) {
      writeStderr(
        `${violation.location.padEnd(32)} ${violation.expected.padEnd(18)} ${violation.actual}`,
      );
    }

    process.exitCode = 1;
  },
});

export default humanLintCommand;

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function hashLockedContent(content: string, entry: HumanLockEntry): string {
  const lines = content.split(/\r?\n/);
  const slice = lines.slice(Math.max(entry.start_line - 1, 0), Math.max(entry.end_line, 0)).join("\n");

  return `sha256:${createHash("sha256").update(slice).digest("hex")}`;
}

function shortenHash(value: string): string {
  if (value === "missing") {
    return value;
  }

  return value.slice(0, 15);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
