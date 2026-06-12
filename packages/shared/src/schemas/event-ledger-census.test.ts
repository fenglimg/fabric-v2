import { describe, expect, it } from "vitest";

import { eventLedgerEventSchema } from "./event-ledger.js";

// ---------------------------------------------------------------------------
// event_type census invariant — discriminated-union drift gate (fallback-purge
// Wave 0, G-INVARIANT).
//
// `event_type` is dispatched dynamically across emitters (services that append
// ledger rows) and handlers (doctor / read-ledger / metrics consumers) by
// string value, so a "zero grep caller" check cannot prove a member is dead —
// nor catch a member silently added/removed during a deletion pass. This census
// reads the discriminator set straight off the runtime schema and pins it: any
// add/remove to the union fails here first, forcing an explicit review of the
// emitter↔handler pair before the change lands.
// ---------------------------------------------------------------------------

function unionEventTypes(): string[] {
  // zod v3 discriminatedUnion exposes `optionsMap` keyed by discriminator value.
  const schema = eventLedgerEventSchema as unknown as {
    optionsMap?: Map<string, unknown>;
    options?: Array<{ shape: { event_type: { value: string } } }>;
  };
  if (schema.optionsMap) {
    return [...schema.optionsMap.keys()].sort();
  }
  // Fallback: walk options[].shape.event_type.value.
  return (schema.options ?? []).map((o) => o.shape.event_type.value).sort();
}

describe("event_type census", () => {
  it("the discriminated-union member set is pinned (add/remove fails this gate)", () => {
    expect(unionEventTypes()).toMatchInlineSnapshot(`
      [
        "assistant_turn_observed",
        "cite_contract_policy_activated",
        "cite_policy_activated",
        "claude_hook_path_migrated",
        "claude_skill_path_migrated",
        "client_capability_snapshot",
        "codex_skill_path_migrated",
        "doctor_run",
        "edit_intent_checked",
        "event_ledger_truncated",
        "events_rotated",
        "file_mutated",
        "graph_edge_candidate_requested",
        "hook_signal_emitted",
        "hook_surface_emitted",
        "init_scan_completed",
        "install_diff_applied",
        "knowledge_archive_attempted",
        "knowledge_archived",
        "knowledge_consumed",
        "knowledge_context_planned",
        "knowledge_deferred",
        "knowledge_demoted",
        "knowledge_drift_detected",
        "knowledge_enriched",
        "knowledge_id_redirect",
        "knowledge_layer_changed",
        "knowledge_meta_auto_healed",
        "knowledge_modified",
        "knowledge_path_dangled",
        "knowledge_promote_failed",
        "knowledge_promote_started",
        "knowledge_promoted",
        "knowledge_proposed",
        "knowledge_rejected",
        "knowledge_scope_degraded",
        "knowledge_sections_fetched",
        "knowledge_selection",
        "knowledge_slug_renamed",
        "knowledge_unarchived",
        "llm_judge_run",
        "mcp_config_migrated",
        "mcp_event",
        "mcp_stdio_trace",
        "meta_reconciled",
        "meta_reconciled_on_startup",
        "payload_guard_observed",
        "pending_auto_archived",
        "precompact_observed",
        "reapply_completed",
        "relevance_migration_run",
        "serve_lock_cleared",
        "session_archive_attempted",
        "session_ended",
        "skill_invocation_completed",
        "skill_invocation_started",
        "skill_phase_transition",
        "skill_trigger_candidate",
      ]
    `);
  });

  it("every member is a unique non-empty discriminator", () => {
    const types = unionEventTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types).size).toBe(types.length);
    expect(types.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
  });
});
