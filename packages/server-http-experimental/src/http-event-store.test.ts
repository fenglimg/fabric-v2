import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendEventLedgerEvent: vi.fn(),
  readEventLedger: vi.fn(),
}));

vi.mock("@fenglimg/fabric-server", () => ({
  appendEventLedgerEvent: mocks.appendEventLedgerEvent,
  contextCache: { invalidate: vi.fn() },
  getEventLedgerPath: (projectRoot: string) => `${projectRoot}/.fabric/events.jsonl`,
  getLedgerPath: (projectRoot: string) => `${projectRoot}/.fabric/.intent-ledger.jsonl`,
  getLegacyLedgerPath: (projectRoot: string) => `${projectRoot}/.intent-ledger.jsonl`,
  invalidateKnowledgeSyncCooldown: vi.fn(),
  readEventLedger: mocks.readEventLedger,
}));

import { JsonlEventStore } from "./services/jsonl-event-store.js";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  method: string;
  id: number;
};

function makeMcpEvent(id: string, streamId: string, messageId: number) {
  return {
    event_type: "mcp_event",
    mcp_event_id: id,
    stream_id: streamId,
    message: {
      jsonrpc: "2.0",
      method: "tools/list",
      id: messageId,
    } satisfies JsonRpcMessage,
  };
}

describe("JsonlEventStore", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "fabric-http-event-store-"));
    mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
    writeFileSync(join(projectRoot, ".fabric", "events.jsonl"), "", "utf8");
    mocks.readEventLedger.mockReset();
    mocks.appendEventLedgerEvent.mockReset();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("reuses projected MCP events across repeated lookup and replay calls", async () => {
    mocks.readEventLedger.mockResolvedValue({
      events: [
        makeMcpEvent("event-1", "stream-a", 1),
        makeMcpEvent("event-2", "stream-a", 2),
      ],
      warnings: [],
    });

    const store = new JsonlEventStore(projectRoot);
    const streamId = await store.getStreamIdForEventId("event-1");
    const send = vi.fn();
    const replayStreamId = await store.replayEventsAfter("event-1", { send });

    expect(streamId).toBe("stream-a");
    expect(replayStreamId).toBe("stream-a");
    expect(send).toHaveBeenCalledWith("event-2", {
      jsonrpc: "2.0",
      method: "tools/list",
      id: 2,
    });
    expect(mocks.readEventLedger).toHaveBeenCalledTimes(1);
    expect(mocks.readEventLedger).toHaveBeenCalledWith(projectRoot, { event_type: "mcp_event" });
  });

  it("refreshes the cached projection when the event ledger fingerprint changes", async () => {
    mocks.readEventLedger
      .mockResolvedValueOnce({
        events: [makeMcpEvent("event-1", "stream-a", 1)],
        warnings: [],
      })
      .mockResolvedValueOnce({
        events: [
          makeMcpEvent("event-1", "stream-a", 1),
          makeMcpEvent("event-2", "stream-b", 2),
        ],
        warnings: [],
      });

    const store = new JsonlEventStore(projectRoot);

    await expect(store.getStreamIdForEventId("event-1")).resolves.toBe("stream-a");
    writeFileSync(join(projectRoot, ".fabric", "events.jsonl"), "changed\n", "utf8");
    await expect(store.getStreamIdForEventId("event-2")).resolves.toBe("stream-b");

    expect(mocks.readEventLedger).toHaveBeenCalledTimes(2);
  });
});
