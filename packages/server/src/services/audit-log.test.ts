import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendEditIntentAuditEvents,
  appendGetRulesAuditEvent,
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
    expect(editEntries.map((entry) => entry.compliant)).toEqual([true, false]);
  });
});

function createFixtureRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempRoots.push(root);
  return root;
}
