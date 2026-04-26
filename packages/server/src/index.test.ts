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
  it("registers current tools and marks legacy mutation tools deprecated", async () => {
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
    const toolDescriptions = new Map(
      registerTool.mock.calls.map((call) => [call[0], call[1]?.description as string | undefined]),
    );
    expect(toolNames).toContain("fab_get_rule_sections");
    expect(toolNames).toContain("fab_plan_context");
    expect(toolNames).not.toContain("fab_get_rules");
    expect(toolDescriptions.get("fab_append_intent")).toContain("Deprecated compatibility surface");
    expect(toolDescriptions.get("fab_update_registry")).toContain("Deprecated compatibility surface");
  });
});
