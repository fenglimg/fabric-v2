import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import { EVENT_LEDGER_PATH } from "./_shared.js";
import { appendEventLedgerEvent, readEventLedger } from "./event-ledger.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("event-ledger", () => {
  it("uses .fabric/events.jsonl as the Event Ledger path constant", () => {
    expect(EVENT_LEDGER_PATH).toBe(".fabric/events.jsonl");
  });

  it("appends and reads typed Event Ledger entries without touching legacy files", async () => {
    const projectRoot = await createTempProject();

    const event = await appendEventLedgerEvent(projectRoot, {
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
      ts: 2_000,
      correlation_id: "corr-1",
      session_id: "session-1",
    });
    const entries = await readEventLedger(projectRoot);

    expect(event).toMatchObject({
      kind: "fabric-event",
      schema_version: 1,
      event_type: "rule_selection",
      id: expect.stringMatching(/^event:/),
      ts: 2_000,
      correlation_id: "corr-1",
      session_id: "session-1",
    });
    expect(entries).toEqual([event]);
    expect(await readFile(join(projectRoot, ".fabric", "events.jsonl"), "utf8")).toContain("\"event_type\":\"rule_selection\"");
    await expect(readFile(join(projectRoot, ".fabric", ".intent-ledger.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(projectRoot, ".fabric", "audit.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("tolerates malformed lines and filters readable entries", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "events.jsonl"), [
      "{not json",
      JSON.stringify({
        kind: "audit-event",
        event_type: "rule_selection",
        id: "wrong-kind",
        ts: 1,
        schema_version: 1,
      }),
      JSON.stringify({
        kind: "fabric-event",
        id: "event:context",
        ts: 2_000,
        schema_version: 1,
        event_type: "rule_context_planned",
        target_paths: ["src/app.ts"],
        required_stable_ids: ["bootstrap"],
        ai_selectable_stable_ids: [],
        final_stable_ids: ["bootstrap"],
        correlation_id: "corr-1",
      }),
      JSON.stringify({
        kind: "fabric-event",
        id: "event:mcp",
        ts: 3_000,
        schema_version: 1,
        event_type: "mcp_event",
        mcp_event_id: "mcp-1",
        stream_id: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
        correlation_id: "corr-2",
      }),
    ].join("\n"));

    const entries = await readEventLedger(projectRoot, {
      event_type: "rule_context_planned",
      since: 1_500,
      correlation_id: "corr-1",
    });

    expect(entries).toEqual([
      {
        kind: "fabric-event",
        id: "event:context",
        ts: 2_000,
        schema_version: 1,
        event_type: "rule_context_planned",
        target_paths: ["src/app.ts"],
        required_stable_ids: ["bootstrap"],
        ai_selectable_stable_ids: [],
        final_stable_ids: ["bootstrap"],
        correlation_id: "corr-1",
      },
    ]);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-event-ledger-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}
