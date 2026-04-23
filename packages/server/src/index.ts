import { readFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AGENTS_MD_RESOURCE_URI } from "./constants.js";
import { registerAppendIntent } from "./tools/append-intent.js";
import { registerGetRules } from "./tools/get-rules.js";
import { registerPlanContext } from "./tools/plan-context.js";
import { registerUpdateRegistry } from "./tools/update-registry.js";

declare const __SERVER_VERSION__: string;

export {
  runDoctorAuditReport,
  runDoctorFix,
  runDoctorReport,
  type DoctorAuditReport,
  type DoctorFixReport,
  type DoctorReport,
} from "./services/doctor.js";
export { approveHumanLock, type ApproveHumanLockInput, type ApproveHumanLockResult } from "./services/approve-human-lock.js";
export { readHumanLock, readHumanLockEntry, type HumanLockStatus } from "./services/read-human-lock.js";
export { LEGACY_LEDGER_PATH, LEDGER_PATH, getLedgerPath, getLegacyLedgerPath } from "./services/_shared.js";

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

export function createFabricServer(): McpServer {
  const server = new McpServer({
    name: "fabric-context-server",
    version: __SERVER_VERSION__,
  });

  registerGetRules(server);
  registerPlanContext(server);
  registerAppendIntent(server);
  registerUpdateRegistry(server);

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
  const server = createFabricServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
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
