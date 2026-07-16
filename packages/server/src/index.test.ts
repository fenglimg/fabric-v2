import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function newTmpDir(prefix: string): string {
  const raw = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(raw);
  return realpathSync(raw);
}

function newConfiguredProject(): string {
  const root = newTmpDir("index-configured-");
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(join(root, ".fabric", "fabric-config.json"), "{}\n");
  return root;
}

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

    // ISS-20260711-245: pin more than names — each registration must ship
    // description + inputSchema + outputSchema + annotations so a no-op
    // handler under the right name still fails this suite.
    for (const call of registerTool.mock.calls) {
      const def = call[1] as {
        description?: string;
        inputSchema?: unknown;
        outputSchema?: unknown;
        annotations?: unknown;
      };
      expect(typeof def.description).toBe("string");
      expect((def.description ?? "").length).toBeGreaterThan(20);
      expect(def.inputSchema).toBeDefined();
      expect(def.outputSchema).toBeDefined();
      expect(def.annotations).toBeDefined();
    }
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

// ISS werewolf-minigame (rootless MCP spawn, KT-PIT-0046): the initialize
// instructions must lead with the outage banner when the resolved root
// carries no project config, and stay verbatim otherwise.
describe("buildServerInstructions", () => {
  it("returns the plain instructions when the root is configured", async () => {
    vi.stubGlobal("__SERVER_VERSION__", "test");
    const { buildServerInstructions, FABRIC_SERVER_INSTRUCTIONS } = await import("./index.js");
    expect(buildServerInstructions(newConfiguredProject())).toBe(FABRIC_SERVER_INSTRUCTIONS);
  });

  it("prepends the project_root_unresolved banner when the config is absent", async () => {
    vi.stubGlobal("__SERVER_VERSION__", "test");
    const { buildServerInstructions, FABRIC_SERVER_INSTRUCTIONS } = await import("./index.js");
    const bare = newTmpDir("index-bare-");
    const instructions = buildServerInstructions(bare);
    // Banner leads (loud from the first server-authored words the client sees).
    expect(instructions.startsWith("⚠️ WARNING: project root unresolved — serving personal store only")).toBe(true);
    expect(instructions).toContain(bare);
    expect(instructions).toContain("project_root_unresolved");
    expect(instructions).toContain("FABRIC_PROJECT_ROOT");
    // The full normal manifest still follows the banner.
    expect(instructions).toContain(FABRIC_SERVER_INSTRUCTIONS);
  });
});

// ISS werewolf-minigame (rootless MCP spawn, KT-PIT-0046): post-initialize
// roots adoption — the env > CLAUDE_PROJECT_DIR > roots > cwd chain itself is
// covered in meta-reader.test.ts; here we pin the MCP-facing plumbing.
describe("adoptMcpClientRoots", () => {
  let savedFabricRoot: string | undefined;
  let savedClaudeDir: string | undefined;

  afterEach(async () => {
    const { resetMcpRootsHint } = await import("./meta-reader.js");
    resetMcpRootsHint();
    if (savedFabricRoot === undefined) delete process.env.FABRIC_PROJECT_ROOT;
    else process.env.FABRIC_PROJECT_ROOT = savedFabricRoot;
    if (savedClaudeDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = savedClaudeDir;
  });

  function clearEnvOverrides(): void {
    savedFabricRoot = process.env.FABRIC_PROJECT_ROOT;
    savedClaudeDir = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.FABRIC_PROJECT_ROOT;
    delete process.env.CLAUDE_PROJECT_DIR;
  }

  it("returns [] without touching the hint when the client lacks the roots capability", async () => {
    vi.stubGlobal("__SERVER_VERSION__", "test");
    const { adoptMcpClientRoots } = await import("./index.js");
    const listRoots = vi.fn();
    const adopted = await adoptMcpClientRoots({
      getClientCapabilities: () => ({}),
      listRoots,
    });
    expect(adopted).toEqual([]);
    expect(listRoots).not.toHaveBeenCalled();
  });

  it("adopts file:// roots so resolveProjectRoot picks them up (heals the rootless spawn)", async () => {
    clearEnvOverrides();
    vi.stubGlobal("__SERVER_VERSION__", "test");
    const { adoptMcpClientRoots } = await import("./index.js");
    const { resolveProjectRoot } = await import("./meta-reader.js");

    const projectRoot = newConfiguredProject();
    mkdirSync(join(projectRoot, ".git"), { recursive: true });
    const bareCwd = newTmpDir("index-rootless-cwd-");

    const adopted = await adoptMcpClientRoots({
      getClientCapabilities: () => ({ roots: {} }),
      listRoots: async () => ({
        roots: [
          { uri: "https://not-a-file.example" },
          { uri: pathToFileURL(projectRoot).href },
        ],
      }),
    });
    expect(adopted).toEqual([projectRoot]);
    // The degenerate spawn cwd no longer wins — the client root does.
    expect(resolveProjectRoot(bareCwd)).toBe(projectRoot);
  });

  it("returns [] when listRoots rejects (best-effort, never sinks startup)", async () => {
    vi.stubGlobal("__SERVER_VERSION__", "test");
    const { adoptMcpClientRoots } = await import("./index.js");
    const adopted = await adoptMcpClientRoots({
      getClientCapabilities: () => ({ roots: {} }),
      listRoots: async () => {
        throw new Error("client went away");
      },
    });
    expect(adopted).toEqual([]);
  });
});
