import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, posix, relative as nodeRelative, resolve, sep } from "node:path";

import { minimatch } from "minimatch";

import {
  agentsMetaSchema,
  AgentsMetaCountersSchema,
  forensicReportSchema,
  parseKnowledgeId,
  knowledgeTestIndexSchema,
  LEGACY_KB_REGEX,
  BOOTSTRAP_CANONICAL,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
  type AgentsMeta,
  type AgentsMetaCounters,
  type EventLedgerEvent,
  type ForensicReport,
  type KnowledgeTestIndex,
} from "@fenglimg/fabric-shared";
import { detectFramework } from "@fenglimg/fabric-shared/node";

import { contextCache } from "../cache.js";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { ensureParentDirectory, getEventLedgerPath, sha256 } from "./_shared.js";
import { buildKnowledgeMeta, isSameKnowledgeTestIndex, writeKnowledgeMeta } from "./knowledge-meta-builder.js";
import {
  appendEventLedgerEvent,
  readEventLedger,
  rotateEventLedgerIfNeeded,
  truncateLedgerToLastNewline,
} from "./event-ledger.js";
import { reconcileKnowledge } from "./knowledge-sync.js";
import { readAgentsMeta } from "../meta-reader.js";

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
};

export type DoctorIssue = {
  code: string;
  name: string;
  message: string;
  path?: string;
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
  path: string;
  error?: string;
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
// Mirrors `KNOWN_BASELINE_IDS` in packages/cli/src/commands/scan.ts (T5).
// Kept in sync by convention; T15 dogfood may refactor the duplication out
// to a shared constant. Any stable_id NOT in this allowlist is treated as a
// user-promoted entry (e.g. KP-DEC-0001) and intentionally left untouched —
// only deterministic baselines emitted by `fab scan` are subject to the
// `${id}--${slug}.md` filename invariant this lint enforces.
const BASELINE_FILENAME_LINT_BASELINE_IDS = new Set<string>([
  "KT-MOD-0001", // tech-stack
  "KT-MOD-0002", // module-structure
  "KT-MOD-0003", // readme-first-paragraph
  "KT-PRO-0001", // build-config
  "KT-PRO-0002", // ci-config
  "KT-GLD-0001", // code-style
]);

// Filename pattern for the canonical id-prefixed form. Mirrors
// `ID_PREFIXED_FILENAME_PATTERN` in scan.ts (T5). Files matching this pattern
// are already migrated and not flagged by this lint.
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
  const framework = detectFramework(projectRoot);
  const entryPoints = collectEntryPoints(projectRoot);
  const [
    forensic,
    meta,
    eventLedger,
    knowledgeTestIndex,
    bootstrapMarkerMigration,
    l1BootstrapSnapshotDrift,
    l2ManagedBlockDrift,
  ] = await Promise.all([
    inspectForensic(projectRoot),
    inspectMeta(projectRoot),
    inspectEventLedger(projectRoot),
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
  const metaManuallyDiverged = await inspectMetaManuallyDiverged(projectRoot);
  const knowledgeDirUnindexed = inspectKnowledgeDirUnindexed(projectRoot, meta);
  const knowledgeDirMissing = inspectKnowledgeDirMissing(projectRoot);
  // v2.0.0-rc.22 TASK-006: baseline filename format hard error. Detects
  // bare-slug baseline files (pre-rc.22 layout) and instructs the user to
  // run `fab scan` for one-shot migration. manual_error kind (no --fix path;
  // delegated fixer is `fab scan`).
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
  // rc.6 TASK-023 (E6): narrow_too_few (#26). Two-arm check — structural
  // ratio + telemetry silence rate. Info-kind; safe-degrades to "skipped"
  // telemetry when the edit-counter has no fires in the 30d window.
  const narrowTooFew = inspectNarrowTooFew(projectRoot, lintNow);
  // rc.6 TASK-021 (E3): session-hints cache hygiene (#27). Scans
  // `.fabric/.cache/` for session-hints-*.json files older than 7 days
  // (mtime-based). Info kind — does not bump report status. apply-lint
  // reaps matched files via unlink (no ledger event; local hot-cache).
  const sessionHintsStale = inspectSessionHintsStale(projectRoot, lintNow);
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
  const checks: DoctorCheck[] = [
    createBootstrapAnchorCheck(bootstrapAnchor),
    // v2.0.0-rc.19 TASK-004: bootstrap marker migration check sits adjacent to
    // the anchor check — both are bootstrap-file invariants. fixable_error
    // when any of the four target paths still carries the legacy marker.
    createBootstrapMarkerMigrationCheck(bootstrapMarkerMigration),
    // v2.0.0-rc.19 TASK-005: L1 + L2 byte-level drift detection sit immediately
    // after the marker migration check. Order: anchor existence → migration →
    // L1 (canonical ↔ snapshot) → L2 (snapshot+rules ↔ three-end blocks).
    createL1BootstrapSnapshotDriftCheck(l1BootstrapSnapshotDrift),
    createL2ManagedBlockDriftCheck(l2ManagedBlockDrift),
    createKnowledgeDirMissingCheck(knowledgeDirMissing),
    // v2.0.0-rc.22 TASK-006: baseline filename format. Sits adjacent to
    // knowledge_dir_missing — both are knowledge-layout invariants. manual_error
    // kind; resolution delegates to `fab scan` (no --fix path).
    createBaselineFilenameFormatCheck(baselineFilenameFormat),
    createForensicCheck(forensic, framework.kind, entryPoints.length),
    // v2.0: removed `createInitContextCheck` — `.fabric/init-context.json`
    // is owned by the AI-side client init skill, not by `fabric install` CLI.
    // The file's absence is a legitimate post-init state when the skill has
    // not yet run, so flagging it as a doctor manual_error misrepresents
    // ownership.
    createMetaCheck(meta),
    createRuleContentRefCheck(meta),
    // v2.0 / rc.2: `createRuleSectionsCheck` removed — it parsed v1.x
    // [MANDATORY_INJECTION] sections out of legacy rule files, a structural
    // concept that has no v2 equivalent. rc.4 will introduce a dedicated v2
    // lint suite for the new knowledge frontmatter contract.
    createKnowledgeTestIndexCheck(knowledgeTestIndex),
    createEventLedgerCheck(eventLedger),
    createEventLedgerPartialWriteCheck(eventLedger),
    createMcpConfigInWrongFileCheck(mcpConfigInWrongFile),
    createMetaManuallyDivergedCheck(metaManuallyDiverged),
    createKnowledgeDirUnindexedCheck(knowledgeDirUnindexed),
    createStableIdCollisionCheck(stableIdCollision),
    createCounterDesyncCheck(counterDesync),
    createFilesystemEditFallbackCheck(filesystemEditFallback),
    // rc.4 TASK-001: read-side lint checks #16-18. Findings only — mutation
    // + event emission lands in TASK-003 behind --apply-lint.
    createOrphanDemoteCheck(orphanDemote),
    createStaleArchiveCheck(staleArchive),
    createPendingOverdueCheck(pendingOverdue),
    // rc.4 TASK-002: read-side integrity checks #19-21. Stable_id duplicate
    // runs first in this trio — it is the most critical integrity break and
    // surfaces ahead of layer-mismatch / index-drift in the report so a
    // human operator triages the collision before reasoning about counter
    // state. Index drift is the only fixable_error of the three; stable_id
    // duplicate and layer mismatch require manual triage (rename / move).
    createStableIdDuplicateCheck(stableIdDuplicate),
    createLayerMismatchCheck(layerMismatch),
    createIndexDriftCheck(indexDrift),
    // rc.5 TASK-010: read-side underseeded-corpus check (#22). Info kind —
    // does not bump report status. Recommends running the fabric-import skill
    // to backfill knowledge when the corpus is below the threshold floor.
    createUnderseededCheck(underseeded),
    // rc.5 TASK-013 (C4): relevance_paths hygiene checks #23/#24/#25.
    // All three are flag-only in rc.5 (no apply-lint mutations).
    //   #23 narrow_no_paths        — warning kind (silent recall risk)
    //   #24 relevance_paths_dangling — warning kind (glob → zero matches)
    //   #25 relevance_paths_drift  — info kind (git-log heuristic; noisy)
    createNarrowNoPathsCheck(narrowNoPaths),
    createRelevancePathsDanglingCheck(relevancePathsDangling),
    createRelevancePathsDriftCheck(relevancePathsDrift),
    // rc.6 TASK-023 (E6): narrow_too_few (lint #26). Info kind; both arms
    // (structural + telemetry) recommend the same fabric-import action.
    createNarrowTooFewCheck(narrowTooFew),
    // rc.6 TASK-021 (E3): session-hints cache hygiene (lint #27). Info kind.
    createSessionHintsStaleCheck(sessionHintsStale),
    // v2.0.0-rc.9 TASK-003 (A3): relevance fields back-fill (lint #28).
    // Info kind — applies to pending entries only; canonical entries get
    // the fields written verbatim by fab_review.approve/modify.
    createRelevanceFieldsMissingCheck(relevanceFieldsMissing),
    // rc.12 lint #29: skill_md_yaml_invalid. Warning kind — surfaces
    // SKILL.md frontmatter that Codex CLI silently drops at load.
    createSkillMdYamlInvalidCheck(skillMdYamlInvalid),
    createPreexistingRootFilesCheck(preexistingRootFiles),
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
    },
  };
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
  // auto-heals on next MCP call), but `fab doctor --fix` must still reconcile
  // it explicitly. We look in both `fixable_errors` and `warnings` so the
  // demotion doesn't break the existing fix-path.
  const reconcileCodes = [
    "agents_meta_missing",
    "agents_meta_stale",
    "knowledge_test_index_missing",
    "knowledge_test_index_stale",
    "content_ref_missing",
    "knowledge_dir_unindexed",
  ];
  if (
    before.fixable_errors.some((issue) => reconcileCodes.includes(issue.code))
    || before.warnings.some((issue) => reconcileCodes.includes(issue.code))
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
// after `fab install` is a legitimate "skill has not run yet" state, not a
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
    return {
      present: true,
      valid: false,
      meta: null,
      revision: null,
      computedRevision: built?.meta.revision ?? null,
      ruleCount: 0,
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
    return { exists: false, writable: false, parseable: false, hasPartialWrite: false, partialWriteByteOffset: 0, partialWriteByteLength: 0, path };
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

    return {
      exists: true,
      writable: true,
      parseable: invalidLine === undefined,
      hasPartialWrite: partialWarning !== undefined,
      partialWriteByteOffset: partialWarning?.byte_offset ?? 0,
      partialWriteByteLength: partialWarning?.byte_length ?? 0,
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
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
  inspection: BootstrapMarkerMigrationInspection,
): DoctorCheck {
  if (inspection.filesNeedingMigration.length === 0) {
    return okCheck(
      "Bootstrap marker migration",
      "No legacy fabric:knowledge-base markers detected in bootstrap target files.",
    );
  }
  const list = inspection.filesNeedingMigration.join(", ");
  return issueCheck(
    "Bootstrap marker migration",
    "error",
    "fixable_error",
    "bootstrap_marker_migration_required",
    `${inspection.filesNeedingMigration.length} file${inspection.filesNeedingMigration.length === 1 ? "" : "s"} still carry the legacy fabric:knowledge-base bootstrap marker: ${list}.`,
    "Run `fab doctor --fix` to migrate to fabric:bootstrap marker",
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
  inspection: L1BootstrapSnapshotDriftInspection,
): DoctorCheck {
  if (inspection.status === "drift") {
    return issueCheck(
      "Bootstrap snapshot drift",
      "error",
      "fixable_error",
      "bootstrap_snapshot_drift",
      ".fabric/AGENTS.md content diverges byte-for-byte from BOOTSTRAP_CANONICAL.",
      "Run `fab doctor --fix` to restore canonical bootstrap snapshot",
    );
  }
  // 'missing' is delegated to bootstrap_anchor_missing — return ok here so we
  // don't double-report.
  return okCheck(
    "Bootstrap snapshot drift",
    inspection.status === "ok"
      ? ".fabric/AGENTS.md byte-equals BOOTSTRAP_CANONICAL."
      : ".fabric/AGENTS.md absent — delegated to bootstrap_anchor_missing.",
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
  inspection: L2ManagedBlockDriftInspection,
): DoctorCheck {
  if (inspection.status === "drift") {
    const list = inspection.drifted.map((d) => d.path).join(", ");
    return issueCheck(
      "Managed block drift",
      "error",
      "fixable_error",
      "managed_block_drift",
      `${inspection.drifted.length} three-end managed block${inspection.drifted.length === 1 ? "" : "s"} diverge from expected body (snapshot + optional project-rules concat): ${list}.`,
      "Run `fab doctor --fix` to restore three-end managed blocks from canonical",
    );
  }
  return okCheck(
    "Managed block drift",
    inspection.status === "ok"
      ? "Three-end managed blocks byte-equal expectedBody."
      : "No three-end managed blocks detected — propagation pending or legacy-marker state.",
  );
}

function createBootstrapAnchorCheck(inspection: BootstrapAnchorInspection): DoctorCheck {
  // v2.0: bootstrap is anchored at the repo root via AGENTS.md or CLAUDE.md.
  // Either one (or both) is sufficient; missing both is a fixable_error in
  // the sense that `fabric install` is the canonical remediation (we do not
  // auto-write the anchor file from doctor --fix).
  if (!inspection.hasAgentsMd && !inspection.hasClaudeMd) {
    return issueCheck(
      "Bootstrap anchor",
      "error",
      "fixable_error",
      "bootstrap_anchor_missing",
      "Neither AGENTS.md nor CLAUDE.md exists at the repo root. Fabric requires a bootstrap anchor file at the project root.",
      "Run `fabric install` to generate the AGENTS.md / CLAUDE.md bootstrap anchor at the repo root.",
    );
  }
  const present = [
    inspection.hasAgentsMd ? "AGENTS.md" : null,
    inspection.hasClaudeMd ? "CLAUDE.md" : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(", ");
  return okCheck("Bootstrap anchor", `Bootstrap anchor present at repo root: ${present}.`);
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
  inspection: BaselineFilenameFormatInspection,
): DoctorCheck {
  if (inspection.offenders.length === 0) {
    return okCheck(
      "Baseline filename format",
      "All baseline knowledge files use the canonical `${id}--${slug}.md` filename format.",
    );
  }
  const first = inspection.offenders[0];
  const detail = `${first.stable_id} at ${first.path}`;
  return issueCheck(
    "Baseline filename format",
    "error",
    "manual_error",
    "lint-baseline-filename-format",
    `${inspection.offenders.length} baseline knowledge file${inspection.offenders.length === 1 ? "" : "s"} use${inspection.offenders.length === 1 ? "s" : ""} the deprecated bare-slug filename format and must be migrated to \`\${id}--\${slug}.md\`. First: ${detail}.`,
    "Run `fab scan` to auto-migrate baseline filenames to the canonical `${id}--${slug}.md` format.",
  );
}

function createKnowledgeDirMissingCheck(inspection: KnowledgeDirMissingInspection): DoctorCheck {
  if (inspection.missingSubdirs.length > 0) {
    const list = inspection.missingSubdirs.join(", ");
    return issueCheck(
      "Knowledge layout",
      "error",
      "fixable_error",
      "knowledge_dir_missing",
      `${inspection.missingSubdirs.length} required knowledge subdir${inspection.missingSubdirs.length === 1 ? " is" : "s are"} missing: ${list}.`,
      "Run `fab doctor --fix` to create the missing .fabric/knowledge/* subdirectories.",
    );
  }
  return okCheck(
    "Knowledge layout",
    `All ${KNOWLEDGE_SUBDIRS.length} required .fabric/knowledge/* subdirectories exist.`,
  );
}

function createForensicCheck(
  forensic: Awaited<ReturnType<typeof inspectForensic>>,
  frameworkKind: string,
  entryPointCount: number,
): DoctorCheck {
  if (!forensic.present) {
    return issueCheck(
      "Scan evidence",
      "error",
      "manual_error",
      "forensic_missing",
      `${forensic.error ?? ".fabric/forensic.json is missing."} Live scan detects ${frameworkKind} with ${entryPointCount} entry point${entryPointCount === 1 ? "" : "s"}.`,
      "Run `fab install` to regenerate .fabric/forensic.json.",
    );
  }
  if (!forensic.valid) {
    return issueCheck("Scan evidence", "error", "manual_error", "forensic_invalid", forensic.error ?? ".fabric/forensic.json is invalid.", "Run `fab install` to regenerate .fabric/forensic.json.");
  }
  return okCheck("Scan evidence", `.fabric/forensic.json is valid for ${forensic.report?.framework.kind ?? "unknown"}.`);
}

// v2.0: `createInitContextCheck` removed alongside `inspectInitContext` —
// see comment at the call site in `runDoctorReport`.

function createMetaCheck(meta: MetaInspection): DoctorCheck {
  if (!meta.present) {
    return issueCheck("Agents metadata", "error", "fixable_error", "agents_meta_missing", ".fabric/agents.meta.json is missing.", "Run `fab doctor --fix` to rebuild agents.meta.json from .fabric/knowledge/.");
  }
  if (!meta.valid) {
    return issueCheck("Agents metadata", "error", "manual_error", "agents_meta_invalid", meta.readError ?? ".fabric/agents.meta.json is invalid.", "Delete .fabric/agents.meta.json and run `fab doctor --fix` to regenerate it.");
  }
  if (meta.stale) {
    // rc.22 TASK-012: demoted error → warning. The engine auto-heals stale meta
    // on the next plan-context / get-sections MCP call (lazy reconcile), so a
    // detected drift is benign by the time a human looks at it. We keep the
    // check visible (operator wants to see drift for transient debugging) but
    // exit code 0 unless --strict is set. The fix path at the warnings guard
    // (see runDoctorFix) still reconciles when --fix is invoked explicitly.
    return issueCheck(
      "Agents metadata",
      "warn",
      "warning",
      "agents_meta_stale",
      `.fabric/agents.meta.json revision ${meta.revision} does not match .fabric/knowledge derived revision ${meta.computedRevision ?? "<unknown>"}.`,
      "Benign — engine auto-heals on next plan-context/get-sections call. Run `fab doctor --fix` for explicit reconciliation.",
    );
  }
  return okCheck("Agents metadata", `.fabric/agents.meta.json revision ${meta.revision} is aligned with .fabric/knowledge.`);
}

function createRuleContentRefCheck(meta: MetaInspection): DoctorCheck {
  if (!meta.valid) {
    return issueCheck("Rule content refs", "error", "manual_error", "content_refs_unavailable", "Cannot inspect content_ref entries until agents.meta.json is valid.", "Fix agents.meta.json first: run `fab doctor --fix`.");
  }

  if (meta.invalidContentRefs.length > 0) {
    return issueCheck(
      "Rule content refs",
      "error",
      "manual_error",
      "content_ref_outside_rules",
      `${meta.invalidContentRefs.length} content_ref entr${meta.invalidContentRefs.length === 1 ? "y is" : "ies are"} outside .fabric/knowledge.`,
      "Edit agents.meta.json to ensure all content_ref values point inside .fabric/knowledge/{type}/ (team) or ~/.fabric/knowledge/{type}/ (personal).",
    );
  }

  if (meta.missingContentRefs.length > 0) {
    // content_ref_missing is fixable: reconcileKnowledge rebuilds agents.meta.json from
    // the physical .fabric/knowledge/**/*.md files, dropping any stale refs automatically.
    return issueCheck(
      "Rule content refs",
      "error",
      "fixable_error",
      "content_ref_missing",
      `${meta.missingContentRefs.length} content_ref target${meta.missingContentRefs.length === 1 ? "" : "s"} are missing. Run \`fab doctor --fix\` to reconcile.`,
      "Run `fab doctor --fix` to reconcile agents.meta.json with the files present in .fabric/knowledge/.",
    );
  }

  return okCheck("Rule content refs", "All content_ref entries resolve to .fabric/knowledge files.");
}

function createKnowledgeTestIndexCheck(index: KnowledgeTestIndexInspection): DoctorCheck {
  if (!index.present) {
    return issueCheck("Knowledge-test index", "error", "fixable_error", "knowledge_test_index_missing", index.error, "Run `fab doctor --fix` to rebuild .fabric/.cache/knowledge-test.index.json.");
  }
  if (!index.valid) {
    return issueCheck("Knowledge-test index", "error", "manual_error", "knowledge_test_index_invalid", index.error, "Delete .fabric/.cache/knowledge-test.index.json and run `fab doctor --fix` to regenerate it.");
  }
  if (index.stale) {
    return issueCheck("Knowledge-test index", "error", "fixable_error", "knowledge_test_index_stale", ".fabric/.cache/knowledge-test.index.json is stale.", "Run `fab doctor --fix` to rebuild the knowledge-test index.");
  }
  return okCheck("Knowledge-test index", `${index.linkCount} link${index.linkCount === 1 ? "" : "s"} and ${index.orphanCount} orphan annotation${index.orphanCount === 1 ? "" : "s"} indexed.`);
}

function createEventLedgerCheck(ledger: EventLedgerInspection): DoctorCheck {
  if (!ledger.exists) {
    return issueCheck("Event ledger", "error", "fixable_error", "event_ledger_missing", ".fabric/events.jsonl is missing.", "Run `fab doctor --fix` to create .fabric/events.jsonl.");
  }
  if (!ledger.writable) {
    return issueCheck("Event ledger", "error", "manual_error", "event_ledger_not_writable", ledger.error ?? ".fabric/events.jsonl is not writable.", "Check file permissions on .fabric/events.jsonl and ensure no other process holds a write lock.");
  }
  if (!ledger.parseable) {
    return issueCheck("Event ledger", "error", "manual_error", "event_ledger_invalid", ledger.error ?? ".fabric/events.jsonl is invalid.", "Delete .fabric/events.jsonl and run `fab doctor --fix` to recreate it.");
  }
  return okCheck("Event ledger", ".fabric/events.jsonl exists, is writable, and is parseable.");
}

function createMcpConfigInWrongFileCheck(inspection: McpConfigInWrongFileInspection): DoctorCheck {
  if (inspection.hasWrongEntry) {
    return issueCheck(
      "Claude MCP config location",
      "error",
      "fixable_error",
      "mcp_config_in_wrong_file",
      `.claude/settings.json contains mcpServers.fabric — this file is for hooks/permissions only. Run --fix to remove it, then re-run fab install to write .mcp.json.`,
      "Run `fab doctor --fix` to remove mcpServers.fabric from .claude/settings.json, then run `fab install` to write .mcp.json.",
    );
  }

  return okCheck("Claude MCP config location", "mcpServers.fabric is not in .claude/settings.json.");
}

function createEventLedgerPartialWriteCheck(ledger: EventLedgerInspection): DoctorCheck {
  if (!ledger.exists || !ledger.writable) {
    return okCheck("Event ledger partial write", "No partial-write check needed (ledger missing or not writable).");
  }
  if (ledger.hasPartialWrite) {
    return issueCheck(
      "Event ledger partial write",
      "error",
      "fixable_error",
      "event_ledger_partial_write",
      `events.jsonl has a partial write at byte offset ${ledger.partialWriteByteOffset} (${ledger.partialWriteByteLength} corrupted bytes). Run --fix to truncate and preserve corrupted bytes.`,
      "Run `fab doctor --fix` to truncate the partial write and restore events.jsonl to a valid state.",
    );
  }
  return okCheck("Event ledger partial write", "events.jsonl has no partial trailing write.");
}

function okCheck(name: string, message: string): DoctorCheck {
  return { name, status: "ok", message };
}

function issueCheck(
  name: string,
  status: DoctorStatus,
  kind: DoctorIssueKind,
  code: string,
  message: string,
  actionHint?: string,
): DoctorCheck {
  return {
    name,
    status,
    kind,
    code,
    fixable: kind === "fixable_error",
    message,
    actionHint,
  };
}

function collectIssues(checks: DoctorCheck[], kind: DoctorIssueKind): DoctorIssue[] {
  return checks
    .filter((check) => check.kind === kind)
    .map((check) => ({
      code: check.code ?? check.name,
      name: check.name,
      message: check.message,
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
    const absPath = join(projectRoot, contentRef);

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
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = posix.join(relPrefix, abs.slice(rootDir.length + 1).replace(/\\/gu, "/"));
        out.add(rel);
      }
    }
  }
}

function createKnowledgeDirUnindexedCheck(inspection: RulesDirUnindexedInspection): DoctorCheck {
  if (inspection.unindexedFiles.length > 0) {
    return issueCheck(
      "Knowledge dir unindexed",
      "error",
      "fixable_error",
      "knowledge_dir_unindexed",
      `${inspection.unindexedFiles.length} .md file${inspection.unindexedFiles.length === 1 ? "" : "s"} in .fabric/knowledge/ not indexed in agents.meta.json. Run \`fab doctor --fix\` to index the missing knowledge files.`,
      "Run `fab doctor --fix` to index the missing knowledge files.",
    );
  }
  return okCheck("Knowledge dir unindexed", "All .fabric/knowledge/ .md files are indexed in agents.meta.json.");
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
      ["model", "MOD"],
      ["decision", "DEC"],
      ["guideline", "GLD"],
      ["pitfall", "PIT"],
      ["process", "PRO"],
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

function createCounterDesyncCheck(inspection: CounterDesyncInspection): DoctorCheck {
  if (inspection.desyncs.length > 0) {
    const first = inspection.desyncs[0];
    const detail = `counters.${first.layer}.${first.type} = ${first.current} but observed K${first.layer === "KP" ? "P" : "T"}-${first.type}-${String(first.observed).padStart(4, "0")}`;
    return issueCheck(
      "Knowledge counter desync",
      "error",
      "fixable_error",
      "counter_desync",
      `${inspection.desyncs.length} knowledge counter${inspection.desyncs.length === 1 ? "" : "s"} desynced from observed stable_ids. ${detail}. Run \`fab doctor --fix\` to bump counters.`,
      "Run `fab doctor --fix` to bump agents.meta.json counters to the maximum observed counter value.",
    );
  }
  return okCheck("Knowledge counter desync", "agents.meta.json counters envelope is consistent with observed stable_ids.");
}

function createStableIdCollisionCheck(inspection: StableIdCollisionInspection): DoctorCheck {
  if (inspection.collisions.length > 0) {
    const first = inspection.collisions[0];
    const detail = inspection.collisions.length === 1
      ? `stable_id "${first.stable_id}" is declared in ${first.files.length} files: ${first.files.join(", ")}.`
      : `${inspection.collisions.length} stable_id collision${inspection.collisions.length === 1 ? "" : "s"} detected. First: "${first.stable_id}" in ${first.files.join(", ")}.`;
    return issueCheck(
      "Stable ID collision",
      "warn",
      "warning",
      "stable_id_collision",
      `${detail} Edit one of the knowledge files to use a unique stable_id.`,
      "Edit one of the colliding knowledge files to declare a different `id: K[PT]-XXX-NNNN` frontmatter value.",
    );
  }
  return okCheck("Stable ID collision", "No declared stable_id collisions found in .fabric/knowledge/.");
}

function createMetaManuallyDivergedCheck(inspection: MetaManuallyDivergedInspection): DoctorCheck {
  if (!inspection.readable) {
    // meta unreadable is already surfaced by createMetaCheck; skip here
    return okCheck("Meta manual divergence", "agents.meta.json not readable; skipping divergence check.");
  }

  if (inspection.extraMetaEntries.length > 0) {
    return issueCheck(
      "Meta manual divergence",
      "warn",
      "warning",
      "meta_manually_diverged",
      `agents.meta.json has ${inspection.extraMetaEntries.length} entr${inspection.extraMetaEntries.length === 1 ? "y" : "ies"} with no backing file on disk. Run --fix to reconcile.`,
      "Run `fab doctor --fix` to reconcile agents.meta.json with the rule files currently on disk.",
    );
  }

  if (inspection.hashMismatchEntries.length > 0) {
    return issueCheck(
      "Meta manual divergence",
      "warn",
      "warning",
      "meta_manually_diverged",
      `agents.meta.json has ${inspection.hashMismatchEntries.length} entr${inspection.hashMismatchEntries.length === 1 ? "y" : "ies"} whose hash does not match the file on disk. Run --fix to reconcile.`,
      "Run `fab doctor --fix` to reconcile agents.meta.json with the current rule file contents.",
    );
  }

  return okCheck("Meta manual divergence", "agents.meta.json is consistent with rule files on disk.");
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

  for (const stable_id of orphanIds) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_promoted",
      stable_id,
      timestamp: new Date().toISOString(),
      reason: SYNTHESIZED_PROMOTED_REASON,
      correlation_id: "doctor-synthesized",
      session_id: "doctor-synthesized",
    });
  }

  return { synthesized: orphanIds.length, synthesizedStableIds: orphanIds };
}

function createFilesystemEditFallbackCheck(inspection: FilesystemEditFallbackInspection): DoctorCheck {
  if (inspection.synthesized === 0) {
    return okCheck(
      "Filesystem-edit fallback",
      "No orphan canonical knowledge entries detected; events.jsonl promotion trail is complete.",
    );
  }
  const sample = inspection.synthesizedStableIds.slice(0, 3).join(", ");
  return {
    name: "Filesystem-edit fallback",
    status: "ok",
    kind: "info",
    code: "knowledge_promoted_synthesized",
    fixable: false,
    message: `Synthesized ${inspection.synthesized} knowledge_promoted event${inspection.synthesized === 1 ? "" : "s"} for orphan canonical entries (${sample}${inspection.synthesizedStableIds.length > 3 ? ", ..." : ""}). Reason='${SYNTHESIZED_PROMOTED_REASON}'.`,
    actionHint: "These entries were moved into .fabric/knowledge/<type>/ outside fab_review.approve. The synthesized events restore audit-trail completeness.",
  };
}

function createPreexistingRootFilesCheck(inspection: PreexistingRootFilesInspection): DoctorCheck {
  if (inspection.detected.length === 0) {
    return okCheck("Preexisting root markdown", "No CLAUDE.md or AGENTS.md detected at project root.");
  }
  return {
    name: "Preexisting root markdown",
    status: "ok",
    kind: "info",
    code: "preexisting_root_claude_md",
    fixable: false,
    message: `${inspection.detected.join(", ")} detected at project root. These root files are not auto-loaded by Fabric MCP.`,
    actionHint: "Move knowledge content to `.fabric/knowledge/{type}/` if you want it available in MCP responses.",
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
    if (
      event.event_type !== "knowledge_consumed" &&
      event.event_type !== "knowledge_demoted" &&
      event.event_type !== "knowledge_archived"
    ) {
      continue;
    }
    const ts = event.ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) {
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
function maturityThresholdDays(maturity: LintMaturity): number {
  return ORPHAN_DEMOTE_THRESHOLD_DAYS[maturity];
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
  const candidates: OrphanDemoteCandidate[] = [];

  for (const entry of iterateCanonicalEntries(projectRoot, lastConsumedIndex)) {
    const ageMs = entry.lastReferenceMs > 0 ? now - entry.lastReferenceMs : now;
    const ageDays = Math.floor(ageMs / MS_PER_DAY);
    const threshold = maturityThresholdDays(entry.maturity);
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
  return { candidates };
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

function createOrphanDemoteCheck(inspection: OrphanDemoteInspection): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      "Knowledge orphan demote",
      "No canonical knowledge entries exceed their maturity-keyed inactivity threshold.",
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} (${first.maturity}, ${first.age_days}d inactive at ${first.path})`;
  return issueCheck(
    "Knowledge orphan demote",
    "warn",
    "warning",
    "knowledge_orphan_demote_required",
    `${inspection.candidates.length} canonical knowledge entr${inspection.candidates.length === 1 ? "y exceeds" : "ies exceed"} their maturity-keyed inactivity threshold (stable=${ORPHAN_DEMOTE_THRESHOLD_DAYS.stable}d / endorsed=${ORPHAN_DEMOTE_THRESHOLD_DAYS.endorsed}d / draft=${ORPHAN_DEMOTE_THRESHOLD_DAYS.draft}d). First: ${detail}.`,
    "Run `fab doctor --apply-lint` (rc.4 TASK-003) to demote orphan entries one maturity tier.",
  );
}

function createStaleArchiveCheck(inspection: StaleArchiveInspection): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      "Knowledge stale archive",
      "No draft knowledge entries exceed the additional stale-archive quiet window.",
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} (${first.age_days}d inactive at ${first.path}) → ${first.archive_path}`;
  return issueCheck(
    "Knowledge stale archive",
    "warn",
    "warning",
    "knowledge_stale_archive_required",
    `${inspection.candidates.length} draft knowledge entr${inspection.candidates.length === 1 ? "y is" : "ies are"} stale beyond the demote+${STALE_ARCHIVE_ADDITIONAL_DAYS}d additional quiet window. First: ${detail}.`,
    "Run `fab doctor --apply-lint` (rc.4 TASK-003) to move stale entries into `.fabric/.archive/<type>/`.",
  );
}

function createPendingOverdueCheck(inspection: PendingOverdueInspection): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      "Knowledge pending overdue",
      "No pending knowledge entries exceed the 14-day review threshold.",
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.path} (${first.age_days}d old)`;
  return issueCheck(
    "Knowledge pending overdue",
    "warn",
    "warning",
    "knowledge_pending_overdue",
    `${inspection.candidates.length} pending knowledge entr${inspection.candidates.length === 1 ? "y has" : "ies have"} been awaiting review for more than ${PENDING_OVERDUE_THRESHOLD_DAYS} days. First: ${detail}.`,
    "Review pending entries via the fabric-review Skill (`/fabric-review`) and approve, reject, defer, or modify.",
  );
}

// rc.5 TASK-010: surface the underseeded lint (#22) as an `info` kind so it
// shows in the report without bumping doctor's status to warn/error — a small
// corpus is a legitimate state during early adoption, not a defect. The
// actionHint points the user at the fabric-import Skill, mirroring the
// fabric-hint hook's import-signal recommendation.
function createUnderseededCheck(inspection: UnderseededInspection): DoctorCheck {
  if (!inspection.underseeded) {
    return okCheck(
      "Knowledge underseeded",
      `Knowledge corpus has ${inspection.node_count} canonical entries (>= ${inspection.threshold}).`,
    );
  }
  return issueCheck(
    "Knowledge underseeded",
    "ok",
    "info",
    "knowledge_underseeded",
    `Knowledge corpus has only ${inspection.node_count} canonical entr${inspection.node_count === 1 ? "y" : "ies"} (< ${inspection.threshold} threshold). The plan_context retrieval surface is below its useful floor.`,
    "Run the fabric-import Skill (`/fabric-import`) to backfill knowledge from git history and existing docs.",
  );
}

// rc.6 TASK-021 (E3): surface stale session-hints cache files as an info-
// kind finding. Status remains "ok" — the cache is hot-cache hygiene, not
// a correctness concern. The actionHint points at apply-lint so users can
// reap accumulated cache files in a single pass.
function createSessionHintsStaleCheck(
  inspection: SessionHintsStaleInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      "Knowledge session-hints stale",
      `No session-hints cache files older than ${SESSION_HINTS_STALE_DAYS} days under .fabric/.cache/.`,
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.path} (${first.age_days}d old)`;
  return issueCheck(
    "Knowledge session-hints stale",
    "ok",
    "info",
    "knowledge_session_hints_stale",
    `${inspection.candidates.length} session-hints cache file${inspection.candidates.length === 1 ? "" : "s"} under .fabric/.cache/ ${inspection.candidates.length === 1 ? "is" : "are"} older than ${SESSION_HINTS_STALE_DAYS} days. First: ${detail}.`,
    "Run `fab doctor --apply-lint` to delete stale session-hints cache files.",
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

function createNarrowNoPathsCheck(inspection: NarrowNoPathsInspection): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      "Knowledge narrow without paths",
      "No narrow-scope canonical entries have an empty relevance_paths array.",
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} (${first.path})`;
  return issueCheck(
    "Knowledge narrow without paths",
    "warn",
    "warning",
    "knowledge_narrow_no_paths",
    `${inspection.candidates.length} narrow-scope canonical entr${inspection.candidates.length === 1 ? "y has" : "ies have"} an empty relevance_paths array (silent recall risk — narrow without anchors can never match a target path). First: ${detail}.`,
    "Either add path anchors to relevance_paths or widen the entry's relevance_scope to broad.",
  );
}

function createRelevancePathsDanglingCheck(
  inspection: RelevancePathsDanglingInspection,
): DoctorCheck {
  if (inspection.entries.length === 0) {
    return okCheck(
      "Knowledge relevance_paths dangling",
      "All relevance_paths globs resolve to at least one file under the workspace root.",
    );
  }
  const first = inspection.entries[0];
  const detail = `${first.stable_id} at ${first.path} → \`${first.dangling_glob}\` (0 matches)`;
  return issueCheck(
    "Knowledge relevance_paths dangling",
    "warn",
    "warning",
    "knowledge_relevance_paths_dangling",
    `${inspection.entries.length} relevance_paths glob${inspection.entries.length === 1 ? " resolves" : "s resolve"} to zero files in the current workspace. First: ${detail}.`,
    "Update the entry's relevance_paths to remove globs that no longer match any files, or use `fab_review.modify` to rewrite the anchor set.",
  );
}

function createRelevancePathsDriftCheck(
  inspection: RelevancePathsDriftInspection,
): DoctorCheck {
  if (!inspection.git_available) {
    return okCheck(
      "Knowledge relevance_paths drift",
      `Skipped (git history unavailable; cannot evaluate ${RELEVANCE_PATHS_DRIFT_WINDOW_DAYS}d drift window).`,
    );
  }
  if (inspection.candidates.length === 0) {
    return okCheck(
      "Knowledge relevance_paths drift",
      `All narrow-scope canonical entries have at least one relevance_path touched in the last ${RELEVANCE_PATHS_DRIFT_WINDOW_DAYS}d.`,
    );
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} at ${first.path} (globs: ${first.globs.join(", ")})`;
  return issueCheck(
    "Knowledge relevance_paths drift",
    "ok",
    "info",
    "knowledge_relevance_paths_drift",
    `${inspection.candidates.length} narrow-scope canonical entr${inspection.candidates.length === 1 ? "y has" : "ies have"} relevance_paths whose globs match no file touched in the last ${RELEVANCE_PATHS_DRIFT_WINDOW_DAYS}d of git history. First: ${detail}.`,
    "Review whether the entry is still relevant — use `fab_review.modify` to refresh the anchors or `fab_review.reject` to archive.",
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
  inspection: RelevanceFieldsMissingInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      "Knowledge relevance fields missing",
      "All pending entries declare both relevance_scope and relevance_paths.",
    );
  }
  const first = inspection.candidates[0];
  const missingParts: string[] = [];
  if (first.missing_scope) missingParts.push("relevance_scope");
  if (first.missing_paths) missingParts.push("relevance_paths");
  const detail = `${first.pending_path} (missing: ${missingParts.join(", ")})`;
  return issueCheck(
    "Knowledge relevance fields missing",
    "ok",
    "info",
    "knowledge_relevance_fields_missing",
    `${inspection.candidates.length} pending entr${inspection.candidates.length === 1 ? "y is" : "ies are"} missing relevance_scope and/or relevance_paths in frontmatter. First: ${detail}.`,
    "Run `fab doctor --apply-lint` to back-fill the schema defaults (relevance_scope: broad, relevance_paths: []).",
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
  inspection: SkillMdYamlInvalidInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(
      "Skill markdown YAML",
      "All .claude/.codex SKILL.md frontmatter values parse as strict YAML.",
    );
  }
  const first = inspection.candidates[0]!;
  const detail = `${first.path}:${first.line} (key \`${first.key}\` value contains an unquoted ': ' — preview: \`${first.preview}\`)`;
  const plural = inspection.candidates.length === 1;
  return issueCheck(
    "Skill markdown YAML",
    "warn",
    "warning",
    "skill_md_yaml_invalid",
    `${inspection.candidates.length} SKILL.md frontmatter ${plural ? "value contains" : "values contain"} an unquoted ': ' that strict YAML parsers reject (Claude Code tolerates it; Codex CLI drops the skill at load). First: ${detail}.`,
    "Quote the value with double quotes (`description: \"…\"`) or rewrite the inner `key: value` token to `key=value`.",
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
function createNarrowTooFewCheck(inspection: NarrowTooFewInspection): DoctorCheck {
  const { structural_flagged, telemetry_flagged } = inspection;
  if (!structural_flagged && !telemetry_flagged) {
    // Compose a passing message that includes whichever arm contributed
    // data — keeps the surface informative even on the happy path.
    const ratioPct = (inspection.narrow_ratio * 100).toFixed(0);
    const teleNote = inspection.telemetry_skipped
      ? "telemetry skipped (no edit-counter fires in window)"
      : `silence rate ${(inspection.silence_rate * 100).toFixed(0)}% over ${SILENCE_WINDOW_DAYS}d`;
    return okCheck(
      "Knowledge narrow too few",
      `Narrow-with-paths ratio ${ratioPct}% (${inspection.narrow_with_paths_count}/${inspection.total_canonical_entries}); ${teleNote}.`,
    );
  }
  // Build a message that describes which arm(s) fired. Both arms point at
  // the same fabric-import action, so the actionHint is unified.
  const parts: string[] = [];
  if (structural_flagged) {
    const ratioPct = (inspection.narrow_ratio * 100).toFixed(0);
    parts.push(
      `narrow-with-paths share ${ratioPct}% (${inspection.narrow_with_paths_count}/${inspection.total_canonical_entries}) below ${(NARROW_RATIO_THRESHOLD * 100).toFixed(0)}% threshold`,
    );
  }
  if (telemetry_flagged) {
    const silencePct = (inspection.silence_rate * 100).toFixed(0);
    parts.push(
      `narrow-hook silence rate ${silencePct}% (${inspection.silence_fires_in_window}/${inspection.total_edit_fires_in_window}) over ${SILENCE_WINDOW_DAYS}d above ${(SILENCE_RATE_THRESHOLD * 100).toFixed(0)}% threshold`,
    );
  }
  return issueCheck(
    "Knowledge narrow too few",
    "ok",
    "info",
    "knowledge_narrow_too_few",
    `Narrow-scope KB coverage is below the useful floor: ${parts.join("; ")}.`,
    "Run the fabric-import Skill (`/fabric-import`) to re-seed narrow anchors against the current codebase.",
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

function createStableIdDuplicateCheck(inspection: StableIdDuplicateInspection): DoctorCheck {
  if (inspection.duplicates.length === 0) {
    return okCheck(
      "Knowledge stable_id duplicate",
      "No canonical knowledge files share a stable_id across team / personal trees.",
    );
  }
  const first = inspection.duplicates[0];
  const detail = `${first.stable_id} appears in ${first.paths.length} files: ${first.paths.join(", ")}`;
  return issueCheck(
    "Knowledge stable_id duplicate",
    "error",
    "manual_error",
    "knowledge_stable_id_duplicate",
    `${inspection.duplicates.length} stable_id${inspection.duplicates.length === 1 ? "" : "s"} duplicated across canonical knowledge files (path-decoupled identity invariant). First: ${detail}.`,
    "Manually rename one of the colliding files to a fresh `<prefix>-<type>-<counter>--<slug>.md` allocated via the canonical id allocator; do not edit by hand.",
  );
}

function createLayerMismatchCheck(inspection: LayerMismatchInspection): DoctorCheck {
  if (inspection.mismatches.length === 0) {
    return okCheck(
      "Knowledge layer mismatch",
      "All canonical knowledge files are physically located under the layer their stable_id prefix declares.",
    );
  }
  const first = inspection.mismatches[0];
  const detail = `${first.stable_id} at ${first.path} (located in ${first.located_in}, expected ${first.expected_layer})`;
  return issueCheck(
    "Knowledge layer mismatch",
    "error",
    "manual_error",
    "knowledge_layer_mismatch",
    `${inspection.mismatches.length} canonical knowledge file${inspection.mismatches.length === 1 ? "" : "s"} are physically misaligned with their stable_id layer prefix (KT-* must live under team/, KP-* under personal/). First: ${detail}.`,
    "Move the file to the correct layer root, or use the fabric-review modify flow to flip its layer (which renames the stable_id prefix accordingly).",
  );
}

function createIndexDriftCheck(inspection: IndexDriftInspection): DoctorCheck {
  if (inspection.drifts.length === 0) {
    return okCheck(
      "Knowledge index drift",
      "agents.meta.json counters envelope is at or above the highest existing canonical counter for every (layer, type) pair.",
    );
  }
  const first = inspection.drifts[0];
  const detail = `${first.layer}.${first.type} counter=${first.counter} but max_observed=${first.max_observed} (would propose counters.${first.layer}.${first.type}=${first.proposed_after})`;
  return issueCheck(
    "Knowledge index drift",
    "error",
    "fixable_error",
    "knowledge_index_drift",
    `${inspection.drifts.length} (layer, type) counter slot${inspection.drifts.length === 1 ? "" : "s"} have drifted below the observed canonical maximum (next allocate would collide). First: ${detail}.`,
    "Run `fab doctor --apply-lint` (rc.4 TASK-003) to bump agents.meta.json counters to max_observed + 1.",
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

// v2.0.0-rc.20 TASK-05: cite policy adherence report shape returned by
// `fab doctor --cite-coverage`. STUB scaffolding — TASK-06 fills the
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
export type CiteCoverageReport = {
  status: "ok" | "skipped";
  marker_ts: number;
  marker_emitted_now: boolean;
  since_ts: number;
  client_filter: "cc" | "codex" | "cursor" | "all";
  metrics: {
    edits_touched: number;
    qualifying_cites: number;
    recalled_unverified: number;
    expected_but_missed: number;
    total_turns: number;
  };
  per_client?: Record<string, Partial<CiteCoverageReport["metrics"]>>;
  dismissed_reason_histogram?: Record<string, number>;
  generated_at: string;
};

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
type CiteTagCategory = "planned" | "recalled" | "chained-from" | "dismissed" | "none";

function categorizeCiteTag(tag: string): { category: CiteTagCategory; reason?: string } {
  if (tag === "planned" || tag === "recalled" || tag === "chained-from" || tag === "none") {
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

// v2.0.0-rc.20 TASK-06: Real cite-coverage report. Single readEventLedger pass
// (event-type filter is intentionally omitted so the discriminated-union
// partitioning happens in a single for-loop, per the buildLastActiveIndex
// structural twin at L2885). Aggregates five metrics:
//
//   - total_turns:           assistant_turn_observed in window (filtered by
//                            client when options.client !== 'all').
//   - qualifying_cites:      cite_tags ∈ {planned, recalled, chained-from}.
//   - recalled_unverified:   'recalled' tag with no knowledge_sections_fetched
//                            in the same session within ±60s.
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
  options: { since: number; client: "cc" | "codex" | "cursor" | "all" },
): Promise<CiteCoverageReport> {
  const marker = await ensureCitePolicyActivatedMarker(projectRoot);
  const generatedAt = new Date().toISOString();
  const zeroMetrics: CiteCoverageReport["metrics"] = {
    edits_touched: 0,
    qualifying_cites: 0,
    recalled_unverified: 0,
    expected_but_missed: 0,
    total_turns: 0,
  };

  if (marker.marker_ts === 0) {
    return {
      status: "skipped",
      marker_ts: 0,
      marker_emitted_now: false,
      since_ts: options.since,
      client_filter: options.client,
      metrics: zeroMetrics,
      generated_at: generatedAt,
    };
  }

  // effectiveSince anchors the window at the policy marker — observations
  // recorded before the policy activated are not coverable under it.
  const effectiveSince = Math.max(marker.marker_ts, options.since);

  // Single ledger pass — collect ALL events in window, partition by type.
  let ledgerEvents: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot, { since: effectiveSince });
    ledgerEvents = result.events;
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
      metrics: zeroMetrics,
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

    let turnHadRecalled = false;
    for (const tag of turn.cite_tags) {
      const { category, reason } = categorizeCiteTag(tag);
      switch (category) {
        case "planned":
        case "recalled":
        case "chained-from":
          qualifyingCites += 1;
          bumpClient(turn.client, (m) => {
            m.qualifying_cites += 1;
          });
          if (category === "recalled") turnHadRecalled = true;
          break;
        case "dismissed": {
          const key = reason ?? "unspecified";
          dismissedHistogram[key] = (dismissedHistogram[key] ?? 0) + 1;
          break;
        }
        case "none":
        default:
          break;
      }
    }

    if (turnHadRecalled && !isRecallVerified(turn)) {
      recalledUnverified += 1;
      bumpClient(turn.client, (m) => {
        m.recalled_unverified += 1;
      });
    }
  }

  // expected_but_missed: walk edit events, for each one find narrow kbs whose
  // relevance_paths cover the edit's path; if no assistant_turn in the same
  // session cited that kb, increment. Edits without a session_id cannot be
  // correlated and are skipped (conservative — better to under-count than to
  // raise false positives).
  let editsTouched = 0;
  let expectedButMissed = 0;
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
    if (clientSessionIds !== null) {
      if (typeof sid !== "string" || sid.length === 0) continue;
      if (!clientSessionIds.has(sid)) continue;
    }
    editsTouched += 1;
    if (typeof sid !== "string" || sid.length === 0) continue;
    const citedSet = sessionCitedKbs.get(sid) ?? new Set<string>();
    for (const [kbId, kb] of kbIndex) {
      if (kb.relevance_scope !== "narrow") continue;
      if (!matchesRelevancePath(edit.path, kb.relevance_paths)) continue;
      if (!citedSet.has(kbId)) {
        expectedButMissed += 1;
      }
    }
  }

  const metrics: CiteCoverageReport["metrics"] = {
    edits_touched: editsTouched,
    qualifying_cites: qualifyingCites,
    recalled_unverified: recalledUnverified,
    expected_but_missed: expectedButMissed,
    total_turns: totalTurns,
  };

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

  return {
    status: "ok",
    marker_ts: marker.marker_ts,
    marker_emitted_now: marker.emitted_now,
    since_ts: effectiveSince,
    client_filter: options.client,
    metrics,
    ...(perClient !== undefined ? { per_client: perClient } : {}),
    ...(Object.keys(dismissedHistogram).length > 0 ? { dismissed_reason_histogram: dismissedHistogram } : {}),
    generated_at: generatedAt,
  };
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

export { getEventLedgerPath };
