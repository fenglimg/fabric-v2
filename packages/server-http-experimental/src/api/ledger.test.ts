import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { registerLedgerApi } from "./ledger.js";
import { appendEventLedgerEvent } from "../services/event-ledger.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("registerLedgerApi", () => {
  it("returns legacy-compatible ledger payloads projected from Event Ledger", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: "rev-api", nodes: {} })}\n`,
      "utf8",
    );
    await appendEventLedgerEvent(projectRoot, {
      event_type: "edit_intent_checked",
      id: "event:api-ledger",
      ts: 2_000,
      path: "src/api.ts",
      compliant: true,
      intent: "api projection",
      ledger_entry_id: "ledger:api",
      matched_rule_context_ts: null,
      window_ms: 5_000,
    });

    const route = captureLedgerRoute(projectRoot);
    const response = await callRoute(route, { query: {} });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([
      {
        id: "ledger:api",
        ts: 2_000,
        source: "ai",
        intent: "api projection",
        affected_paths: ["src/api.ts"],
      },
    ]);
  });
});

type CapturedRoute = (req: { query: Record<string, unknown> }, res: MockResponse) => Promise<void>;

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
};

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-ledger-api-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

function captureLedgerRoute(projectRoot: string): CapturedRoute {
  let route: CapturedRoute | undefined;
  const app = {
    get(path: string, handler: CapturedRoute) {
      if (path === "/api/ledger") {
        route = handler;
      }
    },
  };

  registerLedgerApi(app as never, projectRoot);

  if (route === undefined) {
    throw new Error("Ledger route was not registered.");
  }

  return route;
}

async function callRoute(
  route: CapturedRoute,
  req: { query: Record<string, unknown> },
): Promise<MockResponse> {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  await route(req, res);
  return res;
}
