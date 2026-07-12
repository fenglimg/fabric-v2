import { appendFileSync } from "node:fs";
import { join as joinPath } from "node:path";

import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";

import {
  appendEventLedgerEvent,
  checkBacklogAge,
  renderBacklogAgeLine,
  runDoctorApplyLint as runDoctorFixKnowledge,
  runDoctorFix,
  runDoctorReport,
  type DoctorApplyLintReport as DoctorFixKnowledgeReport,
  type DoctorIssue,
  type DoctorReport,
} from "@fenglimg/fabric-server";

import { backfillUnboundProject } from "../install/backfill-unbound-project.js";
import { migrateRootConfig } from "../install/migrate-root-config.js";
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

import {
  renderActionableDigest,
  renderDoctorChecks,
  renderDoctorFilteredHelp,
  renderDoctorHeader,
  renderDoctorStoreHealth,
  renderFixKnowledgeMutations,
  renderFixKnowledgePlan,
  renderHumanReport,
  renderStoreDiagnostics,
  renderStatus,
  shortHint,
  writeStderr,
  writeStdout,
  type FixKnowledgePlan,
} from "./doctor-render.js";

// Keep package surface stable for reskin tests + top-level filtered help.
export {
  renderDoctorChecks,
  renderDoctorFilteredHelp,
  renderDoctorHeader,
  renderDoctorStoreHealth,
};

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
  knowledge_index_drift: "store counter floor (if any)",
  knowledge_session_hints_stale: "cache delete",
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
        await fixActivePersonalPointer();

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
      renderStoreDiagnostics(storeDiagnostics, args.verbose === true);
      // G4 (GRL-STOPHOOK-AIONLY-20260709): backlog-age observability line.
      // Pure metric — no color/severity/lint routing; never changes exit code.
      // Never-throw: an events.jsonl read failure MUST NOT break doctor's
      // human surface. Wrapped in try/catch here as an additional safety net
      // even though the service itself has an internal try/catch.
      try {
        const backlog = await checkBacklogAge(resolution.target);
        writeStdout(renderBacklogAgeLine(backlog));
        // G5 (GRL-STOPHOOK-AIONLY-20260709): time-series persistence for the
        // 4-week rollback baseline (C-011). Append a single line
        // {ts, kind:'backlog', count, median_age_days, oldest_days} to
        // .fabric/metrics.jsonl. Best-effort — a write failure MUST NOT alter
        // doctor's exit semantics (the outer try/catch here catches EACCES /
        // ENOSPC / EROFS uniformly; the append is not observable to the user
        // by design — noise-free).
        //
        // TODO(Tier-2, 4 周 baseline 后评估): 若 metrics.jsonl 超过 N 行或 M MB,
        // 引入 rotation → metrics.YYYY-MM.jsonl。config knob: metrics_max_lines
        // (默认软警告,不硬截断)。当前 append-only 是有意的最小实现。
        try {
          const record = {
            ts: new Date().toISOString(),
            kind: "backlog" as const,
            count: backlog.count,
            median_age_days: backlog.median_age_days,
            oldest_days: backlog.oldest_days,
          };
          appendFileSync(
            joinPath(resolution.target, ".fabric", "metrics.jsonl"),
            JSON.stringify(record) + "\n",
          );
        } catch {
          // silent degrade — metrics history is opt-in observability
        }
      } catch {
        // silent degrade — omit the line
      }
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

// flat-design (激进精简, 用户裁决): doctor now has TWO surfaces.
//   default  → renderActionableDigest: the npm-installed END USER only. One
//              `● 待处理` group of the issues they can act on (each `! <name>` +
//              `→ <fix>`), then a one-line tally. Nothing else.
//   --verbose → the CONTRIBUTOR surface: full per-check enumeration, every
//              fixable/manual/warning (incl. maintainer-audience), payload limits.
// The old TL;DR top-3 header is deleted: once the default is already trimmed to
// actionable-only, a separate "top 3" block just re-printed the same lines a
// fourth time (the doubled-render the user flagged). KT-GLD-0008: aggregate, do
// not re-read.





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
  // First-hit readiness is included inside storeDoctorChecks (assessFirstHitSync).
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

// flat-design (激进精简): the default surface hides info-severity store
// advisories (related-graph hubs, consumption heatmap, local-only / unbound
// notices) — contributor telemetry, not end-user action items. warn/error store
// PROBLEMS always show. --verbose restores the full set.






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
    previewLines.push(`    • ${t("doctor.fix-plan.more", { count: String(flattened.length - PLAN_PREVIEW_LIMIT) })}`);
  }

  return { totalCount, perCodeLines, previewLines };
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

