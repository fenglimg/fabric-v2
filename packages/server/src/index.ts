import { existsSync } from "node:fs";
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
import { registerExtractKnowledge } from "./tools/extract-knowledge.js";
import { registerPlanContext } from "./tools/plan-context.js";
import { registerReview } from "./tools/review.js";
import { registerRuleSections } from "./tools/rule-sections.js";

declare const __SERVER_VERSION__: string;

export {
  runDoctorApplyLint,
  runDoctorFix,
  runDoctorReport,
  type DoctorApplyLintMutation,
  type DoctorApplyLintMutationKind,
  type DoctorApplyLintReport,
  type DoctorFixReport,
  type DoctorIssue,
  type DoctorReport,
} from "./services/doctor.js";
export {
  buildRuleMeta,
  computeKnowledgeTestIndex,
  computeRulesBasedAgentsMeta,
  deriveRuleMetaLayer,
  deriveRuleMetaTopologyType,
  isSameKnowledgeTestIndex,
  stableStringify,
  writeRuleMeta,
  type RuleMetaBuildResult,
  type RuleMetaBuildSource,
  type WriteRuleMetaOptions,
} from "./services/rule-meta-builder.js";
export { KnowledgeIdAllocator } from "./services/knowledge-id-allocator.js";
export { extractKnowledge } from "./services/extract-knowledge.js";
export { reviewKnowledge } from "./services/review.js";
export { appendEventLedgerEvent } from "./services/event-ledger.js";
export {
  planContext,
  readSelectionToken,
  type PlanContextInput,
  type PlanContextResult,
  type RequirementProfile,
  type SelectionTokenState,
} from "./services/plan-context.js";
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

/**
 * Returns an info-level startup message when CLAUDE.md or AGENTS.md exist at
 * the project root, or null when neither is present.
 *
 * Extracted as a pure helper so unit tests can exercise it without spawning
 * a full server (TASK-034).
 */
export function formatPreexistingRootMessage(projectRoot: string): string | null {
  const preexisting: string[] = [];
  if (existsSync(join(projectRoot, "CLAUDE.md"))) preexisting.push("CLAUDE.md");
  if (existsSync(join(projectRoot, "AGENTS.md"))) preexisting.push("AGENTS.md");
  if (preexisting.length === 0) return null;
  return `[startup] info: detected ${preexisting.join(", ")} at project root. Note: Fabric serves knowledge from .fabric/knowledge/ via MCP — root markdown files are not auto-loaded into the AI context.`;
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
  registerExtractKnowledge(server, tracker);
  registerReview(server, tracker);

  // v2.0: the legacy bootstrap README MCP resource is preserved as a contract
  // shim — the file no longer exists by default in v2.0 (knowledge entries
  // under .fabric/knowledge/ are the content of record), so the handler
  // returns an empty/synthetic response instead of throwing. Existing MCP
  // clients that probe this URI continue to receive a well-formed reply.
  server.registerResource(
    "bootstrap README",
    AGENTS_MD_RESOURCE_URI,
    {
      description: "Legacy v1.x bootstrap anchor (deprecated in v2.0; kept as MCP contract shim)",
      mimeType: "text/markdown",
    },
    async (_uri: URL) => {
      const projectRoot = process.env.FABRIC_PROJECT_ROOT ?? process.cwd();
      const path = join(projectRoot, ".fabric", "bootstrap", "README.md");
      let text = "";
      if (existsSync(path)) {
        text = await readFile(path, "utf8");
      }
      return {
        contents: [
          {
            uri: AGENTS_MD_RESOURCE_URI,
            mimeType: "text/markdown",
            text,
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

  // TASK-034: info-level detection of pre-existing root markdown files.
  const rootMsg = formatPreexistingRootMessage(projectRoot);
  if (rootMsg !== null) {
    process.stderr.write(`${rootMsg}\n`);
  }

  const server = createFabricServer(tracker);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  const closeServer = async (): Promise<void> => {
    await server.close();
  };

  process.on(
    "SIGINT",
    createShutdownHandler({ signal: "SIGINT", tracker, projectRoot, closeServer }),
  );
  process.on(
    "SIGTERM",
    createShutdownHandler({ signal: "SIGTERM", tracker, projectRoot, closeServer }),
  );
  process.on(
    "SIGHUP",
    createShutdownHandler({ signal: "SIGHUP", tracker, projectRoot, closeServer }),
  );
}

/**
 * Dependencies for the shutdown handler factory. Tests inject `exit` to assert
 * exit-code behavior without terminating the test process.
 */
export interface ShutdownHandlerDeps {
  signal: NodeJS.Signals;
  tracker: InFlightTracker;
  projectRoot: string;
  closeServer: () => Promise<void>;
  /** Override for tests; defaults to `process.exit`. */
  exit?: (code: number) => never;
  /** Override for tests; defaults to 5000ms (Gemini G1). */
  drainDeadlineMs?: number;
}

/**
 * Builds a same-signal shutdown handler implementing server.md I1:
 *   - First invocation: drain in-flight (5s) → fsync ledger → close server → exit(0)
 *   - Second invocation of the same signal (while first is in flight): exit(1)
 *
 * Each call to this factory returns an independent handler with its own
 * `invoked` flag, so per-signal dedup is isolated.
 */
export function createShutdownHandler(deps: ShutdownHandlerDeps): () => void {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const deadlineMs = deps.drainDeadlineMs ?? 5000;
  let invoked = false;

  return () => {
    void (async () => {
      if (invoked) {
        process.stderr.write(`\n[shutdown] ${deps.signal} repeated — forcing exit(1)\n`);
        exit(1);
        return;
      }
      invoked = true;
      process.stderr.write(
        `\n[shutdown] ${deps.signal} received — draining ${deps.tracker.size()} requests (${
          deadlineMs / 1000
        }s deadline)\n`,
      );
      const result = await deps.tracker.drain(deadlineMs);
      process.stderr.write(`[shutdown] drained ${result.drained}, timed_out ${result.timed_out}\n`);
      // fsyncSync AFTER drain, BEFORE close — Gemini G1 ordering requirement
      flushAndSyncEventLedger(deps.projectRoot);
      process.stderr.write("[shutdown] ledger fsynced; closing server\n");
      try {
        await deps.closeServer();
      } catch {
        // ignore close errors during shutdown
      }
      exit(0);
    })();
  };
}

export async function startHttpServer(options: {
  port: number;
  projectRoot: string;
  host?: string;
  authToken?: string;
}): Promise<HttpServer> {
  const { createFabricHttpApp } = await import("./http.js");
  const { port, projectRoot, host = "127.0.0.1", authToken } = options;
  const app = createFabricHttpApp({ projectRoot, host, authToken });

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
