import { access, readFile, readdir as readdirAsync, rename, stat as statAsync, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, posix, sep } from "node:path";

import {
  createTranslator,
  forensicReportSchema,
  resolveBootstrapCanonical,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
  ONBOARD_SLOT_NAMES,
  type EventLedgerEvent,
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
import { readPayloadLimits } from "../config-loader.js";

import { contextCache } from "../cache.js";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { ensureParentDirectory, getEventLedgerPath } from "./_shared.js";
import {
  inspectGlobalCliVersion,
  type GlobalCliInspection,
} from "./doctor-global-cli.js";
import { computeDoctorHealth } from "./doctor-health.js";
import type {
  DoctorStatus,
  DoctorIssueKind,
  DoctorCheck,
  DoctorIssue,
  DoctorPayloadLimits,
  DoctorSummary,
  DoctorReport,
  DoctorFixReport,

  LintMaturity,
  EnrichDescriptionsMode,
  EnrichDescriptionsCandidate,
  EnrichDescriptionsReport,
} from "./doctor-types.js";
import { normalizePath, normalizeTarget, isValidJsonLine, createFixMessage } from "./doctor-path.js";
import { synthesizeMustReadIfStub, yamlQuoteIfNeeded } from "./doctor-frontmatter-helpers.js";
import {
  DEFAULT_UNDERSEED_NODE_THRESHOLD,
  MS_PER_DAY,
  type EventLedgerInspection,
  type ForensicInspection,
  type OnboardCoverageInspection,
  type PreexistingRootFilesInspection,
  type PromoteLedgerInvariantInspection,
  type StaleServeLockInspection,
  type UnderseededInspection,
} from "./doctor-core-checks.js";
import {
  buildDoctorChecks,
} from "./doctor-check-registry.js";
import {
  inspectDraftBacklogFromCanonical,
  inspectEmptyTagsFromCanonical,
} from "./doctor-knowledge-hygiene.js";
import {
  runDoctorBodyReadMisfireCheck,
} from "./doctor-body-read-misfire.js";
import {
  inspectCiteGoodhart,
} from "./doctor-cite-goodhart.js";
import {
  inspectDriftUnconsumed,
} from "./doctor-drift-unconsumed.js";
import {
  runDoctorApplyLintWithDeps,
  type DoctorApplyLintReport,
} from "./doctor-apply-lint.js";
import {
  applySessionHintsStaleCleanup,
  inspectSessionHintsStale,
  SESSION_HINTS_STALE_DAYS,
} from "./doctor-session-hints-stale.js";
import {
  inspectStoreStableIdIntegrity,
} from "./doctor-stable-id-collision.js";
import {
  inspectStoreRelevancePaths,
} from "./doctor-relevance-paths.js";
import {
  inspectBroadIndexDrift,
} from "./doctor-broad-index.js";
import {
  inspectStoreKnowledgeAge,
} from "./doctor-knowledge-age.js";
import {
  inspectStoreKnowledgePromotion,
} from "./doctor-knowledge-promotion.js";
import {
  inspectStoreBroadReviewRecheck,
} from "./doctor-knowledge-review-recheck.js";
import {
  collectStoreCanonicalEntries,
  collectStoreKnowledgeSummaries,
  computeReadSetRevision,
} from "./cross-store-recall.js";
import { lintStoreScopes } from "./doctor-scope-lint.js";
import { inspectBodyAltitude } from "./doctor-body-altitude.js";
import { inspectBodyDedup, fixBodyDedup } from "./doctor-body-dedup.js";
// v2.3.0-rc.11: stray_fabric_dir_detected — walker + rescue-rename fix arm for
// residue `.fabric/` dirs left by pre-rc.10 hooks / pre-rc.11 server-side
// resolveProjectRoot when a subprocess cwd landed in a subdirectory.
import {
  detectStrayFabricDirs,
  fixStrayFabricDirs,
} from "./doctor-stray-fabric-dir.js";
import { fixLegacyFabricCacheDirs } from "./doctor-legacy-fabric-cache.js";
import {
  fixStoreCounters,
  inspectStoreCounters,
} from "./doctor-store-counters.js";
import {
  fixStoreOrphans,
  inspectStoreOrphans,
} from "./doctor-store-orphan.js";
import {
  fixProjectRegistryDrift,
  inspectProjectRegistryDrift,
} from "./doctor-project-registry-drift.js";
import {
  appendEventLedgerEvent,
  readEventLedger,
  rotateEventLedgerIfNeeded,
  truncateLedgerToLastNewline,
} from "./event-ledger.js";
import { flushMetrics } from "./metrics.js";
import { isAlive, readLockState } from "./legacy-serve-lock-probe.js";
import {
  inspectEventsJsonlGates,
} from "./events-jsonl-gates.js";
import {
  inspectSkillContract,
  inspectSkillDescription,
  inspectSkillMdYamlInvalid,
  inspectSkillRefMirror,
  inspectSkillTokenBudget,
} from "./doctor-skill-lints.js";
import {
  inspectRetiredReferences,
} from "./doctor-retired-references-lint.js";
import {
  inspectHookCacheWritability,
  inspectHooksContentDrift,
  inspectHooksRuntime,
  inspectHooksWired,
} from "./doctor-hooks-lints.js";
import {
  inspectBootstrapAnchor,
  inspectL1BootstrapSnapshotDrift,
  inspectL2ManagedBlockDrift,
} from "./doctor-bootstrap-lints.js";

export { inspectL1BootstrapSnapshotDrift } from "./doctor-bootstrap-lints.js";
export {
  createGlobalCliVersionCheck,
  inspectGlobalCliVersion,
} from "./doctor-global-cli.js";
export type { GlobalCliInspection } from "./doctor-global-cli.js";
export { computeDoctorHealth, checkBacklogAge, renderBacklogAgeLine } from "./doctor-health.js";
export type { DoctorHealth, BacklogAgeMetric } from "./doctor-health.js";
export {
  createKnowledgeSummaryOpaqueCheck,
  inspectKnowledgeSummaryOpaque,
} from "./doctor-summary-opaque.js";
export type { KnowledgeSummaryOpaqueInspection } from "./doctor-summary-opaque.js";
export { createScopeLintCheck } from "./doctor-scope-lint.js";
export { detectUnboundProject } from "./doctor-unbound-project.js";
export type { UnboundProjectViolation } from "./doctor-unbound-project.js";
export { detectWriteRouteUnbound } from "./doctor-write-route-lint.js";
export type { WriteRouteViolation } from "./doctor-write-route-lint.js";
export { detectStrayFabricDirs, fixStrayFabricDirs } from "./doctor-stray-fabric-dir.js";
export { createStoreCounterCheck } from "./doctor-store-counters.js";
export { runDoctorBodyReadMisfireCheck } from "./doctor-body-read-misfire.js";

// Doctor W1: public report/issue types live in doctor-types.ts (re-exported for API stability).
export type {
  DoctorStatus,
  DoctorIssueKind,
  DoctorCheck,
  DoctorIssue,
  DoctorPayloadLimits,
  DoctorSummary,
  DoctorReport,
  DoctorFixReport,
  MetaInspection,
  LintMaturity,
  EnrichDescriptionsMode,
  EnrichDescriptionsCandidate,
  EnrichDescriptionsReport,
} from "./doctor-types.js";
export type {
  DoctorApplyLintMutationKind,
  DoctorApplyLintMutation,
  DoctorApplyLintReport,
} from "./doctor-apply-lint.js";
export { normalizePath, normalizeTarget, isValidJsonLine, createFixMessage } from "./doctor-path.js";

type EntryPoint = DoctorSummary["entryPoints"][number];

type CanonicalLayer = "team" | "personal";

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

// Knowledge subdirectories scanned by legacy filesystem-edit fallback checks.
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

// Ordered check builders — order is a public contract (i18n snapshots + doctor-check-order test).
// Append only at the end unless intentionally changing order with snapshot updates.

function finalizeDoctorReport(input: {
  projectRoot: string;
  framework: { kind: string; version: string; subkind: string };
  entryPoints: Array<{ path: string; reason: string }>;
  storeRevision: string | null;
  storeKnowledgeSummariesLength: number;
  eventLedgerPath: string;
  targetFiles: Record<string, boolean>;
  checks: DoctorCheck[];
}): DoctorReport {
  const {
    projectRoot,
    framework,
    entryPoints,
    storeRevision,
    storeKnowledgeSummariesLength,
    eventLedgerPath,
    targetFiles,
    checks,
  } = input;
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
      metaRevision: storeRevision,
      computedMetaRevision: null,
      ruleCount: storeKnowledgeSummariesLength,
      eventLedgerPath,
      fixableErrorCount: fixableErrors.length,
      manualErrorCount: manualErrors.length,
      warningCount: warnings.length,
      infoCount: infos.length,
      targetFiles,
      payload_limits: resolvePayloadLimits(projectRoot),
      health: computeDoctorHealth(manualErrors.length, fixableErrors.length, warnings.length),
    },
  };
}

export async function runDoctorReport(target: string): Promise<DoctorReport> {
  // Phase 1 — collect inspections (I/O + derived state).
  const projectRoot = normalizeTarget(target);
  const t = createTranslator(resolveFabricLocale(projectRoot));
  const framework = detectFramework(projectRoot);
  const entryPoints = await collectEntryPoints(projectRoot);
  const [
    forensic,
    eventLedger,
    eventsJsonlGates,
    bootstrapAnchor,
    l1BootstrapSnapshotDrift,
    l2ManagedBlockDrift,
    skillRefMirror,
    skillTokenBudget,
    skillDescription,
    skillContract,
    retiredReferences,
  ] = await Promise.all([
    inspectForensic(projectRoot),
    inspectEventLedger(projectRoot),
    // v2.0.0-rc.37 Wave B (B5): composite hard-gate inspection (G7 size /
    // G8 metric leak / G9 metrics stale / G10 rotation overdue).
    inspectEventsJsonlGates(projectRoot),
    inspectBootstrapAnchor(projectRoot),
    // v2.0.0-rc.19 TASK-005: L1 + L2 byte-level drift detection. Both are
    // I/O-bound (small file reads + buffer compare) so they live in the same
    // Promise.all block as the other bootstrap inspections.
    inspectL1BootstrapSnapshotDrift(projectRoot),
    inspectL2ManagedBlockDrift(projectRoot),
    inspectSkillRefMirror(projectRoot),
    inspectSkillTokenBudget(projectRoot),
    inspectSkillDescription(projectRoot),
    inspectSkillContract(projectRoot),
    // ux-w2-2: registry-driven stale-pointer scan over the agent-consumed
    // surface (bootstrap + SKILL.md + installed hooks).
    inspectRetiredReferences(projectRoot),
  ]);
  // v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart pattern detection. Async
  // (reads event ledger); placed after the sync inspections so the await
  // doesn't gate them.
  const citeGoodhart = await inspectCiteGoodhart(projectRoot);
  const storeKnowledgeSummaries = await collectStoreKnowledgeSummaries(projectRoot);
  const scopeLint = await lintStoreScopes(projectRoot);
  const storeRevision = await computeReadSetRevision(projectRoot);
  // v2.0.0-rc.33 W4-A4 + main W8: draft/empty-tags from store canonical corpus.
  const storeCanonicalForHygiene = await collectStoreCanonicalEntries(projectRoot);
  const draftBacklog = inspectDraftBacklogFromCanonical(storeCanonicalForHygiene);
  const knowledgeTagsEmpty = inspectEmptyTagsFromCanonical(storeCanonicalForHygiene);
  // rc.36 TASK-09 (P1-NEW1): drift_detected events without paired demote
  // in the last 30 days — drift detection runs but no consumption pipeline.
  const driftUnconsumed = await inspectDriftUnconsumed(projectRoot);
  // Per-store monotonic stable_id counters (KT-DEC-0004); disk-max FLOOR.
  const storeCounterDrift = inspectStoreCounters(projectRoot);
  // store-onboarding grill (Q5): on-disk store dirs absent from the registry
  // (orphans). Global-scoped (reads ~/.fabric/stores, not the project); never
  // throws. `--fix` adopts them (re-register, never delete).
  const storeOrphans = inspectStoreOrphans();
  // W2 (F-003): project-registry drift — reconcile the store's committed
  // projects.json against the on-disk knowledge/projects/<id>/ folder tree
  // (orphan-folder / unregistered-write / empty-folder; ghost-registration
  // emits nothing per DA-05). Read-only store walk; never throws.
  const projectRegistryDrift = await inspectProjectRegistryDrift(projectRoot);
  // v2.2 Goal B (G-INTEGRITY): store-aware stable_id collision + layer mismatch.
  // Single walk of the read-set store canonical corpus; never throws (degrades
  // to no-findings when no store is mounted).
  const stableIdIntegrity = await inspectStoreStableIdIntegrity(projectRoot);
  // v2.2 Goal B (G-RELEVANCE): store relevance_paths hygiene — dangling globs
  // (anchor → 0 workspace files) + drift (narrow anchors gone quiet in git).
  // Single store-corpus walk; the drift arm shells out to `git log` and
  // degrades to ok when git is unavailable.
  const relevancePaths = await inspectStoreRelevancePaths(projectRoot);
  // W4-2 (KT-DEC-0028): broad-index-drift — per-store broad entry count vs the
  // broad_index_backstop (warn at 80%, points to fabric-audit before the
  // SessionStart banner silently truncates).
  const broadIndexDrift = await inspectBroadIndexDrift(projectRoot);
  // Shared timestamp for the read-side hygiene inspections below (knowledge
  // decay age + session-hints cache age + stale serve-lock age).
  const lintNow = Date.now();
  // v2.2 Goal B (G-AGE): knowledge decay — orphan_demote (inactivity > maturity
  // threshold) + stale_archive (terminal draft quiet beyond demote+90d). Age is
  // measured from each entry's last knowledge event (events.jsonl, store-agnostic
  // / KT-DEC-0023), so the last-active index is built once and injected.
  const lastActiveIndex = await buildLastActiveIndex(projectRoot);
  const knowledgeAge = await inspectStoreKnowledgeAge(projectRoot, lintNow, lastActiveIndex);
  // v2.2 C1: knowledge PROMOTION (growth counterpart of the decay lints).
  // Surfaces verified entries with `related` in-degree ≥ threshold as proven
  // candidates (decisions/importance-is-maturity-not-usage-count: in-degree is
  // the one importance proxy that is neither usage-blind to broad nor
  // self-reinforcing). Detection-only — promotion judgment is fabric-review's.
  const knowledgePromotion = await inspectStoreKnowledgePromotion(projectRoot);
  // v2.2 C1: broad REVIEW-RECHECK (the follow-up to broad's age-decay exemption).
  // broad is usage-blind so it is exempt from orphan_demote; instead its
  // continued validity is checked against the review-confirmation clock
  // (last_review_confirmed_at, stamped at approve/modify). Surfaces broad entries
  // unconfirmed beyond the threshold as a non-blocking recheck nudge (info kind).
  const broadReviewRecheck = await inspectStoreBroadReviewRecheck(projectRoot, lintNow);
  const preexistingRootFiles = await inspectPreexistingRootFiles(projectRoot);
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
  // rc.6 TASK-021 (E3): session-hints cache hygiene (#27). Scans
  // `.fabric/.cache/` for session-hints-*.json files older than 7 days
  // (mtime-based). Info kind — does not bump report status. apply-lint
  // reaps matched files via unlink (no ledger event; local hot-cache).
  const sessionHintsStale = await inspectSessionHintsStale(projectRoot, lintNow);
  // ISS-20260711-221: wire body_read misfire into main doctor report.
  const bodyReadMisfire = await runDoctorBodyReadMisfireCheck(projectRoot);
  const bodyAltitude = await inspectBodyAltitude(projectRoot);
  const bodyDedup = await inspectBodyDedup(projectRoot);
  const hookCacheWritability = await inspectHookCacheWritability(projectRoot);
  // rc.23 TASK-010 (e): stale .fabric/.serve.lock advisory. Read-side only —
  // mutation (unlink + ledger event) is owned by runDoctorFix. Re-uses the
  // same lintNow timestamp as the other read-side hygiene inspections so a
  // single doctor run reports an internally-consistent set of age figures.
  const staleServeLock = inspectStaleServeLock(projectRoot, lintNow);
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
  // for the same hook basename across .claude/.codex.
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
  // Phase 2 — assemble checks (pure relative to inspections above).
  const checks = buildDoctorChecks({
    t,
    projectRoot,
    storeKnowledgeSummaries,
    scopeLint,
    framework,
    entryPoints,
    bootstrapAnchor,
    l1BootstrapSnapshotDrift,
    l2ManagedBlockDrift,
    forensic,
    eventLedger,
    eventsJsonlGates,
    skillRefMirror,
    skillTokenBudget,
    skillDescription,
    skillContract,
    skillMdYamlInvalid,
    retiredReferences,
    citeGoodhart,
    draftBacklog,
    knowledgeTagsEmpty,
    driftUnconsumed,
    bodyReadMisfire,
    bodyAltitude,
    bodyDedup,
    storeCounterDrift,
    storeOrphans,
    projectRegistryDrift,
    stableIdIntegrity,
    relevancePaths,
    broadIndexDrift,
    knowledgeAge,
    knowledgePromotion,
    broadReviewRecheck,
    underseeded,
    sessionHintsStale,
    hookCacheWritability,
    staleServeLock,
    onboardCoverage,
    promoteLedgerInvariant,
    globalCliVersion,
    preexistingRootFiles,
    hooksWired,
    hooksRuntime,
    hooksContentDrift,
  });

// Phase 3 — aggregate issues + summary + health.
  return finalizeDoctorReport({
    projectRoot,
    framework,
    entryPoints,
    storeRevision,
    storeKnowledgeSummariesLength: storeKnowledgeSummaries.length,
    eventLedgerPath: eventLedger.path,
    targetFiles,
    checks,
  });
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
  const failed: DoctorIssue[] = [];
  const ledgerWarnings: DoctorIssue[] = [];

  // v2.0.0-rc.19 bootstrap-consolidation TASK-005: L1 drift fix MUST run before
  // L2 fix — L2's expectedBody is computed from the on-disk `.fabric/AGENTS.md`
  // snapshot, so restoring L1 to canonical first guarantees L2's rewrite
  // sources the correct body. Idempotent: `atomicWriteText` with content
  // byte-equal to current state still writes (acceptable — re-runs with no
  // L1 drift entry skip this whole block via the .some() guard).
  if (before.fixable_errors.some((issue) => issue.code === "bootstrap_snapshot_drift")) {
    const snapshotPath = join(projectRoot, ".fabric", "AGENTS.md");
    await ensureParentDirectory(snapshotPath);
    // Content-layer i18n: --fix restores the snapshot in the machine's current
    // language (resolveGlobalLocale, via resolveBootstrapCanonical), matching
    // what `fabric install` would write — and what the L1 drift inspector
    // accepts for the current locale.
    await atomicWriteText(snapshotPath, resolveBootstrapCanonical());
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

  // Floor each read-set store's counters.json at the highest on-disk stable_id
  // (KT-DEC-0004 — floor never lowers, so next allocation cannot re-mint).
  if (before.fixable_errors.some((issue) => issue.code === "store_counter_drift")) {
    fixStoreCounters(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "store_counter_drift"));
    contextCache.invalidate("meta_write", projectRoot);
  }

  // store-onboarding grill (Q5): adopt on-disk orphan stores into the registry.
  // A WARNING (non-blocking), so it lives in before.warnings, not fixable_errors;
  // --fix re-registers each (rescue-before-delete — the on-disk tree is never
  // touched).
  if (before.warnings.some((issue) => issue.code === "store_orphan")) {
    const adopted = fixStoreOrphans();
    if (adopted.length > 0) {
      fixed.push(findIssue(before.warnings, "store_orphan"));
    }
  }

  // rc.11 stray_fabric_dir_detected — rename residue `.fabric/` dirs left by
  // pre-rc.10 hooks / pre-rc.11 server-side resolveProjectRoot. Rescue-before-
  // delete (KT-PIT-0016): each stray becomes `<path>.stale-<timestamp>` for
  // ops review, never rm. Only claim `fixed` when at least one rename lands
  // — a walker re-run drops any that meanwhile disappeared (idempotent).
  if (before.warnings.some((issue) => issue.code === "stray_fabric_dir_detected")) {
    const strays = detectStrayFabricDirs(projectRoot);
    if (strays.length > 0) {
      const results = await fixStrayFabricDirs(strays);
      if (results.some((r) => r.ok)) {
        fixed.push(findIssue(before.warnings, "stray_fabric_dir_detected"));
      }
    }
  }

  // legacy_fabric_cache_dir_detected — the pre-unify-fabric-cache-dir
  // `.fabric/cache/{bm25,vectors}` snapshots. Fix is an idempotent rename to
  // `.fabric/.cache/{bm25,vectors}`, preserving every cached BM25 / embedding
  // (no re-embed cost). Lazy migration in plan-context / vector-retrieval
  // catches most cases; this arm is the catch-up for projects that haven't
  // triggered recall since the upgrade.
  if (before.warnings.some((issue) => issue.code === "legacy_fabric_cache_dir_detected")) {
    const result = fixLegacyFabricCacheDirs(projectRoot);
    if (result.ok && result.before.length > 0) {
      fixed.push(findIssue(before.warnings, "legacy_fabric_cache_dir_detected"));
    }
  }

  // W2 (F-003): project-registry drift. `project_registry_drift` surfaces as a
  // manual_error (unregistered-write), warning (orphan-folder) or info
  // (empty-folder) depending on the most-severe finding, so scan all three
  // buckets. `--fix` rescue-registers orphan/unregistered folders (addStoreProject
  // — NEVER deletes a non-empty folder) and prunes ONLY genuinely-empty
  // registered folders. Re-inspects fresh on-disk state internally.
  const registryDriftFound =
    before.manual_errors.some((issue) => issue.code === "project_registry_drift") ||
    before.warnings.some((issue) => issue.code === "project_registry_drift") ||
    before.infos.some((issue) => issue.code === "project_registry_drift");
  if (registryDriftFound) {
    const result = await fixProjectRegistryDrift(projectRoot);
    if (result.registered.length > 0 || result.pruned.length > 0) {
      fixed.push(
        findIssue(
          [...before.manual_errors, ...before.warnings, ...before.infos],
          "project_registry_drift",
        ),
      );
    }
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
      // ENOENT after inspect = race-cleared → still count as fixed.
      // Non-ENOENT (e.g. EACCES) must NOT abort the rest of --fix (ISS-20260531-031).
      let unlinkOk = true;
      try {
        await unlink(lockFilePath);
      } catch (err: unknown) {
        const errno = err as NodeJS.ErrnoException;
        if (errno.code !== "ENOENT") {
          unlinkOk = false;
          failed.push({
            code: "stale_serve_lock",
            name: "Serve lock",
            message: `Could not remove stale .fabric/.serve.lock (${errno.code ?? "error"}): ${errno.message}`,
            path: ".fabric/.serve.lock",
            actionHint:
              "Remove .fabric/.serve.lock manually (permission denied or other FS error). Other --fix repairs still applied.",
          });
        }
      }
      if (unlinkOk) {
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

  // v-next grill D5/D7: strip legacy body sections (## Summary / ## Evidence /
  // ## Why proposed) and rename ## Session context → ## Context.
  if (before.fixable_errors.some((issue) => issue.code === "knowledge_body_dedup")) {
    const result = await fixBodyDedup(projectRoot);
    if (result.fixed > 0) {
      fixed.push(findIssue(before.fixable_errors, "knowledge_body_dedup"));
    }
  }

  // v2.2 store cutover: draft auto-promote is disabled until it can operate

  const report = appendDoctorWarnings(await runDoctorReport(projectRoot), ledgerWarnings);

  return {
    changed: fixed.length > 0 || failed.length > 0,
    fixed,
    remaining_manual_errors: [...report.manual_errors, ...failed],
    warnings: report.warnings,
    message: createFixMessage(fixed, report),
    report,
  };
}

// rc.4 TASK-003: lint mutation entry point. Behavior summary:
//   * `lint:orphan_demote` (warning kind code=knowledge_orphan_demote_required):
//     rewrite frontmatter `maturity:` one tier down (proven -> verified,
//     verified -> draft) via atomicWriteText; emit knowledge_demoted event.
//   * `lint:stale_archive` (code=knowledge_stale_archive_required):
//     rename file to .fabric/.archive/<type>/<filename>; emit knowledge_archived
//     event. Per task design the archive subtree is a tombstone (not git-tracked
//     active history) so we use `fs.rename` rather than `git mv`. The events.jsonl
//     entry IS the audit trail.
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
// v2.2 Goal B (G-INTEGRITY): the loud-error gate now lists only
// `knowledge_layer_mismatch` — the rebuilt store integrity lints fold the old
// filename-id `stable_id_duplicate` into the frontmatter-id `stable_id_collision`
// (a warning), since `deriveRuleIdentity` unifies the two id sources in the
// store model. layer_mismatch stays a manual error (rename + move is unsafe to
// auto-apply).
const MANUAL_LINT_ERROR_CODES = new Set([
  "knowledge_layer_mismatch",
]);

export async function runDoctorApplyLint(target: string): Promise<DoctorApplyLintReport> {
  return runDoctorApplyLintWithDeps(target, {
    normalizeTarget,
    runDoctorReport,
    appendDoctorWarnings,
    createLedgerAppendWarning,
    contextCacheInvalidate: (kind, projectRoot) => {
      // Apply-lint only ever invalidates meta_write; kind kept for API stability.
      void kind;
      contextCache.invalidate("meta_write", projectRoot);
    },
  });
}

// through fixStoreCounters (doctor-store-counters.ts).

function truncateErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

async function inspectForensic(projectRoot: string): Promise<ForensicInspection> {
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

// Event ledger health inspection for createEventLedger* checks.

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

/**
 * v2.0.0-rc.37 NEW-39 (werewolf dogfood remediation): backfill emitter that
 * heals a violated `promote_ledger_invariant` warning.
 *
 * Werewolf 实测: proposed=20 < promote_started=49 < promoted=53 — 部分 approve
 * 在 rc.31 BUG-G2 fix 之前 happened without emitting knowledge_proposed (real
 * extract didn't go through fab_propose → no propose event). The
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
      // KT-DEC-0030: knowledge_body_read is the native-Read consumption signal
      // that replaced knowledge_consumed/knowledge_sections_fetched — it carries a
      // single stable_id and is the forward recency source for orphan/stale lints.
      case "knowledge_body_read":
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

// ---------------------------------------------------------------------------
// rc.4 TASK-002: read-side integrity lint inspections (#19-21).
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

// `inspectCodexSkillLegacyPath` and their `create*Check` / `fix*` siblings.
// They migrated v1.x agents-md-init-reminder/skill paths into the v1 client-
// side init reminder/skill paths, both of which are now archaeology — rc.4
// owns v2 lint coverage for whatever skill/hook paths v2 introduces.

// (windsurf/rooCode/geminiCLI) are now rejected at Zod parse time on the
// strict clientPathsSchema — there is no soft-deprecation path to detect or
// fix. The corresponding `legacy_client_path_present` event-type literal
// broader event-vocabulary rename.

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
//   - AGENTS.md: locate-or-append a managed block via BOOTSTRAP_REGEX; body is
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

  // Managed-block targets: AGENTS.md.
  const blockTargets = [
    join(projectRoot, "AGENTS.md"),
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

// createFixMessage / isValidJsonLine / normalizeTarget / normalizePath → doctor-path.ts

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
// EnrichDescriptions* types re-exported from doctor-types.ts.

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


// YAML flow scalar quoting. Mirrors the extract-knowledge `quoteRelevancePath`
// rule: if the string contains characters that would confuse the line-based
// parser (colon, `#`, leading `-`, leading `?`, brackets, quotes), wrap in
// double quotes and escape embedded quotes/backslashes. Otherwise emit bare.


export { getEventLedgerPath };

// ---------------------------------------------------------------------------
// W3-3 (KT-DEC-0030): body_read misfire sub-check.
//
// After retrieval collapsed to one lean tool (KT-DEC-0026), the agent consumes a
// knowledge body via a NATIVE Read of the store file, observed by the PostToolUse
// hook as `knowledge_body_read`. The wire has a structural failure mode: if the
// PostToolUse matcher is missing `Read` (config drift) the marker NEVER fires and
// the planned → body_read → cite[applied] funnel goes dark silently.
//
// doctor can't witness a Read directly, so it proxies via `knowledge_context_planned`
// — every fab_recall surfaces native read-paths to the agent, so sustained recall
// activity with ZERO body_read events across the whole ledger is the misfire
// signature. The check is deliberately BINARY (silence amid significant activity),
// not a ratio: body_read is sparse BY DESIGN (the lean default reads bodies on
// demand, KT-GLD-0005), so a low-but-nonzero rate is healthy, not a fault. Only
// total silence past a recall-volume floor warns. Standalone (not wired into the
// runDoctorReport pipeline yet); the function + tests pin the contract.
//
// hook = nudge, never a gate (KT-DEC-0007): the result is a warn-level hint only.
// ---------------------------------------------------------------------------

export type BodyReadMisfireReport = {
  recalls: number; // knowledge_context_planned count (read-paths surfaced)
  body_reads: number; // knowledge_body_read count (native Reads observed)
  status: "ok" | "warn";
  message: string;
};

// Recall-volume floor below which "zero body_read" is statistically
