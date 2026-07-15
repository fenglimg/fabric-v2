import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolve } from "node:path";

import { CodexTOMLConfigWriter } from "../src/config/toml.ts";
import { createServerEntry } from "../src/config/writer.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe("Codex config install", () => {
  it("writes a Codex MCP block using mcp_servers.fabric", async () => {
    const { configPath } = createTempConfig();
    const writer = new CodexTOMLConfigWriter(configPath);

    await writer.write("/tmp/fabric-server.js", process.cwd());

    // ISS-58: env pins FABRIC_PROJECT_ROOT to the workspace root so the MCP
    // server resolves the right project regardless of its spawn cwd.
    expect(readFileSync(configPath, "utf8")).toBe(
      `[mcp_servers.fabric]
command = ${JSON.stringify(process.execPath)}
args = ["/tmp/fabric-server.js"]
env = { FABRIC_PROJECT_ROOT = ${JSON.stringify(process.cwd())} }
`,
    );
  });

  it("preserves other config and replaces existing fabric block", async () => {
    const { configPath } = createTempConfig();
    writeFileSync(
      configPath,
      `model_provider = "newapi"

[features]
rmcp_client = true

[mcp_servers.fabric]
command = "/old/node"
args = ["/old/server.js"]

[projects."/mnt/c/Project/fabric-v2"]
trust_level = "trusted"
`,
      "utf8",
    );

    const writer = new CodexTOMLConfigWriter(configPath);
    await writer.write("/new/server.js", process.cwd());

    expect(readFileSync(configPath, "utf8")).toBe(
      `model_provider = "newapi"

[features]
rmcp_client = true

[projects."/mnt/c/Project/fabric-v2"]
trust_level = "trusted"

[mcp_servers.fabric]
command = ${JSON.stringify(process.execPath)}
args = ["/new/server.js"]
env = { FABRIC_PROJECT_ROOT = ${JSON.stringify(process.cwd())} }
`,
    );
  });
});

describe("createServerEntry — ISS-58 FABRIC_PROJECT_ROOT pin (client-agnostic)", () => {
  it("pins env.FABRIC_PROJECT_ROOT to the resolved project root when supplied", () => {
    const entry = createServerEntry("/srv.js", "/Users/x/proj");
    expect(entry.env).toEqual({ FABRIC_PROJECT_ROOT: resolve("/Users/x/proj") });
  });

  it("omits env when no project root is supplied (global-install path)", () => {
    const entry = createServerEntry("/srv.js");
    expect(entry.env).toBeUndefined();
  });

  it("omits env for an empty-string project root (fail-open, no bogus pin)", () => {
    const entry = createServerEntry("/srv.js", "");
    expect(entry.env).toBeUndefined();
  });
});

function createTempConfig(): { root: string; configPath: string } {
  const root = mkdtempSync(join(tmpdir(), "fabric-codex-config-"));
  tempRoots.push(root);
  return { root, configPath: join(root, "config.toml") };
}
