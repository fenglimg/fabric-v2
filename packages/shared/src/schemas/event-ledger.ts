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

export const ruleContextPlannedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("rule_context_planned"),
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

export const ruleSelectionEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("rule_selection"),
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

export const ruleSectionsFetchedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("rule_sections_fetched"),
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

export const ruleDriftDetectedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("rule_drift_detected"),
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

export const ruleBaselineAcceptedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("rule_baseline_accepted"),
  revision: z.string(),
  previous_revision: z.string().optional(),
  accepted_stable_ids: z.array(z.string()),
  source: z.enum(["doctor_fix", "sync_meta"]).optional(),
});

// Legacy: emitted by 1.7.x doctor; replaced by 'meta_reconciled' in 1.8.0. Kept for backward-compat ledger replay.
export const baselineSyncedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("baseline_synced"),
  revision: z.string(),
  previous_revision: z.string().optional(),
  synced_files: z.array(z.string()),
  accepted_stable_ids: z.array(z.string()),
  source: z.enum(["doctor_fix", "sync_meta"]),
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
  source: z.literal("reconcileRules"),
});

export const metaReconciledEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("meta_reconciled"),
  reconciled_files: z.array(z.string()),
  duration_ms: z.number().int().nonnegative(),
  trigger: z.enum(["doctor", "manual"]),
  source: z.literal("reconcileRules"),
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

export const legacyClientPathPresentEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("legacy_client_path_present"),
  removed: z.array(z.string()),
});

export const eventLedgerEventSchema = z.discriminatedUnion("event_type", [
  ruleContextPlannedEventSchema,
  ruleSelectionEventSchema,
  ruleSectionsFetchedEventSchema,
  editIntentCheckedEventSchema,
  ruleDriftDetectedEventSchema,
  ruleBaselineAcceptedEventSchema,
  baselineSyncedEventSchema,
  mcpEventLedgerEventSchema,
  reapplyCompletedEventSchema,
  eventLedgerTruncatedEventSchema,
  mcpConfigMigratedEventSchema,
  metaReconciledOnStartupEventSchema,
  metaReconciledEventSchema,
  claudeSkillPathMigratedEventSchema,
  claudeHookPathMigratedEventSchema,
  legacyClientPathPresentEventSchema,
]);

export type RuleContextPlannedEvent = z.infer<typeof ruleContextPlannedEventSchema>;
export type RuleSelectionEvent = z.infer<typeof ruleSelectionEventSchema>;
export type RuleSectionsFetchedEvent = z.infer<typeof ruleSectionsFetchedEventSchema>;
export type EditIntentCheckedEvent = z.infer<typeof editIntentCheckedEventSchema>;
export type RuleDriftDetectedEvent = z.infer<typeof ruleDriftDetectedEventSchema>;
export type RuleBaselineAcceptedEvent = z.infer<typeof ruleBaselineAcceptedEventSchema>;
export type BaselineSyncedEvent = z.infer<typeof baselineSyncedEventSchema>;
export type McpEventLedgerEvent = z.infer<typeof mcpEventLedgerEventSchema>;
export type ReapplyCompletedEvent = z.infer<typeof reapplyCompletedEventSchema>;
export type EventLedgerTruncatedEvent = z.infer<typeof eventLedgerTruncatedEventSchema>;
export type McpConfigMigratedEvent = z.infer<typeof mcpConfigMigratedEventSchema>;
export type MetaReconciledOnStartupEvent = z.infer<typeof metaReconciledOnStartupEventSchema>;
export type MetaReconciledEvent = z.infer<typeof metaReconciledEventSchema>;
export type ClaudeSkillPathMigratedEvent = z.infer<typeof claudeSkillPathMigratedEventSchema>;
export type ClaudeHookPathMigratedEvent = z.infer<typeof claudeHookPathMigratedEventSchema>;
export type LegacyClientPathPresentEvent = z.infer<typeof legacyClientPathPresentEventSchema>;
export type EventLedgerEvent =
  | RuleContextPlannedEvent
  | RuleSelectionEvent
  | RuleSectionsFetchedEvent
  | EditIntentCheckedEvent
  | RuleDriftDetectedEvent
  | RuleBaselineAcceptedEvent
  | BaselineSyncedEvent
  | McpEventLedgerEvent
  | ReapplyCompletedEvent
  | EventLedgerTruncatedEvent
  | McpConfigMigratedEvent
  | MetaReconciledOnStartupEvent
  | MetaReconciledEvent
  | ClaudeSkillPathMigratedEvent
  | ClaudeHookPathMigratedEvent
  | LegacyClientPathPresentEvent;
export type EventLedgerEventType = EventLedgerEvent["event_type"];
type EventLedgerEventInputFor<T extends EventLedgerEvent> = T extends EventLedgerEvent
  ? Omit<T, "kind" | "id" | "ts" | "schema_version" | "correlation_id" | "session_id"> &
      Partial<Pick<T, "id" | "ts" | "correlation_id" | "session_id">>
  : never;
export type EventLedgerEventInput = EventLedgerEventInputFor<EventLedgerEvent>;
