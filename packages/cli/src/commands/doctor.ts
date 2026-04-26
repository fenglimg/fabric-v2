import { defineCommand } from "citty";

import { runDoctorFix, runDoctorReport, type DoctorIssue, type DoctorReport } from "@fenglimg/fabric-server";

import { paint, symbol } from "../colors.js";
import { resolveDevMode } from "../dev-mode.js";
import { t } from "../i18n.js";

type DoctorArgs = {
  target?: string;
  fix?: boolean;
  json?: boolean;
  strict?: boolean;
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
    fix: {
      type: "boolean",
      description: t("cli.doctor.args.fix.description"),
      default: false,
    },
    json: {
      type: "boolean",
      description: t("cli.doctor.args.json.description"),
      default: false,
    },
    strict: {
      type: "boolean",
      description: t("cli.doctor.args.strict.description"),
      default: false,
    },
  },
  async run({ args }: { args: DoctorArgs }) {
    const workspaceRoot = process.cwd();
    const resolution = resolveDevMode(args.target, workspaceRoot);
    const fixReport = args.fix === true ? await runDoctorFix(resolution.target) : null;
    const report = fixReport?.report ?? await runDoctorReport(resolution.target);

    if (args.json === true) {
      writeStdout(JSON.stringify(fixReport ?? report, null, 2));
    } else {
      if (fixReport !== null) {
        writeStdout(fixReport.message);
      }
      renderHumanReport(report);
    }

    if (report.status === "error" || (args.strict === true && (report.status === "warn" || report.warnings.length > 0))) {
      process.exitCode = 1;
    }
  },
});

export default doctorCommand;

function renderHumanReport(report: DoctorReport): void {
  writeStdout(`${renderStatus(report.status)} ${paint.ai("fabric doctor")} ${paint.human(report.summary.target)}`);
  for (const check of report.checks) {
    writeStdout(`${renderStatus(check.status)} ${check.name}: ${check.message}`);
  }
  writeIssueSection("Fixable errors", report.fixable_errors);
  writeIssueSection("Manual errors", report.manual_errors);
  writeIssueSection("Warnings", report.warnings);
}

function writeIssueSection(title: string, issues: DoctorIssue[]): void {
  if (issues.length === 0) {
    return;
  }

  writeStdout("");
  writeStdout(`${title}:`);
  for (const issue of issues) {
    writeStdout(`- ${issue.code}: ${issue.message}`);
  }
}

function renderStatus(status: "ok" | "warn" | "error"): string {
  if (status === "ok") {
    return symbol.ok;
  }
  if (status === "warn") {
    return symbol.warn;
  }
  return symbol.error;
}

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}
