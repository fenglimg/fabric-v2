import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";

import {
  checkLockOrThrow,
  runDoctorApplyLint,
  runDoctorFix,
  runDoctorReport,
  type DoctorApplyLintReport,
  type DoctorIssue,
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
  // rc.7 T11: skip the safety confirm before --apply-lint mutates frontmatter
  // and runs git mv. Required for any non-tty invocation (CI, nested
  // pipelines) unless FABRIC_NONINTERACTIVE=1 is set in the environment.
  yes?: boolean;
};

// rc.7 T11: lint codes that --apply-lint will mutate, mapped to the human
// label used in the confirm preview. We derive the mutation plan from the
// pre-flight DoctorReport (fixable_errors + warnings) so the preview can be
// rendered BEFORE any mutation runs. Codes outside this set are not part of
// the apply-lint surface and are not counted.
const APPLY_LINT_CODE_LABELS: Record<string, string> = {
  knowledge_orphan_demote_required: "demote (maturity)",
  knowledge_stale_archive_required: "archive (git mv)",
  knowledge_pending_auto_archive: "archive (git mv, pending)",
  knowledge_index_drift: "counter bump (agents.meta)",
  knowledge_session_hints_stale: "cache delete",
};

type ApplyLintPlan = {
  totalCount: number;
  // Per-code summary lines (e.g. "demote (maturity): 3 entry"). Ordered by
  // label for stable rendering.
  perCodeLines: string[];
  // Up to N per-entry preview lines to give the user a hint about what is
  // about to change. Long plans truncate with a tail summary line.
  previewLines: string[];
};

const PLAN_PREVIEW_LIMIT = 12;

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
    // rc.7 T11: skip the safety confirm before mutations. Required for any
    // non-tty invocation that wants to run --apply-lint without setting
    // FABRIC_NONINTERACTIVE=1 in the environment.
    yes: {
      type: "boolean",
      description: t("cli.doctor.args.yes.description"),
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
      // rc.7 T11: safety prompt. Compute the mutation plan from a pre-flight
      // DoctorReport, render it, then either bypass via --yes /
      // FABRIC_NONINTERACTIVE=1 or ask the user. Default-N to make
      // accidental mutation impossible. Non-tty stdin without a bypass is
      // a hard error — we never want CI to flip into "user said yes" by
      // accident.
      const preReport = await runDoctorReport(resolution.target);
      const plan = computeApplyLintPlan(preReport);
      const yesFlag = args.yes === true;
      const envBypass = process.env.FABRIC_NONINTERACTIVE === "1";

      if (plan.totalCount === 0) {
        // No mutations would happen — skip the prompt entirely. We still run
        // runDoctorApplyLint so the report is correctly tagged as a no-op
        // pass; the existing message text covers this case.
      } else {
        renderApplyLintPlan(plan);
        const decision = await resolveApplyLintConsent({
          yesFlag,
          envBypass,
          plan,
        });
        if (decision === "abort") {
          process.exitCode = 1;
          return;
        }
      }

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

// ---------------------------------------------------------------------------
// rc.7 T11: --apply-lint safety prompt helpers
// ---------------------------------------------------------------------------

/**
 * Derive a mutation plan summary from a DoctorReport. We count entries in
 * fixable_errors AND warnings whose `code` is one of the apply-lint surfaces.
 * Some mutations (orphan demote) surface as warnings rather than fixable
 * errors per their severity, so we must scan both lists.
 *
 * Returns zero counts when there is nothing to mutate. Caller is responsible
 * for skipping the prompt in that case (we don't ask "Proceed?" for a no-op).
 */
function computeApplyLintPlan(report: DoctorReport): ApplyLintPlan {
  const buckets: Record<string, DoctorIssue[]> = {};
  const sources: DoctorIssue[] = [
    ...report.fixable_errors,
    ...report.warnings,
  ];
  for (const issue of sources) {
    if (APPLY_LINT_CODE_LABELS[issue.code] === undefined) continue;
    if (!Array.isArray(buckets[issue.code])) {
      buckets[issue.code] = [];
    }
    buckets[issue.code].push(issue);
  }
  const codes = Object.keys(buckets).sort((a, b) =>
    APPLY_LINT_CODE_LABELS[a].localeCompare(APPLY_LINT_CODE_LABELS[b]),
  );
  const perCodeLines: string[] = [];
  let totalCount = 0;
  for (const code of codes) {
    const items = buckets[code];
    totalCount += items.length;
    perCodeLines.push(`  - ${APPLY_LINT_CODE_LABELS[code]}: ${items.length}`);
  }

  const previewLines: string[] = [];
  const flattened = codes.flatMap((c) => buckets[c]);
  for (const item of flattened.slice(0, PLAN_PREVIEW_LIMIT)) {
    const where = item.path !== undefined && item.path.length > 0 ? `${item.path}` : "(no path)";
    previewLines.push(`    • ${where} — ${item.message}`);
  }
  if (flattened.length > PLAN_PREVIEW_LIMIT) {
    previewLines.push(`    • ... and ${flattened.length - PLAN_PREVIEW_LIMIT} more`);
  }

  return { totalCount, perCodeLines, previewLines };
}

function renderApplyLintPlan(plan: ApplyLintPlan): void {
  writeStdout("");
  writeStdout(`${paint.warn("apply-lint mutation plan")} (${plan.totalCount} total)`);
  for (const line of plan.perCodeLines) {
    writeStdout(line);
  }
  if (plan.previewLines.length > 0) {
    writeStdout("");
    writeStdout("  preview:");
    for (const line of plan.previewLines) {
      writeStdout(line);
    }
  }
}

type ApplyLintDecision = "proceed" | "abort";

async function resolveApplyLintConsent(options: {
  yesFlag: boolean;
  envBypass: boolean;
  plan: ApplyLintPlan;
}): Promise<ApplyLintDecision> {
  if (options.yesFlag || options.envBypass) {
    return "proceed";
  }
  // Non-tty stdin without an explicit bypass: refuse. CI must opt in via
  // --yes or FABRIC_NONINTERACTIVE=1 so a stray non-interactive shell can
  // never silently mutate a workspace.
  if (process.stdin.isTTY !== true) {
    writeStderr(
      "doctor --apply-lint: stdin is not a TTY and neither --yes nor FABRIC_NONINTERACTIVE=1 is set. Refusing to mutate.",
    );
    return "abort";
  }
  const message = `About to apply ${options.plan.totalCount} mutation(s) to knowledge entries (frontmatter writes + git mv + cache deletes). Proceed?`;
  const answer = await confirm({
    message,
    initialValue: false,
  });
  if (isCancel(answer) || answer !== true) {
    writeStderr("doctor --apply-lint: aborted by user.");
    return "abort";
  }
  return "proceed";
}
