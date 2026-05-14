import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexTOMLConfigWriter } from "../src/config/toml.ts";

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

    expect(readFileSync(configPath, "utf8")).toBe(
      `[mcp_servers.fabric]
command = ${JSON.stringify(process.execPath)}
args = ["/tmp/fabric-server.js"]
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
`,
    );
  });

  it("migrates legacy mcp.servers.fabric into mcp_servers.fabric", async () => {
    const { configPath } = createTempConfig();
    writeFileSync(
      configPath,
      `model = "gpt-5.4"

[mcp.servers.fabric]
command = "/old/node"
args = ["/old/server.js"]

[notice]
hide_full_access_warning = true
`,
      "utf8",
    );

    const writer = new CodexTOMLConfigWriter(configPath);
    await writer.write("/replacement/server.js", process.cwd());

    const written = readFileSync(configPath, "utf8");
    expect(written).not.toContain("[mcp.servers.fabric]");
    expect(written).toBe(
      `model = "gpt-5.4"

[notice]
hide_full_access_warning = true

[mcp_servers.fabric]
command = ${JSON.stringify(process.execPath)}
args = ["/replacement/server.js"]
`,
    );
  });
});

function createTempConfig(): { root: string; configPath: string } {
  const root = mkdtempSync(join(tmpdir(), "fabric-codex-config-"));
  tempRoots.push(root);
  return { root, configPath: join(root, "config.toml") };
}
