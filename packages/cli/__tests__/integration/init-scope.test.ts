/**
 * Integration tests: init --scope routing
 * Covers: I4 (scope project vs user), T3 (MCP config scope conflict merge)
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { writeClaudeMcpConfig } from "../../src/config/json.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  writeFixtureFile,
} from "../helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

function makeTempDir(prefix: string): string {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), `itg-scope-${prefix}-`));
  tempRoots.push(dir);
  return dir;
}

const FABRIC_ENTRY = {
  command: process.execPath,
  args: ["/path/to/fabric-server.js"],
  env: undefined as unknown as Record<string, string> | undefined,
};

// I4 — scope project writes .mcp.json and does NOT write ~/.claude.json
describe("I4: scope routing — project vs user", () => {
  it("scope=project writes .mcp.json and not ~/.claude.json", async () => {
    const root = makeTempDir("project");
    const fakeHome = makeTempDir("home");
    vi.stubEnv("HOME", fakeHome);

    await writeClaudeMcpConfig(root, FABRIC_ENTRY, "project");

    expect(existsSync(join(root, ".mcp.json"))).toBe(true);
    expect(existsSync(join(fakeHome, ".claude.json"))).toBe(false);
  });

  it("scope=user writes ~/.claude.json and does NOT write .mcp.json in project root", async () => {
    const root = makeTempDir("user");
    const fakeHome = makeTempDir("home-user");
    vi.stubEnv("HOME", fakeHome);

    await writeClaudeMcpConfig(root, FABRIC_ENTRY, "user");

    expect(existsSync(join(fakeHome, ".claude.json"))).toBe(true);
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
  });

  it("scope=project content has correct mcpServers.fabric shape", async () => {
    const root = makeTempDir("proj-shape");
    const fakeHome = makeTempDir("home-shape");
    vi.stubEnv("HOME", fakeHome);

    await writeClaudeMcpConfig(root, FABRIC_ENTRY, "project");

    const content = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(content.mcpServers?.fabric).toBeDefined();
  });

  it("scope=user content is written to ~/.claude.json with correct mcpServers.fabric", async () => {
    const root = makeTempDir("user-shape");
    const fakeHome = makeTempDir("home-user-shape");
    vi.stubEnv("HOME", fakeHome);

    await writeClaudeMcpConfig(root, FABRIC_ENTRY, "user");

    const content = JSON.parse(readFileSync(join(fakeHome, ".claude.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(content.mcpServers?.fabric).toBeDefined();
  });
});

// T3 — MCP config scope conflict merge: existing entries are preserved
describe("T3: MCP config deep-merge preserves existing servers", () => {
  it("project scope: existing other mcpServers entries are preserved when fabric is added", async () => {
    const root = makeTempDir("merge-project");
    const fakeHome = makeTempDir("home-merge");
    vi.stubEnv("HOME", fakeHome);

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

    expect(written.mcpServers?.foo).toEqual(fooEntry);
    expect(written.mcpServers?.fabric).toBeDefined();
    expect(result.merged).toBe(true);
  });

  it("project scope: when fabric + other exist, both are preserved and fabric is updated", async () => {
    const root = makeTempDir("merge-update-project");
    const fakeHome = makeTempDir("home-merge-update");
    vi.stubEnv("HOME", fakeHome);

    const barEntry = { command: "/bar/node", args: ["/bar/server.js"] };
    const oldFabric = { command: "/old/node", args: ["/old/fabric.js"] };
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { fabric: oldFabric, bar: barEntry } }, null, 2) + "\n",
      "utf8",
    );

    await writeClaudeMcpConfig(root, FABRIC_ENTRY, "project");
    const written = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };

    // bar must still be there
    expect(written.mcpServers?.bar).toEqual(barEntry);
    // fabric must be updated to FABRIC_ENTRY
    expect((written.mcpServers?.fabric as typeof FABRIC_ENTRY)?.args?.[0]).toBe(FABRIC_ENTRY.args[0]);
  });

  it("user scope: existing entries in ~/.claude.json are preserved when fabric is merged", async () => {
    const root = makeTempDir("merge-user");
    const fakeHome = makeTempDir("home-merge-user");
    vi.stubEnv("HOME", fakeHome);

    const otherEntry = { command: "/other/cmd", args: ["/other/srv.js"] };
    mkdirSync(fakeHome, { recursive: true });
    writeFileSync(
      join(fakeHome, ".claude.json"),
      JSON.stringify({ mcpServers: { other: otherEntry } }, null, 2) + "\n",
      "utf8",
    );

    const result = await writeClaudeMcpConfig(root, FABRIC_ENTRY, "user");
    const written = JSON.parse(readFileSync(join(fakeHome, ".claude.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };

    expect(written.mcpServers?.other).toEqual(otherEntry);
    expect(written.mcpServers?.fabric).toBeDefined();
    expect(result.merged).toBe(true);
  });
});
