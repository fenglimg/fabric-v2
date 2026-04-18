import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAppendIntent } from "./tools/append-intent.js";
import { registerGetRules } from "./tools/get-rules.js";
import { registerUpdateRegistry } from "./tools/update-registry.js";

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
    version: "0.0.0",
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

const entrypoint = process.argv[1];
const currentFilePath = fileURLToPath(import.meta.url);
const isMainModule = entrypoint !== undefined && resolve(entrypoint) === currentFilePath;

if (isMainModule) {
  void startStdioServer().catch((error: unknown) => {
    writeStderr(formatError(error));
    process.exitCode = 1;
  });
}
