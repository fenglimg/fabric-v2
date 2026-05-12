import { z } from "zod";

const eventLedgerEnvelopeSchema = {
  kind: z.literal("fabric-event"),
  id: z.string(),
  ts: z.number().int().nonnegative(),
  schema_version: z.literal(1),
  correlation_id: z.string().optional(),
  session_id: z.string().optional(),
};

const stringRecordSchema = z.record(z.string());

export const knowledgeContextPlannedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_context_planned"),
  target_paths: z.array(z.string()),
  required_stable_ids: z.array(z.string()),
  ai_selectable_stable_ids: z.array(z.string()),
  final_stable_ids: z.array(z.string()),
  selection_token: z.string().optional(),
  client_hash: z.string().optional(),
  intent: z.string().optional(),
  known_tech: z.array(z.string()).optional(),
  diagnostics: z.array(z.unknown()).optional(),
});

export const knowledgeSelectionEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_selection"),
  selection_token: z.string(),
  target_paths: z.array(z.string()),
  required_stable_ids: z.array(z.string()),
  ai_selectable_stable_ids: z.array(z.string()),
  ai_selected_stable_ids: z.array(z.string()),
  final_stable_ids: z.array(z.string()),
  ai_selection_reasons: stringRecordSchema,
  rejected_stable_ids: z.array(z.string()),
  ignored_stable_ids: z.array(z.string()),
});

export const knowledgeSectionsFetchedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_sections_fetched"),
  selection_token: z.string(),
  target_paths: z.array(z.string()).optional(),
  requested_sections: z.array(z.string()),
  final_stable_ids: z.array(z.string()),
  ai_selected_stable_ids: z.array(z.string()),
  diagnostics: z.array(z.unknown()).optional(),
});

export const editIntentCheckedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("edit_intent_checked"),
  path: z.string(),
  compliant: z.boolean(),
  intent: z.string(),
  ledger_entry_id: z.string(),
  ledger_source: z.enum(["ai", "human"]).optional(),
  commit_sha: z.string().optional(),
  parent_sha: z.string().optional(),
  parent_ledger_entry_id: z.string().optional(),
  diff_stat: z.string().optional(),
  annotation: z.string().optional(),
  matched_rule_context_ts: z.number().int().nonnegative().nullable(),
  window_ms: z.number().int().nonnegative(),
});

export const knowledgeDriftDetectedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_drift_detected"),
  revision: z.string().optional(),
  drifted_stable_ids: z.array(z.string()),
  missing_files: z.array(z.string()),
  stale_files: z.array(z.string()),
  details: z
    .array(
      z.object({
        file: z.string(),
        stable_id: z.string(),
        expected_hash: z.string(),
        actual_hash: z.string().nullable(),
      }),
    )
    .optional(),
});

export const mcpEventLedgerEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("mcp_event"),
  mcp_event_id: z.string(),
  stream_id: z.string(),
  message: z.unknown(),
});

export const reapplyCompletedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("reapply_completed"),
  preserved_ledger: z.boolean(),
  preserved_meta: z.boolean(),
  rules_count: z.number().int().nonnegative(),
});

export const eventLedgerTruncatedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("event_ledger_truncated"),
  byte_offset: z.number().int().nonnegative(),
  byte_length: z.number().int().nonnegative(),
  corrupted_path: z.string(),
});

export const mcpConfigMigratedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("mcp_config_migrated"),
  source: z.literal("doctor_fix"),
  removed_from: z.string(),
});

export const metaReconciledOnStartupEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("meta_reconciled_on_startup"),
  reconciled_files: z.array(z.string()),
  duration_ms: z.number().int().nonnegative(),
  source: z.literal("reconcileKnowledge"),
});

export const metaReconciledEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("meta_reconciled"),
  reconciled_files: z.array(z.string()),
  duration_ms: z.number().int().nonnegative(),
  trigger: z.enum(["doctor", "manual"]),
  source: z.literal("reconcileKnowledge"),
});

export const claudeSkillPathMigratedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("claude_skill_path_migrated"),
  from: z.string(),
  to: z.string(),
});

export const claudeHookPathMigratedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("claude_hook_path_migrated"),
  from: z.string(),
  to: z.string(),
});

export const codexSkillPathMigratedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("codex_skill_path_migrated"),
  from: z.string(),
  to: z.string(),
});

// v2.0 rc.1: emitted by the init scan when baseline knowledge entries are written.
export const initScanCompletedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("init_scan_completed"),
  written_stable_ids: z.array(z.string()),
  duration_ms: z.number().int().nonnegative(),
  source: z.enum(["init", "scan", "doctor_fix"]).optional(),
});

// v2.0 rc.2 grill-followup TASK-004: pre-register 11 knowledge.* lifecycle event
// variants. Each is a minimal payload skeleton that locks vocabulary BEFORE rc.2/3/4
// emit-site implementation. Payload details (beyond stable_id/timestamp/reason and the
// few field constraints below) will be filled when each emit site lands.
//
// Lifecycle group: proposed → promote_started → promoted | promote_failed
// Layer/slug group: layer_changed, slug_renamed
// Maturity/archive group: demoted, archived, archive_attempted
// Review group: deferred, rejected
export const knowledgeProposedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_proposed"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
});

export const knowledgePromoteStartedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_promote_started"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
});

export const knowledgePromotedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_promoted"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
});

export const knowledgePromoteFailedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_promote_failed"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string(),
});

export const knowledgeLayerChangedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_layer_changed"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
  from_layer: z.enum(["team", "personal"]),
  to_layer: z.enum(["team", "personal"]),
});

export const knowledgeSlugRenamedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_slug_renamed"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
  from_slug: z.string(),
  to_slug: z.string(),
});

export const knowledgeDemotedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_demoted"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
});

export const knowledgeArchivedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_archived"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
});

export const knowledgeArchiveAttemptedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_archive_attempted"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
});

export const knowledgeDeferredEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_deferred"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
  until: z.string().datetime().optional(),
});

export const knowledgeRejectedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_rejected"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string(),
});

// v2.0 rc.5 TASK-014 (C5): emitted by fab_get_knowledge_sections per stable_id
// resolved in a successful fetch. Deduped within a single request by the
// service layer. Drives doctor lint #16 (orphan_demote) via replay-derived
// last_consumed_at index — replaces the pre-rc.5 last_referenced heuristic.
export const knowledgeConsumedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_consumed"),
  stable_id: z.string(),
  consumed_at: z.string().datetime(),
  client_hash: z.string(),
});

// v2.0 rc.5 TASK-012 (C3): emitted by fab_review.modify when a narrow-scope
// entry is layer-flipped from team → personal. Personal knowledge crosses
// projects so workspace-relative `relevance_paths` lose meaning; the modify
// branch auto-degrades the scope to `broad` + clears the paths array and
// records this event so the audit trail preserves the original intent.
// `from_scope`/`to_scope` mirror the relevance enum so future degrade reasons
// (e.g. broad → narrow rollbacks) can reuse the same vocabulary.
export const knowledgeScopeDegradedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_scope_degraded"),
  stable_id: z.string(),
  timestamp: z.string().datetime(),
  from_scope: z.enum(["narrow", "broad"]),
  to_scope: z.enum(["narrow", "broad"]),
  reason: z.string(),
});

// v2.0 rc.5 TASK-009 (B2): emitted by `doctor --apply-lint` when a pending
// knowledge entry exceeds the 30-day auto-archive threshold and gets moved
// from the staging area (`.fabric/knowledge/pending/<type>/` or
// `~/.fabric/knowledge/pending/<type>/`) into the archive subtree
// (`.fabric/.archive/pending/<type>/` or `~/.fabric/.archive/pending/<type>/`).
// `reason` is currently always "auto_archive_30d" but is left a free string
// so future doctor passes (e.g. a stale-pending-after-rejection variant) can
// reuse the same event vocabulary without schema churn. One event is appended
// per archived file — callers iterate the event stream to reconstruct the
// archive timeline.
export const pendingAutoArchivedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("pending_auto_archived"),
  pending_path: z.string(),
  archived_to: z.string(),
  reason: z.string(),
});

export const eventLedgerEventSchema = z.discriminatedUnion("event_type", [
  knowledgeContextPlannedEventSchema,
  knowledgeSelectionEventSchema,
  knowledgeSectionsFetchedEventSchema,
  editIntentCheckedEventSchema,
  knowledgeDriftDetectedEventSchema,
  mcpEventLedgerEventSchema,
  reapplyCompletedEventSchema,
  eventLedgerTruncatedEventSchema,
  mcpConfigMigratedEventSchema,
  metaReconciledOnStartupEventSchema,
  metaReconciledEventSchema,
  claudeSkillPathMigratedEventSchema,
  claudeHookPathMigratedEventSchema,
  codexSkillPathMigratedEventSchema,
  initScanCompletedEventSchema,
  // v2.0 rc.2 grill-followup TASK-004: knowledge.* lifecycle pre-registration
  knowledgeProposedEventSchema,
  knowledgePromoteStartedEventSchema,
  knowledgePromotedEventSchema,
  knowledgePromoteFailedEventSchema,
  knowledgeLayerChangedEventSchema,
  knowledgeSlugRenamedEventSchema,
  knowledgeDemotedEventSchema,
  knowledgeArchivedEventSchema,
  knowledgeArchiveAttemptedEventSchema,
  knowledgeDeferredEventSchema,
  knowledgeRejectedEventSchema,
  // v2.0 rc.5 TASK-014: knowledge_consumed (consumption tracking)
  knowledgeConsumedEventSchema,
  // v2.0 rc.5 TASK-012 (C3): knowledge_scope_degraded — narrow→broad auto-degrade
  knowledgeScopeDegradedEventSchema,
  // v2.0 rc.5 TASK-009 (B2): pending_auto_archived — doctor --apply-lint moves
  // pending entries >30d old into the .archive/pending/ subtree.
  pendingAutoArchivedEventSchema,
]);

export type KnowledgeContextPlannedEvent = z.infer<typeof knowledgeContextPlannedEventSchema>;
export type KnowledgeSelectionEvent = z.infer<typeof knowledgeSelectionEventSchema>;
export type KnowledgeSectionsFetchedEvent = z.infer<typeof knowledgeSectionsFetchedEventSchema>;
export type EditIntentCheckedEvent = z.infer<typeof editIntentCheckedEventSchema>;
export type KnowledgeDriftDetectedEvent = z.infer<typeof knowledgeDriftDetectedEventSchema>;
export type McpEventLedgerEvent = z.infer<typeof mcpEventLedgerEventSchema>;
export type ReapplyCompletedEvent = z.infer<typeof reapplyCompletedEventSchema>;
export type EventLedgerTruncatedEvent = z.infer<typeof eventLedgerTruncatedEventSchema>;
export type McpConfigMigratedEvent = z.infer<typeof mcpConfigMigratedEventSchema>;
export type MetaReconciledOnStartupEvent = z.infer<typeof metaReconciledOnStartupEventSchema>;
export type MetaReconciledEvent = z.infer<typeof metaReconciledEventSchema>;
export type ClaudeSkillPathMigratedEvent = z.infer<typeof claudeSkillPathMigratedEventSchema>;
export type ClaudeHookPathMigratedEvent = z.infer<typeof claudeHookPathMigratedEventSchema>;
export type CodexSkillPathMigratedEvent = z.infer<typeof codexSkillPathMigratedEventSchema>;
export type InitScanCompletedEvent = z.infer<typeof initScanCompletedEventSchema>;
export type KnowledgeProposedEvent = z.infer<typeof knowledgeProposedEventSchema>;
export type KnowledgePromoteStartedEvent = z.infer<typeof knowledgePromoteStartedEventSchema>;
export type KnowledgePromotedEvent = z.infer<typeof knowledgePromotedEventSchema>;
export type KnowledgePromoteFailedEvent = z.infer<typeof knowledgePromoteFailedEventSchema>;
export type KnowledgeLayerChangedEvent = z.infer<typeof knowledgeLayerChangedEventSchema>;
export type KnowledgeSlugRenamedEvent = z.infer<typeof knowledgeSlugRenamedEventSchema>;
export type KnowledgeDemotedEvent = z.infer<typeof knowledgeDemotedEventSchema>;
export type KnowledgeArchivedEvent = z.infer<typeof knowledgeArchivedEventSchema>;
export type KnowledgeArchiveAttemptedEvent = z.infer<typeof knowledgeArchiveAttemptedEventSchema>;
export type KnowledgeDeferredEvent = z.infer<typeof knowledgeDeferredEventSchema>;
export type KnowledgeRejectedEvent = z.infer<typeof knowledgeRejectedEventSchema>;
export type KnowledgeConsumedEvent = z.infer<typeof knowledgeConsumedEventSchema>;
export type KnowledgeScopeDegradedEvent = z.infer<typeof knowledgeScopeDegradedEventSchema>;
export type PendingAutoArchivedEvent = z.infer<typeof pendingAutoArchivedEventSchema>;
export type EventLedgerEvent =
  | KnowledgeContextPlannedEvent
  | KnowledgeSelectionEvent
  | KnowledgeSectionsFetchedEvent
  | EditIntentCheckedEvent
  | KnowledgeDriftDetectedEvent
  | McpEventLedgerEvent
  | ReapplyCompletedEvent
  | EventLedgerTruncatedEvent
  | McpConfigMigratedEvent
  | MetaReconciledOnStartupEvent
  | MetaReconciledEvent
  | ClaudeSkillPathMigratedEvent
  | ClaudeHookPathMigratedEvent
  | CodexSkillPathMigratedEvent
  | InitScanCompletedEvent
  | KnowledgeProposedEvent
  | KnowledgePromoteStartedEvent
  | KnowledgePromotedEvent
  | KnowledgePromoteFailedEvent
  | KnowledgeLayerChangedEvent
  | KnowledgeSlugRenamedEvent
  | KnowledgeDemotedEvent
  | KnowledgeArchivedEvent
  | KnowledgeArchiveAttemptedEvent
  | KnowledgeDeferredEvent
  | KnowledgeRejectedEvent
  | KnowledgeConsumedEvent
  | KnowledgeScopeDegradedEvent
  | PendingAutoArchivedEvent;
export type EventLedgerEventType = EventLedgerEvent["event_type"];
type EventLedgerEventInputFor<T extends EventLedgerEvent> = T extends EventLedgerEvent
  ? Omit<T, "kind" | "id" | "ts" | "schema_version" | "correlation_id" | "session_id"> &
      Partial<Pick<T, "id" | "ts" | "correlation_id" | "session_id">>
  : never;
export type EventLedgerEventInput = EventLedgerEventInputFor<EventLedgerEvent>;
