import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

// v2.0.0-rc.37 Wave A2: `describe("startHttpServer", ...)` block removed.
// startHttpServer was quarantined to packages/server-http-experimental/ per
// KB [[fabric-serve-quarantine-not-delete]]; this block tested the HTTP boot
// path that no longer exists in main. Restore alongside startHttpServer if
// the web UI surface is ever re-enabled.

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
    expect(toolNames.sort()).toEqual([
      "fab_extract_knowledge",
      "fab_get_knowledge_sections",
      "fab_plan_context",
      "fab_review",
    ]);
  });
});
