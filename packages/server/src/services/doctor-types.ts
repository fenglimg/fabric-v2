/**
 * doctor-types.ts — pure public report/check types for the doctor subsystem.
 *
 * Wave W1 extraction from doctor.ts (repo-hygiene-slim). No runtime logic —
 * only type aliases. doctor.ts re-exports these for backward-compatible
 * `import type { DoctorCheck } from "./doctor.js"` consumers.
 */
import type { AgentsMeta } from "@fenglimg/fabric-shared";
import type { DoctorHealth } from "./doctor-health.js";

export type DoctorStatus = "ok" | "warn" | "error";
export type DoctorIssueKind = "fixable_error" | "manual_error" | "warning" | "info";

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  message: string;
  kind?: DoctorIssueKind;
  code?: string;
  fixable?: boolean;
  actionHint?: string;
  // rc.35 TASK-12 (P0-11): audience classifier for the actionHint remediation.
  //   - "user"        → npm-installed end users can act on it (default).
  //                     Examples: `fabric doctor --fix`, `fabric install`,
  //                     edit a knowledge entry.
  //   - "maintainer"  → only Fabric contributors with the source tree can
  //                     act (e.g. edit `packages/cli/templates/skills/*` or
  //                     interpret the G1-G5 cite-goodhart patterns).
  //
  // CLI renderer folds maintainer remediations by default; `fabric doctor
  // --verbose` shows them. Undefined ≡ "user" so legacy checks render
  // unchanged.
  audience?: "user" | "maintainer";
};

export type DoctorIssue = {
  code: string;
  name: string;
  message: string;
  path?: string;
  // rc.26 TASK-06 follow-up (Gemini review M1): forward the localized remediation
  // text from DoctorCheck.actionHint so CLI consumers can render it inline with
  // the issue. Optional — pre-rc.26 issues without actionHint stay backward-compat.
  actionHint?: string;
  // rc.35 TASK-12 (P0-11): forwarded from DoctorCheck.audience for the
  // renderer to decide whether to fold the actionHint.
  audience?: "user" | "maintainer";
};

// v2.0.0-rc.29 TASK-008 (BUG-F2): surface the active MCP payload thresholds so
// operators can see (a) what's enforced and (b) whether the values came from
// the library default or a fabric.config.json override. Previously
// DEFAULT_WARN/DEFAULT_HARD were buried in code and never rendered in
// `fabric doctor --json`, leaving operators in the dark about why a knowledge
// section returned with `mcp_payload_warn`.
export type DoctorPayloadLimits = {
  warn_bytes: number;
  hard_bytes: number;
  source: "default" | "config";
};

export type DoctorSummary = {
  target: string;
  framework: {
    kind: string;
    version: string;
    subkind: string;
  };
  entryPoints: Array<{
    path: string;
    reason: string;
  }>;
  metaRevision: string | null;
  computedMetaRevision: string | null;
  ruleCount: number;
  eventLedgerPath: string;
  fixableErrorCount: number;
  manualErrorCount: number;
  warningCount: number;
  infoCount: number;
  targetFiles: Record<string, boolean>;
  // v2.0.0-rc.29 TASK-008 (BUG-F2): active MCP payload thresholds.
  payload_limits: DoctorPayloadLimits;
  // v2.2 A14-doctor-health (W3-T4): a single 0-100 health rollup derived from the
  // existing doctor lint set — no new probes, just an aggregate the fabric-audit
  // skill (SK1) consumes to triage "how healthy is this Fabric workspace?" in one
  // number. W3-REVIEW codex HIGH: named `health` (not `kb_health`) because the
  // lint set is workspace-wide — it includes bootstrap / hook-wiring / global-CLI
  // / event-ledger checks, not only KB-content lints. The fabric-audit skill
  // still uses it as its KB-triage entry point, but the score is honestly the
  // whole-workspace doctor rollup.
  health: DoctorHealth;
};

export type DoctorReport = {
  status: DoctorStatus;
  checks: DoctorCheck[];
  fixable_errors: DoctorIssue[];
  manual_errors: DoctorIssue[];
  warnings: DoctorIssue[];
  infos: DoctorIssue[];
  summary: DoctorSummary;
};

export type DoctorFixReport = {
  changed: boolean;
  fixed: DoctorIssue[];
  remaining_manual_errors: DoctorIssue[];
  warnings: DoctorIssue[];
  message: string;
  report: DoctorReport;
};

// Apply-lint mutation kinds (aligned with doctor-apply-lint.ts after store cutover).
export type DoctorApplyLintMutationKind =
  | "knowledge_session_hints_stale_cleanup"
  | "store_counter_floor";

export type DoctorApplyLintMutation = {
  kind: DoctorApplyLintMutationKind;
  path: string;
  detail: string;
  applied: boolean;
  error?: string;
};

export type DoctorApplyLintReport = {
  changed: boolean;
  mutations: DoctorApplyLintMutation[];
  warnings: DoctorIssue[];
  manual_errors: DoctorIssue[];
  aborted: boolean;
  abort_reason?: string;
  message: string;
  report: DoctorReport;
};

export type MetaInspection =
  | {
      present: true;
      valid: true;
      meta: AgentsMeta;
      revision: string;
      computedRevision: string | null;
      ruleCount: number;
      missingContentRefs: string[];
      invalidContentRefs: string[];
      stale: boolean;
      changed: boolean;
      readError?: undefined;
    }
  | {
      present: false;
      valid: false;
      meta: null;
      revision: null;
      computedRevision: string | null;
      ruleCount: number;
      missingContentRefs: string[];
      invalidContentRefs: string[];
      stale: boolean;
      changed: boolean;
      readError?: string;
    }
  | {
      present: true;
      valid: false;
      meta: null;
      revision: null;
      computedRevision: string | null;
      ruleCount: number;
      // rc.35 TASK-09 (P0-14): structured parse-failure hints so renderer
      // can swap the raw ZodError JSON dump for a human sentence + actionable
      // command. `readErrorKind === "zod"` carries up to N issues with
      // {path, message} so the doctor check produces stable copy.
      readErrorKind?: "zod" | "json" | "other";
      readErrorZodIssues?: Array<{ path: string; message: string }>;
      missingContentRefs: string[];
      invalidContentRefs: string[];
      stale: boolean;
      changed: boolean;
      readError: string;
    };


export type LintMaturity = "proven" | "verified" | "draft";

export type EnrichDescriptionsMode = "auto" | "preview" | "readonly" | "interactive";

export type EnrichDescriptionsCandidate = {
  // Workspace-relative POSIX path for team entries; `~/.fabric/...` form for
  // personal entries. Matches the displayPath convention used elsewhere in
  // this module (iterateCanonicalFilenames).
  path: string;
  // Subset of the four field names absent from the file's frontmatter, in a
  // fixed canonical order so test assertions are deterministic.
  missing: Array<"intent_clues" | "tech_stack" | "impact" | "must_read_if">;
  // Whether enrichDescriptions actually rewrote this file. False in
  // interactive mode (no auto-write), in dry-run mode (preview only), and
  // when frontmatter could not be parsed (the file is reported but skipped).
  modified: boolean;
  // Populated when modified=true. Mirrors the `added_fields` payload in the
  // `knowledge_enriched` event so callers can audit the per-file diff
  // without re-reading the file.
  added_fields: Array<"intent_clues" | "tech_stack" | "impact" | "must_read_if">;
  // Set on a file we surfaced but couldn't rewrite (e.g. frontmatter not
  // parseable). Undefined on the happy path.
  error?: string;
};

export type EnrichDescriptionsReport = {
  mode: EnrichDescriptionsMode;
  dryRun: boolean;
  scanned: number;
  // Files actually rewritten on disk. Equal to candidates.filter(c =>
  // c.modified).length on the auto+!dryRun path; always zero in interactive
  // or dryRun mode.
  modified: number;
  // Files that the scan visited but found nothing to change (all four fields
  // already present). Idempotency indicator.
  skipped: number;
  candidates: EnrichDescriptionsCandidate[];
};

