import type { IncomingMessage, ServerResponse } from "node:http";
import { open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  agentsMetaSchema,
  fabricEventSchema,
  ledgerEntrySchema,
  type FabricEvent,
} from "@fenglimg/fabric-shared";
import { eventLedgerEventSchema } from "@fenglimg/fabric-shared";
import chokidar, { type FSWatcher } from "chokidar";
import { resolveLedgerPaths } from "../services/read-ledger.js";
import {
  EVENT_LEDGER_PATH,
  LEGACY_LEDGER_PATH,
  LEDGER_PATH,
  getEventLedgerPath,
  getLedgerPath,
} from "../services/_shared.js";

const AGENTS_META_PATH = ".fabric/agents.meta.json";
const WATCHED_PATHS = [
  AGENTS_META_PATH,
  EVENT_LEDGER_PATH,
  LEDGER_PATH,
  LEGACY_LEDGER_PATH,
] as const;

const CONNECTION_LIMIT = 10;
const HEARTBEAT_INTERVAL_MS = 30_000;
const WATCH_DEBOUNCE_MS = 75;
const RING_BUFFER_CAPACITY = 50;

type EventsRequest = IncomingMessage;
type EventsResponse = ServerResponse<IncomingMessage> & {
  flushHeaders?: () => void;
};

type BufferedEvent = {
  id: number;
  type: string;
  data: string;
};

class RingBuffer {
  private readonly buf: (BufferedEvent | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Array<BufferedEvent | undefined>(capacity).fill(undefined);
  }

  push(event: BufferedEvent): void {
    this.buf[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  replayFrom(afterId: number): BufferedEvent[] {
    const result: BufferedEvent[] = [];
    const total = this.count;
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < total; i++) {
      const entry = this.buf[(start + i) % this.capacity];
      if (entry !== undefined && entry.id > afterId) {
        result.push(entry);
      }
    }
    return result;
  }
}

type EventsState = {
  clients: Set<EventsResponse>;
  watcher?: FSWatcher;
  pendingTimers: Map<string, NodeJS.Timeout>;
  activeLedgerPath: string;
  ledgerOffset: number;
  ledgerRemainder: string;
  eventLedgerOffset: number;
  eventLedgerRemainder: string;
  nextEventId: number;
  ringBuffer: RingBuffer;
};

export type CreateEventsHandlerOptions = {
  projectRoot: string;
};

export function createEventsHandler(options: CreateEventsHandlerOptions) {
  const { projectRoot } = options;
  const state: EventsState = {
    clients: new Set<EventsResponse>(),
    pendingTimers: new Map<string, NodeJS.Timeout>(),
    activeLedgerPath: getLedgerPath(projectRoot),
    ledgerOffset: 0,
    ledgerRemainder: "",
    eventLedgerOffset: 0,
    eventLedgerRemainder: "",
    nextEventId: 1,
    ringBuffer: new RingBuffer(RING_BUFFER_CAPACITY),
  };

  return async function handleEvents(req: EventsRequest, res: EventsResponse): Promise<void> {
    if (state.clients.size >= CONNECTION_LIMIT) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "SSE_CONNECTION_LIMIT",
            message: `Too many SSE clients connected. Limit: ${CONNECTION_LIMIT}.`,
          },
        }),
      );
      return;
    }

    await ensureWatcher(state, projectRoot);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");

    const lastEventId = readLastEventId(req);
    if (lastEventId !== undefined) {
      const missed = state.ringBuffer.replayFrom(lastEventId);
      for (const entry of missed) {
        if (!res.writableEnded) {
          res.write(`id: ${entry.id}\nevent: ${entry.type}\ndata: ${entry.data}\n\n`);
        }
      }
    }

    state.clients.add(res);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, HEARTBEAT_INTERVAL_MS);

    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      clearInterval(heartbeat);
      state.clients.delete(res);

      if (state.clients.size === 0) {
        await stopWatcher(state);
      }
    };

    req.on("aborted", () => {
      void cleanup();
    });
    req.on("close", () => {
      void cleanup();
    });
    res.on("close", () => {
      void cleanup();
    });
    res.on("error", () => {
      void cleanup();
    });
  };
}

async function ensureWatcher(state: EventsState, projectRoot: string): Promise<void> {
  if (state.watcher !== undefined) {
    return;
  }

  const ledgerState = await resolveLedgerWatchState(projectRoot);
  state.activeLedgerPath = ledgerState.path;
  state.ledgerOffset = ledgerState.size;
  state.ledgerRemainder = "";
  state.eventLedgerOffset = await readFileSize(getEventLedgerPath(projectRoot));
  state.eventLedgerRemainder = "";

  const watcher = chokidar.watch([...WATCHED_PATHS], {
    cwd: projectRoot,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 120,
      pollInterval: 20,
    },
  });

  watcher.on("add", (relativePath) => {
    scheduleFileChange(state, projectRoot, normalizePath(relativePath));
  });
  watcher.on("change", (relativePath) => {
    scheduleFileChange(state, projectRoot, normalizePath(relativePath));
  });

  state.watcher = watcher;
}

async function stopWatcher(state: EventsState): Promise<void> {
  const watcher = state.watcher;
  if (watcher === undefined) {
    return;
  }

  state.watcher = undefined;

  for (const timer of state.pendingTimers.values()) {
    clearTimeout(timer);
  }

  state.pendingTimers.clear();
  await watcher.close();
}

function scheduleFileChange(state: EventsState, projectRoot: string, relativePath: string): void {
  if (!WATCHED_PATHS.includes(relativePath as (typeof WATCHED_PATHS)[number])) {
    return;
  }

  const existingTimer = state.pendingTimers.get(relativePath);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    state.pendingTimers.delete(relativePath);
    void publishFileChange(state, projectRoot, relativePath);
  }, WATCH_DEBOUNCE_MS);

  state.pendingTimers.set(relativePath, timer);
}

async function publishFileChange(
  state: EventsState,
  projectRoot: string,
  relativePath: string,
): Promise<void> {
  const events = await readEventsForFile(state, projectRoot, relativePath);

  for (const event of events) {
    broadcastEvent(state, event);
  }
}

async function readEventsForFile(
  state: EventsState,
  projectRoot: string,
  relativePath: string,
): Promise<FabricEvent[]> {
  if (relativePath === AGENTS_META_PATH) {
    const event = await readMetaUpdatedEvent(projectRoot);
    return event === null ? [] : [event];
  }

  if (relativePath === EVENT_LEDGER_PATH) {
    return await readEventLedgerAppendedEvents(state, projectRoot);
  }

  if (relativePath === LEDGER_PATH || relativePath === LEGACY_LEDGER_PATH) {
    return await readLedgerAppendedEvents(state, projectRoot);
  }

  return [];
}

async function readMetaUpdatedEvent(projectRoot: string): Promise<FabricEvent | null> {
  const filePath = join(projectRoot, AGENTS_META_PATH);
  const raw = await readUtf8File(filePath);
  if (raw === null) {
    return null;
  }

  const parsed = agentsMetaSchema.parse(JSON.parse(raw));

  return {
    type: "meta:updated",
    payload: parsed,
  };
}

async function readLedgerAppendedEvents(
  state: EventsState,
  projectRoot: string,
): Promise<FabricEvent[]> {
  const ledgerState = await resolveLedgerWatchState(projectRoot);
  const ledgerPath = ledgerState.path;
  const nextSize = ledgerState.size;

  if (ledgerPath !== state.activeLedgerPath) {
    state.activeLedgerPath = ledgerPath;
    state.ledgerOffset = 0;
    state.ledgerRemainder = "";
  }

  if (nextSize < state.ledgerOffset) {
    state.ledgerOffset = 0;
    state.ledgerRemainder = "";
  }

  if (nextSize === state.ledgerOffset) {
    return [];
  }

  const startOffset = state.ledgerOffset;
  state.ledgerOffset = nextSize;

  const handle = await open(ledgerPath, "r");

  try {
    const length = nextSize - startOffset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, startOffset);

    const chunk = `${state.ledgerRemainder}${buffer.toString("utf8")}`;
    const lines = chunk.split(/\r?\n/);
    state.ledgerRemainder = chunk.endsWith("\n") ? "" : lines.pop() ?? "";

    return lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(parseLedgerAppendedEvent)
      .filter((event): event is FabricEvent => event !== null);
  } finally {
    await handle.close();
  }
}

async function readEventLedgerAppendedEvents(
  state: EventsState,
  projectRoot: string,
): Promise<FabricEvent[]> {
  const eventLedgerPath = getEventLedgerPath(projectRoot);
  const nextSize = await readFileSize(eventLedgerPath);

  if (nextSize < state.eventLedgerOffset) {
    state.eventLedgerOffset = 0;
    state.eventLedgerRemainder = "";
  }

  if (nextSize === state.eventLedgerOffset) {
    return [];
  }

  const startOffset = state.eventLedgerOffset;
  state.eventLedgerOffset = nextSize;

  const handle = await open(eventLedgerPath, "r");

  try {
    const length = nextSize - startOffset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, startOffset);

    const chunk = `${state.eventLedgerRemainder}${buffer.toString("utf8")}`;
    const lines = chunk.split(/\r?\n/);
    state.eventLedgerRemainder = chunk.endsWith("\n") ? "" : lines.pop() ?? "";

    return lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(parseEventLedgerAppendedEvent)
      .filter((event): event is FabricEvent => event !== null);
  } finally {
    await handle.close();
  }
}

async function resolveLedgerWatchState(projectRoot: string): Promise<{ path: string; size: number }> {
  const paths = await resolveLedgerPaths(projectRoot);
  const path = paths.usingLegacy ? paths.legacyPath : paths.primaryPath;
  const size = await readFileSize(path);
  return { path, size };
}

function parseLedgerAppendedEvent(line: string): FabricEvent | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;

    if (parsed.kind === "mcp-event") {
      return null;
    }

    const validation = ledgerEntrySchema.safeParse(parsed);
    if (!validation.success) {
      return null;
    }

    return {
      type: "ledger:appended",
      payload: validation.data,
    };
  } catch {
    return null;
  }
}

function parseEventLedgerAppendedEvent(line: string): FabricEvent | null {
  try {
    const parsed = eventLedgerEventSchema.safeParse(JSON.parse(line));
    if (!parsed.success || parsed.data.event_type !== "edit_intent_checked") {
      return null;
    }

    return {
      type: "ledger:appended",
      payload: {
        id: parsed.data.ledger_entry_id,
        ts: parsed.data.ts,
        source: "ai",
        intent: parsed.data.intent,
        affected_paths: [parsed.data.path],
      },
    };
  } catch {
    return null;
  }
}

function broadcastEvent(state: EventsState, event: FabricEvent): void {
  const payload = fabricEventSchema.parse(event);
  const eventId = state.nextEventId++;
  const data = JSON.stringify(payload);
  const frame = `id: ${eventId}\nevent: ${payload.type}\ndata: ${data}\n\n`;

  state.ringBuffer.push({ id: eventId, type: payload.type, data });

  const disconnectedClients: EventsResponse[] = [];

  for (const client of state.clients) {
    try {
      if (client.writableEnded) {
        disconnectedClients.push(client);
        continue;
      }

      client.write(frame);
    } catch {
      disconnectedClients.push(client);
    }
  }

  for (const client of disconnectedClients) {
    state.clients.delete(client);
    if (!client.writableEnded) {
      client.end();
    }
  }
}


function readLastEventId(req: EventsRequest): number | undefined {
  const header = req.headers["last-event-id"];
  const headerValue = Array.isArray(header) ? header[0] : header;

  const rawUrl = req.url ?? "";
  const queryStart = rawUrl.indexOf("?");
  const queryString = queryStart >= 0 ? rawUrl.slice(queryStart + 1) : "";
  const params = new URLSearchParams(queryString);
  const queryValue = params.get("lastEventId") ?? undefined;

  const raw = headerValue ?? queryValue;
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

async function readUtf8File(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readFileSize(path: string): Promise<number> {
  try {
    const fileStat = await stat(path);
    return fileStat.size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
