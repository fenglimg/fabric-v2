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

  it("serializes concurrent appends without corruption", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });

    const baseEvent = {
      event_type: "mcp_event" as const,
      mcp_event_id: "mcp-concurrent",
      stream_id: "stream-concurrent",
      message: { jsonrpc: "2.0", method: "ping" },
      correlation_id: "corr-concurrent",
    };

    const producers = Array.from({ length: 5 }, (_, i) =>
      appendEventLedgerEvent(projectRoot, {
        ...baseEvent,
        mcp_event_id: `mcp-${i}`,
        session_id: `session-${i}`,
        ts: 1000 + i,
      }),
    );

    await Promise.all(producers);

    const raw = await readFile(join(projectRoot, ".fabric", "events.jsonl"), "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // All 5 lines present
    expect(lines).toHaveLength(5);

    // Each line is valid JSON with no corruption (parseable, no partial content)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed).toHaveProperty("kind", "fabric-event");
      expect(parsed).toHaveProperty("event_type", "mcp_event");
    }

    // All 5 session IDs are present
    const sessionIds = lines.map((l) => (JSON.parse(l) as Record<string, unknown>)["session_id"]);
    expect(sessionIds.sort()).toEqual(["session-0", "session-1", "session-2", "session-3", "session-4"]);

    // No line bleeds into another (each line ends at its own boundary)
    for (const line of lines) {
      const trimmed = line.trim();
      expect(trimmed.startsWith("{")).toBe(true);
      expect(trimmed.endsWith("}")).toBe(true);
    }
  });

  it("recovers from a rejected append without poisoning subsequent writes", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });

    const baseEvent = {
      event_type: "mcp_event" as const,
      mcp_event_id: "mcp-recovery",
      stream_id: "stream-recovery",
      message: { jsonrpc: "2.0", method: "ping" },
      correlation_id: "corr-recovery",
    };

    // Force a failure by writing to a path inside a non-existent sub-directory
    // (we do NOT call ensureParentDirectory, so the queue's doAppend will fail for that path)
    // We directly invoke appendEventLedgerEvent with a projectRoot that has no .fabric dir yet
    const badRoot = await createTempProject();
    // badRoot has no .fabric dir; ensureParentDirectory creates it — so use a truly invalid path
    // by pointing to a file-as-directory situation: write a file then try to append inside it
    const blockingFile = join(badRoot, ".fabric");
    await writeFile(blockingFile, "I am a file, not a dir");
    // Now badRoot/.fabric exists as a FILE — appendEventLedgerEvent will fail when trying to
    // create the directory or write the ledger inside it.
    const failPromise = appendEventLedgerEvent(badRoot, { ...baseEvent, ts: 9000 });
    await expect(failPromise).rejects.toThrow();

    // After the failure, a subsequent write to a GOOD path must succeed
    const goodEvent = await appendEventLedgerEvent(projectRoot, {
      ...baseEvent,
      mcp_event_id: "mcp-after-recovery",
      ts: 10000,
    });
    expect(goodEvent).toMatchObject({
      kind: "fabric-event",
      event_type: "mcp_event",
      mcp_event_id: "mcp-after-recovery",
    });

    const entries = await readEventLedger(projectRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ mcp_event_id: "mcp-after-recovery" });
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
