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

import { contextCache } from "@fenglimg/fabric-server";
import { registerDoctorApi } from "./api/doctor.js";
import { createEventsHandler } from "./api/events.js";
import { registerHistoryApi } from "./api/history.js";
import { registerLedgerApi } from "./api/ledger.js";
import { registerKnowledgeApi } from "./api/knowledge.js";
import { registerKnowledgeContextApi } from "./api/knowledge-context.js";
import { registerScanApi } from "./api/scan.js";
import { createBearerAuthMiddleware, createLoopbackDenyMiddleware } from "./middleware/bearer-auth.js";
import { getLedgerPath, getLegacyLedgerPath } from "@fenglimg/fabric-server";
import { appendEventLedgerEvent, readEventLedger } from "@fenglimg/fabric-server";
import { invalidateKnowledgeSyncCooldown } from "@fenglimg/fabric-server";

const DEFAULT_HOST = "127.0.0.1";
const NOTIFY_DEBOUNCE_MS = 200;

// v2.0.0-rc.29 REVIEW (codex HIGH-1): server-layer guard for the
// `allowLoopbackNoAuth` opt-in. The CLI's `validateHost` enforces a loopback
// fallback in `serve.ts`, but a programmatic caller invoking
// `createFabricHttpApp` / `startHttpServer` directly was previously trusted to
// supply a loopback host — combining `allowLoopbackNoAuth: true` with a public
// bind would expose `/api`, `/events`, `/mcp` without auth. Defining the
// loopback set here (rather than reusing the CLI helper) keeps fabric-server a
// self-contained SDK with no CLI dependency.
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1"]);
function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

type FabricHttpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  // F64 (ISS-20260531-106): wall-clock of the last /mcp request on this session.
  // The idle reaper evicts sessions whose transport never fired onclose/
  // onsessionclosed (half-open connections, network drops, orphaned inits).
  lastActivityMs: number;
};

// F64: idle-session reaper bounds the sessions Map. A session is reaped after
// 30 min with no /mcp activity; the sweep runs every 5 min.
const SESSION_IDLE_TTL_MS = 30 * 60_000;
const SESSION_REAP_INTERVAL_MS = 5 * 60_000;

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
  // v2.0.0-rc.29 TASK-002 (BUG-K1): when true, allow loopback bind without a
  // bearer token (no middleware mounted). Default false → loopback no-token
  // requests get a 401 deny-all middleware that prints the remediation hint.
  // Non-loopback hosts still always require a token (enforced at the CLI
  // layer in serve.ts).
  allowLoopbackNoAuth?: boolean;
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
 * Knowledge (D25): for .fabric/knowledge/**\/*.md paths we ONLY invalidate the
 * cache. No ledger writes. No direct sync. The next MCP call will pick up the
 * staleness via ensureKnowledgeFresh (wired in TASK-021). The pending/ subtree is
 * watched explicitly so unreviewed entries surface in cache invalidation too.
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

  // v2.0: bootstrap/README.md is no longer the L0 anchor — knowledge entries
  // under .fabric/knowledge/ ARE the content. The pending/ subtree is included
  // so unreviewed entries also trigger cache invalidation.

  // .fabric/knowledge/**/*.md (including pending/) — cache invalidation only (D25).
  if (normalized.startsWith(".fabric/knowledge/") && normalized.endsWith(".md")) {
    contextCache.invalidate("file_watch", projectRoot);
    // Also clear the knowledge-sync cooldown so the next MCP call performs a real
    // I/O scan and picks up the changed file immediately.
    invalidateKnowledgeSyncCooldown(projectRoot);
    // No ledger writes. No direct sync. Lazy resync via ensureKnowledgeFresh.
  }
}

export function createFabricHttpApp(options: CreateFabricHttpAppOptions) {
  const { projectRoot, host = DEFAULT_HOST, authToken, allowLoopbackNoAuth = false } = options;

  // v2.0.0-rc.29 REVIEW (codex HIGH-1): reject the `allowLoopbackNoAuth +
  // non-loopback host` combination at construction time. Throw rather than
  // silently mounting deny-all so programmatic misuse fails loud — a request
  // would otherwise reach a 401 only by accident of the deny-all path, which
  // an opt-in caller would treat as a bug to suppress.
  if (allowLoopbackNoAuth && authToken === undefined && !isLoopbackHost(host)) {
    throw new Error(
      `createFabricHttpApp: allowLoopbackNoAuth=true requires a loopback host ` +
        `(127.0.0.1 / localhost / ::1); got ${JSON.stringify(host)}. ` +
        `Either bind to loopback or set FABRIC_AUTH_TOKEN.`,
    );
  }
  const app = createMcpExpressApp({ host }) as FabricHttpApp;
  const eventStore = new JsonlEventStore(projectRoot);
  const sessions = new Map<string, FabricHttpSession>();

  process.env.FABRIC_PROJECT_ROOT = projectRoot;

  // Watch agents.meta.json and the knowledge tree to invalidate the hot-path
  // cache. This is a persistent, lightweight watcher separate from the SSE
  // watcher in api/events.ts (which is client-lifecycle-based).
  //
  // v2.0: legacy `.fabric/bootstrap/README.md` is no longer watched — the
  // knowledge entries under `.fabric/knowledge/` are the content of record.
  // The `.fabric/knowledge/pending/**/*.md` glob is listed explicitly so
  // unreviewed entries also fire cache invalidation; the broader
  // `.fabric/knowledge/**/*.md` covers decisions/pitfalls/guidelines/models/
  // processes. D25: the knowledge globs ONLY invalidate cache — no ledger
  // writes, no direct sync. The next MCP call detects staleness via
  // ensureKnowledgeFresh (TASK-021).
  const cacheWatcher = chokidar.watch(
    [
      ".fabric/agents.meta.json",
      ".fabric/knowledge/**/*.md",
      ".fabric/knowledge/pending/**/*.md",
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

  // F64 (ISS-20260531-106): periodic idle-session reaper. onsessionclosed /
  // transport.onclose only fire on a CLEAN teardown; half-open connections,
  // network drops, or orphaned init requests would otherwise accumulate in the
  // sessions Map unbounded (slow memory leak → OOM). Sweep evicts any session
  // with no /mcp activity for SESSION_IDLE_TTL_MS and closes its transport.
  const sessionReaper = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_TTL_MS;
    for (const [sessionId, session] of sessions) {
      if (session.lastActivityMs < cutoff) {
        sessions.delete(sessionId);
        // Best-effort close — releases transport resources; a throw from a
        // already-dead transport must not abort the sweep.
        void Promise.resolve(session.transport.close()).catch(() => undefined);
      }
    }
  }, SESSION_REAP_INTERVAL_MS);
  // Don't keep the process alive solely for the reaper.
  sessionReaper.unref?.();

  let disposed = false;
  app.dispose = async () => {
    if (disposed) {
      return;
    }

    disposed = true;
    clearInterval(sessionReaper);
    clearTimeout(agentsMdNotifyTimer);
    clearTimeout(toolListNotifyTimer);
    await cacheWatcher.close();
  };

  app.disable("x-powered-by");
  // v2.0.0-rc.29 TASK-002 (BUG-K1): strict-auth policy.
  // - Token set → mount bearer auth (every request must carry it).
  // - No token AND !allowLoopbackNoAuth → mount deny-all that returns 401.
  // - No token AND allowLoopbackNoAuth → mount nothing (explicit opt-in).
  if (authToken !== undefined) {
    const bearerAuth = createBearerAuthMiddleware(authToken);
    app.use("/api", bearerAuth);
    app.use("/events", bearerAuth);
    app.use("/mcp", bearerAuth);
  } else if (!allowLoopbackNoAuth) {
    const denyAll = createLoopbackDenyMiddleware();
    app.use("/api", denyAll);
    app.use("/events", denyAll);
    app.use("/mcp", denyAll);
  }

  registerKnowledgeApi(app, projectRoot);
  registerKnowledgeContextApi(app, projectRoot);
  registerLedgerApi(app, projectRoot);
  registerHistoryApi(app, projectRoot);
  registerScanApi(app, projectRoot);
  registerDoctorApi(app, projectRoot);
  app.get("/events", createEventsHandler({ projectRoot }));
  app.all("/mcp", async (req, res) => {
    const sessionId = readHeader(req.headers["mcp-session-id"]);

    if (sessionId !== undefined) {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        writeJsonRpcError(res, 404, -32001, "Session not found");
        return;
      }

      // F64: refresh the idle clock so an actively-used session is never reaped.
      session.lastActivityMs = Date.now();
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
  const { createFabricServer } = await import("@fenglimg/fabric-server");
  const server = createFabricServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
    eventStore,
    onsessioninitialized: async (sessionId) => {
      sessions.set(sessionId, { server, transport, lastActivityMs: Date.now() });
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

  // The map entry (created in onsessioninitialized) is the one the reaper and
  // /mcp activity-bump operate on; this returned value is only used to drive the
  // initialize request. Stamp lastActivityMs to satisfy FabricHttpSession.
  return { server, transport, lastActivityMs: Date.now() };
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
