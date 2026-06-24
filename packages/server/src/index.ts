import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
// v2.0.0-rc.37 Wave A2: `node:http` Server type no longer imported — the
// startHttpServer entry point was quarantined to packages/server-http-experimental/
// per KB [[fabric-serve-quarantine-not-delete]]. Restore alongside startHttpServer
// if the web UI surface is ever re-enabled.
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AGENTS_MD_RESOURCE_URI } from "./constants.js";
import { resolveProjectRoot } from "./meta-reader.js";
import { flushAndSyncEventLedger } from "./services/event-ledger.js";
import { createInFlightTracker, type InFlightTracker } from "./services/in-flight-tracker.js";
import { registerExtractKnowledge } from "./tools/extract-knowledge.js";
import { registerRecall } from "./tools/recall.js";
import { registerArchiveScan } from "./tools/archive-scan.js";
import { registerReview } from "./tools/review.js";

declare const __SERVER_VERSION__: string;

export {
  detectUnboundProject,
  enrichDescriptions,
  runDoctorApplyLint,
  runDoctorArchiveHistory,
  runDoctorCiteCoverage,
  runDoctorFix,
  runDoctorHistoryAll,
  runDoctorReport,
  type UnboundProjectViolation,
  type ArchiveHistoryEntry,
  type ArchiveHistoryReport,
  type CiteCoverageReport,
  type HistoryAllReport,
  type HistoryDayRow,
  type DoctorApplyLintMutation,
  type DoctorApplyLintMutationKind,
  type DoctorApplyLintReport,
  type DoctorFixReport,
  type DoctorIssue,
  type DoctorReport,
  type EnrichDescriptionsCandidate,
  type EnrichDescriptionsMode,
  type EnrichDescriptionsReport,
} from "./services/doctor.js";
// v2.1 ④ conflict-detection (P4): knowledge-conflict lint.
export {
  loadConflictEntries,
  runDoctorConflictLint,
  type ConflictLintReport,
} from "./services/doctor-conflict.js";
export {
  findConflictCandidates,
  lintConflicts,
  pairSimilarity,
  DEFAULT_CONFLICT_SIMILARITY_THRESHOLD,
  type ConflictEntry,
  type ConflictJudge,
  type ConflictPair,
  type ConflictVerdict,
} from "./services/conflict-lint.js";
// W3-D (UX northstar): retired-reference lint surfaced standalone under the new
// `fabric audit retired` subcommand (was folded into the doctor check suite).
export {
  inspectRetiredReferences,
  RETIRED_TOKENS,
  type RetiredReferenceHit,
  type RetiredReferenceInspection,
  type RetiredToken,
} from "./services/doctor-retired-references-lint.js";
// W3-H (S6): `fabric audit why-not-surfaced <id>` self-serve scope diagnostic.
export {
  explainWhyNotSurfaced,
  type SurfaceVerdict,
  type WhyNotSurfacedResult,
} from "./services/why-not-surfaced.js";
// v2.2 W5 R2 (agents.meta decolo): the co-location agents.meta build/write
// surface (buildKnowledgeMeta / writeKnowledgeMeta / computeKnowledgeBasedAgentsMeta
// / computeKnowledgeTestIndex / loadKbIdTypeMap / isSameKnowledgeTestIndex /
// stableStringify / deriveKnowledgeMeta* + KnowledgeIdAllocator) is no longer
// re-exported — knowledge lives in mounted stores, the read paths read the
// cross-store model, and id minting goes through per-store committed counters
// (W4 allocateStoreKnowledgeId). cross-store-recall still consumes
// deriveRuleIdentity / extractRuleDescription directly from the module.
export { extractKnowledge } from "./services/extract-knowledge.js";
export { reviewKnowledge } from "./services/review.js";
// KT-GLD-0006: review-time cold-eval self-sufficiency judge protocol + batch builder
// (driven offline by the fabric-review skill via maestro delegate; no hot-path LLM call).
export {
  buildColdEvalBatch,
  COLD_EVAL_RUBRIC,
  type ColdEvalCandidate,
  type ColdEvalVerdict,
  type ColdEvalBatch,
} from "./services/summary-cold-eval.js";
// v2.2 dual-sink (Goal A / D9): always-active body collector consumed by the
// `fabric plan-context-hint` CLI adapter to populate the SessionStart AI sink.
export {
  buildAlwaysActiveBodies,
  buildKnowledgeCensus,
  type AlwaysActiveBody,
  type KnowledgeCensus,
} from "./services/cross-store-recall.js";
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
  recall,
  type RecallInput,
  type RecallResult,
} from "./services/recall.js";
export {
  EVENT_LEDGER_PATH,
  LEGACY_LEDGER_PATH,
  LEDGER_PATH,
  METRICS_LEDGER_PATH,
  getEventLedgerPath,
  getLedgerPath,
  getLegacyLedgerPath,
  getMetricsLedgerPath,
} from "./services/_shared.js";
import {
  flushMetrics,
  startMetricsFlush,
  stopMetricsFlush,
} from "./services/metrics.js";
import { startRotationTick, stopRotationTick } from "./services/rotation-tick.js";
export {
  bumpCounter,
  drainCounters,
  flushMetrics,
  readMetrics,
  startMetricsFlush,
  stopMetricsFlush,
  METRIC_COUNTER_NAMES,
  type MetricsRow,
  type MetricCounterName,
} from "./services/metrics.js";
export { startRotationTick, stopRotationTick } from "./services/rotation-tick.js";

// W2-06 (升级项 b): additive re-exports consumed by the experimental HTTP
// server package (@fenglimg/fabric-server-http-experimental). These modules
// used to live alongside that package; they now live here, so the package
// imports them from this barrel. Purely additive — no behavior change.
export { contextCache } from "./cache.js";
export { readEventLedger } from "./services/event-ledger.js";
export { rehydrateAgentsMetaAt } from "./services/rehydrate-state.js";
export { resolveLedgerPaths, readLedger } from "./services/read-ledger.js";
// v2.2 W5 R2 (agents.meta decolo): `getKnowledge` (the path-glob co-location
// injection model) and `readAgentsMeta` (the co-location index reader) are no
// longer re-exported — both were consumed only by the quarantined
// server-http-experimental package, which is out of the main workspace.

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
  return `[startup] info: detected ${preexisting.join(", ")} at project root. Note: Fabric serves knowledge from mounted stores via MCP — root markdown files are not auto-loaded into the AI context.`;
}

export { AGENTS_MD_RESOURCE_URI } from "./constants.js";

export { flushAndSyncEventLedger } from "./services/event-ledger.js";
export { createInFlightTracker, type InFlightTracker } from "./services/in-flight-tracker.js";
// v2.0.0-rc.37 Wave A2 Part 2: serve-lock fully quarantined to
// packages/server-http-experimental/. Main retains a read-only probe at
// `services/legacy-serve-lock-probe.ts` (isAlive + readLockState) so doctor
// can reap legacy `.fabric/.serve.lock` corpses left behind by rc ≤36
// `fabric serve` invocations. No public re-exports remain.

// v2.2 MC2-server-instructions (W1-T6): server-level `instructions` surfaced in
// the MCP `initialize` result. Before this the server shipped only name+version,
// so an AI client connecting to Fabric had NO server-authored guidance on how to
// drive the tools — it relied entirely on the bootstrap AGENTS.md being present
// and read. This is the D2 (MCP-first) anchor: a concise tool manifest + the
// canonical retrieval flow + the cite/session conventions, delivered by the
// server itself at connect time so the behavior layer survives even where the
// bootstrap is absent (a bare MCP host). Kept terse — it is sent on every
// initialize. Exported so the contract can be asserted deterministically.
export const FABRIC_SERVER_INSTRUCTIONS = [
  "Fabric is a cross-client knowledge layer: durable team/personal decisions, pitfalls, guidelines, models, and processes this server surfaces so you do not re-learn them each session.",
  "",
  "AGENT-DIRECT tools — call these yourself, inline, as you work:",
  "Retrieval — do this BEFORE you edit code or commit to a decision:",
  "- `fab_recall(paths)` — one-shot KB recall for the files you are about to touch. Returns a single ranked `entries[]` — each entry carries its DESCRIPTION, a `read_path` (the on-disk knowledge file), `rank` (1 = most relevant), and `body_in_context:true` when the body is already in context from SessionStart.",
  "- It does NOT return bodies. To load an entry's full content, Read its `read_path` (native file read) — that is observed as a `knowledge_body_read`. Reading on demand keeps the index lean; a needed body is one cheap Read away.",
  "",
  "SKILL-DRIVEN tools — invoked by the Fabric skills (fabric-archive / fabric-review) at the right lifecycle moment, not called ad-hoc:",
  "- `fab_propose` — propose/persist a pending knowledge entry into the write-target store for later review.",
  "- `fab_archive_scan` — scan recent work for archive-worthy knowledge candidates.",
  "- `fab_review` — review and triage pending knowledge entries.",
  "",
  "Conventions:",
  "- Candidate lists are ranked best-first (content relevance) and bounded; `omitted_candidate_count > 0` means more exist — narrow your intent to surface them.",
  "- Pass the client `session_id` to `fab_recall` so cross-session knowledge-debt tracking stays accurate.",
  "- Cite the KB id you applied or dismissed before edits, per the project's cite policy.",
].join("\n");

export function createFabricServer(tracker?: InFlightTracker): McpServer {
  const server = new McpServer(
    {
      name: "fabric-knowledge-server",
      version: __SERVER_VERSION__,
    },
    {
      instructions: FABRIC_SERVER_INSTRUCTIONS,
    },
  );

  registerRecall(server, tracker);
  registerArchiveScan(server, tracker);
  registerExtractKnowledge(server, tracker);
  registerReview(server, tracker);

  // v2.0: the legacy bootstrap README MCP resource is preserved as a contract
  // shim. Knowledge now lives in mounted stores; this resource returns an
  // empty/synthetic response instead of throwing for clients that still probe it.
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

  // TASK-034: info-level detection of pre-existing root markdown files.
  // Surfaced BEFORE handshake so the operator sees the hint regardless of
  // how the MCP client renders later stderr lines.
  const rootMsg = formatPreexistingRootMessage(projectRoot);
  if (rootMsg !== null) {
    process.stderr.write(`${rootMsg}\n`);
  }

  const server = createFabricServer(tracker);
  const transport = new StdioServerTransport();

  // v2.0.0-rc.23 TASK-009 (d): connect the MCP handshake immediately so MCP
  // clients (`claude mcp list`) see the server as available the moment stdio is
  // wired up.
  //
  // v2.2 W5 R2 (agents.meta decolo): the background startup `reconcileKnowledge`
  // pass — which rebuilt the co-location `agents.meta.json` index — is retired.
  // Knowledge now lives in mounted stores and the read paths read those stores
  // directly, so there is no project-local index to rebuild on startup. The
  // `first-reconcile-gate` is left wired into the tool handlers; with no
  // producer registered it fast-paths to `ready` (no warning), preserving the
  // handler shape without doing dead work.
  await server.connect(transport);

  // v2.0.0-rc.37 Wave B (B3): kick the metrics flush timer once the MCP
  // handshake is up. Counter accumulator was filling in-process since the
  // first tool call (B2 bumpCounter writes), but no flush has fired yet.
  // The handler is best-effort; failures are swallowed inside flushMetrics.
  startMetricsFlush(projectRoot);
  // v2.0.0-rc.37 Wave B (B4): start the 6h rotation tick so events.jsonl
  // stays bounded even when the server is idle. Pre-rc.37 rotation only
  // fired on doctor --fix; a long-lived stdio server that never sees
  // doctor invocations let the ledger grow unchecked.
  startRotationTick(projectRoot);

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
      // v2.0.0-rc.37 Wave B (B3): drain accumulated counters to metrics.jsonl
      // before exit. Best-effort; failures swallowed inside flushMetrics.
      await flushMetrics(deps.projectRoot);
      stopMetricsFlush(deps.projectRoot);
      // v2.0.0-rc.37 Wave B (B4): cancel the rotation tick. Final rotation
      // is intentionally NOT triggered here (a 5-second drain window is
      // not the right place for retention-window pruning that can rewrite
      // an MB-scale file). The next server start picks it up.
      stopRotationTick(deps.projectRoot);
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

// v2.0.0-rc.37 Wave A2: `startHttpServer` removed. The CLI surface
// (`fabric serve`) is quarantined to packages/server-http-experimental/ per
// KB [[fabric-serve-quarantine-not-delete]]. The Express app factory, bearer
// auth middleware, serve-lock service, and HTTP integration tests now live in
// the experimental package; no main-line HTTP entry point remains.

const entrypoint = process.argv[1];
const currentFilePath = fileURLToPath(import.meta.url);
const isMainModule = entrypoint !== undefined && resolve(entrypoint) === currentFilePath;

if (isMainModule) {
  void startStdioServer().catch((error: unknown) => {
    writeStderr(formatError(error));
    process.exitCode = 1;
  });
}
