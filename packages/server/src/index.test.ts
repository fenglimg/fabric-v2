import type { Server as HttpServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("startHttpServer", () => {
  it("disposes HTTP app resources when the server closes", async () => {
    let closeHandler: (() => void) | undefined;
    const dispose = vi.fn().mockResolvedValue(undefined);
    const fakeServer = {
      once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "listening") {
          queueMicrotask(() => {
            handler();
          });
        }
        if (event === "close") {
          closeHandler = () => {
            handler();
          };
        }
        return fakeServer;
      }),
    } as unknown as HttpServer;

    vi.doMock("./http.js", () => ({
      createFabricHttpApp: vi.fn(() => ({
        listen: vi.fn(() => fakeServer),
        dispose,
      })),
    }));

    const { startHttpServer } = await import("./index.js");
    const serverPromise = startHttpServer({
      port: 7373,
      projectRoot: "/tmp/fabric-project",
    });

    const server = await serverPromise;

    expect(server).toBe(fakeServer);
    expect(dispose).not.toHaveBeenCalled();

    closeHandler?.();
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledTimes(1);
  }, 10_000);
});

describe("createFabricServer", () => {
  it("registers only current MCP tools", async () => {
    const registerTool = vi.fn();
    const registerResource = vi.fn();
    vi.stubGlobal("__SERVER_VERSION__", "test");

    vi.doMock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
      McpServer: vi.fn(() => ({
        registerTool,
        registerResource,
      })),
    }));

    const { createFabricServer } = await import("./index.js");

    createFabricServer();

    const toolNames = registerTool.mock.calls.map((call) => call[0]);
    expect(toolNames.sort()).toEqual(["fab_get_rule_sections", "fab_plan_context"]);
  });
});
