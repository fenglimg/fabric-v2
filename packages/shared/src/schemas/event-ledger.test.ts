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
      // v2.0 rc.5 TASK-009 (B2): pending_auto_archived event
      {
        ...base,
        event_type: "pending_auto_archived",
        pending_path: ".fabric/knowledge/pending/decisions/stale.md",
        archived_to: ".fabric/.archive/pending/decisions/stale.md",
        reason: "auto_archive_30d",
      },
      // v2.0 rc.5 TASK-013 (C4): knowledge_path_dangled event — emitted (in
      // future rc.7+ apply-lint behavior) when doctor lint #24 prunes a
      // relevance_paths glob that resolves to zero filesystem matches.
      {
        ...base,
        event_type: "knowledge_path_dangled",
        stable_id: "KT-DEC-0042",
        removed_glob: "src/deleted-feature/**",
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
      "pending_auto_archived",
      "knowledge_path_dangled",
    ]);
  });

  // v2.0.0-rc.22 Scope D T-D1: knowledge_meta_auto_healed round-trip parse
  it("parses knowledge_meta_auto_healed (with and without caller)", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    const withCaller = eventLedgerEventSchema.parse({
      ...base,
      event_type: "knowledge_meta_auto_healed",
      previous_revision_hash: "sha256:old",
      revision_hash: "sha256:new",
      trigger: "read",
      caller: "planContext",
    });
    expect(withCaller).toMatchObject({
      event_type: "knowledge_meta_auto_healed",
      previous_revision_hash: "sha256:old",
      revision_hash: "sha256:new",
      trigger: "read",
      caller: "planContext",
    });

    const withoutCaller = eventLedgerEventSchema.parse({
      ...base,
      event_type: "knowledge_meta_auto_healed",
      previous_revision_hash: "sha256:old",
      revision_hash: "sha256:new",
      trigger: "read",
    });
    expect(withoutCaller).toMatchObject({
      event_type: "knowledge_meta_auto_healed",
    });
    // `caller` is optional — zod strips `undefined` optional fields, so we
    // assert absence rather than literal-undefined (vitest toMatchObject
    // requires the key to be present-with-undefined, which fails for
    // zod-stripped fields).
    expect("caller" in withoutCaller).toBe(false);

    // trigger literal — only 'read' is currently accepted.
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "knowledge_meta_auto_healed",
        previous_revision_hash: "sha256:old",
        revision_hash: "sha256:new",
        trigger: "write",
      }),
    ).toThrow();

    // caller enum is closed — bad values reject.
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "knowledge_meta_auto_healed",
        previous_revision_hash: "sha256:old",
        revision_hash: "sha256:new",
        trigger: "read",
        caller: "unknownCaller",
      }),
    ).toThrow();
  });

  // v2.0.0-rc.29 TASK-003 (BUG-H4): install_diff_applied round-trip parse.
  // Mirrors the cli `appendInstallDiffLedgerEvent` payload at
  // packages/cli/src/commands/install.ts so the server-side schema no longer
  // emits `event_ledger_schema_compat warn` for install-driven events.
  it("parses install_diff_applied with applied/canonical/drifted arrays", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:install-diff",
      ts: 1_700_000_000_000,
      schema_version: 1 as const,
    };
    const parsed = eventLedgerEventSchema.parse({
      ...base,
      event_type: "install_diff_applied",
      applied: [".claude/hooks/fabric-hint.cjs"],
      canonical: [".fabric/AGENTS.md", "AGENTS.md"],
      drifted: [],
    });
    expect(parsed).toMatchObject({
      event_type: "install_diff_applied",
      applied: [".claude/hooks/fabric-hint.cjs"],
      canonical: [".fabric/AGENTS.md", "AGENTS.md"],
      drifted: [],
    });
    // empty arrays still accepted (no-op install run)
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "install_diff_applied",
        applied: [],
        canonical: [],
        drifted: [],
      }),
    ).not.toThrow();
    // applied must be an array, not a string
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "install_diff_applied",
        applied: "single-string",
        canonical: [],
        drifted: [],
      }),
    ).toThrow();
  });

  // v2.0.0-rc.22 Scope A T3: events_rotated round-trip parse + required-field
  // coverage. Mirrors the existing event_ledger_truncated pattern — same
  // envelope, same numeric/string field shape, but adds the cutoff_ts ISO
  // datetime constraint and the archived_count/kept_count nonneg-int pair.
  it("parses events_rotated with all required fields", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    const parsed = eventLedgerEventSchema.parse({
      ...base,
      event_type: "events_rotated",
      cutoff_ts: "2026-04-18T00:00:00.000Z",
      archived_count: 12,
      kept_count: 3,
      archive_path: ".fabric/events.archive/events-rotated-2026-05-18.jsonl",
    });
    expect(parsed).toMatchObject({
      event_type: "events_rotated",
      cutoff_ts: "2026-04-18T00:00:00.000Z",
      archived_count: 12,
      kept_count: 3,
      archive_path: ".fabric/events.archive/events-rotated-2026-05-18.jsonl",
    });
  });

  it("rejects events_rotated when required fields are missing or wrong-typed", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    // missing cutoff_ts
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "events_rotated",
        archived_count: 1,
        kept_count: 1,
        archive_path: ".fabric/events.archive/x.jsonl",
      }),
    ).toThrow();
    // non-ISO cutoff_ts
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "events_rotated",
        cutoff_ts: "yesterday",
        archived_count: 1,
        kept_count: 1,
        archive_path: ".fabric/events.archive/x.jsonl",
      }),
    ).toThrow();
    // negative archived_count
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "events_rotated",
        cutoff_ts: "2026-04-18T00:00:00.000Z",
        archived_count: -1,
        kept_count: 1,
        archive_path: ".fabric/events.archive/x.jsonl",
      }),
    ).toThrow();
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

  // v2.0.0-rc.24 TASK-01: cite_commitments parallel array + cite_contract_policy_activated marker
  it("parses assistant_turn_observed with non-empty cite_commitments (rc.24 contract policy)", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    const parsed = eventLedgerEventSchema.parse({
      ...base,
      event_type: "assistant_turn_observed",
      kb_line_raw: "KB: KT-D-0001 (auth) [recalled] → edit:src/auth/**/* !edit:src/legacy/**/*",
      cite_ids: ["KT-D-0001"],
      cite_tags: ["recalled"],
      cite_commitments: [
        {
          operators: [
            { kind: "edit", target: "src/auth/**/*" },
            { kind: "not_edit", target: "src/legacy/**/*" },
            { kind: "require", target: "tests/auth/*.test.ts" },
            { kind: "forbid", target: "console.log" },
          ],
          skip_reason: null,
        },
      ],
      client: "cc",
      turn_id: "turn-1",
      timestamp: "2026-05-19T10:00:00.000Z",
    });
    expect(parsed).toMatchObject({
      event_type: "assistant_turn_observed",
      cite_commitments: [
        {
          operators: [
            { kind: "edit", target: "src/auth/**/*" },
            { kind: "not_edit", target: "src/legacy/**/*" },
            { kind: "require", target: "tests/auth/*.test.ts" },
            { kind: "forbid", target: "console.log" },
          ],
          skip_reason: null,
        },
      ],
    });
  });

  it("defaults cite_commitments to [] for rc.20-rc.23 events without the field (backward-compat)", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    const parsed = eventLedgerEventSchema.parse({
      ...base,
      event_type: "assistant_turn_observed",
      kb_line_raw: "KB: none [no-relevant]",
      cite_ids: [],
      cite_tags: [],
      turn_id: "turn-legacy",
      timestamp: "2026-05-15T10:00:00.000Z",
    });
    expect(parsed).toMatchObject({
      event_type: "assistant_turn_observed",
      cite_commitments: [],
    });
  });

  it("parses cite_contract_policy_activated marker (rc.24 drift-gated activation)", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
      session_id: "session-1",
    };
    const parsed = eventLedgerEventSchema.parse({
      ...base,
      event_type: "cite_contract_policy_activated",
    });
    expect(parsed).toMatchObject({
      event_type: "cite_contract_policy_activated",
      session_id: "session-1",
    });
  });

  it("rejects cite_commitments operator with unknown kind", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "assistant_turn_observed",
        kb_line_raw: "KB: KT-D-0001 (anchor) [recalled] → delete:foo.ts",
        cite_ids: ["KT-D-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [
          {
            operators: [{ kind: "delete", target: "foo.ts" }],
            skip_reason: null,
          },
        ],
        turn_id: "turn-bad",
        timestamp: "2026-05-19T10:00:00.000Z",
      }),
    ).toThrow();
  });

  // v2.0.0-rc.25 TASK-01: session_archive_attempted variant — closed outcome
  // enum + structured payload. Mirrors rc.20 cite_policy_activated / rc.24
  // cite_contract_policy_activated pre-registration precedent but with real
  // payload fields (not a pure marker).
  it("parses session_archive_attempted with outcome=proposed and non-empty knowledge_proposed_ids", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
      session_id: "session-1",
    };
    const parsed = eventLedgerEventSchema.parse({
      ...base,
      event_type: "session_archive_attempted",
      outcome: "proposed",
      covered_through_ts: 1_779_000_000,
      candidates_proposed: 2,
      knowledge_proposed_ids: ["KT-D-0042", "KT-P-0017"],
    });
    expect(parsed).toMatchObject({
      event_type: "session_archive_attempted",
      outcome: "proposed",
      covered_through_ts: 1_779_000_000,
      candidates_proposed: 2,
      knowledge_proposed_ids: ["KT-D-0042", "KT-P-0017"],
      session_id: "session-1",
    });
  });

  it("parses session_archive_attempted with outcome=viability_failed (defaults applied)", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    const parsed = eventLedgerEventSchema.parse({
      ...base,
      event_type: "session_archive_attempted",
      outcome: "viability_failed",
      covered_through_ts: 1_779_000_000,
    });
    expect(parsed).toMatchObject({
      event_type: "session_archive_attempted",
      outcome: "viability_failed",
      candidates_proposed: 0,
      knowledge_proposed_ids: [],
    });
  });

  it("parses session_archive_attempted with outcome=user_dismissed (anti-rescan signal)", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    const parsed = eventLedgerEventSchema.parse({
      ...base,
      event_type: "session_archive_attempted",
      outcome: "user_dismissed",
      covered_through_ts: 1_779_500_000,
    });
    expect(parsed).toMatchObject({
      event_type: "session_archive_attempted",
      outcome: "user_dismissed",
      covered_through_ts: 1_779_500_000,
      candidates_proposed: 0,
      knowledge_proposed_ids: [],
    });
  });

  it("parses session_archive_attempted with outcome=skipped_no_signal", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    const parsed = eventLedgerEventSchema.parse({
      ...base,
      event_type: "session_archive_attempted",
      outcome: "skipped_no_signal",
      covered_through_ts: 1_779_600_000,
    });
    expect(parsed).toMatchObject({
      event_type: "session_archive_attempted",
      outcome: "skipped_no_signal",
      covered_through_ts: 1_779_600_000,
      candidates_proposed: 0,
      knowledge_proposed_ids: [],
    });
  });

  it("rejects session_archive_attempted with unknown outcome enum value", () => {
    const base = {
      kind: "fabric-event" as const,
      id: "event:test",
      ts: 1_000,
      schema_version: 1 as const,
    };
    expect(() =>
      eventLedgerEventSchema.parse({
        ...base,
        event_type: "session_archive_attempted",
        outcome: "unknown_outcome",
        covered_through_ts: 1_779_000_000,
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
