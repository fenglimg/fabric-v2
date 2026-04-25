import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendEditIntentAuditEvents,
  appendGetRulesAuditEvent,
  appendRuleSelectionAuditEvent,
  readAuditLog,
} from "./audit-log.js";

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
    });
    const editEntries = await appendEditIntentAuditEvents(target, {
      affected_paths: ["src/example.ts", "src/missing.ts"],
      intent: "refresh audit coverage",
      ledger_entry_id: "ledger:audit-log",
      ts: 2_000,
      window_ms: 5_000,
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
  });
});

function createFixtureRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempRoots.push(root);
  return root;
}
