/**
 * Pure presentation helpers for `fabric doctor` (Doctor W6+).
 * I/O-heavy paths (store diagnostics collect, consent, event emit) stay in doctor.ts.
 */
import type {
  DoctorApplyLintReport as DoctorFixKnowledgeReport,
  DoctorIssue,
  DoctorReport,
} from "@fenglimg/fabric-server";
import { paint } from "../colors.js";
import { groupDot, headerRule } from "../tui/structure.js";
import { t } from "../i18n.js";
import type { StoreDiagnostic } from "../store/doctor-checks.js";

type DoctorTranslator = typeof t;

export type FixKnowledgePlan = {
  totalCount: number;
  // Per-code summary lines (e.g. "demote (maturity): 3 entry"). Ordered by
  // label for stable rendering.
  perCodeLines: string[];
  // Up to N per-entry preview lines to give the user a hint about what is
  // about to change. Long plans truncate with a tail summary line.
  previewLines: string[];
};

// The default end-user digest: actionable issues only, maintainer-audience
// findings folded out ENTIRELY (not just their actionHint — an end user can't
// edit `packages/...`). Severity order fixable→manual→warn. A clean run (no
// user-facing issue) collapses to a single green line, with a muted pointer to
// --verbose when contributor-only findings were hidden.
// Default-digest hints stay ONE scannable line: take the first sentence (the
// gist + its command) and hard-cap its width. The full remediation — paths,
// config knobs like `broad_index_backstop` — lives in --verbose; the end user
// just needs to know which command to run.
const SHORT_HINT_CAP = 42;
// ISS-20260712-003: preserve full first line / first command-bearing sentence.
// Multi-paragraph remediation stays behind --verbose; do not hard-cap mid-command.
export function shortHint(hint: string): string {
  const firstLine = (hint.split("\n")[0] ?? hint).trim();
  const firstSentence = (firstLine.split("。")[0] ?? firstLine).trim();
  // Prefer a line that still contains a fabric CLI verb so recovery stays actionable.
  if (/\bfabric\b|doctor|--fix|install/i.test(firstSentence)) {
    return firstSentence;
  }
  const base = firstSentence.length > 0 ? firstSentence : firstLine;
  const chars = Array.from(base);
  if (chars.length <= SHORT_HINT_CAP) {
    return base;
  }
  // Cut on a word boundary so we never slice mid-word (the ugly `告警 s…`):
  // scan back from the cap to the nearest natural break (space / CJK or ASCII
  // comma / slash / backtick / close-paren), falling back to a hard cut if none
  // is within reach.
  let cut = SHORT_HINT_CAP - 1;
  for (let i = SHORT_HINT_CAP - 1; i >= 28; i--) {
    if (/[\s，、,/`)）]/.test(chars[i] ?? "")) {
      cut = i;
      break;
    }
  }
  return `${chars.slice(0, cut).join("").trimEnd()}…`;
}


// flat-design status glyph — the SAME ✓ / ○ / ✗ vocabulary as info / store /
// sync and the install renderer (paint.success/warn/error). Replaces doctor's
// legacy `[ok]`/`[warn]`/`[error]` bracket labels, which read as machine-log
// noise and were the one place doctor diverged from every other command's look.
export function renderStatus(status: "ok" | "warn" | "error"): string {
  if (status === "ok") {
    return paint.success("✓");
  }
  if (status === "warn") {
    return paint.warn("○");
  }
  return paint.error("✗");
}


export function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}


export function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
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
        ? paint.error("✗")
        : diagnostic.severity === "warn"
          ? paint.warn("○")
          : paint.ai("ℹ");
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
  const rows: string[] = [];
  for (const check of report.checks) {
    if (!verbose && check.status === "ok") {
      continue;
    }
    rows.push(`  ${renderStatus(check.status)} ${check.name}: ${check.message}`);
    // verbose 去复读: the actionHint that used to live in a SEPARATE
    // fixable/manual/warnings section now folds onto its own check row, so each
    // problem appears exactly once (no check-list ⊕ issue-list double-print the
    // user flagged). KT-GLD-0008: aggregate, never re-read.
    if (verbose && check.status !== "ok" && check.actionHint !== undefined && check.actionHint.length > 0) {
      rows.push(`    ${paint.muted(`→ ${check.actionHint}`)}`);
    }
  }
  // MCP payload thresholds: a one-line config FYI, not a pass/fail check. It used
  // to be a stray bare-text section (no groupDot, no glyph) that read as visually
  // detached; fold it into the checks group as an ℹ row so the whole verbose
  // surface is one consistent glyph list.
  const limits = report.summary.payload_limits;
  if (verbose && limits !== undefined) {
    rows.push(
      `  ${paint.ai("ℹ")} ${t("doctor.section.payload-limits")}${t("doctor.payload-limits.line", {
        warnKb: String(Math.round(limits.warn_bytes / 1024)),
        hardKb: String(Math.round(limits.hard_bytes / 1024)),
        source: limits.source,
      })}`,
    );
  }
  if (rows.length === 0) {
    return "";
  }
  return `${groupDot(t("doctor.group.checks"))}\n${rows.join("\n")}`;
}


// ---------------------------------------------------------------------------
// EPIC-009: Custom help renderer that hides internal/report flags
// ---------------------------------------------------------------------------
// citty's default usage renderer shows ALL args with no filtering capability.
// This custom renderer only shows EXPOSED_FLAGS, keeping the output clean.
// Hidden flags remain functional for advanced users who know them.
export function renderDoctorFilteredHelp(): void {
  const lines: string[] = [];

  // Header — tagline i18n'd; USAGE/OPTIONS/EXAMPLES labels stay English to match
  // citty's renderUsage in the other commands' --help (the flat-design through-line
  // is the localized COPY, not the citty-standard section labels).
  lines.push(paint.ai("fabric doctor") + ` — ${t("doctor.help.tagline")}`);
  lines.push("");

  // Usage
  lines.push(`${paint.human("USAGE")}`);
  lines.push(`  fabric doctor [OPTIONS]`);
  lines.push("");

  // Exposed options only
  lines.push(`${paint.human("OPTIONS")}`);
  lines.push("");

  const exposedOptions: Array<[string, string]> = [
    ["--target <path>", t("doctor.help.flag.target")],
    ["--fix", t("doctor.help.flag.fix")],
    ["--json", t("doctor.help.flag.json")],
    ["--verbose", t("doctor.help.flag.verbose")],
  ];

  for (const [flag, desc] of exposedOptions) {
    lines.push(`  ${paint.ai(flag)}  ${desc}`);
  }

  lines.push("");
  lines.push(`${paint.human("EXAMPLES")}`);
  lines.push(`  ${paint.ai("fabric doctor")}        # ${t("doctor.help.example.run")}`);
  lines.push(`  ${paint.ai("fabric doctor --fix")}  # ${t("doctor.help.example.fix")}`);
  lines.push("");
  lines.push(paint.human(t("doctor.help.footer")));

  writeStdout(lines.join("\n"));
}

export function renderHumanReport(report: DoctorReport, dt: DoctorTranslator, verbose: boolean): void {
  writeStdout(renderDoctorHeader(report));
  if (!verbose) {
    renderActionableDigest(report, dt);
    return;
  }
  const checksBlock = renderDoctorChecks(report, true);
  if (checksBlock.length > 0) {
    writeStdout(checksBlock);
  }
}

export function renderActionableDigest(report: DoctorReport, dt: DoctorTranslator): void {
  const ranked: Array<{ issue: DoctorIssue; mark: string }> = [
    ...report.fixable_errors.map((issue) => ({ issue, mark: paint.error("✗") })),
    ...report.manual_errors.map((issue) => ({ issue, mark: paint.error("✗") })),
    ...report.warnings.map((issue) => ({ issue, mark: paint.warn("○") })),
  ];
  const userFacing = ranked.filter((r) => r.issue.audience !== "maintainer");
  const hiddenMaintainer = ranked.length - userFacing.length;
  const okCount = report.checks.filter((c) => c.status === "ok").length;

  if (userFacing.length === 0) {
    writeStdout(`${paint.success("✓")} ${dt("doctor.digest.clean", { count: String(report.checks.length) })}`);
    if (hiddenMaintainer > 0) {
      writeStdout(`  ${paint.muted(dt("doctor.digest.more-verbose", { count: String(hiddenMaintainer) }))}`);
    }
    return;
  }

  writeStdout("");
  writeStdout(groupDot(dt("doctor.digest.todo", { count: String(userFacing.length) })));
  for (const { issue, mark } of userFacing) {
    writeStdout(`  ${mark} ${issue.name}`);
    if (issue.actionHint !== undefined && issue.actionHint.length > 0) {
      writeStdout(`    ${paint.muted(`→ ${shortHint(issue.actionHint)}`)}`);
    }
  }
  writeStdout("");
  writeStdout(
    paint.muted(dt("doctor.digest.summary", { todo: String(userFacing.length), ok: String(okCount) })),
  );
}

export function renderStoreDiagnostics(diagnostics: StoreDiagnostic[], verbose: boolean): void {
  const shown = verbose ? diagnostics : diagnostics.filter((d) => d.severity !== "info");
  const block = renderDoctorStoreHealth(shown);
  if (block.length === 0) {
    return;
  }
  writeStdout("");
  writeStdout(block);
}

export function renderFixKnowledgeMutations(
  fixKnowledgeReport: DoctorFixKnowledgeReport,
  dt: DoctorTranslator,
): void {
  if (fixKnowledgeReport.mutations.length === 0) {
    return;
  }
  writeStdout("");
  writeStdout(groupDot(dt("doctor.section.fix-knowledge-mutations")));
  for (const mutation of fixKnowledgeReport.mutations) {
    const marker = mutation.applied ? paint.success("✓") : paint.error("✗");
    const errSuffix = mutation.applied || mutation.error === undefined ? "" : ` (${mutation.error})`;
    writeStdout(`  ${marker} ${mutation.kind}: ${mutation.path} [${mutation.detail}]${errSuffix}`);
  }
}

export function renderFixKnowledgePlan(plan: FixKnowledgePlan): void {
  writeStdout("");
  writeStdout(paint.warn(t("doctor.fix-plan.header", { count: String(plan.totalCount) })));
  for (const line of plan.perCodeLines) {
    writeStdout(line);
  }
  if (plan.previewLines.length > 0) {
    writeStdout("");
    writeStdout(`  ${t("doctor.fix-plan.preview")}`);
    for (const line of plan.previewLines) {
      writeStdout(line);
    }
  }
}
