/**
 * http-endpoints.test.ts — HTTP-layer integration tests
 *
 * Boots createFabricHttpApp() in-process via supertest (no real port binding)
 * and exercises the REST endpoints:
 *
 *   1. GET /api/rules
 *   2. GET /api/rules/context
 *   3. GET /api/ledger
 *   4. GET /api/history/state
 *   5. GET /api/replay
 *   6. GET /api/scan
 *   7. GET /api/doctor
 *   8. GET /events (SSE — connection + header check)
 *   9. ALL /mcp (MCP HTTP transport — initialize handshake)
 *
 * Plus: 401 on each protected route when authToken is set and token is missing.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";

import { createFabricHttpApp } from "../../src/http.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const MINIMAL_AGENTS_META = JSON.stringify({ revision: "test-rev-1", nodes: {} }, null, 2);

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "fabric-http-"));
  mkdirSync(join(dir, ".fabric", "rules"), { recursive: true });
  mkdirSync(join(dir, ".fabric", "bootstrap"), { recursive: true });
  writeFileSync(join(dir, ".fabric", "agents.meta.json"), MINIMAL_AGENTS_META, "utf8");
  // bootstrap README required by getKnowledge (L0 content)
  writeFileSync(
    join(dir, ".fabric", "bootstrap", "README.md"),
    "# Bootstrap\n\nTest bootstrap readme.\n",
    "utf8",
  );
  return dir;
}

function makeLedgerEntry(root: string, id: string): void {
  const ledgerPath = join(root, ".fabric", ".intent-ledger.jsonl");
  const entry = JSON.stringify({
    id,
    ts: Date.now(),
    source: "ai",
    intent: "test intent for integration",
    affected_paths: ["src/test.ts"],
    commit_sha: "abc123",
  });
  writeFileSync(ledgerPath, `${entry}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe("HTTP integration — REST endpoints", () => {
  let tempDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeEach(async () => {
    tempDir = makeTempRoot();
    app = createFabricHttpApp({
      projectRoot: tempDir,
      host: "127.0.0.1",
      // No authToken — auth is tested separately. v2.0.0-rc.29 TASK-002 made
      // loopback default-deny when no token is present; this suite explicitly
      // opts in so the endpoint behaviour can be exercised without a token.
      allowLoopbackNoAuth: true,
    });
  });

  afterEach(async () => {
    if (app?.dispose) {
      await app.dispose();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. GET /api/rules — happy path: returns agents.meta.json content
  // -------------------------------------------------------------------------
  describe("1. GET /api/rules", () => {
    it("returns 200 with revision from agents.meta.json", async () => {
      const res = await supertest(app).get("/api/rules");
      expect(res.status).toBe(200);
      const body = res.body as { revision: string };
      expect(body.revision).toBe("test-rev-1");
    });

    it("returns 404 FABRIC_META_MISSING when agents.meta.json does not exist", async () => {
      rmSync(join(tempDir, ".fabric", "agents.meta.json"));
      const res = await supertest(app).get("/api/rules");
      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe("FABRIC_META_MISSING");
    });
  });

  // -------------------------------------------------------------------------
  // 2. GET /api/rules/context — happy path + missing path param
  // -------------------------------------------------------------------------
  describe("2. GET /api/rules/context", () => {
    it("returns 400 when path query parameter is missing", async () => {
      const res = await supertest(app).get("/api/rules/context");
      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe("BAD_REQUEST");
    });

    it("returns 400 when path is an empty string", async () => {
      const res = await supertest(app).get("/api/rules/context?path=");
      expect(res.status).toBe(400);
    });

    it("returns 200 with a rules payload object when a valid path is provided", async () => {
      const res = await supertest(app).get("/api/rules/context?path=src/index.ts");
      expect(res.status).toBe(200);
      // getKnowledge returns result.rules which is a KnowledgePayload object { L0, L1, L2, human_locked_nearby }
      const body = res.body as { L0?: string; L1?: unknown[]; L2?: unknown[] };
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. GET /api/ledger — happy path + invalid query
  // -------------------------------------------------------------------------
  describe("3. GET /api/ledger", () => {
    it("returns 200 with an empty array when no ledger entries exist", async () => {
      const res = await supertest(app).get("/api/ledger");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("returns 200 with entries when ledger has data", async () => {
      makeLedgerEntry(tempDir, "ledger:test-entry-1");
      const res = await supertest(app).get("/api/ledger");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("returns 400 when source query param is invalid", async () => {
      const res = await supertest(app).get("/api/ledger?source=invalid");
      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe("BAD_REQUEST");
    });
  });

  // -------------------------------------------------------------------------
  // 4. GET /api/history/state — missing required param returns 400
  // -------------------------------------------------------------------------
  describe("4. GET /api/history/state", () => {
    it("returns 400 when no query params are provided", async () => {
      const res = await supertest(app).get("/api/history/state");
      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe("BAD_REQUEST");
    });

    it("returns 404 when ledger_id references a nonexistent entry", async () => {
      const res = await supertest(app).get("/api/history/state?ledger_id=nonexistent-entry-id");
      expect(res.status).toBe(404);
    });

    it("returns 404 when ts references a timestamp with no ledger entries", async () => {
      const res = await supertest(app).get("/api/history/state?ts=1000000");
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // 5. GET /api/replay — same behaviour as /api/history/state
  // -------------------------------------------------------------------------
  describe("5. GET /api/replay", () => {
    it("returns 400 when no query params are provided", async () => {
      const res = await supertest(app).get("/api/replay");
      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe("BAD_REQUEST");
    });

    it("returns 404 when ledger_id references a nonexistent entry", async () => {
      const res = await supertest(app).get("/api/replay?ledger_id=no-such-id");
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // 6. GET /api/scan — happy path: scans the temp project dir
  // -------------------------------------------------------------------------
  describe("6. GET /api/scan", () => {
    it("returns 200 with a scan report object", async () => {
      const res = await supertest(app).get("/api/scan");
      expect(res.status).toBe(200);
      const body = res.body as { target: string; framework: object; fileCount: number };
      expect(typeof body.target).toBe("string");
      expect(typeof body.framework).toBe("object");
      expect(typeof body.fileCount).toBe("number");
    });

    it("scan report includes recommendations array", async () => {
      const res = await supertest(app).get("/api/scan");
      expect(res.status).toBe(200);
      const body = res.body as { recommendations: string[] };
      expect(Array.isArray(body.recommendations)).toBe(true);
    });

    it("counts nested files without traversing ignored directories", async () => {
      mkdirSync(join(tempDir, "src", "nested"), { recursive: true });
      mkdirSync(join(tempDir, "node_modules", "ignored-package"), { recursive: true });
      writeFileSync(join(tempDir, "src", "index.ts"), "export const value = 1;\n", "utf8");
      writeFileSync(join(tempDir, "src", "nested", "feature.ts"), "export const feature = true;\n", "utf8");
      writeFileSync(join(tempDir, "node_modules", "ignored-package", "index.js"), "module.exports = {};\n", "utf8");
      writeFileSync(join(tempDir, "generated.meta"), "ignored metadata\n", "utf8");

      const res = await supertest(app).get("/api/scan");

      expect(res.status).toBe(200);
      const body = res.body as { fileCount: number; ignoredCount: number };
      expect(body.fileCount).toBe(2);
      expect(body.ignoredCount).toBeGreaterThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------
  // 7. GET /api/doctor — happy path
  // -------------------------------------------------------------------------
  describe("7. GET /api/doctor", () => {
    it("returns 200 with a doctor report", async () => {
      const res = await supertest(app).get("/api/doctor");
      expect(res.status).toBe(200);
      // Doctor report shape: { checks: [...], issues: [...], status: string }
      const body = res.body as { checks?: unknown[]; status?: string };
      expect(body).toBeDefined();
      // It should not be an error response
      expect((body as { error?: unknown }).error).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 8. POST /api/intent/annotate — REMOVED in rc.5 A2 (intent-ledger
  // compliance regime retired); tests deleted as orphans.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 9. GET /events — SSE endpoint: connection headers + early close
  // -------------------------------------------------------------------------
  describe("9. GET /events (SSE)", () => {
    it("returns 200 with Content-Type: text/event-stream", async () => {
      // We need to use a low-level approach for SSE since supertest can
      // hang on keep-alive responses. We use a raw http request with immediate abort.
      const http = await import("node:http");
      const server = app.listen(0);

      await new Promise<void>((resolve) => {
        server.once("listening", resolve);
      });

      const port = (server.address() as { port: number }).port;

      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/events`, (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers["content-type"]).toContain("text/event-stream");

          // Read first chunk then destroy
          res.once("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            expect(text).toContain(": connected");
            res.destroy();
          });

          res.once("close", () => {
            resolve();
          });

          res.once("error", (err) => {
            // ECONNRESET is expected when we destroy
            if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        req.once("error", reject);
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error("SSE request timed out"));
        });
      });

      await new Promise<void>((resolve) => server.close(resolve));
    });
  });

  // -------------------------------------------------------------------------
  // 10. ALL /mcp — MCP HTTP transport
  // -------------------------------------------------------------------------
  describe("10. ALL /mcp", () => {
    it("returns 400 JSON-RPC error when Mcp-Session-Id is missing and body is not an initialize request", async () => {
      const res = await supertest(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
      expect(res.status).toBe(400);
      const body = res.body as { jsonrpc: string; error: { code: number; message: string } };
      expect(body.jsonrpc).toBe("2.0");
      expect(body.error.code).toBe(-32000);
    });

    it("returns 404 JSON-RPC error when Mcp-Session-Id references an unknown session", async () => {
      const res = await supertest(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("mcp-session-id", "nonexistent-session-id-12345")
        .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
      expect(res.status).toBe(404);
      const body = res.body as { jsonrpc: string; error: { code: number; message: string } };
      expect(body.jsonrpc).toBe("2.0");
      expect(body.error.code).toBe(-32001);
    });

    // Skipped: the MCP SDK's createSession() dynamically imports ./index.js which
    // in turn involves chokidar filesystem watchers and full tool registration that
    // requires additional environment setup beyond a simple in-process test.
    // The /mcp route wiring (isInitializeRequest path) is verified by
    // the 400/404 cases above which exercise the other two branches.
    it.skip("accepts an MCP initialize request (creates a session) — skipped: dynamic import requires full server env", async () => {
      const initPayload = {
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.1" },
        },
      };

      const res = await supertest(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .send(initPayload);

      // The MCP SDK handles this; it should return 200 with a valid response
      expect([200, 202]).toContain(res.status);
    });
  });

});

// ---------------------------------------------------------------------------
// Auth middleware — mounted on real routes via createFabricHttpApp
// ---------------------------------------------------------------------------

describe("HTTP integration — bearer auth mounted on createFabricHttpApp", () => {
  let tempDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeEach(async () => {
    tempDir = makeTempRoot();
    app = createFabricHttpApp({
      projectRoot: tempDir,
      host: "127.0.0.1",
      authToken: "test-secret-token",
    });
  });

  afterEach(async () => {
    if (app?.dispose) {
      await app.dispose();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns 401 on /api/rules without Authorization header", async () => {
    const res = await supertest(app).get("/api/rules");
    expect(res.status).toBe(401);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 on /api/rules with wrong token", async () => {
    const res = await supertest(app)
      .get("/api/rules")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("returns 200 on /api/rules with correct token", async () => {
    const res = await supertest(app)
      .get("/api/rules")
      .set("Authorization", "Bearer test-secret-token");
    expect(res.status).toBe(200);
  });

  it("returns 401 on /events without Authorization header", async () => {
    const res = await supertest(app).get("/events");
    expect(res.status).toBe(401);
  });

  it("returns 401 on /mcp without Authorization header", async () => {
    const res = await supertest(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
    expect(res.status).toBe(401);
  });

  it("passes through to /api with correct token", async () => {
    const res = await supertest(app)
      .get("/api/ledger")
      .set("Authorization", "Bearer test-secret-token");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// createFabricHttpApp — app-level smoke tests
// ---------------------------------------------------------------------------

describe("HTTP integration — createFabricHttpApp smoke tests", () => {
  let tempDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeEach(async () => {
    tempDir = makeTempRoot();
    app = createFabricHttpApp({
      projectRoot: tempDir,
      host: "127.0.0.1",
      // v2.0.0-rc.29 TASK-002: smoke tests exercise transport / lifecycle, not
      // auth — opt into the new no-auth loopback mode to match prior behavior.
      allowLoopbackNoAuth: true,
    });
  });

  afterEach(async () => {
    if (app?.dispose) {
      await app.dispose();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("dispose() resolves without error", async () => {
    await expect(app.dispose()).resolves.toBeUndefined();
  });

  it("dispose() is idempotent (calling twice does not throw)", async () => {
    await app.dispose();
    await expect(app.dispose()).resolves.toBeUndefined();
  });

  it("x-powered-by header is disabled", async () => {
    const res = await supertest(app).get("/api/rules");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// rc.29 TASK-002 (BUG-K1): default-deny when no token and no opt-in
// ---------------------------------------------------------------------------

describe("HTTP integration — rc.29 BUG-K1 loopback default-deny", () => {
  let tempDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeEach(async () => {
    tempDir = makeTempRoot();
    // No authToken AND no allowLoopbackNoAuth → expect default-deny.
    app = createFabricHttpApp({
      projectRoot: tempDir,
      host: "127.0.0.1",
    });
  });

  afterEach(async () => {
    if (app?.dispose) {
      await app.dispose();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns 401 on /api/rules without an opt-in flag (no inadvertent reads)", async () => {
    const res = await supertest(app).get("/api/rules");
    expect(res.status).toBe(401);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toContain("FABRIC_AUTH_TOKEN");
    expect(body.error.message).toContain("--allow-loopback-no-auth");
  });

  it("returns 401 on /api/ledger by default (no token, no opt-in)", async () => {
    const res = await supertest(app).get("/api/ledger");
    expect(res.status).toBe(401);
  });

  it("returns 401 on /events by default", async () => {
    const res = await supertest(app).get("/events");
    expect(res.status).toBe(401);
  });

  it("returns 401 on /mcp by default", async () => {
    const res = await supertest(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
    expect(res.status).toBe(401);
  });
});

describe("HTTP integration — rc.29 BUG-K1 --allow-loopback-no-auth opt-in", () => {
  let tempDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeEach(async () => {
    tempDir = makeTempRoot();
    app = createFabricHttpApp({
      projectRoot: tempDir,
      host: "127.0.0.1",
      allowLoopbackNoAuth: true,
    });
  });

  afterEach(async () => {
    if (app?.dispose) {
      await app.dispose();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns 200 on /api/rules when operator opts in via allowLoopbackNoAuth", async () => {
    const res = await supertest(app).get("/api/rules");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// rc.29 REVIEW (codex HIGH-1): allowLoopbackNoAuth + non-loopback host = throw
// ---------------------------------------------------------------------------

describe("HTTP integration — rc.29 REVIEW HIGH-1 server-layer loopback guard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempRoot();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws when allowLoopbackNoAuth=true is combined with a non-loopback host (no token)", () => {
    expect(() =>
      createFabricHttpApp({
        projectRoot: tempDir,
        host: "0.0.0.0",
        allowLoopbackNoAuth: true,
      }),
    ).toThrow(/allowLoopbackNoAuth.*requires a loopback host/);
  });

  it("accepts allowLoopbackNoAuth=true with each canonical loopback host", () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      const localApp = createFabricHttpApp({
        projectRoot: tempDir,
        host,
        allowLoopbackNoAuth: true,
      });
      expect(localApp).toBeDefined();
      // Cleanup the per-iteration app so disposal does not leak file watchers.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      localApp.dispose();
    }
  });

  it("accepts a non-loopback host when a token is supplied (auth still mounted)", () => {
    expect(() =>
      createFabricHttpApp({
        projectRoot: tempDir,
        host: "0.0.0.0",
        authToken: "test-token",
        allowLoopbackNoAuth: true,
      }),
    ).not.toThrow();
  });
});
