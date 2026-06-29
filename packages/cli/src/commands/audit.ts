import { defineCommand } from "citty";

import {
  enrichDescriptions,
  explainWhyNotSurfaced,
  inspectRetiredReferences,
  runDoctorArchiveHistory,
  runDoctorCiteCoverage,
  runDoctorConflictLint,
  runDoctorHistoryAll,
  type ArchiveHistoryReport,
  type CiteCoverageReport,
  type ConflictLintReport,
  type EnrichDescriptionsReport,
  type HistoryAllReport,
  type RetiredReferenceInspection,
  type WhyNotSurfacedResult,
} from "@fenglimg/fabric-server";

import { paint, symbol } from "../colors.js";
import { resolveDevMode } from "../dev-mode.js";
import { getDoctorTranslator, t } from "../i18n.js";
import metricsCommand from "./metrics.js";

// W3-D (UX northstar): the audit/telemetry surfaces that used to ride on
// `fabric doctor --<flag>` are split into a dedicated `fabric audit <sub>` group
// (mirrors the `store` subCommands pattern). doctor keeps only health + fix.
// Because each surface is now its own subcommand, the inter-flag mutex checks
// that the doctor dispatcher needed are gone — the command grammar enforces the
// "one surface per run" invariant for free. The renderers move here VERBATIM so
// the output stays byte-identical (existing string/snapshot assertions hold).

type AuditTranslator = typeof t;

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

// ---------------------------------------------------------------------------
// Shared helpers (moved from doctor.ts — only the audit surfaces consume --since)
// ---------------------------------------------------------------------------

/**
 * Parse a `--since` value into an absolute epoch-ms floor for ledger scans.
 *
 * Accepted forms: `Nd` / `Nh` / `Nm` durations, or bare digits (epoch-ms).
 * Throws on any other shape so the caller can surface
 * `cli.doctor.errors.invalid-since`. Rejects zero/negative durations.
 */
export function parseSinceDuration(input: string): number {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error(`invalid --since value: ${input}`);
  }

  const durationMatch = /^(\d+)([dhm])$/.exec(trimmed);
  if (durationMatch !== null) {
    const value = Number.parseInt(durationMatch[1], 10);
    const unit = durationMatch[2];
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`invalid --since value: ${input}`);
    }
    const unitMs = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
    return Date.now() - value * unitMs;
  }

  if (/^\d+$/.test(trimmed)) {
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid --since value: ${input}`);
    }
    return value;
  }

  throw new Error(`invalid --since value: ${input}`);
}

type CiteCoverageClientFilter = "cc" | "codex" | "all";

const CITE_COVERAGE_CLIENT_FILTERS: ReadonlySet<CiteCoverageClientFilter> = new Set([
  "cc",
  "codex",
  "all",
]);

function isValidClientFilter(input: string): input is CiteCoverageClientFilter {
  return CITE_COVERAGE_CLIENT_FILTERS.has(input as CiteCoverageClientFilter);
}

// `--layer` accepts {team, personal, all}. `both` (the plan-context vocabulary)
// is intentionally rejected — cite-coverage uses `all` for "no filter".
type CiteCoverageLayerFilter = "team" | "personal" | "all";

const CITE_COVERAGE_LAYER_FILTERS: ReadonlySet<CiteCoverageLayerFilter> = new Set([
  "team",
  "personal",
  "all",
]);

function isValidLayerFilter(input: string): input is CiteCoverageLayerFilter {
  return CITE_COVERAGE_LAYER_FILTERS.has(input as CiteCoverageLayerFilter);
}

// ---------------------------------------------------------------------------
// `fabric audit cite` renderer (moved verbatim from doctor.ts)
// ---------------------------------------------------------------------------

function renderCiteCoverageReport(
  report: CiteCoverageReport,
  jsonMode: boolean,
  dt: AuditTranslator,
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
  const complianceRate = report.metrics.cite_compliance_rate;
  const complianceStr = complianceRate === null || complianceRate === undefined
    ? dt("doctor.cite.metric.complianceNA")
    : `${(complianceRate * 100).toFixed(1)}% (${report.metrics.compliant_cites ?? 0}/${(report.metrics.compliant_cites ?? 0) + (report.metrics.noncompliant_cites ?? 0)})`;
  lines.push(`  ${dt("doctor.cite.metric.complianceRate")}: ${complianceStr}`);
  const recallRate = report.metrics.recall_coverage_rate;
  const recallStr = recallRate === null || recallRate === undefined
    ? dt("doctor.cite.metric.recallCoverageNA")
    : `${(recallRate * 100).toFixed(1)}% (${report.metrics.recall_backed_edits ?? 0}/${report.metrics.edits_touched})`;
  lines.push(`  ${dt("doctor.cite.metric.recallCoverage")}: ${recallStr}`);
  const uncorrelatable = report.metrics.uncorrelatable_edits ?? 0;
  if (uncorrelatable > 0) {
    lines.push(`  ${dt("doctor.cite.metric.uncorrelatableEdits")}: ${uncorrelatable}`);
  }
  if (report.metrics.exposed_and_mutated !== undefined) {
    lines.push(
      `  ${dt("doctor.cite.metric.exposedAndMutated")}: ${report.metrics.exposed_and_mutated.count}`,
    );
  }
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
  if (report.metrics.by_store !== undefined) {
    const storeKeys = Object.keys(report.metrics.by_store).sort();
    if (storeKeys.length > 0) {
      lines.push(`  ${dt("doctor.cite.metric.byStore")}:`);
      for (const store of storeKeys) {
        lines.push(`    ${store}: ${report.metrics.by_store[store].qualifying_cites}`);
      }
    }
  }

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

  appendContractSection(lines, report, dt);

  writeStdout(lines.join("\n"));
}

function appendContractSection(
  lines: string[],
  report: CiteCoverageReport,
  dt: AuditTranslator,
): void {
  const status = report.contract_metrics_status;
  if (status === undefined) {
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

  if (status === "awaiting_marker" && allCountsZero) {
    return;
  }

  lines.push("");
  lines.push(`### ${dt("cite-coverage.contract.header")}`);

  if (status === "skipped:bootstrap_drift") {
    lines.push(`  ${dt("cite-coverage.contract.status.skipped_bootstrap_drift")}`);
    return;
  }

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

  if (perLayerType !== undefined) {
    const teamKeys = Object.keys(perLayerType.team).filter((k) => perLayerType.team[k] > 0);
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

  if (metrics !== undefined && Object.keys(metrics.skip_count).length > 0) {
    lines.push("");
    lines.push(`#### ${dt("cite-coverage.contract.skip_count")}`);
    for (const [reason, count] of Object.entries(metrics.skip_count)) {
      const label = dt(`cite-coverage.skip.${reason}`);
      lines.push(`  ${label}: ${count}`);
    }
  }

  if (metrics !== undefined && metrics.cite_id_unresolved > 0) {
    lines.push("");
    lines.push(
      `${symbol.warn} ${dt("cite-coverage.contract.cite_id_unresolved")}: ${metrics.cite_id_unresolved}`,
    );
  }
}

// ---------------------------------------------------------------------------
// `fabric audit conflicts` renderer (moved verbatim from doctor.ts)
// ---------------------------------------------------------------------------

function renderConflictLintReport(
  report: ConflictLintReport,
  deepRequested: boolean,
  dt: AuditTranslator,
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

// ---------------------------------------------------------------------------
// `fabric audit descriptions` renderer (moved from doctor.ts; the human header
// label is re-pointed from the retired `fabric doctor --enrich-descriptions`
// invocation to the new `fabric audit descriptions` surface)
// ---------------------------------------------------------------------------

function renderEnrichDescriptionsReport(
  report: EnrichDescriptionsReport,
  dt: AuditTranslator,
): void {
  const header = `${symbol.ok} ${paint.ai("fabric audit descriptions")} mode=${report.mode}${
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
      writeStdout(`${symbol.ok} ${candidate.path} — missing: ${missing} → added: ${added}`);
    } else {
      writeStdout(`${symbol.warn} ${candidate.path} — missing: ${missing}`);
    }
  }
}

// ---------------------------------------------------------------------------
// `fabric audit history` renderers (moved verbatim from doctor.ts)
// ---------------------------------------------------------------------------

function renderArchiveHistoryReport(
  report: ArchiveHistoryReport,
  sinceLabel: string,
  dt: AuditTranslator,
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

function renderHistoryAllReport(
  report: HistoryAllReport,
  sinceLabel: string,
  mode: "fix" | "all",
  dt: AuditTranslator,
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

function formatTimestampForTable(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

// ---------------------------------------------------------------------------
// `fabric audit retired` renderer (new standalone surface for the W2-2
// retired-reference lint that previously only ran inside the doctor check suite)
// ---------------------------------------------------------------------------

function renderRetiredReport(inspection: RetiredReferenceInspection): void {
  if (inspection.status === "skipped") {
    writeStdout(`${symbol.warn} retired-reference scan skipped — no agent-consumed surfaces found.`);
    return;
  }
  if (inspection.hits.length === 0) {
    writeStdout(
      `${symbol.ok} no retired references — scanned ${inspection.scannedFiles} agent surface(s).`,
    );
    return;
  }
  writeStdout(
    `${symbol.error} ${inspection.hits.length} retired reference(s) across ${inspection.scannedFiles} scanned file(s):`,
  );
  for (const hit of inspection.hits) {
    const fix = hit.replacement === null ? "(removed)" : `→ ${hit.replacement}`;
    writeStdout(`  ${hit.path}:${hit.line}  ${hit.token}  ${fix}`);
  }
}

// ---------------------------------------------------------------------------
// `fabric audit why-not-surfaced <id>` renderer (W3-H / S6): the self-serve
// answer to "why isn't this knowledge showing?", reporting the FIRST blocking
// cause across the three scope axes (store binding · semantic_scope · timing).
// ---------------------------------------------------------------------------

function renderWhyNotSurfaced(r: WhyNotSurfacedResult): void {
  const id = r.localId;
  switch (r.verdict) {
    case "not_found":
      writeStdout(
        `${symbol.error} '${id}' not found in any mounted store. Check the id (try \`fabric store list\`).`,
      );
      return;
    case "store_unbound":
      writeStdout(
        `${symbol.error} '${id}' lives in store '${r.storeAlias}', which is NOT bound to this project.`,
      );
      writeStdout(`  → bind it: fabric store bind ${r.storeAlias}`);
      return;
    case "project_mismatch":
      writeStdout(
        `${symbol.error} '${id}' is scoped to '${r.semanticScope}', but this repo is bound to 'project:${r.activeProject}'.`,
      );
      writeStdout(`  → it surfaces only in repos bound to '${r.semanticScope}' (semantic_scope axis).`);
      return;
    case "narrow_timing":
      writeStdout(
        `${symbol.warn} '${id}' is relevance_scope=narrow — it surfaces via the PreToolUse hint when you EDIT a matching file, not at SessionStart.`,
      );
      writeStdout(`  → broad entries are the always-on spine; narrow ones are edit-time only (timing axis).`);
      return;
    case "should_surface":
      writeStdout(
        `${symbol.ok} '${id}' should be surfacing — store '${r.storeAlias}' bound, scope matches, relevance_scope=broad.`,
      );
      writeStdout(`  → if it isn't, the SessionStart snapshot may be stale: start a fresh session or re-run \`fabric install\`.`);
      return;
  }
}

const whyNotSurfacedCommand = defineCommand({
  meta: {
    name: "why-not-surfaced",
    description: "Diagnose why a knowledge entry isn't surfacing (store / scope / timing)",
  },
  args: {
    id: { type: "positional", required: true, description: "Knowledge id (e.g. KT-DEC-0001 or team:KT-DEC-0001)" },
    target: { type: "string", description: "Override project root (defaults to cwd)" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const resolution = resolveDevMode(args.target as string | undefined, process.cwd());
    const result = await explainWhyNotSurfaced(resolution.target, String(args.id));
    if (args.json === true) {
      writeStdout(JSON.stringify(result, null, 2));
    } else {
      renderWhyNotSurfaced(result);
    }
    if (result.verdict === "not_found") {
      process.exitCode = 1;
    }
  },
});

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

export const citeCommand = defineCommand({
  meta: { name: "cite", description: "Cite-policy adherence report (read-only)" },
  args: {
    target: { type: "string", description: "Override project root (defaults to cwd)" },
    json: { type: "boolean", description: "Output as JSON", default: false },
    since: { type: "string", description: "Window (e.g. 7d, 24h, 30m)", default: "7d" },
    client: { type: "string", description: "Client filter", default: "all", valueHint: "cc|codex|all" },
    layer: { type: "string", description: "KB layer filter", default: "all", valueHint: "team|personal|all" },
  },
  async run({ args }) {
    const resolution = resolveDevMode(args.target as string | undefined, process.cwd());
    const dt = getDoctorTranslator(resolution.target);

    let sinceMs: number;
    try {
      sinceMs = parseSinceDuration((args.since as string) ?? "7d");
    } catch {
      writeStderr(dt("cli.doctor.errors.invalid-since", { input: (args.since as string) ?? "7d" }));
      process.exitCode = 1;
      return;
    }

    const clientFilter = (args.client as string) ?? "all";
    if (!isValidClientFilter(clientFilter)) {
      writeStderr(dt("cli.doctor.errors.invalid-client", { input: clientFilter }));
      process.exitCode = 1;
      return;
    }

    const layerFilter = (args.layer as string) ?? "all";
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
  },
});

export const conflictsCommand = defineCommand({
  meta: { name: "conflicts", description: "Knowledge-conflict lint (read-only)" },
  args: {
    target: { type: "string", description: "Override project root (defaults to cwd)" },
    json: { type: "boolean", description: "Output as JSON", default: false },
    deep: { type: "boolean", description: "Reserve the LLM-judge pass (no judge wired yet)", default: false },
  },
  async run({ args }) {
    const resolution = resolveDevMode(args.target as string | undefined, process.cwd());
    const dt = getDoctorTranslator(resolution.target);
    const report = await runDoctorConflictLint(resolution.target, { deep: args.deep === true });
    if (args.json === true) {
      writeStdout(JSON.stringify(report, null, 2));
    } else {
      renderConflictLintReport(report, args.deep === true, dt);
    }
  },
});

export const historyCommand = defineCommand({
  meta: { name: "history", description: "Maintenance history rollup (archive | fix | all)" },
  args: {
    mode: { type: "positional", required: false, description: "archive | fix | all", valueHint: "archive|fix|all" },
    target: { type: "string", description: "Override project root (defaults to cwd)" },
    json: { type: "boolean", description: "Output as JSON", default: false },
    since: { type: "string", description: "Window (e.g. 7d, 24h, 30m)", default: "7d" },
  },
  async run({ args }) {
    const resolution = resolveDevMode(args.target as string | undefined, process.cwd());
    const dt = getDoctorTranslator(resolution.target);

    const mode = typeof args.mode === "string" && args.mode.length > 0 ? args.mode : "all";
    if (mode !== "archive" && mode !== "fix" && mode !== "all") {
      writeStderr(dt("cli.doctor.errors.invalid-history-mode", { input: mode }));
      process.exitCode = 1;
      return;
    }

    const sinceInput = (args.since as string) ?? "7d";
    let sinceMs: number;
    try {
      sinceMs = parseSinceDuration(sinceInput);
    } catch {
      writeStderr(dt("cli.doctor.errors.invalid-since", { input: sinceInput }));
      process.exitCode = 1;
      return;
    }

    if (mode === "archive") {
      const report = await runDoctorArchiveHistory(resolution.target, { since: sinceMs });
      if (args.json === true) {
        writeStdout(JSON.stringify(report, null, 2));
      } else {
        renderArchiveHistoryReport(report, sinceInput, dt);
      }
      return;
    }

    const report = await runDoctorHistoryAll(resolution.target, { since: sinceMs });
    if (args.json === true) {
      writeStdout(JSON.stringify(report, null, 2));
    } else {
      renderHistoryAllReport(report, sinceInput, mode, dt);
    }
  },
});

export const descriptionsCommand = defineCommand({
  meta: { name: "descriptions", description: "Back-fill description-grade frontmatter fields" },
  args: {
    target: { type: "string", description: "Override project root (defaults to cwd)" },
    json: { type: "boolean", description: "Output as JSON", default: false },
    auto: { type: "boolean", description: "Write stub values (default: read-only list)", default: false },
    "dry-run": { type: "boolean", description: "Preview --auto changes without writing", default: false },
  },
  async run({ args }) {
    const resolution = resolveDevMode(args.target as string | undefined, process.cwd());
    const dt = getDoctorTranslator(resolution.target);
    const report = await enrichDescriptions(resolution.target, {
      auto: args.auto === true,
      dryRun: args["dry-run"] === true,
    });
    if (args.json === true) {
      writeStdout(JSON.stringify(report, null, 2));
    } else {
      renderEnrichDescriptionsReport(report, dt);
    }
  },
});

export const retiredCommand = defineCommand({
  meta: { name: "retired", description: "Scan agent surfaces for retired tool/field references" },
  args: {
    target: { type: "string", description: "Override project root (defaults to cwd)" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const resolution = resolveDevMode(args.target as string | undefined, process.cwd());
    const inspection = await inspectRetiredReferences(resolution.target);
    if (args.json === true) {
      writeStdout(JSON.stringify(inspection, null, 2));
    } else {
      renderRetiredReport(inspection);
    }
    if (inspection.status === "warn") {
      process.exitCode = 1;
    }
  },
});

export const auditCommand = defineCommand({
  meta: {
    name: "audit",
    description: t("cli.audit.description"),
  },
  subCommands: {
    cite: citeCommand,
    conflicts: conflictsCommand,
    history: historyCommand,
    descriptions: descriptionsCommand,
    metrics: metricsCommand,
    retired: retiredCommand,
    "why-not-surfaced": whyNotSurfacedCommand,
  },
});

export default auditCommand;
