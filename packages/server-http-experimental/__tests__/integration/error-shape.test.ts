/**
 * error-shape.test.ts — I6 integration tests
 *
 * Invariant I6: REST error responses must have a unified shape:
 *   { error: { code: string, message: string, actionHint?: string } }
 * Specific expectations:
 *   - PathEscape-class errors -> 403
 *   - ledger/lock-class errors -> 404 (or FabricError subclass httpStatus)
 *   - other FabricError subclasses -> their own httpStatus
 *   - generic unknown errors -> 500
 *
 * Strategy: call sendError / sendUnknownError directly with mock response
 * objects. Also verify the normalizeApiError path via FabricError subclasses.
 */

import { describe, it, expect } from "vitest";

import { sendError, sendUnknownError } from "../../src/api/_error.js";
import { PathEscapeError } from "@fenglimg/fabric-shared/errors";
import { ServeLockHeldError } from "../../src/services/serve-lock.js";

// ---------------------------------------------------------------------------
// Mock response
// ---------------------------------------------------------------------------

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
// I6: error response shape
// ---------------------------------------------------------------------------

describe("I6 — REST error response unified shape", () => {
  it("sendError produces {error:{code,message}} body with correct status", () => {
    const res = makeRes();
    sendError(res as Parameters<typeof sendError>[0], 422, "RULE_INVALID", "Rule frontmatter is invalid");

    expect(res.statusCode).toBe(422);
    const body = res.body as { error: { code: string; message: string } };
    expect(body).toHaveProperty("error");
    expect(body.error.code).toBe("RULE_INVALID");
    expect(body.error.message).toBe("Rule frontmatter is invalid");
  });

  it("sendError includes details when provided", () => {
    const res = makeRes();
    sendError(res as Parameters<typeof sendError>[0], 400, "BAD_REQUEST", "Invalid input", { field: "path" });

    const body = res.body as { error: { code: string; message: string; details?: unknown } };
    expect(body.error.details).toEqual({ field: "path" });
  });

  it("sendUnknownError maps PathEscapeError to 403 status", () => {
    const res = makeRes();
    const err = new PathEscapeError("path escapes sandbox", {
      actionHint: "Use a path within the project root",
    });
    sendUnknownError(res as Parameters<typeof sendUnknownError>[0], err);

    expect(res.statusCode).toBe(403);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("PATH_OUTSIDE_PROJECT_ROOT");
    expect(body.error.message).toContain("escapes");
  });

  it("sendUnknownError maps ServeLockHeldError to 423 status (lock subclass)", () => {
    const res = makeRes();
    const err = new ServeLockHeldError("serve lock held by PID 99", {
      actionHint: "Stop the other server",
    });
    sendUnknownError(res as Parameters<typeof sendUnknownError>[0], err);

    expect(res.statusCode).toBe(423);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("SERVE_LOCK_HELD");
  });

  it("sendUnknownError maps FabricError-shaped objects without relying on class identity", () => {
    const res = makeRes();
    const err = {
      message: "cross-bundle path escape",
      actionHint: "Use a path within the project root",
      httpStatus: 403,
      code: "PATH_OUTSIDE_PROJECT_ROOT",
      details: { path: "../outside" },
    };
    sendUnknownError(res as Parameters<typeof sendUnknownError>[0], err);

    expect(res.statusCode).toBe(403);
    const body = res.body as { error: { code: string; message: string; details?: unknown } };
    expect(body.error.code).toBe("PATH_OUTSIDE_PROJECT_ROOT");
    expect(body.error.message).toBe("cross-bundle path escape");
    expect(body.error.details).toEqual({ path: "../outside" });
  });

  it("sendUnknownError maps generic Error to 500 with INTERNAL_ERROR code", () => {
    const res = makeRes();
    sendUnknownError(res as Parameters<typeof sendUnknownError>[0], new Error("unexpected failure"));

    expect(res.statusCode).toBe(500);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("unexpected failure");
  });

  it("sendUnknownError maps non-Error throw to 500 with INTERNAL_ERROR code", () => {
    const res = makeRes();
    sendUnknownError(res as Parameters<typeof sendUnknownError>[0], "string error");

    expect(res.statusCode).toBe(500);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toContain("string error");
  });

  it("error body does NOT contain extraneous top-level fields", () => {
    const res = makeRes();
    sendError(res as Parameters<typeof sendError>[0], 400, "SOME_CODE", "Some message");

    const body = res.body as Record<string, unknown>;
    const topLevelKeys = Object.keys(body);
    expect(topLevelKeys).toEqual(["error"]);
  });

  it("error shape has code and message within error object", () => {
    const res = makeRes();
    sendError(res as Parameters<typeof sendError>[0], 404, "NOT_FOUND", "Resource not found");

    const body = res.body as { error: Record<string, unknown> };
    expect(typeof body.error.code).toBe("string");
    expect(typeof body.error.message).toBe("string");
  });
});
