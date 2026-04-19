import { defineCommand } from "citty";

import { startHttpServer } from "@fenglimg/fabric-server";

import { createDebugLogger, resolveDevMode } from "../dev-mode.js";

const DEFAULT_PORT = 7373;

type ServeArgs = {
  port?: string;
  target?: string;
  host?: string;
  debug?: boolean;
};

export const serveCommand = defineCommand({
  meta: {
    name: "serve",
    description:
      "启动 Fabric 本地 MCP HTTP 服务。set FABRIC_AUTH_TOKEN to enable Bearer auth (required for non-localhost binding).",
  },
  args: {
    port: {
      type: "string",
      description: "监听端口，默认 7373。",
      default: String(DEFAULT_PORT),
    },
    host: {
      type: "string",
      description:
        "监听主机，默认 127.0.0.1。set FABRIC_AUTH_TOKEN to enable Bearer auth (required for non-localhost binding).",
      default: "127.0.0.1",
    },
    target: {
      type: "string",
      description: "目标项目路径，默认依次使用 CLI 参数、EXTERNAL_FIXTURE_PATH、fabric.config.json 或当前目录。",
    },
    debug: {
      type: "boolean",
      description: "将目标解析详情输出到 stderr。",
      default: false,
    },
  },
  async run({ args }: { args: ServeArgs }) {
    const workspaceRoot = process.cwd();
    const logger = createDebugLogger(args.debug);
    const resolution = resolveDevMode(args.target, workspaceRoot);
    const port = parsePort(args.port);
    const requestedHost = parseHost(args.host);
    const authToken = readAuthTokenFromEnv();
    const host = validateHost(requestedHost, authToken);

    logger(`serve target source: ${resolution.source}`);
    for (const step of resolution.chain) {
      logger(step);
    }

    try {
      await startHttpServer({
        port,
        projectRoot: resolution.target,
        host,
        authToken,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "EADDRINUSE") {
        throw new Error(`Port ${port} in use — try --port ${port + 1}`);
      }

      throw error;
    }

    console.log(`Fabric Dashboard: http://${host}:${port}`);
  },
});

export default serveCommand;

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? String(DEFAULT_PORT), 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value ?? "<unset>"}`);
  }

  return port;
}

function parseHost(value: string | undefined): string {
  const host = value?.trim() ?? "127.0.0.1";

  if (host.length === 0) {
    throw new Error("Invalid host: <empty>");
  }

  return host;
}

function readAuthTokenFromEnv(): string | undefined {
  const token = process.env.FABRIC_AUTH_TOKEN;
  return token === undefined || token.length === 0 ? undefined : token;
}

function validateHost(host: string, authToken: string | undefined): string {
  if (authToken !== undefined) {
    return host;
  }

  if (!isLoopbackHost(host)) {
    console.error(`⚠ --host ${host} requires FABRIC_AUTH_TOKEN; falling back to 127.0.0.1 for safety`);
    return "127.0.0.1";
  }

  return host;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
