import type { Server as HttpServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAppendIntent } from "./tools/append-intent.js";
import { registerGetRules } from "./tools/get-rules.js";
import { registerUpdateRegistry } from "./tools/update-registry.js";

declare const __SERVER_VERSION__: string;

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return `Unknown error: ${String(error)}`;
}

export function createFabricServer(): McpServer {
  const server = new McpServer({
    name: "fabric-context-server",
    version: __SERVER_VERSION__,
  });

  registerGetRules(server);
  registerAppendIntent(server);
  registerUpdateRegistry(server);

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
