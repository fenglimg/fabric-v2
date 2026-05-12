import { describe, expect, it } from "vitest";

import {
  eventLedgerEventSchema,
  type EventLedgerEventType,
} from "./event-ledger.js";

describe("eventLedgerEventSchema", () => {
  it("parses every typed Event Ledger discriminator", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
      correlation_id: "corr-1",
      session_id: "session-1",
    };
    const events = [
      {
        ...base,
        event_type: "knowledge_context_planned",
        target_paths: ["src/app.ts"],
        required_stable_ids: ["bootstrap"],
        ai_selectable_stable_ids: ["ui-rules"],
        final_stable_ids: ["bootstrap", "ui-rules"],
        selection_token: "selection:rev:abc",
        client_hash: "rev-a",
        intent: "change UI",
        known_tech: ["typescript"],
        diagnostics: [{ code: "missing_description", stable_ids: ["legacy"] }],
      },
      {
        ...base,
        event_type: "knowledge_selection",
        selection_token: "selection:rev:abc",
        target_paths: ["src/app.ts"],
        required_stable_ids: ["bootstrap"],
        ai_selectable_stable_ids: ["ui-rules"],
        ai_selected_stable_ids: ["ui-rules"],
        final_stable_ids: ["bootstrap", "ui-rules"],
        ai_selection_reasons: { "ui-rules": "Touches UI." },
        rejected_stable_ids: [],
        ignored_stable_ids: [],
      },
      {
        ...base,
        event_type: "knowledge_sections_fetched",
        selection_token: "selection:rev:abc",
        target_paths: ["src/app.ts"],
        requested_sections: ["MISSION_STATEMENT", "CONTEXT_INFO"],
        final_stable_ids: ["bootstrap", "ui-rules"],
        ai_selected_stable_ids: ["ui-rules"],
        diagnostics: [{ code: "missing_section", stable_id: "ui-rules" }],
      },
      {
        ...base,
        event_type: "edit_intent_checked",
        path: "src/app.ts",
        compliant: true,
        intent: "change UI",
        ledger_entry_id: "ledger:abc",
        matched_rule_context_ts: 900,
        window_ms: 300_000,
      },
      {
        ...base,
        event_type: "knowledge_drift_detected",
        revision: "rev-a",
        drifted_stable_ids: ["ui-rules"],
        missing_files: [],
        stale_files: ["src/app.ts"],
        details: [
          {
            file: "src/app.ts",
            stable_id: "ui-rules",
            expected_hash: "sha256:old",
            actual_hash: "sha256:new",
          },
        ],
      },
      {
        ...base,
        event_type: "mcp_event",
        mcp_event_id: "mcp-1",
        stream_id: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
      },
    ];

    const parsedTypes = events.map((event) => eventLedgerEventSchema.parse(event).event_type);

    expect(parsedTypes).toEqual<EventLedgerEventType[]>([
      "knowledge_context_planned",
      "knowledge_selection",
      "knowledge_sections_fetched",
      "edit_intent_checked",
      "knowledge_drift_detected",
      "mcp_event",
    ]);
  });

  it("rejects unknown Event Ledger discriminators", () => {
    expect(() =>
      eventLedgerEventSchema.parse({
        kind: "fabric-event",
        id: "event:unknown",
        ts: 1,
        schema_version: 1,
        event_type: "unknown",
      }),
    ).toThrow();
  });

  it("parses every pre-registered knowledge.* lifecycle event (TASK-004 grill-followup)", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    const ts = "2026-05-10T12:00:00.000Z";
    const events = [
      { ...base, event_type: "knowledge_proposed", stable_id: "KT-D-0001", timestamp: ts },
      { ...base, event_type: "knowledge_promote_started", stable_id: "KT-D-0001", timestamp: ts },
      { ...base, event_type: "knowledge_promoted", stable_id: "KT-D-0001", timestamp: ts },
      {
        ...base,
        event_type: "knowledge_promote_failed",
        stable_id: "KT-D-0001",
        timestamp: ts,
        reason: "fsync_failed",
      },
      {
        ...base,
        event_type: "knowledge_layer_changed",
        stable_id: "KT-D-0001",
        timestamp: ts,
        from_layer: "team",
        to_layer: "personal",
      },
      {
        ...base,
        event_type: "knowledge_slug_renamed",
        stable_id: "KT-D-0001",
        timestamp: ts,
        from_slug: "old-slug",
        to_slug: "new-slug",
      },
      { ...base, event_type: "knowledge_demoted", stable_id: "KT-D-0001", timestamp: ts },
      { ...base, event_type: "knowledge_archived", stable_id: "KT-D-0001", timestamp: ts },
      { ...base, event_type: "knowledge_archive_attempted", stable_id: "KT-D-0001", timestamp: ts },
      {
        ...base,
        event_type: "knowledge_deferred",
        stable_id: "KT-D-0001",
        timestamp: ts,
        until: "2026-06-01T00:00:00.000Z",
      },
      {
        ...base,
        event_type: "knowledge_rejected",
        stable_id: "KT-D-0001",
        timestamp: ts,
        reason: "duplicate",
      },
      // v2.0 rc.5 TASK-014 (C5): knowledge_consumed event
      {
        ...base,
        event_type: "knowledge_consumed",
        stable_id: "KT-D-0001",
        consumed_at: ts,
        client_hash: "",
      },
    ];

    const parsedTypes = events.map((event) => eventLedgerEventSchema.parse(event).event_type);

    expect(parsedTypes).toEqual<EventLedgerEventType[]>([
      "knowledge_proposed",
      "knowledge_promote_started",
      "knowledge_promoted",
      "knowledge_promote_failed",
      "knowledge_layer_changed",
      "knowledge_slug_renamed",
      "knowledge_demoted",
      "knowledge_archived",
      "knowledge_archive_attempted",
      "knowledge_deferred",
      "knowledge_rejected",
      "knowledge_consumed",
    ]);
  });

  it("requires reason on knowledge_promote_failed and knowledge_rejected (mandatory field)", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    const ts = "2026-05-10T12:00:00.000Z";
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "knowledge_promote_failed",
        stable_id: "KT-D-0001",
        timestamp: ts,
      }),
    ).toThrow();
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "knowledge_rejected",
        stable_id: "KT-D-0001",
        timestamp: ts,
      }),
    ).toThrow();
  });

  it("rejects deleted v1 event types (rule_baseline_accepted, baseline_synced, legacy_client_path_present)", () => {
    const base = {
      kind: "fabric-event",
      id: "event:test",
      ts: 1_000,
      schema_version: 1,
    };
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "rule_baseline_accepted",
        revision: "rev-a",
        accepted_stable_ids: [],
      }),
    ).toThrow();
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "baseline_synced",
        revision: "rev-a",
        synced_files: [],
        accepted_stable_ids: [],
        source: "sync_meta",
      }),
    ).toThrow();
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "legacy_client_path_present",
        removed: [],
      }),
    ).toThrow();
  });
});
