import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, posix, resolve } from "node:path";

import {
  agentsMetaSchema,
  AgentsMetaCountersSchema,
  forensicReportSchema,
  parseKnowledgeId,
  knowledgeTestIndexSchema,
  type AgentsMeta,
  type AgentsMetaCounters,
  type ForensicReport,
  type KnowledgeTestIndex,
} from "@fenglimg/fabric-shared";
import { detectFramework } from "@fenglimg/fabric-shared/node";

import { contextCache } from "../cache.js";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { ensureParentDirectory, getEventLedgerPath, sha256 } from "./_shared.js";
import { buildKnowledgeMeta, isSameKnowledgeTestIndex, writeKnowledgeMeta } from "./knowledge-meta-builder.js";
import { appendEventLedgerEvent, readEventLedger, truncateLedgerToLastNewline } from "./event-ledger.js";
import { reconcileKnowledge } from "./knowledge-sync.js";

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
  | "knowledge_index_drift";

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Regex extracting the `maturity:` value from YAML frontmatter. Mirrors
// extractKnowledgeFrontmatterId; we keep parsing line-based to avoid pulling
// in a YAML dependency for a handful of fields.
const MATURITY_LINE_PATTERN = /^maturity:\s*("?)(stable|endorsed|draft)\1\s*$/mu;

// Regex extracting `created_at:` (ISO 8601 datetime) from YAML frontmatter.
const CREATED_AT_LINE_PATTERN = /^created_at:\s*("?)([^"\n]+)\1\s*$/mu;

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
// CLI), not by `fabric init` CLI. If the skill never ran the file is
// legitimately absent and doctor must not flag it as a state issue.
const TARGET_FILE_PATHS = [
  ".fabric/forensic.json",
  ".fabric/agents.meta.json",
  ".fabric/.cache/knowledge-test.index.json",
  ".fabric/events.jsonl",
  ".fabric/knowledge",
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
  ] = await Promise.all([
    inspectForensic(projectRoot),
    inspectMeta(projectRoot),
    inspectEventLedger(projectRoot),
    inspectKnowledgeTestIndex(projectRoot),
  ]);
  const mcpConfigInWrongFile = inspectMcpConfigInWrongFile(projectRoot);
  const metaManuallyDiverged = await inspectMetaManuallyDiverged(projectRoot);
  const knowledgeDirUnindexed = inspectKnowledgeDirUnindexed(projectRoot, meta);
  const knowledgeDirMissing = inspectKnowledgeDirMissing(projectRoot);
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
  const checks: DoctorCheck[] = [
    createBootstrapAnchorCheck(bootstrapAnchor),
    createKnowledgeDirMissingCheck(knowledgeDirMissing),
    createForensicCheck(forensic, framework.kind, entryPoints.length),
    // v2.0: removed `createInitContextCheck` — `.fabric/init-context.json`
    // is owned by the AI-side client init skill, not by `fabric init` CLI.
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

  if (
    before.fixable_errors.some((issue) =>
      [
        "agents_meta_missing",
        "agents_meta_stale",
        "knowledge_test_index_missing",
        "knowledge_test_index_stale",
        "content_ref_missing",
        "knowledge_dir_unindexed",
      ].includes(issue.code),
    )
  ) {
    // D22: doctor's role is now consistency repairer, not baseline promoter.
    // reconcileKnowledge rewrites agents.meta.json from disk ground-truth and emits
    // a 'meta_reconciled' ledger event (trigger='doctor').
    // content_ref_missing: reconcile drops stale refs that no longer have a backing file.
    // knowledge_dir_unindexed: reconcile incorporates any .md files not yet in the index.
    await reconcileKnowledge(projectRoot, { trigger: "doctor" });
    for (const issue of before.fixable_errors.filter((candidate) =>
      [
        "agents_meta_missing",
        "agents_meta_stale",
        "knowledge_test_index_missing",
        "knowledge_test_index_stale",
        "content_ref_missing",
        "knowledge_dir_unindexed",
      ].includes(candidate.code),
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
//   * `lint:pending_overdue` (warning kind): informational only — humans
//     triage via the fabric-review Skill; no mutation path.
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
// by the AI-side client init skill, not by `fabric init` CLI. Its absence
// after `fab init` is a legitimate "skill has not run yet" state, not a
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

function createBootstrapAnchorCheck(inspection: BootstrapAnchorInspection): DoctorCheck {
  // v2.0: bootstrap is anchored at the repo root via AGENTS.md or CLAUDE.md.
  // Either one (or both) is sufficient; missing both is a fixable_error in
  // the sense that `fabric init` is the canonical remediation (we do not
  // auto-write the anchor file from doctor --fix).
  if (!inspection.hasAgentsMd && !inspection.hasClaudeMd) {
    return issueCheck(
      "Bootstrap anchor",
      "error",
      "fixable_error",
      "bootstrap_anchor_missing",
      "Neither AGENTS.md nor CLAUDE.md exists at the repo root. Fabric requires a bootstrap anchor file at the project root.",
      "Run `fabric init` to generate the AGENTS.md / CLAUDE.md bootstrap anchor at the repo root.",
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
      "Run `fab init` to regenerate .fabric/forensic.json.",
    );
  }
  if (!forensic.valid) {
    return issueCheck("Scan evidence", "error", "manual_error", "forensic_invalid", forensic.error ?? ".fabric/forensic.json is invalid.", "Run `fab init` to regenerate .fabric/forensic.json.");
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
    return issueCheck(
      "Agents metadata",
      "error",
      "fixable_error",
      "agents_meta_stale",
      `.fabric/agents.meta.json revision ${meta.revision} does not match .fabric/knowledge derived revision ${meta.computedRevision ?? "<unknown>"}.`,
      "Run `fab doctor --fix` to reconcile agents.meta.json with the current knowledge files.",
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
      `.claude/settings.json contains mcpServers.fabric — this file is for hooks/permissions only. Run --fix to remove it, then re-run fab init to write .mcp.json.`,
      "Run `fab doctor --fix` to remove mcpServers.fabric from .claude/settings.json, then run `fab init` to write .mcp.json.",
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

function inspectPendingOverdue(
  projectRoot: string,
  now: number,
): PendingOverdueInspection {
  const pendingRoot = join(projectRoot, ".fabric", "knowledge", "pending");
  const candidates: PendingOverdueCandidate[] = [];
  if (!existsSync(pendingRoot)) {
    return { candidates };
  }
  let typeDirs: string[] = [];
  try {
    typeDirs = readdirSync(pendingRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return { candidates };
  }

  for (const typeDir of typeDirs) {
    const dir = join(pendingRoot, typeDir);
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
        // Unreadable: continue (other checks surface IO errors).
        continue;
      }
      const createdAt = extractKnowledgeFrontmatterCreatedAt(source);
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(absPath).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      // Precedence: frontmatter.created_at when present, else mtime.
      const referenceMs = createdAt ?? mtimeMs;
      if (referenceMs === 0) {
        // Both missing → flag for human triage per risk note.
        const relPath = posix.join(
          ".fabric/knowledge/pending",
          typeDir,
          entry.name,
        );
        candidates.push({ path: relPath, age_days: PENDING_OVERDUE_THRESHOLD_DAYS + 1 });
        continue;
      }
      const ageDays = Math.floor((now - referenceMs) / MS_PER_DAY);
      if (ageDays <= PENDING_OVERDUE_THRESHOLD_DAYS) {
        continue;
      }
      const stableId = extractKnowledgeFrontmatterId(source) ?? undefined;
      const relPath = posix.join(
        ".fabric/knowledge/pending",
        typeDir,
        entry.name,
      );
      candidates.push({
        stable_id: stableId,
        path: relPath,
        age_days: ageDays,
      });
    }
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates };
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
