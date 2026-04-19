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
