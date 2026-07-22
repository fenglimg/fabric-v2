import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

  it("preserves an explicit pin on a dynamic reinstall", async () => {
    const { configPath } = createTempConfig();
    const writer = new CodexTOMLConfigWriter(configPath);
    await writer.write("/srv.js", process.cwd(), undefined, {
      mode: "pinned",
      projectRoot: "/tmp/operator-project",
      provenance: "operator",
    });
    await writer.write("/srv.js", process.cwd(), undefined, { mode: "dynamic" });
    const output = readFileSync(configPath, "utf8");
    expect(output).toContain('FABRIC_PROJECT_ROOT = "/tmp/operator-project"');
    expect(output).toContain('FABRIC_PROJECT_ROOT_PROVENANCE = "operator:v1"');
  });
});

describe("createServerEntry — MCP root policy", () => {
  it("pins a normalized root with an explicit provenance marker", () => {
    const entry = createServerEntry("/srv.js", {
      mode: "pinned",
      projectRoot: "/Users/x/proj/../proj",
      provenance: "operator",
    });
    expect(entry.env).toEqual({
      FABRIC_PROJECT_ROOT: "/Users/x/proj",
      FABRIC_PROJECT_ROOT_PROVENANCE: "operator:v1",
    });
  });

  it("omits env when no project root is supplied (global-install path)", () => {
    const entry = createServerEntry("/srv.js");
    expect(entry.env).toBeUndefined();
  });

  it("omits env for dynamic mode", () => {
    const entry = createServerEntry("/srv.js", { mode: "dynamic" });
    expect(entry.env).toBeUndefined();
  });
});

function createTempConfig(): { root: string; configPath: string } {
  const root = mkdtempSync(join(tmpdir(), "fabric-codex-config-"));
  tempRoots.push(root);
  return { root, configPath: join(root, "config.toml") };
}
