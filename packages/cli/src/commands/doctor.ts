import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";

import {
  appendEventLedgerEvent,
  enrichDescriptions,
  runDoctorApplyLint as runDoctorFixKnowledge,
  runDoctorArchiveHistory,
  runDoctorCiteCoverage,
  runDoctorFix,
  runDoctorHistoryAll,
  runDoctorReport,
  runDoctorConflictLint,
  type ArchiveHistoryReport,
  type CiteCoverageReport,
  type ConflictLintReport,
  type DoctorApplyLintReport as DoctorFixKnowledgeReport,
  type DoctorIssue,
  type DoctorReport,
  type EnrichDescriptionsReport,
  type HistoryAllReport,
} from "@fenglimg/fabric-server";

import { backfillUnboundProject } from "../install/backfill-unbound-project.js";
import { paint, symbol } from "../colors.js";
import { resolveDevMode } from "../dev-mode.js";
import { getDoctorTranslator, t } from "../i18n.js";
import { storeDoctorChecks, type StoreDiagnostic } from "../store/doctor-checks.js";
import { syncStoreAliasLinks } from "../store/store-ops.js";
import { buildDebugBundle } from "@fenglimg/fabric-shared";
import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import { loadProjectConfig } from "../store/project-config-io.js";
// v2.0.0-rc.37 Wave A2: error-render imports removed alongside serve-lock
// preflight call. See KB [[fabric-serve-quarantine-not-delete]].

type DoctorTranslator = typeof t;

type DoctorArgs = {
  target?: string;
  fix?: boolean;
  json?: boolean;
  strict?: boolean;
  // v2.1.0-rc.1 P6 (S40): redacted diagnostic bundle.
  "debug-bundle"?: boolean;
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
  // rc.37 NEW-33: unified history view. Mode = `archive | fix | all`.
  history?: string;
  // v2.1 ④ conflict-detection (P4): knowledge-conflict lint. Read-only; its own
  // dispatch arm (different output shape). `--deep` is reserved for the
  // LLM-judge pass (cold-eval seam) — without a wired judge it stays the cheap
  // bm25 candidate pass and reports that no judge ran.
  "lint-conflicts"?: boolean;
  deep?: boolean;
};

// rc.7 T11: lint codes that --fix-knowledge will mutate, mapped to the human
// label used in the confirm preview. We derive the mutation plan from the
// pre-flight DoctorReport (fixable_errors + warnings) so the preview can be
// rendered BEFORE any mutation runs. Codes outside this set are not part of
// the fix-knowledge surface and are not counted.
// v2.2 Goal B (G-AGE honesty): `knowledge_orphan_demote_required` and
// `knowledge_stale_archive_required` are intentionally NOT listed here. Their
// read-side DETECTION was rebuilt store-aware (doctor-knowledge-age.ts), but the
// store-backed demote/archive MUTATION is store-write territory (deferred to the
// store-write goal). Listing them would make `--fix-knowledge` preview a fix it
// never executes — exactly the "doctor 谎报" Goal X eliminated. Until the
// mutation arm is wired, these decay lints are surfaced-and-remediated via the
// fab_review flow (see their remediation copy), never auto-mutated.
const FIX_KNOWLEDGE_CODE_LABELS: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// EPIC-009: Hidden flags configuration
// ---------------------------------------------------------------------------
// Flags exposed to users (shown in --help).
const EXPOSED_FLAGS = new Set([
  "target",
  "fix",
  "fix-knowledge",
  "json",
  "verbose",
]);

// All flags that should be hidden from --help but remain functional.
// These are internal/report/debug flags that advanced users can still use.
const HIDDEN_FLAGS = new Set([
  "strict",
  "debug-bundle",
  "yes",
  "cite-coverage",
  "since",
  "client",
  "layer",
  "enrich-descriptions",
  "auto",
  "dry-run",
  "archive-history",
  "history",
  "lint-conflicts",
  "deep",
]);

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
    // v2.1.0-rc.1 P6 (S40): emit a redacted diagnostic bundle (config + store
    // diagnostics; events excluded by default). Every string is secret-redacted
    // so the bundle is safe to paste into a bug report. Read-only.
    // EPIC-009: hidden flag (internal debug tool).
    "debug-bundle": {
      type: "boolean",
      description: "Emit a redacted diagnostic bundle (config + store health) for bug reports",
      default: false,
    },
    // EPIC-009: hidden flag (CI automation).
    yes: {
      type: "boolean",
      description: t("cli.doctor.args.yes.description"),
      default: false,
    },
    // EPIC-009: hidden flag (advanced output).
    verbose: {
      type: "boolean",
      description: t("cli.doctor.args.verbose.description"),
      default: false,
    },
    // EPIC-009: hidden flags (report surfaces).
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
    layer: {
      type: "string",
      description: t("cli.doctor.args.layer.description"),
      default: "all",
      valueHint: "team|personal|all",
    },
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
    "archive-history": {
      type: "boolean",
      description: t("cli.doctor.args.archive-history.description"),
      default: false,
    },
    history: {
      type: "string",
      description: t("cli.doctor.args.history.description"),
      valueHint: "archive|fix|all",
    },
    "lint-conflicts": {
      type: "boolean",
      description: t("cli.doctor.args.lint-conflicts.description"),
      default: false,
    },
    deep: {
      type: "boolean",
      description: t("cli.doctor.args.deep.description"),
      default: false,
    },
    // EPIC-009: hidden flag (strict mode for CI).
    strict: {
      type: "boolean",
      description: t("cli.doctor.args.strict.description"),
      default: false,
    },
  },
  async run({ args }: { args: DoctorArgs }) {
    const workspaceRoot = process.cwd();
    const resolution = resolveDevMode(args.target, workspaceRoot);
    const dt = getDoctorTranslator(resolution.target);

    // v2.0.0-rc.37 Wave A2: rc.15 serve-lock preflight removed alongside
    // fabric serve quarantine. No main-line process writes .fabric/.serve.lock
    // any more (per [[fabric-serve-quarantine-not-delete]]); legacy lock
    // files are reaped by the doctor's own stale-serve-lock advisory.

    const fixKnowledge = args["fix-knowledge"] === true;
    const fix = args.fix === true;
    const citeCoverage = args["cite-coverage"] === true;
    const enrichDesc = args["enrich-descriptions"] === true;
    const archiveHistory = args["archive-history"] === true;

    // v2.1.0-rc.1 P6 (S40): --debug-bundle. Read-only; emits a redacted bundle
    // (config + store diagnostics, events excluded) safe to paste into a bug
    // report. Short-circuits the standard report path. Best-effort config load.
    if (args["debug-bundle"] === true) {
      const globalRoot = resolveGlobalRoot();
      let config: Record<string, unknown> = {};
      try {
        config = {
          global: loadGlobalConfig(globalRoot) ?? null,
          project: loadProjectConfig(resolution.target) ?? null,
        };
      } catch {
        config = {};
      }
      const bundle = buildDebugBundle({
        config,
        diagnostics: collectStoreDiagnostics(resolution.target),
      });
      writeStdout(JSON.stringify(bundle, null, 2));
      return;
    }

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

    // rc.37 NEW-33: unified --history <mode> view. archive | fix | all.
    // Read-only; mutex with all mutation arms. `archive` mode delegates to
    // the existing archive-history surface for backward compatibility.
    const historyMode = args.history;
    if (typeof historyMode === "string" && historyMode.length > 0) {
      if (fix || fixKnowledge || citeCoverage || enrichDesc || archiveHistory) {
        writeStderr(dt("cli.doctor.errors.history-mutex"));
        process.exitCode = 1;
        return;
      }
      if (historyMode !== "archive" && historyMode !== "fix" && historyMode !== "all") {
        writeStderr(dt("cli.doctor.errors.invalid-history-mode", { input: historyMode }));
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
      if (historyMode === "archive") {
        const report = await runDoctorArchiveHistory(resolution.target, { since: sinceMs });
        if (args.json === true) {
          writeStdout(JSON.stringify(report, null, 2));
        } else {
          renderArchiveHistoryReport(report, sinceInput, dt);
        }
        return;
      }
      // fix | all → unified per-day rollup
      const report = await runDoctorHistoryAll(resolution.target, { since: sinceMs });
      if (args.json === true) {
        writeStdout(JSON.stringify(report, null, 2));
      } else {
        renderHistoryAllReport(report, sinceInput, historyMode, dt);
      }
      return;
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

    // v2.1 ④ conflict-detection (P4): --lint-conflicts is a read-only report
    // surface (own output shape). Mutex with the mutation arms. The cheap pass
    // (bm25 candidate pairs) always runs; `--deep` is reserved for the LLM-judge
    // pass — no in-process judge is wired (the cold-eval mechanism is manual),
    // so --deep currently reports that no judge ran and falls back to the cheap
    // candidates rather than silently pretending to classify.
    if (args["lint-conflicts"] === true) {
      if (fix || fixKnowledge || citeCoverage) {
        writeStderr(dt("cli.doctor.errors.lint-conflicts-mutex"));
        process.exitCode = 1;
        return;
      }
      const report = await runDoctorConflictLint(resolution.target, {
        deep: args.deep === true,
      });
      if (args.json === true) {
        writeStdout(JSON.stringify(report, null, 2));
      } else {
        renderConflictLintReport(report, args.deep === true, dt);
      }
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
    let unboundProjectFix: Awaited<ReturnType<typeof backfillUnboundProject>> = null;
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

      // F8: --fix-knowledge --dry-run must NOT mutate. Mirror the --fix
      // --dry-run short-circuit below: render the plan as a preview (what the
      // run WOULD mutate) and stop before runDoctorFixKnowledge touches any
      // frontmatter or runs git mv. No consent prompt — nothing is mutated, so
      // the safety gate (which only guards real mutation) is irrelevant here.
      if (args["dry-run"] === true) {
        if (plan.totalCount > 0) {
          renderFixKnowledgePlan(plan);
        }
        report = preReport;
      } else {
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
      }
    } else if (fix) {
      // v2.0.0-rc.33 W4-B1 (T6 P2): --fix --dry-run 短路 — 跑只读 doctor 报告,
      // 不调用 runDoctorFix 的 mutation 路径。fixable_errors 列表本身就是
      // "--fix would address these" 的预览, 不需要单独 dry-run mutation 模拟器。
      // 输出在下方加 banner 让用户明确 "no mutations applied this run"。
      if (args["dry-run"] === true) {
        report = await runDoctorReport(resolution.target);
      } else {
        // Backfill the project-scope binding (unbound_project) FIRST so the
        // report below reflects the post-backfill state — the server fix cannot
        // reach the CLI-only install primitive that mints project_id /
        // active_project. Idempotent: a no-op when the coordinate is complete.
        unboundProjectFix = await backfillUnboundProject(resolution.target);
        fixReport = await runDoctorFix(resolution.target);
        report = fixReport.report;
        // C3: repair the by-alias readability links (best-effort, global scope).
        syncStoreAliasLinks();
      }
    } else {
      report = await runDoctorReport(resolution.target);
    }

    // v2.1.0-rc.1 P3 (S10): multi-store health surfaced alongside the report.
    const storeDiagnostics = collectStoreDiagnostics(resolution.target);

    if (args.json === true) {
      writeStdout(
        JSON.stringify(
          {
            ...(fixKnowledgeReport ?? fixReport ?? report),
            store_diagnostics: storeDiagnostics,
            ...(unboundProjectFix === null ? {} : { unbound_project_fix: unboundProjectFix }),
          },
          null,
          2,
        ),
      );
    } else {
      if (fixKnowledgeReport !== null) {
        writeStdout(fixKnowledgeReport.message);
        if (fixKnowledgeReport.aborted && fixKnowledgeReport.abort_reason !== undefined) {
          writeStderr(fixKnowledgeReport.abort_reason);
        }
        renderFixKnowledgeMutations(fixKnowledgeReport, dt);
      } else if (fixReport !== null) {
        writeStdout(fixReport.message);
        if (unboundProjectFix !== null) {
          writeStdout(
            dt("cli.doctor.unbound-project-backfilled", {
              alias: unboundProjectFix.alias,
              project: unboundProjectFix.active_project,
            }),
          );
        }
      } else if ((fix || fixKnowledge) && args["dry-run"] === true) {
        // v2.0.0-rc.33 W4-B1: dry-run banner. Surfaces above the standard
        // report so user knows no mutations were applied; the fixable_errors
        // section already lists what `fabric doctor --fix` (sans --dry-run) would
        // address. F8: also covers --fix-knowledge --dry-run (the plan preview
        // above lists what the frontmatter/git-mv pass would have mutated).
        writeStdout(dt("cli.doctor.fix-dry-run-banner"));
      }
      renderHumanReport(report, dt, args.verbose === true);
      renderStoreDiagnostics(storeDiagnostics);
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
  // v2.0.0-rc.37 NEW-25: TL;DR top-3 critical surface. Doctor's full check
  // list runs 48 long now; without a header summary the user has to scroll
  // through every OK row to find the actionable issues. Pick top-3 from
  // (fixable_errors ∪ manual_errors ∪ warnings) in that severity order and
  // print them as a one-line each header BEFORE the per-check enumeration.
  // Empty TL;DR (everything OK) just emits a single green line.
  renderTldrHeader(report, dt, verbose);
  // doctor-decruft W3 (G-QUIET): default output prints only actionable checks
  // (status warn/error); the full per-check enumeration — including every
  // passing/info row — is gated behind --verbose. The TL;DR header above
  // already surfaces the top issues, and the fixable/manual/warning sections
  // below list every actionable issue in full, so the default surface stays
  // signal-only instead of scrolling ~30 OK rows.
  for (const check of report.checks) {
    if (!verbose && check.status === "ok") {
      continue;
    }
    writeStdout(`${renderStatus(check.status)} ${check.name}: ${check.message}`);
  }
  const opts = { verbose, dt };
  writeIssueSection(dt("doctor.section.fixable"), report.fixable_errors, opts);
  writeIssueSection(dt("doctor.section.manual"), report.manual_errors, opts);
  writeIssueSection(dt("doctor.section.warnings"), report.warnings, opts);
  renderPayloadLimits(report, dt);
}

// v2.1.0-rc.1 P3 (S10/S51/R5#5): multi-store health checks. Read-only and
// best-effort — a store-check failure must never change doctor's exit semantics
// or block (KT-DEC-0007). Surfaces no_global_config / missing_required_store /
// local_only_store under the main report.
function collectStoreDiagnostics(projectRoot: string): StoreDiagnostic[] {
  try {
    return storeDoctorChecks(projectRoot);
  } catch {
    return [];
  }
}

function renderStoreDiagnostics(diagnostics: StoreDiagnostic[]): void {
  if (diagnostics.length === 0) {
    return;
  }
  writeStdout("");
  writeStdout(paint.ai("store health"));
  for (const diagnostic of diagnostics) {
    const mark =
      diagnostic.severity === "error"
        ? symbol.error
        : diagnostic.severity === "warn"
          ? symbol.warn
          : "[info]";
    const ref = diagnostic.ref === undefined ? "" : ` [${diagnostic.ref}]`;
    writeStdout(`${mark}${ref} ${diagnostic.message}`);
  }
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

// v2.0.0-rc.37 NEW-25: doctor TL;DR top-3 critical issues header. Surfaces
// the highest-severity 3 findings at the top of the human-readable output so
// users see the actionable signal without scrolling past 48 OK checks. Severity
// order: fixable_errors > manual_errors > warnings. When the report is all
// green, emits a single OK line instead of an empty header.
// ISS-038: the TL;DR carries each finding's actionHint (folded for
// maintainer-audience hints unless --verbose), mirroring the full issue list —
// a user who reads only the TL;DR now sees how to fix, not just what is wrong.
// Exported for direct rendering tests.
export function renderTldrHeader(report: DoctorReport, dt: DoctorTranslator, verbose: boolean): void {
  const ranked: Array<{
    severity: "fixable" | "manual" | "warn";
    code: string;
    message: string;
    actionHint?: string;
    audience?: "user" | "maintainer";
  }> = [];
  for (const issue of report.fixable_errors) {
    ranked.push({ severity: "fixable", code: issue.code, message: issue.message, actionHint: issue.actionHint, audience: issue.audience });
  }
  for (const issue of report.manual_errors) {
    ranked.push({ severity: "manual", code: issue.code, message: issue.message, actionHint: issue.actionHint, audience: issue.audience });
  }
  for (const issue of report.warnings) {
    ranked.push({ severity: "warn", code: issue.code, message: issue.message, actionHint: issue.actionHint, audience: issue.audience });
  }
  if (ranked.length === 0) {
    writeStdout(`${symbol.ok} TL;DR: all 48 checks green — nothing to fix.`);
    return;
  }
  const top3 = ranked.slice(0, 3);
  writeStdout(
    `TL;DR (top ${top3.length} of ${ranked.length}, severity order: fixable→manual→warn):`,
  );
  for (const item of top3) {
    const marker =
      item.severity === "fixable"
        ? symbol.error
        : item.severity === "manual"
          ? symbol.error
          : symbol.warn;
    // Truncate verbose check messages so the TL;DR stays single-line-ish.
    const truncated = item.message.length > 140 ? `${item.message.slice(0, 137)}...` : item.message;
    writeStdout(`  ${marker} ${item.code}: ${truncated}`);
    // Mirror writeIssueSection's actionHint surface (same arrow, same fold rule)
    // so the TL;DR is self-sufficient for the user who reads no further.
    if (item.actionHint !== undefined && item.actionHint.length > 0) {
      writeStdout(
        item.audience === "maintainer" && !verbose
          ? `    → ${dt("doctor.maintainer-hint-folded")}`
          : `    → ${item.actionHint}`,
      );
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
  // v2.0.0-rc.38 UX-8 (C): cite-policy compliance rate (corrected G-CITE metric).
  const complianceRate = report.metrics.cite_compliance_rate;
  const complianceStr = complianceRate === null || complianceRate === undefined
    ? dt("doctor.cite.metric.complianceNA")
    : `${(complianceRate * 100).toFixed(1)}% (${report.metrics.compliant_cites ?? 0}/${(report.metrics.compliant_cites ?? 0) + (report.metrics.noncompliant_cites ?? 0)})`;
  lines.push(`  ${dt("doctor.cite.metric.complianceRate")}: ${complianceStr}`);
  // v2.1 ⑤ cite-redesign (P5): recall-based coverage口径 — the redesign infers a
  // citation from a fab_recall whose target paths overlap the edited file, so
  // surface "what fraction of edits were recall-backed" alongside the legacy
  // compliance metric.
  const recallRate = report.metrics.recall_coverage_rate;
  const recallStr = recallRate === null || recallRate === undefined
    ? dt("doctor.cite.metric.recallCoverageNA")
    : `${(recallRate * 100).toFixed(1)}% (${report.metrics.recall_backed_edits ?? 0}/${report.metrics.edits_touched})`;
  lines.push(`  ${dt("doctor.cite.metric.recallCoverage")}: ${recallStr}`);
  // v2.0.0-rc.38 UX-8 (C, hardening): warn when edit signals couldn't be
  // correlated (no session_id) — a stale pre-session_id hook silently deflates
  // expected_but_missed, so surface it instead of hiding behind a clean 100%.
  const uncorrelatable = report.metrics.uncorrelatable_edits ?? 0;
  if (uncorrelatable > 0) {
    lines.push(`  ${dt("doctor.cite.metric.uncorrelatableEdits")}: ${uncorrelatable}`);
  }
  // v2.2.0-rc.1 W1-T3 (cite 诚实拆分 / lifecycle §3): exposed_and_mutated is a
  // WEAK auxiliary signal, rendered on its OWN line strictly SEPARATE from the
  // compliance rate above. The label explicitly states it is NOT counted toward
  // the true (explicit `KB:`) adherence rate — the honesty 铁律: this weak
  // signal must never dilute the real compliance number.
  if (report.metrics.exposed_and_mutated !== undefined) {
    lines.push(
      `  ${dt("doctor.cite.metric.exposedAndMutated")}: ${report.metrics.exposed_and_mutated.count}`,
    );
  }
  // lifecycle-refactor W2-T4 (§5 row7 PostToolUse mutation funnel / §0 下沉 doctor):
  // surface the offline-rebuilt mutation signals on their OWN lines, strictly
  // SEPARATE from the compliance rate above (honesty 铁律 — these are observability
  // markers, never folded into adherence). mutations_observed = authoritative
  // PostToolUse mutation-completed count; mutation_pool splits low-confidence
  // attribution (attributed via source_event_id vs unattributed_workspace_dirty).
  if (report.metrics.mutations_observed !== undefined) {
    lines.push(
      `  ${dt("doctor.cite.metric.mutationsObserved")}: ${report.metrics.mutations_observed.count}`,
    );
  }
  if (report.metrics.mutation_pool !== undefined) {
    lines.push(
      `  ${dt("doctor.cite.metric.mutationPool")}: ${report.metrics.mutation_pool.attributed} / ${report.metrics.mutation_pool.unattributed_workspace_dirty} (attributed / unattributed_workspace_dirty)`,
    );
  }
  if (report.metrics.sessions_closed !== undefined) {
    lines.push(
      `  ${dt("doctor.cite.metric.sessionsClosed")}: ${report.metrics.sessions_closed.count}`,
    );
  }
  // lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测): per-store
  // qualifying-cite breakdown on its OWN lines, strictly SEPARATE from the
  // compliance rate above. A pure diagnostic split — never folded into adherence
  // (honesty 铁律). Project-local cites bucket under "local". Only rendered when
  // the server populated the map (≥1 cite observed in window).
  if (report.metrics.by_store !== undefined) {
    const storeKeys = Object.keys(report.metrics.by_store).sort();
    if (storeKeys.length > 0) {
      lines.push(`  ${dt("doctor.cite.metric.byStore")}:`);
      for (const store of storeKeys) {
        lines.push(`    ${store}: ${report.metrics.by_store[store].qualifying_cites}`);
      }
    }
  }

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
 * v2.1 ④ conflict-detection (P4): human-readable formatter for the
 * --lint-conflicts report. Cheap-pass candidates render as warnings ("review
 * one"); deep-pass conflicts (judge-confirmed contradictions) render as errors.
 * JSON mode is handled at the call site.
 */
function renderConflictLintReport(
  report: ConflictLintReport,
  deepRequested: boolean,
  dt: DoctorTranslator,
): void {
  const lines: string[] = [];
  lines.push(dt("doctor.conflict.header"));
  lines.push("");
  if (report.candidate_count === 0) {
    lines.push(`  ${symbol.ok} ${dt("doctor.conflict.none")}`);
    writeStdout(lines.join("\n"));
    return;
  }
  lines.push(
    `  ${dt("doctor.conflict.summary", {
      candidates: String(report.candidate_count),
      conflicts: String(report.conflict_count),
      threshold: report.threshold.toFixed(2),
    })}`,
  );
  // deep requested but no judge wired → tell the operator the cheap pass ran.
  if (deepRequested && !report.deep) {
    lines.push(`  ${symbol.warn} ${dt("doctor.conflict.deep_no_judge")}`);
  }
  lines.push("");
  for (const pair of report.pairs) {
    const sym = pair.verdict === "conflict" ? symbol.error : symbol.warn;
    const verdictLabel = dt(`doctor.conflict.verdict.${pair.verdict}`);
    const pct = `${(pair.similarity * 100).toFixed(0)}%`;
    let line = `  ${sym} [${pair.a} ↔ ${pair.b}] (${pair.knowledge_type}/${pair.layer}) ${pct} — ${verdictLabel}`;
    if (pair.rationale !== undefined && pair.rationale.length > 0) {
      line += `: ${pair.rationale}`;
    }
    lines.push(line);
  }
  writeStdout(lines.join("\n"));
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

// rc.37 NEW-33: render the unified per-day history table. `fix` and `all`
// modes share the same row shape; `fix` shows only doctor_run columns and
// `all` adds archive columns. Empty windows print a single empty-state line.
function renderHistoryAllReport(
  report: HistoryAllReport,
  sinceLabel: string,
  mode: "fix" | "all",
  dt: DoctorTranslator,
): void {
  if (report.rows.length === 0) {
    writeStdout(dt("doctor.history.empty", { sinceLabel, mode }));
    return;
  }
  const lines: string[] = [];
  lines.push(
    dt("doctor.history.header", {
      sinceLabel,
      mode,
      days: String(report.rows.length),
    }),
  );
  lines.push("");
  if (mode === "fix") {
    lines.push("| date       | lint | fix | issues | mutations |");
    lines.push("| ---------- | ---- | --- | ------ | --------- |");
    for (const row of report.rows) {
      lines.push(
        `| ${row.date} | ${row.doctor_runs_lint} | ${row.doctor_runs_fix} | ${row.doctor_total_issues} | ${row.doctor_total_mutations} |`,
      );
    }
  } else {
    lines.push("| date       | lint | fix | issues | mutations | archive | proposed |");
    lines.push("| ---------- | ---- | --- | ------ | --------- | ------- | -------- |");
    for (const row of report.rows) {
      lines.push(
        `| ${row.date} | ${row.doctor_runs_lint} | ${row.doctor_runs_fix} | ${row.doctor_total_issues} | ${row.doctor_total_mutations} | ${row.archive_attempts} | ${row.archive_proposed} |`,
      );
    }
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

// ---------------------------------------------------------------------------
// EPIC-009: Custom help renderer that hides internal/report flags
// ---------------------------------------------------------------------------
// citty's default usage renderer shows ALL args with no filtering capability.
// This custom renderer only shows EXPOSED_FLAGS, keeping the output clean.
// Hidden flags remain functional for advanced users who know them.
export function renderDoctorFilteredHelp(): void {
  const lines: string[] = [];

  // Header
  lines.push(paint.ai("fabric doctor") + " — Diagnose and fix Fabric workspace issues");
  lines.push("");

  // Usage
  lines.push(`${paint.human("USAGE")}`);
  lines.push(`  fabric doctor [OPTIONS]`);
  lines.push("");

  // Exposed options only
  lines.push(`${paint.human("OPTIONS")}`);
  lines.push("");

  const exposedOptions: Array<[string, string]> = [
    ["--target <path>", "Override project root (defaults to cwd)"],
    ["--fix", "Auto-fix derived-state issues (agents.meta.json)"],
    ["--fix-knowledge", "Auto-fix knowledge entry issues (frontmatter + git mv)"],
    ["--json", "Output as JSON for programmatic consumption"],
    ["--verbose", "Show maintainer-audience action hints"],
  ];

  for (const [flag, desc] of exposedOptions) {
    lines.push(`  ${paint.ai(flag)}  ${desc}`);
  }

  lines.push("");
  lines.push(`${paint.human("EXAMPLES")}`);
  lines.push(`  ${paint.ai("fabric doctor")}                  # Run diagnostics`);
  lines.push(`  ${paint.ai("fabric doctor --fix")}            # Fix derived-state issues`);
  lines.push(`  ${paint.ai("fabric doctor --fix-knowledge")}  # Fix knowledge entry issues`);
  lines.push("");
  lines.push(paint.human("Run `fabric doctor` to see a full diagnostic report with 48 checks."));

  writeStdout(lines.join("\n"));
}
