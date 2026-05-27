/**
 * bearer-auth.test.ts — I7 integration tests
 *
 * Invariant I7: When FABRIC_AUTH_TOKEN is configured, requests to /api, /events,
 * and /mcp without a correct Bearer token must return HTTP 401. When the env var
 * is not set, the middleware must NOT be mounted (requests pass through).
 *
 * Strategy: call createBearerAuthMiddleware directly and exercise the error path
 * via a mock req/res pair, and verify that createFabricHttpApp only mounts the
 * middleware when authToken is provided.
 */

import { describe, it, expect } from "vitest";

import { createBearerAuthMiddleware, createLoopbackDenyMiddleware } from "../../src/middleware/bearer-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockRequest = {
  headers: {
    authorization?: string;
  };
};

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

function makeRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// I7: Bearer auth middleware behaviour
// ---------------------------------------------------------------------------

describe("I7 — bearer auth middleware (createBearerAuthMiddleware)", () => {
  it("returns 401 when Authorization header is absent", () => {
    const mw = createBearerAuthMiddleware("secret-token");
    const req: MockRequest = { headers: {} };
    const res = makeRes();
    let nextCalled = false;

    mw(req as Parameters<typeof mw>[0], res as Parameters<typeof mw>[1], () => {
      nextCalled = true;
    });

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when Bearer token is wrong", () => {
    const mw = createBearerAuthMiddleware("correct-token");
    const req: MockRequest = { headers: { authorization: "Bearer wrong-token" } };
    const res = makeRes();
    let nextCalled = false;

    mw(req as Parameters<typeof mw>[0], res as Parameters<typeof mw>[1], () => {
      nextCalled = true;
    });

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("returns 401 for malformed Authorization header (no Bearer scheme)", () => {
    const mw = createBearerAuthMiddleware("secret");
    const req: MockRequest = { headers: { authorization: "Basic dXNlcjpwYXNz" } };
    const res = makeRes();
    let nextCalled = false;

    mw(req as Parameters<typeof mw>[0], res as Parameters<typeof mw>[1], () => {
      nextCalled = true;
    });

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("calls next() when correct Bearer token is provided", () => {
    const mw = createBearerAuthMiddleware("my-secret-token");
    const req: MockRequest = { headers: { authorization: "Bearer my-secret-token" } };
    const res = makeRes();
    let nextCalled = false;

    mw(req as Parameters<typeof mw>[0], res as Parameters<typeof mw>[1], () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200); // no status change
  });

  it("uses timing-safe comparison (identical-length wrong token still returns 401)", () => {
    const mw = createBearerAuthMiddleware("correct-token-1234");
    const req: MockRequest = { headers: { authorization: "Bearer wrooong-token-1234" } };
    const res = makeRes();
    let nextCalled = false;

    mw(req as Parameters<typeof mw>[0], res as Parameters<typeof mw>[1], () => {
      nextCalled = true;
    });

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("Bearer scheme matching is case-insensitive (lowercase 'bearer' accepted)", () => {
    const mw = createBearerAuthMiddleware("tok");
    const req: MockRequest = { headers: { authorization: "bearer tok" } };
    const res = makeRes();
    let nextCalled = false;

    mw(req as Parameters<typeof mw>[0], res as Parameters<typeof mw>[1], () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it("error body conforms to {error:{code,message}} shape (I6 alignment)", () => {
    const mw = createBearerAuthMiddleware("token");
    const req: MockRequest = { headers: {} };
    const res = makeRes();

    mw(req as Parameters<typeof mw>[0], res as Parameters<typeof mw>[1], () => {});

    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty("error");
    const err = body.error as Record<string, unknown>;
    expect(typeof err.code).toBe("string");
    expect(typeof err.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// rc.29 TASK-002 (BUG-K1): loopback default-deny middleware
// ---------------------------------------------------------------------------

describe("rc.29 TASK-002 — createLoopbackDenyMiddleware (BUG-K1)", () => {
  it("returns 401 unconditionally with a remediation hint pointing at FABRIC_AUTH_TOKEN and --allow-loopback-no-auth", () => {
    const mw = createLoopbackDenyMiddleware();
    const req: MockRequest = { headers: { authorization: "Bearer anything" } };
    const res = makeRes();
    let nextCalled = false;

    mw(req as Parameters<typeof mw>[0], res as Parameters<typeof mw>[1], () => {
      nextCalled = true;
    });

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toContain("FABRIC_AUTH_TOKEN");
    expect(body.error.message).toContain("--allow-loopback-no-auth");
  });

  it("returns 401 even when an Authorization header is absent (no inadvertent bypass)", () => {
    const mw = createLoopbackDenyMiddleware();
    const req: MockRequest = { headers: {} };
    const res = makeRes();
    let nextCalled = false;

    mw(req as Parameters<typeof mw>[0], res as Parameters<typeof mw>[1], () => {
      nextCalled = true;
    });

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });
});
