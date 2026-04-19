import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StreamableHTTPServerTransport,
  type EventId,
  type EventStore,
  type StreamId,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { registerDoctorApi } from "./api/doctor.js";
import { createEventsHandler } from "./api/events.js";
import { registerHistoryApi } from "./api/history.js";
import { registerHumanLockApi } from "./api/human-lock.js";
import { registerIntentApi } from "./api/intent.js";
import { registerLedgerApi } from "./api/ledger.js";
import { registerRulesApi } from "./api/rules.js";
import { registerScanApi } from "./api/scan.js";
import { registerDashboardStatic } from "./api/static.js";
import { createBearerAuthMiddleware } from "./middleware/bearer-auth.js";

const DEFAULT_HOST = "127.0.0.1";
const LEDGER_FILE = ".intent-ledger.jsonl";

type FabricHttpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

type StoredMcpEvent = {
  kind: "mcp-event";
  eventId: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
};

export type CreateFabricHttpAppOptions = {
  projectRoot: string;
  host?: string;
  authToken?: string;
  dashboardDistPath?: string;
  dev?: boolean;
};

class JsonlEventStore implements EventStore {
  constructor(private readonly ledgerPath: string) {}

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const eventId = randomUUID();
    const entry: StoredMcpEvent = {
      kind: "mcp-event",
      eventId,
      streamId,
      message,
    };

    await appendFile(this.ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");

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
    let raw: string;

    try {
      raw = await readFile(this.ledgerPath, "utf8");
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
      .map((line) => parseStoredMcpEvent(line))
      .filter((event): event is StoredMcpEvent => event !== null);
  }
}

export function createFabricHttpApp(options: CreateFabricHttpAppOptions) {
  const { projectRoot, host = DEFAULT_HOST, authToken, dashboardDistPath, dev } = options;
  const app = createMcpExpressApp({ host });
  const ledgerPath = join(projectRoot, LEDGER_FILE);
  const eventStore = new JsonlEventStore(ledgerPath);
  const sessions = new Map<string, FabricHttpSession>();

  process.env.FABRIC_PROJECT_ROOT = projectRoot;

  app.disable("x-powered-by");
  if (authToken !== undefined) {
    const bearerAuth = createBearerAuthMiddleware(authToken);
    app.use("/api", bearerAuth);
    app.use("/events", bearerAuth);
  }

  registerRulesApi(app, projectRoot);
  registerLedgerApi(app, projectRoot);
  registerHistoryApi(app, projectRoot);
  registerScanApi(app, projectRoot);
  registerDoctorApi(app, projectRoot);
  registerHumanLockApi(app, projectRoot);
  registerIntentApi(app, projectRoot);
  app.get("/events", createEventsHandler({ projectRoot }));
  app.all("/mcp", async (req, res) => {
    const sessionId = readHeader(req.headers["mcp-session-id"]);

    if (sessionId !== undefined) {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        writeJsonRpcError(res, 404, -32001, "Session not found");
        return;
      }

      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      writeJsonRpcError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
      return;
    }

    const session = await createSession(eventStore, sessions);
    await session.transport.handleRequest(req, res, req.body);
  });
  registerDashboardStatic(app, { dashboardDistPath, dev });

  return app;
}

async function createSession(
  eventStore: EventStore,
  sessions: Map<string, FabricHttpSession>,
): Promise<FabricHttpSession> {
  const { createFabricServer } = await import("./index.js");
  const server = createFabricServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
    eventStore,
    onsessioninitialized: async (sessionId) => {
      sessions.set(sessionId, { server, transport });
    },
    onsessionclosed: async (sessionId) => {
      sessions.delete(sessionId);
    },
  });

  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (sessionId !== undefined) {
      sessions.delete(sessionId);
    }
  };

  await server.connect(transport);

  return { server, transport };
}

function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((entry) => isInitializeMessage(entry));
  }

  return isInitializeMessage(body);
}

function isInitializeMessage(value: unknown): value is { method: "initialize" } {
  return (
    value !== null &&
    typeof value === "object" &&
    "jsonrpc" in value &&
    "method" in value &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    (value as { method?: unknown }).method === "initialize"
  );
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

function readHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((entry) => entry.length > 0);
  }

  return undefined;
}

function writeJsonRpcError(res: { status: (code: number) => { json: (payload: unknown) => void } }, status: number, code: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
