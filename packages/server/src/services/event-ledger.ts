import { randomUUID } from "node:crypto";
import { existsSync, fsyncSync, openSync, closeSync } from "node:fs";
import { readFile, truncate, writeFile } from "node:fs/promises";

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

export type LedgerWarning =
  | { kind: "partial_write_at_tail"; byte_offset: number; byte_length: number; snippet_first_120: string };

export type ReadEventLedgerResult = {
  events: StoredEventLedgerEvent[];
  warnings: LedgerWarning[];
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
): Promise<ReadEventLedgerResult> {
  const eventPath = getEventLedgerPath(projectRoot);
  let raw: string;

  try {
    raw = await readFile(eventPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { events: [], warnings: [] };
    }

    throw error;
  }

  const warnings: LedgerWarning[] = [];

  // Split into lines, mirroring the SSE remainder pattern from events.ts:363-401.
  // If the file does not end with a newline, the last fragment is a partial write.
  const lines = raw.split(/\r?\n/);
  const hasTrailingNewline = raw.endsWith("\n");
  let partialLine: string | undefined;

  if (!hasTrailingNewline && lines.length > 0) {
    partialLine = lines.pop();
  }

  if (partialLine !== undefined && partialLine.trim().length > 0) {
    // Compute byte offset: all bytes before the partial fragment.
    const fullContentBeforePartial = raw.slice(0, raw.length - partialLine.length);
    const byteOffset = Buffer.byteLength(fullContentBeforePartial, "utf8");
    const byteLength = Buffer.byteLength(partialLine, "utf8");
    warnings.push({
      kind: "partial_write_at_tail",
      byte_offset: byteOffset,
      byte_length: byteLength,
      snippet_first_120: partialLine.slice(0, 120),
    });
  }

  const events = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => parseEventLedgerLine(line, index))
    .filter((entry): entry is StoredEventLedgerEvent => entry !== null)
    .filter((entry) => options.event_type === undefined || entry.event_type === options.event_type)
    .filter((entry) => options.since === undefined || entry.ts >= options.since)
    .filter((entry) => options.correlation_id === undefined || entry.correlation_id === options.correlation_id)
    .filter((entry) => options.session_id === undefined || entry.session_id === options.session_id);

  return { events, warnings };
}

/**
 * Truncates the ledger file at the last newline, preserving any partial trailing
 * bytes to a `.corrupted.{timestamp}` sidecar file for forensics.
 *
 * Returns the number of bytes truncated and the path to the corrupted sidecar
 * (empty string when the file was already clean).
 */
export async function truncateLedgerToLastNewline(
  path: string,
): Promise<{ truncated_bytes: number; corrupted_path: string }> {
  const raw = await readFile(path);
  const content = raw.toString("utf8");

  if (content.endsWith("\n") || content.length === 0) {
    return { truncated_bytes: 0, corrupted_path: "" };
  }

  const lastNewlineIndex = content.lastIndexOf("\n");

  if (lastNewlineIndex === -1) {
    // Entire file is one partial line — preserve all of it and truncate to empty.
    const corruptedPath = `${path}.corrupted.${Date.now()}`;
    await writeFile(corruptedPath, raw);
    await truncate(path, 0);
    return { truncated_bytes: raw.length, corrupted_path: corruptedPath };
  }

  // Keep everything up to and including the last newline.
  const keepByteLength = Buffer.byteLength(content.slice(0, lastNewlineIndex + 1), "utf8");
  const corruptedBytes = raw.slice(keepByteLength);
  const corruptedPath = `${path}.corrupted.${Date.now()}`;

  await writeFile(corruptedPath, corruptedBytes);
  await truncate(path, keepByteLength);

  return { truncated_bytes: corruptedBytes.length, corrupted_path: corruptedPath };
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

/**
 * Synchronously fsync the event ledger file to ensure OS page-cache buffers are
 * flushed to durable storage. Must be called AFTER in-flight drain but BEFORE
 * server.close() — Gemini G1 ordering requirement.
 *
 * Uses sync APIs intentionally: we are inside a signal handler and need
 * guaranteed completion before process.exit().
 */
export function flushAndSyncEventLedger(projectRoot: string): void {
  const ledgerPath = getEventLedgerPath(projectRoot);
  if (!existsSync(ledgerPath)) return;
  const fd = openSync(ledgerPath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
