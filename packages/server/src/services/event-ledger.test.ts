import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gunzipSync } from "node:zlib";

import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";

import { EVENT_LEDGER_PATH } from "./_shared.js";
import {
  __resetOversizeWarnForTests,
  appendEventLedgerEvent,
  dropEventsFromLedger,
  readEventLedger,
  rotateEventLedgerIfNeeded,
  truncateLedgerToLastNewline,
} from "./event-ledger.js";

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

  it("F9 (ISS-002): append acquires + releases the cross-process ledger lock cleanly", async () => {
    const projectRoot = await createTempProject();
    const ledgerPath = join(projectRoot, ".fabric", "events.jsonl");
    await appendEventLedgerEvent(projectRoot, {
      event_type: "event_ledger_truncated",
      byte_offset: 0,
      byte_length: 0,
      corrupted_path: "",
      ts: 1_000,
    });
    // The lock is held only for the critical section — no orphan .lock after.
    expect(existsSync(`${ledgerPath}.lock`)).toBe(false);
  });

  it("F9 (ISS-002): append reclaims a stale ledger lock left by a crashed writer", async () => {
    const projectRoot = await createTempProject();
    const ledgerPath = join(projectRoot, ".fabric", "events.jsonl");
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    // Orphan lock from a crashed holder, stamped well in the past so withFileLock
    // treats it as stale and reclaims it instead of blocking.
    await writeFile(`${ledgerPath}.lock`, "dead-holder");
    const { utimesSync } = await import("node:fs");
    const old = Date.now() / 1000 - 3600;
    utimesSync(`${ledgerPath}.lock`, old, old);
    const event = await appendEventLedgerEvent(projectRoot, {
      event_type: "event_ledger_truncated",
      byte_offset: 0,
      byte_length: 0,
      corrupted_path: "",
      ts: 2_000,
    });
    expect(event.event_type).toBe("event_ledger_truncated");
    const { events } = await readEventLedger(projectRoot);
    expect(events).toHaveLength(1);
    expect(existsSync(`${ledgerPath}.lock`)).toBe(false);
  });

  it("roundtrips an assistant_turn_observed event preserving cite-policy fields", async () => {
    const projectRoot = await createTempProject();

    const timestamp = new Date(3_000).toISOString();
    const event = await appendEventLedgerEvent(projectRoot, {
      event_type: "assistant_turn_observed",
      kb_line_raw: "KB: bootstrap, ui-rules [applied, dismissed]",
      cite_ids: ["bootstrap", "ui-rules"],
      // v2.1.0-rc.1 (ADJ-P4-1): authoring contract is the rc.37 2-state vocab.
      cite_tags: ["applied", "dismissed"],
      cite_commitments: [],
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
      kb_line_raw: "KB: bootstrap, ui-rules [applied, dismissed]",
      cite_ids: ["bootstrap", "ui-rules"],
      cite_tags: ["applied", "dismissed"],
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

  it("remaps a legacy 5-state cite_tags event on read (ADJ-P4-1 full remap)", async () => {
    const projectRoot = await createTempProject();

    // Write a raw legacy JSONL line directly (bypassing the now-2-state typed
    // authoring API) to simulate an rc≤36 event already on disk.
    const legacyLine = JSON.stringify({
      kind: "fabric-event",
      id: "event:legacy-1",
      ts: 3_500,
      schema_version: 1,
      event_type: "assistant_turn_observed",
      kb_line_raw: "KB: KT-DEC-0001 [planned], KP-PAT-0042 [recalled]",
      cite_ids: ["KT-DEC-0001", "KP-PAT-0042"],
      cite_tags: ["planned", "recalled", "chained-from", "dismissed", "none"],
      turn_id: "turn-legacy",
      timestamp: new Date(3_500).toISOString(),
    });
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "events.jsonl"), `${legacyLine}\n`, "utf8");

    const { events: entries } = await readEventLedger(projectRoot);
    expect(entries).toHaveLength(1);
    // Legacy planned/recalled/chained-from collapse to `applied`; dismissed/none
    // pass through. The event is NOT dropped by safeParse.
    expect(entries[0]).toMatchObject({
      event_type: "assistant_turn_observed",
      cite_tags: ["applied", "applied", "applied", "dismissed", "none"],
    });
  });

  it("roundtrips an assistant_turn_observed event when kb_line_raw is null and defaults apply", async () => {
    const projectRoot = await createTempProject();

    const timestamp = new Date(4_000).toISOString();
    const event = await appendEventLedgerEvent(projectRoot, {
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: [],
      cite_tags: [],
      cite_commitments: [],
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
      const w = warnings[0];
      expect(w.kind).toBe("partial_write_at_tail");
      if (w.kind !== "partial_write_at_tail") throw new Error("unreachable");
      expect(w.byte_offset).toBe(Buffer.byteLength(`${goodLine}\n`, "utf8"));
      expect(w.byte_length).toBe(Buffer.byteLength(partialLine, "utf8"));
      expect(w.snippet_first_120).toBe(partialLine.slice(0, 120));
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

    // v2.0.0-rc.27 TASK-010 (audit §2.24): forward-compat classification —
    // lines that fail Zod validation because of schema_version != 1 or an
    // unknown event_type must surface as LedgerWarning entries (previously
    // silently dropped).
    it("emits a schema_version_unsupported warning for rows with schema_version != 1", async () => {
      const projectRoot = await createTempProject();
      await mkdir(join(projectRoot, ".fabric"), { recursive: true });

      const validLine = JSON.stringify({
        kind: "fabric-event",
        id: "event:ok",
        ts: 1_000,
        schema_version: 1,
        event_type: "reapply_completed",
        preserved_ledger: true,
        preserved_meta: true,
        rules_count: 0,
      });
      const legacyLine = JSON.stringify({
        kind: "fabric-event",
        id: "event:legacy",
        ts: 1_001,
        schema_version: 0,
        event_type: "deprecated_event_type_from_rc_0",
      });

      await writeFile(
        join(projectRoot, ".fabric", "events.jsonl"),
        `${validLine}\n${legacyLine}\n`,
        "utf8",
      );

      const { events, warnings } = await readEventLedger(projectRoot);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe("event:ok");

      const versionWarnings = warnings.filter(
        (w) => w.kind === "schema_version_unsupported",
      );
      expect(versionWarnings).toHaveLength(1);
      const w = versionWarnings[0];
      if (w.kind !== "schema_version_unsupported") throw new Error("unreachable");
      expect(w.schema_version).toBe(0);
      expect(w.line_index).toBe(1);
    });

    it("emits an event_type_unknown warning for rows with valid schema_version but unrecognised event_type", async () => {
      const projectRoot = await createTempProject();
      await mkdir(join(projectRoot, ".fabric"), { recursive: true });

      const unknownTypeLine = JSON.stringify({
        kind: "fabric-event",
        id: "event:future",
        ts: 1_002,
        schema_version: 1,
        event_type: "knowledge_telepathy_observed",
      });

      await writeFile(
        join(projectRoot, ".fabric", "events.jsonl"),
        `${unknownTypeLine}\n`,
        "utf8",
      );

      const { events, warnings } = await readEventLedger(projectRoot);
      expect(events).toEqual([]);

      const typeWarnings = warnings.filter(
        (w) => w.kind === "event_type_unknown",
      );
      expect(typeWarnings).toHaveLength(1);
      const w = typeWarnings[0];
      if (w.kind !== "event_type_unknown") throw new Error("unreachable");
      expect(w.event_type).toBe("knowledge_telepathy_observed");
    });

    it("classifies schema_version mismatch BEFORE event_type unknown (priority order)", async () => {
      const projectRoot = await createTempProject();
      await mkdir(join(projectRoot, ".fabric"), { recursive: true });

      const badBothLine = JSON.stringify({
        kind: "fabric-event",
        id: "event:both",
        ts: 1_003,
        schema_version: 2,
        event_type: "knowledge_unicorn_observed",
      });

      await writeFile(
        join(projectRoot, ".fabric", "events.jsonl"),
        `${badBothLine}\n`,
        "utf8",
      );

      const { warnings } = await readEventLedger(projectRoot);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].kind).toBe("schema_version_unsupported");
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

// v2.0.0-rc.22 Scope A T3 — rotateEventLedgerIfNeeded + 50MB soft-warn
describe("rotateEventLedgerIfNeeded", () => {
  it("rotate_noop_when_under_retention: returns rotated:false when all lines are within the retention window", async () => {
    const projectRoot = await createTempProject();
    const now = new Date("2026-05-18T12:00:00.000Z");
    // Two events 5 days old — well inside the 30-day default window.
    const recentTs = now.getTime() - 5 * 86_400_000;
    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-recent-1",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: recentTs,
    });
    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-recent-2",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: recentTs + 1,
    });

    const before = await readFile(join(projectRoot, ".fabric", "events.jsonl"), "utf8");
    const result = await rotateEventLedgerIfNeeded(projectRoot, { now });

    expect(result.rotated).toBe(false);
    expect(result.archivedCount).toBe(0);
    expect(result.keptCount).toBe(2);
    expect(result.archivePath).toBeUndefined();

    // Main file untouched
    const after = await readFile(join(projectRoot, ".fabric", "events.jsonl"), "utf8");
    expect(after).toBe(before);

    // No archive directory was created
    expect(existsSync(join(projectRoot, ".fabric", "events.archive"))).toBe(false);
  });

  it("rotate_size_bounded: archives the oldest retained lines until the ledger fits maxBytes (ISS-025)", async () => {
    const projectRoot = await createTempProject();
    const now = new Date("2026-05-18T12:00:00.000Z");
    // All events are 1 day old → none age-eligible, so ONLY size rotation can
    // trim them. This isolates the new size-based path from age rotation.
    const recentTs = now.getTime() - 1 * 86_400_000;
    for (let i = 0; i < 20; i += 1) {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "mcp_event",
        mcp_event_id: `mcp-${i}`,
        stream_id: "s",
        message: { jsonrpc: "2.0", method: "ping" },
        ts: recentTs + i,
      });
    }
    const path = join(projectRoot, ".fabric", "events.jsonl");
    const fullSize = statSync(path).size;
    const budget = Math.floor(fullSize / 2);

    const result = await rotateEventLedgerIfNeeded(projectRoot, { now, maxBytes: budget });

    // Age rotation alone would be a no-op (everything is within retention); the
    // size budget forces the oldest events out.
    expect(result.rotated).toBe(true);
    expect(result.archivedCount).toBeGreaterThan(0);
    expect(result.archivePath).toBeDefined();
    expect(statSync(path).size).toBeLessThan(fullSize);

    const archiveRaw = await readFile(join(projectRoot, result.archivePath as string), "utf8");
    const mainRaw = await readFile(path, "utf8");
    // Oldest archived, newest retained (chronological eviction).
    expect(archiveRaw).toContain('"mcp_event_id":"mcp-0"');
    expect(mainRaw).toContain('"mcp_event_id":"mcp-19"');
    expect(mainRaw).not.toContain('"mcp_event_id":"mcp-0"');
  });

  it("rotate_partitions_correctly: archives stale lines and keeps recent ones", async () => {
    const projectRoot = await createTempProject();
    const now = new Date("2026-05-18T12:00:00.000Z");
    const oldTs = now.getTime() - 45 * 86_400_000; // past 30d window
    const newTs = now.getTime() - 5 * 86_400_000;

    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-old-1",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: oldTs,
    });
    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-old-2",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: oldTs + 1,
    });
    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-new-1",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: newTs,
    });

    const result = await rotateEventLedgerIfNeeded(projectRoot, { now });

    expect(result.rotated).toBe(true);
    expect(result.archivedCount).toBe(2);
    expect(result.keptCount).toBe(1);
    expect(result.archivePath).toBe(".fabric/events.archive/events-rotated-2026-05-18.jsonl");

    // Archive file contains the two old events
    const archiveContents = await readFile(
      join(projectRoot, ".fabric", "events.archive", "events-rotated-2026-05-18.jsonl"),
      "utf8",
    );
    const archiveLines = archiveContents.split("\n").filter((l) => l.length > 0);
    expect(archiveLines).toHaveLength(2);
    for (const line of archiveLines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed["mcp_event_id"]).toMatch(/^mcp-old-/);
    }

    // Main file now has audit event + 1 kept event
    const { events } = await readEventLedger(projectRoot);
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe("events_rotated");
    expect(events[1].event_type).toBe("mcp_event");
    expect((events[1] as { mcp_event_id: string }).mcp_event_id).toBe("mcp-new-1");
  });

  it("rotate_same_day_appends_archive: second rotation on the same day appends to existing archive file (no new file)", async () => {
    const projectRoot = await createTempProject();
    const now = new Date("2026-05-18T12:00:00.000Z");
    const oldTs = now.getTime() - 45 * 86_400_000;

    // Round 1: write + rotate one old event
    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-round1",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: oldTs,
    });
    const round1 = await rotateEventLedgerIfNeeded(projectRoot, { now });
    expect(round1.rotated).toBe(true);
    expect(round1.archivedCount).toBe(1);

    const archivePath = join(
      projectRoot,
      ".fabric",
      "events.archive",
      "events-rotated-2026-05-18.jsonl",
    );
    const sizeAfterRound1 = statSync(archivePath).size;
    expect(sizeAfterRound1).toBeGreaterThan(0);

    // Round 2: write + rotate another old event on the same calendar day
    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-round2",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: oldTs + 100,
    });
    const round2 = await rotateEventLedgerIfNeeded(projectRoot, { now });
    expect(round2.rotated).toBe(true);
    expect(round2.archivedCount).toBe(1);
    expect(round2.archivePath).toBe(".fabric/events.archive/events-rotated-2026-05-18.jsonl");

    // Archive file grew (append, not overwrite)
    const sizeAfterRound2 = statSync(archivePath).size;
    expect(sizeAfterRound2).toBeGreaterThan(sizeAfterRound1);

    const archiveContents = await readFile(archivePath, "utf8");
    const ids = archiveContents
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => (JSON.parse(l) as Record<string, unknown>)["mcp_event_id"]);
    expect(ids).toEqual(["mcp-round1", "mcp-round2"]);
  });

  it("rotate_new_day_creates_archive: a different rotation day creates a separate archive file", async () => {
    const projectRoot = await createTempProject();
    const day1 = new Date("2026-05-18T12:00:00.000Z");
    const day2 = new Date("2026-05-19T12:00:00.000Z");
    // For both rounds, the events themselves are older than (now - 30d).
    const oldTsRelativeToDay1 = day1.getTime() - 45 * 86_400_000;
    const oldTsRelativeToDay2 = day2.getTime() - 45 * 86_400_000;

    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-day1",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: oldTsRelativeToDay1,
    });
    await rotateEventLedgerIfNeeded(projectRoot, { now: day1 });

    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-day2",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: oldTsRelativeToDay2,
    });
    await rotateEventLedgerIfNeeded(projectRoot, { now: day2 });

    expect(
      existsSync(join(projectRoot, ".fabric", "events.archive", "events-rotated-2026-05-18.jsonl")),
    ).toBe(true);
    expect(
      existsSync(join(projectRoot, ".fabric", "events.archive", "events-rotated-2026-05-19.jsonl")),
    ).toBe(true);
  });

  it("rotate_audit_event_first_line: post-rotation main file's first line is events_rotated with correct counts", async () => {
    const projectRoot = await createTempProject();
    const now = new Date("2026-05-18T12:00:00.000Z");
    const oldTs = now.getTime() - 60 * 86_400_000;
    const newTs = now.getTime() - 1 * 86_400_000;

    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-old",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: oldTs,
    });
    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-new",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: newTs,
    });

    const result = await rotateEventLedgerIfNeeded(projectRoot, { now });
    expect(result.rotated).toBe(true);

    const raw = await readFile(join(projectRoot, ".fabric", "events.jsonl"), "utf8");
    const firstLine = raw.split("\n")[0];
    const firstParsed = JSON.parse(firstLine) as Record<string, unknown>;

    expect(firstParsed["event_type"]).toBe("events_rotated");
    expect(firstParsed["archived_count"]).toBe(1);
    expect(firstParsed["kept_count"]).toBe(1);
    expect(firstParsed["archive_path"]).toBe(
      ".fabric/events.archive/events-rotated-2026-05-18.jsonl",
    );
    // cutoff_ts is ISO datetime equal to now - 30 days.
    const expectedCutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    expect(firstParsed["cutoff_ts"]).toBe(expectedCutoff);
  });

  it("rotate_schema_round_trip: the audit event parses through readEventLedger's schema validator", async () => {
    const projectRoot = await createTempProject();
    const now = new Date("2026-05-18T12:00:00.000Z");
    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-old",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: now.getTime() - 60 * 86_400_000,
    });
    await rotateEventLedgerIfNeeded(projectRoot, { now });

    const { events, warnings } = await readEventLedger(projectRoot, {
      event_type: "events_rotated",
    });
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "fabric-event",
      event_type: "events_rotated",
      archived_count: 1,
      kept_count: 0,
      archive_path: ".fabric/events.archive/events-rotated-2026-05-18.jsonl",
    });
  });

  it("rotate_reads_config_retention: reads fabric_event_retention_days from .fabric/fabric-config.json", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    // Set config to 7 days.
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ fabric_event_retention_days: 7 }),
      "utf8",
    );

    const now = new Date("2026-05-18T12:00:00.000Z");
    // 10 days old — inside default 30d window, but outside the 7d config window.
    const tenDaysOldTs = now.getTime() - 10 * 86_400_000;
    // 2 days old — inside both windows.
    const twoDaysOldTs = now.getTime() - 2 * 86_400_000;

    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-10d",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: tenDaysOldTs,
    });
    await appendEventLedgerEvent(projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: "mcp-2d",
      stream_id: "stream-1",
      message: { jsonrpc: "2.0", method: "ping" },
      ts: twoDaysOldTs,
    });

    const result = await rotateEventLedgerIfNeeded(projectRoot, { now });
    expect(result.rotated).toBe(true);
    expect(result.archivedCount).toBe(1);
    expect(result.keptCount).toBe(1);

    const archive = await readFile(
      join(projectRoot, ".fabric", "events.archive", "events-rotated-2026-05-18.jsonl"),
      "utf8",
    );
    const archivedIds = archive
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => (JSON.parse(l) as Record<string, unknown>)["mcp_event_id"]);
    expect(archivedIds).toEqual(["mcp-10d"]);
  });

  it("rotate is a no-op for an absent main file", async () => {
    const projectRoot = await createTempProject();
    const result = await rotateEventLedgerIfNeeded(projectRoot, {
      now: new Date("2026-05-18T12:00:00.000Z"),
    });
    expect(result.rotated).toBe(false);
    expect(result.archivedCount).toBe(0);
    expect(result.keptCount).toBe(0);
  });
});

describe("appendEventLedgerEvent — 50MB soft-warn (rc.22 Scope A T3)", () => {
  beforeEach(() => {
    __resetOversizeWarnForTests();
  });

  it("soft_warn_50mb_oneshot: writes to stderr exactly once when the ledger crosses 50MB", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    // Pre-seed the ledger with > 50MB of NDJSON content. We hand-write the
    // bytes (instead of looping appendEventLedgerEvent millions of times)
    // because the test is purely about the post-append size check, not
    // about realistic event payloads. The file ends with a trailing newline
    // so subsequent appends do not produce a partial-write warning.
    const filler =
      JSON.stringify({
        kind: "fabric-event",
        id: "event:pad",
        ts: 1_000,
        schema_version: 1,
        event_type: "mcp_event",
        mcp_event_id: "mcp-pad",
        stream_id: "stream-pad",
        message: { padding: "x".repeat(1024) },
      }) + "\n";
    // ~1.1 KB per line — 50_000 lines ≈ 55MB; gives a small safety margin.
    const lineCount = 50_000;
    await writeFile(
      join(projectRoot, ".fabric", "events.jsonl"),
      filler.repeat(lineCount),
      "utf8",
    );
    const seededSize = statSync(join(projectRoot, ".fabric", "events.jsonl")).size;
    expect(seededSize).toBeGreaterThan(50 * 1024 * 1024);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "mcp_event",
        mcp_event_id: "mcp-warn-1",
        stream_id: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
        ts: 2_000,
      });
      await appendEventLedgerEvent(projectRoot, {
        event_type: "mcp_event",
        mcp_event_id: "mcp-warn-2",
        stream_id: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
        ts: 3_000,
      });

      const warnCalls = stderrSpy.mock.calls.filter((call) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("events.jsonl > 50MB"),
      );
      expect(warnCalls).toHaveLength(1);
      // ISS-025: the warn now announces auto-rotation (append size-triggers it).
      expect(warnCalls[0][0]).toBe(
        'fabric: events.jsonl > 50MB, auto-rotating (also run "fabric doctor --fix" to inspect)\n',
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("does not warn when the ledger stays under 50MB", async () => {
    const projectRoot = await createTempProject();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "mcp_event",
        mcp_event_id: "mcp-small",
        stream_id: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
        ts: 1_000,
      });
      const warnCalls = stderrSpy.mock.calls.filter((call) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("events.jsonl > 50MB"),
      );
      expect(warnCalls).toHaveLength(0);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("appendEventLedgerEvent — per-field truncate (rc.37 NEW-14)", () => {
  it("truncates a string field exceeding 4 KB and appends a sentinel marker", async () => {
    const projectRoot = await createTempProject();
    const longReason = "x".repeat(8 * 1024); // 8 KB > 4 KB cap
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_proposed",
      timestamp: new Date().toISOString(),
      reason: longReason,
    });
    const { events } = await readEventLedger(projectRoot, {
      event_type: "knowledge_proposed",
    });
    expect(events).toHaveLength(1);
    const persisted = (events[0] as { reason: string }).reason;
    expect(persisted.length).toBeLessThan(longReason.length);
    expect(persisted).toContain("[truncated: rc.37 NEW-14 4KB cap]");
    expect(Buffer.byteLength(persisted, "utf8")).toBeLessThanOrEqual(4 * 1024);
  });

  it("leaves a small string field untouched", async () => {
    const projectRoot = await createTempProject();
    const smallReason = "ok";
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_proposed",
      timestamp: new Date().toISOString(),
      reason: smallReason,
    });
    const { events } = await readEventLedger(projectRoot, {
      event_type: "knowledge_proposed",
    });
    expect((events[0] as { reason: string }).reason).toBe("ok");
  });
});

describe("dropEventsFromLedger — gzip archive (rc.39 T6)", () => {
  async function seedLedger(projectRoot: string, lines: Record<string, unknown>[]): Promise<void> {
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "events.jsonl"),
      lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      "utf8",
    );
  }

  it("writes the archive gzip-compressed (.jsonl.gz) and rewrites the main ledger without the dropped events", async () => {
    const projectRoot = await createTempProject();
    const now = new Date("2026-05-29T12:00:00.000Z");
    await seedLedger(projectRoot, [
      { kind: "fabric-event", id: "event:keep-1", ts: now.getTime(), schema_version: 1, event_type: "doctor_run" },
      { kind: "fabric-event", id: "event:drop-1", ts: now.getTime(), schema_version: 1, event_type: "assistant_turn_observed", kb_line_raw: null, cite_ids: [], cite_commitments: [] },
      { kind: "fabric-event", id: "event:drop-2", ts: now.getTime(), schema_version: 1, event_type: "assistant_turn_observed", kb_line_raw: null, cite_ids: [], cite_commitments: [] },
    ]);

    const result = await dropEventsFromLedger(projectRoot, {
      label: "empty-shell-fold",
      now,
      predicate: (p) => p["event_type"] === "assistant_turn_observed",
    });

    expect(result.rotated).toBe(true);
    expect(result.archivedCount).toBe(2);
    expect(result.archivePath).toBe(".fabric/events.archive/events-empty-shell-fold-2026-05-29.jsonl.gz");

    // Archive is a real gzip stream that decompresses to the two dropped events.
    const gzPath = join(projectRoot, ".fabric", "events.archive", "events-empty-shell-fold-2026-05-29.jsonl.gz");
    expect(existsSync(gzPath)).toBe(true);
    const decompressed = gunzipSync(await readFile(gzPath)).toString("utf8");
    const archivedLines = decompressed.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
    expect(archivedLines.map((e) => e.id)).toEqual(["event:drop-1", "event:drop-2"]);
    // No uncompressed .jsonl twin was left behind.
    expect(existsSync(join(projectRoot, ".fabric", "events.archive", "events-empty-shell-fold-2026-05-29.jsonl"))).toBe(false);

    // Main ledger keeps the non-matching event and drops the two turns. Assert
    // against the raw file (the kept event is a minimal hand-crafted shape, so
    // readEventLedger's schema validation is bypassed here on purpose).
    const mainRaw = await readFile(join(projectRoot, ".fabric", "events.jsonl"), "utf8");
    expect(mainRaw).toContain("event:keep-1");
    expect(mainRaw).not.toContain("event:drop-1");
    expect(mainRaw).not.toContain("event:drop-2");
  });

  it("same-day same-label re-run appends into the existing .gz (decompress → concat → recompress)", async () => {
    const projectRoot = await createTempProject();
    const now = new Date("2026-05-29T12:00:00.000Z");
    await seedLedger(projectRoot, [
      { kind: "fabric-event", id: "event:a", ts: now.getTime(), schema_version: 1, event_type: "assistant_turn_observed", kb_line_raw: null, cite_ids: [], cite_commitments: [] },
    ]);
    await dropEventsFromLedger(projectRoot, { label: "empty-shell-fold", now, predicate: (p) => p["event_type"] === "assistant_turn_observed" });

    // Second batch, same day + label — re-seed the main ledger with a new turn.
    await seedLedger(projectRoot, [
      { kind: "fabric-event", id: "event:b", ts: now.getTime() + 1, schema_version: 1, event_type: "assistant_turn_observed", kb_line_raw: null, cite_ids: [], cite_commitments: [] },
    ]);
    await dropEventsFromLedger(projectRoot, { label: "empty-shell-fold", now, predicate: (p) => p["event_type"] === "assistant_turn_observed" });

    const gzPath = join(projectRoot, ".fabric", "events.archive", "events-empty-shell-fold-2026-05-29.jsonl.gz");
    const decompressed = gunzipSync(await readFile(gzPath)).toString("utf8");
    const ids = decompressed.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l).id);
    // Both batches present — the second run appended, not overwrote.
    expect(ids).toContain("event:a");
    expect(ids.length).toBeGreaterThanOrEqual(2);
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
