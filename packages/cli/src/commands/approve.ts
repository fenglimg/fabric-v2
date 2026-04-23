import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { isAbsolute, resolve } from "node:path";

import { approveHumanLock, readHumanLock, type HumanLockStatus } from "@fenglimg/fabric-server";
import { defineCommand, renderUsage } from "citty";

import { padEnd } from "../colors.js";
import { t } from "../i18n.js";

type ApproveArgs = {
  all?: boolean;
  interactive?: boolean;
  target: string;
};

export const approveCommand = defineCommand({
  meta: {
    name: "approve",
    description: t("cli.approve.description"),
  },
  args: {
    all: {
      type: "boolean",
      description: t("cli.approve.args.all.description"),
      default: false,
    },
    interactive: {
      type: "boolean",
      description: t("cli.approve.args.interactive.description"),
      default: false,
    },
    target: {
      type: "string",
      description: t("cli.approve.args.target.description"),
      default: process.cwd(),
    },
  },
  async run({ args }: { args: ApproveArgs }) {
    const target = normalizeTarget(args.target);

    if (args.all === args.interactive) {
      writeStdout(await renderUsage(approveCommand));
      process.exitCode = 1;
      return;
    }

    if (args.all) {
      await runApproveAll(target);
      return;
    }

    await runApproveInteractive(target);
  },
});

export default approveCommand;

export async function runApproveAll(projectRoot: string): Promise<void> {
  const driftEntries = await readDriftEntries(projectRoot);

  if (driftEntries.length === 0) {
    writeStdout(t("cli.approve.no-drift"));
    return;
  }

  let approvedCount = 0;
  for (const entry of driftEntries) {
    await approveEntry(projectRoot, entry);
    approvedCount += 1;
  }

  writeStdout(t("cli.approve.summary", { approved: String(approvedCount), skipped: "0", total: String(driftEntries.length) }));
}

export async function runApproveInteractive(projectRoot: string): Promise<void> {
  const driftEntries = await readDriftEntries(projectRoot);

  if (driftEntries.length === 0) {
    writeStdout(t("cli.approve.no-drift"));
    return;
  }

  const rl = createInterface({ input, output });
  let approvedCount = 0;
  let skippedCount = 0;

  try {
    for (const entry of driftEntries) {
      writeStdout(formatEntry(entry));
      const answer = (await rl.question(t("cli.approve.prompt"))).trim().toLowerCase();

      if (answer === "y" || answer === "yes") {
        await approveEntry(projectRoot, entry);
        approvedCount += 1;
        writeStdout(t("cli.approve.approved-one", { location: formatLocation(entry) }));
        continue;
      }

      skippedCount += 1;
      writeStdout(t("cli.approve.skipped-one", { location: formatLocation(entry) }));
    }
  } finally {
    rl.close();
  }

  writeStdout(
    t("cli.approve.summary", {
      approved: String(approvedCount),
      skipped: String(skippedCount),
      total: String(driftEntries.length),
    }),
  );
}

async function readDriftEntries(projectRoot: string): Promise<HumanLockStatus[]> {
  const entries = await readHumanLock(projectRoot);
  return entries.filter((entry) => entry.drift);
}

async function approveEntry(projectRoot: string, entry: HumanLockStatus): Promise<void> {
  await approveHumanLock(projectRoot, {
    file: entry.file,
    start_line: entry.start_line,
    end_line: entry.end_line,
    new_hash: entry.current_hash,
  });
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function formatEntry(entry: HumanLockStatus): string {
  return [
    formatLocation(entry),
    `${padEnd(t("cli.approve.table.expected"), 10)} ${shortenHash(entry.hash)}`,
    `${padEnd(t("cli.approve.table.current"), 10)} ${shortenHash(entry.current_hash)}`,
  ].join("\n");
}

function formatLocation(entry: HumanLockStatus): string {
  return `${entry.file}:${entry.start_line}-${entry.end_line}`;
}

function shortenHash(value: string): string {
  if (value === "missing") {
    return t("cli.shared.missing");
  }

  return value.slice(0, 15);
}

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}
