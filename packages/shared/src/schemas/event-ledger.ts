import { z } from "zod";

import { normalizeCiteTag } from "../cite-line-parser.js";

// v2.1.0-rc.1 (ADJ-P4-1, full remap): cite_tags is persisted in events.jsonl.
// rc≤36 events stored the legacy 5-state vocabulary (planned/recalled/
// chained-from/dismissed/none); rc.37 NEW-1 collapsed authoring to the 2-state
// vocab (applied/dismissed). Rather than carry both forever (dual-vocab
// coexistence), this preprocess remaps every legacy element to its 2-state
// equivalent on READ — so historical events normalize to applied/dismissed/none
// and no longer fail safeParse / get undercounted by cite-coverage. New writes
// already emit the 2-state vocab (parser remaps at parse time), so the
// preprocess is a no-op for them. Reuses `normalizeCiteTag` — the same remap the
// parser applies — to keep read-normalization and parse-emission in lockstep.
const citeTagSchema = z.preprocess(
  (value) => (typeof value === "string" ? normalizeCiteTag(value) : value),
  z.enum(["applied", "dismissed", "none"]),
);

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
  // rc.35 TASK-07 (P0-2): add "hook" — emitted by the PreToolUse narrow hook
  // for every Edit/Write/MultiEdit fire so cite-coverage doctor metrics see
  // actual edit signals (previously editsTouched was permanently 0 because
  // no production caller of appendLedgerEntry existed).
  ledger_source: z.enum(["ai", "human", "hook"]).optional(),
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

// v2.0.0-rc.29 TASK-003 (BUG-H4): install_diff_applied — emitted by
// `fabric install` (cli `commands/install.ts:appendInstallDiffLedgerEvent`)
// per install run summarizing managed-file diff outcomes. Closes the
// `event_ledger_schema_compat` warn that CLI-only events produced when the
// server schema lacked the discriminant.
export const installDiffAppliedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("install_diff_applied"),
  applied: z.array(z.string()),
  canonical: z.array(z.string()),
  drifted: z.array(z.string()),
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

// v2.0.0-rc.19 bootstrap-consolidation TASK-004: emitted by `fabric doctor --fix`
// once per file when the legacy `<!-- fabric:knowledge-base:* -->` managed-block
// markers are rewritten to the new `<!-- fabric:bootstrap:* -->` marker pair.
// One-time migration audit trail — runs FIRST in runDoctorFix dispatcher so
// subsequent L1/L2 drift inspections see post-rename state. Mirrors the
// `mcp_config_migrated` shape (read → rewrite via atomicWriteText → ledger
// append, best-effort). `migrated_count` is the number of marker tokens
// replaced in the file (expected: 2 — one :begin, one :end — but the schema
// allows zero so an idempotent re-run that finds no work still validates).
export const bootstrapMarkerMigratedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("bootstrap_marker_migrated"),
  path: z.string(),
  migrated_count: z.number().int().nonnegative(),
  legacy_marker: z.literal("fabric:knowledge-base"),
  new_marker: z.literal("fabric:bootstrap"),
  timestamp: z.string(),
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
  // v2.0.0-rc.23 TASK-005 (a-B): added `auto-heal-description` trigger so the
  // read-path plan_context handler can drive a full reconcile when it detects
  // any node carrying `description === undefined` (legacy meta drift that the
  // revision-hash gate cannot catch — a missing description doesn't move the
  // revision). Symmetric to rc.22 D2 read-side auto-heal but covers the
  // description-undefined case which the revision drift gate misses.
  // v2.0.0-rc.27 TASK-001 (§2.9): `post-approve` / `post-modify` added so
  // `fab_review` write-actions can flush newly-promoted entries into
  // `agents.meta.json.nodes[id]` synchronously — without this the new entry
  // remains description-less until the next plan_context auto-heal.
  // v2.0.0-rc.29 TASK-005 (BUG-G1): `auto-heal-after-drift` added so
  // `ensureKnowledgeFresh` hot-path can chain a paired reconcile (closing the
  // drift→heal gap) when the caller opts in via `autoHealOnDrift: true`.
  trigger: z.enum([
    "doctor",
    "manual",
    "auto-heal-description",
    "auto-heal-after-drift",
    "post-approve",
    "post-modify",
  ]),
  source: z.literal("reconcileKnowledge"),
  // v2.0.0-rc.22 TASK-014 (Scope E): set when reconcileKnowledge forced a
  // writeKnowledgeMeta on revision drift alone (no per-file content drift).
  // Distinguishes top-level schema/revision repair from the standard per-file
  // drift path. Optional so existing emitters stay unchanged.
  force_write_reason: z.enum(["revision_drift"]).optional(),
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
  source: z.enum(["init", "scan", "doctor_fix", "doctor-rescan"]).optional(),
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

export const knowledgeModifiedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_modified"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  path: z.string(),
  changed_fields: z.array(z.string()),
  before: z.record(z.unknown()),
  after: z.record(z.unknown()),
  reason: z.string().optional(),
});

export const knowledgeLayerChangedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_layer_changed"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
  from_layer: z.enum(["team", "personal"]),
  to_layer: z.enum(["team", "personal"]),
  // v2.0.0-rc.37 NEW-24: record the pre-flip stable_id so downstream consumers
  // (fab_plan_context redirect surface, fab_get_knowledge_sections.redirect_to)
  // can map a stale caller-held id back to the post-flip canonical id without
  // requiring the caller to re-issue plan-context. Optional for forward-
  // compatibility with rc ≤36 events that never carried this field.
  previous_stable_id: z.string().optional(),
});

// v2.0.0-rc.37 NEW-24: dedicated id-redirect event. Emitted alongside
// knowledge_layer_changed whenever a flip allocates a new stable_id under a
// different layer counter (KT-* ↔ KP-*). Downstream tooling that just needs
// the old→new mapping (without caring about the layer-flip semantics) can
// subscribe to this single event instead of replaying knowledge_layer_changed
// + filtering. The two events share `reason` so they can be correlated.
export const knowledgeIdRedirectEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_id_redirect"),
  timestamp: z.string().datetime(),
  previous_stable_id: z.string(),
  new_stable_id: z.string(),
  reason: z.string().optional(),
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

// v2.0.0-rc.34 TASK-05: knowledge_unarchived — reverse flow of knowledge_archived.
// Emitted when an archived entry is moved back from .fabric/.archive/<type>/ to
// the canonical layer path (.fabric/knowledge/<layer>/<type>/). Reason field
// records the trigger (e.g. "manual:fab_review_unarchive", "ghost_cited_7d").
// Drives the doctor 7d hint surfacing reverse-flow activity.
export const knowledgeUnarchivedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_unarchived"),
  stable_id: z.string().optional(),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
  // Pre-move archive path (e.g. ".fabric/.archive/decisions/KT-D-0007--single-cjs-hook.md").
  archive_path: z.string().optional(),
  // Post-move canonical path (e.g. ".fabric/knowledge/team/decisions/KT-D-0007--single-cjs-hook.md").
  restored_to: z.string().optional(),
});

export const knowledgeDeferredEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_deferred"),
  stable_id: z.string().optional(),
  pending_path: z.string().optional(),
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

// v2.0.0-rc.7 T10: emitted by `fabric doctor` at the end of every invocation
// (both --lint report-only and --apply-lint mutation modes). Drives Signal D
// (maintenance hint) in the fabric-hint Stop hook: when no doctor_run event
// has fired in `maintenance_hint_days` (default 14) AND canonical entries ≥5,
// the hook surfaces a "run `fabric doctor --lint`" reminder. The maintenance
// signal closes Q-16 — without an emit site the chain stayed dormant.
//
// `mode`: "lint" for read-only reports, "fix-knowledge" for mutation runs
// (mirrors the `--fix-knowledge` CLI flag renamed from `--apply-lint` in rc.15).
// `issues`: total fixable+manual+warning count surfaced by the report. Drives
//   future "did this run actually do anything?" telemetry.
// `mutations`: count of applied mutations (apply-lint only — undefined for
//   plain --lint runs). Keep optional to leave the --lint payload narrow.
export const doctorRunEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("doctor_run"),
  mode: z.enum(["lint", "fix-knowledge"]),
  issues: z.number().int().nonnegative(),
  mutations: z.number().int().nonnegative().optional(),
  timestamp: z.string().datetime(),
});

// v2.0 rc.5 TASK-013 (C4): emitted by doctor lint #24 (relevance_paths_dangling)
// when `--apply-lint` (future rc.7+ behavior) prunes a glob from a canonical
// entry's `relevance_paths` because the glob resolves to zero matches in the
// current workspace. One event per pruned glob. In rc.5 the lint stays
// flag-only (no auto-prune mutation), but the schema pre-registers the event
// so future apply-lint behavior can ship without an additional schema bump.
// `removed_glob` records the exact glob string that was removed from the
// entry's frontmatter so the audit trail can be replayed to reconstruct the
// pre-prune `relevance_paths` array.
export const knowledgePathDangledEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_path_dangled"),
  stable_id: z.string(),
  removed_glob: z.string(),
});

// v2.0.0-rc.9 TASK-003 (A3): emitted by `doctor --apply-lint` after the
// lint #26 (`relevance_fields_missing`) mutation arm finishes walking the
// `.fabric/knowledge/pending/**/*.md` tree and back-filling missing
// `relevance_scope` / `relevance_paths` frontmatter fields. One aggregate
// event per --apply-lint invocation (NOT per file) — mirrors the
// rc.5→rc.7 precedent for bulk-migration audit trails. Idempotent:
// touched_count is zero when every scanned entry already has both fields,
// and the event is still emitted so the audit log preserves the run
// timestamp (matches the doctor_run heartbeat shape).
//
// `scanned_count`: total pending entries the walker visited (both layers
//   — team `.fabric/knowledge/pending/` and personal `~/.fabric/knowledge/
//   pending/`). Includes entries that already had both fields.
// `touched_count`: subset of scanned entries that received a frontmatter
//   write back. Always <= scanned_count. Zero on a re-run with no new
//   pending entries (idempotency invariant).
export const relevanceMigrationRunEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("relevance_migration_run"),
  timestamp: z.string().datetime(),
  scanned_count: z.number().int().nonnegative(),
  touched_count: z.number().int().nonnegative(),
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

// v2.0.0-rc.20 TASK-02: emitted per assistant turn after the assistant emits
// its first non-empty line. Drives cite-policy observability — the Stop hook
// (or transcript scanner) records the raw KB: line text (or null when the
// turn opened without one), plus the parsed cite_ids and the per-id cite_tags
// vocabulary. v2.1.0-rc.1 (ADJ-P4-1): cite_tags is the rc.37 NEW-1 2-state vocab
// (applied/dismissed/none); legacy rc≤36 elements (planned/recalled/chained-from)
// are remapped to `applied` on read via citeTagSchema's preprocess. `client` records
// which surface produced the turn so per-client compliance can be tabulated
// without joining against session metadata. `turn_id` is the conversation-
// local turn identifier; `envelope_index` (optional) is a monotonic counter
// for multi-event turns. Schema pre-registers the shape so rc.20+ analytics
// can ship without a follow-up event-ledger bump.
export const assistantTurnObservedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("assistant_turn_observed"),
  kb_line_raw: z.string().nullable(),
  cite_ids: z.array(z.string()).default([]),
  cite_tags: z.array(citeTagSchema).default([]),
  // v2.0.0-rc.24 TASK-01: per-cite contract commitments. Index-aligned with
  // cite_ids/cite_tags (commitments[i] belongs to cite_ids[i]). Each slot
  // carries `operators[]` (kind + glob target) or `skip_reason` when the cite
  // cannot be operator-ized. Old rc.20-rc.23 events naturally parse with an
  // empty array via `.default([])` and are excluded from contract-policy
  // audits by the marker-gate (see cite_contract_policy_activated below).
  // Mirrors the rc.20 cite_tags parallel-array evolution exactly.
  cite_commitments: z.array(
    z.object({
      operators: z.array(
        z.object({
          kind: z.enum(["edit", "not_edit", "require", "forbid"]),
          target: z.string(),
        }),
      ),
      skip_reason: z.string().nullable(),
    }),
  ).default([]),
  // lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测): per-cite store
  // qualifier, index-aligned with cite_ids. Mirrors the cite-line-parser's
  // `cite_stores` output (`<alias-or-uuid>:<id>` → the qualifier; a bare id →
  // null). Persists the store provenance the parser already extracts so
  // doctor --cite-coverage can break compliance down per store WITHOUT joining
  // against the store registry. Additive `.optional()` (NOT `.default([])`) so
  // existing inline event constructors stay valid without supplying it — pre-W3-T4
  // events parse with the field absent and bucket under the project-local default.
  cite_stores: z.array(z.string().nullable()).optional(),
  client: z.enum(["cc", "codex", "cursor"]).optional(),
  turn_id: z.string(),
  envelope_index: z.number().int().nonnegative().optional(),
  timestamp: z.string().datetime(),
});

// v2.0.0-rc.20 TASK-02: emitted once per session (or per policy bump) when
// the cite-policy enforcement layer activates. `policy_version` is a free
// string (e.g. "rc.20") so future policy revisions can advance without
// schema churn. Pairs with `assistant_turn_observed` to provide the audit
// trail: "policy X was active starting at timestamp Y, and these turns
// were observed under it".
export const citePolicyActivatedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("cite_policy_activated"),
  policy_version: z.string(),
  timestamp: z.string().datetime(),
});

// v2.0.0-rc.24 TASK-01: idempotent marker emitted once per session (or per
// policy bump) by `fabric doctor --cite-coverage` when the cite-contract policy
// layer activates — but only if no bootstrap drift is detected (otherwise
// the marker emit is skipped to bridge the rc.23→rc.24 half-upgrade window
// where servers run rc.24 but installed hooks still produce rc.23-shape
// events). Independent of `cite_policy_activated` (rc.20 id-existence
// marker) so contract metrics open their own audit window without polluting
// the existing recalled_unverified / qualifying_cites accounting. Pure
// marker shape — no extra payload beyond the envelope.
export const citeContractPolicyActivatedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("cite_contract_policy_activated"),
});

// v2.0.0-rc.22 Scope A T3: emitted by `rotateEventLedgerIfNeeded` as the FIRST
// line of the post-rotation main events.jsonl. Provides forensic continuity
// after a sliding-window-by-age rotation moves stale lines into
// `.fabric/events.archive/events-rotated-YYYY-MM-DD.jsonl`. `cutoff_ts` is the
// ISO timestamp used as the partition boundary (lines with `ts <
// cutoff` were archived). `archive_path` is a workspace-relative path so the
// audit trail survives moving the workspace. Mirrors the
// `event_ledger_truncated` precedent (line 105) — same shape, different
// rotation semantics (truncate is partial-write recovery; rotate is
// age-based windowing).
export const eventsRotatedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("events_rotated"),
  cutoff_ts: z.string().datetime(),
  archived_count: z.number().int().nonnegative(),
  kept_count: z.number().int().nonnegative(),
  archive_path: z.string(),
});

// v2.0.0-rc.22 Scope D T-D1: emitted by the read-path `loadActiveMeta` helper
// when on-disk `.fabric/agents.meta.json` revision does not match the
// derived revision computed from current knowledge files — i.e. the helper
// rebuilt the meta file in-place to repair drift. Provides the audit trail
// for every silent auto-heal so operators can correlate revision churn with
// the read call that triggered it. `trigger` is currently fixed to `'read'`
// (the only path that invokes auto-heal); future trigger sources (e.g. a
// timed reconcile pass) can extend the literal union without a schema bump.
// `caller` records WHICH read-side service drove the heal so per-caller
// telemetry can be tabulated (planContext is best-effort hint; the other
// three are authoritative read paths).
export const knowledgeMetaAutoHealedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_meta_auto_healed"),
  previous_revision_hash: z.string(),
  revision_hash: z.string(),
  trigger: z.literal("read"),
  caller: z.enum(["planContext", "getKnowledgeSections", "getKnowledge", "extractKnowledge"]).optional(),
});

// v2.0.0-rc.23 TASK-010 (e): emitted by `fabric doctor --fix` when a stale
// `.fabric/.serve.lock` file holding a dead PID is unlinked. The lock is
// written by `acquireLock` at the top of `fabric serve` and released on graceful
// shutdown; a SIGKILL / crash leaves the file behind, blocking subsequent
// serve attempts with a confusing 423 error. The doctor advisory + --fix
// unlink restores the workspace to a serveable state. One event per cleared
// lock per --fix invocation (idempotent: no file → no event).
//
// `pid`: the dead process id recorded in the unlinked lock file.
// `age_ms`: milliseconds since the lock was acquired (Date.now() - acquiredAt).
//   Coarse signal for operator forensics — how long the corpse sat on disk.
export const serveLockClearedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("serve_lock_cleared"),
  pid: z.number().int().nonnegative(),
  age_ms: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});

// v2.0.0-rc.23 TASK-007 (a-C2): emitted by `fabric doctor --enrich-descriptions`
// once per modified canonical knowledge file when one or more of the four
// rc.23 description-grade frontmatter fields (`intent_clues`, `tech_stack`,
// `impact`, `must_read_if`) is back-filled. Audit trail for the legacy
// back-fill pass so operators can correlate description-grade changes with
// the run that produced them. Idempotent: a file already carrying all four
// fields produces no event.
//
// `path`: workspace-relative POSIX path of the rewritten .md file. Personal
//   layer entries use the `~/.fabric/...` prefix so the trail differentiates
//   the two roots.
// `added_fields`: subset of the four field names that the run inserted into
//   the frontmatter (verbatim YAML keys). Always non-empty for an emitted
//   event.
// `mode`: which entry point triggered the rewrite. `auto` writes deterministic
//   stub values without prompting; `interactive` would be the future
//   user-driven branch (currently `auto` is the only emitter, but the enum is
//   pre-locked so future modes can ship without a schema bump).
//
// v2.0.0-rc.29 REVIEW (codex follow-up): TASK-007 M1 split the runtime
// `EnrichDescriptionsMode` into `auto | preview | readonly | interactive` to
// stop labelling a no-write dry-run pass as `interactive`. The ledger enum was
// missed in that pass (caught by tsup DTS, not by tests, because no test
// exercises the ledger-append path for the new modes). Aligning the schema
// avoids a TS2322 at the emit site and preserves the `readonly`/`preview`
// audit-trail granularity that M1 introduced.
export const knowledgeEnrichedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("knowledge_enriched"),
  path: z.string(),
  added_fields: z.array(z.enum(["intent_clues", "tech_stack", "impact", "must_read_if"])),
  mode: z.enum(["auto", "preview", "readonly", "interactive"]),
  timestamp: z.string().datetime(),
});

// v2.0.0-rc.25 TASK-01: emitted by the `fabric-archive` skill at the end of
// every invocation (whether candidates were proposed, viability failed, the
// user dismissed, or there was nothing to extract). Drives the cross-session
// digest in Phase 0.0 of fabric-archive — outcome-based filter (skipped on
// `user_dismissed`), covered_through_ts watermark vs current max event ts for
// rescan candidacy, and the 12h anti-loop cooldown live on top of these
// records. Single source of truth: events.jsonl owns session archive state,
// rc.22 rotation handles row turnover, and `fabric doctor --archive-history`
// (TASK-04) renders the history report directly from this event stream.
//
// `outcome`: closed enum covering the four terminal states of the skill's
//   state machine. `proposed` = at least one candidate written to
//   `.fabric/knowledge/pending/`. `viability_failed` = Phase 0.5 gate
//   rejected the run (candidates existed but failed the quality bar).
//   `user_dismissed` = user explicitly declined to archive (we MUST NOT
//   auto-rescan after this — respects user decision). `skipped_no_signal` =
//   no candidates surfaced in the first place (empty session digest).
// `covered_through_ts`: the latest event `ts` value scanned by this archive
//   run. Compare against current `max(ts)` to decide rescan eligibility.
// `candidates_proposed`: count of pending knowledge entries written. Always 0
//   for outcomes other than `proposed` (defaulted so callers can omit).
// `knowledge_proposed_ids`: stable_ids of the pending entries this run
//   produced (parallel to `candidates_proposed`). Default empty for non-
//   `proposed` outcomes.
export const sessionArchiveAttemptedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("session_archive_attempted"),
  outcome: z.enum(["proposed", "viability_failed", "user_dismissed", "skipped_no_signal"]),
  covered_through_ts: z.number().int().nonnegative(),
  candidates_proposed: z.number().int().nonnegative().default(0),
  knowledge_proposed_ids: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// v2.1 GATE-INSTR (NEW-N-3): 9 interaction-axis instrumentation events.
//
// Source spec: .workflow/.scratchpad/e2e-axis3-v3-delta.md §4 + e2e-methodology-
// FINAL.md:87 (codex round10). These lift the interaction axis (hook→behavior
// delta, skill auto-invoke F1, MCP stdio behavior, LLM-judge auditability) from
// T2/T3 "can't observe today" up to T1-ledger "replayable from events.jsonl".
//
// JOIN-FIELD HARD CONSTRAINT (spec §4): every interaction event carries
// session_id + correlation_id (envelope, optional there but expected here);
// MCP events add request_id; LLM-judge adds input_trace_id. Without these the
// cross-event join (e.g. skill_trigger_candidate ⋈ skill_invocation_started to
// measure false-negatives) cannot reconstruct, so the events would be inert.
// Kept envelope-optional for schema additivity / back-compat; the EMIT sites
// (future wiring) are responsible for always populating them.
// ---------------------------------------------------------------------------

// 1. hook_surface_emitted — a hook rendered knowledge into a client channel.
// Measures hook→behavior delta (what was injected vs. what the agent did).
export const hookSurfaceEmittedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("hook_surface_emitted"),
  hook_name: z.string(),
  client: z.enum(["cc", "codex", "cursor"]),
  target_channel: z.string(),
  rendered_ids: z.array(z.string()),
  delivery_status: z.enum(["delivered", "suppressed", "error"]),
  suppression_reason: z.string().optional(),
});

// 2. hook_signal_emitted — a nudge signal (archive/review/maintenance hint)
// evaluated its threshold. Measures nudge-trigger logic (fired vs. not).
export const hookSignalEmittedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("hook_signal_emitted"),
  signal_type: z.enum(["archive", "review", "maintenance", "other"]),
  threshold: z.number(),
  actual_value: z.number(),
  fired: z.boolean(),
});

// 3. mcp_stdio_trace — one MCP stdio tool round-trip. Measures MCP call
// behavior (latency / payload size / errors). request_id is the join key.
export const mcpStdioTraceEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("mcp_stdio_trace"),
  tool_name: z.string(),
  request_id: z.string(),
  duration_ms: z.number().nonnegative(),
  status: z.enum(["ok", "error"]),
  payload_bytes_in: z.number().int().nonnegative(),
  payload_bytes_out: z.number().int().nonnegative(),
  error_code: z.string().optional(),
});

// 4. payload_guard_observed — the ≤4k MCP payload guard ran. Measures
// truncation behavior (G-MCP-PAYLOAD's runtime counterpart).
export const payloadGuardObservedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("payload_guard_observed"),
  tool_name: z.string(),
  path_count: z.number().int().nonnegative(),
  tokens_estimated: z.number().int().nonnegative(),
  truncated: z.boolean(),
  cap: z.number().int().positive(),
});

// 5. skill_invocation_started — a skill began. trigger_source distinguishes
// user-typed vs. auto-invoke vs. AI self-trigger (the cite/self-archive E3).
export const skillInvocationStartedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("skill_invocation_started"),
  skill_name: z.string(),
  trigger_source: z.enum(["user", "auto_invoke", "ai_self_trigger", "chained"]),
  entry_point: z.string(),
});

// 6. skill_invocation_completed — a skill finished. outcome closes the loop
// opened by skill_invocation_started (join via correlation_id).
export const skillInvocationCompletedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("skill_invocation_completed"),
  skill_name: z.string(),
  trigger_source: z.enum(["user", "auto_invoke", "ai_self_trigger", "chained"]),
  entry_point: z.string(),
  outcome: z.enum(["completed", "aborted", "error", "no_op"]),
  elapsed_ms: z.number().nonnegative().optional(),
});

// 7. skill_phase_transition — phase-level telemetry within a skill run.
export const skillPhaseTransitionEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("skill_phase_transition"),
  skill_name: z.string(),
  phase: z.string(),
  status: z.enum(["entered", "completed", "skipped", "failed"]),
  checkpoint: z.string().optional(),
  elapsed_ms: z.number().nonnegative().optional(),
});

// 8. skill_trigger_candidate — a moment where a skill COULD have auto-invoked
// (signal present). Joined with skill_invocation_started it yields auto-invoke
// false-negatives (candidate fired but no invocation = should-have-triggered).
export const skillTriggerCandidateEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("skill_trigger_candidate"),
  skill_name: z.string(),
  trigger_source: z.enum(["user", "auto_invoke", "ai_self_trigger", "chained"]),
  signal: z.string(),
  invoked: z.boolean(),
});

// 9. llm_judge_run — an LLM-judge scored a T3 quality dimension. input_trace_id
// links the judged artifact back to its producing run (T3 auditability).
export const llmJudgeRunEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("llm_judge_run"),
  prompt: z.string(),
  version: z.string(),
  model: z.string(),
  input_trace_id: z.string(),
  score: z.number(),
  rationale: z.string(),
});

// (9, cont.) client_capability_snapshot — records a client's capability set so
// cross-client behavior deltas (D6 parity) can be attributed to capability gaps.
export const clientCapabilitySnapshotEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("client_capability_snapshot"),
  client: z.enum(["cc", "codex", "cursor"]),
  capabilities: z.array(z.string()),
  version: z.string(),
});

// ---------------------------------------------------------------------------
// lifecycle-refactor Wave 2 — dormant-hook activation markers.
// The previously-inert SessionEnd / PostToolUse / PreCompact hooks append these
// so doctor can reconstruct the surfaced→cited→edited funnel OFFLINE. Front-stage
// stays O(1): hooks only append; ALL join/funnel work is doctor-side (KT-DEC-0007:
// hook = nudge/marker, never a gate).
// ---------------------------------------------------------------------------

// session_ended — SessionEnd marker. Zero compute: the hook only stamps that a
// session boot ended (session_id + ts via the envelope). doctor reconciles the
// per-session funnel offline; the hook does no join.
export const sessionEndedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("session_ended"),
});

// file_mutated — PostToolUse marker closing the mutation env opened by the
// PreToolUse narrow hint. tool_call_id is the per-call key (pairs Pre/Post,
// guards parallel-fire races). source_event_id (optional) links back to the
// hook_surface_emitted that surfaced knowledge for this edit; store_id scopes
// attribution so multi-store never double-counts (attribution key =
// store_id + stable_id + source_event_id, per design §5#7).
export const fileMutatedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("file_mutated"),
  path: z.string(),
  tool_call_id: z.string(),
  tool_name: z.string().optional(),
  source_event_id: z.string().optional(),
  store_id: z.string().optional(),
});

// precompact_observed — PreCompact marker. The injection capability is not yet
// grounded, so this is an inert observation marker only (no payload): it lets
// doctor see compaction cadence without the hook computing anything.
export const precompactObservedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("precompact_observed"),
});

// graph_edge_candidate_requested — emitted by the Stop hook after a successful
// archive. The hook only REQUESTS edge extraction (KT-DEC-0007); the `related`
// edges are produced by the archive/import skill or doctor co-occurrence, never
// by the hook. stable_id = the archived entry whose edges need extraction;
// store qualifies it (edges are store-scoped; KT→KP is forbidden downstream).
export const graphEdgeCandidateRequestedEventSchema = z.object({
  ...eventLedgerEnvelopeSchema,
  event_type: z.literal("graph_edge_candidate_requested"),
  stable_id: z.string(),
  store: z.string().optional(),
});

export const eventLedgerEventSchema = z.discriminatedUnion("event_type", [
  knowledgeContextPlannedEventSchema,
  knowledgeSelectionEventSchema,
  knowledgeSectionsFetchedEventSchema,
  editIntentCheckedEventSchema,
  knowledgeDriftDetectedEventSchema,
  mcpEventLedgerEventSchema,
  reapplyCompletedEventSchema,
  installDiffAppliedEventSchema,
  eventLedgerTruncatedEventSchema,
  mcpConfigMigratedEventSchema,
  // v2.0.0-rc.19 TASK-004: bootstrap_marker_migrated — one-time fabric:knowledge-base
  // → fabric:bootstrap marker rewrite emitted per file by `fabric doctor --fix`.
  bootstrapMarkerMigratedEventSchema,
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
  knowledgeModifiedEventSchema,
  knowledgeLayerChangedEventSchema,
  // v2.0.0-rc.37 NEW-24: dedicated old→new stable_id mapping event
  knowledgeIdRedirectEventSchema,
  knowledgeSlugRenamedEventSchema,
  knowledgeDemotedEventSchema,
  knowledgeArchivedEventSchema,
  knowledgeArchiveAttemptedEventSchema,
  // v2.0.0-rc.34 TASK-05: reverse of knowledge_archived
  knowledgeUnarchivedEventSchema,
  knowledgeDeferredEventSchema,
  knowledgeRejectedEventSchema,
  // v2.0 rc.5 TASK-014: knowledge_consumed (consumption tracking)
  knowledgeConsumedEventSchema,
  // v2.0 rc.5 TASK-012 (C3): knowledge_scope_degraded — narrow→broad auto-degrade
  knowledgeScopeDegradedEventSchema,
  // v2.0 rc.5 TASK-009 (B2): pending_auto_archived — doctor --apply-lint moves
  // pending entries >30d old into the .archive/pending/ subtree.
  pendingAutoArchivedEventSchema,
  // v2.0 rc.5 TASK-013 (C4): knowledge_path_dangled — emitted by doctor lint
  // #24 when a glob in relevance_paths resolves to zero filesystem matches.
  knowledgePathDangledEventSchema,
  // v2.0.0-rc.7 T10: doctor_run — emitted by `fabric doctor` to drive Signal D.
  doctorRunEventSchema,
  // v2.0.0-rc.9 TASK-003 (A3): relevance_migration_run — emitted by
  // `doctor --apply-lint` after the lint #26 frontmatter back-fill pass.
  relevanceMigrationRunEventSchema,
  // v2.0.0-rc.20 TASK-02: assistant_turn_observed — per-turn cite-policy
  // observation (raw KB: line text + parsed cite_ids/cite_tags + client).
  assistantTurnObservedEventSchema,
  // v2.0.0-rc.20 TASK-02: cite_policy_activated — session/policy-bump
  // marker recording when a given policy_version became active.
  citePolicyActivatedEventSchema,
  // v2.0.0-rc.24 TASK-01: cite_contract_policy_activated — drift-gated
  // idempotent marker opening the contract-policy audit window. Distinct
  // from cite_policy_activated so contract metrics get their own window.
  citeContractPolicyActivatedEventSchema,
  // v2.0.0-rc.22 Scope D T-D1: knowledge_meta_auto_healed — emitted by
  // loadActiveMeta when read-path drift triggers an in-place meta rebuild.
  knowledgeMetaAutoHealedEventSchema,
  // v2.0.0-rc.22 Scope A T3: events_rotated — emitted as the first line of
  // the post-rotation events.jsonl when sliding-window-by-age rotation moves
  // stale entries to events.archive/events-rotated-YYYY-MM-DD.jsonl.
  eventsRotatedEventSchema,
  // v2.0.0-rc.23 TASK-010 (e): serve_lock_cleared — emitted by
  // `fabric doctor --fix` when a stale `.fabric/.serve.lock` with a dead PID is
  // unlinked.
  serveLockClearedEventSchema,
  // v2.0.0-rc.23 TASK-007 (a-C2): knowledge_enriched — emitted by
  // `fabric doctor --enrich-descriptions` once per modified canonical knowledge
  // file when one or more of the four rc.23 description-grade frontmatter
  // fields is back-filled.
  knowledgeEnrichedEventSchema,
  // v2.0.0-rc.25 TASK-01: session_archive_attempted — emitted by the
  // fabric-archive skill at the end of every invocation. Drives Phase 0.0
  // cross-session digest, outcome-based rescan filter (skips user_dismissed),
  // covered_through_ts watermark, and `fabric doctor --archive-history`.
  sessionArchiveAttemptedEventSchema,
  // v2.1 GATE-INSTR (NEW-N-3): 9 interaction-axis instrumentation events.
  hookSurfaceEmittedEventSchema,
  hookSignalEmittedEventSchema,
  mcpStdioTraceEventSchema,
  payloadGuardObservedEventSchema,
  skillInvocationStartedEventSchema,
  skillInvocationCompletedEventSchema,
  skillPhaseTransitionEventSchema,
  skillTriggerCandidateEventSchema,
  llmJudgeRunEventSchema,
  clientCapabilitySnapshotEventSchema,
  // lifecycle-refactor Wave 2 — dormant-hook activation markers.
  sessionEndedEventSchema,
  fileMutatedEventSchema,
  precompactObservedEventSchema,
  graphEdgeCandidateRequestedEventSchema,
]);

export type KnowledgeContextPlannedEvent = z.infer<typeof knowledgeContextPlannedEventSchema>;
export type KnowledgeSelectionEvent = z.infer<typeof knowledgeSelectionEventSchema>;
export type KnowledgeSectionsFetchedEvent = z.infer<typeof knowledgeSectionsFetchedEventSchema>;
export type EditIntentCheckedEvent = z.infer<typeof editIntentCheckedEventSchema>;
export type KnowledgeDriftDetectedEvent = z.infer<typeof knowledgeDriftDetectedEventSchema>;
export type McpEventLedgerEvent = z.infer<typeof mcpEventLedgerEventSchema>;
export type ReapplyCompletedEvent = z.infer<typeof reapplyCompletedEventSchema>;
export type InstallDiffAppliedEvent = z.infer<typeof installDiffAppliedEventSchema>;
export type EventLedgerTruncatedEvent = z.infer<typeof eventLedgerTruncatedEventSchema>;
export type McpConfigMigratedEvent = z.infer<typeof mcpConfigMigratedEventSchema>;
export type BootstrapMarkerMigratedEvent = z.infer<typeof bootstrapMarkerMigratedEventSchema>;
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
export type KnowledgeModifiedEvent = z.infer<typeof knowledgeModifiedEventSchema>;
export type KnowledgeLayerChangedEvent = z.infer<typeof knowledgeLayerChangedEventSchema>;
export type KnowledgeIdRedirectEvent = z.infer<typeof knowledgeIdRedirectEventSchema>;
export type KnowledgeSlugRenamedEvent = z.infer<typeof knowledgeSlugRenamedEventSchema>;
export type KnowledgeDemotedEvent = z.infer<typeof knowledgeDemotedEventSchema>;
export type KnowledgeArchivedEvent = z.infer<typeof knowledgeArchivedEventSchema>;
export type KnowledgeArchiveAttemptedEvent = z.infer<typeof knowledgeArchiveAttemptedEventSchema>;
export type KnowledgeUnarchivedEvent = z.infer<typeof knowledgeUnarchivedEventSchema>;
export type KnowledgeDeferredEvent = z.infer<typeof knowledgeDeferredEventSchema>;
export type KnowledgeRejectedEvent = z.infer<typeof knowledgeRejectedEventSchema>;
export type KnowledgeConsumedEvent = z.infer<typeof knowledgeConsumedEventSchema>;
export type KnowledgeScopeDegradedEvent = z.infer<typeof knowledgeScopeDegradedEventSchema>;
export type PendingAutoArchivedEvent = z.infer<typeof pendingAutoArchivedEventSchema>;
export type KnowledgePathDangledEvent = z.infer<typeof knowledgePathDangledEventSchema>;
export type DoctorRunEvent = z.infer<typeof doctorRunEventSchema>;
export type RelevanceMigrationRunEvent = z.infer<typeof relevanceMigrationRunEventSchema>;
export type AssistantTurnObservedEvent = z.infer<typeof assistantTurnObservedEventSchema>;
export type CitePolicyActivatedEvent = z.infer<typeof citePolicyActivatedEventSchema>;
export type CiteContractPolicyActivatedEvent = z.infer<typeof citeContractPolicyActivatedEventSchema>;
export type KnowledgeMetaAutoHealedEvent = z.infer<typeof knowledgeMetaAutoHealedEventSchema>;
export type EventsRotatedEvent = z.infer<typeof eventsRotatedEventSchema>;
export type ServeLockClearedEvent = z.infer<typeof serveLockClearedEventSchema>;
export type KnowledgeEnrichedEvent = z.infer<typeof knowledgeEnrichedEventSchema>;
export type SessionArchiveAttemptedEvent = z.infer<typeof sessionArchiveAttemptedEventSchema>;
// v2.1 GATE-INSTR (NEW-N-3) interaction-axis event types.
export type HookSurfaceEmittedEvent = z.infer<typeof hookSurfaceEmittedEventSchema>;
export type HookSignalEmittedEvent = z.infer<typeof hookSignalEmittedEventSchema>;
export type McpStdioTraceEvent = z.infer<typeof mcpStdioTraceEventSchema>;
export type PayloadGuardObservedEvent = z.infer<typeof payloadGuardObservedEventSchema>;
export type SkillInvocationStartedEvent = z.infer<typeof skillInvocationStartedEventSchema>;
export type SkillInvocationCompletedEvent = z.infer<typeof skillInvocationCompletedEventSchema>;
export type SkillPhaseTransitionEvent = z.infer<typeof skillPhaseTransitionEventSchema>;
export type SkillTriggerCandidateEvent = z.infer<typeof skillTriggerCandidateEventSchema>;
export type LlmJudgeRunEvent = z.infer<typeof llmJudgeRunEventSchema>;
export type ClientCapabilitySnapshotEvent = z.infer<typeof clientCapabilitySnapshotEventSchema>;
// lifecycle-refactor Wave 2 — dormant-hook activation markers.
export type SessionEndedEvent = z.infer<typeof sessionEndedEventSchema>;
export type FileMutatedEvent = z.infer<typeof fileMutatedEventSchema>;
export type PrecompactObservedEvent = z.infer<typeof precompactObservedEventSchema>;
export type GraphEdgeCandidateRequestedEvent = z.infer<typeof graphEdgeCandidateRequestedEventSchema>;
export type EventLedgerEvent =
  | KnowledgeContextPlannedEvent
  | KnowledgeSelectionEvent
  | KnowledgeSectionsFetchedEvent
  | EditIntentCheckedEvent
  | KnowledgeDriftDetectedEvent
  | McpEventLedgerEvent
  | ReapplyCompletedEvent
  | InstallDiffAppliedEvent
  | EventLedgerTruncatedEvent
  | McpConfigMigratedEvent
  | BootstrapMarkerMigratedEvent
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
  | KnowledgeModifiedEvent
  | KnowledgeLayerChangedEvent
  | KnowledgeIdRedirectEvent
  | KnowledgeSlugRenamedEvent
  | KnowledgeDemotedEvent
  | KnowledgeArchivedEvent
  | KnowledgeArchiveAttemptedEvent
  | KnowledgeUnarchivedEvent
  | KnowledgeDeferredEvent
  | KnowledgeRejectedEvent
  | KnowledgeConsumedEvent
  | KnowledgeScopeDegradedEvent
  | PendingAutoArchivedEvent
  | KnowledgePathDangledEvent
  | DoctorRunEvent
  | RelevanceMigrationRunEvent
  | AssistantTurnObservedEvent
  | CitePolicyActivatedEvent
  | CiteContractPolicyActivatedEvent
  | KnowledgeMetaAutoHealedEvent
  | EventsRotatedEvent
  | ServeLockClearedEvent
  | KnowledgeEnrichedEvent
  | SessionArchiveAttemptedEvent
  | HookSurfaceEmittedEvent
  | HookSignalEmittedEvent
  | McpStdioTraceEvent
  | PayloadGuardObservedEvent
  | SkillInvocationStartedEvent
  | SkillInvocationCompletedEvent
  | SkillPhaseTransitionEvent
  | SkillTriggerCandidateEvent
  | LlmJudgeRunEvent
  | ClientCapabilitySnapshotEvent
  | SessionEndedEvent
  | FileMutatedEvent
  | PrecompactObservedEvent
  | GraphEdgeCandidateRequestedEvent;
export type EventLedgerEventType = EventLedgerEvent["event_type"];
type EventLedgerEventInputFor<T extends EventLedgerEvent> = T extends EventLedgerEvent
  ? Omit<T, "kind" | "id" | "ts" | "schema_version" | "correlation_id" | "session_id"> &
      Partial<Pick<T, "id" | "ts" | "correlation_id" | "session_id">>
  : never;
export type EventLedgerEventInput = EventLedgerEventInputFor<EventLedgerEvent>;
