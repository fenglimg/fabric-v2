/**
 * Doctor check builder registry (W7).
 * Order of DOCTOR_CHECK_BUILDERS is locked by doctor-i18n.test.ts snapshot —
 * do not reorder without updating the order lock test intentionally.
 */
import type { Translator } from "@fenglimg/fabric-shared";
import type { DoctorCheck } from "./doctor-types.js";
import {
  EMPTY_META_INSPECTION,
  createCiteGoodhartCheck,
  createDraftBacklogCheck,
  createDriftUnconsumedCheck,
  createEventLedgerCheck,
  createEventLedgerPartialWriteCheck,
  createEventLedgerSchemaCompatCheck,
  createEventsJsonlHealthCheck,
  createForensicCheck,
  createKnowledgeTagsEmptyCheck,
  createOnboardCoverageCheck,
  createPreexistingRootFilesCheck,
  createPromoteLedgerInvariantCheck,
  createSessionHintsStaleCheck,
  createStaleServeLockCheck,
  createUnderseededCheck,
  type CiteGoodhartInspection,
  type DraftBacklogInspection,
  type DriftUnconsumedInspection,
  type EmptyTagsInspection,
  type EventLedgerInspection,
  type ForensicInspection,
  type OnboardCoverageInspection,
  type PreexistingRootFilesInspection,
  type PromoteLedgerInvariantInspection,
  type SessionHintsStaleInspection,
  type StaleServeLockInspection,
  type UnderseededInspection,
} from "./doctor-core-checks.js";
import {
  createBodyReadMisfireCheck,
} from "./doctor-knowledge-checks.js";
import type { BodyReadMisfireReport } from "./doctor-body-read-misfire.js";
import {
  createBootstrapAnchorCheck,
  createL1BootstrapSnapshotDriftCheck,
  createL2ManagedBlockDriftCheck,
} from "./doctor-bootstrap-lints.js";
import {
  createSkillContractCheck,
  createSkillDescriptionCheck,
  createSkillMdYamlInvalidCheck,
  createSkillRefMirrorCheck,
  createSkillTokenBudgetCheck,
} from "./doctor-skill-lints.js";
import {
  createHookCacheWritabilityCheck,
  createHooksContentDriftCheck,
  createHooksRuntimeCheck,
  createHooksWiredCheck,
} from "./doctor-hooks-lints.js";
import {
  createRetiredReferenceCheck,
} from "./doctor-retired-references-lint.js";
import {
  createGlobalCliVersionCheck,
  type GlobalCliInspection,
} from "./doctor-global-cli.js";
import {
  createKnowledgeSummaryOpaqueCheck,
  inspectKnowledgeSummaryOpaque,
} from "./doctor-summary-opaque.js";
import { createScopeLintCheck } from "./doctor-scope-lint.js";
import {
  createLayerMismatchCheck,
  createStableIdCollisionCheck,
} from "./doctor-stable-id-collision.js";
import {
  createNarrowNoPathsCheck,
  createRelevancePathsDanglingCheck,
  createRelevancePathsDriftCheck,
} from "./doctor-relevance-paths.js";
import {
  createBroadIndexDriftCheck,
} from "./doctor-broad-index.js";
import {
  createOrphanDemoteCheck,
  createStaleArchiveCheck,
} from "./doctor-knowledge-age.js";
import {
  createPromotionCandidateCheck,
} from "./doctor-knowledge-promotion.js";
import {
  createBroadReviewRecheckCheck,
} from "./doctor-knowledge-review-recheck.js";
import {
  createUnboundProjectCheck,
  detectUnboundProject,
} from "./doctor-unbound-project.js";
import {
  createWriteRouteUnboundCheck,
  detectWriteRouteUnbound,
} from "./doctor-write-route-lint.js";
import {
  createStrayFabricDirCheck,
  detectStrayFabricDirs,
} from "./doctor-stray-fabric-dir.js";
import {
  createStoreCounterCheck,
} from "./doctor-store-counters.js";
import {
  createStoreOrphanCheck,
} from "./doctor-store-orphan.js";
import {
  createProjectRegistryDriftCheck,
} from "./doctor-project-registry-drift.js";
import type { EventsJsonlGatesReport } from "./events-jsonl-gates.js";
import type { collectStoreKnowledgeSummaries } from "./cross-store-recall.js";
import type { lintStoreScopes } from "./doctor-scope-lint.js";
import type { inspectStoreCounters } from "./doctor-store-counters.js";
import type { inspectStoreOrphans } from "./doctor-store-orphan.js";
import type { inspectProjectRegistryDrift } from "./doctor-project-registry-drift.js";
import type { inspectStoreStableIdIntegrity } from "./doctor-stable-id-collision.js";
import type { inspectStoreRelevancePaths } from "./doctor-relevance-paths.js";
import type { inspectBroadIndexDrift } from "./doctor-broad-index.js";
import type { inspectStoreKnowledgeAge } from "./doctor-knowledge-age.js";
import type { inspectStoreKnowledgePromotion } from "./doctor-knowledge-promotion.js";
import type { inspectStoreBroadReviewRecheck } from "./doctor-knowledge-review-recheck.js";
import type {
  inspectHookCacheWritability,
  inspectHooksContentDrift,
  inspectHooksRuntime,
  inspectHooksWired,
} from "./doctor-hooks-lints.js";
import type {
  inspectSkillContract,
  inspectSkillDescription,
  inspectSkillMdYamlInvalid,
  inspectSkillRefMirror,
  inspectSkillTokenBudget,
} from "./doctor-skill-lints.js";
import type { inspectRetiredReferences } from "./doctor-retired-references-lint.js";
import type {
  inspectBootstrapAnchor,
  inspectL1BootstrapSnapshotDrift,
  inspectL2ManagedBlockDrift,
} from "./doctor-bootstrap-lints.js";

export type DoctorCheckBuildContext = {
  t: Translator;
  projectRoot: string;
  storeKnowledgeSummaries: Awaited<ReturnType<typeof collectStoreKnowledgeSummaries>>;
  scopeLint: Awaited<ReturnType<typeof lintStoreScopes>>;
  framework: { kind: string; version: string; subkind: string };
  entryPoints: Array<{ path: string; reason: string }>;
  bootstrapAnchor: Awaited<ReturnType<typeof inspectBootstrapAnchor>>;
  l1BootstrapSnapshotDrift: Awaited<ReturnType<typeof inspectL1BootstrapSnapshotDrift>>;
  l2ManagedBlockDrift: Awaited<ReturnType<typeof inspectL2ManagedBlockDrift>>;
  forensic: ForensicInspection;
  eventLedger: EventLedgerInspection;
  eventsJsonlGates: EventsJsonlGatesReport;
  skillRefMirror: Awaited<ReturnType<typeof inspectSkillRefMirror>>;
  skillTokenBudget: Awaited<ReturnType<typeof inspectSkillTokenBudget>>;
  skillDescription: Awaited<ReturnType<typeof inspectSkillDescription>>;
  skillContract: Awaited<ReturnType<typeof inspectSkillContract>>;
  skillMdYamlInvalid: Awaited<ReturnType<typeof inspectSkillMdYamlInvalid>>;
  retiredReferences: Awaited<ReturnType<typeof inspectRetiredReferences>>;
  citeGoodhart: CiteGoodhartInspection;
  draftBacklog: DraftBacklogInspection;
  knowledgeTagsEmpty: EmptyTagsInspection;
  bodyReadMisfire: BodyReadMisfireReport;
  driftUnconsumed: DriftUnconsumedInspection;
  storeCounterDrift: ReturnType<typeof inspectStoreCounters>;
  storeOrphans: ReturnType<typeof inspectStoreOrphans>;
  projectRegistryDrift: Awaited<ReturnType<typeof inspectProjectRegistryDrift>>;
  stableIdIntegrity: Awaited<ReturnType<typeof inspectStoreStableIdIntegrity>>;
  relevancePaths: Awaited<ReturnType<typeof inspectStoreRelevancePaths>>;
  broadIndexDrift: Awaited<ReturnType<typeof inspectBroadIndexDrift>>;
  knowledgeAge: Awaited<ReturnType<typeof inspectStoreKnowledgeAge>>;
  knowledgePromotion: Awaited<ReturnType<typeof inspectStoreKnowledgePromotion>>;
  broadReviewRecheck: Awaited<ReturnType<typeof inspectStoreBroadReviewRecheck>>;
  underseeded: UnderseededInspection;
  sessionHintsStale: SessionHintsStaleInspection;
  hookCacheWritability: Awaited<ReturnType<typeof inspectHookCacheWritability>>;
  staleServeLock: StaleServeLockInspection;
  onboardCoverage: OnboardCoverageInspection;
  promoteLedgerInvariant: PromoteLedgerInvariantInspection | null;
  globalCliVersion: GlobalCliInspection;
  preexistingRootFiles: PreexistingRootFilesInspection;
  hooksWired: Awaited<ReturnType<typeof inspectHooksWired>>;
  hooksRuntime: Awaited<ReturnType<typeof inspectHooksRuntime>>;
  hooksContentDrift: Awaited<ReturnType<typeof inspectHooksContentDrift>>;
};

export function materializeDoctorChecks(
  builders: ReadonlyArray<(ctx: DoctorCheckBuildContext) => DoctorCheck | DoctorCheck[] | null | undefined>,
  ctx: DoctorCheckBuildContext,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  for (const build of builders) {
    const result = build(ctx);
    if (result == null) continue;
    if (Array.isArray(result)) {
      checks.push(...result);
    } else {
      checks.push(result);
    }
  }
  return checks;
}

// Order locked by doctor-i18n.test.ts — do not reorder casually.
export const DOCTOR_CHECK_BUILDERS: ReadonlyArray<
  (ctx: DoctorCheckBuildContext) => DoctorCheck | DoctorCheck[] | null | undefined
> = [
  (ctx) => createBootstrapAnchorCheck(ctx.t, ctx.bootstrapAnchor),
  (ctx) => createL1BootstrapSnapshotDriftCheck(ctx.t, ctx.l1BootstrapSnapshotDrift),
  (ctx) => createL2ManagedBlockDriftCheck(ctx.t, ctx.l2ManagedBlockDrift),
  (ctx) => createForensicCheck(ctx.t, ctx.forensic, ctx.framework.kind, ctx.entryPoints.length),
  (ctx) => createEventLedgerCheck(ctx.t, ctx.eventLedger),
  (ctx) => createEventLedgerPartialWriteCheck(ctx.t, ctx.eventLedger),
  (ctx) => createEventsJsonlHealthCheck(ctx.t, ctx.eventsJsonlGates),
  (ctx) => createEventLedgerSchemaCompatCheck(ctx.t, ctx.eventLedger),
  (ctx) => createSkillRefMirrorCheck(ctx.t, ctx.skillRefMirror),
  (ctx) => createSkillTokenBudgetCheck(ctx.t, ctx.skillTokenBudget),
  (ctx) => createSkillDescriptionCheck(ctx.t, ctx.skillDescription),
  (ctx) => createSkillContractCheck(ctx.t, ctx.skillContract),
  (ctx) => createRetiredReferenceCheck(ctx.t, ctx.retiredReferences),
  (ctx) => createCiteGoodhartCheck(ctx.t, ctx.citeGoodhart),
  (ctx) => createDraftBacklogCheck(ctx.t, ctx.draftBacklog),
  (ctx) => createKnowledgeTagsEmptyCheck(ctx.t, ctx.knowledgeTagsEmpty),
  (ctx) => createBodyReadMisfireCheck(ctx.t, ctx.bodyReadMisfire),
  (ctx) => createDriftUnconsumedCheck(ctx.t, ctx.driftUnconsumed),
  (ctx) => createStoreCounterCheck(ctx.t, ctx.storeCounterDrift),
  (ctx) => createStoreOrphanCheck(ctx.t, ctx.storeOrphans),
  (ctx) => createProjectRegistryDriftCheck(ctx.t, ctx.projectRegistryDrift),
  (ctx) => createUnderseededCheck(ctx.t, ctx.underseeded),
  (ctx) => createSessionHintsStaleCheck(ctx.t, ctx.sessionHintsStale),
  (ctx) => createHookCacheWritabilityCheck(ctx.t, ctx.hookCacheWritability),
  (ctx) => createStaleServeLockCheck(ctx.t, ctx.staleServeLock),
  (ctx) => createSkillMdYamlInvalidCheck(ctx.t, ctx.skillMdYamlInvalid),
  (ctx) => createOnboardCoverageCheck(ctx.t, ctx.onboardCoverage),
  (ctx) => createHooksWiredCheck(ctx.t, ctx.hooksWired),
  (ctx) => createHooksRuntimeCheck(ctx.t, ctx.hooksRuntime),
  (ctx) => createHooksContentDriftCheck(ctx.t, ctx.hooksContentDrift),
  (ctx) => createGlobalCliVersionCheck(ctx.t, ctx.globalCliVersion),
  (ctx) => createKnowledgeSummaryOpaqueCheck(
      ctx.t,
      // Store-only opacity scan (EMPTY_META_INSPECTION zeros project-node loop).
      inspectKnowledgeSummaryOpaque(EMPTY_META_INSPECTION, ctx.storeKnowledgeSummaries),
    ),
  (ctx) => createScopeLintCheck(ctx.t, ctx.scopeLint),
  (ctx) => createStableIdCollisionCheck(ctx.t, ctx.stableIdIntegrity.collision),
  (ctx) => createLayerMismatchCheck(ctx.t, ctx.stableIdIntegrity.layerMismatch),
  (ctx) => createRelevancePathsDanglingCheck(ctx.t, ctx.relevancePaths.dangling),
  (ctx) => createRelevancePathsDriftCheck(ctx.t, ctx.relevancePaths.drift),
  (ctx) => createNarrowNoPathsCheck(ctx.t, ctx.relevancePaths.narrowNoPaths),
  (ctx) => createBroadIndexDriftCheck(ctx.t, ctx.broadIndexDrift),
  (ctx) => createOrphanDemoteCheck(ctx.t, ctx.knowledgeAge.orphanDemote),
  (ctx) => createStaleArchiveCheck(ctx.t, ctx.knowledgeAge.staleArchive),
  (ctx) => createPromotionCandidateCheck(ctx.t, ctx.knowledgePromotion),
  (ctx) => createBroadReviewRecheckCheck(ctx.t, ctx.broadReviewRecheck),
  (ctx) => createUnboundProjectCheck(ctx.t, detectUnboundProject(ctx.projectRoot)),
  (ctx) => createWriteRouteUnboundCheck(ctx.t, detectWriteRouteUnbound(ctx.projectRoot)),
  (ctx) => createStrayFabricDirCheck(ctx.t, detectStrayFabricDirs(ctx.projectRoot), ctx.projectRoot),
  (ctx) => (ctx.promoteLedgerInvariant === null
      ? []
      : [createPromoteLedgerInvariantCheck(ctx.t, ctx.promoteLedgerInvariant)]),
  (ctx) => createPreexistingRootFilesCheck(ctx.t, ctx.preexistingRootFiles),
];

export function buildDoctorChecks(ctx: DoctorCheckBuildContext): DoctorCheck[] {
  return materializeDoctorChecks(DOCTOR_CHECK_BUILDERS, ctx);
}
