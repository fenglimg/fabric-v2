import { defineCommand } from "citty";

import {
  checkLockOrThrow,
  runDoctorApplyLint,
  runDoctorFix,
  runDoctorReport,
  type DoctorApplyLintReport,
  type DoctorReport,
} from "@fenglimg/fabric-server";

import { paint, symbol } from "../colors.js";
import { resolveDevMode } from "../dev-mode.js";
import { t } from "../i18n.js";

type DoctorArgs = {
  target?: string;
  fix?: boolean;
  json?: boolean;
  strict?: boolean;
  force?: boolean;
  // rc.4 TASK-003: enable lint mutations (orphan demote / stale archive /
  // index counter bump). Default doctor invocation remains report-only.
  "apply-lint"?: boolean;
};

type DoctorIssue = DoctorReport["fixable_errors"][number];

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
    force: {
      type: "boolean",
      description: t("cli.doctor.args.force.description"),
      default: false,
    },
    "apply-lint": {
      type: "boolean",
      description: t("cli.doctor.args.apply-lint.description"),
      default: false,
    },
  },
  async run({ args }: { args: DoctorArgs }) {
    const workspaceRoot = process.cwd();
    const resolution = resolveDevMode(args.target, workspaceRoot);

    // Preflight: refuse to run when serve is actively holding the lock, unless --force
    checkLockOrThrow(resolution.target, { force: args.force });

    const applyLint = args["apply-lint"] === true;
    const fix = args.fix === true;

    // Mutual exclusion: --apply-lint and --fix target different mutation
    // surfaces (lint mutations are user-knowledge state; --fix mutates derived
    // state like agents.meta.json revision). Combining them is ambiguous —
    // require the operator to make a choice. See TASK-003 acceptance criteria.
    if (applyLint && fix) {
      writeStderr(t("cli.doctor.errors.apply-lint-fix-mutually-exclusive"));
      process.exitCode = 1;
      return;
    }

    let applyLintReport: DoctorApplyLintReport | null = null;
    let fixReport: Awaited<ReturnType<typeof runDoctorFix>> | null = null;
    let report: DoctorReport;

    if (applyLint) {
      applyLintReport = await runDoctorApplyLint(resolution.target);
      report = applyLintReport.report;
    } else if (fix) {
      fixReport = await runDoctorFix(resolution.target);
      report = fixReport.report;
    } else {
      report = await runDoctorReport(resolution.target);
    }

    if (args.json === true) {
      writeStdout(JSON.stringify(applyLintReport ?? fixReport ?? report, null, 2));
    } else {
      if (applyLintReport !== null) {
        writeStdout(applyLintReport.message);
        if (applyLintReport.aborted && applyLintReport.abort_reason !== undefined) {
          writeStderr(applyLintReport.abort_reason);
        }
        renderApplyLintMutations(applyLintReport);
      } else if (fixReport !== null) {
        writeStdout(fixReport.message);
      }
      renderHumanReport(report);
    }

    // Exit code rules:
    //   * --apply-lint aborted (manual_error blocker) → 1
    //   * --apply-lint with any failed mutation → 1
    //   * any error status (or strict + warnings) → 1
    //   * otherwise → 0
    if (applyLintReport !== null) {
      if (applyLintReport.aborted) {
        process.exitCode = 1;
        return;
      }
      if (applyLintReport.mutations.some((m) => !m.applied)) {
        process.exitCode = 1;
        return;
      }
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
  writeIssueSection(t("doctor.section.fixable"), report.fixable_errors);
  writeIssueSection(t("doctor.section.manual"), report.manual_errors);
  writeIssueSection(t("doctor.section.warnings"), report.warnings);
}

function renderApplyLintMutations(applyLintReport: DoctorApplyLintReport): void {
  if (applyLintReport.mutations.length === 0) {
    return;
  }
  writeStdout("");
  writeStdout(t("doctor.section.apply-lint-mutations"));
  for (const mutation of applyLintReport.mutations) {
    const marker = mutation.applied ? symbol.ok : symbol.error;
    const errSuffix = mutation.applied || mutation.error === undefined ? "" : ` (${mutation.error})`;
    writeStdout(`${marker} ${mutation.kind}: ${mutation.path} [${mutation.detail}]${errSuffix}`);
  }
}

function writeIssueSection(title: string, issues: DoctorIssue[]): void {
  if (issues.length === 0) {
    return;
  }

  writeStdout("");
  writeStdout(title);
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

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
