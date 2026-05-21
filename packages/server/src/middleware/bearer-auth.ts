import { createHash, timingSafeEqual } from "node:crypto";

import { sendError } from "../api/_error.js";

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (payload: unknown) => void;
};

type NextFunction = () => void;

export function createBearerAuthMiddleware(token: string) {
  const expectedDigest = hashToken(token);

  return function bearerAuthMiddleware(req: RequestLike, res: ResponseLike, next: NextFunction): void {
    const header = readAuthorizationHeader(req.headers.authorization);
    const providedToken = parseBearerToken(header);

    if (providedToken === undefined || !tokensMatch(providedToken, expectedDigest)) {
      sendError(res, 401, "UNAUTHORIZED", "Bearer token required");
      return;
    }

    next();
  };
}

// v2.0.0-rc.29 TASK-002 (BUG-K1): deny-all middleware mounted on /api /events
// /mcp when no FABRIC_AUTH_TOKEN is set AND the operator did not pass
// `--allow-loopback-no-auth`. Default-deny closes the audit-confirmed leak
// where any local process could curl http://127.0.0.1:7373/api/rules and
// read agents.meta.json / forensic.json / events.jsonl with zero auth.
export function createLoopbackDenyMiddleware() {
  return function loopbackDenyMiddleware(_req: RequestLike, res: ResponseLike, _next: NextFunction): void {
    sendError(
      res,
      401,
      "UNAUTHORIZED",
      "FABRIC_AUTH_TOKEN is not set. Either export FABRIC_AUTH_TOKEN=<secret> before running `fab serve`, or pass `--allow-loopback-no-auth` to explicitly opt in to unauthenticated loopback access (security risk).",
    );
  };
}

function readAuthorizationHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((entry) => entry.length > 0);
  }

  return undefined;
}

function parseBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

function tokensMatch(token: string, expectedDigest: Buffer): boolean {
  return timingSafeEqual(hashToken(token), expectedDigest);
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
