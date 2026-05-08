import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { writeClaudeMcpConfig } from "../src/config/json.ts";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fabric-mcp-merge-"));
  tempRoots.push(dir);
  return dir;
}

const FABRIC_ENTRY = {
  command: process.execPath,
  args: ["/path/to/fabric-server.js"],
};

describe("writeClaudeMcpConfig — deep-merge fixture cases", () => {
  it("fixture 1: empty target file produces { mcpServers: { fabric } }", async () => {
    const root = makeTempDir();
    const result = await writeClaudeMcpConfig(root, FABRIC_ENTRY, "project");

    const written = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };

    expect(written.mcpServers).toEqual({ fabric: FABRIC_ENTRY });
    expect(result.merged).toBe(false);
    expect(result.path).toBe(join(root, ".mcp.json"));
  });

  it("fixture 2: target has fabric only — updated entry, no other servers", async () => {
    const root = makeTempDir();
    const oldEntry = { command: "/old/node", args: ["/old/server.js"] };
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { fabric: oldEntry } }, null, 2) + "\n",
      "utf8",
    );

    await writeClaudeMcpConfig(root, FABRIC_ENTRY, "project");

    const written = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };

    expect(written.mcpServers).toEqual({ fabric: FABRIC_ENTRY });
    expect(Object.keys(written.mcpServers!)).toHaveLength(1);
  });

  it("fixture 3: target has only OTHER server — merged result has BOTH foo + fabric", async () => {
    const root = makeTempDir();
    const fooEntry = { command: "/other/node", args: ["/other/server.js"] };
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { foo: fooEntry } }, null, 2) + "\n",
      "utf8",
    );

    const result = await writeClaudeMcpConfig(root, FABRIC_ENTRY, "project");

    const written = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };

    expect(written.mcpServers).toEqual({ foo: fooEntry, fabric: FABRIC_ENTRY });
    expect(result.merged).toBe(true);
  });

  it("fixture 4: target has fabric + other — both preserved, fabric updated", async () => {
    const root = makeTempDir();
    const barEntry = { command: "/bar/node", args: ["/bar/server.js"] };
    const oldFabric = { command: "/old/node", args: ["/old/fabric.js"] };
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { fabric: oldFabric, bar: barEntry } }, null, 2) + "\n",
      "utf8",
    );

    const result = await writeClaudeMcpConfig(root, FABRIC_ENTRY, "project");

    const written = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };

    expect(written.mcpServers?.bar).toEqual(barEntry);
    expect(written.mcpServers?.fabric).toEqual(FABRIC_ENTRY);
    expect(result.merged).toBe(true);
  });

  it("user scope writes to ~/.claude.json instead of .mcp.json", async () => {
    const fakeHome = makeTempDir();
    vi.stubEnv("HOME", fakeHome);

    const root = makeTempDir();
    const result = await writeClaudeMcpConfig(root, FABRIC_ENTRY, "user");

    const expectedPath = join(fakeHome, ".claude.json");
    expect(result.path).toBe(expectedPath);
    const written = JSON.parse(readFileSync(expectedPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(written.mcpServers).toEqual({ fabric: FABRIC_ENTRY });
  });

  it("project scope does NOT write settings.json", async () => {
    const root = makeTempDir();
    mkdirSync(join(root, ".claude"), { recursive: true });

    await writeClaudeMcpConfig(root, FABRIC_ENTRY, "project");

    expect(() => readFileSync(join(root, ".claude", "settings.json"), "utf8")).toThrow();
  });
});

describe("writeClaudeMcpConfig — snapshot: Claude Code MCP spec format", () => {
  it("output matches Claude Code .mcp.json spec (mcpServers top-level key)", async () => {
    const root = makeTempDir();
    await writeClaudeMcpConfig(root, FABRIC_ENTRY, "project");

    const content = readFileSync(join(root, ".mcp.json"), "utf8");
    const normalized = content.replaceAll(process.execPath, "<NODE_BIN>");

    expect(normalized).toMatchSnapshot();

    // Also verify structural compliance with Claude Code MCP spec
    const parsed = JSON.parse(content) as unknown;
    expect(parsed).toMatchObject({
      mcpServers: {
        fabric: {
          command: expect.any(String) as string,
          args: expect.any(Array) as string[],
        },
      },
    });

    // Spec: top-level must be mcpServers, no other mandatory keys
    expect(Object.keys(parsed as Record<string, unknown>)).toContain("mcpServers");
    // File must end with newline (atomicWriteJson ensures this)
    expect(content.endsWith("\n")).toBe(true);
    // File must be pretty-printed with 2-space indent
    const lines = content.split("\n");
    expect(lines[0]).toBe("{");
    expect(lines[1]).toBe('  "mcpServers": {');
  });
});
