import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";

import {
  appendEventLedgerEvent,
  checkLockOrThrow,
  enrichDescriptions,
  runDoctorApplyLint as runDoctorFixKnowledge,
  runDoctorArchiveHistory,
  runDoctorCiteCoverage,
  runDoctorFix,
  runDoctorReport,
  type ArchiveHistoryReport,
  type CiteCoverageReport,
  type DoctorApplyLintReport as DoctorFixKnowledgeReport,
  type DoctorIssue,
  type DoctorReport,
  type EnrichDescriptionsReport,
} from "@fenglimg/fabric-server";

import { paint, symbol } from "../colors.js";
import { resolveDevMode } from "../dev-mode.js";
import { getDoctorTranslator, t } from "../i18n.js";
import { hasActionHint, renderFabricError } from "../lib/error-render.js";

type DoctorTranslator = typeof t;

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
  // rc.7 T11: skip the safety confirm before --fix-knowledge mutates frontmatter
  // and runs git mv. Required for any non-tty invocation (CI, nested
  // pipelines) unless FABRIC_NONINTERACTIVE=1 is set in the environment.
  yes?: boolean;
  // rc.35 TASK-12 (P0-11): unfold maintainer-audience action hints.
  verbose?: boolean;
  // rc.20 TASK-05: cite policy adherence report. Read-only; mutually exclusive
  // with --fix and --fix-knowledge (those mutate state; cite-coverage only
  // reads ledger events). Pairs with --since (window) and --client (filter).
  "cite-coverage"?: boolean;
  since?: string;
  client?: string;
  // v2.0.0-rc.24 TASK-10: filter cite contract audit by KB layer. Applies only
  // to the contract-policy renderer block (rc.20 metrics are layer-blind by
  // design). Accepts 'team' | 'personal' | 'all'; defaults to 'all'.
  layer?: string;
  // rc.23 TASK-007 (a-C2): back-fill the four description-grade frontmatter
  // fields (intent_clues / tech_stack / impact / must_read_if) on legacy
  // canonical entries that pre-date rc.23. `--auto` writes stub values; the
  // default (interactive) run lists missing entries without mutating disk so
  // the operator can rerun the archive Skill or hand-edit. `--dry-run` pairs
  // with `--auto` to preview the would-be changes without writing.
  "enrich-descriptions"?: boolean;
  auto?: boolean;
  "dry-run"?: boolean;
  // v2.0.0-rc.25 TASK-10: per-session archive attempt audit. Read-only;
  // mutually exclusive with the other mutation/report surfaces. Pairs with
  // `--since` for the time window (default 7d).
  "archive-history"?: boolean;
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
    // rc.35 TASK-12 (P0-11): expose maintainer-audience actionHints. By
    // default the renderer folds remediation strings that target Fabric
    // contributors (edit `packages/cli/templates/...`, interpret G1-G5
    // cite-goodhart codes, etc.) since npm end users have no actionable
    // lever for them. --verbose shows them.
    verbose: {
      type: "boolean",
      description: t("cli.doctor.args.verbose.description"),
      default: false,
    },
    // rc.20 TASK-05: cite policy adherence report (read-only). Skips standard
    // inspections entirely — different output surface. Mutually exclusive
    // with --fix / --fix-knowledge (enforced in run()).
    "cite-coverage": {
      type: "boolean",
      description: t("cli.doctor.args.cite-coverage.description"),
      default: false,
    },
    since: {
      type: "string",
      description: t("cli.doctor.args.since.description"),
      default: "7d",
    },
    client: {
      type: "string",
      description: t("cli.doctor.args.client.description"),
      default: "all",
      valueHint: "cc|codex|cursor|all",
    },
    // v2.0.0-rc.24 TASK-10: --layer filter for the cite contract audit. Pairs
    // with --cite-coverage. Validated against {'team','personal','all'} at
    // command entry; rejects 'both' (rc.20 plan-context vocabulary) explicitly.
    layer: {
      type: "string",
      description: t("cli.doctor.args.layer.description"),
      default: "all",
      valueHint: "team|personal|all",
    },
    // rc.23 TASK-007 (a-C2): description-grade back-fill flag set. Read-side
    // by default; `--auto` flips the writer arm on. Mutually exclusive with
    // --fix / --fix-knowledge / --cite-coverage (different mutation surfaces).
    "enrich-descriptions": {
      type: "boolean",
      description: t("cli.doctor.args.enrich-descriptions.description"),
      default: false,
    },
    auto: {
      type: "boolean",
      description: t("cli.doctor.args.auto.description"),
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: t("cli.doctor.args.dry-run.description"),
      default: false,
    },
    // v2.0.0-rc.25 TASK-10: --archive-history flag (parallel to rc.20
    // --cite-coverage). Read-only; reads session_archive_attempted events
    // and renders a per-session table. Pairs with the shared `--since` flag.
    "archive-history": {
      type: "boolean",
      description: t("cli.doctor.args.archive-history.description"),
      default: false,
    },
  },
  async run({ args }: { args: DoctorArgs }) {
    const workspaceRoot = process.cwd();
    const resolution = resolveDevMode(args.target, workspaceRoot);
    const dt = getDoctorTranslator(resolution.target);

    // Preflight: refuse to run when serve is actively holding the lock.
    // rc.15: --force was removed (drift→abort principle).
    // rc.15 TASK-007: explicitly render `.actionHint` from FabricError-shaped
    // failures (citty's default handler prints `.message` only).
    try {
      checkLockOrThrow(resolution.target);
    } catch (err) {
      if (hasActionHint(err)) {
        renderFabricError(err);
        process.exit(1);
      }
      throw err;
    }

    const fixKnowledge = args["fix-knowledge"] === true;
    const fix = args.fix === true;
    const citeCoverage = args["cite-coverage"] === true;
    const enrichDesc = args["enrich-descriptions"] === true;
    const archiveHistory = args["archive-history"] === true;

    // v2.0.0-rc.29 TASK-007 (BUG-M2): up-front --since validation. Previously
    // `parseSinceDuration` was only called inside the --archive-history and
    // --cite-coverage arms; bare `fabric doctor --since=bogus` silently dropped
    // the value with exit 0. Lift the parse here so any future arm that
    // consumes the field gets a validated number, and an invalid format on
    // ANY invocation fails fast with a clear stderr line.
    if (args.since !== undefined) {
      try {
        parseSinceDuration(args.since);
      } catch {
        writeStderr(dt("cli.doctor.errors.invalid-since", { input: args.since }));
        process.exitCode = 1;
        return;
      }
    }

    // v2.0.0-rc.25 TASK-10: --archive-history is a read-only audit surface.
    // Dispatched BEFORE the other arms so the mutex check fails fast. It
    // shares --since with --cite-coverage but never mixes with any mutation
    // or report arm (different output shape).
    if (archiveHistory) {
      if (fix || fixKnowledge || citeCoverage || enrichDesc) {
        writeStderr(dt("cli.doctor.errors.archive-history-mutex"));
        process.exitCode = 1;
        return;
      }

      const sinceInput = args.since ?? "7d";
      let sinceMs: number;
      try {
        sinceMs = parseSinceDuration(sinceInput);
      } catch {
        writeStderr(dt("cli.doctor.errors.invalid-since", { input: sinceInput }));
        process.exitCode = 1;
        return;
      }

      const report = await runDoctorArchiveHistory(resolution.target, {
        since: sinceMs,
      });

      if (args.json === true) {
        writeStdout(JSON.stringify(report, null, 2));
      } else {
        renderArchiveHistoryReport(report, sinceInput, dt);
      }
      return;
    }

    // rc.23 TASK-007 (a-C2): --enrich-descriptions is its own dispatch arm
    // (different surface — back-fill description-grade frontmatter fields).
    // Mutex with the other mutation/report surfaces keeps the run semantics
    // unambiguous. --auto enables the write arm; default (interactive) is
    // read-only — lists missing-field entries for operator action.
    if (enrichDesc) {
      if (fix || fixKnowledge || citeCoverage) {
        writeStderr(dt("cli.doctor.errors.enrich-descriptions-mutex"));
        process.exitCode = 1;
        return;
      }
      const autoFlag = args.auto === true;
      const dryRun = args["dry-run"] === true;
      const report = await enrichDescriptions(resolution.target, {
        auto: autoFlag,
        dryRun,
      });
      if (args.json === true) {
        writeStdout(JSON.stringify(report, null, 2));
      } else {
        renderEnrichDescriptionsReport(report, dt);
      }
      return;
    }

    // rc.20 TASK-05: --cite-coverage is a read-only report surface. It must
    // run BEFORE the fix/fix-knowledge dispatch and short-circuit
    // entirely — different output shape, no mutations, no standard checks.
    // Mutex with --fix/--fix-knowledge keeps semantics unambiguous (we never
    // mix a mutation pass with a report-only pass in a single invocation).
    if (citeCoverage) {
      if (fix || fixKnowledge) {
        writeStderr(dt("cli.doctor.errors.cite-coverage-mutex"));
        process.exitCode = 1;
        return;
      }

      let sinceMs: number;
      try {
        sinceMs = parseSinceDuration(args.since ?? "7d");
      } catch {
        writeStderr(dt("cli.doctor.errors.invalid-since", { input: args.since ?? "7d" }));
        process.exitCode = 1;
        return;
      }

      const clientFilter = args.client ?? "all";
      if (!isValidClientFilter(clientFilter)) {
        writeStderr(dt("cli.doctor.errors.invalid-client", { input: clientFilter }));
        process.exitCode = 1;
        return;
      }

      // v2.0.0-rc.24 TASK-10: --layer validation. We reject anything outside
      // {'team','personal','all'} — in particular `both` (the rc.20
      // plan-context vocabulary) is intentionally rejected because the
      // cite-coverage semantics use `all` (no filter) instead of `both`
      // (union of two enumerated values). The runDoctorCiteCoverage signature
      // already treats `layer` as optional with default 'all'; we still pass
      // the explicit value through so the report's `layer_filter` surfaces
      // the operator-selected filter.
      const layerFilter = args.layer ?? "all";
      if (!isValidLayerFilter(layerFilter)) {
        writeStderr(dt("cli.doctor.errors.invalid-layer", { input: layerFilter }));
        process.exitCode = 1;
        return;
      }

      const report = await runDoctorCiteCoverage(resolution.target, {
        since: sinceMs,
        client: clientFilter,
        layer: layerFilter,
      });

      renderCiteCoverageReport(report, args.json === true, dt);

      // Intentionally do NOT emit doctor_run here: the ledger schema's
      // `mode` enum is currently {lint, fix-knowledge}, and cite-coverage
      // is a separate read-only surface. Extending the enum is deferred to
      // the rc.20 follow-up that wires Signal D awareness for cite reports
      // (TASK-06/07 scope decision), so this path keeps the ledger contract
      // unchanged.

      return;
    }

    // Mutual exclusion: --fix-knowledge and --fix target different mutation
    // surfaces (knowledge mutations are user state; --fix mutates derived
    // state like agents.meta.json revision). Combining them is ambiguous —
    // require the operator to make a choice.
    if (fixKnowledge && fix) {
      writeStderr(dt("cli.doctor.errors.fix-knowledge-fix-mutually-exclusive"));
      process.exitCode = 1;
      return;
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
      // v2.0.0-rc.33 W4-B1 (T6 P2): --fix --dry-run 短路 — 跑只读 doctor 报告,
      // 不调用 runDoctorFix 的 mutation 路径。fixable_errors 列表本身就是
      // "--fix would address these" 的预览, 不需要单独 dry-run mutation 模拟器。
      // 输出在下方加 banner 让用户明确 "no mutations applied this run"。
      if (args["dry-run"] === true) {
        report = await runDoctorReport(resolution.target);
      } else {
        fixReport = await runDoctorFix(resolution.target);
        report = fixReport.report;
      }
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
        renderFixKnowledgeMutations(fixKnowledgeReport, dt);
      } else if (fixReport !== null) {
        writeStdout(fixReport.message);
      } else if (fix && args["dry-run"] === true) {
        // v2.0.0-rc.33 W4-B1: dry-run banner. Surfaces above the standard
        // report so user knows no mutations were applied; the fixable_errors
        // section already lists what `fabric doctor --fix` (sans --dry-run) would
        // address.
        writeStdout(dt("cli.doctor.fix-dry-run-banner"));
      }
      renderHumanReport(report, dt, args.verbose === true);
    }

    // v2.0.0-rc.7 T10: emit doctor_run event so Signal D in fabric-hint can
    // detect maintenance cadence (Q-16 closure). Best-effort — a write
    // failure must NOT change doctor's exit semantics. We compute the total
    // issue count from the final report (fixable + manual + warnings) so the
    // event is meaningful for both --lint and --fix-knowledge modes.
    await emitDoctorRunEventBestEffort(resolution.target, {
      mode: fixKnowledge ? "fix-knowledge" : "lint",
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

function renderHumanReport(report: DoctorReport, dt: DoctorTranslator, verbose: boolean): void {
  writeStdout(`${renderStatus(report.status)} ${paint.ai("fabric doctor")} ${paint.human(report.summary.target)}`);
  for (const check of report.checks) {
    writeStdout(`${renderStatus(check.status)} ${check.name}: ${check.message}`);
  }
  const opts = { verbose, dt };
  writeIssueSection(dt("doctor.section.fixable"), report.fixable_errors, opts);
  writeIssueSection(dt("doctor.section.manual"), report.manual_errors, opts);
  writeIssueSection(dt("doctor.section.warnings"), report.warnings, opts);
  renderPayloadLimits(report, dt);
}

// v2.0.0-rc.29 REVIEW (codex LOW-2): F2's `payload_limits` reached the JSON
// envelope but not the human renderer. Print one line so an operator who edits
// `mcpPayloadLimits` in `fabric.config.json` can confirm via `fabric doctor` that
// the override took effect (source=config vs source=default).
function renderPayloadLimits(report: DoctorReport, dt: DoctorTranslator): void {
  const limits = report.summary.payload_limits;
  if (limits === undefined) {
    return;
  }
  writeStdout("");
  writeStdout(dt("doctor.section.payload-limits"));
  writeStdout(
    `- ${dt("doctor.payload-limits.line", {
      warnKb: String(Math.round(limits.warn_bytes / 1024)),
      hardKb: String(Math.round(limits.hard_bytes / 1024)),
      source: limits.source,
    })}`,
  );
}

function renderFixKnowledgeMutations(
  fixKnowledgeReport: DoctorFixKnowledgeReport,
  dt: DoctorTranslator,
): void {
  if (fixKnowledgeReport.mutations.length === 0) {
    return;
  }
  writeStdout("");
  writeStdout(dt("doctor.section.fix-knowledge-mutations"));
  for (const mutation of fixKnowledgeReport.mutations) {
    const marker = mutation.applied ? symbol.ok : symbol.error;
    const errSuffix = mutation.applied || mutation.error === undefined ? "" : ` (${mutation.error})`;
    writeStdout(`${marker} ${mutation.kind}: ${mutation.path} [${mutation.detail}]${errSuffix}`);
  }
}

function writeIssueSection(
  title: string,
  issues: DoctorIssue[],
  options: { verbose: boolean; dt: DoctorTranslator },
): void {
  if (issues.length === 0) {
    return;
  }

  writeStdout("");
  writeStdout(title);
  for (const issue of issues) {
    writeStdout(`- ${issue.code}: ${issue.message}`);
    // rc.35 TASK-12 (P0-11): fold maintainer-audience actionHints unless
    // --verbose. Print a one-line breadcrumb so users know the hint exists.
    if (issue.actionHint !== undefined && issue.actionHint.length > 0) {
      if (issue.audience === "maintainer" && !options.verbose) {
        writeStdout(`  → ${options.dt("doctor.maintainer-hint-folded")}`);
      } else {
        writeStdout(`  → ${issue.actionHint}`);
      }
    }
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
  payload: { mode: "lint" | "fix-knowledge"; issues: number; mutations?: number },
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

// ---------------------------------------------------------------------------
// rc.20 TASK-05: --cite-coverage flag helpers
// ---------------------------------------------------------------------------

type CiteCoverageClientFilter = "cc" | "codex" | "cursor" | "all";

const CITE_COVERAGE_CLIENT_FILTERS: ReadonlySet<CiteCoverageClientFilter> = new Set([
  "cc",
  "codex",
  "cursor",
  "all",
]);

function isValidClientFilter(input: string): input is CiteCoverageClientFilter {
  return CITE_COVERAGE_CLIENT_FILTERS.has(input as CiteCoverageClientFilter);
}

// v2.0.0-rc.24 TASK-10: --layer filter accepted values. Note the vocabulary
// is `all` (not `both` — the rc.20 plan-context layer_filter uses `both`
// because it expresses "union of two named layers"; the cite-coverage audit
// uses `all` because it expresses "no layer filter, count everything"). The
// explicit rejection of `both` is part of the test surface per spec.
type CiteCoverageLayerFilter = "team" | "personal" | "all";

const CITE_COVERAGE_LAYER_FILTERS: ReadonlySet<CiteCoverageLayerFilter> = new Set([
  "team",
  "personal",
  "all",
]);

function isValidLayerFilter(input: string): input is CiteCoverageLayerFilter {
  return CITE_COVERAGE_LAYER_FILTERS.has(input as CiteCoverageLayerFilter);
}

/**
 * rc.20 TASK-07: bilingual human-readable formatter for the cite coverage
 * report. JSON mode preserves the structured payload verbatim so downstream
 * consumers (CI, dashboards) keep a stable contract.
 *
 * Layout:
 *   <section header>
 *   <since/marker header line>
 *   [marker_emitted_now warning, if first run]
 *
 *     <metric>: <count>      (5 lines, in canonical order)
 *
 *   ### Per-client                (only when all-mode and >1 client bucket)
 *     <client>: k1=v1 / k2=v2 ...
 *
 *   ### Dismissed reasons         (only when histogram non-empty)
 *     <translated reason>: <count>
 */
function renderCiteCoverageReport(
  report: CiteCoverageReport,
  jsonMode: boolean,
  dt: DoctorTranslator,
): void {
  if (jsonMode) {
    writeStdout(JSON.stringify(report, null, 2));
    return;
  }

  if (report.status === "skipped") {
    writeStdout(dt("doctor.cite.status.skipped"));
    return;
  }

  const lines: string[] = [];
  lines.push(dt("doctor.section.cite-coverage"));
  lines.push(
    dt("doctor.cite.header", {
      since: new Date(report.since_ts).toISOString(),
      marker: new Date(report.marker_ts).toISOString(),
    }),
  );
  if (report.marker_emitted_now) {
    lines.push(dt("doctor.cite.warning.justActivated"));
  }
  lines.push("");
  lines.push(`  ${dt("doctor.cite.metric.editsTouched")}: ${report.metrics.edits_touched}`);
  lines.push(`  ${dt("doctor.cite.metric.qualifyingCites")}: ${report.metrics.qualifying_cites}`);
  lines.push(`  ${dt("doctor.cite.metric.recalledUnverified")}: ${report.metrics.recalled_unverified}`);
  lines.push(`  ${dt("doctor.cite.metric.expectedButMissed")}: ${report.metrics.expected_but_missed}`);
  lines.push(`  ${dt("doctor.cite.metric.totalTurns")}: ${report.metrics.total_turns}`);

  // Per-client subsection: only renders for `--client all` when more than one
  // client bucket exists. A single-client filter (or a single observed client)
  // would just re-render the top-level metrics — pointless noise.
  if (report.per_client !== undefined && Object.keys(report.per_client).length > 1) {
    lines.push("");
    lines.push(`### ${dt("doctor.cite.section.perClient")}`);
    for (const [client, metrics] of Object.entries(report.per_client)) {
      const summary = Object.entries(metrics)
        .map(([k, v]) => `${k}=${v}`)
        .join(" / ");
      lines.push(`  ${client}: ${summary}`);
    }
  }

  // Dismissed reasons histogram: only when at least one observation carried a
  // `dismissed:<reason>` tag. We translate known reasons through the i18n
  // table; unknown reasons fall back to the raw bucket key (the translator
  // returns the key itself when no entry exists, which is exactly the
  // pass-through behavior we want).
  if (
    report.dismissed_reason_histogram !== undefined &&
    Object.keys(report.dismissed_reason_histogram).length > 0
  ) {
    lines.push("");
    lines.push(`### ${dt("doctor.cite.section.dismissedReasons")}`);
    for (const [reason, count] of Object.entries(report.dismissed_reason_histogram)) {
      const label = dt(`doctor.cite.dismissed.${reason}`);
      lines.push(`  ${label}: ${count}`);
    }
  }

  // rc.23 TASK-08(c): KB: none sentinel breakdown — mirrors the dismissed
  // reasons section. Renders only when at least one `KB: none` was observed.
  if (
    report.none_reason_histogram !== undefined &&
    Object.keys(report.none_reason_histogram).length > 0
  ) {
    lines.push("");
    lines.push(`### ${dt("doctor.cite.section.noneReasons")}`);
    for (const [reason, count] of Object.entries(report.none_reason_histogram)) {
      const label = dt(`doctor.cite.none.${reason}`);
      lines.push(`  ${label}: ${count}`);
    }
  }

  // v2.0.0-rc.24 TASK-10: contract-policy renderer block. Additive — preserves
  // the rc.20 output above. The block is suppressed entirely when the server
  // reports `awaiting_marker` AND every contract counter is zero (the "nothing
  // to say" mode that follows a fresh marker emit with no qualifying turns
  // yet). All other states (ok / skipped:bootstrap_drift / awaiting_marker
  // with non-zero counts) render visible feedback.
  appendContractSection(lines, report, dt);

  writeStdout(lines.join("\n"));
}

/**
 * v2.0.0-rc.24 TASK-10: render the cite contract-policy audit block.
 *
 * Visibility rules:
 *   - `contract_metrics_status === undefined` → server is rc.20-shaped; emit nothing.
 *   - `awaiting_marker` AND all contract_metrics counters zero → emit nothing
 *     (renders nothing during the gap between first run and first qualifying
 *     cite). Per convergence criterion: "Renderer suppresses contract section
 *     when status='awaiting_marker' AND all counts 0".
 *   - `skipped:bootstrap_drift` → emit a one-line "skipped" warning so the
 *     user is told to run `fabric install`.
 *   - `ok` (or `awaiting_marker` with any non-zero count) → emit full block.
 *
 * Layout (ok mode):
 *   ### Contract check
 *     status: <status>
 *     since: <iso timestamp from contract_marker_ts>
 *     layer filter: <layer>
 *     Decisions cited: N
 *     Pitfalls cited: N
 *     With contract: N
 *     Missing contract: N
 *     Hard violations [team — review]: N    (only when team count > 0)
 *     Hard violations [personal — fyi]: N   (only when personal count > 0)
 *
 *   #### Per-layer × type
 *     team / personal — <type>: N
 *
 *   #### Skip buckets
 *     <i18n-translated reason>: N
 *
 *   ⚠ Unresolved cite IDs: N   (only when > 0)
 *
 * i18n key fallback: `cite-coverage.contract.type.<type>` and
 * `cite-coverage.skip.<reason>` look up via the active translator; unknown
 * keys pass through the raw key, which is the desired behavior for operator-extensible
 * vocabulary (per TASK-09 NOTES).
 */
function appendContractSection(
  lines: string[],
  report: CiteCoverageReport,
  dt: DoctorTranslator,
): void {
  const status = report.contract_metrics_status;
  if (status === undefined) {
    // Pre-TASK-08 server payload — nothing to render.
    return;
  }

  const metrics = report.contract_metrics;
  const perLayerType = report.per_layer_type;
  const allCountsZero =
    metrics === undefined ||
    (metrics.decisions_cited === 0 &&
      metrics.pitfalls_cited === 0 &&
      metrics.contract_with === 0 &&
      metrics.contract_missing === 0 &&
      metrics.hard_violated === 0 &&
      metrics.cite_id_unresolved === 0 &&
      Object.keys(metrics.skip_count).length === 0);

  // Suppression rule per convergence criterion.
  if (status === "awaiting_marker" && allCountsZero) {
    return;
  }

  lines.push("");
  lines.push(`### ${dt("cite-coverage.contract.header")}`);

  if (status === "skipped:bootstrap_drift") {
    // One-line skipped warning. The i18n string already carries the
    // remediation hint ("run `fabric install`").
    lines.push(`  ${dt("cite-coverage.contract.status.skipped_bootstrap_drift")}`);
    return;
  }

  // Status + filter context lines (always rendered in ok / awaiting_marker
  // with non-zero counts).
  const statusKey =
    status === "ok"
      ? "cite-coverage.contract.status.ok"
      : "cite-coverage.contract.status.awaiting_marker";
  lines.push(`  status: ${dt(statusKey)}`);

  if (typeof report.contract_marker_ts === "number" && report.contract_marker_ts > 0) {
    lines.push(`  since: ${new Date(report.contract_marker_ts).toISOString()}`);
  }
  if (report.layer_filter !== undefined) {
    lines.push(`  layer filter: ${report.layer_filter}`);
  }

  if (metrics !== undefined) {
    lines.push(`  ${dt("cite-coverage.contract.decisions_cited")}: ${metrics.decisions_cited}`);
    lines.push(`  ${dt("cite-coverage.contract.pitfalls_cited")}: ${metrics.pitfalls_cited}`);
    lines.push(`  ${dt("cite-coverage.contract.with")}: ${metrics.contract_with}`);
    lines.push(`  ${dt("cite-coverage.contract.missing")}: ${metrics.contract_missing}`);

    // Hard-violation line. per_layer_type does NOT carry hard_violated (its
    // inner keys are singular knowledge types + 'unresolved' per TASK-08 +
    // TASK-09 contract). The hard-violation count is only aggregated at
    // contract_metrics.hard_violated — we use the active layer_filter to
    // choose the right suffix:
    //   - layer_filter === 'personal' → [personal — fyi]
    //   - layer_filter === 'team' OR 'all' (default) → [team — review]
    // Rationale: when filter='all', the conservative interpretation is that
    // any unresolved violation in mixed-layer audit defaults to "team review
    // required". A future rc that surfaces per-layer hard_violated counters
    // can split this line; the current shape gives one stable interpretation.
    if (metrics.hard_violated > 0) {
      const layerSuffix =
        report.layer_filter === "personal"
          ? dt("cite-coverage.layer.personal_fyi")
          : dt("cite-coverage.layer.team_review");
      lines.push(
        `  ${dt("cite-coverage.contract.hard_violated")} ${layerSuffix}: ${metrics.hard_violated}`,
      );
    }
  }

  // Per-layer × type cross-tab. Singular type keys per TASK-09 i18n contract
  // (`decision` / `pitfall` / `model` / `guideline` / `process` / `unresolved`).
  // We only emit rows for non-zero counts so an empty layer (typical when
  // --layer=team is set and personal corpus is empty) collapses cleanly.
  if (perLayerType !== undefined) {
    const teamKeys = Object.keys(perLayerType.team).filter(
      (k) => perLayerType.team[k] > 0,
    );
    const personalKeys = Object.keys(perLayerType.personal).filter(
      (k) => perLayerType.personal[k] > 0,
    );
    if (teamKeys.length > 0 || personalKeys.length > 0) {
      lines.push("");
      lines.push(`#### ${dt("cite-coverage.layer.team")} × ${dt("cite-coverage.layer.personal")}`);
      for (const key of teamKeys) {
        const label = dt(`cite-coverage.contract.type.${key}`);
        lines.push(`  ${dt("cite-coverage.layer.team")} — ${label}: ${perLayerType.team[key]}`);
      }
      for (const key of personalKeys) {
        const label = dt(`cite-coverage.contract.type.${key}`);
        lines.push(
          `  ${dt("cite-coverage.layer.personal")} — ${label}: ${perLayerType.personal[key]}`,
        );
      }
    }
  }

  // Skip bucket histogram — operator-extensible vocabulary. Fall back to the
  // raw key when i18n misses (open-keyed per B1 grill-me lock).
  if (metrics !== undefined && Object.keys(metrics.skip_count).length > 0) {
    lines.push("");
    lines.push(`#### ${dt("cite-coverage.contract.skip_count")}`);
    for (const [reason, count] of Object.entries(metrics.skip_count)) {
      const label = dt(`cite-coverage.skip.${reason}`);
      lines.push(`  ${label}: ${count}`);
    }
  }

  // Unresolved-cite tail. Rendered as a separate ⚠ line per spec so operators
  // see hallucinated KB ids distinct from the contract_missing bucket.
  if (metrics !== undefined && metrics.cite_id_unresolved > 0) {
    lines.push("");
    lines.push(
      `${symbol.warn} ${dt("cite-coverage.contract.cite_id_unresolved")}: ${metrics.cite_id_unresolved}`,
    );
  }
}

/**
 * rc.23 TASK-007 (a-C2): human-readable formatter for the
 * --enrich-descriptions report. JSON mode preserves the structured payload
 * verbatim (handled at the call site). Layout:
 *
 *   <header line: mode + dryRun + scanned/modified/skipped tallies>
 *   <per-file lines, alphabetical by path>
 *     <symbol> <path> — missing: a, b, c [→ added: a, b, c]
 *     ! <path> — <error>
 */
function renderEnrichDescriptionsReport(
  report: EnrichDescriptionsReport,
  dt: DoctorTranslator,
): void {
  const header = `${symbol.ok} ${paint.ai("fabric doctor --enrich-descriptions")} mode=${report.mode}${
    report.dryRun ? " (dry-run)" : ""
  } scanned=${report.scanned} modified=${report.modified} skipped=${report.skipped}`;
  writeStdout(header);
  if (report.candidates.length === 0) {
    writeStdout(dt("doctor.enrich.allComplete"));
    return;
  }
  writeStdout("");
  for (const candidate of report.candidates) {
    if (candidate.error !== undefined) {
      writeStdout(`${symbol.error} ${candidate.path} — ${candidate.error}`);
      continue;
    }
    const missing = candidate.missing.join(", ");
    if (candidate.modified) {
      const added = candidate.added_fields.join(", ");
      writeStdout(
        `${symbol.ok} ${candidate.path} — missing: ${missing} → added: ${added}`,
      );
    } else {
      writeStdout(`${symbol.warn} ${candidate.path} — missing: ${missing}`);
    }
  }
}

/**
 * Parse a `--since` value into an absolute epoch-ms floor for ledger scans.
 *
 * Accepted forms:
 *   - `Nd`  → N days   (e.g. `7d`)
 *   - `Nh`  → N hours  (e.g. `24h`)
 *   - `Nm`  → N minutes (e.g. `30m`)
 *   - bare digits → treated as an absolute epoch-ms cutoff (passed through)
 *
 * Returns:
 *   - For durations: `Date.now() - deltaMs`
 *   - For epoch-ms: the numeric value as-is
 *
 * Throws on any other shape so the caller can surface
 * `cli.doctor.errors.invalid-since` to the user. We deliberately reject
 * negative durations and zero — `0d`/`0h`/`0m` is almost certainly user
 * error (would scan a zero-width window).
 */
export function parseSinceDuration(input: string): number {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error(`invalid --since value: ${input}`);
  }

  // Duration form: <digits><unit>
  const durationMatch = /^(\d+)([dhm])$/.exec(trimmed);
  if (durationMatch !== null) {
    const value = Number.parseInt(durationMatch[1], 10);
    const unit = durationMatch[2];
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`invalid --since value: ${input}`);
    }
    const unitMs =
      unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
    return Date.now() - value * unitMs;
  }

  // Bare epoch-ms form.
  if (/^\d+$/.test(trimmed)) {
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid --since value: ${input}`);
    }
    return value;
  }

  throw new Error(`invalid --since value: ${input}`);
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.25 TASK-10: --archive-history renderer
// ---------------------------------------------------------------------------
//
// Bilingual table renderer. Header + markdown-style pipe table + footer
// summary line. Empty results collapse to a single-line "no history" message
// rather than rendering an empty table.
//
// Layout:
//   Archive history (last 7d, 3 sessions)
//   | Session | Last attempt    | Outcome  | Candidates | Covered gap |
//   | ------- | --------------- | -------- | ---------- | ----------- |
//   | abc1... | 2026-05-19 13:42 | proposed | 3          | 0h          |
//
// `last_attempted_at` ISO timestamps are projected to "YYYY-MM-DD HH:mm"
// (UTC) so the table stays narrow. Operators who need second-precision
// or timezone context use `--json` mode (preserves ISO verbatim).
function renderArchiveHistoryReport(
  report: ArchiveHistoryReport,
  sinceLabel: string,
  dt: DoctorTranslator,
): void {
  if (report.entries.length === 0) {
    writeStdout(dt("doctor.archive-history.empty", { sinceLabel }));
    return;
  }

  const lines: string[] = [];
  lines.push(
    dt("doctor.archive-history.header", {
      sinceLabel,
      count: String(report.total),
      plural: report.total === 1 ? "" : "s",
    }),
  );
  lines.push("");
  lines.push(
    `| ${dt("doctor.archive-history.table.session")} | ${dt(
      "doctor.archive-history.table.lastAttempt",
    )} | ${dt("doctor.archive-history.table.outcome")} | ${dt(
      "doctor.archive-history.table.candidates",
    )} | ${dt("doctor.archive-history.table.coveredGap")} |`,
  );
  lines.push("| ------- | ---------------- | -------- | ---------- | ----------- |");
  for (const entry of report.entries) {
    const lastAttempt = formatTimestampForTable(entry.last_attempted_at);
    lines.push(
      `| ${entry.session_id_short} | ${lastAttempt} | ${entry.outcome} | ${entry.candidates_proposed} | ${entry.age_since_covered_hours}h |`,
    );
  }
  writeStdout(lines.join("\n"));
}

// Project an ISO-8601 timestamp ("2026-05-19T13:42:07.123Z") to
// "2026-05-19 13:42" (UTC) for table density. Falls back to the raw input on
// parse failure so the renderer never throws.
function formatTimestampForTable(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}
