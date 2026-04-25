import { defineCommand } from "citty";

import { runDoctorAuditReport, runDoctorFix, runDoctorReport } from "@fenglimg/fabric-server";

import { padEnd, paint, symbol } from "../colors.js";
import { resolveDevMode } from "../dev-mode.js";
import { t } from "../i18n.js";

const DEFAULT_AUDIT_WINDOW_MINUTES = 5;

type DoctorArgs = {
  target?: string;
  audit?: boolean;
  fix?: boolean;
  "window-minutes"?: string;
};

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: t("cli.doctor.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.doctor.args.target.description"),
    },
    audit: {
      type: "boolean",
      description: t("cli.doctor.args.audit.description"),
      default: false,
    },
    fix: {
      type: "boolean",
      description: t("cli.doctor.args.fix.description"),
      default: false,
    },
    "window-minutes": {
      type: "string",
      description: t("cli.doctor.args.window-minutes.description"),
      default: String(DEFAULT_AUDIT_WINDOW_MINUTES),
    },
  },
  async run({ args }: { args: DoctorArgs }) {
    const workspaceRoot = process.cwd();
    const resolution = resolveDevMode(args.target, workspaceRoot);
    const fixReport = args.fix ? await runDoctorFix(resolution.target) : null;
    const report = fixReport?.report ?? await runDoctorReport(resolution.target);

    if (fixReport !== null) {
      writeStdout(fixReport.message);
    }

    writeStdout(`${renderStatus(report.status)} ${paint.ai("fab doctor")} ${paint.human(resolution.target)}`);
    for (const check of report.checks) {
      writeStdout(`${renderStatus(check.status)} ${check.name}: ${check.message}`);
    }

    if (!args.audit) {
      return;
    }

    const auditReport = await runDoctorAuditReport(resolution.target, {
      force: true,
      windowMs: parseWindowMinutes(args["window-minutes"]),
    });

    if (auditReport.mode === "off") {
      writeStderr(t("cli.doctor.audit.preview-only"));
    }

    if (auditReport.checkedPathCount === 0) {
      writeStderr(t("cli.doctor.audit.none"));
      return;
    }

    if (auditReport.violationCount === 0) {
      writeStderr(
        `${symbol.ok} ${t("cli.doctor.audit.clean", {
          count: String(auditReport.checkedPathCount),
          window: formatDuration(auditReport.windowMs),
        })}`,
      );
      return;
    }

    const writer = auditReport.mode === "strict" ? console.error : console.warn;
    writer(
      t("cli.doctor.audit.violations", {
        count: String(auditReport.violationCount),
        window: formatDuration(auditReport.windowMs),
      }),
    );
    writeStderr(
      `${padEnd(t("cli.doctor.audit.table.path"), 32)} ${padEnd(t("cli.doctor.audit.table.edit"), 22)} ${padEnd(t("cli.doctor.audit.table.rules"), 22)} ${t("cli.doctor.audit.table.intent")}`,
    );

    for (const violation of auditReport.violations) {
      writeStderr(
        `${padEnd(violation.path, 32)} ${padEnd(new Date(violation.editTs).toISOString(), 22)} ${padEnd(formatRulesTs(violation.lastRuleAccessTs), 22)} ${violation.intent}`,
      );
    }

    if (auditReport.mode === "strict") {
      process.exitCode = 1;
    }
  },
});

export default doctorCommand;

function renderStatus(status: "ok" | "warn" | "error"): string {
  if (status === "ok") {
    return symbol.ok;
  }

  if (status === "warn") {
    return symbol.warn;
  }

  return symbol.error;
}

function parseWindowMinutes(value: string | undefined): number {
  const minutes = Number.parseInt(value ?? String(DEFAULT_AUDIT_WINDOW_MINUTES), 10);

  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error(t("cli.doctor.errors.invalid-window", { value: value ?? "<unset>" }));
  }

  return minutes * 60 * 1000;
}

function formatDuration(durationMs: number): string {
  const minutes = Math.max(Math.floor(durationMs / (60 * 1000)), 1);
  return `${minutes}m`;
}

function formatRulesTs(value: number | null): string {
  return value === null ? t("cli.shared.none") : new Date(value).toISOString();
}

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
