import { readFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AGENTS_MD_RESOURCE_URI } from "./constants.js";
import { resolveProjectRoot } from "./meta-reader.js";
import { flushAndSyncEventLedger } from "./services/event-ledger.js";
import { createInFlightTracker, type InFlightTracker } from "./services/in-flight-tracker.js";
import { reconcileRules } from "./services/rule-sync.js";
import { registerPlanContext } from "./tools/plan-context.js";
import { registerRuleSections } from "./tools/rule-sections.js";

declare const __SERVER_VERSION__: string;

export {
  runDoctorFix,
  runDoctorReport,
  type DoctorFixReport,
  type DoctorIssue,
  type DoctorReport,
} from "./services/doctor.js";
export {
  buildRuleMeta,
  computeRuleTestIndex,
  computeRulesBasedAgentsMeta,
  deriveRuleMetaLayer,
  deriveRuleMetaTopologyType,
  isSameRuleTestIndex,
  stableStringify,
  writeRuleMeta,
  type RuleMetaBuildResult,
  type RuleMetaBuildSource,
  type WriteRuleMetaOptions,
} from "./services/rule-meta-builder.js";
export {
  EVENT_LEDGER_PATH,
  LEGACY_LEDGER_PATH,
  LEDGER_PATH,
  getEventLedgerPath,
  getLedgerPath,
  getLegacyLedgerPath,
} from "./services/_shared.js";

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return `Unknown error: ${String(error)}`;
}

export { AGENTS_MD_RESOURCE_URI } from "./constants.js";

export { flushAndSyncEventLedger } from "./services/event-ledger.js";
export { createInFlightTracker, type InFlightTracker } from "./services/in-flight-tracker.js";
export {
  ensureRulesFresh,
  reconcileRules,
  type LedgerEvent,
  type ReconcileRulesOptions,
  type RuleSyncLedgerEvent,
  type RuleSyncOptions,
  type RuleSyncReport,
  type StructuredWarning,
} from "./services/rule-sync.js";
export {
  acquireLock,
  checkLockOrThrow,
  readLockState,
  releaseLock,
  ServeLockHeldError,
  type AcquireOptions,
  type LockState,
} from "./services/serve-lock.js";

export function createFabricServer(tracker?: InFlightTracker): McpServer {
  const server = new McpServer({
    name: "fabric-context-server",
    version: __SERVER_VERSION__,
  });

  registerPlanContext(server, tracker);
  registerRuleSections(server, tracker);

  server.registerResource(
    "bootstrap README",
    AGENTS_MD_RESOURCE_URI,
    {
      description: "L0 fabric bootstrap file — global agent instructions for this project",
      mimeType: "text/markdown",
    },
    async (_uri: URL) => {
      const projectRoot = process.env.FABRIC_PROJECT_ROOT ?? process.cwd();
      const content = await readFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "utf8");
      return {
        contents: [
          {
            uri: AGENTS_MD_RESOURCE_URI,
            mimeType: "text/markdown",
            text: content,
          },
        ],
      };
    },
  );

  return server;
}

export async function startStdioServer(): Promise<void> {
  const tracker = createInFlightTracker();
  const projectRoot = resolveProjectRoot();

  // TASK-022 (R28): run full rule consistency scan BEFORE accepting MCP requests.
  // Rules added while the server was offline become visible immediately; callers
  // no longer need to run `fab doctor --fix` after an offline rule change.
  const syncStart = Date.now();
  const reconcileResult = await reconcileRules(projectRoot, { trigger: "startup" });
  const syncDurationMs = Date.now() - syncStart;
  process.stderr.write(
    `[startup] rule sync: status=${reconcileResult.status}, events=${reconcileResult.events.length}, ${syncDurationMs}ms\n`,
  );

  const server = createFabricServer(tracker);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  const handledSignals = new Set<NodeJS.Signals>();

  function installShutdownHandler(signal: NodeJS.Signals): void {
    process.on(signal, () => {
      void (async () => {
        if (handledSignals.has(signal)) {
          // Double-signal of same type: hard exit
          process.stderr.write(`\n[shutdown] ${signal} repeated — forcing exit(1)\n`);
          process.exit(1);
        }
        handledSignals.add(signal);
        process.stderr.write(
          `\n[shutdown] ${signal} received — draining ${tracker.size()} requests (5s deadline)\n`,
        );
        const result = await tracker.drain(5000);
        process.stderr.write(`[shutdown] drained ${result.drained}, timed_out ${result.timed_out}\n`);
        // fsyncSync AFTER drain, BEFORE close — Gemini G1 ordering requirement
        flushAndSyncEventLedger(projectRoot);
        process.stderr.write("[shutdown] ledger fsynced; closing server\n");
        try {
          await server.close();
        } catch {
          // ignore close errors during shutdown
        }
        process.exit(0);
      })();
    });
  }

  installShutdownHandler("SIGINT");
  installShutdownHandler("SIGTERM");
  installShutdownHandler("SIGHUP");
}

export async function startHttpServer(options: {
  port: number;
  projectRoot: string;
  host?: string;
  authToken?: string;
  dashboardDistPath?: string;
  dev?: boolean;
}): Promise<HttpServer> {
  const { createFabricHttpApp } = await import("./http.js");
  const { port, projectRoot, host = "127.0.0.1", authToken, dashboardDistPath, dev } = options;
  const app = createFabricHttpApp({ projectRoot, host, authToken, dashboardDistPath, dev });

  return await new Promise<HttpServer>((resolveServer, rejectServer) => {
    const server = app.listen(port, host);

    server.once("close", () => {
      void app.dispose();
    });

    server.once("listening", () => {
      resolveServer(server);
    });
    server.once("error", (error: Error) => {
      rejectServer(error);
    });
  });
}

const entrypoint = process.argv[1];
const currentFilePath = fileURLToPath(import.meta.url);
const isMainModule = entrypoint !== undefined && resolve(entrypoint) === currentFilePath;

if (isMainModule) {
  void startStdioServer().catch((error: unknown) => {
    writeStderr(formatError(error));
    process.exitCode = 1;
  });
}
