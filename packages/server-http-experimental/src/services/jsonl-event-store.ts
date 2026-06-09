import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import type {
  EventId,
  EventStore,
  StreamId,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import {
  appendEventLedgerEvent,
  getEventLedgerPath,
  getLedgerPath,
  getLegacyLedgerPath,
  readEventLedger,
} from "@fenglimg/fabric-server";

type StoredMcpEvent = {
  kind: "mcp-event";
  eventId: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
};

type CachedMcpEvents = {
  fingerprint: string;
  events: StoredMcpEvent[];
};

export class JsonlEventStore implements EventStore {
  private cachedEvents: CachedMcpEvents | undefined;

  constructor(private readonly projectRoot: string) {}

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const eventId = randomUUID();

    await appendEventLedgerEvent(this.projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: eventId,
      stream_id: streamId,
      message,
    });

    this.cachedEvents = undefined;
    return eventId;
  }

  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    const events = await this.readEvents();

    return events.find((event) => event.eventId === eventId)?.streamId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    const events = await this.readEvents();
    const startIndex = events.findIndex((event) => event.eventId === lastEventId);

    if (startIndex === -1) {
      throw new Error(`Unknown event ID: ${lastEventId}`);
    }

    const streamId = events[startIndex]?.streamId;
    if (streamId === undefined) {
      throw new Error(`Missing stream for event ID: ${lastEventId}`);
    }

    for (const event of events.slice(startIndex + 1)) {
      if (event.streamId !== streamId) {
        continue;
      }

      await send(event.eventId, event.message);
    }

    return streamId;
  }

  private async readEvents(): Promise<StoredMcpEvent[]> {
    const fingerprint = await readMcpEventLedgerFingerprint(this.projectRoot);
    if (this.cachedEvents?.fingerprint === fingerprint) {
      return this.cachedEvents.events;
    }

    const events = await this.readEventsUncached();
    this.cachedEvents = { fingerprint, events };
    return events;
  }

  private async readEventsUncached(): Promise<StoredMcpEvent[]> {
    const { events: eventLedgerEvents } = await readEventLedger(this.projectRoot, {
      event_type: "mcp_event",
    });
    const projectedEvents = eventLedgerEvents.flatMap((event): StoredMcpEvent[] => {
      if (event.event_type !== "mcp_event") {
        return [];
      }

      return [{
        kind: "mcp-event",
        eventId: event.mcp_event_id,
        streamId: event.stream_id,
        message: event.message as JSONRPCMessage,
      }];
    });

    if (projectedEvents.length > 0) {
      return projectedEvents;
    }

    let raw: string;

    try {
      raw = await readFile(getLedgerPath(this.projectRoot), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        try {
          raw = await readFile(getLegacyLedgerPath(this.projectRoot), "utf8");
        } catch (legacyError) {
          if (isNodeError(legacyError) && legacyError.code === "ENOENT") {
            return [];
          }

          throw legacyError;
        }
      } else {
        throw error;
      }
    }

    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => parseStoredMcpEvent(line))
      .filter((event): event is StoredMcpEvent => event !== null);
  }
}

async function readMcpEventLedgerFingerprint(projectRoot: string): Promise<string> {
  const paths = [
    getEventLedgerPath(projectRoot),
    getLedgerPath(projectRoot),
    getLegacyLedgerPath(projectRoot),
  ];
  const fingerprints = await Promise.all(paths.map((path) => readFileFingerprint(path)));
  return fingerprints.join("|");
}

async function readFileFingerprint(path: string): Promise<string> {
  try {
    const stats = await stat(path);
    return `${path}:${stats.size}:${stats.mtimeMs}`;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return `${path}:missing`;
    }
    throw error;
  }
}

function parseStoredMcpEvent(line: string): StoredMcpEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<StoredMcpEvent>;

    if (
      parsed.kind !== "mcp-event" ||
      typeof parsed.eventId !== "string" ||
      typeof parsed.streamId !== "string" ||
      parsed.message === undefined
    ) {
      return null;
    }

    return {
      kind: "mcp-event",
      eventId: parsed.eventId,
      streamId: parsed.streamId,
      message: parsed.message,
    };
  } catch {
    return null;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
