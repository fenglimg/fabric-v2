import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEventsHandler } from "./events.js";
import { appendEventLedgerEvent } from "../services/event-ledger.js";

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("createEventsHandler", () => {
  it("emits ledger:appended when .fabric/events.jsonl receives an edit_intent_checked event", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "events.jsonl"), "", "utf8");
    const server = await listen(createEventsHandler({ projectRoot }));
    const eventsPromise = readSseUntil(
      `http://127.0.0.1:${addressPort(server)}/events`,
      (frame) => frame.includes("event: ledger:appended"),
      async () => {
        await appendEventLedgerEvent(projectRoot, {
          event_type: "edit_intent_checked",
          id: "event:sse",
          ts: 2_000,
          path: "src/sse.ts",
          compliant: true,
          intent: "sse projection",
          ledger_entry_id: "ledger:sse",
          matched_rule_context_ts: null,
          window_ms: 5_000,
        });
      },
    );

    const frame = await eventsPromise;

    expect(frame).toContain("event: ledger:appended");
    expect(frame).toContain("\"id\":\"ledger:sse\"");
    expect(frame).toContain("\"affected_paths\":[\"src/sse.ts\"]");
  }, 10_000);
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-events-api-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

async function listen(handler: Parameters<typeof createServer>[0]): Promise<Server> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readSseUntil(
  url: string,
  predicate: (frame: string) => boolean,
  onConnected: () => Promise<void>,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("SSE response did not include a readable body.");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let connected = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error("SSE stream ended before expected event.");
      }

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        if (!connected && frame.includes(": connected")) {
          connected = true;
          await onConnected();
        }

        if (predicate(frame)) {
          await reader.cancel();
          return frame;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function addressPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Server did not listen on a TCP port.");
  }

  return address.port;
}
