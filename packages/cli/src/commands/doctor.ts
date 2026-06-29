import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";

import {
  appendEventLedgerEvent,
  runDoctorApplyLint as runDoctorFixKnowledge,
  runDoctorFix,
  runDoctorReport,
  type DoctorApplyLintReport as DoctorFixKnowledgeReport,
  type DoctorIssue,
  type DoctorReport,
} from "@fenglimg/fabric-server";

import { backfillUnboundProject } from "../install/backfill-unbound-project.js";
import { migrateRootConfig } from "../install/migrate-root-config.js";
import { paint, symbol } from "../colors.js";
import { groupDot, headerRule } from "../tui/structure.js";
import { resolveDevMode } from "../dev-mode.js";
import { getDoctorTranslator, t } from "../i18n.js";
import { storeDoctorChecks, type StoreDiagnostic } from "../store/doctor-checks.js";
import { knowledgeDoctorChecks } from "../store/knowledge-doctor-checks.js";
import { fixActivePersonalPointer, syncStoreAliasLinks } from "../store/store-ops.js";
import { buildDebugBundle } from "@fenglimg/fabric-shared";
import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import { loadProjectConfig } from "../store/project-config-io.js";
// v2.0.0-rc.37 Wave A2: error-render imports removed alongside serve-lock
// preflight call. See KB [[fabric-serve-quarantine-not-delete]].

type DoctorTranslator = typeof t;

// W3-D (UX northstar): doctor now keeps ONLY the health + fix surface. The
// telemetry/audit flags (--cite-coverage / --lint-conflicts / --history /
// --archive-history / --enrich-descriptions and their --since/--client/--layer/
// --auto/--deep companions) moved to the `fabric audit <sub>` group. The two
// mutation arms (--fix derived-state + --fix-knowledge knowledge mutations)
// merged into a single `--fix` that applies both, keeping the knowledge-mutation
// safety confirm + honesty (only previews what will actually run).
type DoctorArgs = {
  target?: string;
  fix?: boolean;
  json?: boolean;
  strict?: boolean;
  // v2.1.0-rc.1 P6 (S40): redacted diagnostic bundle.
  "debug-bundle"?: boolean;
  // rc.7 T11: skip the safety confirm before --fix mutates knowledge frontmatter
  // and runs git mv. Required for any non-tty invocation (CI, nested pipelines)
  // unless FABRIC_NONINTERACTIVE=1 is set in the environment.
  yes?: boolean;
  // rc.35 TASK-12 (P0-11): unfold maintainer-audience action hints.
  verbose?: boolean;
  // v2.0.0-rc.33 W4-B1: preview what `--fix` would mutate without writing.
  "dry-run"?: boolean;
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
  "json",
  "verbose",
]);

// All flags that should be hidden from --help but remain functional.
// These are internal/debug flags that advanced users can still use.
const HIDDEN_FLAGS = new Set([
  "strict",
  "debug-bundle",
  "yes",
  "dry-run",
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
    // EPIC-009: hidden flag (preview --fix without writing).
    "dry-run": {
      type: "boolean",
      description: t("cli.doctor.args.dry-run.description"),
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

    const fix = args.fix === true;

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
        diagnostics: await collectStoreDiagnostics(resolution.target),
      });
      writeStdout(JSON.stringify(bundle, null, 2));
      return;
    }

    let fixKnowledgeReport: DoctorFixKnowledgeReport | null = null;
    let fixReport: Awaited<ReturnType<typeof runDoctorFix>> | null = null;
    let unboundProjectFix: Awaited<ReturnType<typeof backfillUnboundProject>> = null;
    let rootConfigMigration: ReturnType<typeof migrateRootConfig> | null = null;
    let report: DoctorReport;

    if (fix) {
      // W3-D: --fix applies BOTH the derived-state fixes (agents.meta /
      // root-config / unbound-project) AND the knowledge-frontmatter mutations
      // that used to live behind the separate --fix-knowledge flag. The
      // knowledge arm keeps its safety confirm + honesty: the consent prompt is
      // computed from a pre-flight report and shown ONLY when there is something
      // to mutate, so we never preview a fix that will not run (KT-PIT-0016).
      const preReport = await runDoctorReport(resolution.target);
      const plan = computeFixKnowledgePlan(preReport);

      if (args["dry-run"] === true) {
        // --fix --dry-run: render the knowledge mutation plan (what the
        // frontmatter/git-mv pass WOULD do) and stop before any mutation. The
        // report's fixable_errors already lists the derived-state fixes --fix
        // would apply; the dry-run banner below makes the no-op explicit.
        if (plan.totalCount > 0) {
          renderFixKnowledgePlan(plan);
        }
        report = preReport;
      } else {
        // Knowledge-mutation consent FIRST so an abort leaves the workspace
        // entirely untouched (no derived-state writes either). Skip the prompt
        // when there is nothing to mutate (no "Proceed?" for a no-op).
        if (plan.totalCount > 0) {
          renderFixKnowledgePlan(plan);
          const decision = await resolveFixKnowledgeConsent({
            yesFlag: args.yes === true,
            envBypass: process.env.FABRIC_NONINTERACTIVE === "1",
            plan,
          });
          if (decision === "abort") {
            process.exitCode = 1;
            return;
          }
        }

        // Derived-state fixes (idempotent). A1 (KT-DEC-0003): consolidate any
        // legacy project-root fabric.config.json into .fabric/fabric-config.json
        // FIRST so downstream fixes read the single source of truth. Backfill
        // the project-scope binding before the server fix so the report reflects
        // the post-backfill state.
        rootConfigMigration = migrateRootConfig(resolution.target);
        unboundProjectFix = await backfillUnboundProject(resolution.target);
        fixReport = await runDoctorFix(resolution.target);
        // C3: repair the by-alias readability links (best-effort, global scope).
        syncStoreAliasLinks();
        // 语义 A (multi-personal): repair a dangling/unset active personal pointer
        // (idempotent global-config fix; no-op for the common single-personal case).
        fixActivePersonalPointer();

        // Knowledge-frontmatter mutations (consent already granted above when
        // the plan was non-empty). runDoctorFixKnowledge is safe to run for a
        // zero-mutation pass — it tags the report as a no-op. Its report is the
        // most complete post-mutation view, so it becomes the rendered report.
        fixKnowledgeReport = await runDoctorFixKnowledge(resolution.target);
        // The knowledge arm's report is the most complete post-mutation view;
        // fall back to the pre-flight report if it is somehow absent.
        report = fixKnowledgeReport?.report ?? preReport;
      }
    } else {
      report = await runDoctorReport(resolution.target);
    }

    // v2.1.0-rc.1 P3 (S10): multi-store health surfaced alongside the report.
    const storeDiagnostics = await collectStoreDiagnostics(resolution.target);

    if (args.json === true) {
      writeStdout(
        JSON.stringify(
          {
            ...(fixKnowledgeReport ?? fixReport ?? report),
            store_diagnostics: storeDiagnostics,
            ...(unboundProjectFix === null ? {} : { unbound_project_fix: unboundProjectFix }),
            ...(rootConfigMigration?.migrated === true ? { root_config_migration: rootConfigMigration } : {}),
          },
          null,
          2,
        ),
      );
    } else {
      // W3-D: a real --fix run produces BOTH a derived-state fixReport and a
      // knowledge fixKnowledgeReport — render both (derived first, then the
      // knowledge mutations). --fix --dry-run produces neither and shows the
      // banner instead.
      if (fixReport != null) {
        writeStdout(fixReport.message);
        if (unboundProjectFix !== null) {
          writeStdout(
            dt("cli.doctor.unbound-project-backfilled", {
              alias: unboundProjectFix.alias,
              project: unboundProjectFix.active_project,
            }),
          );
        }
        if (rootConfigMigration?.migrated === true) {
          writeStdout(
            `config: migrated legacy root fabric.config.json → .fabric/fabric-config.json${
              rootConfigMigration.mergedKeys.length > 0
                ? ` (merged: ${rootConfigMigration.mergedKeys.join(", ")})`
                : ""
            }`,
          );
        }
      }
      if (fixKnowledgeReport != null) {
        writeStdout(fixKnowledgeReport.message);
        if (fixKnowledgeReport.aborted && fixKnowledgeReport.abort_reason !== undefined) {
          writeStderr(fixKnowledgeReport.abort_reason);
        }
        renderFixKnowledgeMutations(fixKnowledgeReport, dt);
      }
      if (fix && args["dry-run"] === true) {
        // v2.0.0-rc.33 W4-B1: dry-run banner. Surfaces above the standard
        // report so the user knows no mutations were applied; the fixable_errors
        // section already lists what `fabric doctor --fix` (sans --dry-run) would
        // address, and the plan preview above lists the frontmatter/git-mv pass.
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
      mode: fixKnowledgeReport != null ? "fix-knowledge" : "lint",
      issues:
        report.fixable_errors.length +
        report.manual_errors.length +
        report.warnings.length,
      mutations:
        fixKnowledgeReport != null
          ? fixKnowledgeReport.mutations.filter((m) => m.applied).length
          : undefined,
    });

    // Exit code rules:
    //   * --fix-knowledge aborted (manual_error blocker) → 1
    //   * --fix-knowledge with any failed mutation → 1
    //   * any error status (or strict + warnings) → 1
    //   * otherwise → 0
    if (fixKnowledgeReport != null) {
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
  writeStdout(renderDoctorHeader(report));
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
  const checksBlock = renderDoctorChecks(report, verbose);
  if (checksBlock.length > 0) {
    writeStdout(checksBlock);
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
async function collectStoreDiagnostics(projectRoot: string): Promise<StoreDiagnostic[]> {
  const diagnostics: StoreDiagnostic[] = [];
  // Synchronous config/mount health (S10/S51/R5#5).
  try {
    diagnostics.push(...storeDoctorChecks(projectRoot));
  } catch {
    // Best-effort — a store-check failure never changes doctor's exit semantics.
  }
  // PR #33 re-wire: async knowledge-health advisories (related graph / store
  // reachability / consumption heatmap). Isolated so a failure here cannot
  // suppress the synchronous diagnostics above.
  try {
    diagnostics.push(...(await knowledgeDoctorChecks(projectRoot)));
  } catch {
    // Best-effort.
  }
  return diagnostics;
}

function renderStoreDiagnostics(diagnostics: StoreDiagnostic[]): void {
  const block = renderDoctorStoreHealth(diagnostics);
  if (block.length === 0) {
    return;
  }
  writeStdout("");
  writeStdout(block);
}

// flat-design-system Wave5 (TASK-005) reskin — pure string composers for the
// doctor human surface. Each returns the rendered block (no stdout side-effect)
// so the new look is snapshot-pinnable (doctor-reskin.test.ts, NO_COLOR=1). The
// writeStdout wrappers above call them; the JSON output path (args.json) never
// touches these. Structure is now the flat language: B-横线 (headerRule) command
// header + C-圆点 (groupDot) section headers + plain two-space-indented rows —
// NO `tree()` branch glyphs, NO sectionBar `▌` block. Status badges stay the
// existing symbol() ✓/!/x. Colour stays the 7-token accent layer.

// Header: `fabric doctor · <target>` B-横线 (accent-bold title + dim rule) plus a
// trailing health badge on the title line. Replaces the old sectionBar `▌` bar.
export function renderDoctorHeader(report: DoctorReport): string {
  const rule = headerRule(`fabric doctor · ${report.summary.target}`);
  const [title, ...rest] = rule.split("\n");
  // Append the health badge to the title line so the rule stays clean below it.
  return [`${title} ${renderStatus(report.status)}`, ...rest].join("\n");
}

// Store health: `● Store Health` C-圆点 group header + plain two-space-indented
// diagnostic rows. Each row keeps the original `<severity-badge> [<ref>]
// <message>` text verbatim so the diagnostic wording/semantics (and the existing
// string assertions) are preserved — only the section header + flat layout are
// new (no tree branches).
export function renderDoctorStoreHealth(diagnostics: StoreDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }
  const rows = diagnostics.map((diagnostic) => {
    const mark =
      diagnostic.severity === "error"
        ? symbol.error
        : diagnostic.severity === "warn"
          ? symbol.warn
          : "[info]";
    const ref = diagnostic.ref === undefined ? "" : ` [${diagnostic.ref}]`;
    return `  ${mark}${ref} ${diagnostic.message}`;
  });
  return `${groupDot(t("doctor.group.store-health"))}\n${rows.join("\n")}`;
}

// Checks: `● Checks` C-圆点 group header + plain two-space-indented per-check
// rows. G-QUIET still applies — only warn/error rows show by default; --verbose
// adds the passing rows. Returns "" when there is nothing to show (quiet + all
// OK), so the header is suppressed rather than dangling over an empty group.
export function renderDoctorChecks(report: DoctorReport, verbose: boolean): string {
  const rows = report.checks
    .filter((check) => verbose || check.status !== "ok")
    .map((check) => `  ${renderStatus(check.status)} ${check.name}: ${check.message}`);
  if (rows.length === 0) {
    return "";
  }
  return `${groupDot(t("doctor.group.checks"))}\n${rows.join("\n")}`;
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
  writeStdout(groupDot(dt("doctor.section.fix-knowledge-mutations")));
  for (const mutation of fixKnowledgeReport.mutations) {
    const marker = mutation.applied ? symbol.ok : symbol.error;
    const errSuffix = mutation.applied || mutation.error === undefined ? "" : ` (${mutation.error})`;
    writeStdout(`  ${marker} ${mutation.kind}: ${mutation.path} [${mutation.detail}]${errSuffix}`);
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
  writeStdout(groupDot(title));
  for (const issue of issues) {
    writeStdout(`  - ${issue.code}: ${issue.message}`);
    // rc.35 TASK-12 (P0-11): fold maintainer-audience actionHints unless
    // --verbose. Print a one-line breadcrumb so users know the hint exists.
    if (issue.actionHint !== undefined && issue.actionHint.length > 0) {
      if (issue.audience === "maintainer" && !options.verbose) {
        writeStdout(`    → ${options.dt("doctor.maintainer-hint-folded")}`);
      } else {
        writeStdout(`    → ${issue.actionHint}`);
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
    ["--fix", "Auto-fix issues (derived-state + knowledge frontmatter/git mv)"],
    ["--json", "Output as JSON for programmatic consumption"],
    ["--verbose", "Show maintainer-audience action hints"],
  ];

  for (const [flag, desc] of exposedOptions) {
    lines.push(`  ${paint.ai(flag)}  ${desc}`);
  }

  lines.push("");
  lines.push(`${paint.human("EXAMPLES")}`);
  lines.push(`  ${paint.ai("fabric doctor")}        # Run diagnostics`);
  lines.push(`  ${paint.ai("fabric doctor --fix")}  # Fix derived-state + knowledge issues`);
  lines.push("");
  lines.push(paint.human("Run `fabric doctor` to see a full diagnostic report. Audits → `fabric audit`."));

  writeStdout(lines.join("\n"));
}
