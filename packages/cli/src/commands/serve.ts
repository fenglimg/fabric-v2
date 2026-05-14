import { defineCommand } from "citty";

import { acquireLock, releaseLock, startHttpServer } from "@fenglimg/fabric-server";

import { paint, symbol } from "../colors.js";
import { createDebugLogger, resolveDevMode } from "../dev-mode.js";
import { t } from "../i18n.js";
import { hasActionHint, renderFabricError } from "../lib/error-render.js";

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
    description: t("cli.serve.description"),
  },
  args: {
    port: {
      type: "string",
      description: t("cli.serve.args.port.description"),
      default: String(DEFAULT_PORT),
    },
    host: {
      type: "string",
      description: t("cli.serve.args.host.description"),
      default: "127.0.0.1",
    },
    target: {
      type: "string",
      description: t("cli.serve.args.target.description"),
    },
    debug: {
      type: "boolean",
      description: t("cli.serve.args.debug.description"),
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
    const projectRoot = resolution.target;

    // Acquire serve lock — throws ServeLockHeldError if another live serve is running.
    // rc.15: --force was removed (drift→abort principle); lock conflicts always
    // require the user to stop the other process via the action hint message.
    // rc.15 TASK-007: explicitly render `.actionHint` from FabricError-shaped
    // failures (citty's default handler prints `.message` only) so the verbose
    // PID + Ctrl-C/kill guidance reaches the user's terminal.
    try {
      acquireLock(projectRoot);
    } catch (err) {
      if (hasActionHint(err)) {
        renderFabricError(err);
        process.exit(1);
      }
      throw err;
    }
    // Backstop: release lock on process exit (handles normal + SIGTERM/SIGINT cleanup)
    process.on("exit", () => { releaseLock(projectRoot); });

    logger(`serve target source: ${resolution.source}`);
    for (const step of resolution.chain) {
      logger(step);
    }

    try {
      await startHttpServer({
        port,
        projectRoot,
        host,
        authToken,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "EADDRINUSE") {
        releaseLock(projectRoot);
        throw new Error(t("cli.serve.error.port-in-use", { port: String(port), nextPort: String(port + 1) }));
      }

      releaseLock(projectRoot);
      throw error;
    }

    console.log(`${symbol.ok} ${paint.ai(t("cli.serve.ready.title"))} ${paint.human(`http://${host}:${port}`)}`);
  },
});

export default serveCommand;

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? String(DEFAULT_PORT), 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(t("cli.shared.invalid-port", { value: value ?? "<unset>" }));
  }

  return port;
}

function parseHost(value: string | undefined): string {
  const host = value?.trim() ?? "127.0.0.1";

  if (host.length === 0) {
    throw new Error(t("cli.shared.invalid-host-empty"));
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
    console.error(
      `${symbol.warn} ${paint.warn(t("cli.serve.warning.host-fallback", { host }))}`,
    );
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
