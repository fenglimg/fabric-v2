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
    // W1-2 (KT-DEC-0026): the two-step fab_plan_context / fab_get_knowledge_sections
    // MCP tools are retired — recall collapsed to ONE lean tool.
    expect(toolNames.sort()).toEqual([
      "fab_archive_scan",
      "fab_pending",
      "fab_propose",
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
    // W1-2 (KT-DEC-0026): single lean retrieval flow — fab_recall returns
    // descriptions + read paths; bodies are loaded via a native Read. The
    // retired two-step tools must NOT appear in the manifest anymore.
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("fab_recall");
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("knowledge_body_read");
    expect(FABRIC_SERVER_INSTRUCTIONS).not.toContain("fab_plan_context");
    expect(FABRIC_SERVER_INSTRUCTIONS).not.toContain("fab_get_knowledge_sections");
    expect(FABRIC_SERVER_INSTRUCTIONS).not.toContain("selection_token");
    // Full tool manifest — the current tools are described (W3-K K2 added
    // the read-only fab_pending alongside the now write-only fab_review).
    for (const tool of ["fab_recall", "fab_propose", "fab_archive_scan", "fab_pending", "fab_review"]) {
      expect(FABRIC_SERVER_INSTRUCTIONS).toContain(tool);
    }
    // Conventions: session_id + cite.
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("session_id");
    expect(FABRIC_SERVER_INSTRUCTIONS.toLowerCase()).toContain("cite");
    // ux-w2-7: tools are grouped by audience — AGENT-DIRECT (the agent calls
    // fab_recall itself) vs SKILL-DRIVEN (fab_propose/scan/review invoked by skills).
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("AGENT-DIRECT");
    expect(FABRIC_SERVER_INSTRUCTIONS).toContain("SKILL-DRIVEN");
    // fab_recall sits under AGENT-DIRECT, ahead of the SKILL-DRIVEN group.
    expect(FABRIC_SERVER_INSTRUCTIONS.indexOf("AGENT-DIRECT")).toBeLessThan(
      FABRIC_SERVER_INSTRUCTIONS.indexOf("SKILL-DRIVEN"),
    );
    expect(FABRIC_SERVER_INSTRUCTIONS.indexOf("fab_recall")).toBeLessThan(
      FABRIC_SERVER_INSTRUCTIONS.indexOf("SKILL-DRIVEN"),
    );
  });
});
