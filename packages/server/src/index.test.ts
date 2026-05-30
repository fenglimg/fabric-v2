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
      "fab_archive_scan",
      "fab_extract_knowledge",
      "fab_get_knowledge_sections",
      "fab_plan_context",
      "fab_recall",
      "fab_review",
    ]);
  });

  // v2.2 MC2-server-instructions (W1-T6): the server must hand the MCP client a
  // server-level `instructions` string at construction (D2 MCP-first anchor).
  it("passes server-level instructions to the McpServer constructor", async () => {
    const McpServerMock = vi.fn(() => ({
      registerTool: vi.fn(),
      registerResource: vi.fn(),
    }));
    vi.stubGlobal("__SERVER_VERSION__", "test");
    vi.doMock("@modelcontextprotocol/sdk/server/mcp.js", () => ({ McpServer: McpServerMock }));

    const { createFabricServer, FABRIC_SERVER_INSTRUCTIONS } = await import("./index.js");
    createFabricServer();

    // Second constructor arg (ServerOptions) carries the instructions.
    const firstCall = McpServerMock.mock.calls[0] as unknown[] | undefined;
    const options = firstCall?.[1] as { instructions?: string } | undefined;
    expect(options?.instructions).toBe(FABRIC_SERVER_INSTRUCTIONS);
  });

  // Contract on the instruction content itself — deterministic, no mock needed.
  it("the server instructions document the retrieval flow, tool manifest, and conventions", async () => {
    vi.stubGlobal("__SERVER_VERSION__", "test");
    const { FABRIC_SERVER_INSTRUCTIONS } = await import("./index.js");

    expect(FABRIC_SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    // Canonical retrieval flow: one-step recall + two-step plan→sections.
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("fab_recall");
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("fab_plan_context");
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("fab_get_knowledge_sections");
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("selection_token");
    // Full tool manifest — all six registered tools are described.
    for (const tool of ["fab_recall", "fab_plan_context", "fab_get_knowledge_sections", "fab_extract_knowledge", "fab_archive_scan", "fab_review"]) {
      expect(FABRIC_SERVER_INSTRUCTIONS).toContain(tool);
    }
    // Conventions: session_id + cite.
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("session_id");
    expect(FABRIC_SERVER_INSTRUCTIONS.toLowerCase()).toContain("cite");
  });
});
