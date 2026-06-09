import { execFileSync } from "node:child_process";
import { access, appendFile, mkdir, readFile, readdir as readdirAsync, rename, stat as statAsync, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, posix, relative as nodeRelative, resolve, sep } from "node:path";

import { ZodError } from "zod";

import {
  createTranslator,
  forensicReportSchema,
  BOOTSTRAP_CANONICAL,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
  ONBOARD_SLOT_NAMES,
  ONBOARD_SLOT_TOTAL,
  type AgentsMeta,
  type EventLedgerEvent,
  type ForensicReport,
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
import { ensureParentDirectory, getEventLedgerPath, getMetricsLedgerPath } from "./_shared.js";
import {
  createGlobalCliVersionCheck,
  inspectGlobalCliVersion,
  type GlobalCliInspection,
} from "./doctor-global-cli.js";
import { computeDoctorHealth, type DoctorHealth } from "./doctor-health.js";
import {
  createKnowledgeSummaryOpaqueCheck,
  inspectKnowledgeSummaryOpaque,
} from "./doctor-summary-opaque.js";
import {
  createLayerMismatchCheck,
  createStableIdCollisionCheck,
  createStableIdDuplicateCheck,
  type LayerMismatchInspection,
  type StableIdCollisionInspection,
  type StableIdDuplicateInspection,
} from "./doctor-stable-id-collision.js";
// v2.2 W5 R4 (agents.meta decolo): doctor no longer reads/rebuilds the project
// co-location agents.meta.json (buildKnowledgeMeta / writeKnowledgeMeta /
// readAgentsMeta) nor reconciles it (reconcileKnowledge / resolveContentRefPath).
// Knowledge lives in stores; per-store counters health goes through
// doctor-store-counters.ts.
import {
  collectStoreCanonicalEntries,
  collectStoreKnowledgeSummaries,
  computeReadSetRevision,
} from "./cross-store-recall.js";
import { createScopeLintCheck, lintStoreScopes } from "./doctor-scope-lint.js";
import {
  createStoreCounterCheck,
  fixStoreCounters,
  inspectStoreCounters,
} from "./doctor-store-counters.js";
import {
  appendEventLedgerEvent,
  dropEventsFromLedger,
  readEventLedger,
  rotateEventLedgerIfNeeded,
  truncateLedgerToLastNewline,
} from "./event-ledger.js";
import { appendCiteRollupRow, readCiteRollup, utcDayKey, utcDayBounds } from "./cite-rollup.js";
import type { CiteRollupRow } from "./cite-rollup.js";
import { flushMetrics, readMetrics, METRIC_COUNTER_NAMES } from "./metrics.js";
import type { MetricsRow } from "./metrics.js";
import { isAlive, readLockState } from "./legacy-serve-lock-probe.js";
import {
  inspectEventsJsonlGates,
  type EventsJsonlGatesReport,
} from "./events-jsonl-gates.js";
import {
  createMcpConfigInWrongFileCheck,
  createSkillDescriptionCheck,
  createSkillMdYamlInvalidCheck,
  createSkillRefMirrorCheck,
  createSkillTokenBudgetCheck,
  inspectMcpConfigInWrongFile,
  inspectSkillDescription,
  inspectSkillMdYamlInvalid,
  inspectSkillRefMirror,
  inspectSkillTokenBudget,
} from "./doctor-skill-lints.js";
import {
  createHookCacheWritabilityCheck,
  createHooksContentDriftCheck,
  createHooksRuntimeCheck,
  createHooksWiredCheck,
  inspectHookCacheWritability,
  inspectHooksContentDrift,
  inspectHooksRuntime,
  inspectHooksWired,
} from "./doctor-hooks-lints.js";
import {
  BOOTSTRAP_MARKER_MIGRATION_TARGETS,
  createBootstrapAnchorCheck,
  createBootstrapMarkerMigrationCheck,
  createL1BootstrapSnapshotDriftCheck,
  createL2ManagedBlockDriftCheck,
  inspectBootstrapAnchor,
  inspectBootstrapMarkerMigration,
  inspectL1BootstrapSnapshotDrift,
  inspectL2ManagedBlockDrift,
} from "./doctor-bootstrap-lints.js";

export { inspectL1BootstrapSnapshotDrift } from "./doctor-bootstrap-lints.js";
export {
  createGlobalCliVersionCheck,
  inspectGlobalCliVersion,
} from "./doctor-global-cli.js";
export type { GlobalCliInspection } from "./doctor-global-cli.js";
export { computeDoctorHealth } from "./doctor-health.js";
export type { DoctorHealth } from "./doctor-health.js";
export {
  createKnowledgeSummaryOpaqueCheck,
  inspectKnowledgeSummaryOpaque,
} from "./doctor-summary-opaque.js";
export type { KnowledgeSummaryOpaqueInspection } from "./doctor-summary-opaque.js";
export { createScopeLintCheck } from "./doctor-scope-lint.js";
export { createStoreCounterCheck } from "./doctor-store-counters.js";
export {
  createLayerMismatchCheck,
  createStableIdCollisionCheck,
  createStableIdDuplicateCheck,
} from "./doctor-stable-id-collision.js";
export type {
  LayerMismatchInspection,
  StableIdCollisionInspection,
  StableIdDuplicateInspection,
} from "./doctor-stable-id-collision.js";

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
  warnings: DoctorIssue[];
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

// v2.2 W5 R4 (agents.meta decolo): a valid-but-empty MetaInspection. `inspectMeta`
// (which read the retired co-location agents.meta.json) is gone, but the exported
// `inspectKnowledgeSummaryOpaque` still takes a MetaInspection as its first arg
// (back-compat with its own test). Feeding this empty-valid value makes the
// project-node loop a no-op so the lint runs purely over the read-set stores —
// the post-decolo canonical knowledge home.
const EMPTY_META_INSPECTION: MetaInspection = {
  present: true,
  valid: true,
  meta: { revision: "", nodes: {} } as unknown as AgentsMeta,
  revision: "",
  computedRevision: null,
  ruleCount: 0,
  missingContentRefs: [],
  invalidContentRefs: [],
  stale: false,
  changed: false,
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

// v2.0.0-rc.37 NEW-38: knowledge auto-promote report shape. v2.2 store cutover
// keeps the public check as an empty compatibility surface until candidate
// discovery can operate against store-backed knowledge.
type DraftAutoPromoteCandidate = {
  stable_id: string;
  relPath: string;
  absPath: string;
  ageDays: number;
};
type DraftAutoPromoteInspection = {
  candidates: DraftAutoPromoteCandidate[];
};

function emptyDraftBacklogInspection(): DraftBacklogInspection {
  return { status: "ok", draftCount: 0, totalCount: 0, ratio: 0 };
}

function emptyDraftAutoPromoteInspection(): DraftAutoPromoteInspection {
  return { candidates: [] };
}

function emptyFilesystemEditFallbackInspection(): FilesystemEditFallbackInspection {
  return { synthesized: 0, synthesizedStableIds: [] };
}

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

export type LintMaturity = "stable" | "endorsed" | "draft";

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

function emptyOrphanDemoteInspection(projectRoot: string): OrphanDemoteInspection {
  return { candidates: [], thresholds: resolveMaturityThresholds(projectRoot) };
}

function emptyStaleArchiveInspection(): StaleArchiveInspection {
  return { candidates: [] };
}

function emptyPendingOverdueInspection(): PendingOverdueInspection {
  return { candidates: [] };
}

function emptyPendingAutoArchiveInspection(): PendingAutoArchiveInspection {
  return { candidates: [] };
}

function emptyRelevanceFieldsMissingInspection(): RelevanceFieldsMissingInspection {
  return { candidates: [], scanned_count: 0 };
}

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

function emptyNarrowTooFewInspection(): NarrowTooFewInspection {
  return {
    total_canonical_entries: 0,
    narrow_with_paths_count: 0,
    narrow_ratio: 0,
    structural_flagged: false,
    total_edit_fires_in_window: 0,
    silence_fires_in_window: 0,
    silence_rate: 0,
    telemetry_skipped: true,
    telemetry_flagged: false,
  };
}

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
  // Matched prompt-injection pattern names from the retired read-side scanner.
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
//
// v2.2 W3-T5 (F-MATURITY-ENDORSED): recognize BOTH the canonical maturity
// vocabulary (draft/verified/proven — KT-DEC-0005) and the legacy
// stable/endorsed names this doctor ladder was written against. Before this, a
// canonical `proven`/`verified` entry's maturity line did not match, so it was
// silently dropped from the ENTIRE orphan_demote lint (a proven entry could
// never be demoted). extractKnowledgeFrontmatterMaturity normalizes the
// canonical names back onto the internal LintMaturity ladder
// (proven→stable, verified→endorsed).
const MATURITY_LINE_PATTERN = /^maturity:\s*("?)(stable|endorsed|draft|verified|proven)\1\s*$/mu;

// Canonical maturity (KT-DEC-0005) → internal LintMaturity ladder. The doctor
// orphan_demote ladder is expressed in the legacy stable/endorsed names; this
// map lets canonical entries flow through it without rewriting the ladder.
const CANONICAL_TO_LINT_MATURITY: Record<string, LintMaturity> = {
  proven: "stable",
  verified: "endorsed",
  draft: "draft",
  // legacy values pass through unchanged.
  stable: "stable",
  endorsed: "endorsed",
};

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

// Knowledge subdirectories scanned by legacy filesystem-edit fallback checks.
// The project-local tree is no longer required, but if legacy content exists
// these forensic checks can still inspect it without recreating the layout.
const KNOWLEDGE_CANONICAL_TYPE_DIRS = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
] as const;

// Filename pattern for canonical knowledge entries. Prefer `<id>--<slug>.md`
// but also accept `<id>.md` because store-era fixtures and migrated entries may
// use bare stable-id filenames while still carrying valid frontmatter.
const CANONICAL_KNOWLEDGE_FILENAME_PATTERN =
  /^(K[PT]-(?:MOD|DEC|GLD|PIT|PRO)-\d{4,})(?:--[a-z0-9][a-z0-9-]*)?\.md$/u;

// Knowledge counter type-codes. Mirrors KNOWLEDGE_TYPE_CODES values in shared/api-contracts.
// v2.2 W5 R4 (agents.meta decolo): `COUNTER_TYPE_CODES` removed (only the retired counter_desync / index_drift checks used it).

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
  const entryPoints = await collectEntryPoints(projectRoot);
  const [
    forensic,
    eventLedger,
    eventsJsonlGates,
    bootstrapAnchor,
    bootstrapMarkerMigration,
    l1BootstrapSnapshotDrift,
    l2ManagedBlockDrift,
    mcpConfigInWrongFile,
    skillRefMirror,
    skillTokenBudget,
    skillDescription,
  ] = await Promise.all([
    inspectForensic(projectRoot),
    // v2.2 W5 R4 (agents.meta decolo): `inspectMeta` (read co-location
    // agents.meta.json) and `inspectKnowledgeTestIndex` (its derived
    // .fabric/.cache test-link index) are retired — knowledge lives in stores
    // now; the project co-location agents.meta + test-index machinery (and the
    // reconcileKnowledge rebuild behind their --fix) is gone.
    inspectEventLedger(projectRoot),
    // v2.0.0-rc.37 Wave B (B5): composite hard-gate inspection (G7 size /
    // G8 metric leak / G9 metrics stale / G10 rotation overdue).
    inspectEventsJsonlGates(projectRoot),
    inspectBootstrapAnchor(projectRoot),
    // v2.0.0-rc.19 TASK-004: one-time fabric:knowledge-base → fabric:bootstrap
    // marker migration scan. Inspect runs in this Promise.all block to keep
    // performance parity with the other I/O-bound inspections.
    inspectBootstrapMarkerMigration(projectRoot),
    // v2.0.0-rc.19 TASK-005: L1 + L2 byte-level drift detection. Both are
    // I/O-bound (small file reads + buffer compare) so they live in the same
    // Promise.all block as the other bootstrap inspections.
    inspectL1BootstrapSnapshotDrift(projectRoot),
    inspectL2ManagedBlockDrift(projectRoot),
    inspectMcpConfigInWrongFile(projectRoot),
    inspectSkillRefMirror(projectRoot),
    inspectSkillTokenBudget(projectRoot),
    inspectSkillDescription(projectRoot),
  ]);
  // v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart pattern detection. Async
  // (reads event ledger); placed after the sync inspections so the await
  // doesn't gate them.
  const citeGoodhart = await inspectCiteGoodhart(projectRoot);
  // v2.2 W5 R4 (agents.meta decolo): the read-set store corpus is the
  // post-decolo canonical knowledge source. Summaries feed store-aware checks;
  // the count + corpus revision hash replace retired agents.meta-derived fields.
  const storeKnowledgeSummaries = await collectStoreKnowledgeSummaries(projectRoot);
  const storeRevision = await computeReadSetRevision(projectRoot);
  // v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog ratio (sync, disk-only).
  const draftBacklog = emptyDraftBacklogInspection();
  // rc.37 NEW-38: auto-promote candidates (info surface; --fix does the work).
  const draftAutoPromote = emptyDraftAutoPromoteInspection();
  // rc.36 TASK-05 (P0-8): empty-tags ratio across canonical entries.
  const knowledgeTagsEmpty: EmptyTagsInspection = {
    status: "ok",
    emptyCount: 0,
    totalCount: storeKnowledgeSummaries.length,
    ratio: 0,
  };
  // rc.36 TASK-09 (P1-NEW1): drift_detected events without paired demote
  // in the last 30 days — drift detection runs but no consumption pipeline.
  const driftUnconsumed = await inspectDriftUnconsumed(projectRoot);
  // v2.2 W5 R4 (agents.meta decolo): `meta_manually_diverged` and
  // `knowledge_dir_unindexed` retired — both compared the project co-location
  // `.fabric/knowledge` against agents.meta.json (no longer authoritative;
  // knowledge lives in stores) and their only --fix was reconcileKnowledge.
  // v2.0.0-rc.22 TASK-006: baseline filename format hard error. Detects
  // legacy bare-slug baseline files. rc.23 TASK-012 (F8a) deleted the
  // baseline-emit pipeline outright, so the lint now serves only as a
  // forensic indicator for stale pre-rc.23 workspaces; resolution is
  // manual deletion of the offending file. manual_error kind, no --fix path.
  const baselineFilenameFormat: BaselineFilenameFormatInspection = { offenders: [] };
  const stableIdCollision: StableIdCollisionInspection = { collisions: [] };
  // v2.2 W5 R4 (agents.meta decolo): the co-location `counter_desync` /
  // `index_drift` checks (against agents.meta.json#counters) are retired. The
  // monotonic stable_id counter now lives per-store in committed counters.json
  // (store-counters.ts / KT-DEC-0004); `store_counter_drift` is its store-aware
  // replacement — disk-max FLOOR semantics over every read-set store.
  const storeCounterDrift = inspectStoreCounters(projectRoot);
  const preexistingRootFiles = await inspectPreexistingRootFiles(projectRoot);
  // rc.3 TASK-005: filesystem-edit fallback. Synthesizes knowledge_promoted
  // for canonical entries with no matching event. Runs AFTER ledger
  // partial-write detection so we never append to a corrupt tail; it relies
  // on the existing read/append machinery to be in a consistent state.
  const filesystemEditFallback = emptyFilesystemEditFallbackInspection();
  // rc.4 TASK-001: read-side lint inspections (#16-18). These run after the
  // filesystem-edit fallback (which can append synthesized knowledge_promoted
  // events) so that the lastActiveAt index built by orphan-demote and
  // stale-archive sees the synthesized timestamps and does not double-count
  // a freshly-synthesized canonical entry as orphan.
  const lintNow = Date.now();
  // v2.2 store cutover: legacy dual-root corpus lints are disabled until their
  // walkers are rewritten against ~/.fabric/stores/*/knowledge. Do not read or
  // mutate project-local `.fabric/knowledge` / legacy `~/.fabric/knowledge`.
  const orphanDemote = emptyOrphanDemoteInspection(projectRoot);
  const staleArchive = emptyStaleArchiveInspection();
  const pendingOverdue = emptyPendingOverdueInspection();
  const stableIdDuplicate: StableIdDuplicateInspection = { duplicates: [] };
  const layerMismatch: LayerMismatchInspection = { mismatches: [] };
  // rc.5 TASK-010: read-side underseeded-corpus inspection (#22). Independent
  // of lintNow — corpus size is a store summary count, not a time-decayed
  // signal. Runs alongside the rc.4 integrity inspections so the
  // report surfaces all corpus-level findings adjacent to one another.
  const underseedThreshold = await readUnderseedThresholdFromConfig(projectRoot);
  const underseeded: UnderseededInspection = {
    node_count: storeKnowledgeSummaries.length,
    threshold: underseedThreshold,
    underseeded: storeKnowledgeSummaries.length < underseedThreshold,
  };
  // rc.5 TASK-013 (C4): relevance_paths hygiene inspections #23/#24/#25. All
  // three walk canonical entries (team + personal) and inspect frontmatter
  // relevance fields. #24 expands globs against the live filesystem; #25
  // shells out to `git log` for the drift heuristic (degrades to ok+info
  // when git is unavailable). Flag-only in rc.5 — apply-lint auto-prune
  // deferred to rc.7+.
  const narrowNoPaths: NarrowNoPathsInspection = { candidates: [] };
  const relevancePathsDangling: RelevancePathsDanglingInspection = { entries: [] };
  const relevancePathsDrift: RelevancePathsDriftInspection = { candidates: [], git_available: true };
  // rc.37 NEW-5: personal-layer entries whose relevance_paths match files in
  // the current project — signals layer misclassification (content is
  // project-bound, should be team-layer).
  const personalLayerPathMisclassify: PersonalLayerPathMisclassifyInspection = { candidates: [] };
  // rc.37 NEW-32: scan canonical KB bodies for prompt-injection patterns
  // (legacy entries archived before NEW-31's sanitizer landed).
  const suspiciousKb: SuspiciousKbInspection = { candidates: [] };
  // rc.6 TASK-023 (E6): narrow_too_few (#26). Two-arm check — structural
  // ratio + telemetry silence rate. Info-kind; safe-degrades to "skipped"
  // telemetry when the edit-counter has no fires in the 30d window.
  const narrowTooFew = emptyNarrowTooFewInspection();
  // rc.6 TASK-021 (E3): session-hints cache hygiene (#27). Scans
  // `.fabric/.cache/` for session-hints-*.json files older than 7 days
  // (mtime-based). Info kind — does not bump report status. apply-lint
  // reaps matched files via unlink (no ledger event; local hot-cache).
  const sessionHintsStale = await inspectSessionHintsStale(projectRoot, lintNow);
  const hookCacheWritability = await inspectHookCacheWritability(projectRoot);
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
  const relevanceFieldsMissing = emptyRelevanceFieldsMissingInspection();
  // rc.12 lint #29: skill_md_yaml_invalid. Scans .claude/skills and
  // .codex/skills SKILL.md frontmatter for unquoted ': ' tokens that Codex's
  // strict YAML parser rejects (Claude Code is lenient). Warning kind —
  // manual fix only.
  const skillMdYamlInvalid = await inspectSkillMdYamlInvalid(projectRoot);
  // v2.0.0-rc.23 TASK-014 (F8c): onboard-coverage advisory. Info kind —
  // does not bump report status. Mirrors the fabric onboard-coverage CLI
  // scanner; reports which of the 5 S5 slots are unclaimed and recommends
  // /fabric-archive (whose first-run phase tours the project and proposes
  // pending entries with `onboard_slot: <slot>` set).
  const onboardCoverage = await inspectOnboardCoverage(projectRoot);
  // rc.31 BUG-M3/NEW-4: hooks_wired observability. Reads project-local
  // .claude/settings.json and verifies the three fabric Stop / SessionStart
  // / PreToolUse hooks are present. Warns when .claude/ exists (project uses
  // Claude Code) but hook references are missing — install ran but stopped
  // short, or partial-install left dangling artifacts. Skipped (ok) when
  // there is no .claude/ at all (project doesn't use Claude Code).
  const [hooksWired, hooksRuntime, hooksContentDrift] = await Promise.all([
    inspectHooksWired(projectRoot),
    inspectHooksRuntime(projectRoot),
    inspectHooksContentDrift(projectRoot),
  ]);
  // v2.0.0-rc.37 NEW-20: hooks_runtime closes the gap below hooks_wired —
  // shebang + Node.js syntax validity of each installed .cjs hook file.
  // v2.0.0-rc.37 NEW-27: hooks_content_drift — cross-client sha256 parity
  // for the same hook basename across .claude/.codex/.cursor.
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
  const targetFiles = Object.fromEntries(
    await Promise.all(
      TARGET_FILE_PATHS.map(async (path) => [path, await pathExists(join(projectRoot, path))] as const),
    ),
  );
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
    // v2.0.0-rc.22 TASK-006: baseline filename format. Sits adjacent to
    // the retired local knowledge-layout checks. manual_error
    // kind; resolution is manual file deletion (rc.23 TASK-012 (F8a) removed
    // the baseline-emit pipeline, so no auto-fix exists).
    createBaselineFilenameFormatCheck(t, baselineFilenameFormat),
    createForensicCheck(t, forensic, framework.kind, entryPoints.length),
    // v2.0: removed `createInitContextCheck` — `.fabric/init-context.json`
    // is owned by the AI-side client init skill, not by `fabric install` CLI.
    // The file's absence is a legitimate post-init state when the skill has
    // not yet run, so flagging it as a doctor manual_error misrepresents
    // ownership.
    // v2.2 W5 R4 (agents.meta decolo): `createMetaCheck` (agents_meta_*),
    // `createRuleContentRefCheck` (content_ref_*) and
    // `createKnowledgeTestIndexCheck` (the co-location test-link index) retired
    // — they inspected the project co-location agents.meta.json / its derived
    // cache, which is no longer authoritative (knowledge lives in stores).
    // v2.0 / rc.2: `createRuleSectionsCheck` removed — it parsed v1.x
    // [MANDATORY_INJECTION] sections out of legacy rule files, a structural
    // concept that has no v2 equivalent. rc.4 will introduce a dedicated v2
    // lint suite for the new knowledge frontmatter contract.
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
    createStableIdCollisionCheck(t, stableIdCollision),
    // v2.2 W5 R4 (agents.meta decolo): co-location `counter_desync` retired —
    // replaced by the store-aware `store_counter_drift` (per-store committed
    // counters.json, disk-max FLOOR / KT-DEC-0004). Registered below alongside
    // the scope lint, the other store-scoped doctor check.
    createStoreCounterCheck(t, storeCounterDrift),
    createFilesystemEditFallbackCheck(t, filesystemEditFallback),
    // rc.4 TASK-001: read-side lint checks #16-18. Findings only — mutation
    // + event emission lands in TASK-003 behind --apply-lint.
    createOrphanDemoteCheck(t, orphanDemote),
    createStaleArchiveCheck(t, staleArchive),
    createPendingOverdueCheck(t, pendingOverdue),
    // rc.4 TASK-002: read-side integrity checks #19-20. Stable_id duplicate
    // runs first — it is the most critical integrity break and surfaces ahead
    // of layer-mismatch so a human operator triages the collision before
    // reasoning about counter state. Both require manual triage (rename / move).
    // v2.2 W5 R4: the co-location `index_drift` check (agents.meta#counters vs
    // disk) is retired — its store-aware successor is `store_counter_drift`.
    createStableIdDuplicateCheck(t, stableIdDuplicate),
    createLayerMismatchCheck(t, layerMismatch),
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
    createHookCacheWritabilityCheck(t, hookCacheWritability),
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
    createKnowledgeSummaryOpaqueCheck(
      t,
      // v2.2 全砍 F10 + W5 R4 (agents.meta decolo): the opacity scan is now
      // store-only — canonical knowledge lives in the read-set stores (team +
      // personal), which is exactly the surface this lint must cover. The legacy
      // project agents.meta source is retired, so we feed an empty-but-valid meta
      // (zero project nodes) and let the store-summary fold drive the result.
      inspectKnowledgeSummaryOpaque(EMPTY_META_INSPECTION, storeKnowledgeSummaries),
    ),
    // v2.2 W4 (G-GUARD / A6): scope lint over the read-set stores — missing
    // scope fields / personal-leak-in-shared-store / dangling project ref. Reads
    // only stores (the post-decolo knowledge home); never throws.
    createScopeLintCheck(t, await lintStoreScopes(projectRoot)),
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
      // v2.2 W5 R4 (agents.meta decolo): co-location agents.meta is retired.
      // `metaRevision` now carries the read-set store-corpus revision hash
      // (computeReadSetRevision — the same content fingerprint the recall path
      // uses); `computedMetaRevision` no longer has a separate "recomputed vs
      // stored" axis, so it is null; `ruleCount` counts the store corpus.
      metaRevision: storeRevision,
      computedMetaRevision: null,
      ruleCount: storeKnowledgeSummaries.length,
      eventLedgerPath: eventLedger.path,
      fixableErrorCount: fixableErrors.length,
      manualErrorCount: manualErrors.length,
      warningCount: warnings.length,
      infoCount: infos.length,
      targetFiles,
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
  const ledgerWarnings: DoctorIssue[] = [];

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
      }).catch((error) => {
        ledgerWarnings.push(createLedgerAppendWarning(`bootstrap marker migration for ${path}`, error));
      });
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

  if (before.fixable_errors.some((issue) => issue.code === "event_ledger_missing")) {
    await ensureEventLedger(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "event_ledger_missing"));
  }

  // v2.2 W5 R4 (agents.meta decolo): the co-location reconcile fix-path is
  // retired. It rebuilt the project `.fabric/agents.meta.json` (+ its derived
  // knowledge-test index) from `.fabric/knowledge`, which is no longer the
  // canonical knowledge home (knowledge lives in stores). The checks that drove
  // it — agents_meta_* / content_ref_missing / knowledge_dir_unindexed /
  // knowledge_test_index_* / meta_manually_diverged — and the co-location
  // `counter_desync` are all retired in runDoctorReport.
  //
  // `store_counter_drift` is the store-aware successor to counter_desync /
  // index_drift: it floors each read-set store's committed counters.json at the
  // highest stable_id observed on disk (KT-DEC-0004 — floor never lowers, so the
  // monotonic invariant holds and the next allocation in that store cannot
  // re-mint an existing id).
  if (before.fixable_errors.some((issue) => issue.code === "store_counter_drift")) {
    fixStoreCounters(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "store_counter_drift"));
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

  // v2.2 全砍 F16: flush any buffered metric counters to metrics.jsonl on every
  // `--fix`. The server's 60s flush tick stalls when the MCP process is idle,
  // so a stale metrics.jsonl kept lighting the doctor warning until the user
  // RESTARTED the server. Flushing here gives a non-restart remedy (the dogfood
  // F16 "根因修, 非重启治标"). Best-effort — a flush failure never fails --fix.
  // NOTE: this is the metrics sidecar only. knowledge_context_planned /
  // assistant_turn_observed stay in events.jsonl by design — they carry per-turn
  // cite-audit payload cite-coverage reads, so they are NOT metric leaks
  // (see pending decision turn-event-is-cite-audit-not-metric); their growth is
  // bounded by the rotation above, not by counter-izing them.
  try {
    await flushMetrics(projectRoot);
  } catch {
    // best-effort hygiene — never fail --fix on a metrics flush hiccup.
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
      }).catch((error) => {
        ledgerWarnings.push(createLedgerAppendWarning("stale serve lock cleanup", error));
      });
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
    ledgerWarnings.push(...await fixPromoteLedgerInvariant(projectRoot));
    fixed.push(findIssue(before.warnings, "promote_ledger_invariant_violated"));
  }

  // v2.2 store cutover: draft auto-promote is disabled until it can operate
  // against store-backed knowledge instead of retired project-local entries.

  const report = appendDoctorWarnings(await runDoctorReport(projectRoot), ledgerWarnings);

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
  const ledgerWarnings: DoctorIssue[] = [];

  // Loud-error gate: stable_id_duplicate / layer_mismatch are corruption.
  // Auto-fix could delete data. Abort before any mutation.
  const blockingManual = before.manual_errors.find((issue) =>
    MANUAL_LINT_ERROR_CODES.has(issue.code),
  );
  if (blockingManual !== undefined) {
    return {
      changed: false,
      mutations: [],
      warnings: [],
      manual_errors: before.manual_errors,
      aborted: true,
      abort_reason: `Manual repair required for ${blockingManual.code}: ${blockingManual.message} - apply-lint cannot resolve this safely; triage by hand.`,
      message: `apply-lint aborted: ${blockingManual.code} requires manual repair.`,
      report: before,
    };
  }

  const now = Date.now();

  // v2.2 store cutover: retired dual-root knowledge lints are no longer
  // mutation sources. Do not demote/archive entries from project-local
  // `.fabric/knowledge` or legacy `~/.fabric/knowledge`; store-aware versions
  // must be implemented against ~/.fabric/stores/*/knowledge before re-enabling.
  const orphanDemote = emptyOrphanDemoteInspection(projectRoot);
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

  const staleArchive = emptyStaleArchiveInspection();
  for (const candidate of staleArchive.candidates) {
    mutations.push(await applyStaleArchive(projectRoot, candidate, now));
  }

  // rc.5 TASK-009 (B2): pending auto-archive (>30d). Runs after the canonical
  // demote/archive trio because (a) it has no interaction with lastActiveAt
  // (pending files are not yet in the canonical event stream) and (b) walking
  // pending after the canonical mutation pass keeps the dual-root pending
  // walker independent of any concurrent .fabric/knowledge/<type>/ writes
  // triggered above. One mutation per stale-pending entry, per layer.
  const pendingAutoArchive = emptyPendingAutoArchiveInspection();
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
  const sessionHintsStale = await inspectSessionHintsStale(projectRoot, now);
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
  // v2.2 store-only cutover: relevance back-fill previously walked retired
  // project-local and legacy personal pending roots. Keep the aggregate no-op
  // event below, but do not scan or mutate those roots.
  const relevanceFieldsMissing = emptyRelevanceFieldsMissingInspection();
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
  } catch (error) {
    ledgerWarnings.push(createLedgerAppendWarning("relevance migration aggregate event", error));
  }

  // v2.2 W5 R4 (agents.meta decolo): the co-location `index_drift` apply-lint
  // mutation (bump agents.meta.json#counters) is retired. Its store-aware
  // successor floors every read-set store's committed counters.json at disk-max
  // (KT-DEC-0004 — floor never lowers). One aggregate mutation row per drifted
  // store reconciled.
  const storeCounterDrifts = inspectStoreCounters(projectRoot);
  if (storeCounterDrifts.length > 0) {
    const reconciled = fixStoreCounters(projectRoot);
    const detail = storeCounterDrifts
      .map((d) => `${d.store_alias}:${d.layer}.${d.type} ${d.current} -> ${d.disk_max}`)
      .join("; ");
    mutations.push({
      kind: "knowledge_index_drift",
      path: "stores/*/counters.json",
      detail: detail || "(no store counters processed)",
      applied: reconciled.length > 0,
    });
  }

  contextCache.invalidate("meta_write", projectRoot);

  const after = appendDoctorWarnings(await runDoctorReport(projectRoot), ledgerWarnings);
  const successCount = mutations.filter((m) => m.applied).length;
  const failureCount = mutations.length - successCount;

  return {
    changed: successCount > 0,
    mutations,
    warnings: after.warnings,
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

// v2.2 W3-T5 (F-MATURITY-ENDORSED): the internal demote ladder produces a
// legacy next-tier name (endorsed|draft). When the on-disk entry uses the
// canonical vocabulary (verified|proven), the rewrite must emit the CANONICAL
// equivalent so a canonical file never gets a legacy value spliced into it
// (which would re-introduce the very vocab drift this task fixes). verified is
// the canonical name for the legacy "endorsed" tier; draft is shared.
const LINT_TO_CANONICAL_MATURITY: Record<"endorsed" | "draft", string> = {
  endorsed: "verified",
  draft: "draft",
};

// Pure helper: rewrite the `maturity:` line in a YAML frontmatter block.
// Returns null if the source does not contain a parseable frontmatter with a
// `maturity:` field — caller must handle that defensively. Surgical replace:
// only the maturity line is touched; all other fields preserve their exact
// bytes (per risk note: round-trip preservation matters).
//
// v2.2 W3-T5: the replacement value tracks the SOURCE entry's vocabulary —
// canonical entries (verified/proven) are demoted to canonical names, legacy
// entries (stable/endorsed) to legacy names — so the rewrite is both correct
// for canonical entries (previously a no-op that silently failed) and
// non-regressing for legacy ones.
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
  const matMatch = MATURITY_LINE_PATTERN.exec(block);
  if (matMatch === null) {
    return null;
  }
  const currentValue = matMatch[2];
  const isCanonicalVocab =
    currentValue === "proven" || currentValue === "verified" || currentValue === "draft";
  const replacement = isCanonicalVocab ? LINT_TO_CANONICAL_MATURITY[newMaturity] : newMaturity;
  const replacedBlock = block.replace(
    MATURITY_LINE_PATTERN,
    (line) => line.replace(/(stable|endorsed|draft|verified|proven)/u, replacement),
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

// v2.2 W5 R4 (agents.meta decolo): `applyIndexDriftFix` removed — it bumped the
// retired co-location agents.meta.json#counters. Store counter flooring now goes
// through fixStoreCounters (doctor-store-counters.ts).

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

// v2.2 W5 R4 (agents.meta decolo): `inspectMeta` / `tryBuildRuleMeta` /
// `inspectContentRefs` removed. They read the retired co-location
// `.fabric/agents.meta.json` (+ rebuilt it via buildKnowledgeMeta to compute a
// stale/changed signal). Knowledge now lives in stores; the agents_meta_* /
// content_ref_* checks they fed are retired. The `MetaInspection` type is kept
// (EMPTY_META_INSPECTION + the still-exported inspectKnowledgeSummaryOpaque).

async function inspectEventLedger(projectRoot: string): Promise<EventLedgerInspection> {
  const path = getEventLedgerPath(projectRoot);
  const exists = await pathExists(path);

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

// v2.2 W5 R4 (agents.meta decolo): `inspectKnowledgeTestIndex` removed. The
// `.fabric/.cache/knowledge-test.index.json` was derived from the co-location
// `.fabric/knowledge` via buildKnowledgeMeta (its staleness diffed against a
// rebuilt index, its --fix was reconcileKnowledge) — all retired now that
// knowledge lives in stores.

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

// v2.2 W5 R4 (agents.meta decolo): `createMetaCheck` (agents_meta_*),
// `createRuleContentRefCheck` (content_ref_*) and `createKnowledgeTestIndexCheck`
// removed — they rendered checks over the retired co-location agents.meta.json
// and its derived knowledge-test index. Knowledge lives in stores now.

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
 * Best-effort emits: each append failure is captured as a non-fatal doctor
 * warning. If the ledger is unwritable, the fix degrades gracefully and the
 * operator still sees the audit-trail gap in the mutation report.
 */
async function fixPromoteLedgerInvariant(projectRoot: string): Promise<DoctorIssue[]> {
  const inspection = await inspectPromoteLedgerInvariant(projectRoot);
  if (inspection.violation === null) return [];
  const ledgerWarnings: DoctorIssue[] = [];

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
    }).catch((error) => {
      ledgerWarnings.push(createLedgerAppendWarning("promote ledger invariant proposed backfill", error));
    });
  }

  // Emit (target - promoteStartedCount) synth promote_started events.
  const startedDelta = target - inspection.promoteStartedCount;
  for (let i = 0; i < startedDelta; i++) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_promote_started",
      timestamp: new Date().toISOString(),
      reason: `doctor-fix-backfill:legacy-started-${i}`,
    }).catch((error) => {
      ledgerWarnings.push(createLedgerAppendWarning("promote ledger invariant started backfill", error));
    });
  }
  // No `knowledge_promoted` backfill — promoted is the "leaf" event;
  // emitting more promoted without corresponding files on disk would be
  // misleading.
  return ledgerWarnings;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

function createLedgerAppendWarning(action: string, error: unknown): DoctorIssue {
  const detail = truncateErrorMessage(error);
  return {
    code: "event_ledger_append_failed",
    name: "Event ledger append failed",
    message: `Event ledger append failed during ${action}: ${detail}`,
    actionHint: "Inspect .fabric/events.jsonl and its .lock sidecar, then rerun the doctor mutation command after the ledger is writable.",
  };
}

function appendDoctorWarnings(report: DoctorReport, extraWarnings: DoctorIssue[]): DoctorReport {
  if (extraWarnings.length === 0) {
    return report;
  }
  return {
    ...report,
    status: report.status === "ok" ? "warn" : report.status,
    warnings: [...report.warnings, ...extraWarnings],
  };
}

// v2.2 W5 R4 (agents.meta decolo): `inspectMetaManuallyDiverged` removed (compared co-location agents.meta against disk).
// v2.2 W5 R4 (agents.meta decolo): `inspectKnowledgeDirUnindexed` / `collectMdFilesUnder` / `createKnowledgeDirUnindexedCheck` removed (pure co-location agents.meta-vs-disk check).
// v2.2 W5 R4 (agents.meta decolo): `inspectCounterDesync` / `createCounterDesyncCheck` removed — replaced by store_counter_drift (doctor-store-counters.ts).
// v2.2 W5 R4 (agents.meta decolo): `createMetaManuallyDivergedCheck` removed (co-location agents.meta vs disk).
async function inspectPreexistingRootFiles(projectRoot: string): Promise<PreexistingRootFilesInspection> {
  const candidates = ["CLAUDE.md", "AGENTS.md"];
  const detected: string[] = [];
  for (const name of candidates) {
    if (await pathExists(join(projectRoot, name))) {
      detected.push(name);
    }
  }
  return { detected };
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
  if (match === null) {
    return null;
  }
  // v2.2 W3-T5 (F-MATURITY-ENDORSED): normalize canonical (proven/verified) and
  // legacy (stable/endorsed) names onto the internal LintMaturity ladder so a
  // canonical entry is a first-class orphan_demote candidate.
  return CANONICAL_TO_LINT_MATURITY[match[2] as string] ?? null;
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
  void projectRoot;
  void lastActiveIndex;
  // v2.2 store cutover: legacy project-local `.fabric/knowledge` canonical
  // walkers are retired. Current report/fix paths feed these checks with
  // explicit empty inspections until they are rebuilt against read-set stores.
  // Keep this private generator inert so an accidental old call site cannot
  // reintroduce synchronous full-corpus readdir/read/stat work.
  return;
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

// rc.5 TASK-009 (B2): inlined personal-root resolver mirroring
// resolvePersonalKnowledgeRoot but anchored at `<home>` rather than
// `<home>/.fabric/knowledge` — pending lives at `<home>/.fabric/knowledge/pending`
// so callers want the homedir root and append the suffix themselves.
function resolvePersonalRootForPending(): string {
  return process.env.FABRIC_HOME ?? homedir();
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
// stricter pattern is owned by the retired stable-id integrity lints, which
// deal with identity rather than corpus size.
async function inspectUnderseeded(projectRoot: string): Promise<UnderseededInspection> {
  const threshold = await readUnderseedThresholdFromConfig(projectRoot);
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  let nodeCount = 0;
  for (const typeDir of KNOWLEDGE_CANONICAL_TYPE_DIRS) {
    const dir = join(knowledgeRoot, typeDir);
    let entries;
    try {
      entries = await readdirAsync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        nodeCount += 1;
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
// files older than SESSION_HINTS_STALE_DAYS (7d default). Age is mtime-based
// and day-floor rounded.
// Read-only: candidates are surfaced as info-kind findings; the apply-lint
// arm (applySessionHintsStaleCleanup) does the unlink. Directory absence is
// the common-case empty-result branch (no narrow hook ever fired in this
// workspace) — return zero candidates without an error.
async function inspectSessionHintsStale(
  projectRoot: string,
  now: number,
): Promise<SessionHintsStaleInspection> {
  const cacheDir = join(projectRoot, ".fabric", ".cache");
  let entries;
  try {
    entries = await readdirAsync(cacheDir, { withFileTypes: true });
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
      mtimeMs = (await statAsync(absPath)).mtimeMs;
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

// Best-effort reader for the underseed-threshold override stored in the
// workspace-local `.fabric/fabric-config.json`. Any failure (missing file,
// parse error, non-positive value) returns the default. Mirrors the
// fabric-hint hook's readUnderseedThreshold semantics one-for-one — the two
// surfaces MUST agree on the same threshold for a given workspace.
async function readUnderseedThresholdFromConfig(projectRoot: string): Promise<number> {
  const configPath = join(projectRoot, ".fabric", "fabric-config.json");
  try {
    const raw = await readFile(configPath, "utf8");
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
  const detail = `${first.stable_id} (${first.age_days}d inactive at ${first.path}) -> ${first.archive_path}`;
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

// v2.2 store cutover: relevance-path read-side scanners are disabled until
// they can operate against store-backed knowledge. Keep renderer functions so
// the public doctor report shape stays stable with empty inspections.

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
  const detail = `${first.stable_id} at ${first.path} -> \`${first.dangling_glob}\` (0 matches)`;
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
  const detail = `${first.stable_id} -> ${first.matched_globs.slice(0, 2).join(", ")}`;
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
  const detail = `${first.stable_id} -> ${first.patterns.slice(0, 2).join(", ")}`;
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
        // for personal layer, matching the pending display-path convention.
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

type OnboardCoverageInspection = {
  filled: Record<OnboardSlot, string[]>;
  missing: OnboardSlot[];
  opted_out: string[];
};

async function inspectOnboardCoverage(projectRoot: string): Promise<OnboardCoverageInspection> {
  const filled = {} as Record<OnboardSlot, string[]>;
  for (const slot of ONBOARD_SLOT_NAMES) {
    filled[slot] = [];
  }
  for (const entry of await collectStoreCanonicalEntries(projectRoot)) {
    const slot = readFrontmatterScalar(entry.body, "onboard_slot");
    if (slot === undefined) continue;
    if (!(ONBOARD_SLOT_NAMES as readonly string[]).includes(slot)) continue;
    filled[slot as OnboardSlot].push(entry.qualifiedId);
  }
  for (const slot of ONBOARD_SLOT_NAMES) {
    filled[slot].sort();
  }
  const optedOut = await readOnboardOptedOut(projectRoot);
  const missing: OnboardSlot[] = ONBOARD_SLOT_NAMES.filter((slot) => {
    if (filled[slot].length > 0) return false;
    if (optedOut.includes(slot)) return false;
    return true;
  });
  return { filled, missing, opted_out: optedOut };
}

async function readOnboardOptedOut(projectRoot: string): Promise<string[]> {
  const path = join(projectRoot, ".fabric", "fabric-config.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
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
// Store-only cutover: the legacy dual-root canonical iterator is retired.
// Enrichment now walks mounted store read-set entries via
// collectStoreCanonicalEntries, then parses the stable_id token from each
// canonical filename for compatibility with the old enrichment report shape.
// ---------------------------------------------------------------------------

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
  file: string;
  // Display path — project-relative POSIX for team layer; `~/.fabric/...`
  // form for personal layer (matches PERSONAL_CONTENT_REF_PREFIX in
  // knowledge-meta-builder.ts so messages render consistently with the rest of
  // the v2.0 surface).
  displayPath: string;
  parsed: ParsedCanonicalFilename;
};

// Generator over canonical knowledge filenames in the project's resolved
// store read-set. Yields only entries whose filename parses to a stable_id
// token — other files (legacy-named, README, etc.) are silently skipped.
async function* iterateCanonicalFilenames(projectRoot: string): AsyncGenerator<CanonicalFilenameVisit> {
  for (const entry of await collectStoreCanonicalEntries(projectRoot)) {
    if (!(KNOWLEDGE_CANONICAL_TYPE_DIRS as readonly string[]).includes(entry.type)) {
      continue;
    }
    const filename = posix.basename(normalizePath(entry.file));
    const parsed = parseStableIdFromCanonicalFilename(filename);
    if (parsed === null) {
      continue;
    }
    const displayPath = `store:${entry.qualifiedId}`;
    yield {
      layer: entry.layer,
      type: entry.type as typeof KNOWLEDGE_CANONICAL_TYPE_DIRS[number],
      filename,
      file: entry.file,
      displayPath,
      parsed,
    };
  }
}

// v2.2 W5 R4 (agents.meta decolo): `inspectIndexDrift` removed — its store-aware successor is inspectStoreCounters (doctor-store-counters.ts).

// v2.2 W5 R4 (agents.meta decolo): `createIndexDriftCheck` removed (co-location agents.meta#counters drift).

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
    if (!(await pathExists(abs))) {
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
  if (!(await pathExists(snapshotPath))) {
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
  const hasProjectRules = await pathExists(projectRulesPath);
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
    if (!(await pathExists(abs))) {
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
  if (await pathExists(claudeMdPath)) {
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
  if (!(await pathExists(settingsPath))) {
    return;
  }

  let settings: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
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

// v2.2 W5 R4 (agents.meta decolo): `fixCounterDesync` removed — store counters floor via fixStoreCounters (doctor-store-counters.ts).

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
// W4-15 (ISS-018): cite-coverage / cite-audit-rollup / archive-history domain
// moved to ./doctor-cite-coverage.ts. Imported for the runDoctor* orchestrators
// (rollup/purge run inside runDoctorReport) and re-exported to preserve the
// package's public surface (index.ts + cli import these from doctor.js).
import {
  ensureCitePolicyActivatedMarker,
  ensureCiteContractPolicyActivatedMarker,
  runDoctorCiteCoverage,
  rollupCiteAuditIfNeeded,
  purgeEmptyShellTurnsIfNeeded,
  runDoctorArchiveHistory,
  runDoctorHistoryAll,
  sumFoldedTurnCounters,
} from "./doctor-cite-coverage.js";
export {
  ensureCitePolicyActivatedMarker,
  ensureCiteContractPolicyActivatedMarker,
  runDoctorCiteCoverage,
  rollupCiteAuditIfNeeded,
  purgeEmptyShellTurnsIfNeeded,
  runDoctorArchiveHistory,
  runDoctorHistoryAll,
};
export type {
  CiteContractMetrics,
  CiteLayerTypeBreakdown,
  CiteCoverageReport,
  CiteRollupResult,
  EmptyShellPurgeResult,
  ArchiveHistoryEntry,
  ArchiveHistoryReport,
  HistoryDayRow,
  HistoryAllReport,
} from "./doctor-cite-coverage.js";

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

export function normalizePath(path: string): string {
  return posix.normalize(path.split("\\").join("/"));
}

async function collectEntryPoints(root: string): Promise<EntryPoint[]> {
  let rootStat;
  try {
    rootStat = await statAsync(root);
  } catch {
    return [];
  }
  if (!rootStat.isDirectory()) {
    return [];
  }

  const entries: EntryPoint[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of await readdirAsync(current, { withFileTypes: true })) {
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
//   * mounted store `knowledge/{decisions,pitfalls,guidelines,models,processes}/*.md`
//     entries in the project's resolved read-set
//   * `pending/` and archive history are deliberately skipped — pending entries
//     are still in flight (the Skill owns their schema) and archived entries
//     are immutable history.
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

  for await (const visit of iterateCanonicalFilenames(projectRoot)) {
    const absPath = visit.file;
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
  // ISS-001: also force-quote on ANY control char (newline/CR/tab). An internal
  // newline with no other special char would otherwise emit bare and break the
  // single-line frontmatter structure (injection surface). When quoting, escape
  // backslash first, then quote, then collapse control chars to YAML escapes.
  if (
    /[:#"'\\[\]{},&*!|>%@`]/.test(value) ||
    /^[\s-?]/.test(value) ||
    /\s$/.test(value) ||
    /[\n\r\t]/.test(value)
  ) {
    return `"${value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")}"`;
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
