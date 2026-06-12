/**
 * Integration tests: rc.17 TASK-007 — Codex MCP TOML write regression.
 *
 * Background (Bug Y, originally reported against rc.x, re-investigated in rc.17
 * TASK-006). Empirical repro against the user's real `~/.codex/config.toml`
 * showed the writer correctly appended `[mcp_servers.fabric]` while preserving
 * every pre-existing section. See `_codex-mcp-diagnosis.md` for the trace.
 *
 * This file locks down that behavior so a future refactor cannot reintroduce
 * the legacy `mcp.servers.fabric` spelling silently or drop unrelated sections
 * during the rewrite.
 *
 * Coverage:
 *   1. Block presence — `[mcp_servers.fabric]` is appended to a real-world
 *      shaped fixture (top-level scalars, [features], [notice], multiple
 *      [projects."..."], [plugins."..."], [marketplaces.*]).
 *   2. Section preservation — every original named section + top-level key
 *      survives the rewrite (substring assertions per section).
 *   3. Idempotency — invoking `write()` twice yields byte-equal output.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexTOMLConfigWriter } from "../../src/config/toml.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function createTempConfig(): { root: string; configPath: string } {
  const root = mkdtempSync(join(tmpdir(), "fabric-codex-mcp-install-"));
  tempRoots.push(root);
  return { root, configPath: join(root, "config.toml") };
}

/**
 * Redacted copy of the shape reported in TASK-006 diagnosis (project paths
 * anonymized; preserves the section topology that the original Bug Y report
 * claimed broke the writer):
 *   - top-level scalars (model, model_provider)
 *   - [features]
 *   - [notice]
 *   - two [projects."..."] entries
 *   - two [plugins."..."] entries
 *   - one [marketplaces.<name>] entry
 *
 * Total: 8 named sections + 2 top-level keys, no pre-existing fabric block.
 */
const REAL_WORLD_CODEX_FIXTURE = `model = "gpt-5.4"
model_provider = "newapi"

[features]
rmcp_client = true

[notice]
hide_full_access_warning = true

[projects."/path/to/project-1"]
trust_level = "trusted"

[projects."/path/to/project-2"]
trust_level = "trusted"

[plugins."browser-use@openai-bundled"]
enabled = true

[plugins."presentations@openai-primary-runtime"]
enabled = true

[marketplaces.openai-bundled]
url = "https://example.invalid/marketplace"
`;

const REAL_WORLD_SECTIONS = [
  "[features]",
  "[notice]",
  '[projects."/path/to/project-1"]',
  '[projects."/path/to/project-2"]',
  '[plugins."browser-use@openai-bundled"]',
  '[plugins."presentations@openai-primary-runtime"]',
  "[marketplaces.openai-bundled]",
];

describe("rc.17 TASK-007 — Codex MCP TOML write regression (Bug Y closed-no-repro)", () => {
  it("appends [mcp_servers.fabric] to a real-world shaped Codex config", async () => {
    const { configPath } = createTempConfig();
    writeFileSync(configPath, REAL_WORLD_CODEX_FIXTURE, "utf8");

    const writer = new CodexTOMLConfigWriter(configPath);
    await writer.write("/usr/local/bin/fabric-server.js", process.cwd());

    const written = readFileSync(configPath, "utf8");
    expect(written).toContain("[mcp_servers.fabric]");
    expect(written).toContain(`command = ${JSON.stringify(process.execPath)}`);
    expect(written).toContain('args = ["/usr/local/bin/fabric-server.js"]');
  });

  it("preserves every pre-existing section + top-level key", async () => {
    const { configPath } = createTempConfig();
    writeFileSync(configPath, REAL_WORLD_CODEX_FIXTURE, "utf8");

    const writer = new CodexTOMLConfigWriter(configPath);
    await writer.write("/usr/local/bin/fabric-server.js", process.cwd());

    const written = readFileSync(configPath, "utf8");
    // Top-level scalars must survive the rewrite verbatim.
    expect(written).toContain('model = "gpt-5.4"');
    expect(written).toContain('model_provider = "newapi"');
    // Every named section must still be present.
    for (const section of REAL_WORLD_SECTIONS) {
      expect(written, `expected to preserve section ${section}`).toContain(section);
    }
    // No legacy spelling should appear (fixture has none — guard against
    // accidental introduction by upsert).
    expect(written).not.toContain("[mcp.servers.fabric]");
  });

  it("is idempotent — invoking write() twice yields byte-equal output", async () => {
    const { configPath } = createTempConfig();
    writeFileSync(configPath, REAL_WORLD_CODEX_FIXTURE, "utf8");

    const writer = new CodexTOMLConfigWriter(configPath);
    await writer.write("/usr/local/bin/fabric-server.js", process.cwd());
    const firstPass = readFileSync(configPath, "utf8");

    await writer.write("/usr/local/bin/fabric-server.js", process.cwd());
    const secondPass = readFileSync(configPath, "utf8");

    expect(secondPass).toBe(firstPass);
    // Sanity: the block is still there and only present once.
    const occurrences = secondPass.match(/\[mcp_servers\.fabric\]/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  // W2-05 (升级项 a): a re-install must refresh only the fabric-managed keys
  // (command/args/env) inside [mcp_servers.fabric] and preserve any user-added
  // sibling keys (e.g. `disabled = true`) — parity with the claude json.ts
  // deepMerge. Previously upsert dropped the whole block and re-serialized only
  // command/args/env, silently clobbering user keys.
  it("preserves user-authored sibling keys inside [mcp_servers.fabric] on re-write", async () => {
    const { configPath } = createTempConfig();
    const fixture = `${REAL_WORLD_CODEX_FIXTURE}
[mcp_servers.fabric]
command = "/old/node"
args = ["/old/server.js"]
disabled = true
startup_timeout_ms = 30000
`;
    writeFileSync(configPath, fixture, "utf8");

    const writer = new CodexTOMLConfigWriter(configPath);
    await writer.write("/usr/local/bin/fabric-server.js", process.cwd());

    const written = readFileSync(configPath, "utf8");
    // Fabric-managed keys refreshed...
    expect(written).toContain(`command = ${JSON.stringify(process.execPath)}`);
    expect(written).toContain('args = ["/usr/local/bin/fabric-server.js"]');
    expect(written).not.toContain('command = "/old/node"');
    // ...user sibling keys preserved.
    expect(written).toContain("disabled = true");
    expect(written).toContain("startup_timeout_ms = 30000");
    // Still exactly one fabric block.
    expect(written.match(/\[mcp_servers\.fabric\]/g) ?? []).toHaveLength(1);
  });
});
