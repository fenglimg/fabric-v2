import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { access, appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, posix, relative as nodeRelative, resolve, sep } from "node:path";
import { Script } from "node:vm";

import { minimatch } from "minimatch";
import { ZodError } from "zod";

import {
  agentsMetaSchema,
  AgentsMetaCountersSchema,
  createTranslator,
  forensicReportSchema,
  parseKnowledgeId,
  knowledgeTestIndexSchema,
  LEGACY_KB_REGEX,
  BOOTSTRAP_CANONICAL,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
  ONBOARD_SLOT_NAMES,
  ONBOARD_SLOT_TOTAL,
  type AgentsMeta,
  type AgentsMetaCounters,
  type EventLedgerEvent,
  type ForensicReport,
  type KnowledgeTestIndex,
  type OnboardSlot,
  resolveFabricLocale,
  type Translator,
} from "@fenglimg/fabric-shared";
import { detectFramework } from "@fenglimg/fabric-shared/node";
// v2.0.0-rc.29 TASK-008 (BUG-F2): surface MCP payload thresholds in doctor.
import {
  PAYLOAD_LIMIT_DEFAULT_HARD_BYTES,
  PAYLOAD_LIMIT_DEFAULT_WARN_BYTES,
} from "@fenglimg/fabric-shared/node/mcp-payload-guard";
import { readOrphanDemoteThresholdDays, readPayloadLimits } from "../config-loader.js";

import { contextCache } from "../cache.js";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { ensureParentDirectory, getEventLedgerPath, getMetricsLedgerPath, sha256 } from "./_shared.js";
import { buildKnowledgeMeta, isSameKnowledgeTestIndex, loadKbIdTypeMap, writeKnowledgeMeta } from "./knowledge-meta-builder.js";
import {
  appendEventLedgerEvent,
  dropEventsFromLedger,
  readEventLedger,
  rotateEventLedgerIfNeeded,
  truncateLedgerToLastNewline,
} from "./event-ledger.js";
import { appendCiteRollupRow, readCiteRollup, utcDayKey, utcDayBounds } from "./cite-rollup.js";
import type { CiteRollupRow } from "./cite-rollup.js";
import { readMetrics, METRIC_COUNTER_NAMES } from "./metrics.js";
import type { MetricsRow } from "./metrics.js";
import { reconcileKnowledge, resolveContentRefPath } from "./knowledge-sync.js";
import { INJECTION_PATTERNS } from "./extract-knowledge.js";
import { readAgentsMeta } from "../meta-reader.js";
import { isAlive, readLockState } from "./legacy-serve-lock-probe.js";
import {
  inspectEventsJsonlGates,
  type EventsJsonlGatesReport,
} from "./events-jsonl-gates.js";

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

// v2.2 A14-doctor-health (W3-T4): doctor health rollup. `score` is 0-100, `grade`
// is the band, and `penalties` itemizes how each severity bucket subtracted from
// a perfect 100 — so the number is explainable, not a black box.
export type DoctorHealth = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  penalties: {
    manual_errors: number;
    fixable_errors: number;
    warnings: number;
  };
};

// Per-finding penalty weights. Manual (un-auto-fixable) errors hurt most; a
// warning is a light nudge. Infos never penalize (they are FYI, not debt).
const DOCTOR_HEALTH_PENALTY_MANUAL_ERROR = 15;
const DOCTOR_HEALTH_PENALTY_FIXABLE_ERROR = 8;
const DOCTOR_HEALTH_PENALTY_WARNING = 3;

/**
 * v2.2 A14-doctor-health (W3-T4): roll the lint findings into a 0-100 score +
 * letter grade. Pure + deterministic — reuses the same counts doctor already
 * computes, so the score moves in lockstep with the lint set with no new I/O.
 */
export function computeDoctorHealth(
  manualErrorCount: number,
  fixableErrorCount: number,
  warningCount: number,
): DoctorHealth {
  const manualPenalty = manualErrorCount * DOCTOR_HEALTH_PENALTY_MANUAL_ERROR;
  const fixablePenalty = fixableErrorCount * DOCTOR_HEALTH_PENALTY_FIXABLE_ERROR;
  const warningPenalty = warningCount * DOCTOR_HEALTH_PENALTY_WARNING;
  const score = Math.max(0, Math.min(100, 100 - manualPenalty - fixablePenalty - warningPenalty));
  const grade: DoctorHealth["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return {
    score,
    grade,
    penalties: {
      manual_errors: manualPenalty,
      fixable_errors: fixablePenalty,
      warnings: warningPenalty,
    },
  };
}

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

// rc.4 TASK-003: report shape returned by `runDoctorApplyLint`. Mirrors
// `DoctorFixReport` but the `mutations` payload itemizes each per-finding
// repair (demote / archive / counter bump) so the CLI surface can render a
// machine-parseable summary in addition to human prose.
export type DoctorApplyLintMutationKind =
  | "knowledge_orphan_demote_required"
  | "knowledge_stale_archive_required"
  | "knowledge_index_drift"
  // rc.5 TASK-009 (B2): pending entries >30d are auto-archived under
  // `.fabric/.archive/pending/<type>/` (team) or `~/.fabric/.archive/pending/<type>/`
  // (personal). One mutation per pending file moved.
  | "knowledge_pending_auto_archive"
  // rc.6 TASK-021 (E3): session-hints cache files older than 7d are deleted
  // by the doctor cleanup pass (lint #27 knowledge_session_hints_stale).
  // These are local cache files at `.fabric/.cache/session-hints-{id}.json`,
  // not git-tracked, so the apply-lint arm uses plain fs.unlink with no
  // ledger event (no audit trail required for local hot-cache hygiene).
  | "knowledge_session_hints_stale_cleanup"
  // v2.0.0-rc.9 TASK-003 (A3): pending entries with frontmatter missing
  // relevance_scope and/or relevance_paths get back-filled with the
  // schema defaults (`relevance_scope: broad`, `relevance_paths: []`)
  // by lint #28 (`relevance_fields_missing`). One mutation per back-filled
  // pending file. A single aggregate `relevance_migration_run` event is
  // emitted after the full walk (NOT per file) — see runDoctorApplyLint
  // for the emission site.
  | "knowledge_relevance_fields_missing";

export type DoctorApplyLintMutation = {
  kind: DoctorApplyLintMutationKind;
  // For demote / archive: project-relative POSIX path of the affected file
  // (pre-mutation). For index_drift: synthetic path string
  // `agents.meta.json#counters.<layer>.<type>`.
  path: string;
  // Detail of the mutation (e.g. "stable -> endorsed", ".fabric/.archive/...",
  // "5 -> 8"). Free-form prose for human consumption.
  detail: string;
  // True when the mutation succeeded; false when the per-finding repair
  // threw and was caught (the rest of the apply-lint run continues; see
  // task spec idempotency / partial-failure rationale).
  applied: boolean;
  // Populated when applied=false. Truncated to 240 chars to prevent log noise.
  error?: string;
};

export type DoctorApplyLintReport = {
  changed: boolean;
  mutations: DoctorApplyLintMutation[];
  // Non-fixable manual errors that surfaced in the lint pass. When non-empty
  // and the corresponding code is in MANUAL_LINT_ERROR_CODES, runDoctorApplyLint
  // sets `aborted: true` and returns BEFORE applying any mutations — these
  // findings indicate corruption that auto-fix could destroy.
  manual_errors: DoctorIssue[];
  aborted: boolean;
  abort_reason?: string;
  message: string;
  report: DoctorReport;
};

type EntryPoint = DoctorSummary["entryPoints"][number];

type MetaInspection =
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

type EventLedgerInspection = {
  exists: boolean;
  writable: boolean;
  parseable: boolean;
  hasPartialWrite: boolean;
  partialWriteByteOffset: number;
  partialWriteByteLength: number;
  // v2.0.0-rc.27 TASK-010 (audit §2.24): forward-compat counters surfaced
  // from event-ledger.LedgerWarning. `schemaVersionUnsupportedCount` counts
  // lines whose `schema_version !== 1` (legacy rc.0/rc.1 imports or future
  // rollback artifacts). `eventTypeUnknownCount` counts lines whose
  // `event_type` is not in the current discriminator set (likely a newer
  // server emitted a token the running CLI does not recognise — operator
  // should upgrade the CLI). Both default to 0; the new
  // `createEventLedgerSchemaCompatCheck` surfaces warnings when either is
  // non-zero.
  schemaVersionUnsupportedCount: number;
  eventTypeUnknownCount: number;
  schemaVersionSamples: string[];
  eventTypeSamples: string[];
  path: string;
  error?: string;
};

// v2.0.0-rc.28 TASK-04 (audit §3.1 follow-up): SKILL.md split moved
// reference content from a single SKILL.md into per-skill `ref/` subdirs.
// Both `.claude/skills/<slug>/ref/` and `.codex/skills/<slug>/ref/` get
// byte-identical copies via `fabric install`. A hand-edit to one client's
// ref/ file OR a partial install (one client succeeded, the other got an
// error mid-write) breaks mirror parity. This inspection collects the
// drifted pairs so the doctor check can surface them.
//
// Detection model: mirror parity between the two client subtrees. The
// templates/ source-of-truth is not part of the runtime workspace so it
// cannot be the reference; the install pipeline writes the same bytes to
// both clients, and any subsequent hand-edit shows up as parity drift.
// Missing client subtree (e.g. user only uses Codex CLI) degrades to "ok"
// — only files that exist in BOTH clients are compared.
type SkillRefMirrorInspection =
  | { status: "ok" }
  | {
      status: "drift";
      driftedPaths: string[]; // relative paths reported in remediation
    };

// v2.0.0-rc.33 W3-6 (P1-13): SKILL.md token budget lint. Scans installed
// `.claude/skills/<slug>/SKILL.md` for each known skill, estimates token
// count via chars/3 (mixed CJK/EN markdown heuristic — conservative side of
// chars/4 because SKILL.md is Chinese-heavy in this project). Warn > 5K
// tokens, error > 10K tokens — aligned with Anthropic's recommendation that
// SKILL.md hot path stay under ~3K so progressive disclosure works.
type SkillTokenBudgetInspection = {
  status: "ok" | "warn" | "error";
  // Per-skill estimates surfaced in the doctor message — empty when status === "ok".
  overSize: Array<{ slug: string; tokens: number; severity: "warn" | "error" }>;
};

// v2.0.0-rc.33 W3-7 (P1-14): SKILL.md description structural lint. Static
// proxy for trigger-recall — a real auto-invoke test requires a live LLM
// (gemini ran one in W1 Verify), but a structural check catches regression
// on the description quality contract:
//
//   1. description frontmatter present + non-empty
//   2. <= 60 tokens (chars / 3) so the host's auto-invoke matcher sees a
//      tight signal rather than a wall of prose
//   3. contains at least one CJK trigger phrase (Chinese-speaking users
//      should be able to trigger via natural language)
//   4. contains at least one ASCII trigger phrase (parallel English support)
//
// The 20-scenario "trigger fixture" called out in PLAN W3-7 is the gemini
// verify in W1-VERIFY-RESULT.md — re-running it here would require a live
// model. The structural lint is the deterministic, in-process proxy.
type SkillDescriptionLintInspection = {
  status: "ok" | "warn";
  issues: Array<{ slug: string; problem: "missing" | "too_long" | "no_cjk" | "no_ascii"; detail: string }>;
};

// v2.0.0-rc.33 W4-A4 (T5 P2): "draft backlog" detection. Warns when the
// proportion of `draft`-maturity canonical entries exceeds DRAFT_BACKLOG_RATIO
// (default 0.5). A workspace where the majority of entries never graduate
// past draft signals a broken promote loop — the rc.32 baseline showed 92%
// of entries stuck at draft, which is what motivated this lint.
type DraftBacklogInspection = {
  status: "ok" | "warn";
  draftCount: number;
  totalCount: number;
  ratio: number; // draftCount / totalCount, 0..1
};

// v2.0.0-rc.37 NEW-38: knowledge auto-promote candidates — canonical `draft`
// entries created ≥ DRAFT_AUTO_PROMOTE_MIN_AGE_DAYS ago that carry no recorded
// drift. Surfaced as an info check in the report; the --fix arm flips each to
// `verified` + emits a knowledge_promoted event, which is what actually drains
// the draft_backlog ratio.
type DraftAutoPromoteCandidate = {
  stable_id: string;
  relPath: string;
  absPath: string;
  ageDays: number;
};
type DraftAutoPromoteInspection = {
  candidates: DraftAutoPromoteCandidate[];
};

// v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart detection. Static heuristics
// over the last 7 days of `assistant_turn_observed` events.
//
//   G1 ritual_cite     — same (kb_id, "applied") tuple repeated > 5 times
//                        across the window without contract change. Signal:
//                        user is reciting the cite incantation without acting.
//   G2 dismissal_abuse — > 60% of "applied" cites carry a skip_reason
//                        commitment instead of an operator contract. Signal:
//                        user is bypassing contract enforcement.
//   G5 placeholder_cite — "none" cites with generic kb_line_raw ("KB: none"
//                        or "[unspecified]") > 5. Signal: cite line ritual
//                        without semantic intent.
//
// v2.1.0-rc.1 (ADJ-P4-1, full remap): G3 chained_from_misuse was retired —
// rc.37 NEW-1 collapsed the cite vocabulary to 2-state, so the `chained-from`
// tag no longer exists (the parser/schema remap it to `applied`). The chain
// LINK it carried is still surfaced as a sibling cite_id, but the distinct tag
// it policed can never appear, so the lint became permanently dead. Removed
// rather than left as a no-op (fix, don't hide).
//
// All patterns are warning-level (never error) — Goodhart heuristics produce
// false positives by definition. Message enumerates fired patterns so the
// operator can audit per-pattern without re-running.
type CiteGoodhartInspection = {
  status: "ok" | "warn";
  fired: Array<{ pattern: "G1" | "G2" | "G5"; detail: string }>;
};

type KnowledgeTestIndexInspection =
  | {
      present: true;
      valid: true;
      stale: boolean;
      linkCount: number;
      orphanCount: number;
      error?: undefined;
    }
  | {
      present: false;
      valid: false;
      stale: true;
      linkCount: 0;
      orphanCount: 0;
      error: string;
    }
  | {
      present: true;
      valid: false;
      stale: true;
      linkCount: 0;
      orphanCount: 0;
      error: string;
    };

type McpConfigInWrongFileInspection = {
  hasWrongEntry: boolean;
  settingsPath: string;
};

type MetaManuallyDivergedInspection = {
  extraMetaEntries: string[];
  hashMismatchEntries: string[];
  readable: boolean;
  error?: string;
};

type RulesDirUnindexedInspection = {
  unindexedFiles: string[];
};

type KnowledgeDirMissingInspection = {
  missingSubdirs: string[];
};

// v2.0.0-rc.22 TASK-006: baseline filename format lint.
// Each entry records the offending project-relative path plus the baseline
// stable_id parsed from the file's frontmatter.
type BaselineFilenameFormatOffender = {
  path: string;
  stable_id: string;
};

type BaselineFilenameFormatInspection = {
  offenders: BaselineFilenameFormatOffender[];
};

type StableIdCollision = {
  stable_id: string;
  files: string[];
};

type StableIdCollisionInspection = {
  collisions: StableIdCollision[];
};

type CounterDesyncEntry = {
  layer: "KP" | "KT";
  type: "MOD" | "DEC" | "GLD" | "PIT" | "PRO";
  observed: number;
  current: number;
};

type CounterDesyncInspection = {
  desyncs: CounterDesyncEntry[];
  // Snapshot of the corrected counters (post-fix view) used by --fix to rewrite agents.meta.json.
  correctedCounters: AgentsMetaCounters | null;
};

type BootstrapAnchorInspection = {
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
};

// v2.0.0-rc.19 bootstrap-consolidation TASK-004: one-time legacy marker
// migration. `filesNeedingMigration` is the subset of the four target paths
// (CLAUDE.md / AGENTS.md / .cursor/rules / .cursor/rules/fabric-bootstrap.mdc)
// whose content still contains the LEGACY_KB_REGEX match. Empty array means
// nothing to migrate (post-fix idempotency invariant).
type BootstrapMarkerMigrationInspection = {
  filesNeedingMigration: string[];
};

// v2.0.0-rc.19 bootstrap-consolidation TASK-005: L1 = canonical bootstrap body
// byte-compared against `.fabric/AGENTS.md` on disk. `missing` defers to the
// existing bootstrap_anchor_missing check; `drift` means bytes differ from
// BOOTSTRAP_CANONICAL — fixable_error.
type L1BootstrapSnapshotDriftInspection = {
  status: "ok" | "missing" | "drift";
  canonical: string;
  onDisk: string | null;
};

// v2.0.0-rc.19 bootstrap-consolidation TASK-005: L2 = three-end managed block
// bodies byte-compared against expectedBody (= .fabric/AGENTS.md + optional
// `\n---\n` + .fabric/project-rules.md). `drifted` lists per-target paths
// whose managed block body diverges; CLAUDE.md is checked for @-import line
// presence (no managed block — thin shell). `no-managed-block` is returned
// when none of the targets carry the new marker (legacy-marker pre-migration
// state — TASK-004 already flagged it).
type L2ManagedBlockDriftInspection = {
  status: "ok" | "drift" | "no-managed-block";
  drifted: Array<{ path: string; expected: string; actual: string }>;
};

type PreexistingRootFilesInspection = {
  detected: string[];
};

type FilesystemEditFallbackInspection = {
  // Number of orphan canonical entries for which a synthesized
  // knowledge_promoted event was appended on this run.
  synthesized: number;
  // The stable_ids that were synthesized this run (sorted).
  synthesizedStableIds: string[];
};

// rc.4 TASK-001: read-side lint inspections (#16-18). Each inspection walks
// the .fabric/knowledge/ tree and emits a `candidates` list of entries that
// fail the maturity-keyed inactivity threshold. Mutation + event emission for
// the proposed actions land in TASK-003 (--apply-lint).

type LintMaturity = "stable" | "endorsed" | "draft";

type OrphanDemoteCandidate = {
  // Stable id parsed out of YAML frontmatter (e.g. KT-DEC-0001).
  stable_id: string;
  // Project-relative POSIX path of the canonical entry.
  path: string;
  // Inactivity in days at the time of the check (max of frontmatter.created_at,
  // file mtime, and last matching event in events.jsonl).
  age_days: number;
  // Current maturity tier from frontmatter.
  maturity: LintMaturity;
  // The maturity tier the entry would demote to if a mutation were applied.
  // `null` means terminal (draft → archive territory in TASK-002 stale-archive).
  next_maturity: "endorsed" | "draft" | null;
};

type OrphanDemoteInspection = {
  candidates: OrphanDemoteCandidate[];
  // v2.0.0-rc.33 W4-B3 (T5 P2): per-maturity thresholds resolved at inspect
  // time (merges fabric-config overrides over hardcoded defaults). Surfaced
  // back to createOrphanDemoteCheck so the user sees the ACTUAL threshold
  // their workspace is running under, not the always-90/30/14 hardcode.
  thresholds: Record<LintMaturity, number>;
};

type StaleArchiveCandidate = {
  stable_id: string;
  path: string;
  age_days: number;
  // Proposed archive destination, project-relative POSIX.
  archive_path: string;
};

type StaleArchiveInspection = {
  candidates: StaleArchiveCandidate[];
};

type PendingOverdueCandidate = {
  // pending entries may have no frontmatter id yet (proposals are pre-allocate),
  // so stable_id is optional.
  stable_id?: string;
  path: string;
  age_days: number;
};

type PendingOverdueInspection = {
  candidates: PendingOverdueCandidate[];
};

// rc.5 TASK-009 (B2): pending auto-archive candidate. Identifies a pending
// proposal whose age (frontmatter.created_at when present, else mtime) exceeds
// PENDING_AUTO_ARCHIVE_THRESHOLD_DAYS. Covers BOTH the team-rooted pending
// tree (`<projectRoot>/.fabric/knowledge/pending/<type>/`) and the
// personal-rooted tree (`<FABRIC_HOME>/.fabric/knowledge/pending/<type>/`)
// introduced by TASK-008 (B1). The mutation arm (--apply-lint) moves the
// file into `.fabric/.archive/pending/<type>/` under the appropriate root
// (git mv for team, fs.rename for personal) and emits a single
// pending_auto_archived event per move.
type PendingAutoArchiveCandidate = {
  layer: "team" | "personal";
  // Pending entry's knowledge type subdir (e.g. "decisions"). Mirrors
  // KNOWLEDGE_CANONICAL_TYPE_DIRS slice (pending uses the same vocabulary).
  type: string;
  // Display path: project-relative POSIX for team; `~/.fabric/...` for personal.
  // Used in lint messages, mutation `path`, and the emitted event's
  // `pending_path` field so observers can grep events.jsonl without
  // resolving absolute paths.
  pending_path: string;
  // Absolute filesystem path of the source (used by the apply step).
  pending_path_abs: string;
  // Display destination after archive. Mirrors `pending_path` shape:
  // `.fabric/.archive/pending/<type>/<filename>` for team,
  // `~/.fabric/.archive/pending/<type>/<filename>` for personal.
  archived_to: string;
  // Absolute filesystem path of the destination (used by the apply step).
  archived_to_abs: string;
  age_days: number;
};

type PendingAutoArchiveInspection = {
  candidates: PendingAutoArchiveCandidate[];
};

// rc.5 TASK-010: read-side underseeded-corpus lint inspection (#22).
// Reports when the workspace's canonical knowledge node count is strictly
// less than `underseed_node_threshold` (default 10, override via
// .fabric/fabric-config.json#underseed_node_threshold). Mirrors the
// fabric-hint Stop hook's import-signal threshold so the two surfaces stay
// in lockstep — but the doctor lint is unconditional (no init-quiet /
// proposal-cooldown guards), since `doctor` is the user's deliberate check
// rather than an ambient nag.
type UnderseededInspection = {
  // Total canonical entry count across the five canonical type subdirs.
  node_count: number;
  // Effective threshold (config override or default).
  threshold: number;
  // True iff node_count < threshold. Pre-computed so createUnderseededCheck
  // does not have to re-derive the trigger predicate.
  underseeded: boolean;
};

// rc.6 TASK-021 (E3): session-hints cache hygiene. Lint #27 surfaces stale
// per-session cache files (`.fabric/.cache/session-hints-{id}.json`) whose
// mtime is older than the SESSION_HINTS_STALE_DAYS threshold (default 7d).
// Info-kind: cache files are local hot-cache, not git-tracked — accumulation
// is a hygiene concern, not a correctness break. The apply-lint arm deletes
// matched files via fs.unlink (no ledger event — see mutation kind comment).
type SessionHintsStaleCandidate = {
  // Project-relative POSIX path of the stale cache file (display + apply-lint
  // anchor). The apply-lint arm joins this back to projectRoot to unlink.
  path: string;
  // Age of the file (mtime delta) in whole days. Floor-rounded to keep the
  // signal coarse; sub-day precision adds noise without informational value.
  age_days: number;
};

type SessionHintsStaleInspection = {
  candidates: SessionHintsStaleCandidate[];
};

// rc.23 TASK-010 (e): stale `.fabric/.serve.lock` advisory. The lock is
// written by `acquireLock` at the top of `fabric serve` and removed by
// `releaseLock` on graceful shutdown; a SIGKILL / crash leaves the file
// behind, holding a dead PID. A subsequent `fabric serve` invocation then hits
// `ServeLockHeldError` with confusing 423 prose. Doctor surfaces a
// non-blocking info-kind advisory (`stale_serve_lock`) when the lock holds a
// dead PID, and `--fix` unlinks the corpse. `present=false` means no lock
// file (skip); `pidAlive=true` means a healthy `fabric serve` is running (skip).
type StaleServeLockInspection =
  | { present: false }
  | {
      present: true;
      pid: number;
      acquiredAt: number;
      ageMs: number;
      pidAlive: boolean;
    };

// rc.6 TASK-023 (E6): narrow_too_few — two-part check on narrow-scope KB
// hygiene. Inspection consolidates a structural ratio (how much of the
// canonical corpus is narrow-with-paths) with a telemetry-derived silence
// rate (how often the PreToolUse narrow hook fires with no match). Either
// arm independently can flag; both arms point at the same fabric-import
// recommendation (re-seed narrow anchors).
type NarrowTooFewInspection = {
  // Structural arm (Part A).
  total_canonical_entries: number;
  narrow_with_paths_count: number;
  narrow_ratio: number; // narrow_with_paths_count / total_canonical_entries, 0 when total === 0
  structural_flagged: boolean;
  // Telemetry arm (Part B).
  total_edit_fires_in_window: number;
  silence_fires_in_window: number;
  silence_rate: number; // silence/edit, 0 when edits === 0
  // True when we have insufficient data to evaluate Part B (e.g. no
  // edit-counter file or zero fires in window). UI surfaces this as
  // "skipped" rather than "passing".
  telemetry_skipped: boolean;
  telemetry_flagged: boolean;
};

// rc.5 TASK-013 (C4): read-side lint inspections #23/#24/#25 for relevance_paths
// hygiene. All three walk canonical entries (team + personal) and inspect the
// `relevance_scope` / `relevance_paths` frontmatter fields introduced by the
// TASK-012 narrow-scope model:
//
// #23 narrow_no_paths        — narrow entry with empty relevance_paths
//                              (silent recall risk: narrow + no anchors means
//                              the entry can never match a target_path).
// #24 relevance_paths_dangling — relevance_paths glob resolves to zero
//                              filesystem matches under the workspace root.
//                              Flag-only in rc.5; auto-prune deferred to rc.7+.
// #25 relevance_paths_drift  — narrow entry whose relevance_paths have not
//                              been touched in the recent git history window
//                              (90d). Heuristic; report-only.

type NarrowNoPathsCandidate = {
  stable_id: string;
  // Display path: project-relative POSIX for team layer; `~/.fabric/...`
  // for personal layer (matches PERSONAL_CONTENT_REF_PREFIX convention).
  path: string;
};

type NarrowNoPathsInspection = {
  candidates: NarrowNoPathsCandidate[];
};

type DanglingGlobEntry = {
  stable_id: string;
  path: string;
  // The exact glob string from the entry's relevance_paths array that
  // resolved to zero filesystem matches.
  dangling_glob: string;
};

type RelevancePathsDanglingInspection = {
  entries: DanglingGlobEntry[];
};

type RelevancePathsDriftCandidate = {
  stable_id: string;
  path: string;
  // All relevance_paths globs declared by the entry (preserved for the
  // message so operators can see which anchors are stale).
  globs: string[];
};

type RelevancePathsDriftInspection = {
  candidates: RelevancePathsDriftCandidate[];
  // True when git was unavailable / the call failed. The check downgrades to
  // an ok+info message in that case (rather than firing on every entry).
  git_available: boolean;
};

// rc.37 NEW-5: personal_layer_path_misclassify. Personal-layer entries
// (KP-*) live under ~/.fabric/knowledge/ and are meant to be project-agnostic.
// When a personal entry declares relevance_paths whose globs resolve against
// files in the CURRENT project, that's a misclassification signal — the
// content is project-bound and probably belongs in the team layer.
type PersonalLayerPathMisclassifyCandidate = {
  stable_id: string;
  // ~/.fabric/knowledge/... display form.
  path: string;
  // Subset of relevance_paths globs that matched files in the current project.
  matched_globs: string[];
};

type PersonalLayerPathMisclassifyInspection = {
  candidates: PersonalLayerPathMisclassifyCandidate[];
};

// rc.37 NEW-32: suspicious_kb_injection. Scans canonical KB body files
// (both layers) for the same prompt-injection patterns that
// extract-knowledge's sanitizer strips on archive (NEW-31). Legacy entries
// written before NEW-31 landed could carry surviving injection tokens —
// this check surfaces them so an operator can fab_review.modify or reject.
type SuspiciousKbCandidate = {
  stable_id: string;
  // ~/.fabric/... or project-relative POSIX path.
  path: string;
  // Subset of INJECTION_PATTERNS names that matched the body.
  patterns: string[];
};

type SuspiciousKbInspection = {
  candidates: SuspiciousKbCandidate[];
};

// rc.4 TASK-002: read-side integrity lint inspections (#19-21). Each
// inspection walks both the team-rooted (`<projectRoot>/.fabric/knowledge/`)
// and personal-rooted (`<FABRIC_HOME>/.fabric/knowledge/`) canonical trees
// and emits findings keyed off the path-decoupled stable_id parsed out of
// the canonical filename. Mutation half (counter bump for index-drift)
// lands in TASK-003 (--apply-lint). Stable-id-duplicate and layer-mismatch
// remain loud `error` kinds with no auto-fix — the right resolution is
// manual triage, not a deterministic doctor mutation.

type CanonicalLayer = "team" | "personal";

type StableIdDuplicateGroup = {
  stable_id: string;
  // Project-relative POSIX path for team entries; `~/.fabric/knowledge/...`
  // form for personal entries (mirrors knowledge-meta-builder content_ref shape).
  paths: string[];
};

type StableIdDuplicateInspection = {
  duplicates: StableIdDuplicateGroup[];
};

type LayerMismatchEntry = {
  // Display path: project-relative for team layer; `~/.fabric/...` for
  // personal layer. Stable across OSes.
  path: string;
  // The layer the file is physically located under.
  located_in: CanonicalLayer;
  // The layer encoded in the stable_id prefix (KT → team, KP → personal).
  expected_layer: CanonicalLayer;
  stable_id: string;
};

type LayerMismatchInspection = {
  mismatches: LayerMismatchEntry[];
};

type IndexDriftEntry = {
  // KP/KT prefix codes mirror agents.meta.json counters envelope keys.
  layer: "KP" | "KT";
  type: "MOD" | "DEC" | "GLD" | "PIT" | "PRO";
  // Counter currently recorded in agents.meta.json.counters[layer][type].
  // Treated as "highest already-allocated counter" — next allocate yields
  // counter+1 (see allocateKnowledgeId in shared/agents-meta.ts).
  counter: number;
  // Highest counter observed in canonical filenames for this (layer, type)
  // across both physical trees. The drift condition is `counter < max+1`,
  // i.e. there exists at least one canonical file whose counter exceeds the
  // meta envelope's record.
  max_observed: number;
  // Proposed `counters[layer][type]` value after the TASK-003 --apply-lint
  // mutation: `max_observed + 1`. Encoded explicitly so the proposal text is
  // machine-parseable without reapplying the +1 rule downstream.
  proposed_after: number;
};

type IndexDriftInspection = {
  drifts: IndexDriftEntry[];
};

// Inactivity thresholds (in days) keyed by maturity tier. Beyond this age with
// no fetch / promote / proposal event the entry is a demote candidate.
const ORPHAN_DEMOTE_THRESHOLD_DAYS: Record<LintMaturity, number> = {
  stable: 90,
  endorsed: 30,
  draft: 14,
};

// Additional inactivity (beyond the demote threshold) before a draft entry is
// a stale-archive candidate. Total quiet window for a born-draft entry is
// 14 + 90 = 104 days; for a previously-stable demoted entry the total is
// 90 + 90 + 90 = 270 days (stable → endorsed → draft → archive). The check
// only requires the *additional* 90d after entering draft, since orphan-demote
// is responsible for the prior tier transitions.
const STALE_ARCHIVE_ADDITIONAL_DAYS = 90;

// v2.0.0-rc.37 NEW-38: knowledge auto-promote. A canonical `draft` entry that
// has survived this many days WITHOUT being flagged drifted has "settled" —
// it stops inflating the draft_backlog metric by graduating draft → verified.
// 14d mirrors the draft orphan-demote threshold: an entry that outlives the
// demote window without going stale has demonstrated staying power.
const DRAFT_AUTO_PROMOTE_MIN_AGE_DAYS = 14;
// Reason prefix for the synthesized knowledge_promoted event emitted by the
// auto-promote --fix pass (parallels SYNTHESIZED_PROMOTED_REASON).
const AUTO_PROMOTED_REASON = "doctor auto-promote: draft settled ≥14d, no drift";

// Pending entries older than this threshold (based on frontmatter.created_at
// when present, otherwise file mtime) are flagged for human triage.
const PENDING_OVERDUE_THRESHOLD_DAYS = 14;

// rc.5 TASK-009 (B2): pending entries past this (deliberately higher) threshold
// are auto-archived by `doctor --apply-lint`. The overdue lint (#18) still
// fires at 14d; the auto-archive action only triggers after a further grace
// period, giving humans a 16-day review window from the first overdue ping.
// Threshold is currently a const — fabric-config.json override can land later
// if dogfood signals a different cadence.
const PENDING_AUTO_ARCHIVE_THRESHOLD_DAYS = 30;

// rc.5 TASK-010: default underseed threshold for lint #22 (knowledge_underseeded).
// Mirrors the fabric-hint hook's DEFAULT_UNDERSEED_NODE_THRESHOLD so the lint
// and the hook agree on the same floor unless the user overrides
// underseed_node_threshold in .fabric/fabric-config.json.
const DEFAULT_UNDERSEED_NODE_THRESHOLD = 10;

// rc.6 TASK-021 (E3): session-hints cache files older than this threshold
// are flagged by lint #27 (`knowledge_session_hints_stale`) and deleted by
// the apply-lint mutation arm. 7 days mirrors a typical work-week cadence —
// long enough that a paused-then-resumed session keeps its dedupe state,
// short enough that an abandoned session's cache file doesn't accrete.
const SESSION_HINTS_STALE_DAYS = 7;

// File-name prefix / suffix for session-hints cache files. The narrow hook
// (knowledge-hint-narrow.cjs) writes these under `.fabric/.cache/`. Keep
// the constants here aligned with the hook's SESSION_HINTS_FILE_PREFIX /
// SESSION_HINTS_FILE_SUFFIX — both surfaces MUST agree on the naming
// convention for the cleanup pass to identify the right files.
const SESSION_HINTS_FILE_PREFIX = "session-hints-";
const SESSION_HINTS_FILE_SUFFIX = ".json";

// rc.6 TASK-023 (E6): thresholds for lint #26 narrow_too_few. Hardcoded in
// rc.6 — a fabric-config.json override may land in rc.7+ if dogfood
// suggests a different cadence. The structural arm trips when the narrow-
// with-paths share of the corpus falls below the ratio threshold AND the
// corpus is large enough to expect targeting (total entries >= min). The
// telemetry arm trips when the rolling silence rate exceeds the threshold
// across a 30d window. Both arms point at the same fabric-import
// recommendation.
const NARROW_RATIO_THRESHOLD = 0.2;
const NARROW_MIN_TOTAL = 10;
const SILENCE_RATE_THRESHOLD = 0.95;
const SILENCE_WINDOW_DAYS = 30;

// File-name constants for the edit-counter and hint-silence-counter sidecars
// written by the PreToolUse narrow-injection hook (rc.6 TASK-020 / E4 and
// TASK-023 / E6). The hook keeps these as workspace-relative paths under
// `.fabric/.cache/`; doctor reads them back for lint #26's telemetry arm.
const EDIT_COUNTER_FILE_REL = posix.join(".fabric", ".cache", "edit-counter");
const HINT_SILENCE_COUNTER_FILE_REL = posix.join(
  ".fabric",
  ".cache",
  "hint-silence-counter",
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Regex extracting the `maturity:` value from YAML frontmatter. Mirrors
// extractKnowledgeFrontmatterId; we keep parsing line-based to avoid pulling
// in a YAML dependency for a handful of fields.
const MATURITY_LINE_PATTERN = /^maturity:\s*("?)(stable|endorsed|draft)\1\s*$/mu;

// Regex extracting `created_at:` (ISO 8601 datetime) from YAML frontmatter.
const CREATED_AT_LINE_PATTERN = /^created_at:\s*("?)([^"\n]+)\1\s*$/mu;

// rc.36 TASK-05 (P0-8 + P2-1): regex extracting `tags:` inline-array from YAML
// frontmatter (e.g. `tags: [foo, bar]`). Empty `tags: []` matches with body
// `""`; missing line returns null. We deliberately ignore block-style
// `tags:\n  - foo` since the canonical entries use inline arrays exclusively
// (per the schema in packages/shared/src/schemas/knowledge.ts).
const TAGS_LINE_PATTERN = /^tags:\s*\[(.*)\]\s*$/mu;

// rc.5 TASK-013 (C4): regexes extracting `relevance_scope` and
// `relevance_paths` from YAML frontmatter. Mirrors the line-based parsing
// style used elsewhere in this module (we avoid a YAML dependency for a
// handful of well-known fields). `relevance_paths` is a flow-style array
// (`[a, b, c]`) per the rc.5 contract; we tolerate empty arrays and
// whitespace around commas. Bare-strings are unquoted by convention but the
// parser accepts both quoted and unquoted forms.
const RELEVANCE_SCOPE_LINE_PATTERN = /^relevance_scope:\s*("?)(narrow|broad)\1\s*$/mu;
const RELEVANCE_PATHS_LINE_PATTERN = /^relevance_paths:\s*\[([^\]]*)\]\s*$/mu;

// rc.5 TASK-013 (C4): drift window for lint #25 (relevance_paths_drift).
// 90 days of git history. Hardcoded for rc.5 — a future
// .fabric/fabric-config.json override may land if dogfooding suggests a
// different cadence.
const RELEVANCE_PATHS_DRIFT_WINDOW_DAYS = 90;

// Reason prefix for synthesized knowledge_promoted events emitted by the
// filesystem-edit fallback check. The `[synthesized]` prefix makes these
// events grep-able in events.jsonl so consumers can distinguish them from
// real promotions emitted by fab_review.approve.
const SYNTHESIZED_PROMOTED_REASON = "[synthesized] filesystem-edit-fallback";

// Knowledge subdirectories scanned by the filesystem-edit fallback check.
// Mirrors KNOWLEDGE_SUBDIRS minus `pending` (the staging area for proposals
// that have not yet been approved).
const KNOWLEDGE_CANONICAL_TYPE_DIRS = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
] as const;

// Filename pattern for canonical knowledge entries: `<id>--<slug>.md`. The id
// half mirrors KNOWLEDGE_STABLE_ID_PATTERN in shared/agents-meta.ts. Files
// without the `--<slug>` suffix (e.g. `KT-DEC-0001.md`) are silently skipped
// — they predate the canonical convention and are not the manual-mv signal
// this check is targeting.
const CANONICAL_KNOWLEDGE_FILENAME_PATTERN =
  /^(K[PT]-(?:MOD|DEC|GLD|PIT|PRO)-\d{4,})--[a-z0-9][a-z0-9-]*\.md$/u;

const KNOWLEDGE_SUBDIRS = ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"] as const;

// v2.0.0-rc.22 TASK-006: baseline filename format hard-error lint.
//
// rc.23 TASK-012 (F8a) removed the baseline-emit pipeline; this lint
// remains as a defensive detector for any legacy baseline files that
// survive on disk in pre-rc.23 workspaces. Any stable_id NOT in this
// allowlist is treated as a user-promoted entry (e.g. KP-DEC-0001) and
// intentionally left untouched — only the historical deterministic
// baseline ids are subject to the filename invariant this lint enforces.
const BASELINE_FILENAME_LINT_BASELINE_IDS = new Set<string>([
  "KT-MOD-0001", // tech-stack
  "KT-MOD-0002", // module-structure
  "KT-MOD-0003", // readme-first-paragraph
  "KT-PRO-0001", // build-config
  "KT-PRO-0002", // ci-config
  "KT-GLD-0001", // code-style
]);

// Filename pattern for the canonical id-prefixed form. Files matching this
// pattern are already migrated and not flagged by this lint.
const BASELINE_ID_PREFIXED_FILENAME_PATTERN = /^KT-[A-Z]+-\d+--.+\.md$/u;

// Knowledge counter type-codes. Mirrors KNOWLEDGE_TYPE_CODES values in shared/api-contracts.
const COUNTER_TYPE_CODES = ["MOD", "DEC", "GLD", "PIT", "PRO"] as const;

const SCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([
  ".fabric",
  ".git",
  ".next",
  ".turbo",
  "Library",
  "Temp",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
// v2.0: bootstrap is anchored at the repo root (AGENTS.md / CLAUDE.md), and
// v1.x bootstrap artifacts are no longer authoritative. The summary.targetFiles
// map is intentionally additive — we keep it focused on top-level Fabric
// state files.
//
// Note: `.fabric/init-context.json` is intentionally NOT listed here. v2.0
// init-context is owned by the AI-side client init skill (Claude Code / Codex
// CLI), not by `fabric install` CLI. If the skill never ran the file is
// legitimately absent and doctor must not flag it as a state issue.
const TARGET_FILE_PATHS = [
  ".fabric/forensic.json",
  ".fabric/agents.meta.json",
  ".fabric/.cache/knowledge-test.index.json",
  ".fabric/events.jsonl",
  ".fabric/knowledge",
  // v2.0.0-rc.19 bootstrap-consolidation TASK-005: L1 canonical snapshot
  // (.fabric/AGENTS.md) and optional project-rules concat source
  // (.fabric/project-rules.md). Surfaced in summary.targetFiles so --json
  // consumers can confirm L1 presence at a glance.
  ".fabric/AGENTS.md",
  ".fabric/project-rules.md",
] as const;

export async function runDoctorReport(target: string): Promise<DoctorReport> {
  const projectRoot = normalizeTarget(target);
  const t = createTranslator(resolveFabricLocale(projectRoot));
  const framework = detectFramework(projectRoot);
  const entryPoints = collectEntryPoints(projectRoot);
  const [
    forensic,
    meta,
    eventLedger,
    eventsJsonlGates,
    knowledgeTestIndex,
    bootstrapMarkerMigration,
    l1BootstrapSnapshotDrift,
    l2ManagedBlockDrift,
  ] = await Promise.all([
    inspectForensic(projectRoot),
    inspectMeta(projectRoot),
    inspectEventLedger(projectRoot),
    // v2.0.0-rc.37 Wave B (B5): composite hard-gate inspection (G7 size /
    // G8 metric leak / G9 metrics stale / G10 rotation overdue).
    inspectEventsJsonlGates(projectRoot),
    inspectKnowledgeTestIndex(projectRoot),
    // v2.0.0-rc.19 TASK-004: one-time fabric:knowledge-base → fabric:bootstrap
    // marker migration scan. Inspect runs in this Promise.all block to keep
    // performance parity with the other I/O-bound inspections.
    inspectBootstrapMarkerMigration(projectRoot),
    // v2.0.0-rc.19 TASK-005: L1 + L2 byte-level drift detection. Both are
    // I/O-bound (small file reads + buffer compare) so they live in the same
    // Promise.all block as the other bootstrap inspections.
    inspectL1BootstrapSnapshotDrift(projectRoot),
    inspectL2ManagedBlockDrift(projectRoot),
  ]);
  const mcpConfigInWrongFile = inspectMcpConfigInWrongFile(projectRoot);
  // v2.0.0-rc.28 TASK-04 (audit §3.1): SKILL ref/ mirror parity check.
  // Pure-sync (readdirSync + readFileSync), so it lives outside the
  // Promise.all block.
  const skillRefMirror = inspectSkillRefMirror(projectRoot);
  // v2.0.0-rc.33 W3-6 (P1-13): SKILL.md token budget. Pure-sync (readFileSync
  // + Math.ceil), so it joins the synchronous inspection block above.
  const skillTokenBudget = inspectSkillTokenBudget(projectRoot);
  // v2.0.0-rc.33 W3-7 (P1-14): SKILL.md description structural lint
  // (deterministic proxy for trigger-recall — see type docstring).
  const skillDescription = inspectSkillDescription(projectRoot);
  // v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart pattern detection. Async
  // (reads event ledger); placed after the sync inspections so the await
  // doesn't gate them.
  const citeGoodhart = await inspectCiteGoodhart(projectRoot);
  // v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog ratio (sync, disk-only).
  const draftBacklog = inspectDraftBacklog(projectRoot);
  // rc.37 NEW-38: auto-promote candidates (info surface; --fix does the work).
  const draftAutoPromote = await inspectDraftAutoPromote(projectRoot);
  // rc.36 TASK-05 (P0-8): empty-tags ratio across canonical entries.
  const knowledgeTagsEmpty = inspectKnowledgeTagsEmpty(projectRoot);
  // rc.36 TASK-09 (P1-NEW1): drift_detected events without paired demote
  // in the last 30 days — drift detection runs but no consumption pipeline.
  const driftUnconsumed = await inspectDriftUnconsumed(projectRoot);
  const metaManuallyDiverged = await inspectMetaManuallyDiverged(projectRoot);
  const knowledgeDirUnindexed = inspectKnowledgeDirUnindexed(projectRoot, meta);
  const knowledgeDirMissing = inspectKnowledgeDirMissing(projectRoot);
  // v2.0.0-rc.22 TASK-006: baseline filename format hard error. Detects
  // legacy bare-slug baseline files. rc.23 TASK-012 (F8a) deleted the
  // baseline-emit pipeline outright, so the lint now serves only as a
  // forensic indicator for stale pre-rc.23 workspaces; resolution is
  // manual deletion of the offending file. manual_error kind, no --fix path.
  const baselineFilenameFormat = inspectBaselineFilenameFormat(projectRoot);
  const stableIdCollision = await inspectStableIdCollisions(projectRoot);
  const counterDesync = inspectCounterDesync(meta);
  const preexistingRootFiles = inspectPreexistingRootFiles(projectRoot);
  const bootstrapAnchor = inspectBootstrapAnchor(projectRoot);
  // rc.3 TASK-005: filesystem-edit fallback. Synthesizes knowledge_promoted
  // for canonical entries with no matching event. Runs AFTER ledger
  // partial-write detection so we never append to a corrupt tail; it relies
  // on the existing read/append machinery to be in a consistent state.
  const filesystemEditFallback = eventLedger.exists && eventLedger.writable && eventLedger.parseable
    ? await inspectFilesystemEditFallback(projectRoot)
    : { synthesized: 0, synthesizedStableIds: [] };
  // rc.4 TASK-001: read-side lint inspections (#16-18). These run after the
  // filesystem-edit fallback (which can append synthesized knowledge_promoted
  // events) so that the lastActiveAt index built by orphan-demote and
  // stale-archive sees the synthesized timestamps and does not double-count
  // a freshly-synthesized canonical entry as orphan.
  const lintNow = Date.now();
  const orphanDemote = await inspectOrphanDemote(projectRoot, lintNow);
  const staleArchive = await inspectStaleArchive(projectRoot, lintNow);
  const pendingOverdue = inspectPendingOverdue(projectRoot, lintNow);
  // rc.4 TASK-002: read-side integrity inspections (#19-21). Independent of
  // lintNow — these inspect filesystem layout / id allocation invariants
  // rather than time-based maturity thresholds.
  const stableIdDuplicate = inspectStableIdDuplicate(projectRoot);
  const layerMismatch = inspectLayerMismatch(projectRoot);
  const indexDrift = inspectIndexDrift(projectRoot, meta);
  // rc.5 TASK-010: read-side underseeded-corpus inspection (#22). Independent
  // of lintNow — corpus size is a synchronous filesystem count, not a
  // time-decayed signal. Runs alongside the rc.4 integrity inspections so the
  // report surfaces all corpus-level findings adjacent to one another.
  const underseeded = inspectUnderseeded(projectRoot);
  // rc.5 TASK-013 (C4): relevance_paths hygiene inspections #23/#24/#25. All
  // three walk canonical entries (team + personal) and inspect frontmatter
  // relevance fields. #24 expands globs against the live filesystem; #25
  // shells out to `git log` for the drift heuristic (degrades to ok+info
  // when git is unavailable). Flag-only in rc.5 — apply-lint auto-prune
  // deferred to rc.7+.
  const narrowNoPaths = inspectNarrowNoPaths(projectRoot);
  const relevancePathsDangling = inspectRelevancePathsDangling(projectRoot);
  const relevancePathsDrift = inspectRelevancePathsDrift(projectRoot);
  // rc.37 NEW-5: personal-layer entries whose relevance_paths match files in
  // the current project — signals layer misclassification (content is
  // project-bound, should be team-layer).
  const personalLayerPathMisclassify = inspectPersonalLayerPathMisclassify(projectRoot);
  // rc.37 NEW-32: scan canonical KB bodies for prompt-injection patterns
  // (legacy entries archived before NEW-31's sanitizer landed).
  const suspiciousKb = inspectSuspiciousKb(projectRoot);
  // rc.6 TASK-023 (E6): narrow_too_few (#26). Two-arm check — structural
  // ratio + telemetry silence rate. Info-kind; safe-degrades to "skipped"
  // telemetry when the edit-counter has no fires in the 30d window.
  const narrowTooFew = inspectNarrowTooFew(projectRoot, lintNow);
  // rc.6 TASK-021 (E3): session-hints cache hygiene (#27). Scans
  // `.fabric/.cache/` for session-hints-*.json files older than 7 days
  // (mtime-based). Info kind — does not bump report status. apply-lint
  // reaps matched files via unlink (no ledger event; local hot-cache).
  const sessionHintsStale = inspectSessionHintsStale(projectRoot, lintNow);
  // rc.23 TASK-010 (e): stale .fabric/.serve.lock advisory. Read-side only —
  // mutation (unlink + ledger event) is owned by runDoctorFix. Re-uses the
  // same lintNow timestamp as the other read-side hygiene inspections so a
  // single doctor run reports an internally-consistent set of age figures.
  const staleServeLock = inspectStaleServeLock(projectRoot, lintNow);
  // v2.0.0-rc.9 TASK-003 (A3): relevance fields back-fill (#28). Scans the
  // pending tree (both layers) for entries whose frontmatter is missing
  // `relevance_scope` and/or `relevance_paths`. Info kind — back-fill is
  // hygiene, not correctness (meta-builder falls back to the schema
  // defaults at read time). apply-lint writes the explicit defaults and
  // emits one aggregate `relevance_migration_run` event per run.
  const relevanceFieldsMissing = inspectRelevanceFieldsMissing(projectRoot);
  // rc.12 lint #29: skill_md_yaml_invalid. Scans .claude/skills and
  // .codex/skills SKILL.md frontmatter for unquoted ': ' tokens that Codex's
  // strict YAML parser rejects (Claude Code is lenient). Warning kind —
  // manual fix only.
  const skillMdYamlInvalid = inspectSkillMdYamlInvalid(projectRoot);
  // v2.0.0-rc.23 TASK-014 (F8c): onboard-coverage advisory. Info kind —
  // does not bump report status. Mirrors the fabric onboard-coverage CLI
  // scanner; reports which of the 5 S5 slots are unclaimed and recommends
  // /fabric-archive (whose first-run phase tours the project and proposes
  // pending entries with `onboard_slot: <slot>` set).
  const onboardCoverage = inspectOnboardCoverage(projectRoot);
  // rc.31 BUG-M3/NEW-4: hooks_wired observability. Reads project-local
  // .claude/settings.json and verifies the three fabric Stop / SessionStart
  // / PreToolUse hooks are present. Warns when .claude/ exists (project uses
  // Claude Code) but hook references are missing — install ran but stopped
  // short, or partial-install left dangling artifacts. Skipped (ok) when
  // there is no .claude/ at all (project doesn't use Claude Code).
  const hooksWired = inspectHooksWired(projectRoot);
  // v2.0.0-rc.37 NEW-20: hooks_runtime closes the gap below hooks_wired —
  // shebang + Node.js syntax validity of each installed .cjs hook file.
  const hooksRuntime = inspectHooksRuntime(projectRoot);
  // v2.0.0-rc.37 NEW-27: hooks_content_drift — cross-client sha256 parity
  // for the same hook basename across .claude/.codex/.cursor.
  const hooksContentDrift = inspectHooksContentDrift(projectRoot);
  // rc.31 BUG-G2/G5: promote-ledger invariant check (proposed >= started >= promoted).
  // Surfaces ledger desync (e.g. werewolf-minigame rc.30 audit: proposed=17,
  // started=48, promoted=52). Warning kind — does not bump report status to
  // error; emit-cadence in extract / approve owns the actual fix. Skipped when
  // the ledger is unparseable so the check never amplifies an existing read
  // failure already surfaced by event_ledger_partial_write / schema_compat.
  const promoteLedgerInvariant = eventLedger.exists && eventLedger.writable && eventLedger.parseable
    ? await inspectPromoteLedgerInvariant(projectRoot)
    : null;
  // rc.35 TASK-04 (P0-9.b): global CLI version probe. Spawns `fabric -v` and
  // compares against MIN_SUPPORTED_GLOBAL_CLI_VERSION (rc.31 — the schema fix
  // point). Synchronous spawn; runs outside the Promise.all block. ENOENT
  // / parse failure both degrade to warn (never blocks doctor).
  //
  // Under vitest the host's actual global CLI is non-deterministic, so the
  // lint reports "ok" by default. The inspect function itself is exercised
  // with an injected spawn in doctor-global-cli.test.ts.
  const globalCliVersion: GlobalCliInspection = process.env.VITEST === "true"
    ? { status: "ok", version: "test-skipped" }
    : inspectGlobalCliVersion();
  const checks: DoctorCheck[] = [
    createBootstrapAnchorCheck(t, bootstrapAnchor),
    // v2.0.0-rc.19 TASK-004: bootstrap marker migration check sits adjacent to
    // the anchor check — both are bootstrap-file invariants. fixable_error
    // when any of the four target paths still carries the legacy marker.
    createBootstrapMarkerMigrationCheck(t, bootstrapMarkerMigration),
    // v2.0.0-rc.19 TASK-005: L1 + L2 byte-level drift detection sit immediately
    // after the marker migration check. Order: anchor existence → migration →
    // L1 (canonical ↔ snapshot) → L2 (snapshot+rules ↔ three-end blocks).
    createL1BootstrapSnapshotDriftCheck(t, l1BootstrapSnapshotDrift),
    createL2ManagedBlockDriftCheck(t, l2ManagedBlockDrift),
    createKnowledgeDirMissingCheck(t, knowledgeDirMissing),
    // v2.0.0-rc.22 TASK-006: baseline filename format. Sits adjacent to
    // knowledge_dir_missing — both are knowledge-layout invariants. manual_error
    // kind; resolution is manual file deletion (rc.23 TASK-012 (F8a) removed
    // the baseline-emit pipeline, so no auto-fix exists).
    createBaselineFilenameFormatCheck(t, baselineFilenameFormat),
    createForensicCheck(t, forensic, framework.kind, entryPoints.length),
    // v2.0: removed `createInitContextCheck` — `.fabric/init-context.json`
    // is owned by the AI-side client init skill, not by `fabric install` CLI.
    // The file's absence is a legitimate post-init state when the skill has
    // not yet run, so flagging it as a doctor manual_error misrepresents
    // ownership.
    createMetaCheck(t, meta, globalCliVersion),
    createRuleContentRefCheck(t, meta),
    // v2.0 / rc.2: `createRuleSectionsCheck` removed — it parsed v1.x
    // [MANDATORY_INJECTION] sections out of legacy rule files, a structural
    // concept that has no v2 equivalent. rc.4 will introduce a dedicated v2
    // lint suite for the new knowledge frontmatter contract.
    createKnowledgeTestIndexCheck(t, knowledgeTestIndex),
    createEventLedgerCheck(t, eventLedger),
    createEventLedgerPartialWriteCheck(t, eventLedger),
    createEventsJsonlHealthCheck(t, eventsJsonlGates),
    // v2.0.0-rc.27 TASK-010 (audit §2.24): forward-compat warning surface for
    // events.jsonl rows that fail Zod validation because of unknown
    // schema_version or event_type tokens. Previously silently dropped.
    createEventLedgerSchemaCompatCheck(t, eventLedger),
    // v2.0.0-rc.28 TASK-04 (audit §3.1 follow-up): SKILL ref/ mirror parity.
    // Detects hand-edits or partial install that breaks the byte-identical
    // contract between .claude/skills/<slug>/ref/ and .codex/skills/<slug>/
    // ref/. warning severity — fabric install restores parity.
    createSkillRefMirrorCheck(t, skillRefMirror),
    createSkillTokenBudgetCheck(t, skillTokenBudget),
    createSkillDescriptionCheck(t, skillDescription),
    createCiteGoodhartCheck(t, citeGoodhart),
    createDraftBacklogCheck(t, draftBacklog),
    createDraftAutoPromoteCheck(t, draftAutoPromote),
    createKnowledgeTagsEmptyCheck(t, knowledgeTagsEmpty),
    createDriftUnconsumedCheck(t, driftUnconsumed),
    createMcpConfigInWrongFileCheck(t, mcpConfigInWrongFile),
    createMetaManuallyDivergedCheck(t, metaManuallyDiverged),
    createKnowledgeDirUnindexedCheck(t, knowledgeDirUnindexed),
    createStableIdCollisionCheck(t, stableIdCollision),
    createCounterDesyncCheck(t, counterDesync),
    createFilesystemEditFallbackCheck(t, filesystemEditFallback),
    // rc.4 TASK-001: read-side lint checks #16-18. Findings only — mutation
    // + event emission lands in TASK-003 behind --apply-lint.
    createOrphanDemoteCheck(t, orphanDemote),
    createStaleArchiveCheck(t, staleArchive),
    createPendingOverdueCheck(t, pendingOverdue),
    // rc.4 TASK-002: read-side integrity checks #19-21. Stable_id duplicate
    // runs first in this trio — it is the most critical integrity break and
    // surfaces ahead of layer-mismatch / index-drift in the report so a
    // human operator triages the collision before reasoning about counter
    // state. Index drift is the only fixable_error of the three; stable_id
    // duplicate and layer mismatch require manual triage (rename / move).
    createStableIdDuplicateCheck(t, stableIdDuplicate),
    createLayerMismatchCheck(t, layerMismatch),
    createIndexDriftCheck(t, indexDrift),
    // rc.5 TASK-010: read-side underseeded-corpus check (#22). Info kind —
    // does not bump report status. Recommends running the fabric-import skill
    // to backfill knowledge when the corpus is below the threshold floor.
    createUnderseededCheck(t, underseeded),
    // rc.5 TASK-013 (C4): relevance_paths hygiene checks #23/#24/#25.
    // All three are flag-only in rc.5 (no apply-lint mutations).
    //   #23 narrow_no_paths        — warning kind (silent recall risk)
    //   #24 relevance_paths_dangling — warning kind (glob → zero matches)
    //   #25 relevance_paths_drift  — info kind (git-log heuristic; noisy)
    createNarrowNoPathsCheck(t, narrowNoPaths),
    createRelevancePathsDanglingCheck(t, relevancePathsDangling),
    createRelevancePathsDriftCheck(t, relevancePathsDrift),
    // rc.37 NEW-5: personal-layer path misclassification advisory. Sits in
    // the relevance_paths hygiene cluster — same iterator, same path-glob
    // matcher, warning kind (no auto-fix; remediation is fab_review modify
    // layer flip to team).
    createPersonalLayerPathMisclassifyCheck(t, personalLayerPathMisclassify),
    // rc.37 NEW-32: suspicious_kb_injection — scan canonical bodies for
    // prompt-injection tokens. Symmetric with NEW-31's archive-time
    // sanitization; catches legacy pre-NEW-31 entries. Warning kind.
    createSuspiciousKbCheck(t, suspiciousKb),
    // rc.6 TASK-023 (E6): narrow_too_few (lint #26). Info kind; both arms
    // (structural + telemetry) recommend the same fabric-import action.
    createNarrowTooFewCheck(t, narrowTooFew),
    // rc.6 TASK-021 (E3): session-hints cache hygiene (lint #27). Info kind.
    createSessionHintsStaleCheck(t, sessionHintsStale),
    // rc.23 TASK-010 (e): stale .fabric/.serve.lock advisory. Info kind —
    // does not bump report status. `--fix` unlinks the corpse and emits
    // `serve_lock_cleared`.
    createStaleServeLockCheck(t, staleServeLock),
    // v2.0.0-rc.9 TASK-003 (A3): relevance fields back-fill (lint #28).
    // Info kind — applies to pending entries only; canonical entries get
    // the fields written verbatim by fab_review.approve/modify.
    createRelevanceFieldsMissingCheck(t, relevanceFieldsMissing),
    // rc.12 lint #29: skill_md_yaml_invalid. Warning kind — surfaces
    // SKILL.md frontmatter that Codex CLI silently drops at load.
    createSkillMdYamlInvalidCheck(t, skillMdYamlInvalid),
    // v2.0.0-rc.23 TASK-014 (F8c): Onboard coverage advisory. Info kind.
    // Surfaces uncovered S5 onboard slots and recommends /fabric-archive
    // first-run phase. Sits adjacent to Skill markdown YAML — both are
    // Skill-adjacent advisories. --fix never mutates onboard state.
    createOnboardCoverageCheck(t, onboardCoverage),
    // rc.31 BUG-M3/NEW-4: hooks_wired observability. Adjacent to onboard /
    // promote-ledger checks — all three are install/runtime-state advisories.
    createHooksWiredCheck(t, hooksWired),
    createHooksRuntimeCheck(t, hooksRuntime),
    createHooksContentDriftCheck(t, hooksContentDrift),
    // rc.35 TASK-04 (P0-9.b): global CLI version probe — surfaces rc.30 PATH
    // installs against rc.31+ project schemas (the silent-hooks fault mode).
    // Sits next to hooks_wired since both lints diagnose runtime install state.
    createGlobalCliVersionCheck(t, globalCliVersion),
    // rc.35 TASK-05 (P0-10.a): opaque-summary ratio — surfaces the
    // werewolf-eval failure mode where description.summary == stable_id so
    // hint output is "KT-PIT-0001 · KT-PIT-0001" (AI skips fetch). Built
    // from the same MetaInspection so no extra disk reads.
    createKnowledgeSummaryOpaqueCheck(t, inspectKnowledgeSummaryOpaque(meta)),
    // rc.31 BUG-G2/G5: promote-ledger invariant. Sits adjacent to onboard
    // coverage — both are observability advisories built off events.jsonl.
    ...(promoteLedgerInvariant === null
      ? []
      : [createPromoteLedgerInvariantCheck(t, promoteLedgerInvariant)]),
    createPreexistingRootFilesCheck(t, preexistingRootFiles),
    // v2.0 / rc.2: `createLegacyClientPathCheck` removed. The schema now
    // rejects retired clientPaths keys (windsurf/rooCode/geminiCLI) at Zod
    // parse time, so the soft-deprecation warn-and-fix path no longer has a
    // reachable input — fabric.config.json with a retired key fails before
    // doctor ever inspects it.
    // v2.0 / rc.2: `createLegacyV1ArtifactsCheck` removed alongside its
    // path-list constant. The visibility-only warning referenced v1.x
    // artifacts that are now archaeology. rc.4 owns v2 lint coverage; on a
    // clean v2 install nothing is lost since the check fired only when v1
    // artifacts remained.
  ];
  const fixableErrors = collectIssues(checks, "fixable_error");
  const manualErrors = collectIssues(checks, "manual_error");
  const warnings = collectIssues(checks, "warning");
  const infos = collectIssues(checks, "info");

  return {
    status: reduceStatus(checks.map((check) => check.status)),
    checks,
    fixable_errors: fixableErrors,
    manual_errors: manualErrors,
    warnings,
    infos,
    summary: {
      target: projectRoot,
      framework: {
        kind: framework.kind,
        version: framework.version,
        subkind: framework.subkind,
      },
      entryPoints,
      metaRevision: meta.revision,
      computedMetaRevision: meta.computedRevision,
      ruleCount: meta.ruleCount,
      eventLedgerPath: eventLedger.path,
      fixableErrorCount: fixableErrors.length,
      manualErrorCount: manualErrors.length,
      warningCount: warnings.length,
      infoCount: infos.length,
      targetFiles: Object.fromEntries(
        TARGET_FILE_PATHS.map((path) => [path, existsSync(join(projectRoot, path))]),
      ),
      // v2.0.0-rc.29 TASK-008 (BUG-F2): resolve and surface payload thresholds.
      // Best-effort: a corrupt fabric.config.json should not fail doctor; on
      // any read/parse error fall back to library defaults with source="default".
      payload_limits: resolvePayloadLimits(projectRoot),
      // v2.2 A14-doctor-health (W3-T4): 0-100 KB health rollup over the lint set.
      health: computeDoctorHealth(manualErrors.length, fixableErrors.length, warnings.length),
    },
  };
}

// v2.0.0-rc.29 TASK-008 (BUG-F2): translate the optional override block into
// the doctor-surface shape, recording whether any override actually moved the
// needle (`source: "config"`) or both values came from the library default.
function resolvePayloadLimits(projectRoot: string): DoctorPayloadLimits {
  let override: { warnBytes?: number; hardBytes?: number } | undefined;
  try {
    override = readPayloadLimits(projectRoot);
  } catch {
    override = undefined;
  }
  const warn = override?.warnBytes ?? PAYLOAD_LIMIT_DEFAULT_WARN_BYTES;
  const hard = override?.hardBytes ?? PAYLOAD_LIMIT_DEFAULT_HARD_BYTES;
  const source: "default" | "config" =
    override?.warnBytes !== undefined || override?.hardBytes !== undefined ? "config" : "default";
  return { warn_bytes: warn, hard_bytes: hard, source };
}

export async function runDoctorFix(target: string): Promise<DoctorFixReport> {
  const projectRoot = normalizeTarget(target);
  const before = await runDoctorReport(projectRoot);
  const fixed: DoctorIssue[] = [];

  // v2.0.0-rc.19 bootstrap-consolidation TASK-004: marker migration runs FIRST
  // so subsequent L1/L2 drift checks (TASK-05) see the post-rename state. One
  // ledger event is appended per rewritten file as a best-effort write —
  // failures are swallowed (.catch(() => {})) so a disk-full / permission
  // error on the ledger does not roll back the file rewrite.
  if (
    before.fixable_errors.some(
      (issue) => issue.code === "bootstrap_marker_migration_required",
    )
  ) {
    const migrated = await migrateBootstrapMarkers(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "bootstrap_marker_migration_required"));
    for (const path of migrated.paths) {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "bootstrap_marker_migrated",
        path,
        migrated_count: migrated.countPerPath[path] ?? 1,
        legacy_marker: "fabric:knowledge-base",
        new_marker: "fabric:bootstrap",
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    }
  }

  // v2.0.0-rc.19 bootstrap-consolidation TASK-005: L1 drift fix MUST run before
  // L2 fix — L2's expectedBody is computed from the on-disk `.fabric/AGENTS.md`
  // snapshot, so restoring L1 to canonical first guarantees L2's rewrite
  // sources the correct body. Idempotent: `atomicWriteText` with content
  // byte-equal to current state still writes (acceptable — re-runs with no
  // L1 drift entry skip this whole block via the .some() guard).
  if (before.fixable_errors.some((issue) => issue.code === "bootstrap_snapshot_drift")) {
    const snapshotPath = join(projectRoot, ".fabric", "AGENTS.md");
    await ensureParentDirectory(snapshotPath);
    await atomicWriteText(snapshotPath, BOOTSTRAP_CANONICAL);
    fixed.push(findIssue(before.fixable_errors, "bootstrap_snapshot_drift"));
  }

  // v2.0.0-rc.19 bootstrap-consolidation TASK-005: L2 drift fix replays the
  // three-end managed block writes from the now-canonical `.fabric/AGENTS.md`
  // (+ optional project-rules concat). See `rewriteThreeEndManagedBlocks` for
  // the inline regex+replace logic — duplicated from the install-side writers
  // (TASK-003) to preserve the cross-package boundary (packages/server has
  // zero dep on packages/cli).
  if (before.fixable_errors.some((issue) => issue.code === "managed_block_drift")) {
    await rewriteThreeEndManagedBlocks(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "managed_block_drift"));
  }

  if (before.fixable_errors.some((issue) => issue.code === "knowledge_dir_missing")) {
    await ensureKnowledgeSubdirs(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "knowledge_dir_missing"));
  }

  if (before.fixable_errors.some((issue) => issue.code === "event_ledger_missing")) {
    await ensureEventLedger(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "event_ledger_missing"));
  }

  // counter_desync MUST run before reconcileKnowledge: the counters envelope is
  // preserved verbatim across a reconcile rebuild (knowledge-meta-builder copies
  // `previousMeta.counters` through), so bumping first means the correction
  // survives even when reconcile rewrites the nodes graph.
  if (before.fixable_errors.some((issue) => issue.code === "counter_desync")) {
    await fixCounterDesync(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "counter_desync"));
    contextCache.invalidate("meta_write", projectRoot);
  }

  // rc.22 TASK-012: agents_meta_stale is now a `warning` tier (engine
  // auto-heals on next MCP call), but `fabric doctor --fix` must still reconcile
  // it explicitly. We look in both `fixable_errors` and `warnings` so the
  // demotion doesn't break the existing fix-path.
  //
  // v2.0.0-rc.27 TASK-004 (audit §2.14): `meta_manually_diverged` added.
  // Before rc.27 this warning surfaced a remediation message that said "run
  // fabric doctor --fix" but the --fix arm took no reconcile path — the warning
  // remained on every subsequent run (self-referential loop documented in
  // audit §2.14). reconcileKnowledge rebuilds nodes from disk ground-truth
  // so dangling meta entries (nodes for which no file exists) are dropped
  // and hash-mismatch entries get fresh hashes.
  // rc.31 NEW-3: `agents_meta_invalid` joins reconcileCodes so doctor --fix
  // unblocks the double-error deadlock with `knowledge_dir_unindexed` (which
  // sits in fixable_errors but couldn't run while invalid meta blocked it).
  // Paired with rc.31 NEW-1 (schema z.preprocess for singular knowledge_type)
  // the load layer now tolerates legacy values, and reconcile rewrites the
  // on-disk file in the canonical plural form — so a single --fix invocation
  // is sufficient. The check also looks in `manual_errors` because invalid
  // meta is currently classified as `manual_error` in runDoctorReport.
  const reconcileCodes = [
    "agents_meta_missing",
    "agents_meta_stale",
    "agents_meta_invalid",
    "knowledge_test_index_missing",
    "knowledge_test_index_stale",
    "content_ref_missing",
    "knowledge_dir_unindexed",
    "meta_manually_diverged",
  ];
  if (
    before.fixable_errors.some((issue) => reconcileCodes.includes(issue.code))
    || before.warnings.some((issue) => reconcileCodes.includes(issue.code))
    || before.manual_errors.some((issue) => reconcileCodes.includes(issue.code))
  ) {
    // D22: doctor's role is now consistency repairer, not baseline promoter.
    // reconcileKnowledge rewrites agents.meta.json from disk ground-truth and emits
    // a 'meta_reconciled' ledger event (trigger='doctor').
    // content_ref_missing: reconcile drops stale refs that no longer have a backing file.
    // knowledge_dir_unindexed: reconcile incorporates any .md files not yet in the index.
    await reconcileKnowledge(projectRoot, { trigger: "doctor" });
    for (const issue of before.fixable_errors.filter((candidate) =>
      reconcileCodes.includes(candidate.code),
    )) {
      fixed.push(issue);
    }
    for (const issue of before.warnings.filter((candidate) =>
      reconcileCodes.includes(candidate.code),
    )) {
      fixed.push(issue);
    }
    // rc.31 NEW-3: also record manual_error → fixed transitions so the
    // doctor --fix exit-status / remaining_manual_errors reflect reality.
    for (const issue of before.manual_errors.filter((candidate) =>
      reconcileCodes.includes(candidate.code),
    )) {
      fixed.push(issue);
    }
    contextCache.invalidate("meta_write", projectRoot);

    // Post-reconcile counter sync: reconcileKnowledge carries over previousMeta.counters
    // verbatim (knowledge-meta-builder never bumps counters during indexing). If any
    // newly-indexed knowledge file declared a stable_id whose counter exceeds the
    // preserved envelope, the counters are now desynced. Fix that here so a single
    // `doctor --fix` invocation is sufficient — the caller does not need to run
    // --fix twice to get consistent state.
    await fixCounterDesync(projectRoot);
    contextCache.invalidate("meta_write", projectRoot);
  }

  if (before.fixable_errors.some((issue) => issue.code === "event_ledger_partial_write")) {
    const ledgerPath = getEventLedgerPath(projectRoot);
    const truncResult = await truncateLedgerToLastNewline(ledgerPath);
    await appendEventLedgerEvent(projectRoot, {
      event_type: "event_ledger_truncated",
      byte_offset: truncResult.truncated_bytes,
      byte_length: truncResult.truncated_bytes,
      corrupted_path: truncResult.corrupted_path,
    });
    fixed.push(findIssue(before.fixable_errors, "event_ledger_partial_write"));
  }

  // v2.0.0-rc.39: cite-audit rollup. Runs BEFORE rotation so it captures the
  // compliance signal of EVERY assistant_turn_observed older than the cite
  // window (7d) — including turns 7-30d old that rotation would otherwise leave,
  // AND turns >30d that rotation would archive raw without ever rolling up.
  // Idempotent: no rollable turn → no-op. Drops rolled-up turns (archived),
  // bounding events.jsonl near the cite window. Best-effort: a failure here
  // must not block the rest of --fix, so it is wrapped.
  try {
    const rollup = await rollupCiteAuditIfNeeded(projectRoot);
    if (rollup.turns_dropped > 0) {
      fixed.push({
        code: "cite_audit_rolled_up",
        name: "Cite-audit rolled up",
        message: `Rolled up ${rollup.turns_dropped} assistant turn(s) across ${rollup.days_rolled_up} day(s) into cite-rollup.jsonl and dropped them from the main ledger`,
      });
    }
  } catch {
    // rollup is best-effort hygiene; never block --fix on it.
  }

  // v2.0.0-rc.39 (P1 emit-fold): fold the EXISTING empty-shell backlog. Runs
  // after the rollup so it only touches the live-window (<7d) empties the rollup
  // left raw. Best-effort: a failure must not block the rest of --fix.
  try {
    const purge = await purgeEmptyShellTurnsIfNeeded(projectRoot);
    if (purge.turns_folded > 0) {
      fixed.push({
        code: "empty_shell_turns_folded",
        name: "Empty-shell turns folded",
        message: `Folded ${purge.turns_folded} empty-shell assistant turn(s) into ${purge.groups_written} metrics.jsonl counter row(s) and dropped them from the main ledger`,
      });
    }
  } catch {
    // emit-fold purge is best-effort hygiene; never block --fix on it.
  }

  // v2.0.0-rc.22 Scope A T4: unconditional sliding-window rotation step. This
  // is hygiene, not error correction — there is no `doctor` check that gates
  // it, so `rotateEventLedgerIfNeeded` runs on every `--fix` invocation. It
  // is idempotent: when no line satisfies `ts < cutoff` it returns
  // `{ rotated: false, archivedCount: 0 }` and the main file is untouched.
  // We synthesize a `fixed[]` entry ONLY when `archivedCount > 0` so a no-op
  // re-run does not pollute the report. Placed after
  // `event_ledger_partial_write` so rotation always operates on a
  // newline-terminated main ledger (no partial-tail edge cases).
  const rotateResult = await rotateEventLedgerIfNeeded(projectRoot);
  if (rotateResult.rotated && rotateResult.archivedCount > 0) {
    fixed.push({
      code: "event_ledger_rotated",
      name: "Event ledger rotated",
      message: `Rotated ${rotateResult.archivedCount} event(s) older than retention window to ${rotateResult.archivePath ?? "archive"}`,
      path: rotateResult.archivePath,
    });
  }

  if (before.fixable_errors.some((issue) => issue.code === "mcp_config_in_wrong_file")) {
    await fixMcpConfigInWrongFile(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "mcp_config_in_wrong_file"));
  }

  // rc.23 TASK-010 (e): stale .fabric/.serve.lock cleanup. The advisory rides
  // in `before.infos` (info kind, not fixable_errors) — `--fix` is the only
  // mutation surface that handles info findings. Re-inspect rather than
  // re-parsing the advisory message so the unlink decision uses fresh
  // filesystem state and a fresh liveness probe. One ledger event
  // (`serve_lock_cleared`) per cleared lock; failure to append the event
  // (e.g. ledger corrupt) is swallowed so the unlink still succeeds.
  if (before.infos.some((issue) => issue.code === "stale_serve_lock")) {
    const lockInspection = inspectStaleServeLock(projectRoot, Date.now());
    if (lockInspection.present && !lockInspection.pidAlive) {
      const lockFilePath = join(projectRoot, ".fabric", ".serve.lock");
      try {
        await unlink(lockFilePath);
      } catch (err: unknown) {
        // ENOENT is fine — lock disappeared between inspect and unlink (race
        // with another doctor run). Any other error propagates.
        const errno = err as NodeJS.ErrnoException;
        if (errno.code !== "ENOENT") throw err;
      }
      await appendEventLedgerEvent(projectRoot, {
        event_type: "serve_lock_cleared",
        pid: lockInspection.pid,
        age_ms: lockInspection.ageMs,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
      fixed.push({
        code: "stale_serve_lock",
        name: "Serve lock",
        message: `Removed stale .fabric/.serve.lock (dead PID ${lockInspection.pid}).`,
        path: ".fabric/.serve.lock",
      });
    }
  }

  // v2.0.0-rc.37 NEW-39 (werewolf dogfood remediation): backfill the
  // promote_ledger_invariant deficit. The check itself emits as a `warning`
  // (not fixable_error) because it never blocks user work — but `--fix` is
  // the canonical heal surface for accumulated ledger imbalance, so we look
  // in `before.warnings` here.
  //
  // Healing semantics: the fix function emits (started - proposed) synth
  // proposed events + (promoted - started) synth promote_started events. The
  // re-runDoctorReport at the end of this function picks up the now-healed
  // state, so subsequent doctor invocations report invariant.ok unless new
  // imbalance accrues (which only happens through the rc.31 BUG-G2 path that
  // synth-on-approve already addresses for new approves).
  if (before.warnings.some((issue) => issue.code === "promote_ledger_invariant_violated")) {
    await fixPromoteLedgerInvariant(projectRoot);
    fixed.push(findIssue(before.warnings, "promote_ledger_invariant_violated"));
  }

  // v2.0.0-rc.37 NEW-38: knowledge auto-promote janitorial pass. Settled drafts
  // (created ≥14d ago, never flagged drifted) graduate draft → verified so they
  // stop inflating the draft_backlog ratio. Runs unconditionally — promotable
  // drafts surface as an info check (not a fixable_error), so there is no gate
  // in `before` to key off. reconcileKnowledge after the rewrites keeps
  // agents.meta.json maturity + hashes consistent with the new frontmatter.
  const autoPromote = await inspectDraftAutoPromote(projectRoot);
  if (autoPromote.candidates.length > 0) {
    const { promoted } = await applyDraftAutoPromote(projectRoot, autoPromote.candidates);
    if (promoted.length > 0) {
      await reconcileKnowledge(projectRoot, { trigger: "doctor" });
      const tFix = createTranslator(resolveFabricLocale(projectRoot));
      fixed.push({
        code: "draft_auto_promotable",
        name: tFix("doctor.check.draft_auto_promote.name"),
        message: tFix("doctor.check.draft_auto_promote.fixed", { count: String(promoted.length) }),
      });
    }
  }

  const report = await runDoctorReport(projectRoot);

  return {
    changed: fixed.length > 0,
    fixed,
    remaining_manual_errors: report.manual_errors,
    warnings: report.warnings,
    message: createFixMessage(fixed, report),
    report,
  };
}

// rc.4 TASK-003: lint mutation entry point. Behavior summary:
//   * `lint:orphan_demote` (warning kind code=knowledge_orphan_demote_required):
//     rewrite frontmatter `maturity:` one tier down (stable -> endorsed,
//     endorsed -> draft) via atomicWriteText; emit knowledge_demoted event.
//   * `lint:stale_archive` (code=knowledge_stale_archive_required):
//     rename file to .fabric/.archive/<type>/<filename>; emit knowledge_archived
//     event. Per task design the archive subtree is a tombstone (not git-tracked
//     active history) so we use `fs.rename` rather than `git mv`. The events.jsonl
//     entry IS the audit trail.
//   * `lint:index_drift` (fixable_error code=knowledge_index_drift):
//     bump agents.meta.json counters[layer][type] to max_observed + 1 via
//     atomicWriteJson. NO event emission — the schema does not (yet) carry
//     an agents_meta_repaired event type and v2.0 git diff of agents.meta.json
//     is sufficient audit (decision documented in TASK-003 rationale step 4).
//   * `lint:stable_id_duplicate` / `lint:layer_mismatch` (manual_error kinds):
//     auto-fix is unsafe (data loss potential). runDoctorApplyLint aborts
//     BEFORE applying any mutations and surfaces a clear "manual repair
//     required" message via abort_reason.
//   * `lint:pending_overdue` (warning kind): informational at 14d — humans
//     triage via the fabric-review Skill. At 30d the entry crosses the
//     PENDING_AUTO_ARCHIVE_THRESHOLD_DAYS gate and `--apply-lint` git-mv's
//     it to `.fabric/.archive/pending/<type>/` (team) or
//     `~/.fabric/.archive/pending/<type>/` (personal), emitting one
//     `pending_auto_archived` event per move (rc.5 TASK-009 B2).
//
// Idempotency: each mutation refreshes lastActiveAt indirectly (demoted /
// archived events register the entry's stable_id with a fresh ts in the
// next run's buildLastActiveIndex) and the inspections re-evaluate against
// the new on-disk state, so a 2nd `--apply-lint` run on a dir with no new
// findings produces 0 mutations and 0 events.
const MANUAL_LINT_ERROR_CODES = new Set([
  "knowledge_stable_id_duplicate",
  "knowledge_layer_mismatch",
]);

export async function runDoctorApplyLint(target: string): Promise<DoctorApplyLintReport> {
  const projectRoot = normalizeTarget(target);
  const before = await runDoctorReport(projectRoot);
  const mutations: DoctorApplyLintMutation[] = [];

  // Loud-error gate: stable_id_duplicate / layer_mismatch are corruption.
  // Auto-fix could delete data. Abort before any mutation.
  const blockingManual = before.manual_errors.find((issue) =>
    MANUAL_LINT_ERROR_CODES.has(issue.code),
  );
  if (blockingManual !== undefined) {
    return {
      changed: false,
      mutations: [],
      manual_errors: before.manual_errors,
      aborted: true,
      abort_reason: `Manual repair required for ${blockingManual.code}: ${blockingManual.message} - apply-lint cannot resolve this safely; triage by hand.`,
      message: `apply-lint aborted: ${blockingManual.code} requires manual repair.`,
      report: before,
    };
  }

  const now = Date.now();

  // Re-run the inspection generators directly (rather than parsing back out
  // of the report.checks summary) — we need the structured candidate lists
  // to drive per-entry mutations.
  const orphanDemote = await inspectOrphanDemote(projectRoot, now);
  for (const candidate of orphanDemote.candidates) {
    if (candidate.next_maturity === null) {
      // Terminal (already draft) — orphan-demote does not apply, stale-archive
      // owns the next transition. Defensive: createOrphanDemoteCheck filters
      // these out conceptually (next_maturity stays null only for draft) but
      // we never want to write `maturity: null`.
      continue;
    }
    mutations.push(await applyOrphanDemote(projectRoot, candidate, now));
  }

  const staleArchive = await inspectStaleArchive(projectRoot, now);
  for (const candidate of staleArchive.candidates) {
    mutations.push(await applyStaleArchive(projectRoot, candidate, now));
  }

  // rc.5 TASK-009 (B2): pending auto-archive (>30d). Runs after the canonical
  // demote/archive trio because (a) it has no interaction with lastActiveAt
  // (pending files are not yet in the canonical event stream) and (b) walking
  // pending after the canonical mutation pass keeps the dual-root pending
  // walker independent of any concurrent .fabric/knowledge/<type>/ writes
  // triggered above. One mutation per stale-pending entry, per layer.
  const pendingAutoArchive = inspectPendingAutoArchive(projectRoot, now);
  for (const candidate of pendingAutoArchive.candidates) {
    mutations.push(await applyPendingAutoArchive(projectRoot, candidate, now));
  }

  // rc.6 TASK-021 (E3): session-hints cache cleanup (#27). Independent of
  // all canonical/pending mutation paths — operates strictly on local hot-
  // cache files under `.fabric/.cache/session-hints-*.json`. Ordering: runs
  // after pending_auto_archive because they share no state and the cache
  // cleanup is the cheapest mutation (single unlink per file); deferring it
  // to last would arbitrarily inflate the perceived apply-lint runtime if
  // an upstream mutation hangs. One mutation per stale cache file.
  const sessionHintsStale = inspectSessionHintsStale(projectRoot, now);
  for (const candidate of sessionHintsStale.candidates) {
    mutations.push(await applySessionHintsStaleCleanup(projectRoot, candidate));
  }

  // v2.0.0-rc.9 TASK-003 (A3): relevance fields back-fill (#28). Runs after
  // pending_auto_archive (which may move stale-pending entries out of the
  // pending tree, removing them from the back-fill walk's input set) and
  // after session_hints_stale (which has no overlap but mirrors the
  // "cheapest mutation last" ordering — back-fill is cheap but bookkeeping
  // for the aggregate event is independent of the per-file walk). One
  // mutation per back-filled pending entry; one aggregate
  // `relevance_migration_run` event emitted unconditionally after the walk
  // so the audit trail records every --apply-lint heartbeat (matches the
  // `doctor_run` invariant — fires every run, even when no findings).
  const relevanceFieldsMissing = inspectRelevanceFieldsMissing(projectRoot);
  let relevanceTouchedCount = 0;
  for (const candidate of relevanceFieldsMissing.candidates) {
    const mutation = await applyRelevanceFieldsMissing(candidate);
    mutations.push(mutation);
    if (mutation.applied) {
      relevanceTouchedCount += 1;
    }
  }
  // Best-effort event emit. A ledger-append failure does NOT roll back the
  // per-file frontmatter writes — back-fill is hygiene rather than a
  // transactional correctness boundary, and the next --apply-lint run will
  // observe the (now-present) fields and skip them (idempotent) so the
  // aggregate event omission is recoverable on retry. Mirrors the
  // best-effort policy for the `doctor_run` event emitter at the CLI surface.
  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "relevance_migration_run",
      timestamp: new Date(now).toISOString(),
      scanned_count: relevanceFieldsMissing.scanned_count,
      touched_count: relevanceTouchedCount,
    });
  } catch {
    // Silent — observability only.
  }

  // Index drift: re-read meta after any prior mutations (none touch
  // agents.meta.json, but readability over assumption).
  const meta = await inspectMeta(projectRoot);
  const indexDrift = inspectIndexDrift(projectRoot, meta);
  if (indexDrift.drifts.length > 0) {
    mutations.push(await applyIndexDriftFix(projectRoot, indexDrift));
  }

  contextCache.invalidate("meta_write", projectRoot);

  const after = await runDoctorReport(projectRoot);
  const successCount = mutations.filter((m) => m.applied).length;
  const failureCount = mutations.length - successCount;

  return {
    changed: successCount > 0,
    mutations,
    manual_errors: after.manual_errors,
    aborted: false,
    message: createApplyLintMessage(successCount, failureCount, after.manual_errors.length),
    report: after,
  };
}

function createApplyLintMessage(
  succeeded: number,
  failed: number,
  manualErrorCount: number,
): string {
  const parts: string[] = [];
  if (succeeded === 0 && failed === 0) {
    parts.push("No apply-lint mutations were needed.");
  } else {
    parts.push(`Applied ${succeeded} apply-lint mutation${succeeded === 1 ? "" : "s"}.`);
    if (failed > 0) {
      parts.push(`${failed} mutation${failed === 1 ? "" : "s"} failed.`);
    }
  }
  parts.push(
    manualErrorCount === 0
      ? "No manual errors remain."
      : `${manualErrorCount} manual error${manualErrorCount === 1 ? "" : "s"} remain.`,
  );
  return parts.join(" ");
}

// Pure helper: rewrite the `maturity:` line in a YAML frontmatter block.
// Returns null if the source does not contain a parseable frontmatter with a
// `maturity:` field — caller must handle that defensively. Surgical replace:
// only the maturity line is touched; all other fields preserve their exact
// bytes (per risk note: round-trip preservation matters).
function rewriteFrontmatterMaturity(
  source: string,
  newMaturity: "endorsed" | "draft",
): string | null {
  const FM_PATTERN = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return null;
  }
  const block = fm[1];
  if (!MATURITY_LINE_PATTERN.test(block)) {
    return null;
  }
  const replacedBlock = block.replace(
    MATURITY_LINE_PATTERN,
    (line) => line.replace(/(stable|endorsed|draft)/u, newMaturity),
  );
  // Splice replacement back into the original. Use string slicing to preserve
  // BOM / line endings outside the captured block exactly.
  const blockStart = source.indexOf(block);
  if (blockStart < 0) {
    return null;
  }
  return source.slice(0, blockStart) + replacedBlock + source.slice(blockStart + block.length);
}

// v2.0.0-rc.37 NEW-38: promote rewriter. Distinct from rewriteFrontmatterMaturity
// (which speaks the legacy stable|endorsed|draft demote vocabulary) — this one
// flips `maturity: draft` → `maturity: verified` using the live schema
// vocabulary (draft|verified|proven). Returns null when no `maturity: draft`
// line is present (caller skips). Preserves BOM / line endings via slicing.
function rewriteFrontmatterMaturityPromote(source: string): string | null {
  const FM_PATTERN = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return null;
  }
  const block = fm[1];
  const DRAFT_LINE = /^maturity:\s*("?)draft\1\s*$/mu;
  if (!DRAFT_LINE.test(block)) {
    return null;
  }
  const replacedBlock = block.replace(DRAFT_LINE, (line) => line.replace(/draft/u, "verified"));
  const blockStart = source.indexOf(block);
  if (blockStart < 0) {
    return null;
  }
  return source.slice(0, blockStart) + replacedBlock + source.slice(blockStart + block.length);
}

async function applyOrphanDemote(
  projectRoot: string,
  candidate: OrphanDemoteCandidate,
  now: number,
): Promise<DoctorApplyLintMutation> {
  const next = candidate.next_maturity;
  if (next === null) {
    return {
      kind: "knowledge_orphan_demote_required",
      path: candidate.path,
      detail: `${candidate.maturity} -> (none, already at terminal tier)`,
      applied: false,
      error: "next_maturity is null; orphan-demote not applicable",
    };
  }
  const detail = `${candidate.maturity} -> ${next}`;
  const absPath = join(projectRoot, candidate.path);
  try {
    const source = await readFile(absPath, "utf8");
    const rewritten = rewriteFrontmatterMaturity(source, next);
    if (rewritten === null) {
      return {
        kind: "knowledge_orphan_demote_required",
        path: candidate.path,
        detail,
        applied: false,
        error: "frontmatter missing maturity field; cannot rewrite",
      };
    }
    if (rewritten === source) {
      // Defensive: rewrite produced no diff. Treat as no-op.
      return {
        kind: "knowledge_orphan_demote_required",
        path: candidate.path,
        detail,
        applied: false,
        error: "rewrite produced byte-identical output",
      };
    }
    await atomicWriteText(absPath, rewritten);
    // Audit-trail invariant: if the event-ledger append fails AFTER the
    // frontmatter rewrite has hit disk, roll the file back to its pre-mutation
    // contents so the canonical state matches the (absent) event entry. This
    // is best-effort — if the rollback ALSO fails we surface both errors but
    // disk state may genuinely be inconsistent (extremely rare; would require
    // disk failure between two sequential atomic writes).
    try {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "knowledge_demoted",
        stable_id: candidate.stable_id,
        timestamp: new Date(now).toISOString(),
        reason: `lint:orphan_demote ${candidate.maturity}->${next} after ${candidate.age_days}d inactive`,
      });
    } catch (ledgerError) {
      try {
        await atomicWriteText(absPath, source);
      } catch (rollbackError) {
        return {
          kind: "knowledge_orphan_demote_required",
          path: candidate.path,
          detail,
          applied: false,
          error: `ledger append failed (${truncateErrorMessage(ledgerError)}); rollback also failed (${truncateErrorMessage(rollbackError)}); disk may be in inconsistent state`,
        };
      }
      return {
        kind: "knowledge_orphan_demote_required",
        path: candidate.path,
        detail,
        applied: false,
        error: `ledger append failed (${truncateErrorMessage(ledgerError)}); frontmatter rolled back`,
      };
    }
    return {
      kind: "knowledge_orphan_demote_required",
      path: candidate.path,
      detail,
      applied: true,
    };
  } catch (error) {
    return {
      kind: "knowledge_orphan_demote_required",
      path: candidate.path,
      detail,
      applied: false,
      error: truncateErrorMessage(error),
    };
  }
}

async function applyStaleArchive(
  projectRoot: string,
  candidate: StaleArchiveCandidate,
  now: number,
): Promise<DoctorApplyLintMutation> {
  const sourceAbs = join(projectRoot, candidate.path);
  const destAbs = join(projectRoot, candidate.archive_path);
  const detail = `${candidate.path} -> ${candidate.archive_path}`;
  try {
    await mkdir(join(destAbs, ".."), { recursive: true });
    try {
      await rename(sourceAbs, destAbs);
    } catch (renameError) {
      // EXDEV fallback: cross-filesystem rename failure. Copy + unlink.
      // Both source and dest live under projectRoot in normal use; this
      // fallback only fires in unusual setups (e.g. .archive on a separate
      // mount). See risk note 2 in TASK-003.json.
      if (
        renameError instanceof Error &&
        "code" in renameError &&
        (renameError as NodeJS.ErrnoException).code === "EXDEV"
      ) {
        const data = await readFile(sourceAbs);
        await writeFile(destAbs, data);
        const { unlink } = await import("node:fs/promises");
        await unlink(sourceAbs);
      } else {
        throw renameError;
      }
    }
    // Audit-trail invariant: if the event-ledger append fails AFTER the
    // archive rename, roll the file back to its canonical location so disk
    // state matches the (absent) event. Best-effort rollback.
    try {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "knowledge_archived",
        stable_id: candidate.stable_id,
        timestamp: new Date(now).toISOString(),
        reason: `lint:stale_archive ${candidate.path} -> ${candidate.archive_path} after ${candidate.age_days}d inactive`,
      });
    } catch (ledgerError) {
      try {
        await rename(destAbs, sourceAbs);
      } catch (rollbackError) {
        return {
          kind: "knowledge_stale_archive_required",
          path: candidate.path,
          detail,
          applied: false,
          error: `ledger append failed (${truncateErrorMessage(ledgerError)}); rollback also failed (${truncateErrorMessage(rollbackError)}); file may be stranded at ${candidate.archive_path}`,
        };
      }
      return {
        kind: "knowledge_stale_archive_required",
        path: candidate.path,
        detail,
        applied: false,
        error: `ledger append failed (${truncateErrorMessage(ledgerError)}); archive rolled back`,
      };
    }
    return {
      kind: "knowledge_stale_archive_required",
      path: candidate.path,
      detail,
      applied: true,
    };
  } catch (error) {
    return {
      kind: "knowledge_stale_archive_required",
      path: candidate.path,
      detail,
      applied: false,
      error: truncateErrorMessage(error),
    };
  }
}

// rc.5 TASK-009 (B2): auto-archive a stale pending entry. Team-layer source
// uses `git mv` (preserves rename detection inside the workspace git tree)
// with an `fs.rename` fallback for non-repo / untracked cases. Personal-layer
// source uses plain `fs.rename` (lives outside the project's git tree).
// Emits exactly one `pending_auto_archived` event per successful move with
// `pending_path`, `archived_to`, `reason` ("auto_archive_30d").
//
// Audit-trail invariant mirrors applyStaleArchive: if the event-ledger
// append fails AFTER the move, roll the file back to its pending location
// so disk state matches the (absent) event. Best-effort — a rollback failure
// is surfaced in `error` but is extremely rare (would require two sequential
// rename failures across the same call).
async function applyPendingAutoArchive(
  projectRoot: string,
  candidate: PendingAutoArchiveCandidate,
  now: number,
): Promise<DoctorApplyLintMutation> {
  const detail = `${candidate.pending_path} -> ${candidate.archived_to}`;
  try {
    await mkdir(join(candidate.archived_to_abs, ".."), { recursive: true });

    let moved = false;
    if (candidate.layer === "team") {
      // Prefer `git mv` so the workspace history threads through the rename.
      // Falls back to plain rename when (a) not in a git repo, (b) the file
      // is untracked, or (c) git is unavailable. Mirrors the dual-strategy
      // pattern in review.ts approve flow.
      try {
        const relSource = relativePosix(projectRoot, candidate.pending_path_abs);
        const relDest = relativePosix(projectRoot, candidate.archived_to_abs);
        execFileSync("git", ["mv", "-f", relSource, relDest], {
          cwd: projectRoot,
          stdio: ["ignore", "pipe", "pipe"],
        });
        moved = true;
      } catch {
        // Fall through to plain rename below.
      }
    }
    if (!moved) {
      try {
        await rename(candidate.pending_path_abs, candidate.archived_to_abs);
      } catch (renameError) {
        // EXDEV fallback (cross-filesystem). Same shape as applyStaleArchive.
        if (
          renameError instanceof Error &&
          "code" in renameError &&
          (renameError as NodeJS.ErrnoException).code === "EXDEV"
        ) {
          const data = await readFile(candidate.pending_path_abs);
          await writeFile(candidate.archived_to_abs, data);
          const { unlink } = await import("node:fs/promises");
          await unlink(candidate.pending_path_abs);
        } else {
          throw renameError;
        }
      }
    }

    try {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "pending_auto_archived",
        pending_path: candidate.pending_path,
        archived_to: candidate.archived_to,
        reason: "auto_archive_30d",
      });
    } catch (ledgerError) {
      // Best-effort rollback to keep disk state consistent with the (absent)
      // event. We cannot easily reverse `git mv` cleanly post-failure, so a
      // plain rename back to the original location is sufficient — the next
      // run's git status will surface the move as a regular working-tree
      // change rather than a tracked rename.
      try {
        await rename(candidate.archived_to_abs, candidate.pending_path_abs);
      } catch (rollbackError) {
        return {
          kind: "knowledge_pending_auto_archive",
          path: candidate.pending_path,
          detail,
          applied: false,
          error: `ledger append failed (${truncateErrorMessage(ledgerError)}); rollback also failed (${truncateErrorMessage(rollbackError)}); file may be stranded at ${candidate.archived_to}`,
        };
      }
      return {
        kind: "knowledge_pending_auto_archive",
        path: candidate.pending_path,
        detail,
        applied: false,
        error: `ledger append failed (${truncateErrorMessage(ledgerError)}); archive rolled back`,
      };
    }
    return {
      kind: "knowledge_pending_auto_archive",
      path: candidate.pending_path,
      detail,
      applied: true,
    };
  } catch (error) {
    return {
      kind: "knowledge_pending_auto_archive",
      path: candidate.pending_path,
      detail,
      applied: false,
      error: truncateErrorMessage(error),
    };
  }
}

// Helper: convert an absolute path to a workspace-relative POSIX path
// suitable for `git mv` invocation. Falls back to the absolute path when
// the absolute is already outside projectRoot (defensive — callers only
// pass team-layer paths here, but keep the contract clear).
function relativePosix(projectRoot: string, absolutePath: string): string {
  const rel = nodeRelative(projectRoot, absolutePath);
  return rel.split(sep).join("/");
}

// rc.6 TASK-021 (E3): apply-lint mutation arm for the session-hints stale
// cleanup. Plain fs.unlink — these are local cache files, not git-tracked,
// so no `git mv` / ledger event / rollback dance. Mirrors the lightweight
// pattern called out in the task spec (vs. applyPendingAutoArchive's full
// rename-with-event-emission).
//
// Failure mode: a per-file unlink failure (ENOENT — file disappeared
// between inspection and mutation, EPERM — fs permissions, etc) is captured
// as `applied: false` with the error message truncated. The apply-lint run
// continues; doctor's contract is best-effort hygiene, not transactional.
async function applySessionHintsStaleCleanup(
  projectRoot: string,
  candidate: SessionHintsStaleCandidate,
): Promise<DoctorApplyLintMutation> {
  const detail = `deleted (${candidate.age_days}d old)`;
  const absPath = join(projectRoot, candidate.path);
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(absPath);
    return {
      kind: "knowledge_session_hints_stale_cleanup",
      path: candidate.path,
      detail,
      applied: true,
    };
  } catch (error) {
    return {
      kind: "knowledge_session_hints_stale_cleanup",
      path: candidate.path,
      detail,
      applied: false,
      error: truncateErrorMessage(error),
    };
  }
}

async function applyIndexDriftFix(
  projectRoot: string,
  inspection: IndexDriftInspection,
): Promise<DoctorApplyLintMutation> {
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  const detailParts: string[] = [];
  try {
    const meta = agentsMetaSchema.parse(JSON.parse(await readFile(metaPath, "utf8")));
    const baseCounters = AgentsMetaCountersSchema.parse(meta.counters ?? undefined);
    // Defensive deep clone so we do not mutate the parsed object in place.
    const updatedCounters: AgentsMetaCounters = {
      KP: { ...baseCounters.KP },
      KT: { ...baseCounters.KT },
    };
    for (const drift of inspection.drifts) {
      updatedCounters[drift.layer][drift.type] = drift.proposed_after;
      detailParts.push(`${drift.layer}.${drift.type}: ${drift.counter} -> ${drift.proposed_after}`);
    }
    const updated: AgentsMeta = { ...meta, counters: updatedCounters };
    await atomicWriteJson(metaPath, updated, { indent: 2 });
    return {
      kind: "knowledge_index_drift",
      path: "agents.meta.json#counters",
      detail: detailParts.join("; "),
      applied: true,
    };
  } catch (error) {
    return {
      kind: "knowledge_index_drift",
      path: "agents.meta.json#counters",
      detail: detailParts.join("; ") || "(no counters processed)",
      applied: false,
      error: truncateErrorMessage(error),
    };
  }
}

function truncateErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

async function inspectForensic(projectRoot: string): Promise<{ present: boolean; valid: boolean; report: ForensicReport | null; error?: string }> {
  const path = join(projectRoot, ".fabric", "forensic.json");
  try {
    const parsed = forensicReportSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return { present: true, valid: true, report: parsed };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { present: false, valid: false, report: null, error: ".fabric/forensic.json is missing." };
    }
    return { present: true, valid: false, report: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// v2.0: `inspectInitContext` removed. `.fabric/init-context.json` is owned
// by the AI-side client init skill, not by `fabric install` CLI. Its absence
// after `fabric install` is a legitimate "skill has not run yet" state, not a
// doctor concern.

function inspectMcpConfigInWrongFile(projectRoot: string): McpConfigInWrongFileInspection {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return { hasWrongEntry: false, settingsPath };
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { hasWrongEntry: false, settingsPath };
    }

    const settings = parsed as Record<string, unknown>;
    const mcpServers = settings.mcpServers;
    if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
      return { hasWrongEntry: false, settingsPath };
    }

    const hasWrongEntry = "fabric" in (mcpServers as Record<string, unknown>);
    return { hasWrongEntry, settingsPath };
  } catch {
    return { hasWrongEntry: false, settingsPath };
  }
}

async function inspectMeta(projectRoot: string): Promise<MetaInspection> {
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  const built = await tryBuildRuleMeta(projectRoot);

  try {
    const raw = await readFile(metaPath, "utf8");
    const meta = agentsMetaSchema.parse(JSON.parse(raw));
    const contentRefIssues = inspectContentRefs(projectRoot, meta);
    const changed = built === null ? false : built.changed;

    return {
      present: true,
      valid: true,
      meta,
      revision: meta.revision,
      computedRevision: built?.meta.revision ?? null,
      ruleCount: Object.values(meta.nodes).filter((node) => {
        const ref = node.content_ref ?? node.file;
        return ref.startsWith(".fabric/knowledge/") || ref.startsWith("~/.fabric/knowledge/");
      }).length,
      missingContentRefs: contentRefIssues.missing,
      invalidContentRefs: contentRefIssues.invalid,
      stale: changed || (built !== null && meta.revision !== built.meta.revision),
      changed,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        present: false,
        valid: false,
        meta: null,
        revision: null,
        computedRevision: built?.meta.revision ?? null,
        ruleCount: 0,
        missingContentRefs: [],
        invalidContentRefs: [],
        stale: true,
        changed: built?.changed ?? true,
      };
    }
    // rc.35 TASK-09 (P0-14): classify the parse failure so createMetaCheck
    // can render a human sentence instead of dumping the raw ZodError JSON.
    let readErrorKind: "zod" | "json" | "other" = "other";
    let readErrorZodIssues: Array<{ path: string; message: string }> | undefined;
    if (error instanceof ZodError) {
      readErrorKind = "zod";
      readErrorZodIssues = error.issues.slice(0, 3).map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "<root>",
        message: issue.message,
      }));
    } else if (error instanceof SyntaxError) {
      readErrorKind = "json";
    }
    return {
      present: true,
      valid: false,
      meta: null,
      revision: null,
      computedRevision: built?.meta.revision ?? null,
      ruleCount: 0,
      readErrorKind,
      readErrorZodIssues,
      missingContentRefs: [],
      invalidContentRefs: [],
      stale: true,
      changed: built?.changed ?? true,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function tryBuildRuleMeta(projectRoot: string): Promise<Awaited<ReturnType<typeof buildKnowledgeMeta>> | null> {
  try {
    return await buildKnowledgeMeta(projectRoot);
  } catch {
    return null;
  }
}

function inspectContentRefs(projectRoot: string, meta: AgentsMeta): { missing: string[]; invalid: string[] } {
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const node of Object.values(meta.nodes)) {
    const contentRef = normalizePath(node.content_ref ?? node.file);

    // v2.0: valid content_refs live under .fabric/knowledge/ (team) or
    // ~/.fabric/knowledge/ (personal). v1.x legacy paths are no longer
    // recognized.
    const isPersonalKnowledge = contentRef.startsWith("~/.fabric/knowledge/");
    const isTeamKnowledge = contentRef.startsWith(".fabric/knowledge/");

    if (!isPersonalKnowledge && !isTeamKnowledge) {
      invalid.push(contentRef);
      continue;
    }

    // Personal-root entries are not directly validated against the project
    // tree — their existence is verified by the personal-root scan in
    // knowledge-meta-builder.ts. We only check team-root and legacy entries here.
    if (isPersonalKnowledge) {
      continue;
    }

    if (!existsSync(join(projectRoot, contentRef))) {
      missing.push(contentRef);
    }
  }

  return { missing, invalid };
}

async function inspectEventLedger(projectRoot: string): Promise<EventLedgerInspection> {
  const path = getEventLedgerPath(projectRoot);
  const exists = existsSync(path);

  if (!exists) {
    return {
      exists: false,
      writable: false,
      parseable: false,
      hasPartialWrite: false,
      partialWriteByteOffset: 0,
      partialWriteByteLength: 0,
      schemaVersionUnsupportedCount: 0,
      eventTypeUnknownCount: 0,
      schemaVersionSamples: [],
      eventTypeSamples: [],
      path,
    };
  }

  try {
    await access(path, constants.W_OK);
    const { warnings } = await readEventLedger(projectRoot);
    const raw = await readFile(path, "utf8");
    const invalidLine = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => !isValidJsonLine(line));

    const partialWarning = warnings.find((w) => w.kind === "partial_write_at_tail");
    // v2.0.0-rc.27 TASK-010 (audit §2.24): tally schema-compat rejections and
    // capture up to 3 sample tokens for the doctor remediation hint.
    const schemaVersionSamples: string[] = [];
    const eventTypeSamples: string[] = [];
    let schemaVersionUnsupportedCount = 0;
    let eventTypeUnknownCount = 0;
    for (const w of warnings) {
      if (w.kind === "schema_version_unsupported") {
        schemaVersionUnsupportedCount += 1;
        const token = String(w.schema_version);
        if (!schemaVersionSamples.includes(token) && schemaVersionSamples.length < 3) {
          schemaVersionSamples.push(token);
        }
      } else if (w.kind === "event_type_unknown") {
        eventTypeUnknownCount += 1;
        const token = String(w.event_type);
        if (!eventTypeSamples.includes(token) && eventTypeSamples.length < 3) {
          eventTypeSamples.push(token);
        }
      }
    }

    return {
      exists: true,
      writable: true,
      parseable: invalidLine === undefined,
      hasPartialWrite: partialWarning !== undefined,
      partialWriteByteOffset: partialWarning?.byte_offset ?? 0,
      partialWriteByteLength: partialWarning?.byte_length ?? 0,
      schemaVersionUnsupportedCount,
      eventTypeUnknownCount,
      schemaVersionSamples,
      eventTypeSamples,
      path,
      error: invalidLine === undefined ? undefined : "events.jsonl contains an invalid JSON line.",
    };
  } catch (error) {
    return {
      exists: true,
      writable: false,
      parseable: false,
      hasPartialWrite: false,
      partialWriteByteOffset: 0,
      partialWriteByteLength: 0,
      schemaVersionUnsupportedCount: 0,
      eventTypeUnknownCount: 0,
      schemaVersionSamples: [],
      eventTypeSamples: [],
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// v2.0.0-rc.28 TASK-04 (audit §3.1 follow-up): scan the three v2 skill
// directories under `.claude/skills/<slug>/ref/` and `.codex/skills/<slug>/
// ref/`. For every ref filename that exists in BOTH client subtrees, byte-
// compare the contents. Any mismatch is recorded as a drifted relative
// path. Filenames present in only one client are tolerated (the user may
// only have one client installed), but a parity mismatch on files present
// in both is flagged.
function inspectSkillRefMirror(projectRoot: string): SkillRefMirrorInspection {
  const skillSlugs = ["fabric-archive", "fabric-review", "fabric-import"];
  const driftedPaths: string[] = [];
  for (const slug of skillSlugs) {
    const claudeRef = join(projectRoot, ".claude", "skills", slug, "ref");
    const codexRef = join(projectRoot, ".codex", "skills", slug, "ref");
    let claudeFiles: string[] | null = null;
    let codexFiles: string[] | null = null;
    try {
      claudeFiles = readdirSync(claudeRef).filter((n) => n.endsWith(".md"));
    } catch {
      // Missing client subtree — tolerated only when the OTHER client subtree
      // is also missing OR when the user explicitly only installed one
      // client (the asymmetric-install case). `null` here is distinct from
      // "exists but empty" — only `null` skips the parity check.
    }
    try {
      codexFiles = readdirSync(codexRef).filter((n) => n.endsWith(".md"));
    } catch {
      // Same.
    }
    // Asymmetric install — at most one client surface exists. Parity check
    // does not apply; do not flag anything for this slug.
    if (claudeFiles === null || codexFiles === null) continue;
    // v2.0.0-rc.28 TASK-04 (Gemini review fix): when BOTH client subtrees
    // exist, files present in only one side ARE drift (partial install or
    // manual deletion). Previously the inspection filtered to the
    // intersection, silently ignoring file-level asymmetry. The fix takes
    // the symmetric difference and flags every missing file from either
    // side, on top of the byte-comparison for the intersection.
    const claudeSet = new Set(claudeFiles);
    const codexSet = new Set(codexFiles);
    const union = new Set([...claudeFiles, ...codexFiles]);
    for (const fname of union) {
      const inClaude = claudeSet.has(fname);
      const inCodex = codexSet.has(fname);
      if (!inClaude || !inCodex) {
        driftedPaths.push(`skills/${slug}/ref/${fname}`);
        continue;
      }
      let claudeBody: string;
      let codexBody: string;
      try {
        claudeBody = readFileSync(join(claudeRef, fname), "utf8");
      } catch {
        continue;
      }
      try {
        codexBody = readFileSync(join(codexRef, fname), "utf8");
      } catch {
        continue;
      }
      if (claudeBody !== codexBody) {
        driftedPaths.push(`skills/${slug}/ref/${fname}`);
      }
    }
  }
  if (driftedPaths.length === 0) return { status: "ok" };
  return { status: "drift", driftedPaths };
}

// v2.0.0-rc.33 W3-6 (P1-13): inspect each installed SKILL.md and report
// token-budget violations. Scans `.claude/skills/<slug>/SKILL.md` only —
// `.codex/skills/` mirror (per skill_ref_mirror) carries the same body so
// re-scanning is redundant. When the Claude install path is missing (user
// only installed Codex, or no fabric install yet), the slug silently degrades
// to OK — non-existence isn't a budget violation.
//
// Token estimation uses chars / 3 for CJK/EN mixed markdown — between the
// chars/2 CJK-heavy heuristic and the chars/4 English heuristic. SKILL.md
// in this project is Chinese-heavy so chars/3 errs on the safe (over-
// estimate) side, which is correct for a budget lint: better to nag at the
// 4.9K-actual / 5.0K-estimated boundary than to silently miss a 5.1K-actual
// SKILL.md that the chars/4 heuristic reports as 3.8K.
function inspectSkillTokenBudget(projectRoot: string): SkillTokenBudgetInspection {
  const skillSlugs = ["fabric-archive", "fabric-review", "fabric-import"];
  const WARN_TOKENS = 5_000;
  const ERROR_TOKENS = 10_000;
  const overSize: Array<{ slug: string; tokens: number; severity: "warn" | "error" }> = [];
  let highestSeverity: "ok" | "warn" | "error" = "ok";
  for (const slug of skillSlugs) {
    const skillMdPath = join(projectRoot, ".claude", "skills", slug, "SKILL.md");
    let body: string;
    try {
      body = readFileSync(skillMdPath, "utf8");
    } catch {
      // Skill not installed for Claude — skip (not a budget violation).
      continue;
    }
    const tokens = Math.ceil(body.length / 3);
    if (tokens > ERROR_TOKENS) {
      overSize.push({ slug, tokens, severity: "error" });
      highestSeverity = "error";
    } else if (tokens > WARN_TOKENS) {
      overSize.push({ slug, tokens, severity: "warn" });
      if (highestSeverity !== "error") highestSeverity = "warn";
    }
  }
  return { status: highestSeverity, overSize };
}

// v2.0.0-rc.33 W3-7 (P1-14): per-skill structural lint over SKILL.md
// description frontmatter. Reads the YAML frontmatter directly (avoids
// pulling a YAML parser into this lib) — the description field is single-
// line in practice, so a regex on the first 200 lines is sufficient.
function inspectSkillDescription(projectRoot: string): SkillDescriptionLintInspection {
  const skillSlugs = ["fabric-archive", "fabric-review", "fabric-import"];
  const MAX_DESCRIPTION_TOKENS = 60;
  const issues: SkillDescriptionLintInspection["issues"] = [];
  // CJK range covers the bulk of common CJK ideographs + extension A. Enough
  // for trigger-phrase detection — we are not classifying script families.
  const CJK_PATTERN = /[㐀-䶿一-鿿]/;
  // ASCII letter requirement is intentionally loose — any [a-zA-Z]+ run
  // counts as an English trigger; we are not enforcing a specific lexicon.
  const ASCII_PATTERN = /[a-zA-Z]{2,}/;

  for (const slug of skillSlugs) {
    const skillMdPath = join(projectRoot, ".claude", "skills", slug, "SKILL.md");
    let body: string;
    try {
      body = readFileSync(skillMdPath, "utf8");
    } catch {
      continue; // Skill not installed for Claude — skip.
    }

    // YAML frontmatter (delimited by --- on the first line). Extract
    // description: ... (single-line value in our skill contract).
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      issues.push({ slug, problem: "missing", detail: "no YAML frontmatter" });
      continue;
    }
    const descMatch = fmMatch[1].match(/^description:\s*(.+?)\s*$/m);
    if (!descMatch || descMatch[1].trim().length === 0) {
      issues.push({ slug, problem: "missing", detail: "description field empty or absent" });
      continue;
    }
    // YAML may quote the value; strip surrounding quotes for length / language checks.
    const description = descMatch[1].replace(/^["'](.+)["']$/, "$1");
    const tokens = Math.ceil(description.length / 3);
    if (tokens > MAX_DESCRIPTION_TOKENS) {
      issues.push({ slug, problem: "too_long", detail: `${tokens} tok (max ${MAX_DESCRIPTION_TOKENS})` });
    }
    if (!CJK_PATTERN.test(description)) {
      issues.push({ slug, problem: "no_cjk", detail: "no Chinese trigger phrase" });
    }
    if (!ASCII_PATTERN.test(description)) {
      issues.push({ slug, problem: "no_ascii", detail: "no English trigger phrase" });
    }
  }

  return { status: issues.length === 0 ? "ok" : "warn", issues };
}

// v2.0.0-rc.33 W3-3 (P1-3): Goodhart inspection over 7d of cite events.
// Reads `assistant_turn_observed` events from the ledger, applies 4 simple
// heuristics. Threshold tuning matches the rc.32 baseline cite-coverage 3.1%
// scenario — at that low signal density, > 5 instances of any one pattern
// over 7d is meaningful (vs noise floor < 1 per day).
async function inspectCiteGoodhart(projectRoot: string): Promise<CiteGoodhartInspection> {
  const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const RITUAL_REPEAT_THRESHOLD = 5;
  const DISMISSAL_ABUSE_RATIO = 0.6;
  const PLACEHOLDER_COUNT_THRESHOLD = 5;
  const cutoffMs = Date.now() - WINDOW_MS;
  const fired: CiteGoodhartInspection["fired"] = [];

  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { status: "ok", fired: [] };
  }
  const turns = events.filter(
    (e): e is Extract<EventLedgerEvent, { event_type: "assistant_turn_observed" }> => {
      if (e.event_type !== "assistant_turn_observed") return false;
      const ts = Date.parse(e.timestamp);
      return Number.isFinite(ts) && ts >= cutoffMs;
    },
  );
  if (turns.length === 0) {
    return { status: "ok", fired: [] };
  }

  // G1: count (kb_id, "applied") tuples. Same tuple > threshold = ritual.
  // v2.1.0-rc.1 (ADJ-P4-1, full remap): cite_tags reaches here normalized to the
  // 2-state vocab (legacy 'recalled'/'planned'/'chained-from' → 'applied' on
  // read), so the single 'applied' category captures the Goodhart signal (AI
  // cites a single hot id over and over instead of expanding coverage).
  const appliedCount = new Map<string, number>();
  for (const turn of turns) {
    for (let i = 0; i < turn.cite_ids.length; i += 1) {
      if (turn.cite_tags[i] === "applied") {
        const key = turn.cite_ids[i];
        appliedCount.set(key, (appliedCount.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [id, n] of appliedCount.entries()) {
    if (n > RITUAL_REPEAT_THRESHOLD) {
      fired.push({ pattern: "G1", detail: `${id} repeated as [applied] ${n}x in 7d` });
      break; // one example is enough — operator scans the ledger for the rest
    }
  }

  // G2: dismissal abuse — skip_reason ratio on applied cites.
  let appliedTotal = 0;
  let appliedWithSkip = 0;
  for (const turn of turns) {
    for (let i = 0; i < turn.cite_ids.length; i += 1) {
      if (turn.cite_tags[i] !== "applied") continue;
      appliedTotal += 1;
      const commitment = turn.cite_commitments[i];
      if (commitment && typeof commitment.skip_reason === "string" && commitment.skip_reason.length > 0) {
        appliedWithSkip += 1;
      }
    }
  }
  if (appliedTotal >= 5 && appliedWithSkip / appliedTotal > DISMISSAL_ABUSE_RATIO) {
    fired.push({
      pattern: "G2",
      detail: `${appliedWithSkip}/${appliedTotal} applied cites used skip:<reason> (> ${Math.round(DISMISSAL_ABUSE_RATIO * 100)}%)`,
    });
  }

  // G3 chained_from_misuse retired in v2.1.0-rc.1 (ADJ-P4-1) — the chained-from
  // tag no longer exists post-remap, so the lint was permanently dead. See the
  // CiteGoodhartInspection type doc above.

  // G5: placeholder cite — "none" tags with generic kb_line_raw.
  // Generic markers: a kb_line_raw that is exactly "KB: none" (no bracketed reason)
  // OR contains "[unspecified]". The rc.33 cite-policy doc lists these as the
  // legacy/sentinel forms operators should NOT use long-term.
  let placeholderCount = 0;
  for (const turn of turns) {
    if (turn.cite_tags.length === 0) continue;
    const allNone = turn.cite_tags.every((t) => t === "none");
    if (!allNone) continue;
    const raw = (turn.kb_line_raw ?? "").trim();
    if (raw === "KB: none" || raw.includes("[unspecified]")) {
      placeholderCount += 1;
    }
  }
  if (placeholderCount > PLACEHOLDER_COUNT_THRESHOLD) {
    fired.push({
      pattern: "G5",
      detail: `${placeholderCount} placeholder "KB: none" / "[unspecified]" cites in 7d`,
    });
  }

  return { status: fired.length === 0 ? "ok" : "warn", fired };
}

// v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog ratio. Reuses iterateCanonicalEntries
// which already exposes the parsed maturity. No event-ledger read — purely
// disk-state. Total < 10 is fail-open (small workspaces are noisy denominators).
// v2.0.0-rc.37 NEW-38: schema-aware maturity extractor (draft|verified|proven)
// PLUS legacy (stable|endorsed) for back-compat. Distinct from the
// orphan-demote MATURITY_LINE_PATTERN (legacy-only) — draft_backlog MUST see
// verified/proven entries in the denominator, otherwise promoting draft →
// verified silently removes the entry from BOTH numerator and denominator and
// the ratio never drops (the bug NEW-38 dogfood surfaced: 53/53 → 20/20).
const MATURITY_LINE_PATTERN_FULL =
  /^maturity:\s*("?)(stable|endorsed|draft|verified|proven)\1\s*$/mu;
function extractMaturityFull(source: string): string | null {
  const fm = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---/u.exec(source);
  if (fm === null) return null;
  const m = MATURITY_LINE_PATTERN_FULL.exec(fm[1]);
  return m === null ? null : m[2];
}

function inspectDraftBacklog(projectRoot: string): DraftBacklogInspection {
  const DRAFT_BACKLOG_RATIO = 0.5;
  const MIN_TOTAL_FOR_RATIO = 10;
  let draftCount = 0;
  let totalCount = 0;
  // Walk canonical files directly with the full-vocabulary maturity extractor
  // so verified/proven entries stay in totalCount (iterateCanonicalEntries
  // skips them — it uses the legacy-only pattern for orphan-demote).
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  for (const typeDir of KNOWLEDGE_CANONICAL_TYPE_DIRS) {
    const dir = join(knowledgeRoot, typeDir);
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (CANONICAL_KNOWLEDGE_FILENAME_PATTERN.exec(entry.name) === null) continue;
      let maturity: string | null;
      try {
        maturity = extractMaturityFull(readFileSync(join(dir, entry.name), "utf8"));
      } catch {
        continue;
      }
      if (maturity === null) continue;
      totalCount += 1;
      if (maturity === "draft") draftCount += 1;
    }
  }
  if (totalCount < MIN_TOTAL_FOR_RATIO) {
    return { status: "ok", draftCount, totalCount, ratio: 0 };
  }
  const ratio = draftCount / totalCount;
  return {
    status: ratio > DRAFT_BACKLOG_RATIO ? "warn" : "ok",
    draftCount,
    totalCount,
    ratio,
  };
}

// v2.0.0-rc.37 NEW-38: union of stable_ids ever flagged by a
// knowledge_drift_detected event (drifted_stable_ids[]). Auto-promote excludes
// these — a drifted draft is unsettled by definition.
async function buildDriftedStableIds(projectRoot: string): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const { events } = await readEventLedger(projectRoot);
    for (const e of events) {
      if (e.event_type === "knowledge_drift_detected" && Array.isArray(e.drifted_stable_ids)) {
        for (const id of e.drifted_stable_ids) {
          if (typeof id === "string" && id.length > 0) set.add(id);
        }
      }
    }
  } catch {
    // empty set — no ledger / unreadable → nothing excluded by drift
  }
  return set;
}

// v2.0.0-rc.37 NEW-38: collect auto-promote candidates. Read-only; the actual
// frontmatter rewrite + event emission lives in the runDoctorFix arm.
async function inspectDraftAutoPromote(
  projectRoot: string,
  now: number = Date.now(),
): Promise<DraftAutoPromoteInspection> {
  const drifted = await buildDriftedStableIds(projectRoot);
  const minAgeMs = DRAFT_AUTO_PROMOTE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  const candidates: DraftAutoPromoteCandidate[] = [];
  for (const entry of iterateCanonicalEntries(projectRoot, new Map())) {
    if (entry.maturity !== "draft") continue;
    if (drifted.has(entry.stable_id)) continue;
    let createdAt: number | null;
    try {
      createdAt = extractKnowledgeFrontmatterCreatedAt(readFileSync(entry.absPath, "utf8"));
    } catch {
      continue;
    }
    if (createdAt === null) continue;
    const ageMs = now - createdAt;
    if (ageMs < minAgeMs) continue;
    candidates.push({
      stable_id: entry.stable_id,
      relPath: entry.relPath,
      absPath: entry.absPath,
      ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
    });
  }
  return { candidates };
}

function createDraftAutoPromoteCheck(
  t: Translator,
  inspection: DraftAutoPromoteInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.draft_auto_promote.name"),
      t("doctor.check.draft_auto_promote.ok"),
    );
  }
  const sample = inspection.candidates.slice(0, 3).map((c) => c.stable_id).join(", ");
  return {
    name: t("doctor.check.draft_auto_promote.name"),
    status: "ok",
    kind: "info",
    code: "draft_auto_promotable",
    fixable: false,
    message: t("doctor.check.draft_auto_promote.message", {
      count: String(inspection.candidates.length),
      sample,
      suffix: inspection.candidates.length > 3 ? ", ..." : "",
    }),
    actionHint: t("doctor.check.draft_auto_promote.remediation"),
  };
}

// v2.0.0-rc.37 NEW-38: the --fix mutation. Flips each candidate draft → verified
// and emits a knowledge_promoted event. Returns the count + promoted ids for
// the fix report. Best-effort per entry — a single rewrite failure does not
// abort the batch.
async function applyDraftAutoPromote(
  projectRoot: string,
  candidates: DraftAutoPromoteCandidate[],
): Promise<{ promoted: string[] }> {
  const promoted: string[] = [];
  for (const candidate of candidates) {
    let source: string;
    try {
      source = readFileSync(candidate.absPath, "utf8");
    } catch {
      continue;
    }
    const rewritten = rewriteFrontmatterMaturityPromote(source);
    if (rewritten === null || rewritten === source) continue;
    try {
      await atomicWriteText(candidate.absPath, rewritten);
    } catch {
      continue;
    }
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_promoted",
      stable_id: candidate.stable_id,
      timestamp: new Date().toISOString(),
      reason: AUTO_PROMOTED_REASON,
    }).catch(() => {});
    promoted.push(candidate.stable_id);
  }
  return { promoted };
}

// rc.36 TASK-05 (P0-8): empty-tags ratio across canonical entries. Warn when
// >50% of entries carry `tags: []` — clustering / topical surfacing degrades
// when most entries are tag-less. Threshold mirrors draft_backlog (>50% with
// ≥10 entries total to avoid spurious warns in fresh repos).
type EmptyTagsInspection = {
  status: "ok" | "warn";
  emptyCount: number;
  totalCount: number;
  ratio: number;
};

function inspectKnowledgeTagsEmpty(projectRoot: string): EmptyTagsInspection {
  const EMPTY_TAGS_RATIO_THRESHOLD = 0.5;
  const MIN_TOTAL_FOR_RATIO = 10;
  let emptyCount = 0;
  let totalCount = 0;
  for (const entry of iterateCanonicalEntries(projectRoot, new Map())) {
    let source: string;
    try {
      source = readFileSync(entry.absPath, "utf8");
    } catch {
      continue;
    }
    const isEmpty = isKnowledgeFrontmatterTagsEmpty(source);
    // null → no tags line at all (legacy); treat as empty (still degrades
    // clustering). false → tags present, non-empty.
    if (isEmpty === null || isEmpty === true) {
      emptyCount += 1;
    }
    totalCount += 1;
  }
  if (totalCount < MIN_TOTAL_FOR_RATIO) {
    return { status: "ok", emptyCount, totalCount, ratio: 0 };
  }
  const ratio = emptyCount / totalCount;
  return {
    status: ratio > EMPTY_TAGS_RATIO_THRESHOLD ? "warn" : "ok",
    emptyCount,
    totalCount,
    ratio,
  };
}

async function inspectKnowledgeTestIndex(projectRoot: string): Promise<KnowledgeTestIndexInspection> {
  const path = join(projectRoot, ".fabric", ".cache", "knowledge-test.index.json");
  const built = await tryBuildRuleMeta(projectRoot);

  try {
    const index = knowledgeTestIndexSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return {
      present: true,
      valid: true,
      stale: built === null ? false : !isSameKnowledgeTestIndex(index, built.knowledgeTestIndex),
      linkCount: index.links.length,
      orphanCount: index.orphan_annotations.length,
    };
  } catch (error) {
    return {
      present: !isMissingFileError(error),
      valid: false,
      stale: true,
      linkCount: 0,
      orphanCount: 0,
      error: isMissingFileError(error)
        ? ".fabric/.cache/knowledge-test.index.json is missing."
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

function inspectBootstrapAnchor(projectRoot: string): BootstrapAnchorInspection {
  return {
    hasAgentsMd: existsSync(join(projectRoot, "AGENTS.md")),
    hasClaudeMd: existsSync(join(projectRoot, "CLAUDE.md")),
  };
}

// v2.0.0-rc.19 TASK-004: scan the four target paths for the legacy
// `fabric:knowledge-base` managed-block markers. Missing files are silently
// skipped (legitimate post-clean-install state). Returns the absolute paths
// of every file whose content still matches LEGACY_KB_REGEX so the dispatcher
// can rewrite them in a single pass. Idempotent: re-running on a post-fix
// tree returns an empty list (the rewrite replaces the marker tokens, so the
// regex no longer matches).
const BOOTSTRAP_MARKER_MIGRATION_TARGETS = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursor/rules",
  ".cursor/rules/fabric-bootstrap.mdc",
] as const;

async function inspectBootstrapMarkerMigration(
  target: string,
): Promise<BootstrapMarkerMigrationInspection> {
  const filesNeedingMigration: string[] = [];
  for (const rel of BOOTSTRAP_MARKER_MIGRATION_TARGETS) {
    const abs = join(target, rel);
    if (!existsSync(abs)) {
      continue;
    }
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      // Unreadable file (permission / EISDIR for the legacy `.cursor/rules`
      // directory variant) — treat as "not a legacy-marker carrier" and skip.
      continue;
    }
    if (LEGACY_KB_REGEX.test(content)) {
      filesNeedingMigration.push(abs);
    }
  }
  return { filesNeedingMigration };
}

function createBootstrapMarkerMigrationCheck(
  t: Translator,
  inspection: BootstrapMarkerMigrationInspection,
): DoctorCheck {
  if (inspection.filesNeedingMigration.length === 0) {
    return okCheck(
      t("doctor.check.bootstrap_marker_migration.name"),
      t("doctor.check.bootstrap_marker_migration.ok"),
    );
  }
  const list = inspection.filesNeedingMigration.join(", ");
  const count = inspection.filesNeedingMigration.length;
  return issueCheck(
    t("doctor.check.bootstrap_marker_migration.name"),
    "error",
    "fixable_error",
    "bootstrap_marker_migration_required",
    t(`doctor.check.bootstrap_marker_migration.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      list,
    }),
    t("doctor.check.bootstrap_marker_migration.remediation"),
  );
}

// v2.0.0-rc.19 bootstrap-consolidation TASK-005: L1 byte-level drift.
// Reads `.fabric/AGENTS.md` and byte-compares against BOOTSTRAP_CANONICAL.
// CRITICAL: NO normalization — content read as raw utf8; CRLF differences MUST
// trigger drift so an install-side line-ending bug surfaces here. The 'missing'
// branch defers to the existing bootstrap_anchor_missing check (separate code).
async function inspectL1BootstrapSnapshotDrift(
  target: string,
): Promise<L1BootstrapSnapshotDriftInspection> {
  const abs = join(target, ".fabric", "AGENTS.md");
  if (!existsSync(abs)) {
    return { status: "missing", canonical: BOOTSTRAP_CANONICAL, onDisk: null };
  }
  let onDisk: string;
  try {
    onDisk = await readFile(abs, "utf8");
  } catch {
    // Unreadable — treat as missing for purposes of L1 (other checks surface
    // permission errors via the anchor-missing path).
    return { status: "missing", canonical: BOOTSTRAP_CANONICAL, onDisk: null };
  }
  if (onDisk === BOOTSTRAP_CANONICAL) {
    return { status: "ok", canonical: BOOTSTRAP_CANONICAL, onDisk };
  }
  return { status: "drift", canonical: BOOTSTRAP_CANONICAL, onDisk };
}

function createL1BootstrapSnapshotDriftCheck(
  t: Translator,
  inspection: L1BootstrapSnapshotDriftInspection,
): DoctorCheck {
  if (inspection.status === "drift") {
    return issueCheck(
      t("doctor.check.bootstrap_snapshot_drift.name"),
      "error",
      "fixable_error",
      "bootstrap_snapshot_drift",
      t("doctor.check.bootstrap_snapshot_drift.message.drift"),
      t("doctor.check.bootstrap_snapshot_drift.remediation.drift"),
    );
  }
  // 'missing' is delegated to bootstrap_anchor_missing — return ok here so we
  // don't double-report.
  return okCheck(
    t("doctor.check.bootstrap_snapshot_drift.name"),
    inspection.status === "ok"
      ? t("doctor.check.bootstrap_snapshot_drift.ok.ok")
      : t("doctor.check.bootstrap_snapshot_drift.ok.missing_delegated"),
  );
}

// v2.0.0-rc.19 bootstrap-consolidation TASK-005: L2 byte-level drift across
// the three propagation targets — root AGENTS.md, .cursor/rules/fabric-bootstrap.mdc
// (managed block bodies) and CLAUDE.md (@import line). The expected body is
// computed once from `.fabric/AGENTS.md` (+ optional `\n---\n` + project-rules)
// and byte-compared against each extracted block body. Files where the new
// marker is absent BUT the legacy marker is present are skipped — TASK-04's
// bootstrap_marker_migration_required already flagged them and migration
// runs FIRST in the dispatcher.
async function inspectL2ManagedBlockDrift(
  target: string,
): Promise<L2ManagedBlockDriftInspection> {
  const snapshotPath = join(target, ".fabric", "AGENTS.md");
  if (!existsSync(snapshotPath)) {
    // No L1 → L2 has no expectedBody to compare against. Defer to L1 fix.
    return { status: "ok", drifted: [] };
  }
  let snapshot: string;
  try {
    snapshot = await readFile(snapshotPath, "utf8");
  } catch {
    return { status: "ok", drifted: [] };
  }
  const projectRulesPath = join(target, ".fabric", "project-rules.md");
  let expectedBody = snapshot;
  if (existsSync(projectRulesPath)) {
    try {
      const projectRules = await readFile(projectRulesPath, "utf8");
      expectedBody = `${snapshot}\n---\n${projectRules}`;
    } catch {
      // best-effort — fall back to snapshot-only expectedBody
    }
  }

  const drifted: Array<{ path: string; expected: string; actual: string }> = [];
  let anyManagedBlockFound = false;

  // Managed-block targets: extract body between BOOTSTRAP_MARKER_BEGIN/END
  // and byte-compare against expectedBody.
  const blockTargets = [
    join(target, "AGENTS.md"),
    join(target, ".cursor", "rules", "fabric-bootstrap.mdc"),
  ];
  for (const abs of blockTargets) {
    if (!existsSync(abs)) {
      continue;
    }
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    // Skip files in legacy-marker pre-migration state (TASK-04 owns those).
    if (!BOOTSTRAP_REGEX.test(content) && LEGACY_KB_REGEX.test(content)) {
      continue;
    }
    const match = content.match(BOOTSTRAP_REGEX);
    if (match === null) {
      // No managed block — propagator never ran for this file. L2 doesn't own
      // the missing-block diagnostic; doctor will surface install bugs via
      // other paths.
      continue;
    }
    anyManagedBlockFound = true;
    // Extract the body bytes between BOOTSTRAP_MARKER_BEGIN and BOOTSTRAP_MARKER_END.
    // match[0] includes optional leading newlines + the full begin..end region.
    const region = match[0];
    const beginIdx = region.indexOf(BOOTSTRAP_MARKER_BEGIN);
    const bodyStart = beginIdx + BOOTSTRAP_MARKER_BEGIN.length;
    const endIdx = region.indexOf(BOOTSTRAP_MARKER_END, bodyStart);
    if (bodyStart < 0 || endIdx < 0) {
      continue;
    }
    // Body convention: `{BEGIN}\n{expectedBody}\n{END}` — strip exactly one
    // leading and one trailing newline (matching the writer convention) before
    // byte-compare. CRITICAL: no other normalization.
    let body = region.slice(bodyStart, endIdx);
    if (body.startsWith("\n")) body = body.slice(1);
    if (body.endsWith("\n")) body = body.slice(0, -1);
    if (body !== expectedBody) {
      drifted.push({ path: abs, expected: expectedBody, actual: body });
    }
  }

  // CLAUDE.md: thin shell — verify `@.fabric/AGENTS.md` line is present.
  const claudeMdPath = join(target, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    let claudeContent: string;
    try {
      claudeContent = await readFile(claudeMdPath, "utf8");
      // Skip legacy-marker pre-migration state (TASK-04 owns).
      if (!BOOTSTRAP_REGEX.test(claudeContent) && LEGACY_KB_REGEX.test(claudeContent)) {
        // skip
      } else {
        anyManagedBlockFound = true;
        const lines = claudeContent.split(/\r?\n/u);
        const hasAtImport = lines.some((line) => line.trim() === "@.fabric/AGENTS.md");
        if (!hasAtImport) {
          drifted.push({
            path: claudeMdPath,
            expected: "@.fabric/AGENTS.md",
            actual: "(line missing)",
          });
        }
      }
    } catch {
      // best-effort
    }
  }

  if (!anyManagedBlockFound) {
    return { status: "no-managed-block", drifted: [] };
  }
  if (drifted.length === 0) {
    return { status: "ok", drifted: [] };
  }
  return { status: "drift", drifted };
}

function createL2ManagedBlockDriftCheck(
  t: Translator,
  inspection: L2ManagedBlockDriftInspection,
): DoctorCheck {
  if (inspection.status === "drift") {
    const list = inspection.drifted.map((d) => d.path).join(", ");
    const count = inspection.drifted.length;
    return issueCheck(
      t("doctor.check.managed_block_drift.name"),
      "error",
      "fixable_error",
      "managed_block_drift",
      t(`doctor.check.managed_block_drift.message.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
        list,
      }),
      t("doctor.check.managed_block_drift.remediation"),
    );
  }
  return okCheck(
    t("doctor.check.managed_block_drift.name"),
    inspection.status === "ok"
      ? t("doctor.check.managed_block_drift.ok.ok")
      : t("doctor.check.managed_block_drift.ok.no_managed_block"),
  );
}

function createBootstrapAnchorCheck(t: Translator, inspection: BootstrapAnchorInspection): DoctorCheck {
  // v2.0: bootstrap is anchored at the repo root via AGENTS.md or CLAUDE.md.
  // Either one (or both) is sufficient; missing both is a fixable_error in
  // the sense that `fabric install` is the canonical remediation (we do not
  // auto-write the anchor file from doctor --fix).
  if (!inspection.hasAgentsMd && !inspection.hasClaudeMd) {
    return issueCheck(
      t("doctor.check.bootstrap_anchor.name"),
      "error",
      "fixable_error",
      "bootstrap_anchor_missing",
      t("doctor.check.bootstrap_anchor.message.missing"),
      t("doctor.check.bootstrap_anchor.remediation.missing"),
    );
  }
  const present = [
    inspection.hasAgentsMd ? "AGENTS.md" : null,
    inspection.hasClaudeMd ? "CLAUDE.md" : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(", ");
  return okCheck(
    t("doctor.check.bootstrap_anchor.name"),
    t("doctor.check.bootstrap_anchor.ok", { present }),
  );
}

function inspectKnowledgeDirMissing(projectRoot: string): KnowledgeDirMissingInspection {
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  const missingSubdirs: string[] = [];
  for (const sub of KNOWLEDGE_SUBDIRS) {
    const path = join(knowledgeRoot, sub);
    if (!existsSync(path)) {
      missingSubdirs.push(`.fabric/knowledge/${sub}`);
    }
  }
  return { missingSubdirs };
}

// v2.0.0-rc.22 TASK-006: scan canonical knowledge subdirs for bare-slug
// baseline files (e.g. `code-style.md`) — the pre-rc.22 emit format. Files
// matching the id-prefixed pattern are skipped; bare-slug files have their
// frontmatter `id:` parsed and are flagged only when that id is in the
// baseline allowlist (so a user-promoted `KP-DEC-0001--slug.md` mis-named
// `slug.md` is intentionally NOT flagged here — that's an unrelated invariant).
// Personal-layer files outside the project root are NOT inspected (only
// project-local `.fabric/knowledge/{canonical-type}/` is scanned).
function inspectBaselineFilenameFormat(projectRoot: string): BaselineFilenameFormatInspection {
  const offenders: BaselineFilenameFormatOffender[] = [];
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  if (!existsSync(knowledgeRoot)) {
    return { offenders };
  }
  for (const sub of KNOWLEDGE_CANONICAL_TYPE_DIRS) {
    const dir = join(knowledgeRoot, sub);
    if (!existsSync(dir)) {
      continue;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryName = entry.name;
      if (!entry.isFile() || !entryName.endsWith(".md")) {
        continue;
      }
      if (BASELINE_ID_PREFIXED_FILENAME_PATTERN.test(entryName)) {
        continue;
      }
      const abs = join(dir, entryName);
      let source: string;
      try {
        source = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const id = extractKnowledgeFrontmatterId(source);
      if (id === null) {
        continue;
      }
      if (!BASELINE_FILENAME_LINT_BASELINE_IDS.has(id)) {
        continue;
      }
      offenders.push({
        path: posix.join(".fabric/knowledge", sub, entryName),
        stable_id: id,
      });
    }
  }
  offenders.sort((a, b) => a.path.localeCompare(b.path));
  return { offenders };
}

function createBaselineFilenameFormatCheck(
  t: Translator,
  inspection: BaselineFilenameFormatInspection,
): DoctorCheck {
  if (inspection.offenders.length === 0) {
    return okCheck(
      t("doctor.check.baseline_filename_format.name"),
      t("doctor.check.baseline_filename_format.ok"),
    );
  }
  const first = inspection.offenders[0];
  const detail = `${first.stable_id} at ${first.path}`;
  const count = inspection.offenders.length;
  return issueCheck(
    t("doctor.check.baseline_filename_format.name"),
    "error",
    "manual_error",
    "lint-baseline-filename-format",
    t(`doctor.check.baseline_filename_format.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    t("doctor.check.baseline_filename_format.remediation"),
  );
}

function createKnowledgeDirMissingCheck(t: Translator, inspection: KnowledgeDirMissingInspection): DoctorCheck {
  if (inspection.missingSubdirs.length > 0) {
    const list = inspection.missingSubdirs.join(", ");
    const count = inspection.missingSubdirs.length;
    return issueCheck(
      t("doctor.check.knowledge_dir_missing.name"),
      "error",
      "fixable_error",
      "knowledge_dir_missing",
      t(`doctor.check.knowledge_dir_missing.message.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
        list,
      }),
      t("doctor.check.knowledge_dir_missing.remediation"),
    );
  }
  return okCheck(
    t("doctor.check.knowledge_dir_missing.name"),
    t("doctor.check.knowledge_dir_missing.ok", { count: String(KNOWLEDGE_SUBDIRS.length) }),
  );
}

function createForensicCheck(
  t: Translator,
  forensic: Awaited<ReturnType<typeof inspectForensic>>,
  frameworkKind: string,
  entryPointCount: number,
): DoctorCheck {
  if (!forensic.present) {
    return issueCheck(
      t("doctor.check.forensic.name"),
      "error",
      "manual_error",
      "forensic_missing",
      t(`doctor.check.forensic.message.missing.${entryPointCount === 1 ? "singular" : "plural"}`, {
        error: forensic.error ?? t("doctor.check.forensic.message.missing-default"),
        frameworkKind,
        count: String(entryPointCount),
      }),
      t("doctor.check.forensic.remediation"),
    );
  }
  if (!forensic.valid) {
    return issueCheck(
      t("doctor.check.forensic.name"),
      "error",
      "manual_error",
      "forensic_invalid",
      forensic.error ?? t("doctor.check.forensic.message.invalid-default"),
      t("doctor.check.forensic.remediation"),
    );
  }
  return okCheck(
    t("doctor.check.forensic.name"),
    t("doctor.check.forensic.ok", { frameworkKind: forensic.report?.framework.kind ?? "unknown" }),
  );
}

// v2.0: `createInitContextCheck` removed alongside `inspectInitContext` —
// see comment at the call site in `runDoctorReport`.

function createMetaCheck(
  t: Translator,
  meta: MetaInspection,
  globalCli?: GlobalCliInspection,
): DoctorCheck {
  if (!meta.present) {
    return issueCheck(
      t("doctor.check.agents_meta.name"),
      "error",
      "fixable_error",
      "agents_meta_missing",
      t("doctor.check.agents_meta.message.missing"),
      t("doctor.check.agents_meta.remediation.missing"),
    );
  }
  if (!meta.valid) {
    // rc.35 TASK-09 (P0-14): swap the raw ZodError JSON dump for a human
    // sentence. Three message paths:
    //   1. Global CLI is outdated (TASK-04 already detected it) → prioritise
    //      the version-mismatch story because it is the most common root
    //      cause of schema errors against rc.31+ projects.
    //   2. ZodError → format up to 3 issues as `field=value reason`.
    //   3. JSON syntax error or other → keep the original message but wrap
    //      it with the standard remediation pointer.
    if (globalCli && globalCli.status === "outdated") {
      return issueCheck(
        t("doctor.check.agents_meta.name"),
        "error",
        "manual_error",
        "agents_meta_invalid_global_cli_outdated",
        t("doctor.check.agents_meta.message.invalid-from-old-cli", {
          version: globalCli.version,
          minVersion: globalCli.minVersion,
        }),
        t("doctor.check.global_cli_outdated.remediation"),
      );
    }
    if (meta.readErrorKind === "zod" && meta.readErrorZodIssues && meta.readErrorZodIssues.length > 0) {
      const formatted = meta.readErrorZodIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ");
      return issueCheck(
        t("doctor.check.agents_meta.name"),
        "error",
        "manual_error",
        "agents_meta_invalid",
        t("doctor.check.agents_meta.message.invalid-zod", { issues: formatted }),
        t("doctor.check.agents_meta.remediation.invalid"),
      );
    }
    return issueCheck(
      t("doctor.check.agents_meta.name"),
      "error",
      "manual_error",
      "agents_meta_invalid",
      meta.readError ?? t("doctor.check.agents_meta.message.invalid-default"),
      t("doctor.check.agents_meta.remediation.invalid"),
    );
  }
  if (meta.stale) {
    // rc.22 TASK-012: demoted error → warning. The engine auto-heals stale meta
    // on the next plan-context / get-sections MCP call (lazy reconcile), so a
    // detected drift is benign by the time a human looks at it. We keep the
    // check visible (operator wants to see drift for transient debugging) but
    // exit code 0 unless --strict is set. The fix path at the warnings guard
    // (see runDoctorFix) still reconciles when --fix is invoked explicitly.
    //
    // rc.36 TASK-07 (P1-2): byte-equal revisions but stale=true (driven by
    // `changed` flag, e.g. mtime-only drift) — show a clearer message that
    // explains the hashes are identical and the staleness is non-content.
    const revision = meta.revision;
    const computedRevision = meta.computedRevision ?? "<unknown>";
    const messageKey =
      revision !== null && revision === meta.computedRevision
        ? "doctor.check.agents_meta.message.stale_hash_equal"
        : "doctor.check.agents_meta.message.stale";
    return issueCheck(
      t("doctor.check.agents_meta.name"),
      "warn",
      "warning",
      "agents_meta_stale",
      t(messageKey, { revision, computedRevision }),
      t("doctor.check.agents_meta.remediation.stale"),
    );
  }
  return okCheck(
    t("doctor.check.agents_meta.name"),
    t("doctor.check.agents_meta.ok", { revision: meta.revision }),
  );
}

function createRuleContentRefCheck(t: Translator, meta: MetaInspection): DoctorCheck {
  if (!meta.valid) {
    return issueCheck(
      t("doctor.check.rule_content_refs.name"),
      "error",
      "manual_error",
      "content_refs_unavailable",
      t("doctor.check.rule_content_refs.message.unavailable"),
      t("doctor.check.rule_content_refs.remediation.unavailable"),
    );
  }

  if (meta.invalidContentRefs.length > 0) {
    const count = meta.invalidContentRefs.length;
    return issueCheck(
      t("doctor.check.rule_content_refs.name"),
      "error",
      "manual_error",
      "content_ref_outside_rules",
      t(`doctor.check.rule_content_refs.message.outside.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
      }),
      t("doctor.check.rule_content_refs.remediation.outside"),
    );
  }

  if (meta.missingContentRefs.length > 0) {
    // content_ref_missing is fixable: reconcileKnowledge rebuilds agents.meta.json from
    // the physical .fabric/knowledge/**/*.md files, dropping any stale refs automatically.
    const count = meta.missingContentRefs.length;
    return issueCheck(
      t("doctor.check.rule_content_refs.name"),
      "error",
      "fixable_error",
      "content_ref_missing",
      t(`doctor.check.rule_content_refs.message.missing.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
      }),
      t("doctor.check.rule_content_refs.remediation.missing"),
    );
  }

  return okCheck(t("doctor.check.rule_content_refs.name"), t("doctor.check.rule_content_refs.ok"));
}

function createKnowledgeTestIndexCheck(t: Translator, index: KnowledgeTestIndexInspection): DoctorCheck {
  if (!index.present) {
    return issueCheck(
      t("doctor.check.knowledge_test_index.name"),
      "error",
      "fixable_error",
      "knowledge_test_index_missing",
      index.error,
      t("doctor.check.knowledge_test_index.remediation.missing"),
    );
  }
  if (!index.valid) {
    return issueCheck(
      t("doctor.check.knowledge_test_index.name"),
      "error",
      "manual_error",
      "knowledge_test_index_invalid",
      index.error,
      t("doctor.check.knowledge_test_index.remediation.invalid"),
    );
  }
  if (index.stale) {
    return issueCheck(
      t("doctor.check.knowledge_test_index.name"),
      "error",
      "fixable_error",
      "knowledge_test_index_stale",
      t("doctor.check.knowledge_test_index.message.stale"),
      t("doctor.check.knowledge_test_index.remediation.stale"),
    );
  }
  return okCheck(
    t("doctor.check.knowledge_test_index.name"),
    t(
      `doctor.check.knowledge_test_index.ok.${index.linkCount === 1 ? "link_singular" : "link_plural"}.${index.orphanCount === 1 ? "orphan_singular" : "orphan_plural"}`,
      { linkCount: String(index.linkCount), orphanCount: String(index.orphanCount) },
    ),
  );
}

// v2.0.0-rc.37 Wave B (B5): composite hard-gate check for events.jsonl /
// metrics.jsonl health. Surfaces G7 (size) / G8 (metric leak) /
// G9 (metrics staleness) / G10 (rotation overdue) as a single
// warning-severity finding. G11 is a code-time invariant verified by
// services/events-jsonl-gates.test.ts.
function createEventsJsonlHealthCheck(
  t: Translator,
  report: EventsJsonlGatesReport,
): DoctorCheck {
  const findings: string[] = [];
  if (report.ledgerSizeWarn) {
    findings.push(
      t("doctor.check.events_jsonl_health.message.size", {
        sizeMb: (report.ledgerSizeBytes / (1024 * 1024)).toFixed(1),
      }),
    );
  }
  if (report.metricLeakCount > 0) {
    findings.push(
      t("doctor.check.events_jsonl_health.message.metric_leak", {
        count: String(report.metricLeakCount),
        samples: report.metricLeakSamples.join(", "),
      }),
    );
  }
  if (report.metricsStaleWarn && report.metricsStalenessMs !== null) {
    findings.push(
      t("doctor.check.events_jsonl_health.message.metrics_stale", {
        minutes: String(Math.floor(report.metricsStalenessMs / 60_000)),
      }),
    );
  }
  if (report.rotationOverdueWarn && report.ledgerStalenessMs !== null) {
    findings.push(
      t("doctor.check.events_jsonl_health.message.rotation_overdue", {
        days: String(Math.floor(report.ledgerStalenessMs / 86_400_000)),
      }),
    );
  }
  if (findings.length === 0) {
    return okCheck(
      t("doctor.check.events_jsonl_health.name"),
      t("doctor.check.events_jsonl_health.ok"),
    );
  }
  return issueCheck(
    t("doctor.check.events_jsonl_health.name"),
    "warn",
    "warning",
    "events_jsonl_health_degraded",
    findings.join(" | "),
    t("doctor.check.events_jsonl_health.remediation"),
  );
}

function createEventLedgerCheck(t: Translator, ledger: EventLedgerInspection): DoctorCheck {
  if (!ledger.exists) {
    return issueCheck(
      t("doctor.check.event_ledger.name"),
      "error",
      "fixable_error",
      "event_ledger_missing",
      t("doctor.check.event_ledger.message.missing"),
      t("doctor.check.event_ledger.remediation.missing"),
    );
  }
  if (!ledger.writable) {
    return issueCheck(
      t("doctor.check.event_ledger.name"),
      "error",
      "manual_error",
      "event_ledger_not_writable",
      ledger.error ?? t("doctor.check.event_ledger.message.not_writable-default"),
      t("doctor.check.event_ledger.remediation.not_writable"),
    );
  }
  if (!ledger.parseable) {
    return issueCheck(
      t("doctor.check.event_ledger.name"),
      "error",
      "manual_error",
      "event_ledger_invalid",
      ledger.error ?? t("doctor.check.event_ledger.message.invalid-default"),
      t("doctor.check.event_ledger.remediation.invalid"),
    );
  }
  return okCheck(t("doctor.check.event_ledger.name"), t("doctor.check.event_ledger.ok"));
}

function createMcpConfigInWrongFileCheck(t: Translator, inspection: McpConfigInWrongFileInspection): DoctorCheck {
  if (inspection.hasWrongEntry) {
    return issueCheck(
      t("doctor.check.mcp_config_in_wrong_file.name"),
      "error",
      "fixable_error",
      "mcp_config_in_wrong_file",
      t("doctor.check.mcp_config_in_wrong_file.message"),
      t("doctor.check.mcp_config_in_wrong_file.remediation"),
    );
  }

  return okCheck(
    t("doctor.check.mcp_config_in_wrong_file.name"),
    t("doctor.check.mcp_config_in_wrong_file.ok"),
  );
}

// v2.0.0-rc.27 TASK-010 (audit §2.24): surfaces forward-compat warnings when
// events.jsonl contains rows the current parser cannot validate (legacy
// schema_version != 1 OR an event_type not in the discriminator set). Both
// states usually mean the operator needs to pick between two recoveries:
//   1) archive + recreate events.jsonl (when stale rc.0/rc.1 rows linger), or
//   2) upgrade the CLI (when a newer server emitted a token this CLI does not
//      yet recognise).
// `warning` severity, not `error` — readEventLedger already silently drops
// these rows so the workspace continues to function; the check exists to
// stop the audit blind-spot, not to block progress.
function createEventLedgerSchemaCompatCheck(
  t: Translator,
  ledger: EventLedgerInspection,
): DoctorCheck {
  if (!ledger.exists || !ledger.writable) {
    return okCheck(
      t("doctor.check.event_ledger_schema_compat.name"),
      t("doctor.check.event_ledger_schema_compat.ok.skipped"),
    );
  }
  const hasUnsupportedVersion = ledger.schemaVersionUnsupportedCount > 0;
  const hasUnknownEventType = ledger.eventTypeUnknownCount > 0;
  if (!hasUnsupportedVersion && !hasUnknownEventType) {
    return okCheck(
      t("doctor.check.event_ledger_schema_compat.name"),
      t("doctor.check.event_ledger_schema_compat.ok.clean"),
    );
  }
  const parts: string[] = [];
  if (hasUnsupportedVersion) {
    parts.push(
      t("doctor.check.event_ledger_schema_compat.message.schema_version", {
        count: String(ledger.schemaVersionUnsupportedCount),
        samples: ledger.schemaVersionSamples.join(", "),
      }),
    );
  }
  if (hasUnknownEventType) {
    parts.push(
      t("doctor.check.event_ledger_schema_compat.message.event_type", {
        count: String(ledger.eventTypeUnknownCount),
        samples: ledger.eventTypeSamples.join(", "),
      }),
    );
  }
  return issueCheck(
    t("doctor.check.event_ledger_schema_compat.name"),
    "warn",
    "warning",
    "event_ledger_schema_compat",
    parts.join(" "),
    t("doctor.check.event_ledger_schema_compat.remediation"),
  );
}

// v2.0.0-rc.28 TASK-04 (audit §3.1): doctor check that surfaces mirror-parity
// drift between `.claude/skills/<slug>/ref/` and `.codex/skills/<slug>/ref/`.
// `warning` severity (not `error`): the workspace stays functional; the
// concern is that an LLM consulting the drifted ref/ file may see different
// content depending on which client surfaced it. `fabric install` restores
// parity by rewriting both subtrees from the canonical templates/.
function createSkillRefMirrorCheck(
  t: Translator,
  inspection: SkillRefMirrorInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.skill_ref_mirror.name"),
      t("doctor.check.skill_ref_mirror.ok"),
    );
  }
  return issueCheck(
    t("doctor.check.skill_ref_mirror.name"),
    "warn",
    "warning",
    "skill_ref_mirror_drift",
    t("doctor.check.skill_ref_mirror.message", {
      count: String(inspection.driftedPaths.length),
      list: inspection.driftedPaths.join(", "),
    }),
    t("doctor.check.skill_ref_mirror.remediation"),
  );
}

// v2.0.0-rc.33 W3-6 (P1-13): create the SKILL.md token budget check. Warning
// at 5K, error at 10K — sized for Anthropic's progressive disclosure target
// (~3K hot path). The check message lists each over-budget slug with its
// estimated token count so the operator knows which file to split first.
function createSkillTokenBudgetCheck(
  t: Translator,
  inspection: SkillTokenBudgetInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.skill_token_budget.name"),
      t("doctor.check.skill_token_budget.ok"),
    );
  }
  const list = inspection.overSize
    .map((s) => `${s.slug}=${s.tokens} tok (${s.severity})`)
    .join(", ");
  const count = inspection.overSize.length;
  return issueCheck(
    t("doctor.check.skill_token_budget.name"),
    inspection.status,
    inspection.status === "error" ? "manual_error" : "warning",
    "skill_token_budget_exceeded",
    t(`doctor.check.skill_token_budget.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      list,
    }),
    t("doctor.check.skill_token_budget.remediation"),
    // rc.35 TASK-12 (P0-11): maintainer audience. Remediation points at
    // `packages/cli/templates/skills/*` source — only Fabric contributors
    // can act. CLI renderer folds by default; --verbose unfolds.
    "maintainer",
  );
}

// v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog check. Single ratio + count
// message — operator does not need a per-entry breakdown to act on the signal
// (the action is "run fabric-review to promote drafts" regardless of which
// entries are involved).
function createDraftBacklogCheck(
  t: Translator,
  inspection: DraftBacklogInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.draft_backlog.name"),
      t("doctor.check.draft_backlog.ok"),
    );
  }
  const pct = Math.round(inspection.ratio * 100);
  return issueCheck(
    t("doctor.check.draft_backlog.name"),
    "warn",
    "warning",
    "knowledge_draft_backlog",
    t("doctor.check.draft_backlog.message", {
      draftCount: String(inspection.draftCount),
      totalCount: String(inspection.totalCount),
      pct: String(pct),
    }),
    t("doctor.check.draft_backlog.remediation"),
  );
}

// rc.36 TASK-09 (P1-NEW1): drift detection without subsequent demote — KB
// dies slowly when drift events are emitted but no human/auto action follows.
// 30-day window: if drift events > 0 AND zero knowledge_demoted in same
// window, warn the operator that drift is observed but unconsumed.
type DriftUnconsumedInspection = {
  status: "ok" | "warn";
  driftCount: number;
  demoteCount: number;
};

async function inspectDriftUnconsumed(projectRoot: string): Promise<DriftUnconsumedInspection> {
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const MIN_DRIFT_FOR_WARN = 5;
  const cutoffMs = Date.now() - WINDOW_MS;
  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { status: "ok", driftCount: 0, demoteCount: 0 };
  }
  let driftCount = 0;
  let demoteCount = 0;
  for (const e of events) {
    if (e.ts < cutoffMs) continue;
    if (e.event_type === "knowledge_drift_detected") driftCount += 1;
    else if (e.event_type === "knowledge_demoted") demoteCount += 1;
  }
  // rc.36 TASK-32 review-iter-1 fix: warn whenever drift events outnumber
  // demote events by the threshold. The earlier `demoteCount === 0` form
  // cleared the warning the moment a single demote landed, even if 10 drift
  // events remained unconsumed. Per-event pairing is deferred to the rc.37
  // auto-demote pipeline; this count-delta heuristic is sufficient until then.
  const unconsumed = driftCount - demoteCount;
  return {
    status: unconsumed >= MIN_DRIFT_FOR_WARN ? "warn" : "ok",
    driftCount,
    demoteCount,
  };
}

function createDriftUnconsumedCheck(
  t: Translator,
  inspection: DriftUnconsumedInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.drift_unconsumed.name"),
      t("doctor.check.drift_unconsumed.ok"),
    );
  }
  return issueCheck(
    t("doctor.check.drift_unconsumed.name"),
    "warn",
    "warning",
    "knowledge_drift_unconsumed",
    t("doctor.check.drift_unconsumed.message", {
      driftCount: String(inspection.driftCount),
      demoteCount: String(inspection.demoteCount),
    }),
    t("doctor.check.drift_unconsumed.remediation"),
  );
}

// rc.36 TASK-05 (P0-8): empty-tags warn check.
function createKnowledgeTagsEmptyCheck(
  t: Translator,
  inspection: EmptyTagsInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.knowledge_tags_empty.name"),
      t("doctor.check.knowledge_tags_empty.ok"),
    );
  }
  const pct = Math.round(inspection.ratio * 100);
  return issueCheck(
    t("doctor.check.knowledge_tags_empty.name"),
    "warn",
    "warning",
    "knowledge_tags_empty_ratio",
    t("doctor.check.knowledge_tags_empty.message", {
      emptyCount: String(inspection.emptyCount),
      totalCount: String(inspection.totalCount),
      pct: String(pct),
    }),
    t("doctor.check.knowledge_tags_empty.remediation"),
  );
}

// v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart check. Aggregates fired
// patterns into a single multi-line message so the operator gets the full
// audit hit list in one report row. Always warning severity — Goodhart
// heuristics are advisory, not error-grade.
function createCiteGoodhartCheck(
  t: Translator,
  inspection: CiteGoodhartInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.cite_goodhart.name"),
      t("doctor.check.cite_goodhart.ok"),
    );
  }
  const list = inspection.fired.map((f) => `${f.pattern}: ${f.detail}`).join("; ");
  const count = inspection.fired.length;
  return issueCheck(
    t("doctor.check.cite_goodhart.name"),
    "warn",
    "warning",
    "cite_goodhart_pattern",
    t(`doctor.check.cite_goodhart.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      list,
    }),
    t("doctor.check.cite_goodhart.remediation"),
    // rc.35 TASK-12 (P0-11): maintainer audience. G1/G2/G3/G5 are internal
    // pattern codes from the cite-policy design memo — npm end users have
    // no actionable lever for these. Fold by default; --verbose unfolds.
    "maintainer",
  );
}

// v2.0.0-rc.33 W3-7 (P1-14): create the SKILL.md description structural lint
// check. Always `warn` severity (never error) — a bad description hurts
// auto-invoke recall but doesn't break correctness. The message enumerates
// each per-slug issue so the operator can fix without re-running inspection.
function createSkillDescriptionCheck(
  t: Translator,
  inspection: SkillDescriptionLintInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.skill_description.name"),
      t("doctor.check.skill_description.ok"),
    );
  }
  const list = inspection.issues
    .map((i) => `${i.slug}: ${i.problem} (${i.detail})`)
    .join("; ");
  const count = inspection.issues.length;
  return issueCheck(
    t("doctor.check.skill_description.name"),
    "warn",
    "warning",
    "skill_description_quality",
    t(`doctor.check.skill_description.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      list,
    }),
    t("doctor.check.skill_description.remediation"),
    // rc.35 TASK-12 (P0-11): maintainer audience. Remediation points at
    // `packages/cli/templates/skills/<slug>/SKILL.md` frontmatter.
    "maintainer",
  );
}

function createEventLedgerPartialWriteCheck(t: Translator, ledger: EventLedgerInspection): DoctorCheck {
  if (!ledger.exists || !ledger.writable) {
    return okCheck(
      t("doctor.check.event_ledger_partial_write.name"),
      t("doctor.check.event_ledger_partial_write.ok.skipped"),
    );
  }
  if (ledger.hasPartialWrite) {
    return issueCheck(
      t("doctor.check.event_ledger_partial_write.name"),
      "error",
      "fixable_error",
      "event_ledger_partial_write",
      t("doctor.check.event_ledger_partial_write.message", {
        byteOffset: String(ledger.partialWriteByteOffset),
        byteLength: String(ledger.partialWriteByteLength),
      }),
      t("doctor.check.event_ledger_partial_write.remediation"),
    );
  }
  return okCheck(
    t("doctor.check.event_ledger_partial_write.name"),
    t("doctor.check.event_ledger_partial_write.ok.clean"),
  );
}

function okCheck(name: string, message: string): DoctorCheck {
  return { name, status: "ok", message };
}

// rc.31 BUG-M3/NEW-4: hooks_wired inspection.
//
// Verifies project-local .claude/settings.json declares all three fabric hooks
// (fabric-hint at Stop, knowledge-hint-broad at SessionStart, knowledge-hint-
// narrow at PreToolUse). The audit symptom this addresses: `fabric install` dry-
// run reported "hooks=是 mcp-install=global" but actual settings.json had
// zero fabric references — the user had no way to verify the injection
// happened. By surfacing the wired state at doctor-time, partial / corrupted
// installs become detectable.
//
// Skipped (ok) when there is no .claude/ directory at all (project does not
// use Claude Code; nothing to check). Returns "missing" when the dir exists
// but settings.json is absent or unparseable. "incomplete" when settings is
// parseable but one or more fabric hook references are missing.
type HooksWiredStatus = "ok" | "skipped" | "missing-settings" | "incomplete";
type HooksWiredInspection = {
  status: HooksWiredStatus;
  missingHooks: string[];
};

function inspectHooksWired(projectRoot: string): HooksWiredInspection {
  const claudeDir = join(projectRoot, ".claude");
  if (!existsSync(claudeDir)) {
    return { status: "skipped", missingHooks: [] };
  }
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return { status: "missing-settings", missingHooks: [] };
  }
  let raw: string;
  try {
    raw = readFileSync(settingsPath, "utf8");
  } catch {
    return { status: "missing-settings", missingHooks: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "missing-settings", missingHooks: [] };
  }
  const required: Array<{ event: string; hookFile: string }> = [
    { event: "Stop", hookFile: "fabric-hint.cjs" },
    { event: "SessionStart", hookFile: "knowledge-hint-broad.cjs" },
    { event: "PreToolUse", hookFile: "knowledge-hint-narrow.cjs" },
  ];
  const missing: string[] = [];
  const hooksSection = isRecord(parsed) ? parsed.hooks : undefined;
  for (const { event, hookFile } of required) {
    if (!isHookWiredForEvent(hooksSection, event, hookFile)) {
      missing.push(`${event}:${hookFile}`);
    }
  }
  if (missing.length === 0) {
    return { status: "ok", missingHooks: [] };
  }
  return { status: "incomplete", missingHooks: missing };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHookWiredForEvent(hooks: unknown, event: string, hookFile: string): boolean {
  if (!isRecord(hooks)) return false;
  const eventEntries = hooks[event];
  if (!Array.isArray(eventEntries)) return false;
  for (const matcherBlock of eventEntries) {
    if (!isRecord(matcherBlock)) continue;
    const inner = matcherBlock.hooks;
    if (!Array.isArray(inner)) continue;
    for (const hookEntry of inner) {
      if (!isRecord(hookEntry)) continue;
      const cmd = hookEntry.command;
      if (typeof cmd === "string" && cmd.includes(hookFile)) {
        return true;
      }
    }
  }
  return false;
}

function createHooksWiredCheck(t: Translator, inspection: HooksWiredInspection): DoctorCheck {
  if (inspection.status === "skipped") {
    return okCheck(
      t("doctor.check.hooks_wired.name"),
      t("doctor.check.hooks_wired.ok.skipped"),
    );
  }
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.hooks_wired.name"),
      t("doctor.check.hooks_wired.ok.wired"),
    );
  }
  if (inspection.status === "missing-settings") {
    return issueCheck(
      t("doctor.check.hooks_wired.name"),
      "warn",
      "warning",
      "hooks_wired_missing_settings",
      t("doctor.check.hooks_wired.message.missing_settings"),
      t("doctor.check.hooks_wired.remediation"),
    );
  }
  return issueCheck(
    t("doctor.check.hooks_wired.name"),
    "warn",
    "warning",
    "hooks_wired_incomplete",
    t("doctor.check.hooks_wired.message.incomplete", {
      missing: inspection.missingHooks.join(", "),
    }),
    t("doctor.check.hooks_wired.remediation"),
  );
}

// v2.0.0-rc.37 NEW-27: hook-content cross-client drift.
//
// `fabric install` copies the SAME canonical template into each of the three
// client `<client>/hooks/` directories. If a user manually edits one copy
// (debugging a hook, accidentally), drift accumulates — the same hook fires
// differently across clients. This check verifies cross-client sha256 parity:
// for each hook basename present in MORE than one client root, all copies
// must hash identically.
//
// Distinct from hooks_runtime (rc.37 NEW-20): that one validates each file
// in isolation (shebang + parseable). This one is the *consistency* gate:
// hooks_runtime passes if every copy individually parses but copies have
// silently diverged. Together they cover the fault tree.
//
// Note: cross-client byte-equality is the *desired* invariant — `fabric
// install` copies the same template bytes to each client root. We don't
// need access to the original template here; equality between deployed
// copies is sufficient signal. Single-client workspaces (e.g. only .claude/
// exists) trivially pass.
type HookContentDriftPair = {
  basename: string;
  clients: Array<"claude" | "codex" | "cursor">;
  hashes: Array<{ client: string; sha: string }>;
};
type HooksContentDriftInspection = {
  scanned: number;
  drifts: HookContentDriftPair[];
};

function inspectHooksContentDrift(projectRoot: string): HooksContentDriftInspection {
  const hookFilesByBasename = new Map<
    string,
    Array<{ client: "claude" | "codex" | "cursor"; abs: string }>
  >();
  for (const { client, dir } of HOOKS_RUNTIME_CLIENT_DIRS) {
    const absDir = join(projectRoot, dir);
    if (!existsSync(absDir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".cjs")) continue;
      const abs = join(absDir, name);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const arr = hookFilesByBasename.get(name) ?? [];
      arr.push({ client, abs });
      hookFilesByBasename.set(name, arr);
    }
  }
  const drifts: HookContentDriftPair[] = [];
  let scanned = 0;
  for (const [basename, copies] of hookFilesByBasename) {
    if (copies.length < 2) continue; // single-client install — nothing to compare
    scanned += copies.length;
    const hashes: Array<{ client: string; sha: string }> = [];
    for (const { client, abs } of copies) {
      try {
        const body = readFileSync(abs);
        hashes.push({ client, sha: sha256(body.toString("utf8")) });
      } catch {
        // unreadable copy — let hooks_runtime catch it; skip drift comparison
      }
    }
    if (hashes.length < 2) continue;
    const first = hashes[0].sha;
    if (hashes.some((h) => h.sha !== first)) {
      drifts.push({
        basename,
        clients: copies.map((c) => c.client),
        hashes,
      });
    }
  }
  drifts.sort((a, b) => a.basename.localeCompare(b.basename));
  return { scanned, drifts };
}

function createHooksContentDriftCheck(
  t: Translator,
  inspection: HooksContentDriftInspection,
): DoctorCheck {
  if (inspection.scanned === 0) {
    return okCheck(
      t("doctor.check.hooks_content_drift.name"),
      t("doctor.check.hooks_content_drift.ok.skipped"),
    );
  }
  if (inspection.drifts.length === 0) {
    return okCheck(
      t("doctor.check.hooks_content_drift.name"),
      t("doctor.check.hooks_content_drift.ok.aligned", {
        count: String(inspection.scanned),
      }),
    );
  }
  const first = inspection.drifts[0];
  return issueCheck(
    t("doctor.check.hooks_content_drift.name"),
    "warn",
    "warning",
    "hooks_content_drift",
    t("doctor.check.hooks_content_drift.message", {
      count: String(inspection.drifts.length),
      first_basename: first.basename,
      first_clients: first.clients.join(", "),
    }),
    t("doctor.check.hooks_content_drift.remediation"),
  );
}

// v2.0.0-rc.37 NEW-20: hooks runtime health.
//
// hooks_wired (above) checks that settings.json *references* the right hook
// files. NEW-20 closes the next-layer gap: are the referenced .cjs files
// (a) present on disk, (b) starting with a `#!` shebang, and (c) parseable
// as Node.js? An install that wrote settings.json but left a hook file
// corrupted will silently fail at session-start — this check catches that
// before the user blames the client.
//
// Scope: scans `<client_dir>/hooks/*.cjs` for the three known client roots
// (`.claude/`, `.codex/`, `.cursor/`). Each file:
//   1. Must read successfully.
//   2. Must start with `#!` (POSIX hook contract — `fabric install` always
//      writes the `#!/usr/bin/env node` shebang).
//   3. Must parse cleanly via `new vm.Script(code)`. Parsing is pure (no
//      execution), so user code is never run by doctor — keeps the check
//      cheap and safe.
//
// Hook files inside per-client `lib/` subdirs are skipped (they're libraries
// loaded via require, not standalone scripts; no shebang requirement).
type HookRuntimeIssue = {
  path: string;
  client: "claude" | "codex" | "cursor";
  kind: "missing_shebang" | "parse_error" | "read_error";
  detail: string;
};
type HooksRuntimeInspection = {
  scanned: number;
  issues: HookRuntimeIssue[];
};

const HOOKS_RUNTIME_CLIENT_DIRS: Array<{ client: "claude" | "codex" | "cursor"; dir: string }> = [
  { client: "claude", dir: ".claude/hooks" },
  { client: "codex", dir: ".codex/hooks" },
  { client: "cursor", dir: ".cursor/hooks" },
];

function inspectHooksRuntime(projectRoot: string): HooksRuntimeInspection {
  const issues: HookRuntimeIssue[] = [];
  let scanned = 0;
  for (const { client, dir } of HOOKS_RUNTIME_CLIENT_DIRS) {
    const absDir = join(projectRoot, dir);
    if (!existsSync(absDir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".cjs")) continue;
      const abs = join(absDir, name);
      const displayPath = `${dir}/${name}`;
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      scanned += 1;
      let body: string;
      try {
        body = readFileSync(abs, "utf8");
      } catch (err) {
        issues.push({
          path: displayPath,
          client,
          kind: "read_error",
          detail: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (!body.startsWith("#!")) {
        issues.push({
          path: displayPath,
          client,
          kind: "missing_shebang",
          detail: "first line is not a `#!` shebang",
        });
      }
      try {
        new Script(body, { filename: displayPath });
      } catch (err) {
        issues.push({
          path: displayPath,
          client,
          kind: "parse_error",
          detail: err instanceof Error ? err.message.split("\n")[0] : String(err),
        });
      }
    }
  }
  issues.sort((a, b) => a.path.localeCompare(b.path));
  return { scanned, issues };
}

function createHooksRuntimeCheck(
  t: Translator,
  inspection: HooksRuntimeInspection,
): DoctorCheck {
  if (inspection.scanned === 0) {
    return okCheck(
      t("doctor.check.hooks_runtime.name"),
      t("doctor.check.hooks_runtime.ok.skipped"),
    );
  }
  if (inspection.issues.length === 0) {
    return okCheck(
      t("doctor.check.hooks_runtime.name"),
      t("doctor.check.hooks_runtime.ok.healthy", {
        count: String(inspection.scanned),
      }),
    );
  }
  const first = inspection.issues[0];
  const count = inspection.issues.length;
  return issueCheck(
    t("doctor.check.hooks_runtime.name"),
    "warn",
    "warning",
    "hooks_runtime_invalid",
    t(`doctor.check.hooks_runtime.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      first_path: first.path,
      first_detail: `${first.kind}: ${first.detail}`,
    }),
    t("doctor.check.hooks_runtime.remediation"),
  );
}

// rc.31 BUG-G2/G5: promote-ledger invariant inspection.
//
// Invariant: proposed_count >= promote_started_count >= promoted_count.
// Counter-examples surface ledger emit-cadence bugs (e.g. werewolf-minigame
// rc.30 audit: proposed=17, started=48, promoted=52 — both proposed<started
// and started<promoted violated). The check is observability-only and never
// blocks --fix; remediation is to verify all 3 events fire in extract+approve
// paths or rerun fabric doctor after rc.31 review.approve synth fix.
type PromoteLedgerInvariantInspection = {
  proposedCount: number;
  promoteStartedCount: number;
  promotedCount: number;
  violation: "proposed-lt-started" | "started-lt-promoted" | null;
};

async function inspectPromoteLedgerInvariant(
  projectRoot: string,
): Promise<PromoteLedgerInvariantInspection> {
  const [proposed, started, promoted] = await Promise.all([
    readEventLedger(projectRoot, { event_type: "knowledge_proposed" }),
    readEventLedger(projectRoot, { event_type: "knowledge_promote_started" }),
    readEventLedger(projectRoot, { event_type: "knowledge_promoted" }),
  ]);
  const proposedCount = proposed.events.length;
  const promoteStartedCount = started.events.length;
  const promotedCount = promoted.events.length;
  let violation: PromoteLedgerInvariantInspection["violation"] = null;
  if (proposedCount < promoteStartedCount) {
    violation = "proposed-lt-started";
  } else if (promoteStartedCount < promotedCount) {
    violation = "started-lt-promoted";
  }
  return { proposedCount, promoteStartedCount, promotedCount, violation };
}

function createPromoteLedgerInvariantCheck(
  t: Translator,
  inspection: PromoteLedgerInvariantInspection,
): DoctorCheck {
  const params = {
    proposed: String(inspection.proposedCount),
    started: String(inspection.promoteStartedCount),
    promoted: String(inspection.promotedCount),
  };
  if (inspection.violation === null) {
    return okCheck(
      t("doctor.check.promote_ledger_invariant.name"),
      t("doctor.check.promote_ledger_invariant.ok", params),
    );
  }
  return issueCheck(
    t("doctor.check.promote_ledger_invariant.name"),
    "warn",
    "warning",
    "promote_ledger_invariant_violated",
    t(`doctor.check.promote_ledger_invariant.message.${inspection.violation}`, params),
    t("doctor.check.promote_ledger_invariant.remediation"),
  );
}

/**
 * v2.0.0-rc.37 NEW-39 (werewolf dogfood remediation): backfill emitter that
 * heals a violated `promote_ledger_invariant` warning.
 *
 * Werewolf 实测: proposed=20 < promote_started=49 < promoted=53 — 部分 approve
 * 在 rc.31 BUG-G2 fix 之前 happened without emitting knowledge_proposed (real
 * extract didn't go through fab_extract_knowledge → no propose event). The
 * rc.31 fix made approve emit synth proposed unconditionally going forward,
 * but it CANNOT retroactively heal pre-fix events.
 *
 * This function reads the current inspection, computes the deficit for each
 * lifecycle stage, and emits N synthetic backfill events tagged with reason
 * `doctor-fix-backfill:legacy-N`. After running, the invariant
 * (proposed ≥ promote_started ≥ promoted) is restored.
 *
 * Tagging policy: every backfill event carries a deterministic reason prefix
 * so cite-coverage / ledger consumers can grep them out of historical analyses.
 * No correlation_id / session_id is attached — these are bulk backfills, not
 * tied to any one session.
 *
 * Best-effort emits: each append failure is silently swallowed (per
 * `emitEventBestEffort` semantics). If the ledger is unwritable, the fix
 * degrades gracefully — the warning will re-surface on the next doctor run.
 */
async function fixPromoteLedgerInvariant(projectRoot: string): Promise<void> {
  const inspection = await inspectPromoteLedgerInvariant(projectRoot);
  if (inspection.violation === null) return;

  // Target the MAX of the three counts. After heal: all three equal target.
  // Backfilling to the max simultaneously closes both possible violations
  // (proposed-lt-started AND started-lt-promoted) in one pass — computing
  // each delta against the same fixed snapshot avoids the staleness pitfall
  // where the second loop reads inflated counts from the first loop's emits.
  const target = Math.max(
    inspection.proposedCount,
    inspection.promoteStartedCount,
    inspection.promotedCount,
  );

  // Emit (target - proposedCount) synth proposed events.
  const proposedDelta = target - inspection.proposedCount;
  for (let i = 0; i < proposedDelta; i++) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_proposed",
      timestamp: new Date().toISOString(),
      reason: `doctor-fix-backfill:legacy-proposed-${i}`,
    }).catch(() => {});
  }

  // Emit (target - promoteStartedCount) synth promote_started events.
  const startedDelta = target - inspection.promoteStartedCount;
  for (let i = 0; i < startedDelta; i++) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_promote_started",
      timestamp: new Date().toISOString(),
      reason: `doctor-fix-backfill:legacy-started-${i}`,
    }).catch(() => {});
  }
  // No `knowledge_promoted` backfill — promoted is the "leaf" event;
  // emitting more promoted without corresponding files on disk would be
  // misleading.
}

// rc.35 TASK-04 (P0-9.b): global_cli_outdated inspection.
//
// rc.31 introduced an `.fabric/agents.meta.json` schema fix (z.preprocess
// singular→plural) that is incompatible with rc.30-and-earlier global CLI
// installs. Users who upgraded their PROJECT but left the GLOBAL `fabric`
// binary at rc.30 see hooks silently fail because the binary cannot parse
// the new schema. Doctor previously had no visibility into the global PATH
// CLI, so this fault was invisible to users (P0-9 root cause).
//
// This lint spawns `fabric -v` on PATH, parses the rc.NN suffix, and emits a
// manual_error when the binary is older than MIN_SUPPORTED_VERSION. ENOENT
// (no global binary on PATH) and other spawn-time failures degrade to warn —
// the lint never blocks a doctor run.
const MIN_SUPPORTED_GLOBAL_CLI_VERSION = "2.0.0-rc.31";

type GlobalCliInspection =
  | { status: "ok"; version: string }
  | { status: "outdated"; version: string; minVersion: string }
  | { status: "not-found" }
  | { status: "unparseable"; detail: string };

type GlobalCliSpawnResult = {
  error?: NodeJS.ErrnoException | Error | null;
  status?: number | null;
  stdout?: string;
};

// Injectable for tests — production passes the default spawnSync wrapper.
type GlobalCliSpawnFn = () => GlobalCliSpawnResult;

const defaultGlobalCliSpawn: GlobalCliSpawnFn = () => {
  const res = spawnSync("fabric", ["-v"], {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { error: res.error ?? null, status: res.status, stdout: res.stdout };
};

export function inspectGlobalCliVersion(
  spawn: GlobalCliSpawnFn = defaultGlobalCliSpawn,
): GlobalCliInspection {
  let res: GlobalCliSpawnResult;
  try {
    res = spawn();
  } catch (e) {
    return { status: "unparseable", detail: e instanceof Error ? e.message : String(e) };
  }
  if (res.error) {
    if ((res.error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "not-found" };
    }
    return { status: "unparseable", detail: res.error.message };
  }
  if (res.status !== 0) {
    return { status: "unparseable", detail: `exit ${res.status ?? "?"}` };
  }
  const raw = (res.stdout ?? "").trim();
  const m = /(\d+)\.(\d+)\.(\d+)-rc\.(\d+)/.exec(raw);
  if (!m) {
    return { status: "unparseable", detail: raw.slice(0, 80) };
  }
  const version = `${m[1]}.${m[2]}.${m[3]}-rc.${m[4]}`;
  const observedRc = Number(m[4]);
  const minMatch = /-rc\.(\d+)/.exec(MIN_SUPPORTED_GLOBAL_CLI_VERSION);
  const minRc = minMatch ? Number(minMatch[1]) : 0;
  if (observedRc < minRc) {
    return { status: "outdated", version, minVersion: MIN_SUPPORTED_GLOBAL_CLI_VERSION };
  }
  return { status: "ok", version };
}

export function createGlobalCliVersionCheck(
  t: Translator,
  inspection: GlobalCliInspection,
): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.global_cli_outdated.name"),
      t("doctor.check.global_cli_outdated.ok", { version: inspection.version }),
    );
  }
  if (inspection.status === "outdated") {
    return issueCheck(
      t("doctor.check.global_cli_outdated.name"),
      "error",
      "manual_error",
      "global_cli_outdated",
      t("doctor.check.global_cli_outdated.message.outdated", {
        version: inspection.version,
        minVersion: inspection.minVersion,
      }),
      t("doctor.check.global_cli_outdated.remediation"),
    );
  }
  if (inspection.status === "not-found") {
    return issueCheck(
      t("doctor.check.global_cli_outdated.name"),
      "warn",
      "warning",
      "global_cli_not_found",
      t("doctor.check.global_cli_outdated.message.not_found"),
      t("doctor.check.global_cli_outdated.remediation"),
    );
  }
  return issueCheck(
    t("doctor.check.global_cli_outdated.name"),
    "warn",
    "warning",
    "global_cli_unparseable",
    t("doctor.check.global_cli_outdated.message.unparseable", { detail: inspection.detail }),
    t("doctor.check.global_cli_outdated.remediation"),
  );
}

// rc.35 TASK-05 (P0-10.a): knowledge_summary_opaque inspection.
//
// P0-10 audit on werewolf-eval: 42/43 nodes had description.summary equal to
// the stable_id itself, producing narrow-hint output like "KT-PIT-0001 ·
// KT-PIT-0001" where the AI cannot tell what the entry is about and skips
// fetching it. The fault was invisible to operators because doctor did not
// inspect summary content. This lint counts nodes where
// description.summary == stable_id (after whitespace trim) and warns when
// the opacity ratio exceeds the threshold.
//
// Threshold rationale: a small handful of opaque summaries is benign (rare
// auto-generated stubs). >30% means the corpus itself is unreadable.
const KNOWLEDGE_SUMMARY_OPAQUE_THRESHOLD = 0.30;

export type KnowledgeSummaryOpaqueInspection = {
  status: "skipped" | "ok" | "warn";
  totalWithDescription: number;
  opaqueCount: number;
  ratio: number;
  threshold: number;
  // First few opaque stable_ids for actionable diagnostics; capped to 5 to
  // keep doctor output bounded.
  opaqueSample: string[];
};

export function inspectKnowledgeSummaryOpaque(
  meta: MetaInspection,
): KnowledgeSummaryOpaqueInspection {
  const baseline = {
    totalWithDescription: 0,
    opaqueCount: 0,
    ratio: 0,
    threshold: KNOWLEDGE_SUMMARY_OPAQUE_THRESHOLD,
    opaqueSample: [] as string[],
  };
  if (!meta.valid || meta.meta === null) {
    return { status: "skipped", ...baseline };
  }
  let total = 0;
  const opaqueIds: string[] = [];
  for (const node of Object.values(meta.meta.nodes)) {
    const description = node.description;
    const stableId = node.stable_id;
    if (!description || typeof stableId !== "string" || stableId.length === 0) {
      continue;
    }
    total += 1;
    const summary = (description.summary ?? "").trim();
    if (summary === stableId.trim()) {
      opaqueIds.push(stableId);
    }
  }
  if (total === 0) {
    return { status: "ok", ...baseline };
  }
  const ratio = opaqueIds.length / total;
  const status = ratio > KNOWLEDGE_SUMMARY_OPAQUE_THRESHOLD ? "warn" : "ok";
  return {
    status,
    totalWithDescription: total,
    opaqueCount: opaqueIds.length,
    ratio,
    threshold: KNOWLEDGE_SUMMARY_OPAQUE_THRESHOLD,
    opaqueSample: opaqueIds.slice(0, 5),
  };
}

export function createKnowledgeSummaryOpaqueCheck(
  t: Translator,
  inspection: KnowledgeSummaryOpaqueInspection,
): DoctorCheck {
  if (inspection.status === "skipped") {
    return okCheck(
      t("doctor.check.knowledge_summary_opaque.name"),
      t("doctor.check.knowledge_summary_opaque.ok.skipped"),
    );
  }
  if (inspection.status === "ok") {
    return okCheck(
      t("doctor.check.knowledge_summary_opaque.name"),
      t("doctor.check.knowledge_summary_opaque.ok", {
        opaque: String(inspection.opaqueCount),
        total: String(inspection.totalWithDescription),
      }),
    );
  }
  const pct = Math.round(inspection.ratio * 1000) / 10;
  return issueCheck(
    t("doctor.check.knowledge_summary_opaque.name"),
    "warn",
    "warning",
    "knowledge_summary_opaque",
    t("doctor.check.knowledge_summary_opaque.message.warn", {
      opaque: String(inspection.opaqueCount),
      total: String(inspection.totalWithDescription),
      pct: String(pct),
      threshold: String(Math.round(inspection.threshold * 100)),
      sample: inspection.opaqueSample.join(", "),
    }),
    t("doctor.check.knowledge_summary_opaque.remediation"),
  );
}

function issueCheck(
  name: string,
  status: DoctorStatus,
  kind: DoctorIssueKind,
  code: string,
  message: string,
  actionHint?: string,
  audience?: "user" | "maintainer",
): DoctorCheck {
  return {
    name,
    status,
    kind,
    code,
    fixable: kind === "fixable_error",
    message,
    actionHint,
    audience,
  };
}

function collectIssues(checks: DoctorCheck[], kind: DoctorIssueKind): DoctorIssue[] {
  return checks
    .filter((check) => check.kind === kind)
    .map((check) => ({
      code: check.code ?? check.name,
      name: check.name,
      message: check.message,
      actionHint: check.actionHint,
      audience: check.audience,
    }));
}

function findIssue(issues: DoctorIssue[], code: string): DoctorIssue {
  return issues.find((issue) => issue.code === code) ?? {
    code,
    name: code,
    message: code,
  };
}

async function inspectMetaManuallyDiverged(projectRoot: string): Promise<MetaManuallyDivergedInspection> {
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");

  if (!existsSync(metaPath)) {
    return { extraMetaEntries: [], hashMismatchEntries: [], readable: false };
  }

  let meta: AgentsMeta;
  try {
    const raw = await readFile(metaPath, "utf8");
    meta = agentsMetaSchema.parse(JSON.parse(raw));
  } catch (error) {
    return {
      extraMetaEntries: [],
      hashMismatchEntries: [],
      readable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const extraMetaEntries: string[] = [];
  const hashMismatchEntries: string[] = [];

  for (const node of Object.values(meta.nodes)) {
    const contentRef = node.content_ref ?? node.file;
    // Dual-root layout (KT-DEC-0003): personal nodes carry a `~/.fabric/knowledge/`
    // content_ref that resolves against the personal root, not projectRoot. A bare
    // join() would point at <repo>/~/.fabric/... — a path that never exists — and
    // flag every personal mirror node as a permanent false-positive divergence.
    const absPath = resolveContentRefPath(projectRoot, contentRef);

    if (!existsSync(absPath)) {
      extraMetaEntries.push(contentRef);
      continue;
    }

    try {
      const content = readFileSync(absPath, "utf8");
      const diskHash = sha256(content);
      if (node.hash !== "" && node.hash !== diskHash) {
        hashMismatchEntries.push(contentRef);
      }
    } catch {
      extraMetaEntries.push(contentRef);
    }
  }

  return { extraMetaEntries, hashMismatchEntries, readable: true };
}

function inspectKnowledgeDirUnindexed(projectRoot: string, meta: MetaInspection): RulesDirUnindexedInspection {
  // v2.0 layout: iterate .fabric/knowledge/{type}/ and surface any .md file
  // not yet present in agents.meta.json so reconcileKnowledge can rebuild the
  // index. The legacy v1.x rules collection was dropped in rc.2.
  const physicalMdFiles = new Set<string>();
  collectMdFilesUnder(physicalMdFiles, projectRoot, join(projectRoot, ".fabric", "knowledge"), ".fabric/knowledge");

  if (physicalMdFiles.size === 0) {
    return { unindexedFiles: [] };
  }

  // Collect all content_refs/file paths tracked in meta.
  const indexedRefs = new Set<string>();
  if (meta.valid && meta.meta !== null) {
    for (const node of Object.values(meta.meta.nodes)) {
      const ref = normalizePath(node.content_ref ?? node.file);
      indexedRefs.add(ref);
    }
  }

  const unindexedFiles = [...physicalMdFiles].filter((f) => !indexedRefs.has(f)).sort();
  return { unindexedFiles };
}

function collectMdFilesUnder(
  out: Set<string>,
  projectRoot: string,
  rootDir: string,
  relPrefix: string,
): void {
  if (!existsSync(rootDir)) {
    return;
  }
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) {
      continue;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "pending" && entry.name !== "archive") {
          stack.push(abs);
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = posix.join(relPrefix, abs.slice(rootDir.length + 1).replace(/\\/gu, "/"));
        out.add(rel);
      }
    }
  }
}

function createKnowledgeDirUnindexedCheck(t: Translator, inspection: RulesDirUnindexedInspection): DoctorCheck {
  if (inspection.unindexedFiles.length > 0) {
    const count = inspection.unindexedFiles.length;
    return issueCheck(
      t("doctor.check.knowledge_dir_unindexed.name"),
      "error",
      "fixable_error",
      "knowledge_dir_unindexed",
      t(`doctor.check.knowledge_dir_unindexed.message.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
      }),
      t("doctor.check.knowledge_dir_unindexed.remediation"),
    );
  }
  return okCheck(
    t("doctor.check.knowledge_dir_unindexed.name"),
    t("doctor.check.knowledge_dir_unindexed.ok"),
  );
}

async function inspectStableIdCollisions(projectRoot: string): Promise<StableIdCollisionInspection> {
  // v2.0: stable_ids are declared in YAML frontmatter `id: K[PT]-XXX-NNNN`
  // inside .fabric/knowledge/{type}/*.md. The v1.x HTML-comment marker
  // (`<!-- fab:rule-id X -->`) is no longer scanned. The file path component
  // is recorded relative to the project root using POSIX separators so
  // messages are stable across OSes.
  type Found = { stableId: string; relPath: string };
  const found: Found[] = [];

  // v2.0 knowledge files (frontmatter `id: ...`).
  const knowledgeDir = join(projectRoot, ".fabric", "knowledge");
  if (existsSync(knowledgeDir)) {
    const stack: string[] = [knowledgeDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) {
        continue;
      }
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(abs);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          let source: string;
          try {
            source = await readFile(abs, "utf8");
          } catch {
            continue;
          }
          const id = extractKnowledgeFrontmatterId(source);
          if (id === null) {
            continue;
          }
          const relPath = posix.join(".fabric/knowledge", abs.slice(knowledgeDir.length + 1).replace(/\\/gu, "/"));
          found.push({ stableId: id, relPath });
        }
      }
    }
  }

  const stableIdToFiles = new Map<string, string[]>();
  for (const { stableId, relPath } of found) {
    const existing = stableIdToFiles.get(stableId) ?? [];
    existing.push(relPath);
    stableIdToFiles.set(stableId, existing);
  }

  const collisions: StableIdCollision[] = [];
  for (const [stable_id, files] of stableIdToFiles) {
    if (files.length > 1) {
      collisions.push({ stable_id, files: files.sort() });
    }
  }

  return { collisions: collisions.sort((a, b) => a.stable_id.localeCompare(b.stable_id)) };
}

// Match a YAML frontmatter `id:` field whose value matches the v2.0 stable_id
// shape K[PT]-{TYPE}-{COUNTER}. Returns null when no match (e.g. no frontmatter,
// no `id` key, or non-knowledge id format).
function extractKnowledgeFrontmatterId(source: string): string | null {
  const FM_PATTERN = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return null;
  }
  const block = fm[1];
  const ID_LINE = /^id:\s*("?)(K[PT]-(?:MOD|DEC|GLD|PIT|PRO)-\d{4,})\1\s*$/mu;
  const idMatch = ID_LINE.exec(block);
  return idMatch === null ? null : idMatch[2];
}

function inspectCounterDesync(meta: MetaInspection): CounterDesyncInspection {
  // counter_desync: a node has stable_id KP-DEC-0007 but agents.meta.json's
  // counters.KP.DEC says 5 (i.e. less than the observed counter). The fix is
  // to bump counters[layer][type] to max(observed, current) for every (layer,
  // type) pair where a desync is detected. We only report when:
  //   - meta is valid AND
  //   - at least one observed counter exceeds its current value.
  if (!meta.valid || meta.meta === null) {
    return { desyncs: [], correctedCounters: null };
  }

  // Establish the current counters envelope (use schema defaults when omitted).
  const current = AgentsMetaCountersSchema.parse(meta.meta.counters ?? undefined);
  const observed: Record<"KP" | "KT", Record<"MOD" | "DEC" | "GLD" | "PIT" | "PRO", number>> = {
    KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
    KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
  };

  for (const node of Object.values(meta.meta.nodes)) {
    const id = node.stable_id;
    if (id === undefined) {
      continue;
    }
    const parsed = parseKnowledgeId(id);
    if (parsed === null) {
      continue;
    }
    const layer = parsed.layer === "personal" ? "KP" : "KT";
    const typeCode = ([
      ["models", "MOD"],
      ["decisions", "DEC"],
      ["guidelines", "GLD"],
      ["pitfalls", "PIT"],
      ["processes", "PRO"],
    ] as const).find(([t]) => t === parsed.type)?.[1];
    if (typeCode === undefined) {
      continue;
    }
    if (parsed.counter > observed[layer][typeCode]) {
      observed[layer][typeCode] = parsed.counter;
    }
  }

  const desyncs: CounterDesyncEntry[] = [];
  const corrected: AgentsMetaCounters = {
    KP: { ...current.KP },
    KT: { ...current.KT },
  };
  for (const layer of ["KP", "KT"] as const) {
    for (const code of COUNTER_TYPE_CODES) {
      const obs = observed[layer][code];
      const cur = current[layer][code];
      if (obs > cur) {
        desyncs.push({ layer, type: code, observed: obs, current: cur });
        corrected[layer][code] = obs;
      }
    }
  }

  return {
    desyncs,
    correctedCounters: desyncs.length === 0 ? null : corrected,
  };
}

function createCounterDesyncCheck(t: Translator, inspection: CounterDesyncInspection): DoctorCheck {
  if (inspection.desyncs.length > 0) {
    const first = inspection.desyncs[0];
    const observedId = `K${first.layer === "KP" ? "P" : "T"}-${first.type}-${String(first.observed).padStart(4, "0")}`;
    const count = inspection.desyncs.length;
    return issueCheck(
      t("doctor.check.counter_desync.name"),
      "error",
      "fixable_error",
      "counter_desync",
      t(`doctor.check.counter_desync.message.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
        counterPath: `counters.${first.layer}.${first.type}`,
        current: String(first.current),
        observedId,
      }),
      t("doctor.check.counter_desync.remediation"),
    );
  }
  return okCheck(t("doctor.check.counter_desync.name"), t("doctor.check.counter_desync.ok"));
}

function createStableIdCollisionCheck(t: Translator, inspection: StableIdCollisionInspection): DoctorCheck {
  if (inspection.collisions.length > 0) {
    const first = inspection.collisions[0];
    const count = inspection.collisions.length;
    return issueCheck(
      t("doctor.check.stable_id_collision.name"),
      "warn",
      "warning",
      "stable_id_collision",
      t(`doctor.check.stable_id_collision.message.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
        stableId: first.stable_id,
        fileCount: String(first.files.length),
        files: first.files.join(", "),
      }),
      t("doctor.check.stable_id_collision.remediation"),
    );
  }
  return okCheck(t("doctor.check.stable_id_collision.name"), t("doctor.check.stable_id_collision.ok"));
}

function createMetaManuallyDivergedCheck(t: Translator, inspection: MetaManuallyDivergedInspection): DoctorCheck {
  if (!inspection.readable) {
    // meta unreadable is already surfaced by createMetaCheck; skip here
    return okCheck(
      t("doctor.check.meta_manually_diverged.name"),
      t("doctor.check.meta_manually_diverged.ok.unreadable"),
    );
  }

  if (inspection.extraMetaEntries.length > 0) {
    const count = inspection.extraMetaEntries.length;
    return issueCheck(
      t("doctor.check.meta_manually_diverged.name"),
      "warn",
      "warning",
      "meta_manually_diverged",
      t(`doctor.check.meta_manually_diverged.message.extra.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
      }),
      t("doctor.check.meta_manually_diverged.remediation.extra"),
    );
  }

  if (inspection.hashMismatchEntries.length > 0) {
    const count = inspection.hashMismatchEntries.length;
    return issueCheck(
      t("doctor.check.meta_manually_diverged.name"),
      "warn",
      "warning",
      "meta_manually_diverged",
      t(`doctor.check.meta_manually_diverged.message.hash.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
      }),
      t("doctor.check.meta_manually_diverged.remediation.hash"),
    );
  }

  return okCheck(
    t("doctor.check.meta_manually_diverged.name"),
    t("doctor.check.meta_manually_diverged.ok.consistent"),
  );
}

function inspectPreexistingRootFiles(projectRoot: string): PreexistingRootFilesInspection {
  const candidates = ["CLAUDE.md", "AGENTS.md"];
  const detected = candidates.filter((name) => existsSync(join(projectRoot, name)));
  return { detected };
}

async function inspectFilesystemEditFallback(projectRoot: string): Promise<FilesystemEditFallbackInspection> {
  // Detect orphan canonical knowledge entries — files at
  // .fabric/knowledge/<type>/<id>--<slug>.md that have no matching
  // knowledge_promoted event in events.jsonl. This happens when a user
  // manually `git mv` a pending proposal into its canonical location
  // instead of using fab_review.approve. To keep the audit trail
  // complete, doctor synthesizes a knowledge_promoted event for each
  // orphan with reason='[synthesized] filesystem-edit-fallback'.
  //
  // Side-effect by design: the synthesis happens during inspect so that
  // a subsequent `runDoctorReport` (or any other consumer reading
  // events.jsonl) sees the synthesized event and the orphan is no
  // longer reported. This preserves idempotence: the second run is a
  // no-op.
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  if (!existsSync(knowledgeRoot)) {
    return { synthesized: 0, synthesizedStableIds: [] };
  }

  // Collect all stable_ids that have a canonical file on disk.
  const canonicalIds = new Set<string>();
  for (const typeDir of KNOWLEDGE_CANONICAL_TYPE_DIRS) {
    const dir = join(knowledgeRoot, typeDir);
    if (!existsSync(dir)) {
      continue;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const match = CANONICAL_KNOWLEDGE_FILENAME_PATTERN.exec(entry.name);
      if (match === null) {
        continue;
      }
      canonicalIds.add(match[1]);
    }
  }

  if (canonicalIds.size === 0) {
    return { synthesized: 0, synthesizedStableIds: [] };
  }

  // Read existing knowledge_promoted events from events.jsonl. Use the
  // existing read API so partial-write tails are filtered consistently.
  let promotedIds = new Set<string>();
  try {
    const { events } = await readEventLedger(projectRoot, { event_type: "knowledge_promoted" });
    promotedIds = new Set(
      events
        .map((event) => (event.event_type === "knowledge_promoted" ? event.stable_id : undefined))
        .filter((id): id is string => typeof id === "string"),
    );
  } catch {
    // Treat read failure as "no promoted events known" — appendEventLedgerEvent
    // will surface the underlying ledger problem via its own error path.
    promotedIds = new Set();
  }

  const orphanIds: string[] = [];
  for (const id of canonicalIds) {
    if (!promotedIds.has(id)) {
      orphanIds.push(id);
    }
  }
  orphanIds.sort();

  // v2.0.0-rc.29 TASK-004 (BUG-G2 + BUG-G5): emit the full
  // knowledge_proposed → knowledge_promote_started → knowledge_promoted
  // lifecycle triplet for each synthesized orphan, with monotonic timestamps
  // and a shared correlation_id, so the two-phase invariant
  // (promoted ≤ promote_started ≤ proposed) holds in the ledger. Previously
  // this synth path emitted only the terminal `knowledge_promoted` event
  // (audit BUG-G2 root cause: 19 promoted > 13 promote_started in this repo).
  for (const stable_id of orphanIds) {
    await emitSynthesizedPromotionTriplet(projectRoot, stable_id);
  }

  return { synthesized: orphanIds.length, synthesizedStableIds: orphanIds };
}

// v2.0.0-rc.29 TASK-004 (BUG-G2 + BUG-G5): triplet emitter helper used by the
// filesystem-edit fallback synth path. Each call writes exactly three events
// in the canonical lifecycle order, sharing `correlation_id: doctor-synthesized`
// and using strictly monotonic `ts` values (millisecond-step) so downstream
// invariant checks can pair them by correlation_id + monotonic order without
// resorting to floating-point timestamp comparisons. `session_id` mirrors the
// correlation_id sentinel so this synth source is easy to grep out of audits.
async function emitSynthesizedPromotionTriplet(
  projectRoot: string,
  stable_id: string,
): Promise<void> {
  const baseTs = Date.now();

  await appendEventLedgerEvent(projectRoot, {
    event_type: "knowledge_proposed",
    stable_id,
    timestamp: new Date(baseTs).toISOString(),
    reason: SYNTHESIZED_PROMOTED_REASON,
    correlation_id: "doctor-synthesized",
    session_id: "doctor-synthesized",
    ts: baseTs,
  });

  await appendEventLedgerEvent(projectRoot, {
    event_type: "knowledge_promote_started",
    stable_id,
    timestamp: new Date(baseTs + 1).toISOString(),
    reason: SYNTHESIZED_PROMOTED_REASON,
    correlation_id: "doctor-synthesized",
    session_id: "doctor-synthesized",
    ts: baseTs + 1,
  });

  await appendEventLedgerEvent(projectRoot, {
    event_type: "knowledge_promoted",
    stable_id,
    timestamp: new Date(baseTs + 2).toISOString(),
    reason: SYNTHESIZED_PROMOTED_REASON,
    correlation_id: "doctor-synthesized",
    session_id: "doctor-synthesized",
    ts: baseTs + 2,
  });
}

function createFilesystemEditFallbackCheck(t: Translator, inspection: FilesystemEditFallbackInspection): DoctorCheck {
  if (inspection.synthesized === 0) {
    return okCheck(
      t("doctor.check.filesystem_edit_fallback.name"),
      t("doctor.check.filesystem_edit_fallback.ok"),
    );
  }
  const sample = inspection.synthesizedStableIds.slice(0, 3).join(", ");
  return {
    name: t("doctor.check.filesystem_edit_fallback.name"),
    status: "ok",
    kind: "info",
    code: "knowledge_promoted_synthesized",
    fixable: false,
    message: t(
      `doctor.check.filesystem_edit_fallback.message.synthesized.${inspection.synthesized === 1 ? "singular" : "plural"}`,
      {
        count: String(inspection.synthesized),
        sample,
        suffix: inspection.synthesizedStableIds.length > 3 ? ", ..." : "",
        reason: SYNTHESIZED_PROMOTED_REASON,
      },
    ),
    actionHint: t("doctor.check.filesystem_edit_fallback.remediation.synthesized"),
  };
}

function createPreexistingRootFilesCheck(t: Translator, inspection: PreexistingRootFilesInspection): DoctorCheck {
  if (inspection.detected.length === 0) {
    return okCheck(t("doctor.check.preexisting_root_files.name"), t("doctor.check.preexisting_root_files.ok"));
  }
  return {
    name: t("doctor.check.preexisting_root_files.name"),
    status: "ok",
    kind: "info",
    code: "preexisting_root_claude_md",
    fixable: false,
    message: t("doctor.check.preexisting_root_files.message", { files: inspection.detected.join(", ") }),
    actionHint: t("doctor.check.preexisting_root_files.remediation"),
  };
}

// rc.4 TASK-001: read-side lint inspections (#16-18). Walks the canonical
// .fabric/knowledge/{type}/ tree (orphan-demote, stale-archive) and the
// pending/<type>/ staging area (pending-overdue), parses YAML frontmatter
// for maturity + stable_id + created_at, and computes per-entry inactivity
// against an in-memory lastActiveAt index built in a single pass over
// events.jsonl. None of these inspections mutate the filesystem or emit
// events — TASK-003 wires those mutation paths behind --apply-lint.

// v2.0 rc.5 TASK-014 (C5): build a Map<stable_id, lastConsumedAtEpochMs> in a
// single pass over events.jsonl. Primary signal is knowledge_consumed (emitted
// by fab_get_knowledge_sections per resolved stable_id). Drives the pivoted
// lint #16 (orphan_demote) — replaces the legacy heuristic which mixed every
// lifecycle + selection + fetch event into a generic "last_referenced".
//
// Idempotency carve-out: knowledge_demoted and knowledge_archived events are
// ALSO recognized as "consumption touches" so that applying a lint mutation
// (which emits one of these) refreshes the entry's last-consumed timestamp on
// the next read. Without this, a freshly-demoted but never-consumed entry
// would be re-flagged on the very next apply-lint run (same created_at, same
// threshold), breaking the rc.4 idempotency contract documented at
// runDoctorApplyLint. Selection / fetch / proposed / promoted events are NOT
// included — those are the legacy-heuristic signals being retired in C5.
//
// The legacy buildLastActiveIndex (below) is kept for stale_archive (#17)
// which still relies on the union-of-lifecycle-events signal until rc.6 audits
// every read-side check.
async function buildLastConsumedIndex(
  projectRoot: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let events;
  try {
    ({ events } = await readEventLedger(projectRoot));
  } catch {
    return map;
  }

  for (const event of events) {
    const ts = event.ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) {
      continue;
    }

    // v2.0.0-rc.33 W3-4 (P1-4): include `knowledge_sections_fetched` as a
    // use-signal alongside knowledge_consumed. The MCP fab_get_knowledge_sections
    // tool emits `knowledge_sections_fetched` (carrying final_stable_ids[])
    // for every fetch; the legacy `knowledge_consumed` path is only hit when
    // the AI actually reaches into the per-id body. An entry that was
    // section-fetched (loaded into context) but not separately consumed should
    // NOT be demoted as orphan — the agent saw it. Without this signal,
    // doctor reports false-positive orphan_demote candidates whenever the
    // AI's working memory keeps referring to fetched-but-not-deeply-consumed
    // entries (which is the rc.32 baseline cite-coverage 3.1% reality).
    if (event.event_type === "knowledge_sections_fetched") {
      const ids = Array.isArray(event.final_stable_ids) ? event.final_stable_ids : [];
      for (const stableId of ids) {
        if (typeof stableId !== "string" || stableId.length === 0) continue;
        const prev = map.get(stableId);
        if (prev === undefined || ts > prev) {
          map.set(stableId, ts);
        }
      }
      continue;
    }

    if (
      event.event_type !== "knowledge_consumed" &&
      event.event_type !== "knowledge_demoted" &&
      event.event_type !== "knowledge_archived"
    ) {
      continue;
    }
    const stableId = event.stable_id;
    if (typeof stableId !== "string" || stableId.length === 0) {
      continue;
    }
    const prev = map.get(stableId);
    if (prev === undefined || ts > prev) {
      map.set(stableId, ts);
    }
  }

  return map;
}

// Build a Map<stable_id, lastActiveAtEpochMs> in a single pass over events.jsonl.
// "Activity" is the union of events that reference a knowledge entry by its
// stable_id: knowledge_proposed, knowledge_promoted, knowledge_promote_started,
// knowledge_demoted, knowledge_archived, knowledge_layer_changed, knowledge_slug_renamed,
// AND read-side fetch events knowledge_sections_fetched (final_stable_ids[]) and
// knowledge_selection (final_stable_ids[] union ai_selected_stable_ids[] union
// required_stable_ids[]). knowledge_context_planned is also included.
//
// Complexity: O(N events). Per-file lookup is O(1). Documented per the risk
// note in TASK-001.json — sufficient for v2.0 ledgers (<10k events typical).
async function buildLastActiveIndex(
  projectRoot: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let events;
  try {
    ({ events } = await readEventLedger(projectRoot));
  } catch {
    return map;
  }

  for (const event of events) {
    const ts = event.ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) {
      continue;
    }
    // Collect every stable_id this event references.
    const ids: string[] = [];
    switch (event.event_type) {
      case "knowledge_proposed":
      case "knowledge_promote_started":
      case "knowledge_promoted":
      case "knowledge_promote_failed":
      case "knowledge_layer_changed":
      case "knowledge_slug_renamed":
      case "knowledge_demoted":
      case "knowledge_archived":
      case "knowledge_archive_attempted":
      case "knowledge_deferred":
      case "knowledge_rejected": {
        if (typeof event.stable_id === "string" && event.stable_id.length > 0) {
          ids.push(event.stable_id);
        }
        break;
      }
      case "knowledge_context_planned": {
        ids.push(...event.required_stable_ids, ...event.ai_selectable_stable_ids, ...event.final_stable_ids);
        break;
      }
      case "knowledge_selection": {
        ids.push(
          ...event.required_stable_ids,
          ...event.ai_selectable_stable_ids,
          ...event.ai_selected_stable_ids,
          ...event.final_stable_ids,
        );
        break;
      }
      case "knowledge_sections_fetched": {
        ids.push(...event.final_stable_ids, ...event.ai_selected_stable_ids);
        break;
      }
      default:
        break;
    }

    for (const id of ids) {
      const prev = map.get(id);
      if (prev === undefined || ts > prev) {
        map.set(id, ts);
      }
    }
  }

  return map;
}

// Pure helper: maturity → inactivity threshold in days.
// v2.0.0-rc.33 W4-B3 (T5 P2): per-maturity threshold with fabric-config
// override. Cached per-projectRoot to avoid re-reading the config file on
// every iterateCanonicalEntries iteration (called O(N) per inspect pass).
// The cache key is a WeakMap-style closure over (projectRoot, defaults).
function resolveMaturityThresholds(projectRoot: string): Record<LintMaturity, number> {
  const overrides = readOrphanDemoteThresholdDays(projectRoot);
  return {
    stable: overrides.stable ?? ORPHAN_DEMOTE_THRESHOLD_DAYS.stable,
    endorsed: overrides.endorsed ?? ORPHAN_DEMOTE_THRESHOLD_DAYS.endorsed,
    draft: overrides.draft ?? ORPHAN_DEMOTE_THRESHOLD_DAYS.draft,
  };
}

function maturityThresholdDays(maturity: LintMaturity, thresholds?: Record<LintMaturity, number>): number {
  return (thresholds ?? ORPHAN_DEMOTE_THRESHOLD_DAYS)[maturity];
}

// Pure helper: maturity → next-lower tier (or null when terminal).
function nextLowerMaturity(current: LintMaturity): "endorsed" | "draft" | null {
  if (current === "stable") return "endorsed";
  if (current === "endorsed") return "draft";
  return null;
}

function extractKnowledgeFrontmatterMaturity(source: string): LintMaturity | null {
  const FM_PATTERN = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return null;
  }
  const match = MATURITY_LINE_PATTERN.exec(fm[1]);
  return match === null ? null : (match[2] as LintMaturity);
}

// rc.36 TASK-05 (P0-8): true if the frontmatter has a `tags:` line with an
// empty inline array, e.g. `tags: []`. Returns false for missing-line or
// non-empty array. Whitespace-only contents (e.g. `tags: [ , ]`) count as
// empty.
function isKnowledgeFrontmatterTagsEmpty(source: string): boolean | null {
  const FM_PATTERN = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return null;
  }
  const match = TAGS_LINE_PATTERN.exec(fm[1]);
  if (match === null) {
    return null;
  }
  // Strip whitespace + trailing comma; non-empty if any token remains.
  const inner = match[1].replace(/[\s,]/g, "");
  return inner === "";
}

function extractKnowledgeFrontmatterCreatedAt(source: string): number | null {
  const FM_PATTERN = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return null;
  }
  const match = CREATED_AT_LINE_PATTERN.exec(fm[1]);
  if (match === null) {
    return null;
  }
  const parsed = Date.parse(match[2]);
  return Number.isFinite(parsed) ? parsed : null;
}

// Iterate canonical knowledge files: yields {stableId, maturity, abs path,
// rel path, type, lastReferenceMs}. lastReferenceMs is the max of frontmatter
// created_at, file mtime, and last-active event ts. Files that don't match
// the canonical filename pattern OR are missing frontmatter id+maturity are
// skipped silently — they are out of scope for the lint check (covered by
// other doctor checks like stable_id_collision / filesystem_edit_fallback).
type CanonicalEntry = {
  stable_id: string;
  maturity: LintMaturity;
  type: typeof KNOWLEDGE_CANONICAL_TYPE_DIRS[number];
  absPath: string;
  relPath: string;
  lastReferenceMs: number;
};

function* iterateCanonicalEntries(
  projectRoot: string,
  lastActiveIndex: Map<string, number>,
): Generator<CanonicalEntry> {
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  if (!existsSync(knowledgeRoot)) {
    return;
  }
  for (const typeDir of KNOWLEDGE_CANONICAL_TYPE_DIRS) {
    const dir = join(knowledgeRoot, typeDir);
    if (!existsSync(dir)) {
      continue;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const match = CANONICAL_KNOWLEDGE_FILENAME_PATTERN.exec(entry.name);
      if (match === null) {
        continue;
      }
      const stableId = match[1];
      const absPath = join(dir, entry.name);
      let source: string;
      try {
        source = readFileSync(absPath, "utf8");
      } catch {
        continue;
      }
      const maturity = extractKnowledgeFrontmatterMaturity(source);
      if (maturity === null) {
        continue;
      }
      const createdAt = extractKnowledgeFrontmatterCreatedAt(source);
      const eventTs = lastActiveIndex.get(stableId) ?? 0;
      // Activity is event-driven; mtime is only a fallback for entries that
      // have neither frontmatter.created_at nor any event reference (which is
      // an unusual state — most canonical entries are promoted via fab_review
      // and therefore have at least one knowledge_promoted event). Including
      // mtime in the max would refresh the reference every time doctor runs
      // (file rewrites are rare but happen during tests/dogfood).
      let lastReferenceMs = Math.max(createdAt ?? 0, eventTs);
      if (lastReferenceMs === 0) {
        try {
          lastReferenceMs = statSync(absPath).mtimeMs;
        } catch {
          lastReferenceMs = 0;
        }
      }
      const relPath = posix.join(
        ".fabric/knowledge",
        typeDir,
        entry.name,
      );
      yield { stable_id: stableId, maturity, type: typeDir, absPath, relPath, lastReferenceMs };
    }
  }
}

async function inspectOrphanDemote(
  projectRoot: string,
  now: number,
): Promise<OrphanDemoteInspection> {
  // v2.0 rc.5 TASK-014 (C5): pivot to last_consumed_at derived from
  // knowledge_consumed events only. Frontmatter created_at remains a fallback
  // inside iterateCanonicalEntries so fresh-but-never-consumed entries are
  // not immediately flagged.
  const lastConsumedIndex = await buildLastConsumedIndex(projectRoot);
  const thresholds = resolveMaturityThresholds(projectRoot);
  const candidates: OrphanDemoteCandidate[] = [];

  for (const entry of iterateCanonicalEntries(projectRoot, lastConsumedIndex)) {
    const ageMs = entry.lastReferenceMs > 0 ? now - entry.lastReferenceMs : now;
    const ageDays = Math.floor(ageMs / MS_PER_DAY);
    const threshold = maturityThresholdDays(entry.maturity, thresholds);
    if (ageDays <= threshold) {
      continue;
    }
    candidates.push({
      stable_id: entry.stable_id,
      path: entry.relPath,
      age_days: ageDays,
      maturity: entry.maturity,
      next_maturity: nextLowerMaturity(entry.maturity),
    });
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates, thresholds };
}

async function inspectStaleArchive(
  projectRoot: string,
  now: number,
): Promise<StaleArchiveInspection> {
  const lastActiveIndex = await buildLastActiveIndex(projectRoot);
  const candidates: StaleArchiveCandidate[] = [];

  for (const entry of iterateCanonicalEntries(projectRoot, lastActiveIndex)) {
    if (entry.maturity !== "draft") {
      continue;
    }
    const ageMs = entry.lastReferenceMs > 0 ? now - entry.lastReferenceMs : now;
    const ageDays = Math.floor(ageMs / MS_PER_DAY);
    // Stale-archive applies the demote threshold (14 for born-draft) PLUS the
    // additional 90d quiet window. We do not require knowing the prior maturity
    // — the additional-quiet semantics is a function of "this entry has been
    // draft AND quiet for at least 90d", expressed here as draftDemoteThreshold
    // + STALE_ARCHIVE_ADDITIONAL_DAYS total inactivity.
    const requiredQuiet =
      ORPHAN_DEMOTE_THRESHOLD_DAYS.draft + STALE_ARCHIVE_ADDITIONAL_DAYS;
    if (ageDays <= requiredQuiet) {
      continue;
    }
    const filename = posix.basename(entry.relPath);
    candidates.push({
      stable_id: entry.stable_id,
      path: entry.relPath,
      age_days: ageDays,
      archive_path: posix.join(".fabric/.archive", entry.type, filename),
    });
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates };
}

// rc.5 TASK-009 (B2): per-pending-file visit row produced by the shared dual-root
// pending walker. Carries enough state (age + display + absolute paths) for
// both inspectPendingOverdue (14d warning) and inspectPendingAutoArchive
// (>30d mutation) to filter purely on age without re-walking the disk.
type PendingFileVisit = {
  layer: "team" | "personal";
  type: string; // subdir name (decisions/pitfalls/...)
  filename: string;
  pending_path: string; // display: project-relative or `~/...`
  pending_path_abs: string;
  stable_id: string | undefined;
  age_days: number;
};

// Walks BOTH the team-rooted (`<projectRoot>/.fabric/knowledge/pending/`)
// and personal-rooted (`<FABRIC_HOME>/.fabric/knowledge/pending/`) staging
// trees and yields one visit per `.md` file. Mirrors the dual-root pattern
// used by iterateCanonicalFilenames for the canonical knowledge trees, but
// over the pending staging area introduced by TASK-008 (B1).
//
// Files with no parseable created_at AND no readable mtime yield an
// "unknown-age" visit synthesized at PENDING_OVERDUE_THRESHOLD_DAYS+1 days
// (mirrors the prior single-root behavior in inspectPendingOverdue — humans
// triage these manually rather than auto-archive without an age signal).
function* iteratePendingFiles(
  projectRoot: string,
  now: number,
): Generator<PendingFileVisit> {
  const teamRoot = join(projectRoot, ".fabric", "knowledge", "pending");
  const personalRoot = join(resolvePersonalRootForPending(), ".fabric", "knowledge", "pending");

  for (const [layer, root, displayPrefix] of [
    ["team", teamRoot, ".fabric/knowledge/pending"] as const,
    ["personal", personalRoot, "~/.fabric/knowledge/pending"] as const,
  ]) {
    if (!existsSync(root)) {
      continue;
    }
    let typeDirs: string[] = [];
    try {
      typeDirs = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const typeDir of typeDirs) {
      const dir = join(root, typeDir);
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
          continue;
        }
        const absPath = join(dir, entry.name);
        let source = "";
        try {
          source = readFileSync(absPath, "utf8");
        } catch {
          continue;
        }
        const createdAt = extractKnowledgeFrontmatterCreatedAt(source);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(absPath).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        const referenceMs = createdAt ?? mtimeMs;
        const displayPath = posix.join(displayPrefix, typeDir, entry.name);
        if (referenceMs === 0) {
          // Both missing → synthesize an overdue-but-not-auto-archive age so
          // the overdue lint surfaces it for human triage; the auto-archive
          // gate (>30d) is deliberately NOT triggered without an age signal.
          yield {
            layer,
            type: typeDir,
            filename: entry.name,
            pending_path: displayPath,
            pending_path_abs: absPath,
            stable_id: undefined,
            age_days: PENDING_OVERDUE_THRESHOLD_DAYS + 1,
          };
          continue;
        }
        const ageDays = Math.floor((now - referenceMs) / MS_PER_DAY);
        const stableId = extractKnowledgeFrontmatterId(source) ?? undefined;
        yield {
          layer,
          type: typeDir,
          filename: entry.name,
          pending_path: displayPath,
          pending_path_abs: absPath,
          stable_id: stableId,
          age_days: ageDays,
        };
      }
    }
  }
}

// rc.5 TASK-009 (B2): inlined personal-root resolver mirroring
// resolvePersonalKnowledgeRoot but anchored at `<home>` rather than
// `<home>/.fabric/knowledge` — pending lives at `<home>/.fabric/knowledge/pending`
// so callers want the homedir root and append the suffix themselves.
function resolvePersonalRootForPending(): string {
  return process.env.FABRIC_HOME ?? homedir();
}

function inspectPendingOverdue(
  projectRoot: string,
  now: number,
): PendingOverdueInspection {
  const candidates: PendingOverdueCandidate[] = [];
  for (const visit of iteratePendingFiles(projectRoot, now)) {
    if (visit.age_days <= PENDING_OVERDUE_THRESHOLD_DAYS) {
      continue;
    }
    candidates.push({
      stable_id: visit.stable_id,
      path: visit.pending_path,
      age_days: visit.age_days,
    });
  }
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates };
}

// rc.5 TASK-009 (B2): identifies pending entries whose age (frontmatter
// created_at or mtime fallback) exceeds PENDING_AUTO_ARCHIVE_THRESHOLD_DAYS.
// Walks both team + personal pending roots. Auto-archive destinations mirror
// the source layer:
//   team:     .fabric/.archive/pending/<type>/<filename>
//   personal: ~/.fabric/.archive/pending/<type>/<filename>
// The mutation arm (applyPendingAutoArchive) git-mvs team files (preserving
// rename detection inside the workspace git tree) and fs.renames personal
// files (which live outside the project repo).
function inspectPendingAutoArchive(
  projectRoot: string,
  now: number,
): PendingAutoArchiveInspection {
  const candidates: PendingAutoArchiveCandidate[] = [];
  for (const visit of iteratePendingFiles(projectRoot, now)) {
    if (visit.age_days <= PENDING_AUTO_ARCHIVE_THRESHOLD_DAYS) {
      continue;
    }
    if (visit.layer === "team") {
      const archivedToRel = posix.join(".fabric/.archive/pending", visit.type, visit.filename);
      candidates.push({
        layer: "team",
        type: visit.type,
        pending_path: visit.pending_path,
        pending_path_abs: visit.pending_path_abs,
        archived_to: archivedToRel,
        archived_to_abs: join(projectRoot, archivedToRel),
        age_days: visit.age_days,
      });
    } else {
      const archivedToDisplay = posix.join(
        "~/.fabric/.archive/pending",
        visit.type,
        visit.filename,
      );
      const archivedToAbs = join(
        resolvePersonalRootForPending(),
        ".fabric",
        ".archive",
        "pending",
        visit.type,
        visit.filename,
      );
      candidates.push({
        layer: "personal",
        type: visit.type,
        pending_path: visit.pending_path,
        pending_path_abs: visit.pending_path_abs,
        archived_to: archivedToDisplay,
        archived_to_abs: archivedToAbs,
        age_days: visit.age_days,
      });
    }
  }
  candidates.sort((a, b) => a.pending_path.localeCompare(b.pending_path));
  return { candidates };
}

// rc.5 TASK-010: inspect lint #22 (knowledge_underseeded).
//
// Counts canonical entries across the five canonical type subdirs (excluding
// pending/) and compares against the underseed threshold. The threshold is
// read defensively from `.fabric/fabric-config.json#underseed_node_threshold`
// — the same key the fabric-hint Stop hook reads — falling back to
// DEFAULT_UNDERSEED_NODE_THRESHOLD on missing-file / parse-failure / bad-type.
//
// We deliberately do NOT use the strict CANONICAL_KNOWLEDGE_FILENAME_PATTERN
// here: entries without the `--<slug>` suffix or with non-canonical filenames
// still represent knowledge content and should count toward the floor. The
// stricter pattern is owned by inspectStableIdDuplicate / inspectLayerMismatch
// (#19/#20), which deal with integrity rather than corpus size.
function inspectUnderseeded(projectRoot: string): UnderseededInspection {
  const threshold = readUnderseedThresholdFromConfig(projectRoot);
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  let nodeCount = 0;
  if (existsSync(knowledgeRoot)) {
    for (const typeDir of KNOWLEDGE_CANONICAL_TYPE_DIRS) {
      const dir = join(knowledgeRoot, typeDir);
      if (!existsSync(dir)) continue;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          nodeCount += 1;
        }
      }
    }
  }
  return {
    node_count: nodeCount,
    threshold,
    underseeded: nodeCount < threshold,
  };
}

// rc.6 TASK-021 (E3): inspect `.fabric/.cache/` for session-hints cache
// files older than SESSION_HINTS_STALE_DAYS (7d default). Mirrors the
// existing iteratePendingFiles age model — mtime-based, day-floor rounded.
// Read-only: candidates are surfaced as info-kind findings; the apply-lint
// arm (applySessionHintsStaleCleanup) does the unlink. Directory absence is
// the common-case empty-result branch (no narrow hook ever fired in this
// workspace) — return zero candidates without an error.
function inspectSessionHintsStale(
  projectRoot: string,
  now: number,
): SessionHintsStaleInspection {
  const cacheDir = join(projectRoot, ".fabric", ".cache");
  if (!existsSync(cacheDir)) {
    return { candidates: [] };
  }
  let entries;
  try {
    entries = readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return { candidates: [] };
  }
  const candidates: SessionHintsStaleCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(SESSION_HINTS_FILE_PREFIX)) continue;
    if (!entry.name.endsWith(SESSION_HINTS_FILE_SUFFIX)) continue;
    const absPath = join(cacheDir, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(absPath).mtimeMs;
    } catch {
      // Unreadable stat → skip rather than guess at age. The next doctor
      // run will retry (or the OS will reap a corrupted entry).
      continue;
    }
    const ageDays = Math.floor((now - mtimeMs) / MS_PER_DAY);
    if (ageDays < SESSION_HINTS_STALE_DAYS) continue;
    candidates.push({
      path: posix.join(".fabric", ".cache", entry.name),
      age_days: ageDays,
    });
  }
  // Stable display order — alphabetical by path so test assertions and
  // human review aren't sensitive to readdir() ordering quirks.
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates };
}

// rc.23 TASK-010 (e): inspect `.fabric/.serve.lock` for a dead-PID corpse.
// Re-uses `readLockState` (best-effort JSON parse — returns null on
// missing/malformed) and `isAlive` (process.kill signal-0 probe) from
// serve-lock.ts so a single canonical liveness rule applies across the
// acquire path and the doctor advisory.
function inspectStaleServeLock(
  projectRoot: string,
  now: number,
): StaleServeLockInspection {
  const state = readLockState(projectRoot);
  if (state === null) {
    return { present: false };
  }
  // Defensive: a malformed lock file is treated as "present + stale" — we
  // still want the operator to know there's a corpse on disk. readLockState
  // returns null on parse errors though, so this branch handles only the
  // happy-parse case. The acquireLock-side overwrites a malformed file
  // silently; the doctor surface is the operator's only visibility.
  const ageMs = Math.max(0, now - state.acquiredAt);
  return {
    present: true,
    pid: state.pid,
    acquiredAt: state.acquiredAt,
    ageMs,
    pidAlive: isAlive(state.pid),
  };
}

// rc.6 TASK-023 (E6): inspect narrow-scope KB hygiene via two independent
// arms. Part A is a synchronous filesystem walk over canonical entries —
// the same iterator used by lints #23/#24/#25 — that computes the ratio of
// narrow-with-paths entries to the full corpus. Part B reads the two
// counter sidecars (edit-counter from TASK-020 / E4 and hint-silence-counter
// from TASK-023 / E6) and computes a silence rate over a rolling 30d window.
//
// Both arms are evaluated unconditionally; either firing flags the check.
// Part B safely degrades to "telemetry_skipped" when the edit-counter is
// absent or has zero in-window fires — an unused-hook workspace must not
// produce a false-positive narrow_too_few finding.
function inspectNarrowTooFew(
  projectRoot: string,
  now: number,
): NarrowTooFewInspection {
  // -------------------------------------------------------------------------
  // Part A — structural: walk canonical entries (team + personal) and
  // categorize each as narrow-with-paths vs other. Uses iterateRelevanceFrontmatter
  // (already deployed by #23/#24/#25) so the parser surface is shared.
  // -------------------------------------------------------------------------
  let total = 0;
  let narrowWithPaths = 0;
  for (const { scope, paths } of iterateRelevanceFrontmatter(projectRoot)) {
    total += 1;
    if (scope === "narrow" && paths.length > 0) {
      narrowWithPaths += 1;
    }
  }
  const narrowRatio = total === 0 ? 0 : narrowWithPaths / total;
  const structuralFlagged =
    total >= NARROW_MIN_TOTAL && narrowRatio < NARROW_RATIO_THRESHOLD;

  // -------------------------------------------------------------------------
  // Part B — telemetry: read both counter sidecars, filter to the rolling
  // window, and compute silence_rate = silence_count / edit_count. The
  // edit-counter is the denominator (every PreToolUse fire). When the
  // denominator is 0 we treat the arm as "skipped" — we cannot evaluate a
  // ratio without a sample. The silence-counter is necessarily a subset
  // (every silent fire also fires the edit-counter), so silence_rate <= 1.
  // -------------------------------------------------------------------------
  const windowStartMs = now - SILENCE_WINDOW_DAYS * MS_PER_DAY;
  const editFires = readCounterTimestamps(
    join(projectRoot, EDIT_COUNTER_FILE_REL),
    windowStartMs,
  );
  const silenceFires = readCounterTimestamps(
    join(projectRoot, HINT_SILENCE_COUNTER_FILE_REL),
    windowStartMs,
  );
  const telemetrySkipped = editFires === 0;
  const silenceRate = editFires === 0 ? 0 : silenceFires / editFires;
  const telemetryFlagged =
    !telemetrySkipped && silenceRate > SILENCE_RATE_THRESHOLD;

  return {
    total_canonical_entries: total,
    narrow_with_paths_count: narrowWithPaths,
    narrow_ratio: narrowRatio,
    structural_flagged: structuralFlagged,
    total_edit_fires_in_window: editFires,
    silence_fires_in_window: silenceFires,
    silence_rate: silenceRate,
    telemetry_skipped: telemetrySkipped,
    telemetry_flagged: telemetryFlagged,
  };
}

// Helper: read a counter sidecar file (one ISO-8601 timestamp per line)
// and return the count of lines whose timestamp is >= windowStartMs. Used
// by lint #26 (E6 telemetry) to count fires inside the rolling 30d window.
// Returns 0 for any failure (file absent, unreadable, every line malformed)
// so the caller's safe-degrade contract is uniform.
function readCounterTimestamps(absPath: string, windowStartMs: number): number {
  if (!existsSync(absPath)) return 0;
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const ts = Date.parse(trimmed);
    if (!Number.isFinite(ts)) continue;
    if (ts < windowStartMs) continue;
    count += 1;
  }
  return count;
}

// Best-effort reader for the underseed-threshold override stored in the
// workspace-local `.fabric/fabric-config.json`. Any failure (missing file,
// parse error, non-positive value) returns the default. Mirrors the
// fabric-hint hook's readUnderseedThreshold semantics one-for-one — the two
// surfaces MUST agree on the same threshold for a given workspace.
function readUnderseedThresholdFromConfig(projectRoot: string): number {
  const configPath = join(projectRoot, ".fabric", "fabric-config.json");
  if (!existsSync(configPath)) return DEFAULT_UNDERSEED_NODE_THRESHOLD;
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const v = (parsed as Record<string, unknown>).underseed_node_threshold;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        return v;
      }
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_UNDERSEED_NODE_THRESHOLD;
}

function createOrphanDemoteCheck(t: Translator, inspection: OrphanDemoteInspection): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.orphan_demote.name"),
      t("doctor.check.orphan_demote.ok"),
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} (${first.maturity}, ${first.age_days}d inactive at ${first.path})`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.orphan_demote.name"),
    "warn",
    "warning",
    "knowledge_orphan_demote_required",
    t(`doctor.check.orphan_demote.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      stableDays: String(inspection.thresholds.stable),
      endorsedDays: String(inspection.thresholds.endorsed),
      draftDays: String(inspection.thresholds.draft),
      detail,
    }),
    t("doctor.check.orphan_demote.remediation"),
  );
}

function createStaleArchiveCheck(t: Translator, inspection: StaleArchiveInspection): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.stale_archive.name"),
      t("doctor.check.stale_archive.ok"),
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} (${first.age_days}d inactive at ${first.path}) → ${first.archive_path}`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.stale_archive.name"),
    "warn",
    "warning",
    "knowledge_stale_archive_required",
    t(`doctor.check.stale_archive.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      additionalDays: String(STALE_ARCHIVE_ADDITIONAL_DAYS),
      detail,
    }),
    t("doctor.check.stale_archive.remediation"),
  );
}

function createPendingOverdueCheck(t: Translator, inspection: PendingOverdueInspection): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.pending_overdue.name"),
      t("doctor.check.pending_overdue.ok"),
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.path} (${first.age_days}d old)`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.pending_overdue.name"),
    "warn",
    "warning",
    "knowledge_pending_overdue",
    t(`doctor.check.pending_overdue.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      thresholdDays: String(PENDING_OVERDUE_THRESHOLD_DAYS),
      detail,
    }),
    t("doctor.check.pending_overdue.remediation"),
  );
}

// rc.5 TASK-010: surface the underseeded lint (#22) as an `info` kind so it
// shows in the report without bumping doctor's status to warn/error — a small
// corpus is a legitimate state during early adoption, not a defect. The
// actionHint points the user at the fabric-import Skill, mirroring the
// fabric-hint hook's import-signal recommendation.
function createUnderseededCheck(t: Translator, inspection: UnderseededInspection): DoctorCheck {
  if (!inspection.underseeded) {
    return okCheck(
      t("doctor.check.underseeded.name"),
      t("doctor.check.underseeded.ok", {
        count: String(inspection.node_count),
        threshold: String(inspection.threshold),
      }),
    );
  }
  return issueCheck(
    t("doctor.check.underseeded.name"),
    "ok",
    "info",
    "knowledge_underseeded",
    t(`doctor.check.underseeded.message.${inspection.node_count === 1 ? "singular" : "plural"}`, {
      count: String(inspection.node_count),
      threshold: String(inspection.threshold),
    }),
    t("doctor.check.underseeded.remediation"),
  );
}

// rc.6 TASK-021 (E3): surface stale session-hints cache files as an info-
// kind finding. Status remains "ok" — the cache is hot-cache hygiene, not
// a correctness concern. The actionHint points at apply-lint so users can
// reap accumulated cache files in a single pass.
function createSessionHintsStaleCheck(
  t: Translator,
  inspection: SessionHintsStaleInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.session_hints_stale.name"),
      t("doctor.check.session_hints_stale.ok", {
        days: String(SESSION_HINTS_STALE_DAYS),
      }),
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.path} (${first.age_days}d old)`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.session_hints_stale.name"),
    "ok",
    "info",
    "knowledge_session_hints_stale",
    t(`doctor.check.session_hints_stale.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      days: String(SESSION_HINTS_STALE_DAYS),
      detail,
    }),
    t("doctor.check.session_hints_stale.remediation"),
  );
}

// rc.23 TASK-010 (e): surface a stale `.fabric/.serve.lock` (dead-PID corpse)
// as an info-kind advisory. Status stays "ok" — a stale lock is operator
// hygiene, not a doctor-fatal. `--fix` (runDoctorFix) unlinks the file and
// emits `serve_lock_cleared`. Skip cases: no lock file (steady state) and
// lock held by a live PID (a healthy `fabric serve` is running — never touch).
function createStaleServeLockCheck(
  t: Translator,
  inspection: StaleServeLockInspection,
): DoctorCheck {
  if (!inspection.present) {
    return okCheck(
      t("doctor.check.stale_serve_lock.name"),
      t("doctor.check.stale_serve_lock.ok.no_lock"),
    );
  }
  if (inspection.pidAlive) {
    return okCheck(
      t("doctor.check.stale_serve_lock.name"),
      t("doctor.check.stale_serve_lock.ok.live_pid", {
        pid: String(inspection.pid),
      }),
    );
  }
  // Coarse "K time ago" — days when ≥1d, hours otherwise. Matches the prose
  // shape requested in the task spec; we floor-round so a 0-day reading
  // never confuses the operator about whether the lock is fresh.
  const days = Math.floor(inspection.ageMs / MS_PER_DAY);
  const hours = Math.floor(inspection.ageMs / (60 * 60 * 1000));
  const acquiredAgo =
    days >= 1
      ? t(`doctor.check.stale_serve_lock.age.day.${days === 1 ? "singular" : "plural"}`, {
          count: String(days),
        })
      : t(`doctor.check.stale_serve_lock.age.hour.${hours === 1 ? "singular" : "plural"}`, {
          count: String(hours),
        });
  return issueCheck(
    t("doctor.check.stale_serve_lock.name"),
    "ok",
    "info",
    "stale_serve_lock",
    t("doctor.check.stale_serve_lock.message.dead_pid", {
      pid: String(inspection.pid),
      acquiredAgo,
    }),
    t("doctor.check.stale_serve_lock.remediation.dead_pid"),
  );
}

// ---------------------------------------------------------------------------
// rc.5 TASK-013 (C4): relevance_paths hygiene lints #23/#24/#25.
//
// All three inspections walk the canonical knowledge trees (team + personal)
// via iterateCanonicalFilenames, parse YAML frontmatter for the
// `relevance_scope` / `relevance_paths` fields introduced by TASK-012, and
// emit findings without mutating disk (rc.5 ships flag-only — apply-lint
// auto-prune for #24 is deferred to rc.7+).
//
// Filesystem-walk for #24 reuses minimatch (already a server dep used by
// plan-context.ts / get-knowledge.ts). We walk the workspace once,
// collecting all candidate paths under projectRoot (skipping IGNORED_DIRECTORIES
// + dotfiles other than .fabric children — `.fabric` itself is in the ignore
// list because relevance_paths anchor user source, not Fabric internals), then
// each glob is tested against the cached path list. This keeps the
// inspection O(N+M) rather than O(N*M) re-walks per glob.
//
// #25's git heuristic shells out to `git log` via execFileSync — the same
// pattern TASK-009 (B2) uses for apply-lint's git-mv. When the command fails
// (not a repo, git unavailable) the inspection downgrades to ok+info with no
// candidates rather than firing across every narrow entry.
// ---------------------------------------------------------------------------

// Pure parser: extract relevance_scope from a frontmatter block. Returns
// "broad" as the schema-level default when the field is absent (mirrors
// agentsMetaSchema's `.default("broad")` on the relevance_scope column).
function extractKnowledgeFrontmatterRelevanceScope(source: string): "narrow" | "broad" {
  const FM_PATTERN = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return "broad";
  }
  const match = RELEVANCE_SCOPE_LINE_PATTERN.exec(fm[1]);
  if (match === null) {
    return "broad";
  }
  return match[2] as "narrow" | "broad";
}

// Pure parser: extract relevance_paths from a frontmatter block. Accepts the
// flow-style array shape `[a, b, c]` (with or without quoted entries). Empty
// arrays / missing field both yield []. The parser intentionally tolerates
// whitespace + optional double-quotes; bare-strings are the convention but
// the schema accepts both.
function extractKnowledgeFrontmatterRelevancePaths(source: string): string[] {
  const FM_PATTERN = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return [];
  }
  const match = RELEVANCE_PATHS_LINE_PATTERN.exec(fm[1]);
  if (match === null) {
    return [];
  }
  const inner = match[1].trim();
  if (inner.length === 0) {
    return [];
  }
  return inner
    .split(",")
    .map((token) => token.trim().replace(/^"(.*)"$/u, "$1"))
    .filter((token) => token.length > 0);
}

// Shared helper: yields {visit, scope, paths} for every canonical entry whose
// frontmatter parses cleanly. Files without frontmatter — or with no
// relevance_scope/relevance_paths fields — are normalized to the schema
// defaults (scope=broad, paths=[]). Read-side only; never writes back to disk.
type RelevanceFrontmatterVisit = {
  visit: CanonicalFilenameVisit;
  scope: "narrow" | "broad";
  paths: string[];
  absPath: string;
};

function* iterateRelevanceFrontmatter(
  projectRoot: string,
): Generator<RelevanceFrontmatterVisit> {
  for (const visit of iterateCanonicalFilenames(projectRoot)) {
    const layerRoot = visit.layer === "team"
      ? join(projectRoot, ".fabric", "knowledge")
      : resolvePersonalKnowledgeRoot();
    const absPath = join(layerRoot, visit.type, visit.filename);
    let source: string;
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const scope = extractKnowledgeFrontmatterRelevanceScope(source);
    const paths = extractKnowledgeFrontmatterRelevancePaths(source);
    yield { visit, scope, paths, absPath };
  }
}

// Inspection #23: narrow_no_paths. Narrow entries with empty relevance_paths
// can never match a target_paths set (matchesAnyPath in plan-context.ts
// short-circuits on `globs.length === 0`), so they're effectively a silent
// recall risk. Pre-Phase-1.5 the broad default kept this case from arising;
// post-TASK-012 a narrow-then-clear sequence can leave the entry in this
// state. Warning kind (no auto-fix — the user must decide whether to add
// paths or widen the scope).
function inspectNarrowNoPaths(projectRoot: string): NarrowNoPathsInspection {
  const candidates: NarrowNoPathsCandidate[] = [];
  for (const { visit, scope, paths } of iterateRelevanceFrontmatter(projectRoot)) {
    if (scope !== "narrow") {
      continue;
    }
    if (paths.length > 0) {
      continue;
    }
    candidates.push({
      stable_id: visit.parsed.stable_id,
      path: visit.displayPath,
    });
  }
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates };
}

// Inspection #24: relevance_paths_dangling. For each canonical entry with a
// non-empty relevance_paths, test every glob against the workspace's file
// listing. Globs that match zero paths are dangling — the entry references
// files/dirs that no longer exist in the repo. Flag-only in rc.5 (auto-prune
// + knowledge_path_dangled event emission deferred to rc.7+); the event
// schema is pre-registered so future apply-lint behavior can ship without
// schema churn.
function inspectRelevancePathsDangling(
  projectRoot: string,
): RelevancePathsDanglingInspection {
  const entries: DanglingGlobEntry[] = [];
  // Build the candidate path list ONCE per doctor run. We collect both files
  // and directories so directory-anchor globs (`src/foo/**`) resolve through
  // the existing directory entry. The list is project-rooted POSIX paths,
  // matching the convention used elsewhere in this module.
  const workspacePaths = collectWorkspacePathsForGlobMatch(projectRoot);
  if (workspacePaths.length === 0) {
    return { entries };
  }
  for (const { visit, paths } of iterateRelevanceFrontmatter(projectRoot)) {
    if (paths.length === 0) {
      continue;
    }
    for (const rawGlob of paths) {
      const glob = rawGlob.endsWith("/") ? `${rawGlob}**` : rawGlob;
      let matched = false;
      for (const target of workspacePaths) {
        if (minimatch(target, glob, { dot: true, matchBase: false })) {
          matched = true;
          break;
        }
      }
      if (matched) {
        continue;
      }
      entries.push({
        stable_id: visit.parsed.stable_id,
        path: visit.displayPath,
        dangling_glob: rawGlob,
      });
    }
  }
  entries.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    return byPath !== 0 ? byPath : a.dangling_glob.localeCompare(b.dangling_glob);
  });
  return { entries };
}

// Walk the workspace once to collect a flat list of POSIX-style relative
// paths suitable for minimatch testing. We skip IGNORED_DIRECTORIES (the
// same ignore list used by collectEntryPoints) so the candidate list stays
// bounded. Both files and directories are yielded — relevance_paths globs
// may target either (e.g. `src/foo/**` matches the directory `src/foo` plus
// every descendant; `src/foo.ts` matches a single file).
function collectWorkspacePathsForGlobMatch(projectRoot: string): string[] {
  if (!existsSync(projectRoot)) {
    return [];
  }
  let rootStat;
  try {
    rootStat = statSync(projectRoot);
  } catch {
    return [];
  }
  if (!rootStat.isDirectory()) {
    return [];
  }
  const paths: string[] = [];
  const stack: string[] = [projectRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(current, entry.name);
      const rel = normalizePath(abs.slice(projectRoot.length + 1));
      if (rel.length === 0) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        paths.push(rel);
        stack.push(abs);
      } else if (entry.isFile()) {
        paths.push(rel);
      }
    }
  }
  return paths;
}

// Inspection #25: relevance_paths_drift. For each canonical entry with
// relevance_scope=narrow AND non-empty relevance_paths, check whether ANY of
// the globs has been touched in the last RELEVANCE_PATHS_DRIFT_WINDOW_DAYS
// (90d) of git history. We use `git log --since=<date> --name-only --pretty=format:`
// to get the union of touched paths, then minimatch each glob against that
// list. Entries whose globs touch zero recently-changed paths are flagged as
// drift candidates (the relevance anchors may have gone stale because the
// referenced code is no longer being modified).
//
// When `git` is unavailable / the workspace is not a repo, the inspection
// downgrades to ok+info with `git_available: false`. The check renderer
// surfaces this as an informational ok message rather than emitting false
// positives across every narrow entry.
function inspectRelevancePathsDrift(
  projectRoot: string,
): RelevancePathsDriftInspection {
  let recentPaths: string[] | null = null;
  try {
    recentPaths = readRecentGitTouchedPaths(projectRoot, RELEVANCE_PATHS_DRIFT_WINDOW_DAYS);
  } catch {
    recentPaths = null;
  }
  if (recentPaths === null) {
    return { candidates: [], git_available: false };
  }
  const candidates: RelevancePathsDriftCandidate[] = [];
  for (const { visit, scope, paths } of iterateRelevanceFrontmatter(projectRoot)) {
    if (scope !== "narrow") {
      continue;
    }
    if (paths.length === 0) {
      // narrow_no_paths owns this case (#23). Drift only applies when there
      // ARE globs to evaluate.
      continue;
    }
    let anyMatch = false;
    for (const rawGlob of paths) {
      const glob = rawGlob.endsWith("/") ? `${rawGlob}**` : rawGlob;
      for (const target of recentPaths) {
        if (minimatch(target, glob, { dot: true, matchBase: false })) {
          anyMatch = true;
          break;
        }
      }
      if (anyMatch) break;
    }
    if (anyMatch) {
      continue;
    }
    candidates.push({
      stable_id: visit.parsed.stable_id,
      path: visit.displayPath,
      globs: paths.slice(),
    });
  }
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates, git_available: true };
}

// Shell out to `git log` and return the union of paths touched in the
// requested window. Throws when the command fails or git is unavailable
// (caller catches and downgrades to git_available=false). The since-date
// is computed in JavaScript to avoid locale-dependent parsing on git's side.
function readRecentGitTouchedPaths(
  projectRoot: string,
  windowDays: number,
): string[] {
  const since = new Date(Date.now() - windowDays * MS_PER_DAY).toISOString();
  const stdout = execFileSync(
    "git",
    ["log", `--since=${since}`, "--name-only", "--pretty=format:"],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    },
  );
  const set = new Set<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    set.add(normalizePath(trimmed));
  }
  return Array.from(set);
}

function createNarrowNoPathsCheck(t: Translator, inspection: NarrowNoPathsInspection): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.narrow_no_paths.name"),
      t("doctor.check.narrow_no_paths.ok"),
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} (${first.path})`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.narrow_no_paths.name"),
    "warn",
    "warning",
    "knowledge_narrow_no_paths",
    t(`doctor.check.narrow_no_paths.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    t("doctor.check.narrow_no_paths.remediation"),
  );
}

function createRelevancePathsDanglingCheck(
  t: Translator,
  inspection: RelevancePathsDanglingInspection,
): DoctorCheck {
  if (inspection.entries.length === 0) {
    return okCheck(
      t("doctor.check.relevance_paths_dangling.name"),
      t("doctor.check.relevance_paths_dangling.ok"),
    );
  }
  const first = inspection.entries[0];
  const detail = `${first.stable_id} at ${first.path} → \`${first.dangling_glob}\` (0 matches)`;
  const count = inspection.entries.length;
  return issueCheck(
    t("doctor.check.relevance_paths_dangling.name"),
    "warn",
    "warning",
    "knowledge_relevance_paths_dangling",
    t(`doctor.check.relevance_paths_dangling.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    t("doctor.check.relevance_paths_dangling.remediation"),
  );
}

function createRelevancePathsDriftCheck(
  t: Translator,
  inspection: RelevancePathsDriftInspection,
): DoctorCheck {
  if (!inspection.git_available) {
    return okCheck(
      t("doctor.check.relevance_paths_drift.name"),
      t("doctor.check.relevance_paths_drift.ok.skipped", {
        windowDays: String(RELEVANCE_PATHS_DRIFT_WINDOW_DAYS),
      }),
    );
  }
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.relevance_paths_drift.name"),
      t("doctor.check.relevance_paths_drift.ok.fresh", {
        windowDays: String(RELEVANCE_PATHS_DRIFT_WINDOW_DAYS),
      }),
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} at ${first.path} (globs: ${first.globs.join(", ")})`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.relevance_paths_drift.name"),
    "ok",
    "info",
    "knowledge_relevance_paths_drift",
    t(`doctor.check.relevance_paths_drift.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      windowDays: String(RELEVANCE_PATHS_DRIFT_WINDOW_DAYS),
      detail,
    }),
    t("doctor.check.relevance_paths_drift.remediation"),
  );
}

// rc.37 NEW-5: inspect personal-layer entries whose relevance_paths globs
// resolve against the current project. Signals that the entry is actually
// project-bound and likely belongs in the team layer.
function inspectPersonalLayerPathMisclassify(
  projectRoot: string,
): PersonalLayerPathMisclassifyInspection {
  const candidates: PersonalLayerPathMisclassifyCandidate[] = [];
  const workspacePaths = collectWorkspacePathsForGlobMatch(projectRoot);
  if (workspacePaths.length === 0) {
    return { candidates };
  }
  for (const { visit, paths } of iterateRelevanceFrontmatter(projectRoot)) {
    if (visit.layer !== "personal") {
      continue;
    }
    if (paths.length === 0) {
      continue;
    }
    const matched: string[] = [];
    for (const rawGlob of paths) {
      // Anchors that explicitly point at the personal layer or absolute paths
      // outside the project are excluded — they're definitionally
      // project-agnostic. The misclassification signal is project-relative
      // globs that resolve against THIS workspace.
      if (rawGlob.startsWith("~/") || rawGlob.startsWith("/")) {
        continue;
      }
      const glob = rawGlob.endsWith("/") ? `${rawGlob}**` : rawGlob;
      for (const target of workspacePaths) {
        if (minimatch(target, glob, { dot: true, matchBase: false })) {
          matched.push(rawGlob);
          break;
        }
      }
    }
    if (matched.length === 0) {
      continue;
    }
    candidates.push({
      stable_id: visit.parsed.stable_id,
      path: visit.displayPath,
      matched_globs: matched,
    });
  }
  candidates.sort((a, b) => a.stable_id.localeCompare(b.stable_id));
  return { candidates };
}

function createPersonalLayerPathMisclassifyCheck(
  t: Translator,
  inspection: PersonalLayerPathMisclassifyInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.personal_layer_path_misclassify.name"),
      t("doctor.check.personal_layer_path_misclassify.ok"),
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} → ${first.matched_globs.slice(0, 2).join(", ")}`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.personal_layer_path_misclassify.name"),
    "warn",
    "warning",
    "knowledge_personal_layer_path_misclassify",
    t(`doctor.check.personal_layer_path_misclassify.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    t("doctor.check.personal_layer_path_misclassify.remediation"),
  );
}

// rc.37 NEW-32: scan canonical KB bodies for prompt-injection patterns
// (the same set the extract-knowledge sanitizer redacts on archive,
// NEW-31). Surfaces legacy entries that pre-date NEW-31. Read-only; no
// auto-fix.
function inspectSuspiciousKb(projectRoot: string): SuspiciousKbInspection {
  const candidates: SuspiciousKbCandidate[] = [];
  for (const visit of iterateCanonicalFilenames(projectRoot)) {
    const layerRoot = visit.layer === "team"
      ? join(projectRoot, ".fabric", "knowledge")
      : resolvePersonalKnowledgeRoot();
    const absPath = join(layerRoot, visit.type, visit.filename);
    let body: string;
    try {
      body = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const matched: string[] = [];
    for (const { name, pattern } of INJECTION_PATTERNS) {
      // Reset lastIndex defensively (g-flagged regex state leaks across calls).
      pattern.lastIndex = 0;
      if (pattern.test(body)) {
        matched.push(name);
      }
    }
    if (matched.length === 0) {
      continue;
    }
    candidates.push({
      stable_id: visit.parsed.stable_id,
      path: visit.displayPath,
      patterns: matched,
    });
  }
  candidates.sort((a, b) => a.stable_id.localeCompare(b.stable_id));
  return { candidates };
}

function createSuspiciousKbCheck(
  t: Translator,
  inspection: SuspiciousKbInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.suspicious_kb.name"),
      t("doctor.check.suspicious_kb.ok"),
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} → ${first.patterns.slice(0, 2).join(", ")}`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.suspicious_kb.name"),
    "warn",
    "warning",
    "knowledge_suspicious_kb_injection",
    t(`doctor.check.suspicious_kb.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    t("doctor.check.suspicious_kb.remediation"),
  );
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.9 TASK-003 (A3): lint #28 relevance_fields_missing.
//
// Scans the pending staging tree (.fabric/knowledge/pending/**/*.md and
// ~/.fabric/knowledge/pending/**/*.md) for entries whose YAML frontmatter
// is missing the `relevance_scope` AND/OR `relevance_paths` fields. These
// fields were introduced by rc.5 TASK-012 (C3) and rc.5 contracts default
// missing values to (`broad`, []) at read time via knowledge-meta-builder's
// fallback (knowledge-meta-builder.ts:1007-1021). Migration is hygiene
// rather than correctness — but a single `--apply-lint` pass back-fills
// the explicit defaults so the on-disk shape matches the schema, keeps
// `fab_review.modify` semantics unambiguous, and emits one aggregate
// `relevance_migration_run` event per run for audit-trail symmetry with
// the rc.5→rc.7 bulk-migration precedent (pending_auto_archived /
// claude_skill_path_migrated etc).
//
// Scope: PENDING ONLY. Canonical entries are excluded — the `fab_review`
// approve/modify flow already writes both fields verbatim (see
// review.ts approve / modify), and back-filling canonical files would
// require parsing the layer (KT-/KP-) for each entry. Pending is the
// only surface where the v2.0 contract still has to tolerate
// schema-default reads.
//
// Idempotency: an entry with BOTH fields already present is skipped (no
// write, no per-file mutation, no contribution to touched_count). The
// aggregate event is still emitted on every --apply-lint invocation
// (touched_count=0 on the no-op pass) so the audit trail reflects every
// migration heartbeat, mirroring `doctor_run`.
//
// Lint number: #28. Lint #26 (`narrow_too_few`, rc.6 TASK-023) and #27
// (`session_hints_stale`, rc.6 TASK-021) are already allocated; the task
// spec called this "#26 relevance_fields_missing" but the existing
// numbering is preserved verbatim to honor TASK-003's "do not break
// existing lint numbering" constraint.
// ---------------------------------------------------------------------------

type RelevanceFieldsMissingCandidate = {
  // Display path: project-relative POSIX for team layer; `~/.fabric/...`
  // for personal layer (matches the convention used by inspectPendingOverdue
  // and inspectPendingAutoArchive).
  pending_path: string;
  // Absolute filesystem path of the file (used by the apply step to write
  // back the augmented frontmatter).
  pending_path_abs: string;
  // True iff the frontmatter is missing `relevance_scope`. Either flag may
  // be set independently — a candidate is recorded when at least one is
  // true; the apply step writes only the missing fields.
  missing_scope: boolean;
  // True iff the frontmatter is missing `relevance_paths`.
  missing_paths: boolean;
};

type RelevanceFieldsMissingInspection = {
  candidates: RelevanceFieldsMissingCandidate[];
  // Total pending entries the walker visited (regardless of whether they
  // were missing fields). Used by the aggregate event's `scanned_count`.
  scanned_count: number;
};

// Walk the pending tree (both team + personal roots), parse each file's
// frontmatter, and record entries that are missing `relevance_scope` and/or
// `relevance_paths`. Entries without a parseable `---\n...\n---` frontmatter
// block are skipped silently — that case is owned by other doctor lints
// (e.g. malformed frontmatter triggers manual_error elsewhere). Read-only:
// never writes to disk.
function inspectRelevanceFieldsMissing(
  projectRoot: string,
): RelevanceFieldsMissingInspection {
  const candidates: RelevanceFieldsMissingCandidate[] = [];
  let scannedCount = 0;

  const FM_PATTERN = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u;

  const teamRoot = join(projectRoot, ".fabric", "knowledge", "pending");
  const personalRoot = join(
    resolvePersonalRootForPending(),
    ".fabric",
    "knowledge",
    "pending",
  );

  for (const [root, displayPrefix] of [
    [teamRoot, ".fabric/knowledge/pending"] as const,
    [personalRoot, "~/.fabric/knowledge/pending"] as const,
  ]) {
    if (!existsSync(root)) {
      continue;
    }
    let typeDirs: string[] = [];
    try {
      typeDirs = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const typeDir of typeDirs) {
      const dir = join(root, typeDir);
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
          continue;
        }
        const absPath = join(dir, entry.name);
        let source: string;
        try {
          source = readFileSync(absPath, "utf8");
        } catch {
          continue;
        }
        const fm = FM_PATTERN.exec(source);
        if (fm === null) {
          // No parseable frontmatter — out of scope for #28; other doctor
          // checks own that case.
          continue;
        }
        scannedCount += 1;
        const block = fm[1];
        const missingScope = !RELEVANCE_SCOPE_LINE_PATTERN.test(block);
        const missingPaths = !RELEVANCE_PATHS_LINE_PATTERN.test(block);
        if (!missingScope && !missingPaths) {
          continue;
        }
        candidates.push({
          pending_path: posix.join(displayPrefix, typeDir, entry.name),
          pending_path_abs: absPath,
          missing_scope: missingScope,
          missing_paths: missingPaths,
        });
      }
    }
  }
  candidates.sort((a, b) => a.pending_path.localeCompare(b.pending_path));
  return { candidates, scanned_count: scannedCount };
}

// Pure helper: insert the missing relevance_* YAML lines into a frontmatter
// block. The replacement writes the fields verbatim against the regex shape
// at L627-628 so the re-scan invariant holds:
//   relevance_scope: broad
//   relevance_paths: []
// Inserts immediately before the closing `---` delimiter (or after the
// existing last frontmatter line if there's no trailing blank). Returns
// null when the source has no parseable frontmatter — caller must handle
// defensively (the inspection upstream filters that case, but the mutation
// arm is defensive). If both fields are already present this returns the
// original source byte-for-byte (idempotency).
function appendRelevanceFieldsToFrontmatter(
  source: string,
  needsScope: boolean,
  needsPaths: boolean,
): string | null {
  const FM_PATTERN = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return null;
  }
  const block = fm[1];
  // Re-check inside the helper so an idempotent re-run can never re-add
  // a field that the original write already produced.
  const actuallyNeedsScope =
    needsScope && !RELEVANCE_SCOPE_LINE_PATTERN.test(block);
  const actuallyNeedsPaths =
    needsPaths && !RELEVANCE_PATHS_LINE_PATTERN.test(block);
  if (!actuallyNeedsScope && !actuallyNeedsPaths) {
    return source;
  }
  // Build the new frontmatter block. Append the YAML lines after the
  // existing block content (which already includes its own trailing line
  // ending tail, guaranteed by the `\r?\n---` match), separating with a
  // single newline. The values are written verbatim to match the regex
  // shapes at L627-628 — `relevance_scope: broad` (unquoted) and
  // `relevance_paths: []` (flow-style empty array).
  const additions: string[] = [];
  if (actuallyNeedsScope) {
    additions.push("relevance_scope: broad");
  }
  if (actuallyNeedsPaths) {
    additions.push("relevance_paths: []");
  }
  const trailing = block.endsWith("\n") ? "" : "\n";
  const replacedBlock = `${block}${trailing}${additions.join("\n")}`;
  const blockStart = source.indexOf(block);
  if (blockStart < 0) {
    return null;
  }
  return (
    source.slice(0, blockStart) +
    replacedBlock +
    source.slice(blockStart + block.length)
  );
}

async function applyRelevanceFieldsMissing(
  candidate: RelevanceFieldsMissingCandidate,
): Promise<DoctorApplyLintMutation> {
  const parts: string[] = [];
  if (candidate.missing_scope) parts.push("relevance_scope: broad");
  if (candidate.missing_paths) parts.push("relevance_paths: []");
  const detail = `back-filled: ${parts.join(", ")}`;
  try {
    const source = await readFile(candidate.pending_path_abs, "utf8");
    const rewritten = appendRelevanceFieldsToFrontmatter(
      source,
      candidate.missing_scope,
      candidate.missing_paths,
    );
    if (rewritten === null) {
      return {
        kind: "knowledge_relevance_fields_missing",
        path: candidate.pending_path,
        detail,
        applied: false,
        error: "frontmatter not parseable; cannot back-fill",
      };
    }
    if (rewritten === source) {
      // Idempotency: both fields already present at write time (e.g. a
      // concurrent process landed the back-fill between inspect and apply).
      // Surface as applied=false with a benign explanation so the mutation
      // count stays accurate.
      return {
        kind: "knowledge_relevance_fields_missing",
        path: candidate.pending_path,
        detail,
        applied: false,
        error: "fields already present at write time (no diff)",
      };
    }
    await atomicWriteText(candidate.pending_path_abs, rewritten);
    return {
      kind: "knowledge_relevance_fields_missing",
      path: candidate.pending_path,
      detail,
      applied: true,
    };
  } catch (error) {
    return {
      kind: "knowledge_relevance_fields_missing",
      path: candidate.pending_path,
      detail,
      applied: false,
      error: truncateErrorMessage(error),
    };
  }
}

function createRelevanceFieldsMissingCheck(
  t: Translator,
  inspection: RelevanceFieldsMissingInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.relevance_fields_missing.name"),
      t("doctor.check.relevance_fields_missing.ok"),
    );
  }
  const first = inspection.candidates[0];
  const missingParts: string[] = [];
  if (first.missing_scope) missingParts.push("relevance_scope");
  if (first.missing_paths) missingParts.push("relevance_paths");
  const detail = `${first.pending_path} (missing: ${missingParts.join(", ")})`;
  const count = inspection.candidates.length;
  return issueCheck(
    t("doctor.check.relevance_fields_missing.name"),
    "ok",
    "info",
    "knowledge_relevance_fields_missing",
    t(`doctor.check.relevance_fields_missing.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    t("doctor.check.relevance_fields_missing.remediation"),
  );
}

// ---------------------------------------------------------------------------
// rc.12 lint #29: skill_md_yaml_invalid.
//
// Scans `<projectRoot>/.claude/skills/*/SKILL.md` and `.codex/skills/*/SKILL.md`
// frontmatter for a plain-scalar value that contains an unquoted `: ` (colon
// followed by whitespace) or trailing `:`. Claude Code's YAML parser is
// lenient and tolerates it; Codex CLI's strict parser rejects the file with
// `mapping values are not allowed in this context` and silently drops the
// skill from the available list. The asymmetry produces cross-client
// breakage that is hard to spot — fab_doctor surfaces it as a warning.
//
// Warning kind (manual fix only). Recommendation: quote the value with `"..."`
// or rewrite the offending `key: value` token into `key=value` form.
// ---------------------------------------------------------------------------

const SKILL_MD_FRONTMATTER_ROOTS = [".claude/skills", ".codex/skills"] as const;
const SKILL_FRONTMATTER_KEY_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(.+?)[ \t]*$/u;
const SKILL_QUOTED_VALUE_LEADS = new Set(['"', "'", "[", "{", ">", "|"]);

type SkillMdYamlInvalidCandidate = {
  // Project-relative POSIX path to the offending SKILL.md.
  path: string;
  // 1-based line number inside the SKILL.md (matches editors and Codex's
  // own error message format).
  line: number;
  // The frontmatter key whose value violates strict YAML (typically `description`).
  key: string;
  // Short value snippet centered on the offending `: ` for human triage.
  preview: string;
};

type SkillMdYamlInvalidInspection = {
  candidates: SkillMdYamlInvalidCandidate[];
};

function inspectSkillMdYamlInvalid(projectRoot: string): SkillMdYamlInvalidInspection {
  const candidates: SkillMdYamlInvalidCandidate[] = [];
  for (const rootRel of SKILL_MD_FRONTMATTER_ROOTS) {
    const rootAbs = join(projectRoot, rootRel);
    if (!existsSync(rootAbs)) continue;
    let dirEntries;
    try {
      dirEntries = readdirSync(rootAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirEntry of dirEntries) {
      if (!dirEntry.isDirectory()) continue;
      const skillFile = join(rootAbs, dirEntry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      let raw: string;
      try {
        raw = readFileSync(skillFile, "utf8");
      } catch {
        continue;
      }
      const frontmatter = extractSkillFrontmatterLines(raw);
      if (frontmatter === null) continue;
      for (const { line, lineNumber } of frontmatter) {
        const match = SKILL_FRONTMATTER_KEY_PATTERN.exec(line);
        if (!match) continue;
        const [, key, value] = match;
        if (value.length === 0) continue;
        if (SKILL_QUOTED_VALUE_LEADS.has(value[0]!)) continue;
        const colonSpaceIdx = value.indexOf(": ");
        const trailingColon = value.endsWith(":");
        if (colonSpaceIdx < 0 && !trailingColon) continue;
        const anchor = colonSpaceIdx >= 0 ? colonSpaceIdx : value.length - 1;
        const previewStart = Math.max(0, anchor - 25);
        const previewEnd = Math.min(value.length, anchor + 30);
        const preview = `${previewStart > 0 ? "…" : ""}${value.slice(previewStart, previewEnd)}${previewEnd < value.length ? "…" : ""}`;
        candidates.push({
          path: posix.join(rootRel, dirEntry.name, "SKILL.md"),
          line: lineNumber,
          key,
          preview,
        });
      }
    }
  }
  candidates.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    return byPath !== 0 ? byPath : a.line - b.line;
  });
  return { candidates };
}

// Return the lines that fall between the opening `---` (required on line 1)
// and the next `---`. Returns null when the file has no well-formed
// frontmatter block — the lint conservatively says nothing about such files
// (other doctor lints already cover malformed-frontmatter cases for
// fabric-owned files; for third-party skills we don't want false positives
// on README-style markdown).
function extractSkillFrontmatterLines(
  raw: string,
): Array<{ line: string; lineNumber: number }> | null {
  const rawLines = raw.split(/\r?\n/u);
  if (rawLines.length < 2) return null;
  if (rawLines[0]?.trim() !== "---") return null;
  const out: Array<{ line: string; lineNumber: number }> = [];
  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    if (line.trim() === "---") {
      return out;
    }
    out.push({ line, lineNumber: i + 1 });
  }
  return null;
}

function createSkillMdYamlInvalidCheck(
  t: Translator,
  inspection: SkillMdYamlInvalidInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      t("doctor.check.skill_md_yaml_invalid.name"),
      t("doctor.check.skill_md_yaml_invalid.ok"),
    );
  }
  const first = inspection.candidates[0]!;
  const detail = `${first.path}:${first.line} (key \`${first.key}\` value contains an unquoted ': ' — preview: \`${first.preview}\`)`;
  const plural = inspection.candidates.length === 1;
  return issueCheck(
    t("doctor.check.skill_md_yaml_invalid.name"),
    "warn",
    "warning",
    "skill_md_yaml_invalid",
    t(`doctor.check.skill_md_yaml_invalid.message.${plural ? "singular" : "plural"}`, {
      count: String(inspection.candidates.length),
      detail,
    }),
    t("doctor.check.skill_md_yaml_invalid.remediation"),
  );
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.23 TASK-014 (F8c): onboard-coverage advisory.
//
// Walks canonical knowledge frontmatter for the `onboard_slot:` key, reads
// `fabric-config.json#onboard_slots_opted_out`, and reports which of the
// five S5 slots are unclaimed. Info kind — does NOT bump doctor status.
//
// This mirrors `runOnboardCoverage` in packages/cli/src/commands/onboard-coverage.ts
// — duplicated rather than imported because the server package has zero
// dependency on the CLI package (and vice-versa for the cross-package
// boundary). The scanner shape is small enough that duplication is cheaper
// than carving out a third "core" package. A drift test in doctor.test.ts
// asserts both implementations stay in agreement on a shared fixture.
//
// `--fix` does NOT touch onboard coverage — slot fill is a user-driven Skill
// flow, never an automated mutation. The advisory just informs.
// ---------------------------------------------------------------------------

const KNOWLEDGE_CANONICAL_TYPE_DIRS_FOR_ONBOARD = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
] as const;

type OnboardCoverageInspection = {
  filled: Record<OnboardSlot, string[]>;
  missing: OnboardSlot[];
  opted_out: string[];
};

function inspectOnboardCoverage(projectRoot: string): OnboardCoverageInspection {
  const filled = {} as Record<OnboardSlot, string[]>;
  for (const slot of ONBOARD_SLOT_NAMES) {
    filled[slot] = [];
  }
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  if (existsSync(knowledgeRoot)) {
    for (const typeDir of KNOWLEDGE_CANONICAL_TYPE_DIRS_FOR_ONBOARD) {
      const dir = join(knowledgeRoot, typeDir);
      if (!existsSync(dir)) continue;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".md")) continue;
        const filePath = join(dir, entry.name);
        let content: string;
        try {
          content = readFileSync(filePath, "utf8");
        } catch {
          continue;
        }
        const slot = readFrontmatterScalar(content, "onboard_slot");
        if (slot === undefined) continue;
        if (!(ONBOARD_SLOT_NAMES as readonly string[]).includes(slot)) continue;
        const stableId = readFrontmatterScalar(content, "id") ?? entry.name.replace(/\.md$/u, "");
        filled[slot as OnboardSlot].push(stableId);
      }
    }
  }
  for (const slot of ONBOARD_SLOT_NAMES) {
    filled[slot].sort();
  }
  const optedOut = readOnboardOptedOut(projectRoot);
  const missing: OnboardSlot[] = ONBOARD_SLOT_NAMES.filter((slot) => {
    if (filled[slot].length > 0) return false;
    if (optedOut.includes(slot)) return false;
    return true;
  });
  return { filled, missing, opted_out: optedOut };
}

function readOnboardOptedOut(projectRoot: string): string[] {
  const path = join(projectRoot, ".fabric", "fabric-config.json");
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const list = (parsed as Record<string, unknown>).onboard_slots_opted_out;
  if (!Array.isArray(list)) return [];
  return list.filter((v): v is string => typeof v === "string");
}

// Minimal frontmatter scalar reader — mirrors readFrontmatterKey in
// extract-knowledge.ts (also intentionally duplicated to avoid a cross-file
// import for a 10-line regex). Returns the trimmed value, with surrounding
// double-quotes stripped if present.
function readFrontmatterScalar(content: string, key: string): string | undefined {
  const match = /^---\n([\s\S]*?)\n---/u.exec(content);
  if (match === null) return undefined;
  const block = match[1];
  if (block === undefined) return undefined;
  for (const rawLine of block.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    if (line.slice(0, sep).trim() !== key) continue;
    let value = line.slice(sep + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function createOnboardCoverageCheck(t: Translator, inspection: OnboardCoverageInspection): DoctorCheck {
  const filledCount = ONBOARD_SLOT_NAMES.filter(
    (slot) => inspection.filled[slot].length > 0,
  ).length;
  if (inspection.missing.length === 0) {
    return okCheck(
      t("doctor.check.onboard_coverage.name"),
      t("doctor.check.onboard_coverage.ok.complete", {
        filledCount: String(filledCount),
        total: String(ONBOARD_SLOT_TOTAL),
        optedOutCount: String(inspection.opted_out.length),
      }),
    );
  }
  return issueCheck(
    t("doctor.check.onboard_coverage.name"),
    "ok",
    "info",
    "onboard_coverage_incomplete",
    t("doctor.check.onboard_coverage.message.incomplete", {
      missingSlots: inspection.missing.join(", "),
      filledCount: String(filledCount),
      total: String(ONBOARD_SLOT_TOTAL),
      optedOutCount: String(inspection.opted_out.length),
    }),
    t("doctor.check.onboard_coverage.remediation.incomplete"),
  );
}

// rc.6 TASK-023 (E6): lint #26 narrow_too_few. Info-kind finding that
// recommends running fabric-import to (re-)seed narrow anchors when EITHER
// the structural ratio of narrow-with-paths entries is too low OR the
// observed silence rate of the PreToolUse narrow hook is too high. The two
// arms point at the same recommendation because both indicate the narrow
// scope has drifted away from where edits actually land.
//
// Status remains "ok" (info kind) — narrow_too_few is an informational
// usage-pattern signal, not a correctness break. Mirrors the
// knowledge_underseeded (#22) precedent.
function createNarrowTooFewCheck(t: Translator, inspection: NarrowTooFewInspection): DoctorCheck {
  const { structural_flagged, telemetry_flagged } = inspection;
  if (!structural_flagged && !telemetry_flagged) {
    // Compose a passing message that includes whichever arm contributed
    // data — keeps the surface informative even on the happy path.
    const ratioPct = (inspection.narrow_ratio * 100).toFixed(0);
    const teleNote = inspection.telemetry_skipped
      ? t("doctor.check.narrow_too_few.message.telemetry_skipped")
      : t("doctor.check.narrow_too_few.message.telemetry_window", {
        silencePct: (inspection.silence_rate * 100).toFixed(0),
        windowDays: String(SILENCE_WINDOW_DAYS),
      });
    return okCheck(
      t("doctor.check.narrow_too_few.name"),
      t("doctor.check.narrow_too_few.ok", {
        ratioPct,
        narrowCount: String(inspection.narrow_with_paths_count),
        totalCount: String(inspection.total_canonical_entries),
        teleNote,
      }),
    );
  }
  // Build a message that describes which arm(s) fired. Both arms point at
  // the same fabric-import action, so the actionHint is unified.
  const parts: string[] = [];
  if (structural_flagged) {
    const ratioPct = (inspection.narrow_ratio * 100).toFixed(0);
    parts.push(
      t("doctor.check.narrow_too_few.message.structural", {
        ratioPct,
        narrowCount: String(inspection.narrow_with_paths_count),
        totalCount: String(inspection.total_canonical_entries),
        thresholdPct: (NARROW_RATIO_THRESHOLD * 100).toFixed(0),
      }),
    );
  }
  if (telemetry_flagged) {
    const silencePct = (inspection.silence_rate * 100).toFixed(0);
    parts.push(
      t("doctor.check.narrow_too_few.message.telemetry", {
        silencePct,
        silenceFires: String(inspection.silence_fires_in_window),
        totalFires: String(inspection.total_edit_fires_in_window),
        windowDays: String(SILENCE_WINDOW_DAYS),
        thresholdPct: (SILENCE_RATE_THRESHOLD * 100).toFixed(0),
      }),
    );
  }
  return issueCheck(
    t("doctor.check.narrow_too_few.name"),
    "ok",
    "info",
    "knowledge_narrow_too_few",
    t("doctor.check.narrow_too_few.message.summary", { parts: parts.join("; ") }),
    t("doctor.check.narrow_too_few.remediation"),
  );
}

// ---------------------------------------------------------------------------
// rc.4 TASK-002: read-side integrity lint inspections (#19-21).
//
// All three inspections walk the same dual-root canonical knowledge tree
// (team at `<projectRoot>/.fabric/knowledge/<type>/`, personal at
// `<FABRIC_HOME>/.fabric/knowledge/<type>/`) parsing stable_ids out of the
// canonical filename `<id>--<slug>.md` rather than YAML frontmatter — the
// id is the path-decoupled identity, and filename-level scanning keeps the
// inspections cheap (no file body read) for the integrity surface.
// ---------------------------------------------------------------------------

// Resolve the personal-layer knowledge root. Mirrors knowledge-meta-builder.ts's
// resolvePersonalRoot but inlined to avoid pulling that module into doctor's
// dependency graph (doctor has historically stayed self-contained on shared/
// utilities only). Test-friendly via FABRIC_HOME override.
function resolvePersonalKnowledgeRoot(): string {
  const home = process.env.FABRIC_HOME ?? homedir();
  return join(home, ".fabric", "knowledge");
}

type ParsedCanonicalFilename = {
  // Layer code parsed from the stable_id prefix.
  prefix: "KP" | "KT";
  // 3-letter knowledge type code.
  typeCode: "MOD" | "DEC" | "GLD" | "PIT" | "PRO";
  // Zero-padded counter parsed as a number (e.g. "0007" → 7).
  counter: number;
  // The full stable_id token (e.g. "KT-DEC-0007").
  stable_id: string;
};

// Pure parser. Returns null when the filename does not match the canonical
// `<id>--<slug>.md` shape. Files that don't match are silently skipped — the
// `stable_id_collision` and `filesystem_edit_fallback` checks already cover
// the orthogonal "unparseable canonical entry" surface.
function parseStableIdFromCanonicalFilename(filename: string): ParsedCanonicalFilename | null {
  const match = CANONICAL_KNOWLEDGE_FILENAME_PATTERN.exec(filename);
  if (match === null) {
    return null;
  }
  const stableId = match[1];
  // Re-parse the id token to extract structured fields. The outer pattern
  // already validated the shape, so this inner regex is a safe destructure.
  const inner = /^(K[PT])-(MOD|DEC|GLD|PIT|PRO)-(\d{4,})$/u.exec(stableId);
  if (inner === null) {
    return null;
  }
  return {
    prefix: inner[1] as "KP" | "KT",
    typeCode: inner[2] as ParsedCanonicalFilename["typeCode"],
    counter: Number.parseInt(inner[3], 10),
    stable_id: stableId,
  };
}

type CanonicalFilenameVisit = {
  layer: CanonicalLayer;
  type: typeof KNOWLEDGE_CANONICAL_TYPE_DIRS[number];
  filename: string;
  // Display path — project-relative POSIX for team layer; `~/.fabric/...`
  // form for personal layer (matches PERSONAL_CONTENT_REF_PREFIX in
  // knowledge-meta-builder.ts so messages render consistently with the rest of
  // the v2.0 surface).
  displayPath: string;
  parsed: ParsedCanonicalFilename;
};

// Generator over all canonical knowledge filenames across both physical
// trees. Yields only entries whose filename parses to a stable_id token —
// other files (legacy-named, README, etc.) are silently skipped.
function* iterateCanonicalFilenames(projectRoot: string): Generator<CanonicalFilenameVisit> {
  const teamRoot = join(projectRoot, ".fabric", "knowledge");
  const personalRoot = resolvePersonalKnowledgeRoot();

  for (const [layer, root, displayPrefix] of [
    ["team", teamRoot, ".fabric/knowledge"] as const,
    ["personal", personalRoot, "~/.fabric/knowledge"] as const,
  ]) {
    if (!existsSync(root)) {
      continue;
    }
    for (const typeDir of KNOWLEDGE_CANONICAL_TYPE_DIRS) {
      const dir = join(root, typeDir);
      if (!existsSync(dir)) {
        continue;
      }
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const parsed = parseStableIdFromCanonicalFilename(entry.name);
        if (parsed === null) {
          continue;
        }
        const displayPath = posix.join(displayPrefix, typeDir, entry.name);
        yield {
          layer,
          type: typeDir,
          filename: entry.name,
          displayPath,
          parsed,
        };
      }
    }
  }
}

// Inspection #19: stable_id duplicate. Two canonical files (across either
// layer) declaring the same stable_id is a hard integrity break — the
// path-decoupled identity model assumes each id is globally unique. Loud
// error, no auto-fix (manual triage to rename one of the colliders).
function inspectStableIdDuplicate(projectRoot: string): StableIdDuplicateInspection {
  const idToPaths = new Map<string, string[]>();
  for (const visit of iterateCanonicalFilenames(projectRoot)) {
    const existing = idToPaths.get(visit.parsed.stable_id) ?? [];
    existing.push(visit.displayPath);
    idToPaths.set(visit.parsed.stable_id, existing);
  }
  const duplicates: StableIdDuplicateGroup[] = [];
  for (const [stable_id, paths] of idToPaths) {
    if (paths.length > 1) {
      duplicates.push({ stable_id, paths: paths.slice().sort() });
    }
  }
  duplicates.sort((a, b) => a.stable_id.localeCompare(b.stable_id));
  return { duplicates };
}

// Inspection #20: layer mismatch. KP-* files under the team tree (or KT-*
// files under the personal tree) violate the layer-prefix invariant — a
// KP-prefixed entry should physically live under personal/ and vice versa.
// Loud error, no auto-fix (the right resolution is rename + move, which is
// review-flow territory).
function inspectLayerMismatch(projectRoot: string): LayerMismatchInspection {
  const mismatches: LayerMismatchEntry[] = [];
  for (const visit of iterateCanonicalFilenames(projectRoot)) {
    const expected_layer: CanonicalLayer = visit.parsed.prefix === "KT" ? "team" : "personal";
    if (expected_layer === visit.layer) {
      continue;
    }
    mismatches.push({
      path: visit.displayPath,
      located_in: visit.layer,
      expected_layer,
      stable_id: visit.parsed.stable_id,
    });
  }
  mismatches.sort((a, b) => a.path.localeCompare(b.path));
  return { mismatches };
}

// Inspection #21: index drift. agents.meta.json carries a `counters` envelope
// per (layer, type) recording the highest already-allocated counter (next
// allocateKnowledgeId() returns counter + 1; see shared/agents-meta.ts).
// If a canonical file on disk has a counter strictly exceeding that
// envelope, the next allocate would collide. Drift condition: meta counter
// `< max_observed`. When equal, the slot is synced and the next allocate
// is collision-free. The TASK-003 mutation bumps the slot to
// `max_observed + 1` so post-fix the next allocate yields a fresh id one
// past every observed counter.
//
// NOTE: this is intentionally distinct from inspectCounterDesync (the
// pre-existing rc.1 check). counter_desync reads from `meta.nodes[*].stable_id`
// — i.e. it requires the indexed envelope to know about the file. index_drift
// reads directly from the filesystem, so it catches drift even when the file
// is not yet indexed in agents.meta.json.nodes (e.g. a hand-dropped file
// before reconcileKnowledge has run).
function inspectIndexDrift(
  projectRoot: string,
  meta: MetaInspection,
): IndexDriftInspection {
  if (!meta.valid || meta.meta === null) {
    return { drifts: [] };
  }
  const counters = AgentsMetaCountersSchema.parse(meta.meta.counters ?? undefined);

  // Walk filesystem, track max counter per (layer-prefix, type-code).
  const observed: Record<"KP" | "KT", Record<ParsedCanonicalFilename["typeCode"], number>> = {
    KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
    KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
  };
  for (const visit of iterateCanonicalFilenames(projectRoot)) {
    const { prefix, typeCode, counter } = visit.parsed;
    if (counter > observed[prefix][typeCode]) {
      observed[prefix][typeCode] = counter;
    }
  }

  const drifts: IndexDriftEntry[] = [];
  for (const layer of ["KP", "KT"] as const) {
    for (const code of COUNTER_TYPE_CODES) {
      const max = observed[layer][code];
      if (max === 0) {
        // No canonical files of this (layer,type) on disk — drift cannot be
        // observed against a meta counter even if it's non-zero. Per task
        // spec: "missing counter (no entries of that type) → ok (no drift
        // on absent counter)". Equivalently: skip when max_observed is 0.
        continue;
      }
      const current = counters[layer][code];
      if (current < max) {
        drifts.push({
          layer,
          type: code,
          counter: current,
          max_observed: max,
          proposed_after: max + 1,
        });
      }
    }
  }
  drifts.sort((a, b) =>
    a.layer === b.layer ? a.type.localeCompare(b.type) : a.layer.localeCompare(b.layer),
  );
  return { drifts };
}

function createStableIdDuplicateCheck(t: Translator, inspection: StableIdDuplicateInspection): DoctorCheck {
  if (inspection.duplicates.length === 0) {
    return okCheck(
      t("doctor.check.stable_id_duplicate.name"),
      t("doctor.check.stable_id_duplicate.ok"),
    );
  }
  const first = inspection.duplicates[0];
  const detail = `${first.stable_id} appears in ${first.paths.length} files: ${first.paths.join(", ")}`;
  const count = inspection.duplicates.length;
  return issueCheck(
    t("doctor.check.stable_id_duplicate.name"),
    "error",
    "manual_error",
    "knowledge_stable_id_duplicate",
    t(`doctor.check.stable_id_duplicate.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    t("doctor.check.stable_id_duplicate.remediation"),
  );
}

function createLayerMismatchCheck(t: Translator, inspection: LayerMismatchInspection): DoctorCheck {
  if (inspection.mismatches.length === 0) {
    return okCheck(
      t("doctor.check.layer_mismatch.name"),
      t("doctor.check.layer_mismatch.ok"),
    );
  }
  const first = inspection.mismatches[0];
  const detail = `${first.stable_id} at ${first.path} (located in ${first.located_in}, expected ${first.expected_layer})`;
  const count = inspection.mismatches.length;
  return issueCheck(
    t("doctor.check.layer_mismatch.name"),
    "error",
    "manual_error",
    "knowledge_layer_mismatch",
    t(`doctor.check.layer_mismatch.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    t("doctor.check.layer_mismatch.remediation"),
  );
}

function createIndexDriftCheck(t: Translator, inspection: IndexDriftInspection): DoctorCheck {
  if (inspection.drifts.length === 0) {
    return okCheck(
      t("doctor.check.index_drift.name"),
      t("doctor.check.index_drift.ok"),
    );
  }
  const first = inspection.drifts[0];
  const detail = `${first.layer}.${first.type} counter=${first.counter} but max_observed=${first.max_observed} (would propose counters.${first.layer}.${first.type}=${first.proposed_after})`;
  const count = inspection.drifts.length;
  return issueCheck(
    t("doctor.check.index_drift.name"),
    "error",
    "fixable_error",
    "knowledge_index_drift",
    t(`doctor.check.index_drift.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    t("doctor.check.index_drift.remediation"),
  );
}

// v2/rc.2: Removed `inspectClaudeSkillLegacyPath`, `inspectClaudeHookLegacyPath`,
// `inspectCodexSkillLegacyPath` and their `create*Check` / `fix*` siblings.
// They migrated v1.x agents-md-init-reminder/skill paths into the v1 client-
// side init reminder/skill paths, both of which are now archaeology — rc.4
// owns v2 lint coverage for whatever skill/hook paths v2 introduces.

// v2.0 / rc.2: `inspectLegacyClientPaths`, `createLegacyClientPathCheck`,
// and `fixLegacyClientPaths` removed. Retired clientPaths keys
// (windsurf/rooCode/geminiCLI) are now rejected at Zod parse time on the
// strict clientPathsSchema — there is no soft-deprecation path to detect or
// fix. The corresponding `legacy_client_path_present` event-type literal
// remains in event-ledger.ts and will be removed in TASK-006 alongside the
// broader event-vocabulary rename.

// v2.0.0-rc.19 bootstrap-consolidation TASK-004: one-time legacy → new marker
// rewrite across the four bootstrap target paths. Mirrors the
// fixMcpConfigInWrongFile pattern (read → mutate → atomicWriteText). Idempotent:
// re-running on already-migrated content leaves bytes untouched (the .replace
// chain produces a string identical to the input when no legacy markers
// remain). Body content between the markers is preserved verbatim — only the
// marker tokens are rewritten. Any body-content drift is L2 drift territory
// (TASK-05's domain) and surfaces on the next doctor report.
//
// Returns the absolute paths of every file rewritten alongside a per-path
// replacement count so the dispatcher can emit one ledger event per file with
// the exact token-replacement count baked in.
async function migrateBootstrapMarkers(
  projectRoot: string,
): Promise<{ paths: string[]; countPerPath: Record<string, number> }> {
  const paths: string[] = [];
  const countPerPath: Record<string, number> = {};

  for (const rel of BOOTSTRAP_MARKER_MIGRATION_TARGETS) {
    const abs = join(projectRoot, rel);
    if (!existsSync(abs)) {
      continue;
    }
    let original: string;
    try {
      original = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    // Count legacy marker tokens BEFORE rewrite — sum of :begin + :end
    // occurrences. Drives `migrated_count` in the ledger event.
    const beginMatches = original.match(/<!-- fabric:knowledge-base:begin -->/g);
    const endMatches = original.match(/<!-- fabric:knowledge-base:end -->/g);
    const replacedCount = (beginMatches?.length ?? 0) + (endMatches?.length ?? 0);
    if (replacedCount === 0) {
      continue;
    }
    const rewritten = original
      .replace(/<!-- fabric:knowledge-base:begin -->/g, BOOTSTRAP_MARKER_BEGIN)
      .replace(/<!-- fabric:knowledge-base:end -->/g, BOOTSTRAP_MARKER_END);
    if (rewritten === original) {
      // Defensive: replacedCount > 0 implies a real rewrite, but guard against
      // surprise idempotency anyway.
      continue;
    }
    await atomicWriteText(abs, rewritten);
    paths.push(abs);
    countPerPath[abs] = replacedCount;
  }

  return { paths, countPerPath };
}

// v2.0.0-rc.19 bootstrap-consolidation TASK-005: L2 drift fix. Replays the
// three-end managed block writes using inline regex+replace logic — DUPLICATED
// from the install-side writers (TASK-003) in packages/cli rather than imported
// to preserve the cross-package boundary (packages/server has zero dep on
// packages/cli). Cross-reference: keep this logic byte-aligned with
// packages/cli/src/install/skills-and-hooks.ts writers when those land in
// TASK-003 — integration tests assert post-install and post-doctor-fix states
// are byte-equal.
//
// Behavior summary per target:
//   - AGENTS.md / .cursor/rules/fabric-bootstrap.mdc: locate-or-append a
//     managed block via BOOTSTRAP_REGEX; body is
//     `{BEGIN}\n{expectedBody}\n{END}`. In-place replace when marker present;
//     append with blank-line separator when absent. Skip files that do not
//     exist (propagator never ran — install bug, not doctor's concern).
//   - CLAUDE.md: idempotent line-add `@.fabric/AGENTS.md` (+ optional
//     `@.fabric/project-rules.md` when project-rules.md exists). No managed
//     block — thin shell convention.
async function rewriteThreeEndManagedBlocks(projectRoot: string): Promise<void> {
  const snapshotPath = join(projectRoot, ".fabric", "AGENTS.md");
  if (!existsSync(snapshotPath)) {
    // L1 fix should have created this — defensive guard.
    return;
  }
  let snapshot: string;
  try {
    snapshot = await readFile(snapshotPath, "utf8");
  } catch {
    return;
  }
  const projectRulesPath = join(projectRoot, ".fabric", "project-rules.md");
  const hasProjectRules = existsSync(projectRulesPath);
  let expectedBody = snapshot;
  if (hasProjectRules) {
    try {
      const projectRules = await readFile(projectRulesPath, "utf8");
      expectedBody = `${snapshot}\n---\n${projectRules}`;
    } catch {
      // fall back to snapshot-only
    }
  }
  const managedBlock = `${BOOTSTRAP_MARKER_BEGIN}\n${expectedBody}\n${BOOTSTRAP_MARKER_END}`;

  // Managed-block targets: AGENTS.md + .cursor/rules/fabric-bootstrap.mdc.
  const blockTargets = [
    join(projectRoot, "AGENTS.md"),
    join(projectRoot, ".cursor", "rules", "fabric-bootstrap.mdc"),
  ];
  for (const abs of blockTargets) {
    if (!existsSync(abs)) {
      continue;
    }
    let existing: string;
    try {
      existing = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    let next: string;
    const match = existing.match(BOOTSTRAP_REGEX);
    if (match !== null) {
      // In-place replace. Mirrors the install-side state-machine: strip the
      // matched region (markers + optional leading newlines), then re-append
      // with a leading blank-line separator. This keeps the trailing-newline
      // shape byte-identical across re-runs (idempotency invariant).
      const before = existing.slice(0, match.index ?? 0);
      const after = existing.slice((match.index ?? 0) + match[0].length);
      const stripped = `${before}${after.replace(/^\r?\n/, "")}`;
      const trailingNewline =
        stripped.length === 0 || stripped.endsWith("\n") ? "" : "\n";
      next = `${stripped}${trailingNewline}\n${managedBlock}\n`;
    } else {
      // Append with blank-line separator.
      const trailingNewline =
        existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      next = `${existing}${trailingNewline}\n${managedBlock}\n`;
    }
    if (next === existing) {
      continue;
    }
    await atomicWriteText(abs, next);
  }

  // CLAUDE.md: thin shell — idempotent line-add for `@.fabric/AGENTS.md` and
  // optionally `@.fabric/project-rules.md`. No managed block markers here.
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    let claudeContent: string;
    try {
      claudeContent = await readFile(claudeMdPath, "utf8");
    } catch {
      return;
    }
    const lines = claudeContent.split(/\r?\n/u);
    let updated = claudeContent;
    const ensureLine = (line: string): void => {
      if (lines.some((existingLine) => existingLine.trim() === line)) {
        return;
      }
      const trailingNewline =
        updated.length === 0 || updated.endsWith("\n") ? "" : "\n";
      updated = `${updated}${trailingNewline}${line}\n`;
      lines.push(line);
    };
    ensureLine("@.fabric/AGENTS.md");
    if (hasProjectRules) {
      ensureLine("@.fabric/project-rules.md");
    }
    if (updated !== claudeContent) {
      await atomicWriteText(claudeMdPath, updated);
    }
  }
}

async function fixMcpConfigInWrongFile(projectRoot: string): Promise<void> {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return;
  }

  let settings: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    settings = parsed as Record<string, unknown>;
  } catch {
    return;
  }

  const mcpServers = settings.mcpServers;
  if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return;
  }

  // Remove the fabric entry from mcpServers
  const { fabric: _removed, ...remainingServers } = mcpServers as Record<string, unknown>;
  const cleaned: Record<string, unknown> = { ...settings };

  if (Object.keys(remainingServers).length === 0) {
    delete cleaned.mcpServers;
  } else {
    cleaned.mcpServers = remainingServers;
  }

  await atomicWriteJson(settingsPath, cleaned, { indent: 2 });

  // Append a ledger event documenting the migration
  await appendEventLedgerEvent(projectRoot, {
    event_type: "mcp_config_migrated",
    source: "doctor_fix",
    removed_from: ".claude/settings.json",
  });
}

async function ensureKnowledgeSubdirs(projectRoot: string): Promise<void> {
  // v2.0 layout: ensure all required .fabric/knowledge/{type}/ subdirectories
  // exist. Idempotent — `mkdir({recursive: true})` succeeds when the dir is
  // already present. Does NOT touch any user content.
  for (const sub of KNOWLEDGE_SUBDIRS) {
    await mkdir(join(projectRoot, ".fabric", "knowledge", sub), { recursive: true });
  }
}

async function fixCounterDesync(projectRoot: string): Promise<void> {
  // Read current agents.meta.json, recompute the corrected counters envelope
  // from observed stable_ids, and write the meta back atomically. Stops if
  // meta is missing or unparseable (other doctor checks will surface those).
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  if (!existsSync(metaPath)) {
    return;
  }
  let meta: AgentsMeta;
  try {
    meta = agentsMetaSchema.parse(JSON.parse(await readFile(metaPath, "utf8")));
  } catch {
    return;
  }

  // Re-derive corrected counters using the same algorithm as inspectCounterDesync.
  const synthetic: MetaInspection = {
    present: true,
    valid: true,
    meta,
    revision: meta.revision,
    computedRevision: null,
    ruleCount: 0,
    missingContentRefs: [],
    invalidContentRefs: [],
    stale: false,
    changed: false,
  };
  const desync = inspectCounterDesync(synthetic);
  if (desync.desyncs.length === 0 || desync.correctedCounters === null) {
    return;
  }

  const updated: AgentsMeta = { ...meta, counters: desync.correctedCounters };
  await atomicWriteJson(metaPath, updated, { indent: 2 });
}

async function ensureEventLedger(projectRoot: string): Promise<void> {
  const path = getEventLedgerPath(projectRoot);
  await ensureParentDirectory(path);
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
}

// v2.0.0-rc.20 TASK-04: idempotently emit a `cite_policy_activated` marker on
// the first invocation for a given project. Subsequent invocations short-circuit
// after a single ledger read and report the existing marker's `ts`. Read/write
// failures are absorbed and reported as `{ marker_ts: 0, emitted_now: false }`
// so callers (doctor / fabric-hint warm-up) can keep moving without surfacing
// audit-trail churn to the user. Pairs with `assistant_turn_observed` (TASK-03):
// the activation marker anchors the policy_version under which subsequent
// per-turn observations were recorded.
//
// The hard-coded `CITE_POLICY_VERSION` literal is rotated by TASK-11's policy
// bump pass — kept inline (vs. a shared const) so a single grep over doctor.ts
// surfaces every site that needs updating.
const CITE_POLICY_VERSION = "2.0.0-rc.20";

export async function ensureCitePolicyActivatedMarker(
  projectRoot: string,
): Promise<{ marker_ts: number; emitted_now: boolean }> {
  let existing: { ts: number } | undefined;
  try {
    const { events } = await readEventLedger(projectRoot, { event_type: "cite_policy_activated" });
    if (events.length > 0) {
      existing = events[0];
    }
  } catch {
    return { marker_ts: 0, emitted_now: false };
  }

  if (existing !== undefined) {
    return { marker_ts: existing.ts, emitted_now: false };
  }

  try {
    const stored = await appendEventLedgerEvent(projectRoot, {
      event_type: "cite_policy_activated",
      policy_version: CITE_POLICY_VERSION,
      timestamp: new Date().toISOString(),
    });
    return { marker_ts: stored.ts, emitted_now: true };
  } catch {
    return { marker_ts: 0, emitted_now: false };
  }
}

// v2.0.0-rc.24 TASK-06: ensureCiteContractPolicyActivatedMarker — drift-gated
// counterpart to ensureCitePolicyActivatedMarker (rc.20). The cite-contract
// policy upgrade introduces structured `cite_commitments` written by post-rc.24
// hooks. During the rc.23 → rc.24 half-upgrade window (server on rc.24, hooks
// still rc.23) the marker emit MUST be refused — otherwise contract metrics
// open an audit window against events that physically cannot carry the new
// commitments field, manufacturing false `contract_missing` violations.
//
// The gate reuses `inspectL1BootstrapSnapshotDrift` (rc.19): if `.fabric/
// AGENTS.md` byte-equals the current `BOOTSTRAP_CANONICAL`, the user has run
// the rc.24 `fabric install` and the hook layer is in sync with the schema.
// 'missing' is also treated as drift (deliberate conservative choice — no
// install snapshot present means we cannot prove the hook layer matches; user
// must run `fabric install` to seed `.fabric/AGENTS.md`).
//
// Return shape mirrors `ensureCitePolicyActivatedMarker` with one added
// discriminator: `blocked_by`. `null` when activation succeeded (or marker
// already existed); `'bootstrap_drift'` when the snapshot did not byte-equal
// canonical. Caller (`runDoctorCiteCoverage` extension in TASK-08) renders
// `contract_check: skipped (bootstrap drift — run fabric install)` when this
// field is non-null.
export async function ensureCiteContractPolicyActivatedMarker(
  projectRoot: string,
): Promise<{
  marker_ts: number;
  emitted_now: boolean;
  blocked_by: "bootstrap_drift" | null;
}> {
  // Step 1: gate on bootstrap drift. Use the existing L1 inspector so the
  // drift definition stays single-sourced. Any inspector throw (permissions,
  // unreadable FS) is treated as drift — conservative: better to skip
  // activation than to falsely advance the contract window.
  let driftStatus: "ok" | "drift" | "missing";
  try {
    const inspection = await inspectL1BootstrapSnapshotDrift(projectRoot);
    driftStatus = inspection.status;
  } catch {
    driftStatus = "drift";
  }
  if (driftStatus !== "ok") {
    return { marker_ts: 0, emitted_now: false, blocked_by: "bootstrap_drift" };
  }

  // Step 2: mirror ensureCitePolicyActivatedMarker — read existing marker
  // first, then append-if-missing. Read/write failures collapse to the
  // sentinel `{ marker_ts: 0, emitted_now: false }` exactly as the rc.20
  // marker does. Note: `blocked_by` is `null` for the silent-failure path —
  // the drift gate is the only path that surfaces a blocker, the ledger
  // sentinel preserves the rc.20 "warm-up never raises" contract.
  let existing: { ts: number } | undefined;
  try {
    const { events } = await readEventLedger(projectRoot, {
      event_type: "cite_contract_policy_activated",
    });
    if (events.length > 0) {
      existing = events[0];
    }
  } catch {
    return { marker_ts: 0, emitted_now: false, blocked_by: null };
  }

  if (existing !== undefined) {
    return { marker_ts: existing.ts, emitted_now: false, blocked_by: null };
  }

  try {
    const stored = await appendEventLedgerEvent(projectRoot, {
      event_type: "cite_contract_policy_activated",
    });
    return { marker_ts: stored.ts, emitted_now: true, blocked_by: null };
  } catch {
    return { marker_ts: 0, emitted_now: false, blocked_by: null };
  }
}

// v2.0.0-rc.20 TASK-05: cite policy adherence report shape returned by
// `fabric doctor --cite-coverage`. STUB scaffolding — TASK-06 fills the
// `metrics` / `per_client` / `dismissed_reason_histogram` fields by scanning
// `assistant_turn_observed` ledger events emitted by TASK-03. The shape is
// finalized here so the CLI renderer (TASK-07) and any downstream consumers
// can compile against a stable type before metrics are populated.
//
// status:
//   - 'skipped' when no `cite_policy_activated` marker exists AND the marker
//     write also failed (degraded ledger). Callers should render this as
//     "no data yet — re-run after first AI turn" rather than as an error.
//   - 'ok' once the marker is present (newly emitted or pre-existing). Zero
//     metrics in 'ok' status are valid: it means the marker is fresh and no
//     qualifying turns have been observed yet within the requested window.
//
// per_client / dismissed_reason_histogram are intentionally optional — they
// are only emitted by TASK-06 once the underlying observation events carry
// the `client` and `dismissed_reason` fields. STUB returns neither.
//
// v2.0.0-rc.24 TASK-08: extended with contract-policy metrics. Five new
// accumulators (contract_with / contract_missing / hard_violated / skip_count
// / cite_id_unresolved) plus per-(layer, type) cross-tab and a
// contract_metrics_status discriminator gating the contract audit window.
// The rc.20 metrics block stays untouched — contract metrics are an additive
// extension. See plan.json design_decisions for the B4 marker-independence
// rationale.
export type CiteContractMetrics = {
  // Counts of strict-bucket cites (decision/pitfall) actually observed in the
  // contract window. decisions_cited + pitfalls_cited = the denominator that
  // contract_with / contract_missing / hard_violated partitions.
  decisions_cited: number;
  pitfalls_cited: number;
  // contract_with: strict-bucket cite carried at least one operator (i.e.
  // commitment.operators.length > 0). contract_missing: strict-bucket cite
  // had no operators AND no skip_reason — the lazy default the policy
  // explicitly refuses. hard_violated: cite had operators but the session
  // edits diverged from at least one operator (e.g. edit:foo.ts but no
  // session edit hit foo.ts). cite_id_unresolved: cite_id absent from
  // knowledge-meta idTypeMap (hallucinated id or stale meta).
  contract_with: number;
  contract_missing: number;
  hard_violated: number;
  cite_id_unresolved: number;
  // skip_count: histogram of skip_reason buckets. Keys are the reasons the
  // hook parser emitted verbatim — bootstrap docs canonicalize the vocabulary
  // (e.g. "sequencing", "tribal-knowledge"), but the doctor does NOT
  // gatekeeper the enum here; it surfaces whatever the parser wrote so
  // operators can data-drive vocabulary expansion (per B1 grill-me lock).
  skip_count: Record<string, number>;
};

// Per-(layer, type) cross-tab — populated whenever contract metrics are
// computed. Keyed by layer ("team"/"personal") then by PLURAL knowledge_type
// (rc.29 BUG-C1) from TASK-07's idTypeMap (so the keys match the schema enum
// verbatim).
// "unresolved" is a sixth bucket for cite_ids that did not resolve in
// idTypeMap. Counts are turn-cite occurrences, not session-level.
export type CiteLayerTypeBreakdown = {
  team: Record<string, number>;
  personal: Record<string, number>;
};

export type CiteCoverageReport = {
  status: "ok" | "skipped";
  marker_ts: number;
  marker_emitted_now: boolean;
  since_ts: number;
  client_filter: "cc" | "codex" | "cursor" | "all";
  // v2.0.0-rc.24 TASK-08: layer filter for personal-layer parity. 'all' =
  // both team (KT-*) and personal (KP-*); 'team' / 'personal' = restrict
  // top-level metrics to one root. Optional (defaults to 'all') so existing
  // callers (CLI rc.20 surface) do not break before TASK-10 wires the flag.
  layer_filter?: "team" | "personal" | "all";
  metrics: {
    edits_touched: number;
    qualifying_cites: number;
    recalled_unverified: number;
    expected_but_missed: number;
    total_turns: number;
    // v2.0.0-rc.38 UX-8 (C): cite-policy compliance rate (corrected G-CITE
    // metric). See api-contracts citeCoverageReportSchema for semantics.
    cite_compliance_rate?: number | null;
    compliant_cites?: number;
    noncompliant_cites?: number;
    // v2.0.0-rc.38 UX-8 (C, hardening): edit signals lacking session_id (can't
    // correlate → silently excluded from expected_but_missed). >0 usually means
    // a stale pre-session_id hook is installed; run `fabric install`.
    uncorrelatable_edits?: number;
  };
  per_client?: Record<string, Partial<CiteCoverageReport["metrics"]>>;
  dismissed_reason_histogram?: Record<string, number>;
  // v2.0.0-rc.23 TASK-08(c): breakdown of `KB: none` sentinel tails parsed
  // from `kb_line_raw`. Keys: 'no-relevant' (LLM searched, nothing matched),
  // 'not-applicable' (action not in cite scope), 'unspecified' (bare `KB:
  // none` — legacy/lazy). Optional — only emitted when at least one turn
  // carried the `none` cite tag.
  none_reason_histogram?: Record<string, number>;
  // v2.0.0-rc.24 TASK-08: contract-policy audit metrics. `status` discriminates:
  //   - 'ok'                       — contract metrics populated (marker present).
  //   - 'skipped:bootstrap_drift'  — `fabric install` has not run post-upgrade;
  //                                  contract_metrics shape is present but all
  //                                  counters are zero.
  //   - 'awaiting_marker'          — marker emit succeeded in the past but a
  //                                  read/write degraded the current invocation
  //                                  (rare); same zero-counter degraded mode.
  // contract_metrics is always emitted (even in skipped states) so the CLI
  // renderer (TASK-09) can iterate the shape without optional-chaining each
  // field. per_layer_type is likewise always emitted with zeroed buckets.
  contract_metrics_status?: "ok" | "skipped:bootstrap_drift" | "awaiting_marker";
  contract_metrics?: CiteContractMetrics;
  per_layer_type?: CiteLayerTypeBreakdown;
  contract_marker_ts?: number;
  generated_at: string;
  // v2.0.0-rc.39: when the --since window reaches into cite-audit-rolled-up
  // days, the rolled-up daily metrics are merged into the totals above (raw +
  // rollup are disjoint). These surface the merge for transparency + let the
  // CLI render the long-range daily compliance trend. Omitted when no rollup
  // day fell in window (the common short-window case).
  rollup_days_merged?: number;
  rollup_trend?: { date: string; generated_at: string; metrics: CiteCoverageReport["metrics"] }[];
};

// v2.0.0-rc.23 TASK-08(c): extract the `KB: none` sentinel reason from the raw
// kb-line text. Returns 'no-relevant' / 'not-applicable' for the documented
// enums, 'unspecified' for bare `KB: none` (legacy form). Unknown bracket
// payloads also collapse to 'unspecified' — we keep the histogram bounded to
// known buckets and rely on bootstrap docs to channel new emissions into the
// enum. Case-insensitive on the bracket payload, tolerant of surrounding
// whitespace.
function parseNoneSentinel(kbLineRaw: string | null | undefined): string {
  if (typeof kbLineRaw !== "string" || kbLineRaw.length === 0) return "unspecified";
  const m = kbLineRaw.match(/^KB:\s*none\b\s*(?:\[([^\]]*)\])?\s*$/i);
  if (m === null) return "unspecified";
  const inner = (m[1] ?? "").trim().toLowerCase();
  if (inner === "no-relevant" || inner === "not-applicable") return inner;
  return "unspecified";
}

// v2.0.0-rc.20 TASK-06: cite-coverage helpers.
//
// `categorizeCiteTag` normalizes the cite_tags vocabulary into one of the five
// outcome buckets the report tabulates. Tags may carry a colon-separated
// `dismissed:<reason>` payload (e.g. 'dismissed:scope-mismatch',
// 'dismissed:other:<text>'); the reason is split out for the histogram. TASK-02
// constrained the on-ledger tag enum to the bare five values, but per-turn
// dismissed reasons surface via the raw `kb_line_raw` text for now — until
// TASK-09 widens the schema, the histogram only counts `dismissed` as a
// generic bucket. The split logic is wired here so TASK-09 only needs to flip
// on a schema field without touching the aggregator.
// v2.1.0-rc.1 (ADJ-P4-1, full remap): cite_tags reaches this aggregator already
// normalized to the rc.37 NEW-1 2-state vocab — citeTagSchema's preprocess
// remaps legacy planned/recalled/chained-from → `applied` on read, so the legacy
// categories can never appear here. `applied` is the single qualifying category.
type CiteTagCategory = "applied" | "dismissed" | "none";

function categorizeCiteTag(tag: string): { category: CiteTagCategory; reason?: string } {
  if (tag === "applied" || tag === "none") {
    return { category: tag };
  }
  if (tag === "dismissed") {
    return { category: "dismissed", reason: "unspecified" };
  }
  if (tag.startsWith("dismissed:")) {
    const remainder = tag.slice("dismissed:".length);
    if (remainder.startsWith("other:")) {
      return { category: "dismissed", reason: remainder.slice("other:".length) || "other" };
    }
    return { category: "dismissed", reason: remainder || "unspecified" };
  }
  // Unknown tag — treat as 'none' so the aggregator does not blow up on a
  // future schema bump. Mirrors how `buildLastActiveIndex` ignores unrecognized
  // event_types via its default branch.
  return { category: "none" };
}

function matchesRelevancePath(editPath: string, relevancePaths: readonly string[]): boolean {
  if (relevancePaths.length === 0) {
    return false;
  }
  const normalized = normalizePath(editPath);
  for (const glob of relevancePaths) {
    if (minimatch(normalized, glob, { dot: true, matchBase: false })) {
      return true;
    }
  }
  return false;
}

// v2.0.0-rc.39 (P1 emit-fold reader merge): empty-shell assistant_turn_observed
// turns no longer hit events.jsonl — the fabric-hint Stop hook (and the one-time
// doctor --fix purge) fold them into metrics.jsonl counter rows keyed
// `assistant_turn_observed[:<client>]`. To keep total_turns byte-for-byte
// invariant across the fold, the live cite-coverage / emit-cadence readers add
// these counters back. This helper sums the in-window folded turns, honouring
// the same client + `[since, until)` window semantics the raw-turn loop applies.
//
// Window: a row counts when `since <= row.ts (< until)`. The fold writer stamps
// each row with a ts inside the original turns' day (min ts of the folded
// group), so day-level windowing matches the raw-event filter exactly for any
// since/until that does not bisect a folded group's day — the real corpora keep
// all folded empties strictly inside the live window, so this is exact.
//
// Client filter mirrors filteredTurns: 'all' sums every namespace (incl. the
// bare, client-undefined key); a specific client sums ONLY that client's
// namespaced key (a bare-key fold has no client discriminator, exactly as a
// client-undefined raw turn is excluded from a narrowed query).
const ASSISTANT_TURN_COUNTER_PREFIX = "assistant_turn_observed";
function sumFoldedTurnCounters(
  rows: MetricsRow[],
  options: { since: number; until?: number; client: "cc" | "codex" | "cursor" | "all" },
): number {
  let sum = 0;
  for (const row of rows) {
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (ts < options.since) continue;
    if (options.until !== undefined && ts >= options.until) continue;
    for (const [key, value] of Object.entries(row.counters)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      let matches = false;
      if (options.client === "all") {
        matches = key === ASSISTANT_TURN_COUNTER_PREFIX || key.startsWith(`${ASSISTANT_TURN_COUNTER_PREFIX}:`);
      } else {
        matches = key === `${ASSISTANT_TURN_COUNTER_PREFIX}:${options.client}`;
      }
      if (matches) sum += value;
    }
  }
  return sum;
}

// v2.0.0-rc.20 TASK-06: Real cite-coverage report. Single readEventLedger pass
// (event-type filter is intentionally omitted so the discriminated-union
// partitioning happens in a single for-loop, per the buildLastActiveIndex
// structural twin at L2885). Aggregates five metrics:
//
//   - total_turns:           assistant_turn_observed in window (filtered by
//                            client when options.client !== 'all').
//   - qualifying_cites:      cite_tags === 'applied' (rc.37 2-state vocab; the
//                            legacy planned/recalled/chained-from are remapped
//                            to 'applied' on read — see ADJ-P4-1).
//   - recalled_unverified:   'applied' tag with no knowledge_sections_fetched
//                            in the same session within ±60s (the [applied]
//                            verification-obligation check; field name retained
//                            for report-contract stability).
//   - edits_touched:         edit_intent_checked events in window.
//   - expected_but_missed:   edit_intent_checked whose path matches some kb
//                            entry's relevance_paths but no assistant_turn in
//                            the same session cited that kb_id.
//
// Narrow vs. broad denominator: per the cite-policy spec, narrow KBs
// (relevance_paths.length > 0) should only be expected when an edit touched
// a matching path; broad KBs are always-on. This shapes `expected_but_missed`:
// narrow KBs contribute only when a path-match exists, broad KBs are not
// counted here (they never produce 'missed' — they are by definition always
// in scope, so the qualifying_cites/total_turns ratio is the broad signal).
//
// Performance: O(N events + M turns × cite_ids + E edits × K narrow_kbs).
// For typical ledgers (<10k events, <100 narrow kbs) this stays well under
// 100ms — matches the buildLastActiveIndex envelope.
export async function runDoctorCiteCoverage(
  projectRoot: string,
  options: {
    since: number;
    client: "cc" | "codex" | "cursor" | "all";
    // v2.0.0-rc.24 TASK-08: layer filter for personal-layer parity. Optional
    // — defaults to 'all' so the CLI rc.20 surface (which has not yet wired
    // --layer; TASK-10 owns that change) keeps working byte-for-byte.
    layer?: "team" | "personal" | "all";
    // rc.39: optional exclusive upper bound (ms). When set, only events with
    // ts < until are aggregated. Additive — omitting it preserves byte-for-byte
    // behaviour. Used by the cite-audit rollup to compute a single UTC-day
    // window {since: dayStart, until: dayEnd} by reusing this exact aggregation
    // (no duplicate metric logic that could drift from the live report).
    until?: number;
  },
): Promise<CiteCoverageReport> {
  const layerFilter = options.layer ?? "all";
  const marker = await ensureCitePolicyActivatedMarker(projectRoot);
  // v2.0.0-rc.24 TASK-08: contract marker (independent audit window from the
  // rc.20 cite_policy_activated marker — see plan B4). The drift gate inside
  // ensureCiteContractPolicyActivatedMarker bridges the rc.23→rc.24
  // half-upgrade window: when `.fabric/AGENTS.md` does NOT byte-equal the
  // current BOOTSTRAP_CANONICAL we refuse activation, so contract metrics
  // surface as 'skipped:bootstrap_drift' until the user reruns `fabric install`.
  const contractMarker = await ensureCiteContractPolicyActivatedMarker(projectRoot);
  // idTypeMap loaded once per invocation — typical corpora <200 entries so
  // <5ms, no caching needed. An empty map (no meta or read failure) collapses
  // every cite into the cite_id_unresolved bucket which is the correct
  // degraded mode (operators can fix by running `fabric doctor --fix`).
  const idTypeMap = await loadKbIdTypeMap(projectRoot);
  const generatedAt = new Date().toISOString();
  const zeroMetrics: CiteCoverageReport["metrics"] = {
    edits_touched: 0,
    qualifying_cites: 0,
    recalled_unverified: 0,
    expected_but_missed: 0,
    total_turns: 0,
  };

  // Contract-metrics status discriminator. Resolved here (before any ledger
  // I/O) so all early-return branches can attach the same zeroed contract
  // shape — the CLI renderer never has to optional-chain.
  const contractStatus: "ok" | "skipped:bootstrap_drift" | "awaiting_marker" =
    contractMarker.blocked_by === "bootstrap_drift"
      ? "skipped:bootstrap_drift"
      : contractMarker.marker_ts === 0
        ? "awaiting_marker"
        : "ok";
  const zeroContractMetrics: CiteContractMetrics = {
    decisions_cited: 0,
    pitfalls_cited: 0,
    contract_with: 0,
    contract_missing: 0,
    hard_violated: 0,
    cite_id_unresolved: 0,
    skip_count: {},
  };
  const zeroLayerType: CiteLayerTypeBreakdown = {
    team: {},
    personal: {},
  };

  if (marker.marker_ts === 0) {
    return {
      status: "skipped",
      marker_ts: 0,
      marker_emitted_now: false,
      since_ts: options.since,
      client_filter: options.client,
      layer_filter: layerFilter,
      metrics: zeroMetrics,
      contract_metrics_status: contractStatus,
      contract_metrics: zeroContractMetrics,
      per_layer_type: zeroLayerType,
      contract_marker_ts: contractMarker.marker_ts,
      generated_at: generatedAt,
    };
  }

  // effectiveSince anchors the window at the policy marker — observations
  // recorded before the policy activated are not coverable under it.
  const effectiveSince = Math.max(marker.marker_ts, options.since);

  // v2.0.0-rc.24 TASK-08: contract metrics open their OWN audit window — the
  // rc.20 marker (which gates qualifying_cites/recalled_unverified) is
  // intentionally NOT used here. When contractStatus !== 'ok', this bound
  // stays at Infinity (no event qualifies). Otherwise we take max with the
  // user's `since` so --since narrows both windows symmetrically.
  const contractEffectiveSince = contractStatus === "ok"
    ? Math.max(contractMarker.marker_ts, options.since)
    : Number.POSITIVE_INFINITY;

  // Single ledger pass — collect ALL events in window, partition by type.
  let ledgerEvents: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot, { since: effectiveSince });
    // rc.39: apply optional exclusive upper bound for single-day rollup windows.
    ledgerEvents = options.until === undefined
      ? result.events
      : result.events.filter((e) => e.ts < (options.until as number));
  } catch {
    // Degraded ledger — fall back to ok-with-zero rather than 'skipped' since
    // the marker is present. CLI renderer (TASK-07) surfaces zero metrics as
    // "no qualifying turns yet" which is the correct user-facing message.
    return {
      status: "ok",
      marker_ts: marker.marker_ts,
      marker_emitted_now: marker.emitted_now,
      since_ts: effectiveSince,
      client_filter: options.client,
      layer_filter: layerFilter,
      metrics: zeroMetrics,
      contract_metrics_status: contractStatus,
      contract_metrics: zeroContractMetrics,
      per_layer_type: zeroLayerType,
      contract_marker_ts: contractMarker.marker_ts,
      generated_at: generatedAt,
    };
  }

  type TurnEvent = Extract<EventLedgerEvent, { event_type: "assistant_turn_observed" }>;
  type EditEvent = Extract<EventLedgerEvent, { event_type: "edit_intent_checked" }>;
  type FetchEvent = Extract<EventLedgerEvent, { event_type: "knowledge_sections_fetched" }>;
  const assistantTurns: TurnEvent[] = [];
  const editEvents: EditEvent[] = [];
  const fetchEvents: FetchEvent[] = [];
  for (const event of ledgerEvents) {
    switch (event.event_type) {
      case "assistant_turn_observed":
        assistantTurns.push(event);
        break;
      case "edit_intent_checked":
        editEvents.push(event);
        break;
      case "knowledge_sections_fetched":
        fetchEvents.push(event);
        break;
      default:
        break;
    }
  }

  // Apply client filter to assistant turns (edit/fetch events are not
  // client-scoped — they originate from the hook layer regardless of which
  // assistant produced the upstream turn).
  const filteredTurns = options.client === "all"
    ? assistantTurns
    : assistantTurns.filter((t) => t.client === options.client);

  // Cross-client denominator guard. Edit events carry no `client` field, so a
  // naive walk would let codex-session edits inflate edits_touched and trigger
  // expected_but_missed against a cc-filtered cited-kb map that never had a
  // chance to populate (its source turns were filtered out). We rebuild a set
  // of session_ids whose turns include at least one matching-client turn from
  // the UNFILTERED assistant turn list, then gate the edit loop on it. When
  // the client filter is 'all', this set stays null and every edit counts.
  let clientSessionIds: Set<string> | null = null;
  if (options.client !== "all") {
    clientSessionIds = new Set<string>();
    for (const turn of assistantTurns) {
      if (turn.client === options.client) {
        const sid = turn.session_id;
        if (typeof sid === "string" && sid.length > 0) {
          clientSessionIds.add(sid);
        }
      }
    }
  }

  // Build kb index from agents.meta.json. Map stable_id → relevance metadata.
  // A missing meta file (fresh project, doctor pre-init) collapses to an empty
  // index — narrow denominator becomes zero, broad logic still functions on
  // turn data alone.
  type KbEntry = { relevance_paths: readonly string[]; relevance_scope: "narrow" | "broad" };
  const kbIndex = new Map<string, KbEntry>();
  try {
    const meta = await readAgentsMeta(projectRoot);
    for (const node of Object.values(meta.nodes)) {
      const stableId = node.stable_id;
      if (typeof stableId !== "string" || stableId.length === 0) continue;
      const description = node.description;
      if (description === undefined) continue;
      const paths = description.relevance_paths ?? [];
      const scope = description.relevance_scope ?? "broad";
      kbIndex.set(stableId, {
        relevance_paths: paths,
        // A broad entry with no paths is the safe default. A narrow entry must
        // carry at least one path; an empty-paths narrow is treated as broad.
        relevance_scope: scope === "narrow" && paths.length > 0 ? "narrow" : "broad",
      });
    }
  } catch {
    // No meta file or invalid — kbIndex stays empty.
  }

  // Per-session lookup of fetch events for recalled_unverified correlation.
  // Key: session_id, Value: sorted timestamps of fetch events in that session.
  const fetchesBySession = new Map<string, number[]>();
  for (const fetch of fetchEvents) {
    const sid = fetch.session_id;
    if (typeof sid !== "string" || sid.length === 0) continue;
    const list = fetchesBySession.get(sid) ?? [];
    list.push(fetch.ts);
    fetchesBySession.set(sid, list);
  }
  for (const list of fetchesBySession.values()) {
    list.sort((a, b) => a - b);
  }
  const RECALL_WINDOW_MS = 60_000;
  const isRecallVerified = (turn: TurnEvent): boolean => {
    const sid = turn.session_id;
    if (typeof sid !== "string" || sid.length === 0) return false;
    const fetches = fetchesBySession.get(sid);
    if (fetches === undefined || fetches.length === 0) return false;
    for (const ft of fetches) {
      if (Math.abs(ft - turn.ts) <= RECALL_WINDOW_MS) return true;
    }
    return false;
  };

  // Aggregation pass — single sweep over filtered turns. Build both the
  // top-level metrics and per-client buckets in one walk.
  const dismissedHistogram: Record<string, number> = {};
  // v2.0.0-rc.23 TASK-08(c): `KB: none` sentinel breakdown. Keyed by
  // 'no-relevant' / 'not-applicable' / 'unspecified'.
  const noneHistogram: Record<string, number> = {};
  const perClientAccum = new Map<string, CiteCoverageReport["metrics"]>();
  const emptyMetrics = (): CiteCoverageReport["metrics"] => ({
    edits_touched: 0,
    qualifying_cites: 0,
    recalled_unverified: 0,
    expected_but_missed: 0,
    total_turns: 0,
  });
  const bumpClient = (client: string | undefined, mut: (m: CiteCoverageReport["metrics"]) => void): void => {
    if (typeof client !== "string" || client.length === 0) return;
    const existing = perClientAccum.get(client) ?? emptyMetrics();
    mut(existing);
    perClientAccum.set(client, existing);
  };

  // session_id → Set<cite_id> for expected_but_missed correlation.
  const sessionCitedKbs = new Map<string, Set<string>>();

  // v2.0.0-rc.24 TASK-08: per-session edit-path index for contract operator
  // evaluation. Built once from the edit events partition; reused across the
  // turn loop. Each session maps to its observed edit paths (normalized).
  const sessionEditPaths = new Map<string, string[]>();
  for (const edit of editEvents) {
    const sid = edit.session_id;
    if (typeof sid !== "string" || sid.length === 0) continue;
    const list = sessionEditPaths.get(sid) ?? [];
    list.push(normalizePath(edit.path));
    sessionEditPaths.set(sid, list);
  }

  // v2.0.0-rc.24 TASK-08: contract accumulators.
  let decisionsCited = 0;
  let pitfallsCited = 0;
  let contractWith = 0;
  let contractMissing = 0;
  let hardViolated = 0;
  let citeIdUnresolved = 0;
  const skipCount: Record<string, number> = {};
  const layerTypeAccum: CiteLayerTypeBreakdown = { team: {}, personal: {} };
  const bumpLayerType = (citeId: string, type: string): void => {
    const layer = citeId.startsWith("KP-") ? "personal" : citeId.startsWith("KT-") ? "team" : null;
    if (layer === null) return;
    layerTypeAccum[layer][type] = (layerTypeAccum[layer][type] ?? 0) + 1;
  };
  // Layer filter helper — decides whether a cite_id contributes to the
  // top-level rc.20 metrics (qualifying_cites etc.) AND to the contract
  // accumulators. Edits don't carry layer info (they describe filesystem
  // paths, not knowledge entries) so edits are NOT layer-filtered. Cites
  // with neither KP-/KT- prefix (rare/legacy) pass through under 'all' but
  // are dropped under any narrowed filter — conservative.
  const passesLayerFilter = (citeId: string): boolean => {
    if (layerFilter === "all") return true;
    if (layerFilter === "team") return citeId.startsWith("KT-");
    return citeId.startsWith("KP-");
  };

  // Operator-vs-edits comparator. session_id is required to evaluate edits;
  // a turn lacking a session_id is treated as having NO observable edits,
  // which means edit:/not_edit: operators violate on edit: and pass on
  // not_edit:. This matches the conservative "no evidence the edit
  // happened" interpretation.
  //
  // require:/forbid: operator vs diff content: the edit_intent_checked
  // event schema (event-ledger.ts L53-L68) carries no full diff content —
  // only path / compliant / intent / optional diff_stat (numeric summary)
  // / optional annotation. We therefore SCOPE the require:/forbid: check
  // to "<symbol present in any changed file PATH>" — a strict downgrade
  // from the planned diff-content match, documented in TASK-08 summary so
  // TASK-09 i18n can label this honestly. If a future rc widens the
  // ledger schema to carry the textual diff, only this comparator function
  // changes.
  const evaluateOperatorViolation = (
    sessionId: string | undefined,
    operators: ReadonlyArray<{ kind: "edit" | "not_edit" | "require" | "forbid"; target: string }>,
  ): boolean => {
    const editPaths = (typeof sessionId === "string" && sessionId.length > 0)
      ? (sessionEditPaths.get(sessionId) ?? [])
      : [];
    for (const op of operators) {
      switch (op.kind) {
        case "edit": {
          let matched = false;
          for (const p of editPaths) {
            if (minimatch(p, op.target, { dot: true, matchBase: false })) {
              matched = true;
              break;
            }
          }
          if (!matched) return true;
          break;
        }
        case "not_edit": {
          for (const p of editPaths) {
            if (minimatch(p, op.target, { dot: true, matchBase: false })) {
              return true;
            }
          }
          break;
        }
        case "require": {
          // Scoped to file-path symbol match (substring) — diff content not
          // available in ledger. Documented in TASK-08 summary.
          let found = false;
          for (const p of editPaths) {
            if (p.includes(op.target)) {
              found = true;
              break;
            }
          }
          if (!found) return true;
          break;
        }
        case "forbid": {
          for (const p of editPaths) {
            if (p.includes(op.target)) {
              return true;
            }
          }
          break;
        }
        default:
          break;
      }
    }
    return false;
  };

  let totalTurns = 0;
  let qualifyingCites = 0;
  let recalledUnverified = 0;

  for (const turn of filteredTurns) {
    totalTurns += 1;
    bumpClient(turn.client, (m) => {
      m.total_turns += 1;
    });

    const sid = turn.session_id;
    if (typeof sid === "string" && sid.length > 0) {
      const set = sessionCitedKbs.get(sid) ?? new Set<string>();
      for (const id of turn.cite_ids) {
        set.add(id);
      }
      sessionCitedKbs.set(sid, set);
    }

    // -------------------------------------------------------------------
    // rc.20 cite_tags walk (unchanged behavior — touch only if the
    // categorize/dismissed/none shape needs widening).
    // -------------------------------------------------------------------
    let turnHadApplied = false;
    for (const tag of turn.cite_tags) {
      const { category, reason } = categorizeCiteTag(tag);
      switch (category) {
        case "applied":
          qualifyingCites += 1;
          bumpClient(turn.client, (m) => {
            m.qualifying_cites += 1;
          });
          turnHadApplied = true;
          break;
        case "dismissed": {
          const key = reason ?? "unspecified";
          dismissedHistogram[key] = (dismissedHistogram[key] ?? 0) + 1;
          break;
        }
        case "none": {
          // v2.0.0-rc.23 TASK-08(c): parse sentinel tail from kb_line_raw and
          // bump the breakdown bucket. Bare `KB: none` → 'unspecified'.
          const sentinel = parseNoneSentinel(turn.kb_line_raw);
          noneHistogram[sentinel] = (noneHistogram[sentinel] ?? 0) + 1;
          break;
        }
        default:
          break;
      }
    }

    // v2.1.0-rc.1 (ADJ-P4-1): `recalled_unverified` retains its report-contract
    // name but now measures the rc.37 NEW-1 `[applied]` verification obligation
    // directly — an `applied` cite with no knowledge_sections_fetched in the same
    // session within ±60s (legacy `recalled` is remapped to `applied` on read).
    if (turnHadApplied && !isRecallVerified(turn)) {
      recalledUnverified += 1;
      bumpClient(turn.client, (m) => {
        m.recalled_unverified += 1;
      });
    }

    // -------------------------------------------------------------------
    // v2.0.0-rc.24 TASK-08: per-cite contract walk. Iterates index-aligned
    // (cite_ids[i], cite_commitments[i]). cite_tags is NOT index-aligned
    // with cite_ids (sentinel `KB: none` produces a cite_tags entry but no
    // cite_ids entry — see plan B3 and the cite_commitments parallel-array
    // doc on event-ledger.ts L424). Skipped entirely when the contract
    // marker has not been emitted (contractStatus !== 'ok').
    // -------------------------------------------------------------------
    if (contractStatus === "ok" && turn.ts >= contractEffectiveSince) {
      const commitments = turn.cite_commitments ?? [];
      for (let i = 0; i < turn.cite_ids.length; i += 1) {
        const citeId = turn.cite_ids[i];
        if (typeof citeId !== "string" || citeId.length === 0) continue;
        if (!passesLayerFilter(citeId)) continue;

        const kbType = idTypeMap.get(citeId);
        if (kbType === undefined) {
          // Hallucinated or pre-meta id — dedicated bucket so the user can
          // distinguish "AI made up an id" from "AI cited a real id without
          // an operator".
          citeIdUnresolved += 1;
          bumpLayerType(citeId, "unresolved");
          continue;
        }

        // Cross-tab by (layer, type) for every resolved cite, regardless of
        // bucket — this is the breakdown TASK-09's i18n renderer surfaces.
        bumpLayerType(citeId, kbType);

        // Plural knowledge_type enum (rc.29 BUG-C1 unification). Matching
        // against the canonical plural literals.
        if (kbType === "decisions" || kbType === "pitfalls") {
          if (kbType === "decisions") decisionsCited += 1;
          else pitfallsCited += 1;

          const commitment = commitments[i];
          // Missing commitment slot is equivalent to "lazy default" — no
          // operators, no skip. Counts as contract_missing.
          const operators = commitment?.operators ?? [];
          const skipReason = commitment?.skip_reason ?? null;

          if (skipReason !== null) {
            skipCount[skipReason] = (skipCount[skipReason] ?? 0) + 1;
            // skip:<reason> exits the contract_with/contract_missing
            // partition — operator is explicitly waived.
            continue;
          }

          if (operators.length === 0) {
            contractMissing += 1;
            continue;
          }

          contractWith += 1;
          if (evaluateOperatorViolation(sid, operators)) {
            hardViolated += 1;
          }
        }
        // model → reference-only (no contract check), already cross-tabbed.
        // guideline / process → deferred to rc.25 LLM-judge (no contract
        // check), already cross-tabbed.
      }
    }
  }

  // expected_but_missed: walk edit events, for each one find narrow kbs whose
  // relevance_paths cover the edit's path; if no assistant_turn in the same
  // session cited that kb, increment. Edits without a session_id cannot be
  // correlated and are skipped (conservative — better to under-count than to
  // raise false positives).
  let editsTouched = 0;
  let expectedButMissed = 0;
  // v2.0.0-rc.38 UX-8 (C, hardening): edits with no session_id can never be
  // correlated against assistant_turn cite lines, so they silently never reach
  // expected_but_missed. Surfacing the count turns the previous SILENT
  // undercount (a stale pre-session_id hook emits edits without session_id)
  // into a visible signal — exactly the confound that pinned compliance at a
  // misleading 100% for two prior closure attempts.
  let uncorrelatableEdits = 0;
  for (const edit of editEvents) {
    // Edit events have no `client` field; per-client edits_touched stays at 0
    // (per_client only tabulates assistant-side metrics — see comment block).
    // When a client filter is active, skip edits whose session never produced
    // a matching-client turn — otherwise cross-client edits pollute both the
    // edits_touched denominator and expected_but_missed (the session's
    // cited-kb map is empty under the filter, so every narrow match would
    // false-positive). Edits whose session_id is missing fall through to the
    // legacy conservative count when the filter is 'all', and are likewise
    // skipped under a narrowed filter (no way to attribute them).
    const sid = edit.session_id;
    const hasSid = typeof sid === "string" && sid.length > 0;
    // No session_id → uncorrelatable under ANY client filter. Count once.
    if (!hasSid) uncorrelatableEdits += 1;
    if (clientSessionIds !== null) {
      if (!hasSid) continue;
      if (!clientSessionIds.has(sid)) continue;
    }
    editsTouched += 1;
    if (!hasSid) continue;
    const citedSet = sessionCitedKbs.get(sid) ?? new Set<string>();
    for (const [kbId, kb] of kbIndex) {
      if (kb.relevance_scope !== "narrow") continue;
      if (!matchesRelevancePath(edit.path, kb.relevance_paths)) continue;
      if (!citedSet.has(kbId)) {
        expectedButMissed += 1;
      }
    }
  }

  // v2.0.0-rc.38 UX-8 (C): cite-policy COMPLIANCE rate. Compliant = every valid
  // cite line: qualifying id-cites + ALL `KB: none [reason]` sentinels (the
  // policy permits the none sentinel as compliant). Non-compliant = turns where
  // a cite was expected but none was written (expected_but_missed). null when no
  // cite-expected turns exist (no compliant + no missed) → avoids 0/0 reading as
  // "0% compliant" when the AI simply had nothing to cite.
  const noneTotal = Object.values(noneHistogram).reduce((a, b) => a + b, 0);
  const compliantCites = qualifyingCites + noneTotal;
  const noncompliantCites = expectedButMissed;
  const complianceDenom = compliantCites + noncompliantCites;
  const citeComplianceRate = complianceDenom > 0 ? compliantCites / complianceDenom : null;

  const metrics: CiteCoverageReport["metrics"] = {
    edits_touched: editsTouched,
    qualifying_cites: qualifyingCites,
    recalled_unverified: recalledUnverified,
    expected_but_missed: expectedButMissed,
    total_turns: totalTurns,
    cite_compliance_rate: citeComplianceRate,
    compliant_cites: compliantCites,
    noncompliant_cites: noncompliantCites,
    uncorrelatable_edits: uncorrelatableEdits,
  };

  // rc.39: merge cite-audit rollup days into the totals. Rolled-up turns were
  // physically dropped from the raw ledger, so rollup rows and the raw metrics
  // above are temporally DISJOINT — summing is exact, no double-count. Gated on
  // `options.until === undefined` so the per-day rollup-computation calls (which
  // always set `until`) never recursively merge prior rollup rows into
  // themselves. With the default 7d window no rollup row qualifies (cutoff ≥ 7d),
  // so the common-case report stays byte-for-byte identical.
  let rollupDaysMerged = 0;
  let rollupTrend: CiteRollupRow[] | undefined;
  if (options.until === undefined) {
    let rollupRows: CiteRollupRow[] = [];
    try {
      rollupRows = await readCiteRollup(projectRoot);
    } catch {
      rollupRows = [];
    }
    const inWindow = rollupRows.filter((r) => utcDayBounds(r.date).end > effectiveSince);
    if (inWindow.length > 0) {
      rollupTrend = inWindow;
      rollupDaysMerged = inWindow.length;
      for (const r of inWindow) {
        metrics.total_turns += r.metrics.total_turns;
        metrics.qualifying_cites += r.metrics.qualifying_cites;
        metrics.recalled_unverified += r.metrics.recalled_unverified;
        metrics.expected_but_missed += r.metrics.expected_but_missed;
        metrics.edits_touched += r.metrics.edits_touched;
        metrics.compliant_cites = (metrics.compliant_cites ?? 0) + (r.metrics.compliant_cites ?? 0);
        metrics.noncompliant_cites =
          (metrics.noncompliant_cites ?? 0) + (r.metrics.noncompliant_cites ?? 0);
        metrics.uncorrelatable_edits =
          (metrics.uncorrelatable_edits ?? 0) + (r.metrics.uncorrelatable_edits ?? 0);
      }
      const mergedDenom = (metrics.compliant_cites ?? 0) + (metrics.noncompliant_cites ?? 0);
      metrics.cite_compliance_rate = mergedDenom > 0 ? (metrics.compliant_cites ?? 0) / mergedDenom : null;
    }

    // rc.39 emit-fold: add the folded empty-shell turns back into total_turns.
    // Same gate as the rollup merge (only the live report, never the per-day
    // until-bounded rollup-computation calls — those aggregate raw events only,
    // and the live reader adds the folded counters once). Empty shells carry
    // zero cite signal, so they touch ONLY total_turns: compliance
    // (compliant/(compliant+noncompliant)) and every other metric are unchanged.
    // per_client is intentionally left raw-event-only here, mirroring the rollup
    // merge above which also updates top-level metrics only.
    try {
      const metricsRows = await readMetrics(projectRoot);
      const foldedTurns = sumFoldedTurnCounters(metricsRows, {
        since: effectiveSince,
        client: options.client,
      });
      metrics.total_turns += foldedTurns;
    } catch {
      // metrics.jsonl is best-effort observability — a read failure degrades to
      // "no folded turns" rather than throwing (consistent with readCiteRollup).
    }
  }

  // per_client breakdown is only emitted when client filter is 'all' — for a
  // narrowed query the top-level metrics already represent that client and a
  // single-entry record would be redundant noise.
  let perClient: CiteCoverageReport["per_client"];
  if (options.client === "all" && perClientAccum.size > 0) {
    perClient = {};
    for (const [client, m] of perClientAccum) {
      perClient[client] = m;
    }
  }

  const contractMetrics: CiteContractMetrics = {
    decisions_cited: decisionsCited,
    pitfalls_cited: pitfallsCited,
    contract_with: contractWith,
    contract_missing: contractMissing,
    hard_violated: hardViolated,
    cite_id_unresolved: citeIdUnresolved,
    skip_count: skipCount,
  };

  return {
    status: "ok",
    marker_ts: marker.marker_ts,
    marker_emitted_now: marker.emitted_now,
    since_ts: effectiveSince,
    client_filter: options.client,
    layer_filter: layerFilter,
    metrics,
    ...(perClient !== undefined ? { per_client: perClient } : {}),
    ...(Object.keys(dismissedHistogram).length > 0 ? { dismissed_reason_histogram: dismissedHistogram } : {}),
    ...(Object.keys(noneHistogram).length > 0 ? { none_reason_histogram: noneHistogram } : {}),
    contract_metrics_status: contractStatus,
    contract_metrics: contractMetrics,
    per_layer_type: layerTypeAccum,
    contract_marker_ts: contractMarker.marker_ts,
    generated_at: generatedAt,
    ...(rollupDaysMerged > 0 ? { rollup_days_merged: rollupDaysMerged, rollup_trend: rollupTrend } : {}),
  };
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.39: cite-audit rollup
// ---------------------------------------------------------------------------
//
// assistant_turn_observed dominates events.jsonl (~96% in heavy dogfood). Each
// turn carries a cite audit payload that cite-coverage reads, but once a turn is
// older than the cite window it is dead weight in the main ledger. This pass
// rolls every such turn's day into ONE cite-rollup.jsonl row (computed by
// replaying runDoctorCiteCoverage over a single-UTC-day window — same metric
// logic as the live report, no drift) then DROPS the rolled-up turns from the
// main ledger (archived to events.archive/, never deleted). Net effect: the
// main ledger stays bounded near the cite window while the long-range compliance
// trend survives as compact daily rows.
//
// Only assistant_turn_observed is rolled/dropped — every other (low-volume)
// event stays in the ledger untouched. The per-day metrics are computed BEFORE
// the drop, while turns + edit_intent_checked + knowledge_sections_fetched are
// all still present, so correlation-based metrics (expected_but_missed etc.)
// stay correct (modulo sessions that straddle a UTC midnight — an accepted
// observability approximation, not exact accounting).
export type CiteRollupResult = {
  days_rolled_up: number;
  turns_dropped: number;
  cutoff_ts: number;
};

export async function rollupCiteAuditIfNeeded(
  projectRoot: string,
  opts: { cutoffDays?: number; now?: Date } = {},
): Promise<CiteRollupResult> {
  const now = opts.now ?? new Date();
  // Default cutoff mirrors the cite-coverage default window (7d): turns younger
  // than this stay raw so the live report is unaffected; older ones roll up.
  const cutoffDays = typeof opts.cutoffDays === "number" && opts.cutoffDays >= 0 ? opts.cutoffDays : 7;
  const cutoffMs = now.getTime() - cutoffDays * 86_400_000;

  // Find the distinct UTC days that have at least one rollable turn.
  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { days_rolled_up: 0, turns_dropped: 0, cutoff_ts: cutoffMs };
  }
  const days = new Set<string>();
  let rollableTurns = 0;
  for (const e of events) {
    if (e.event_type === "assistant_turn_observed" && e.ts < cutoffMs) {
      days.add(utcDayKey(e.ts));
      rollableTurns += 1;
    }
  }
  if (rollableTurns === 0) {
    return { days_rolled_up: 0, turns_dropped: 0, cutoff_ts: cutoffMs };
  }

  // One rollup row per day — reuse runDoctorCiteCoverage with a single-day
  // {since, until} window so the stored metrics are byte-identical to what the
  // live report would have produced for that day.
  let daysRolledUp = 0;
  const rolledDays = new Set<string>();
  for (const date of [...days].sort()) {
    const { start, end } = utcDayBounds(date);
    // Boundary day is split at the exact cutoff ms: only turns that will be
    // DROPPED (ts < cutoffMs) belong in the rollup row, so raw + rollup stay
    // disjoint and the Task-4 merge can sum them without double-counting.
    const report = await runDoctorCiteCoverage(projectRoot, {
      since: start,
      until: Math.min(end, cutoffMs),
      client: "all",
    });
    // A day that cannot be rolled up (no cite-policy marker → status 'skipped',
    // or zero coverable turns) is LEFT in the ledger — never silently drop a
    // turn whose cite signal was not captured. Such turns fall to the general
    // 30d rotation instead. This is the no-marker repo's safe path.
    if (report.status !== "ok" || report.metrics.total_turns === 0) continue;
    await appendCiteRollupRow(projectRoot, {
      date,
      generated_at: now.toISOString(),
      metrics: report.metrics,
    });
    rolledDays.add(date);
    daysRolledUp += 1;
  }

  if (rolledDays.size === 0) {
    return { days_rolled_up: 0, turns_dropped: 0, cutoff_ts: cutoffMs };
  }

  // Drop ONLY turns whose day was successfully rolled up (archived, not
  // deleted). Day-aware so un-rolled-up turns (pre-marker / skipped days) stay.
  const dropResult = await dropEventsFromLedger(projectRoot, {
    label: "cite-rolled",
    now,
    predicate: (parsed) =>
      parsed["event_type"] === "assistant_turn_observed" &&
      typeof parsed["ts"] === "number" &&
      (parsed["ts"] as number) < cutoffMs &&
      rolledDays.has(utcDayKey(parsed["ts"] as number)),
  });

  return {
    days_rolled_up: daysRolledUp,
    turns_dropped: dropResult.archivedCount,
    cutoff_ts: cutoffMs,
  };
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.39 (P1 emit-fold, one-time backlog purge):
//
// The rc.39 hook folds NEW empty-shell turns at the source. This function folds
// the EXISTING backlog of empty-shell assistant_turn_observed events already
// sitting in events.jsonl (heavy dogfood repos accrued tens of thousands). It
// runs inside `doctor --fix` AFTER the cite-audit rollup (which sweeps every
// turn ≥7d, cite-bearing or empty), so this targets the live-window (<7d) empty
// shells the rollup intentionally leaves raw.
//
// Fold mechanism mirrors the hook: empties are tallied into metrics.jsonl
// counter rows keyed `assistant_turn_observed[:<client>]`, then dropped from the
// ledger (archived, never deleted). To keep cite-coverage total_turns invariant
// across the purge, each counter row is stamped with the MIN original ts of its
// (UTC-day, client) group: the reader's window filter (`ts >= effectiveSince`)
// then treats the folded group exactly as it treated the raw events, as long as
// the group's day does not straddle a window boundary — which holds because the
// rollup already removed everything ≥7d, leaving only recent days strictly
// inside the live window. The immediate cite-coverage re-check (dogfood
// verification) confirms the number is unchanged.
//
// Empty-shell predicate is identical to the hook's: no KB: line (kb_line_raw
// null/absent) AND no cite_ids AND no cite_commitments — i.e. zero cite signal.
export type EmptyShellPurgeResult = {
  turns_folded: number;
  groups_written: number;
};

function isEmptyShellTurn(parsed: Record<string, unknown>): boolean {
  if (parsed["event_type"] !== "assistant_turn_observed") return false;
  const kb = parsed["kb_line_raw"];
  if (kb !== null && kb !== undefined) return false;
  const citeIds = parsed["cite_ids"];
  if (Array.isArray(citeIds) && citeIds.length > 0) return false;
  const citeCommitments = parsed["cite_commitments"];
  if (Array.isArray(citeCommitments) && citeCommitments.length > 0) return false;
  return true;
}

export async function purgeEmptyShellTurnsIfNeeded(
  projectRoot: string,
  opts: { now?: Date } = {},
): Promise<EmptyShellPurgeResult> {
  const now = opts.now ?? new Date();

  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { turns_folded: 0, groups_written: 0 };
  }

  // Group empty shells by (UTC-day, client). Value tracks count + min ts so the
  // folded counter row lands inside the original turns' window.
  const groups = new Map<string, { client: string | undefined; count: number; minTs: number }>();
  for (const e of events) {
    const parsed = e as unknown as Record<string, unknown>;
    if (!isEmptyShellTurn(parsed)) continue;
    const ts = typeof parsed["ts"] === "number" ? (parsed["ts"] as number) : now.getTime();
    const client = typeof parsed["client"] === "string" ? (parsed["client"] as string) : undefined;
    const key = `${utcDayKey(ts)}::${client ?? ""}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { client, count: 1, minTs: ts });
    } else {
      existing.count += 1;
      if (ts < existing.minTs) existing.minTs = ts;
    }
  }

  if (groups.size === 0) {
    return { turns_folded: 0, groups_written: 0 };
  }

  // Write the folded counter rows BEFORE dropping (mirrors the rollup's
  // sidecar-then-drop order). Each row carries one (day, client) group.
  const metricsPath = getMetricsLedgerPath(projectRoot);
  await ensureParentDirectory(metricsPath);
  let turnsFolded = 0;
  let groupsWritten = 0;
  for (const { client, count, minTs } of groups.values()) {
    const counterKey =
      client !== undefined ? `${ASSISTANT_TURN_COUNTER_PREFIX}:${client}` : ASSISTANT_TURN_COUNTER_PREFIX;
    const row: MetricsRow = {
      timestamp: new Date(minTs).toISOString(),
      window: "purge-fold",
      counters: { [counterKey]: count },
    };
    await appendFile(metricsPath, `${JSON.stringify(row)}\n`);
    turnsFolded += count;
    groupsWritten += 1;
  }

  // Drop the folded empty shells (archived to events.archive/, never deleted).
  await dropEventsFromLedger(projectRoot, {
    label: "empty-shell-fold",
    now,
    predicate: (parsed) => isEmptyShellTurn(parsed),
  });

  return { turns_folded: turnsFolded, groups_written: groupsWritten };
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.25 TASK-10: `fabric doctor --archive-history`
// ---------------------------------------------------------------------------
//
// Read-only audit surface that renders one row per session showing the MOST
// RECENT `session_archive_attempted` event observed within the `--since`
// window. Mirrors the rc.20 `runDoctorCiteCoverage` precedent (parallel
// subcommand wired through the same CLI dispatch) but with a much smaller
// algorithm — a single readEventLedger pass + group-by-session reduction.
//
// Source-of-truth: events.jsonl rows whose `event_type` is
// `session_archive_attempted` (schema landed in rc.25 TASK-01). Each row
// carries `session_id`, `outcome`, `covered_through_ts`, `candidates_proposed`,
// and the event envelope `ts`. We project a stable, render-friendly shape so
// the CLI renderer (and any future JSON consumers) never has to walk the
// raw event union.
//
// Performance: O(N events in window). For typical pcf-grade corpora
// (<10k events) this stays under 50ms — well within the doctor budget.

export type ArchiveHistoryEntry = {
  // First 8 chars of the session_id, suffix `...` if truncated. The full
  // session_id is intentionally omitted from the projection — operators who
  // need it run `jq` against events.jsonl directly. Mirrors the truncation
  // convention used by the archive Skill's onboarding output.
  session_id_short: string;
  // ISO-8601 timestamp of the most recent attempt for this session. Derived
  // from the event envelope `ts` (epoch-ms) so all downstream sorting is
  // numeric-stable across timezones.
  last_attempted_at: string;
  // The terminal outcome of the most recent attempt. Closed enum mirrored
  // from the schema literal.
  outcome: "proposed" | "viability_failed" | "user_dismissed" | "skipped_no_signal";
  // Count of pending knowledge entries written on that attempt. Zero for
  // non-`proposed` outcomes.
  candidates_proposed: number;
  // The latest event `ts` value the attempt scanned. Carries epoch-ms to
  // match the schema; downstream renderers convert to ISO.
  covered_through_ts: number;
  // Time elapsed (in hours, rounded down) between `covered_through_ts` and
  // `Date.now()` at the moment the report is generated. The "gap" surface
  // operators eyeball to spot sessions where archive coverage has stalled.
  age_since_covered_hours: number;
};

export type ArchiveHistoryReport = {
  entries: ArchiveHistoryEntry[];
  // Distinct session count (== entries.length). Surfaced explicitly so JSON
  // consumers don't have to count.
  total: number;
  // Epoch-ms floor of the `--since` window the caller passed in. Echoed back
  // so the renderer can interpolate it into the header line.
  since_ms: number;
  // ISO-8601 timestamp captured at the moment the report was assembled.
  // Provides a stable anchor for `age_since_covered_hours` so successive runs
  // are comparable even when wall-clock skews.
  generated_at: string;
};

export async function runDoctorArchiveHistory(
  projectRoot: string,
  options: { since: number },
): Promise<ArchiveHistoryReport> {
  const generatedAt = new Date().toISOString();
  const nowMs = Date.now();

  // Single ledger pass scoped to the requested window + event_type filter.
  // Both filters are pushed into readEventLedger so we never deserialize
  // events outside the report's surface area.
  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot, {
      event_type: "session_archive_attempted",
      since: options.since,
    });
    events = result.events;
  } catch {
    // Degraded ledger — surface empty report rather than throw. Matches the
    // best-effort policy used by runDoctorCiteCoverage and downstream
    // observability emitters.
    return {
      entries: [],
      total: 0,
      since_ms: options.since,
      generated_at: generatedAt,
    };
  }

  // Group by session_id, keep the row with the MAX `ts` per session. Events
  // lacking session_id (envelope field is optional) are skipped — without a
  // session anchor there is no meaningful "last attempt for session X" to
  // render.
  type AttemptEvent = Extract<EventLedgerEvent, { event_type: "session_archive_attempted" }>;
  const mostRecentBySession = new Map<string, AttemptEvent>();
  for (const event of events) {
    if (event.event_type !== "session_archive_attempted") {
      // Defensive — the readEventLedger filter already gates this, but the
      // discriminated-union narrow below requires the runtime check.
      continue;
    }
    const sessionId = event.session_id;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      continue;
    }
    const prior = mostRecentBySession.get(sessionId);
    if (prior === undefined || event.ts > prior.ts) {
      mostRecentBySession.set(sessionId, event);
    }
  }

  // Project + sort. Descending by `last_attempted_at` (epoch-ms order is
  // identical to ISO order for `new Date(...).toISOString()`).
  const entries: ArchiveHistoryEntry[] = [];
  for (const [sessionId, event] of mostRecentBySession.entries()) {
    const ageHours = Math.max(
      0,
      Math.floor((nowMs - event.covered_through_ts) / 3_600_000),
    );
    entries.push({
      session_id_short: truncateSessionId(sessionId),
      last_attempted_at: new Date(event.ts).toISOString(),
      outcome: event.outcome,
      candidates_proposed: event.candidates_proposed,
      covered_through_ts: event.covered_through_ts,
      age_since_covered_hours: ageHours,
    });
  }
  entries.sort((a, b) =>
    a.last_attempted_at < b.last_attempted_at
      ? 1
      : a.last_attempted_at > b.last_attempted_at
        ? -1
        : 0,
  );

  return {
    entries,
    total: entries.length,
    since_ms: options.since,
    generated_at: generatedAt,
  };
}

// rc.37 NEW-33: unified history view. Aggregates doctor_run + archive
// attempt events into a per-day rollup over the --since window. Lightweight
// projection — daily counts only; for per-session detail operators continue
// to use the original --archive-history surface.
export type HistoryDayRow = {
  date: string; // YYYY-MM-DD (UTC)
  doctor_runs_lint: number;
  doctor_runs_fix: number;
  doctor_total_issues: number;
  doctor_total_mutations: number;
  archive_attempts: number;
  archive_proposed: number;
};

export type HistoryAllReport = {
  rows: HistoryDayRow[];
  since_ms: number;
  generated_at: string;
};

export async function runDoctorHistoryAll(
  projectRoot: string,
  options: { since: number },
): Promise<HistoryAllReport> {
  const generatedAt = new Date().toISOString();
  const buckets = new Map<string, HistoryDayRow>();
  const getBucket = (ts: number): HistoryDayRow => {
    const date = new Date(ts).toISOString().slice(0, 10);
    let row = buckets.get(date);
    if (row === undefined) {
      row = {
        date,
        doctor_runs_lint: 0,
        doctor_runs_fix: 0,
        doctor_total_issues: 0,
        doctor_total_mutations: 0,
        archive_attempts: 0,
        archive_proposed: 0,
      };
      buckets.set(date, row);
    }
    return row;
  };

  // doctor_run events
  try {
    const { events } = await readEventLedger(projectRoot, {
      event_type: "doctor_run",
      since: options.since,
    });
    for (const event of events) {
      if (event.event_type !== "doctor_run") continue;
      const row = getBucket(event.ts);
      if (event.mode === "lint") {
        row.doctor_runs_lint += 1;
      } else {
        row.doctor_runs_fix += 1;
      }
      row.doctor_total_issues += event.issues;
      row.doctor_total_mutations += event.mutations ?? 0;
    }
  } catch {
    // Degraded ledger — proceed with archive arm only.
  }

  // session_archive_attempted events
  try {
    const { events } = await readEventLedger(projectRoot, {
      event_type: "session_archive_attempted",
      since: options.since,
    });
    for (const event of events) {
      if (event.event_type !== "session_archive_attempted") continue;
      const row = getBucket(event.ts);
      row.archive_attempts += 1;
      if (event.outcome === "proposed") {
        row.archive_proposed += event.candidates_proposed;
      }
    }
  } catch {
    // Degraded — empty archive arm.
  }

  const rows = Array.from(buckets.values()).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  return { rows, since_ms: options.since, generated_at: generatedAt };
}

// session_id truncation helper. The schema does not constrain session_id
// length (CLI clients pick arbitrary opaque strings — UUIDs, short prefixes,
// "sess-<n>" patterns) so the rule is: keep the first 8 chars and append
// `...` when truncation actually shortened the string. Short ids (<= 8 chars)
// render verbatim without a suffix.
function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 8) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}...`;
}

function createFixMessage(fixed: DoctorIssue[], report: DoctorReport): string {
  const fixedText = fixed.length === 0
    ? "No deterministic doctor fixes were needed."
    : `Applied ${fixed.length} deterministic doctor fix${fixed.length === 1 ? "" : "es"}.`;
  const manualText = report.manual_errors.length === 0
    ? "No manual errors remain."
    : `${report.manual_errors.length} manual error${report.manual_errors.length === 1 ? "" : "s"} remain.`;

  return `${fixedText} ${manualText}`;
}

function isValidJsonLine(line: string): boolean {
  try {
    JSON.parse(line) as unknown;
    return true;
  } catch {
    return false;
  }
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function normalizePath(path: string): string {
  return posix.normalize(path.split("\\").join("/"));
}

function collectEntryPoints(root: string): EntryPoint[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }

  const entries: EntryPoint[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = normalizePath(absolutePath.slice(root.length + 1));

      if (relativePath.length === 0) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          stack.push(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const reason = getEntryPointReason(relativePath);
      if (reason !== null) {
        entries.push({ path: relativePath, reason });
      }
    }
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function getEntryPointReason(relativePath: string): string | null {
  const extension = relativePath.slice(relativePath.lastIndexOf("."));
  if (!SCRIPT_EXTENSIONS.has(extension)) {
    return null;
  }

  const directory = posix.dirname(relativePath);
  const fileName = posix.basename(relativePath);
  const fileBase = fileName.slice(0, Math.max(fileName.lastIndexOf("."), 0));

  if (directory === "assets/scripts" || directory === "scripts") {
    return "top-level script";
  }

  if (directory === "src" && /^(App|app|index|main)$/.test(fileBase)) {
    return "application entry";
  }

  if ((directory === "app" || directory.startsWith("app/")) && /^(layout|page|route)$/.test(fileBase)) {
    return "next app route";
  }

  if ((directory === "pages" || directory.startsWith("pages/")) && fileName !== "_app.d.ts") {
    return "next page route";
  }

  return null;
}

function reduceStatus(statuses: DoctorStatus[]): DoctorStatus {
  if (statuses.includes("error")) {
    return "error";
  }
  if (statuses.includes("warn")) {
    return "warn";
  }
  return "ok";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.23 TASK-007 (a-C2): `fabric doctor --enrich-descriptions`
// ---------------------------------------------------------------------------
//
// TASK-006 (a-C1) added four optional description-grade frontmatter fields
// (`intent_clues`, `tech_stack`, `impact`, `must_read_if`) to the
// extract-knowledge schema + writer. Entries archived BEFORE rc.23 — and
// rc.23 entries that the Skill chose to omit them on — won't carry the
// fields, leaving the planContext description budget thinner than it could
// be. `enrichDescriptions` walks the canonical knowledge tree (both team and
// personal roots) and either back-fills deterministic stub values
// (`--auto`) or surfaces a missing-field summary for the operator to feed
// back into the archive Skill / manual editor.
//
// Scope:
//   * `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes}/*.md`
//     across both roots (`.fabric/knowledge/` + `<personal>/.fabric/knowledge/`)
//   * `pending/` and `archive/` subtrees are deliberately skipped — pending
//     entries are still in flight (the Skill owns their schema) and archived
//     entries are immutable history.
//
// Atomicity: the on-disk rewrite goes through `atomicWriteText` so a crash
// mid-write never leaves a half-state. Idempotent: a file already carrying
// all four fields produces no diff and no event.

// v2.0.0-rc.29 TASK-007 (BUG-M1): expand the mode label so the report
// honestly distinguishes the three observable behaviors of
// `fabric doctor --enrich-descriptions`:
//   - readonly: no `--auto`, no `--dry-run` → scan + report, write nothing.
//   - preview : `--auto --dry-run` → simulate writes, show diff, write nothing.
//   - auto    : `--auto` (no `--dry-run`) → actually mutate frontmatter on disk.
// Previously this was `auto | interactive`; the audit (rc.28 round 1) flagged
// `mode: "interactive", dryRun: false` as misleading when 0 files were written.
// "interactive" is retained as a deprecated alias mapping to "readonly" so
// existing API consumers keep parsing — the label printed by the renderer is
// the canonical one chosen by the new logic below.
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

const ENRICH_DESC_FIELDS = ["intent_clues", "tech_stack", "impact", "must_read_if"] as const;
type EnrichDescField = (typeof ENRICH_DESC_FIELDS)[number];

// Per-field line detectors. Matches the same shape extract-knowledge.ts emits:
// flow-form arrays (`intent_clues: [...]` / `intent_clues: []`) and a single
// quoted/unquoted scalar for must_read_if. Anchored on the field name + colon
// so a substring (e.g. inside a body code block) cannot trick the regex.
const ENRICH_DESC_FIELD_PATTERNS: Record<EnrichDescField, RegExp> = {
  intent_clues: /^intent_clues\s*:/mu,
  tech_stack: /^tech_stack\s*:/mu,
  impact: /^impact\s*:/mu,
  must_read_if: /^must_read_if\s*:/mu,
};

export async function enrichDescriptions(
  projectRoot: string,
  opts: { auto?: boolean; dryRun?: boolean } = {},
): Promise<EnrichDescriptionsReport> {
  const auto = opts.auto === true;
  const dryRun = opts.dryRun === true;
  // v2.0.0-rc.29 TASK-007 (BUG-M1): tri-mode label. `--auto && --dry-run` is
  // preview; bare `--auto` is the only true mutating mode; everything else is
  // readonly. The legacy "interactive" label is kept in the type union as a
  // deprecated alias so external schema consumers continue to parse.
  const mode: EnrichDescriptionsMode = auto ? (dryRun ? "preview" : "auto") : "readonly";

  const candidates: EnrichDescriptionsCandidate[] = [];
  let scanned = 0;
  let modified = 0;
  let skipped = 0;

  for (const visit of iterateCanonicalFilenames(projectRoot)) {
    const layerRoot =
      visit.layer === "team"
        ? join(projectRoot, ".fabric", "knowledge")
        : resolvePersonalKnowledgeRoot();
    const absPath = join(layerRoot, visit.type, visit.filename);
    scanned += 1;

    let source: string;
    try {
      source = await readFile(absPath, "utf8");
    } catch {
      // Disappeared between readdir and read — skip silently (next doctor
      // run picks up the live state).
      continue;
    }

    const fmMatch = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u.exec(source);
    if (fmMatch === null) {
      // Body-only files: surface as a candidate with a parse-error marker so
      // the operator sees they exist, but skip the rewrite arm — we don't
      // synthesize a frontmatter block from nothing (the Skill owns initial
      // archive shape).
      candidates.push({
        path: visit.displayPath,
        missing: [...ENRICH_DESC_FIELDS],
        modified: false,
        added_fields: [],
        error: "frontmatter not parseable",
      });
      continue;
    }
    const block = fmMatch[1];

    const missing = ENRICH_DESC_FIELDS.filter(
      (field) => !ENRICH_DESC_FIELD_PATTERNS[field].test(block),
    );

    if (missing.length === 0) {
      skipped += 1;
      continue;
    }

    if (!auto || dryRun) {
      // Interactive or dryRun: report but don't rewrite. Operator drives the
      // resolution (rerun the archive Skill, or manually edit + commit).
      candidates.push({
        path: visit.displayPath,
        missing,
        modified: false,
        added_fields: [],
      });
      continue;
    }

    // Auto mode (with write): synthesize stubs. Empty arrays for the three
    // list-valued fields are the deliberate "I have nothing to add" signal —
    // they make the entry schema-valid for planContext's
    // description-budget builder without claiming knowledge we don't have.
    // For must_read_if we derive a one-line summary from the body's first
    // H1 (or the slug-derived filename token) so the field carries SOMETHING
    // operator-meaningful by default. The stub strings stay short so the
    // YAML scalar fits on one line without folding.
    const mustReadIf = synthesizeMustReadIfStub(source, visit.filename);
    const additions: Array<{ field: EnrichDescField; line: string }> = [];
    for (const field of missing) {
      if (field === "must_read_if") {
        additions.push({ field, line: `must_read_if: ${yamlQuoteIfNeeded(mustReadIf)}` });
      } else {
        additions.push({ field, line: `${field}: []` });
      }
    }
    const trailing = block.endsWith("\n") ? "" : "\n";
    const replacedBlock = `${block}${trailing}${additions.map((a) => a.line).join("\n")}`;
    const blockStart = source.indexOf(block);
    if (blockStart < 0) {
      // Defensive: should never happen since fmMatch came from source.
      candidates.push({
        path: visit.displayPath,
        missing,
        modified: false,
        added_fields: [],
        error: "frontmatter block not located after match",
      });
      continue;
    }
    const rewritten =
      source.slice(0, blockStart) + replacedBlock + source.slice(blockStart + block.length);

    await atomicWriteText(absPath, rewritten);
    modified += 1;
    candidates.push({
      path: visit.displayPath,
      missing,
      modified: true,
      added_fields: additions.map((a) => a.field),
    });

    // Best-effort audit trail. A ledger write failure must NOT propagate —
    // the file is already on disk and re-running the command would be a
    // no-op (idempotency), so dropping the event is preferable to rolling
    // back a successful write.
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_enriched",
      path: visit.displayPath,
      added_fields: additions.map((a) => a.field),
      mode,
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  // Stable display order — alphabetical by path so callers (CLI render, test
  // assertions) don't depend on readdir() ordering quirks.
  candidates.sort((a, b) => a.path.localeCompare(b.path));

  return { mode, dryRun, scanned, modified, skipped, candidates };
}

// Derive a default `must_read_if` line from the entry's body. Preference:
// the first H1 heading (`# Title`), falling back to a humanized form of the
// canonical filename slug. The result is trimmed and clamped to 120 chars to
// match the field's documented per-item budget (see api-contracts.ts).
function synthesizeMustReadIfStub(source: string, filename: string): string {
  const h1Match = /^#\s+(.+?)\s*$/mu.exec(source);
  let raw = h1Match !== null ? h1Match[1] : filename.replace(/^K[PT]-[A-Z]+-\d+--/, "").replace(/\.md$/u, "").replace(/-/g, " ");
  raw = raw.trim();
  if (raw.length === 0) {
    raw = "describes a knowledge invariant for this project";
  }
  if (raw.length > 120) {
    raw = `${raw.slice(0, 117)}...`;
  }
  return raw;
}

// YAML flow scalar quoting. Mirrors the extract-knowledge `quoteRelevancePath`
// rule: if the string contains characters that would confuse the line-based
// parser (colon, `#`, leading `-`, leading `?`, brackets, quotes), wrap in
// double quotes and escape embedded quotes/backslashes. Otherwise emit bare.
function yamlQuoteIfNeeded(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (/[:#"'\\[\]{},&*!|>%@`]/.test(value) || /^[\s-?]/.test(value) || /\s$/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

export { getEventLedgerPath };

// ---------------------------------------------------------------------------
// v2.0.0-rc.30 TASK-003 (H2 deferred-from-rc.29): Emit-cadence sub-check.
//
// rc.29 BUG-H2 audit reported `qualifying_cites=0` on 16K-turn workspace
// while cite-coverage `runDoctorCiteCoverage` reads `assistant_turn_observed`
// from events.jsonl. Audit hypothesised cite-line-parser type-enum split as
// root cause; VERIFICATION.md refuted that (parser shape already events-
// based) and noted the symptom might still be real via a different code
// path — specifically the assistant_turn_observed emit cadence (Stop hook
// not firing on every turn).
//
// This standalone check pairs `knowledge_sections_fetched` (every time a
// client pulled rule bodies via fab_get_knowledge_sections) with
// `assistant_turn_observed` (Stop hook emit per assistant turn). Each fetch
// implies at least one downstream assistant turn — if fetched >> observed,
// the hook is silently failing somewhere. Standalone (not wired into the
// runDoctorReport pipeline yet) so v2.1 design doc can finalise integration
// shape (CLI flag? JSON envelope? human render?); the function + tests pin
// the contract and the threshold.
// ---------------------------------------------------------------------------

export type EmitCadenceReport = {
  fetched: number;
  observed: number;
  ratio: number; // observed / fetched; 1.0 when fetched=0 (vacuously OK)
  status: "ok" | "warn";
  message: string;
};

const EMIT_CADENCE_WARN_THRESHOLD = 0.8;

export async function runDoctorEmitCadenceCheck(projectRoot: string): Promise<EmitCadenceReport> {
  const { events } = await readEventLedger(projectRoot);
  let fetched = 0;
  let observed = 0;
  for (const event of events) {
    if (event.event_type === "knowledge_sections_fetched") {
      fetched += 1;
    } else if (event.event_type === "assistant_turn_observed") {
      observed += 1;
    }
  }

  // rc.39 emit-fold + rc.37 Wave B: both signals are counter-managed in part.
  // `knowledge_sections_fetched` moved to metrics.jsonl wholesale (rc.37); the
  // empty-shell half of `assistant_turn_observed` folds into metrics.jsonl
  // counters (rc.39). Without adding these back the ratio would read artificially
  // low once the fold/clean-slate took effect. All-time window (since=0) — the
  // cadence check has no `--since` bound.
  try {
    const metricsRows = await readMetrics(projectRoot);
    observed += sumFoldedTurnCounters(metricsRows, { since: 0, client: "all" });
    for (const row of metricsRows) {
      const v = row.counters[METRIC_COUNTER_NAMES.knowledge_sections_fetched];
      if (typeof v === "number" && Number.isFinite(v)) fetched += v;
    }
  } catch {
    // best-effort — degrade to events-only counts on read failure.
  }
  if (fetched === 0) {
    return {
      fetched: 0,
      observed,
      ratio: 1,
      status: "ok",
      message: "No knowledge_sections_fetched events yet — cadence not applicable.",
    };
  }
  const ratio = observed / fetched;
  if (ratio < EMIT_CADENCE_WARN_THRESHOLD) {
    return {
      fetched,
      observed,
      ratio,
      status: "warn",
      message:
        `assistant_turn_observed/knowledge_sections_fetched ratio ${ratio.toFixed(2)} ` +
        `< ${EMIT_CADENCE_WARN_THRESHOLD} — Stop hook may not be wired on every client. ` +
        `Check .claude/settings.json + .codex/skills/* hooks.Stop entries.`,
    };
  }
  return {
    fetched,
    observed,
    ratio,
    status: "ok",
    message: `assistant_turn_observed cadence healthy (ratio ${ratio.toFixed(2)}).`,
  };
}
