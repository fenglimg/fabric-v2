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
        event_type: "rule_context_planned",
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
        event_type: "rule_selection",
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
        event_type: "rule_sections_fetched",
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
        event_type: "rule_drift_detected",
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
        event_type: "rule_baseline_accepted",
        revision: "rev-b",
        previous_revision: "rev-a",
        accepted_stable_ids: ["bootstrap", "ui-rules"],
        source: "sync_meta",
      },
      {
        ...base,
        event_type: "baseline_synced",
        revision: "rev-b",
        previous_revision: "rev-a",
        synced_files: ["src/app.ts"],
        accepted_stable_ids: ["bootstrap", "ui-rules"],
        source: "sync_meta",
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
      "rule_context_planned",
      "rule_selection",
      "rule_sections_fetched",
      "edit_intent_checked",
      "rule_drift_detected",
      "rule_baseline_accepted",
      "baseline_synced",
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
});
