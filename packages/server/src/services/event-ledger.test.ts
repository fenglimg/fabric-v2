import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import { EVENT_LEDGER_PATH } from "./_shared.js";
import { appendEventLedgerEvent, readEventLedger, truncateLedgerToLastNewline } from "./event-ledger.js";

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
      ts: 2_000,
      correlation_id: "corr-1",
      session_id: "session-1",
    });
    const { events: entries, warnings } = await readEventLedger(projectRoot);

    expect(event).toMatchObject({
      kind: "fabric-event",
      schema_version: 1,
      event_type: "knowledge_selection",
      id: expect.stringMatching(/^event:/),
      ts: 2_000,
      correlation_id: "corr-1",
      session_id: "session-1",
    });
    expect(entries).toEqual([event]);
    expect(warnings).toEqual([]);
    expect(await readFile(join(projectRoot, ".fabric", "events.jsonl"), "utf8")).toContain("\"event_type\":\"knowledge_selection\"");
    await expect(readFile(join(projectRoot, ".fabric", ".intent-ledger.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(projectRoot, ".fabric", "audit.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("roundtrips an assistant_turn_observed event preserving cite-policy fields", async () => {
    const projectRoot = await createTempProject();

    const timestamp = new Date(3_000).toISOString();
    const event = await appendEventLedgerEvent(projectRoot, {
      event_type: "assistant_turn_observed",
      kb_line_raw: "KB: bootstrap, ui-rules [planned, recalled]",
      cite_ids: ["bootstrap", "ui-rules"],
      cite_tags: ["planned", "recalled"],
      client: "cc",
      turn_id: "turn-42",
      envelope_index: 0,
      timestamp,
      ts: 3_000,
      correlation_id: "corr-turn",
      session_id: "session-turn",
    });

    const { events: entries, warnings } = await readEventLedger(projectRoot);

    expect(event).toMatchObject({
      kind: "fabric-event",
      schema_version: 1,
      event_type: "assistant_turn_observed",
      kb_line_raw: "KB: bootstrap, ui-rules [planned, recalled]",
      cite_ids: ["bootstrap", "ui-rules"],
      cite_tags: ["planned", "recalled"],
      client: "cc",
      turn_id: "turn-42",
      envelope_index: 0,
      timestamp,
      correlation_id: "corr-turn",
      session_id: "session-turn",
    });
    expect(entries).toEqual([event]);
    expect(warnings).toEqual([]);
  });

  it("roundtrips an assistant_turn_observed event when kb_line_raw is null and defaults apply", async () => {
    const projectRoot = await createTempProject();

    const timestamp = new Date(4_000).toISOString();
    const event = await appendEventLedgerEvent(projectRoot, {
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: [],
      cite_tags: [],
      turn_id: "turn-43",
      timestamp,
      ts: 4_000,
    });

    const { events: entries } = await readEventLedger(projectRoot);

    expect(event).toMatchObject({
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: [],
      cite_tags: [],
      turn_id: "turn-43",
      timestamp,
    });
    expect(entries).toEqual([event]);
  });

  it("roundtrips a cite_policy_activated event preserving policy_version and timestamp", async () => {
    const projectRoot = await createTempProject();

    const timestamp = new Date(5_000).toISOString();
    const event = await appendEventLedgerEvent(projectRoot, {
      event_type: "cite_policy_activated",
      policy_version: "rc.20",
      timestamp,
      ts: 5_000,
      correlation_id: "corr-policy",
      session_id: "session-policy",
    });

    const { events: entries, warnings } = await readEventLedger(projectRoot);

    expect(event).toMatchObject({
      kind: "fabric-event",
      schema_version: 1,
      event_type: "cite_policy_activated",
      policy_version: "rc.20",
      timestamp,
      correlation_id: "corr-policy",
      session_id: "session-policy",
    });
    expect(entries).toEqual([event]);
    expect(warnings).toEqual([]);
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

    const { events: entries } = await readEventLedger(projectRoot);
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
        event_type: "knowledge_selection",
        id: "wrong-kind",
        ts: 1,
        schema_version: 1,
      }),
      JSON.stringify({
        kind: "fabric-event",
        id: "event:context",
        ts: 2_000,
        schema_version: 1,
        event_type: "knowledge_context_planned",
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

    const { events: entries } = await readEventLedger(projectRoot, {
      event_type: "knowledge_context_planned",
      since: 1_500,
      correlation_id: "corr-1",
    });

    expect(entries).toEqual([
      {
        kind: "fabric-event",
        id: "event:context",
        ts: 2_000,
        schema_version: 1,
        event_type: "knowledge_context_planned",
        target_paths: ["src/app.ts"],
        required_stable_ids: ["bootstrap"],
        ai_selectable_stable_ids: [],
        final_stable_ids: ["bootstrap"],
        correlation_id: "corr-1",
      },
    ]);
  });

  describe("partial-write tail tolerance", () => {
    it("returns parsed events and a partial_write_at_tail warning when file lacks trailing newline", async () => {
      const projectRoot = await createTempProject();
      await mkdir(join(projectRoot, ".fabric"), { recursive: true });

      const goodLine = JSON.stringify({
        kind: "fabric-event",
        id: "event:good",
        ts: 1_000,
        schema_version: 1,
        event_type: "mcp_event",
        mcp_event_id: "mcp-good",
        stream_id: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
        correlation_id: "corr-1",
      });
      const partialLine = '{"kind":"fabric-event","ts":2000,"event_type":"mcp_event","partial';

      // No trailing newline — simulates a partial write
      await writeFile(
        join(projectRoot, ".fabric", "events.jsonl"),
        `${goodLine}\n${partialLine}`,
        "utf8",
      );

      const { events, warnings } = await readEventLedger(projectRoot);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ id: "event:good", event_type: "mcp_event" });

      expect(warnings).toHaveLength(1);
      expect(warnings[0].kind).toBe("partial_write_at_tail");
      expect(warnings[0].byte_offset).toBe(Buffer.byteLength(`${goodLine}\n`, "utf8"));
      expect(warnings[0].byte_length).toBe(Buffer.byteLength(partialLine, "utf8"));
      expect(warnings[0].snippet_first_120).toBe(partialLine.slice(0, 120));
    });

    it("returns no warnings when file ends with a newline", async () => {
      const projectRoot = await createTempProject();
      await mkdir(join(projectRoot, ".fabric"), { recursive: true });

      const goodLine = JSON.stringify({
        kind: "fabric-event",
        id: "event:clean",
        ts: 1_000,
        schema_version: 1,
        event_type: "mcp_event",
        mcp_event_id: "mcp-clean",
        stream_id: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
        correlation_id: "corr-1",
      });

      await writeFile(
        join(projectRoot, ".fabric", "events.jsonl"),
        `${goodLine}\n`,
        "utf8",
      );

      const { events, warnings } = await readEventLedger(projectRoot);

      expect(events).toHaveLength(1);
      expect(warnings).toEqual([]);
    });

    it("returns empty events and no warnings for an empty file", async () => {
      const projectRoot = await createTempProject();
      await mkdir(join(projectRoot, ".fabric"), { recursive: true });
      await writeFile(join(projectRoot, ".fabric", "events.jsonl"), "", "utf8");

      const { events, warnings } = await readEventLedger(projectRoot);

      expect(events).toEqual([]);
      expect(warnings).toEqual([]);
    });
  });

  describe("truncateLedgerToLastNewline", () => {
    it("truncates partial trailing bytes and saves them to a .corrupted file", async () => {
      const dir = await createTempDir();
      const ledgerPath = join(dir, "events.jsonl");
      const goodLine = '{"kind":"fabric-event","id":"e1","ts":1,"schema_version":1,"event_type":"reapply_completed","preserved_ledger":true,"preserved_meta":true,"rules_count":0}';
      const partialLine = '{"kind":"fabric-event","partial';

      await writeFile(ledgerPath, `${goodLine}\n${partialLine}`, "utf8");

      const result = await truncateLedgerToLastNewline(ledgerPath);

      expect(result.truncated_bytes).toBe(Buffer.byteLength(partialLine, "utf8"));
      expect(result.corrupted_path).toMatch(/\.corrupted\.\d+$/);
      expect(existsSync(result.corrupted_path)).toBe(true);

      const corruptedContent = await readFile(result.corrupted_path, "utf8");
      expect(corruptedContent).toBe(partialLine);

      const remaining = await readFile(ledgerPath, "utf8");
      expect(remaining).toBe(`${goodLine}\n`);
    });

    it("is a no-op and returns zero when file already ends with a newline", async () => {
      const dir = await createTempDir();
      const ledgerPath = join(dir, "events.jsonl");
      const content = '{"kind":"fabric-event","id":"e1","ts":1,"schema_version":1,"event_type":"reapply_completed","preserved_ledger":true,"preserved_meta":true,"rules_count":0}\n';

      await writeFile(ledgerPath, content, "utf8");

      const result = await truncateLedgerToLastNewline(ledgerPath);

      expect(result.truncated_bytes).toBe(0);
      expect(result.corrupted_path).toBe("");

      // File unchanged
      const remaining = await readFile(ledgerPath, "utf8");
      expect(remaining).toBe(content);
    });

    it("is a no-op for an empty file", async () => {
      const dir = await createTempDir();
      const ledgerPath = join(dir, "events.jsonl");
      await writeFile(ledgerPath, "", "utf8");

      const result = await truncateLedgerToLastNewline(ledgerPath);

      expect(result.truncated_bytes).toBe(0);
      expect(result.corrupted_path).toBe("");
    });

    it("saves entire content to .corrupted when file has no newline at all", async () => {
      const dir = await createTempDir();
      const ledgerPath = join(dir, "events.jsonl");
      const content = '{"partial":true';
      await writeFile(ledgerPath, content, "utf8");

      const result = await truncateLedgerToLastNewline(ledgerPath);

      expect(result.truncated_bytes).toBe(Buffer.byteLength(content, "utf8"));
      expect(existsSync(result.corrupted_path)).toBe(true);

      const remaining = await readFile(ledgerPath, "utf8");
      expect(remaining).toBe("");
    });
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-event-ledger-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fabric-truncate-"));
  tempDirs.push(dir);
  return dir;
}
