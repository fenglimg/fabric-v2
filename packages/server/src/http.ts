import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import chokidar from "chokidar";

import { contextCache } from "./cache.js";
import { AGENTS_MD_RESOURCE_URI } from "./constants.js";
import { registerDoctorApi } from "./api/doctor.js";
import { createEventsHandler } from "./api/events.js";
import { registerHistoryApi } from "./api/history.js";
import { registerIntentApi } from "./api/intent.js";
import { registerLedgerApi } from "./api/ledger.js";
import { registerRulesApi } from "./api/rules.js";
import { registerRulesContextApi } from "./api/rules-context.js";
import { registerScanApi } from "./api/scan.js";
import { registerDashboardStatic } from "./api/static.js";
import { createBearerAuthMiddleware } from "./middleware/bearer-auth.js";
import { getLedgerPath, getLegacyLedgerPath } from "./services/_shared.js";
import { appendEventLedgerEvent, readEventLedger } from "./services/event-ledger.js";
import { invalidateRuleSyncCooldown } from "./services/rule-sync.js";

const DEFAULT_HOST = "127.0.0.1";
const NOTIFY_DEBOUNCE_MS = 200;

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

export type FabricHttpApp = ReturnType<typeof createMcpExpressApp> & {
  dispose: () => Promise<void>;
};

class JsonlEventStore implements EventStore {
  constructor(private readonly projectRoot: string) {}

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const eventId = randomUUID();

    await appendEventLedgerEvent(this.projectRoot, {
      event_type: "mcp_event",
      mcp_event_id: eventId,
      stream_id: streamId,
      message,
    });

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
    const { events: eventLedgerEvents } = await readEventLedger(this.projectRoot);
    const projectedEvents = eventLedgerEvents
      .flatMap((event): StoredMcpEvent[] => {
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

/**
 * Exported for unit-testing: the core logic executed on every chokidar event
 * (change / add / unlink) from the cache watcher.
 *
 * Rules (D25): for .fabric/rules/**\/*.md paths we ONLY invalidate the cache.
 * No ledger writes. No direct sync. The next MCP call will pick up the
 * staleness via ensureRulesFresh (wired in TASK-021).
 */
export function handleCacheWatcherEvent(
  relativePath: string,
  projectRoot: string,
  sessions: Map<string, FabricHttpSession>,
  timers: {
    getAgentsMdTimer: () => ReturnType<typeof setTimeout> | undefined;
    getToolListTimer: () => ReturnType<typeof setTimeout> | undefined;
    setAgentsMdTimer: (t: ReturnType<typeof setTimeout> | undefined) => void;
    setToolListTimer: (t: ReturnType<typeof setTimeout> | undefined) => void;
  },
): void {
  const normalized = relativePath.replaceAll("\\", "/");

  if (normalized === ".fabric/agents.meta.json") {
    contextCache.invalidate("file_watch", projectRoot);
    // Debounced: notify all sessions that the tool list may have changed
    clearTimeout(timers.getToolListTimer());
    timers.setToolListTimer(
      setTimeout(() => {
        notifyAllSessions(sessions, "tools/list_changed");
      }, NOTIFY_DEBOUNCE_MS),
    );
    return;
  }

  if (normalized === ".fabric/bootstrap/README.md") {
    contextCache.invalidate("file_watch", projectRoot);
    // Debounced: notify all sessions that the bootstrap README resource was updated
    clearTimeout(timers.getAgentsMdTimer());
    timers.setAgentsMdTimer(
      setTimeout(() => {
        notifyAllSessions(sessions, "resource_updated", AGENTS_MD_RESOURCE_URI);
      }, NOTIFY_DEBOUNCE_MS),
    );
    return;
  }

  // .fabric/rules/**/*.md — cache invalidation only (D25).
  if (normalized.startsWith(".fabric/rules/") && normalized.endsWith(".md")) {
    contextCache.invalidate("file_watch", projectRoot);
    // Also clear the rule-sync cooldown so the next MCP call performs a real
    // I/O scan and picks up the changed file immediately.
    invalidateRuleSyncCooldown(projectRoot);
    // No ledger writes. No direct sync. Lazy resync via ensureRulesFresh.
  }
}

export function createFabricHttpApp(options: CreateFabricHttpAppOptions) {
  const { projectRoot, host = DEFAULT_HOST, authToken, dashboardDistPath, dev } = options;
  const app = createMcpExpressApp({ host }) as FabricHttpApp;
  const eventStore = new JsonlEventStore(projectRoot);
  const sessions = new Map<string, FabricHttpSession>();

  process.env.FABRIC_PROJECT_ROOT = projectRoot;

  // Watch agents.meta.json, bootstrap README, and rules/ to invalidate the
  // hot-path cache.  This is a persistent, lightweight watcher separate from
  // the SSE watcher in api/events.ts (which is client-lifecycle-based).
  //
  // D25: the rules glob ONLY invalidates cache — no ledger writes, no direct
  // sync.  The next MCP call detects staleness via ensureRulesFresh (TASK-021).
  const cacheWatcher = chokidar.watch(
    [
      ".fabric/agents.meta.json",
      ".fabric/bootstrap/README.md",
      ".fabric/rules/**/*.md",
    ],
    {
      cwd: projectRoot,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 120,
        pollInterval: 20,
      },
    },
  );

  let agentsMdNotifyTimer: ReturnType<typeof setTimeout> | undefined;
  let toolListNotifyTimer: ReturnType<typeof setTimeout> | undefined;

  const onCacheWatcherEvent = (relativePath: string) => {
    handleCacheWatcherEvent(relativePath, projectRoot, sessions, {
      getAgentsMdTimer: () => agentsMdNotifyTimer,
      getToolListTimer: () => toolListNotifyTimer,
      setAgentsMdTimer: (t) => { agentsMdNotifyTimer = t; },
      setToolListTimer: (t) => { toolListNotifyTimer = t; },
    });
  };

  cacheWatcher.on("change", onCacheWatcherEvent);
  cacheWatcher.on("add", onCacheWatcherEvent);
  cacheWatcher.on("unlink", onCacheWatcherEvent);

  let disposed = false;
  app.dispose = async () => {
    if (disposed) {
      return;
    }

    disposed = true;
    clearTimeout(agentsMdNotifyTimer);
    clearTimeout(toolListNotifyTimer);
    await cacheWatcher.close();
  };

  app.disable("x-powered-by");
  if (authToken !== undefined) {
    const bearerAuth = createBearerAuthMiddleware(authToken);
    app.use("/api", bearerAuth);
    app.use("/events", bearerAuth);
    app.use("/mcp", bearerAuth);
  }

  registerRulesApi(app, projectRoot);
  registerRulesContextApi(app, projectRoot);
  registerLedgerApi(app, projectRoot);
  registerHistoryApi(app, projectRoot);
  registerScanApi(app, projectRoot);
  registerDoctorApi(app, projectRoot);
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

/**
 * Sends an MCP notification to all active sessions.
 *
 * @param sessions  The active sessions map.
 * @param kind      "tools/list_changed" | "resource_updated" | "resources/list_changed"
 * @param uri       Resource URI — required when kind is "resource_updated".
 */
function notifyAllSessions(
  sessions: Map<string, FabricHttpSession>,
  kind: "tools/list_changed" | "resource_updated" | "resources/list_changed",
  uri?: string,
): void {
  for (const { server } of sessions.values()) {
    try {
      if (kind === "tools/list_changed") {
        server.sendToolListChanged();
      } else if (kind === "resources/list_changed") {
        server.sendResourceListChanged();
      } else if (kind === "resource_updated" && uri !== undefined) {
        // McpServer only exposes list-level notify; fine-grained update requires inner Server API
        void server.server.sendResourceUpdated({ uri });
      }
    } catch {
      // Best-effort — a disconnected session should not block others.
    }
  }
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
