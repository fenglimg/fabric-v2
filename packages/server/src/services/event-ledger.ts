import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  eventLedgerEventSchema,
  type EventLedgerEvent,
  type EventLedgerEventInput,
} from "@fenglimg/fabric-shared";
import { createLedgerWriteQueue } from "@fenglimg/fabric-shared/node/atomic-write";

import { ensureParentDirectory, getEventLedgerPath, sha256 } from "./_shared.js";

const ledgerQueue = createLedgerWriteQueue();

export type StoredEventLedgerEvent = EventLedgerEvent;

export type ReadEventLedgerOptions = {
  event_type?: EventLedgerEvent["event_type"];
  since?: number;
  correlation_id?: string;
  session_id?: string;
};

export async function appendEventLedgerEvent(
  projectRoot: string,
  event: EventLedgerEventInput,
): Promise<StoredEventLedgerEvent> {
  const eventPath = getEventLedgerPath(projectRoot);
  const nextEvent = eventLedgerEventSchema.parse({
    ...event,
    kind: "fabric-event",
    id: event.id ?? `event:${randomUUID()}`,
    ts: event.ts ?? Date.now(),
    schema_version: 1,
  });

  await ensureParentDirectory(eventPath);
  await ledgerQueue.append(eventPath, JSON.stringify(nextEvent));

  return nextEvent;
}

export async function readEventLedger(
  projectRoot: string,
  options: ReadEventLedgerOptions = {},
): Promise<StoredEventLedgerEvent[]> {
  const eventPath = getEventLedgerPath(projectRoot);
  let raw: string;

  try {
    raw = await readFile(eventPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => parseEventLedgerLine(line, index))
    .filter((entry): entry is StoredEventLedgerEvent => entry !== null)
    .filter((entry) => options.event_type === undefined || entry.event_type === options.event_type)
    .filter((entry) => options.since === undefined || entry.ts >= options.since)
    .filter((entry) => options.correlation_id === undefined || entry.correlation_id === options.correlation_id)
    .filter((entry) => options.session_id === undefined || entry.session_id === options.session_id);
}

function parseEventLedgerLine(line: string, index: number): StoredEventLedgerEvent | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const result = eventLedgerEventSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }

    return {
      ...result.data,
      id: result.data.id || createDerivedId(index, line),
    };
  } catch {
    return null;
  }
}

function createDerivedId(index: number, line: string): string {
  return `event:${index + 1}:${sha256(line).slice("sha256:".length)}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
