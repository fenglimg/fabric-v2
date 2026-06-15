// If a snapshot fails: review the diff. If the change is intentional, run `pnpm test -u` to update.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { writeClaudeMcpConfig } from "../src/config/json.ts";
import { serializeCodexServerBlock } from "../src/config/toml.ts";

// Deterministic fixture entry: fixed paths so snapshots are stable across machines.
const FABRIC_ENTRY = {
  command: "/usr/local/bin/node",
  args: ["/opt/fabric/server.js"],
};

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fabric-snap-"));
  tempRoots.push(dir);
  return dir;
}

describe("client config emission — golden snapshots", () => {
  it("Claude project-scope .mcp.json matches snapshot", async () => {
    const tmpRoot = makeTempDir();

    await writeClaudeMcpConfig(tmpRoot, FABRIC_ENTRY, "project");

    const out = readFileSync(join(tmpRoot, ".mcp.json"), "utf8");
    expect(out).toMatchSnapshot();
  });

  it("Claude user-scope ~/.claude.json matches snapshot", async () => {
    const fakeHome = makeTempDir();
    vi.stubEnv("HOME", fakeHome);

    const root = makeTempDir();
    const result = await writeClaudeMcpConfig(root, FABRIC_ENTRY, "user");

    const out = readFileSync(result.path, "utf8");
    expect(out).toMatchSnapshot();
  });

  it("Codex codex.toml mcp_servers block matches snapshot", () => {
    // Use serializeCodexServerBlock directly with a deterministic entry so the
    // snapshot is stable across machines (process.execPath would vary otherwise).
    const out = serializeCodexServerBlock("fabric", FABRIC_ENTRY);
    expect(out).toMatchSnapshot();
  });
});
