import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";

import {
  appendEventLedgerEvent,
  checkLockOrThrow,
  runDoctorApplyLint as runDoctorFixKnowledge,
  runDoctorFix,
  runDoctorReport,
  type DoctorApplyLintReport as DoctorFixKnowledgeReport,
  type DoctorIssue,
  type DoctorReport,
} from "@fenglimg/fabric-server";

import { paint, symbol } from "../colors.js";
import { resolveDevMode } from "../dev-mode.js";
import { t } from "../i18n.js";
import { runInitScan } from "./scan.js";

type DoctorArgs = {
  target?: string;
  fix?: boolean;
  json?: boolean;
  strict?: boolean;
  // rc.4 TASK-003 (rc.15 rename): enable lint mutations (orphan demote /
  // stale archive / index counter bump). Default doctor invocation remains
  // report-only. Renamed from --apply-lint in rc.15 for parallel naming with
  // --fix (server-side runDoctorApplyLint kept per blast-radius decision).
  "fix-knowledge"?: boolean;
  // rc.15 TASK-003: --rescan re-runs the init scan BEFORE the doctor report
  // to rebuild .fabric/agents.meta.json forensic state. Composable with
  // --fix and --fix-knowledge (single-pass: rescan → mutations → report).
  rescan?: boolean;
  // rc.7 T11: skip the safety confirm before --fix-knowledge mutates frontmatter
  // and runs git mv. Required for any non-tty invocation (CI, nested
  // pipelines) unless FABRIC_NONINTERACTIVE=1 is set in the environment.
  yes?: boolean;
};

// rc.7 T11: lint codes that --fix-knowledge will mutate, mapped to the human
// label used in the confirm preview. We derive the mutation plan from the
// pre-flight DoctorReport (fixable_errors + warnings) so the preview can be
// rendered BEFORE any mutation runs. Codes outside this set are not part of
// the fix-knowledge surface and are not counted.
const FIX_KNOWLEDGE_CODE_LABELS: Record<string, string> = {
  knowledge_orphan_demote_required: "demote (maturity)",
  knowledge_stale_archive_required: "archive (git mv)",
  knowledge_pending_auto_archive: "archive (git mv, pending)",
  knowledge_index_drift: "counter bump (agents.meta)",
  knowledge_session_hints_stale: "cache delete",
};

type FixKnowledgePlan = {
  totalCount: number;
  // Per-code summary lines (e.g. "demote (maturity): 3 entry"). Ordered by
  // label for stable rendering.
  perCodeLines: string[];
  // Up to N per-entry preview lines to give the user a hint about what is
  // about to change. Long plans truncate with a tail summary line.
  previewLines: string[];
};

const PLAN_PREVIEW_LIMIT = 12;

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
    "fix-knowledge": {
      type: "boolean",
      description: t("cli.doctor.args.fix-knowledge.description"),
      default: false,
    },
    json: {
      type: "boolean",
      description: t("cli.doctor.args.json.description"),
      default: false,
    },
    rescan: {
      type: "boolean",
      description: t("cli.doctor.args.rescan.description"),
      default: false,
    },
    strict: {
      type: "boolean",
      description: t("cli.doctor.args.strict.description"),
      default: false,
    },
    // rc.7 T11: skip the safety confirm before mutations. Required for any
    // non-tty invocation that wants to run --fix-knowledge without setting
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

    // Preflight: refuse to run when serve is actively holding the lock.
    // rc.15: --force was removed (drift→abort principle).
    checkLockOrThrow(resolution.target);

    const fixKnowledge = args["fix-knowledge"] === true;
    const fix = args.fix === true;
    const rescan = args.rescan === true;

    // Mutual exclusion: --fix-knowledge and --fix target different mutation
    // surfaces (knowledge mutations are user state; --fix mutates derived
    // state like agents.meta.json revision). Combining them is ambiguous —
    // require the operator to make a choice. --rescan composes with either
    // (single-pass: rescan → mutations → report).
    if (fixKnowledge && fix) {
      writeStderr(t("cli.doctor.errors.fix-knowledge-fix-mutually-exclusive"));
      process.exitCode = 1;
      return;
    }

    // rc.15 TASK-003: --rescan re-runs the init scan BEFORE any doctor
    // mutations or the report, rebuilding agents.meta.json forensic state.
    // Composable with --fix and --fix-knowledge so the rescan output feeds
    // into a fresh doctor pass in a single invocation.
    if (rescan) {
      await runInitScan(resolution.target, { source: "doctor-rescan" });
    }

    let fixKnowledgeReport: DoctorFixKnowledgeReport | null = null;
    let fixReport: Awaited<ReturnType<typeof runDoctorFix>> | null = null;
    let report: DoctorReport;

    if (fixKnowledge) {
      // rc.7 T11: safety prompt. Compute the mutation plan from a pre-flight
      // DoctorReport, render it, then either bypass via --yes /
      // FABRIC_NONINTERACTIVE=1 or ask the user. Default-N to make
      // accidental mutation impossible. Non-tty stdin without a bypass is
      // a hard error — we never want CI to flip into "user said yes" by
      // accident.
      const preReport = await runDoctorReport(resolution.target);
      const plan = computeFixKnowledgePlan(preReport);
      const yesFlag = args.yes === true;
      const envBypass = process.env.FABRIC_NONINTERACTIVE === "1";

      if (plan.totalCount === 0) {
        // No mutations would happen — skip the prompt entirely. We still run
        // runDoctorFixKnowledge so the report is correctly tagged as a no-op
        // pass; the existing message text covers this case.
      } else {
        renderFixKnowledgePlan(plan);
        const decision = await resolveFixKnowledgeConsent({
          yesFlag,
          envBypass,
          plan,
        });
        if (decision === "abort") {
          process.exitCode = 1;
          return;
        }
      }

      fixKnowledgeReport = await runDoctorFixKnowledge(resolution.target);
      report = fixKnowledgeReport.report;
    } else if (fix) {
      fixReport = await runDoctorFix(resolution.target);
      report = fixReport.report;
    } else {
      report = await runDoctorReport(resolution.target);
    }

    if (args.json === true) {
      writeStdout(JSON.stringify(fixKnowledgeReport ?? fixReport ?? report, null, 2));
    } else {
      if (fixKnowledgeReport !== null) {
        writeStdout(fixKnowledgeReport.message);
        if (fixKnowledgeReport.aborted && fixKnowledgeReport.abort_reason !== undefined) {
          writeStderr(fixKnowledgeReport.abort_reason);
        }
        renderFixKnowledgeMutations(fixKnowledgeReport);
      } else if (fixReport !== null) {
        writeStdout(fixReport.message);
      }
      renderHumanReport(report);
    }

    // v2.0.0-rc.7 T10: emit doctor_run event so Signal D in fabric-hint can
    // detect maintenance cadence (Q-16 closure). Best-effort — a write
    // failure must NOT change doctor's exit semantics. We compute the total
    // issue count from the final report (fixable + manual + warnings) so the
    // event is meaningful for both --lint and --fix-knowledge modes.
    await emitDoctorRunEventBestEffort(resolution.target, {
      mode: fixKnowledge ? "apply-lint" : "lint",
      issues:
        report.fixable_errors.length +
        report.manual_errors.length +
        report.warnings.length,
      mutations:
        fixKnowledgeReport !== null
          ? fixKnowledgeReport.mutations.filter((m) => m.applied).length
          : undefined,
    });

    // Exit code rules:
    //   * --fix-knowledge aborted (manual_error blocker) → 1
    //   * --fix-knowledge with any failed mutation → 1
    //   * any error status (or strict + warnings) → 1
    //   * otherwise → 0
    if (fixKnowledgeReport !== null) {
      if (fixKnowledgeReport.aborted) {
        process.exitCode = 1;
        return;
      }
      if (fixKnowledgeReport.mutations.some((m) => !m.applied)) {
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

function renderFixKnowledgeMutations(fixKnowledgeReport: DoctorFixKnowledgeReport): void {
  if (fixKnowledgeReport.mutations.length === 0) {
    return;
  }
  writeStdout("");
  writeStdout(t("doctor.section.fix-knowledge-mutations"));
  for (const mutation of fixKnowledgeReport.mutations) {
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

// v2.0.0-rc.7 T10: emit doctor_run to events.jsonl. Mirrors the
// best-effort policy used elsewhere (extract-knowledge, plan-context):
// observability writes never propagate failures to the caller.
async function emitDoctorRunEventBestEffort(
  projectRoot: string,
  payload: { mode: "lint" | "apply-lint"; issues: number; mutations?: number },
): Promise<void> {
  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "doctor_run",
      timestamp: new Date().toISOString(),
      mode: payload.mode,
      issues: payload.issues,
      ...(payload.mutations !== undefined ? { mutations: payload.mutations } : {}),
    });
  } catch {
    // Silent — observability only.
  }
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

// ---------------------------------------------------------------------------
// rc.7 T11 / rc.15: --fix-knowledge safety prompt helpers
// ---------------------------------------------------------------------------

/**
 * Derive a mutation plan summary from a DoctorReport. We count entries in
 * fixable_errors AND warnings whose `code` is one of the fix-knowledge
 * surfaces. Some mutations (orphan demote) surface as warnings rather than
 * fixable errors per their severity, so we must scan both lists.
 *
 * Returns zero counts when there is nothing to mutate. Caller is responsible
 * for skipping the prompt in that case (we don't ask "Proceed?" for a no-op).
 */
function computeFixKnowledgePlan(report: DoctorReport): FixKnowledgePlan {
  const buckets: Record<string, DoctorIssue[]> = {};
  const sources: DoctorIssue[] = [
    ...report.fixable_errors,
    ...report.warnings,
  ];
  for (const issue of sources) {
    if (FIX_KNOWLEDGE_CODE_LABELS[issue.code] === undefined) continue;
    if (!Array.isArray(buckets[issue.code])) {
      buckets[issue.code] = [];
    }
    buckets[issue.code].push(issue);
  }
  const codes = Object.keys(buckets).sort((a, b) =>
    FIX_KNOWLEDGE_CODE_LABELS[a].localeCompare(FIX_KNOWLEDGE_CODE_LABELS[b]),
  );
  const perCodeLines: string[] = [];
  let totalCount = 0;
  for (const code of codes) {
    const items = buckets[code];
    totalCount += items.length;
    perCodeLines.push(`  - ${FIX_KNOWLEDGE_CODE_LABELS[code]}: ${items.length}`);
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

function renderFixKnowledgePlan(plan: FixKnowledgePlan): void {
  writeStdout("");
  writeStdout(`${paint.warn("fix-knowledge mutation plan")} (${plan.totalCount} total)`);
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

type FixKnowledgeDecision = "proceed" | "abort";

async function resolveFixKnowledgeConsent(options: {
  yesFlag: boolean;
  envBypass: boolean;
  plan: FixKnowledgePlan;
}): Promise<FixKnowledgeDecision> {
  if (options.yesFlag || options.envBypass) {
    return "proceed";
  }
  // Non-tty stdin without an explicit bypass: refuse. CI must opt in via
  // --yes or FABRIC_NONINTERACTIVE=1 so a stray non-interactive shell can
  // never silently mutate a workspace.
  if (process.stdin.isTTY !== true) {
    writeStderr(
      "doctor --fix-knowledge: stdin is not a TTY and neither --yes nor FABRIC_NONINTERACTIVE=1 is set. Refusing to mutate.",
    );
    return "abort";
  }
  const message = `About to apply ${options.plan.totalCount} mutation(s) to knowledge entries (frontmatter writes + git mv + cache deletes). Proceed?`;
  const answer = await confirm({
    message,
    initialValue: false,
  });
  if (isCancel(answer) || answer !== true) {
    writeStderr("doctor --fix-knowledge: aborted by user.");
    return "abort";
  }
  return "proceed";
}
