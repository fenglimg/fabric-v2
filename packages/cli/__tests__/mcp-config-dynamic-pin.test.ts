import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeJsonClientConfig } from "../src/config/json.ts";

// TASK-006 JSON gap: the JSON (Claude Code) writer used a plain deep-merge, so a
// dynamic reinstall left a stale FABRIC_PROJECT_ROOT pin in place — unlike the
// TOML writer, which authoritatively replaces the block and only carries an
// EXPLICIT operator/project pin forward. These tests lock the JSON writer to the
// same contract: dynamic drops managed/ambiguous pins, preserves explicit ones.

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "fabric-json-pin-"));
  dirs.push(d);
  return d;
}

const DYNAMIC_ENTRY = { command: "/node", args: ["/srv.js"] };

function writeExisting(cfgPath: string, env?: Record<string, string>): void {
  const fabric = { command: "/old", args: ["/old.js"], ...(env ? { env } : {}) };
  writeFileSync(cfgPath, `${JSON.stringify({ mcpServers: { fabric } }, null, 2)}\n`, "utf8");
}

describe("writeJsonClientConfig — dynamic reinstall pin policy (TASK-006 JSON gap)", () => {
  it("dynamic entry strips an ambiguous (unmarked) legacy pin", async () => {
    const p = join(tmp(), ".mcp.json");
    writeExisting(p, { FABRIC_PROJECT_ROOT: "/some/proj" });
    await writeJsonClientConfig(p, DYNAMIC_ENTRY, "ClaudeCodeCLI");
    const got = JSON.parse(readFileSync(p, "utf8"));
    expect(got.mcpServers.fabric.env).toBeUndefined();
    expect(got.mcpServers.fabric.args).toEqual(["/srv.js"]);
  });

  it("dynamic entry preserves an explicit operator pin (carry forward)", async () => {
    const p = join(tmp(), ".mcp.json");
    writeExisting(p, { FABRIC_PROJECT_ROOT: "/some/proj", FABRIC_PROJECT_ROOT_PROVENANCE: "operator:v1" });
    await writeJsonClientConfig(p, DYNAMIC_ENTRY, "ClaudeCodeCLI");
    const got = JSON.parse(readFileSync(p, "utf8"));
    expect(got.mcpServers.fabric.env?.FABRIC_PROJECT_ROOT).toBe("/some/proj");
    expect(got.mcpServers.fabric.env?.FABRIC_PROJECT_ROOT_PROVENANCE).toBe("operator:v1");
  });

  it("pinned entry writes the new pin, replacing any existing", async () => {
    const p = join(tmp(), ".mcp.json");
    writeExisting(p, { FABRIC_PROJECT_ROOT: "/old/proj" });
    await writeJsonClientConfig(
      p,
      { ...DYNAMIC_ENTRY, env: { FABRIC_PROJECT_ROOT: "/new/proj", FABRIC_PROJECT_ROOT_PROVENANCE: "operator:v1" } },
      "ClaudeCodeCLI",
    );
    const got = JSON.parse(readFileSync(p, "utf8"));
    expect(got.mcpServers.fabric.env.FABRIC_PROJECT_ROOT).toBe("/new/proj");
  });

  it("preserves other mcpServers entries while dropping fabric's stale pin", async () => {
    const p = join(tmp(), ".mcp.json");
    writeFileSync(
      p,
      `${JSON.stringify(
        {
          mcpServers: {
            foo: { command: "/foo", args: [] },
            fabric: { command: "/old", args: ["/o.js"], env: { FABRIC_PROJECT_ROOT: "/x" } },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeJsonClientConfig(p, DYNAMIC_ENTRY, "ClaudeCodeCLI");
    const got = JSON.parse(readFileSync(p, "utf8"));
    expect(got.mcpServers.foo).toEqual({ command: "/foo", args: [] });
    expect(got.mcpServers.fabric.env).toBeUndefined();
  });
});
