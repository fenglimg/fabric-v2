import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendEditIntentAuditEvents,
  appendGetRulesAuditEvent,
  appendRuleSelectionAuditEvent,
  readAuditLog,
} from "./audit-log.js";
import { appendEventLedgerEvent, readEventLedger } from "./event-ledger.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe("audit-log", () => {
  it("appends and reads get_rules plus edit_intent telemetry entries", async () => {
    const target = createFixtureRoot("audit-log");

    await appendGetRulesAuditEvent(target, {
      path: "src/example.ts",
      ts: 1_000,
      client_hash: "rev-1",
      correlation_id: "corr-audit",
      session_id: "session-audit",
    });
    const editEntries = await appendEditIntentAuditEvents(target, {
      affected_paths: ["src/example.ts", "src/missing.ts"],
      intent: "refresh audit coverage",
      ledger_entry_id: "ledger:audit-log",
      ts: 2_000,
      window_ms: 5_000,
      correlation_id: "corr-audit",
      session_id: "session-audit",
    });
    const entries = await readAuditLog(target);

    expect(entries).toEqual([
      {
        kind: "audit-event",
        event: "get_rules",
        ts: 1_000,
        path: "src/example.ts",
        client_hash: "rev-1",
      },
      {
        kind: "audit-event",
        event: "edit_intent",
        ts: 2_000,
        path: "src/example.ts",
        compliant: true,
        intent: "refresh audit coverage",
        ledger_entry_id: "ledger:audit-log",
        matched_get_rules_ts: 1_000,
        window_ms: 5_000,
      },
      {
        kind: "audit-event",
        event: "edit_intent",
        ts: 2_000,
        path: "src/missing.ts",
        compliant: false,
        intent: "refresh audit coverage",
        ledger_entry_id: "ledger:audit-log",
        matched_get_rules_ts: null,
        window_ms: 5_000,
      },
    ]);
    expect(editEntries.entries.map((entry) => entry.compliant)).toEqual([true, false]);
    expect(editEntries.compliance).toEqual({
      compliant: false,
      matched_get_rules_ts: new Date(1_000).toISOString(),
      window_ms: 5_000,
    });
    expect(await readEventLedger(target)).toEqual([
      expect.objectContaining({
        event_type: "rule_context_planned",
        target_paths: ["src/example.ts"],
        client_hash: "rev-1",
        correlation_id: "corr-audit",
        session_id: "session-audit",
      }),
      expect.objectContaining({
        event_type: "edit_intent_checked",
        path: "src/example.ts",
        matched_rule_context_ts: 1_000,
        correlation_id: "corr-audit",
        session_id: "session-audit",
      }),
      expect.objectContaining({
        event_type: "edit_intent_checked",
        path: "src/missing.ts",
        matched_rule_context_ts: null,
        correlation_id: "corr-audit",
        session_id: "session-audit",
      }),
    ]);
    await expect(readFile(join(target, ".fabric", "audit.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retains earlier in-window get_rules entries across cursor-based reads", async () => {
    const target = createFixtureRoot("audit-log-window");

    await appendGetRulesAuditEvent(target, {
      path: "src/example.ts",
      ts: 1_000,
      client_hash: "rev-1",
    });

    expect(await readAuditLog(target, { ts: 2_000, windowMs: 5_000 })).toEqual([
      {
        kind: "audit-event",
        event: "get_rules",
        ts: 1_000,
        path: "src/example.ts",
        client_hash: "rev-1",
      },
    ]);

    const firstEdit = await appendEditIntentAuditEvents(target, {
      affected_paths: ["src/example.ts"],
      intent: "first edit",
      ledger_entry_id: "ledger:first",
      ts: 3_000,
      window_ms: 5_000,
    });
    const secondEdit = await appendEditIntentAuditEvents(target, {
      affected_paths: ["src/example.ts"],
      intent: "second edit",
      ledger_entry_id: "ledger:second",
      ts: 4_000,
      window_ms: 5_000,
    });

    expect(firstEdit.compliance.compliant).toBe(true);
    expect(secondEdit.compliance.compliant).toBe(true);
    expect(secondEdit.entries[0]?.matched_get_rules_ts).toBe(1_000);
    expect(await readAuditLog(target, { ts: 4_000, windowMs: 5_000 })).toEqual([
      {
        kind: "audit-event",
        event: "get_rules",
        ts: 1_000,
        path: "src/example.ts",
        client_hash: "rev-1",
      },
      {
        kind: "audit-event",
        event: "edit_intent",
        ts: 3_000,
        path: "src/example.ts",
        compliant: true,
        intent: "first edit",
        ledger_entry_id: "ledger:first",
        matched_get_rules_ts: 1_000,
        window_ms: 5_000,
      },
      {
        kind: "audit-event",
        event: "edit_intent",
        ts: 4_000,
        path: "src/example.ts",
        compliant: true,
        intent: "second edit",
        ledger_entry_id: "ledger:second",
        matched_get_rules_ts: 1_000,
        window_ms: 5_000,
      },
    ]);
  });

  it("appends and reads rule_selection telemetry entries", async () => {
    const target = createFixtureRoot("audit-log-rule-selection");

    await appendRuleSelectionAuditEvent(target, {
      ts: 5_000,
      path: "assets/scripts/ui/BattleView.ts",
      selection_token: "selection:rev:abc",
      target_paths: ["assets/scripts/ui/BattleView.ts"],
      required_stable_ids: ["global-protocol", "battle-view-local"],
      ai_selectable_stable_ids: ["ui-batch-rendering"],
      ai_selected_stable_ids: ["ui-batch-rendering"],
      final_stable_ids: ["global-protocol", "ui-batch-rendering", "battle-view-local"],
      ai_selection_reasons: {
        "ui-batch-rendering": "BattleView touches UI rendering.",
      },
      rejected_stable_ids: [],
      ignored_stable_ids: [],
      correlation_id: "corr-selection",
      session_id: "session-selection",
    });

    expect(await readAuditLog(target)).toEqual([
      {
        kind: "audit-event",
        event: "rule_selection",
        ts: 5_000,
        path: "assets/scripts/ui/BattleView.ts",
        selection_token: "selection:rev:abc",
        target_paths: ["assets/scripts/ui/BattleView.ts"],
        required_stable_ids: ["global-protocol", "battle-view-local"],
        ai_selectable_stable_ids: ["ui-batch-rendering"],
        ai_selected_stable_ids: ["ui-batch-rendering"],
        final_stable_ids: ["global-protocol", "ui-batch-rendering", "battle-view-local"],
        ai_selection_reasons: {
          "ui-batch-rendering": "BattleView touches UI rendering.",
        },
        rejected_stable_ids: [],
        ignored_stable_ids: [],
      },
    ]);
    expect(await readEventLedger(target)).toEqual([
      expect.objectContaining({
        event_type: "rule_selection",
        selection_token: "selection:rev:abc",
        target_paths: ["assets/scripts/ui/BattleView.ts"],
        ai_selection_reasons: {
          "ui-batch-rendering": "BattleView touches UI rendering.",
        },
        correlation_id: "corr-selection",
        session_id: "session-selection",
      }),
    ]);
    await expect(readFile(join(target, ".fabric", "audit.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("projects compatible audit entries from Event Ledger records", async () => {
    const target = createFixtureRoot("audit-log-event-projection");

    await appendEventLedgerEvent(target, {
      event_type: "rule_context_planned",
      id: "event:get-rules",
      ts: 1_000,
      target_paths: ["src/example.ts"],
      required_stable_ids: ["bootstrap"],
      ai_selectable_stable_ids: [],
      final_stable_ids: ["bootstrap"],
      client_hash: "rev-1",
    });
    await appendEventLedgerEvent(target, {
      event_type: "rule_selection",
      id: "event:selection",
      ts: 1_500,
      selection_token: "selection:rev:event",
      target_paths: ["src/example.ts"],
      required_stable_ids: ["bootstrap"],
      ai_selectable_stable_ids: [],
      ai_selected_stable_ids: [],
      final_stable_ids: ["bootstrap"],
      ai_selection_reasons: {},
      rejected_stable_ids: [],
      ignored_stable_ids: [],
    });
    await appendEventLedgerEvent(target, {
      event_type: "edit_intent_checked",
      id: "event:edit",
      ts: 2_000,
      path: "src/example.ts",
      compliant: true,
      intent: "event-only edit",
      ledger_entry_id: "ledger:event",
      matched_rule_context_ts: 1_500,
      window_ms: 5_000,
    });

    expect(await readAuditLog(target)).toEqual([
      {
        kind: "audit-event",
        event: "get_rules",
        ts: 1_000,
        path: "src/example.ts",
        client_hash: "rev-1",
      },
      {
        kind: "audit-event",
        event: "rule_selection",
        ts: 1_500,
        path: "src/example.ts",
        selection_token: "selection:rev:event",
        target_paths: ["src/example.ts"],
        required_stable_ids: ["bootstrap"],
        ai_selectable_stable_ids: [],
        ai_selected_stable_ids: [],
        final_stable_ids: ["bootstrap"],
        ai_selection_reasons: {},
        rejected_stable_ids: [],
        ignored_stable_ids: [],
      },
      {
        kind: "audit-event",
        event: "edit_intent",
        ts: 2_000,
        path: "src/example.ts",
        compliant: true,
        intent: "event-only edit",
        ledger_entry_id: "ledger:event",
        matched_get_rules_ts: 1_500,
        window_ms: 5_000,
      },
    ]);
    expect(await readAuditLog(target, { ts: 2_000, windowMs: 999 })).toHaveLength(2);
  });
});

function createFixtureRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempRoots.push(root);
  return root;
}
