// TASK-004/Bug-A: installMcpClients must report which clients' config files
// ACTUALLY changed content this run. The mcp stage keys its `changed` flag off
// result.changed (not result.installed) so an idempotent re-run no longer blocks
// the end-pass health-check collapse.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installMcpClients } from "../src/commands/config.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

/**
 * A workspace whose .fabric/fabric-config.json pins an explicit codexCLI path so
 * resolveClients always selects the Codex writer (no dependency on a real
 * ~/.codex on the test machine).
 */
function makeWorkspace(): { target: string; codexConfigPath: string; claudeCodePath: string; claudeDesktopPath: string } {
  const target = mkdtempSync(join(tmpdir(), "fabric-mcp-changed-"));
  tempRoots.push(target);
  const codexConfigPath = join(target, "codex-config.toml");
  const claudeCodePath = join(target, "claude-code.json");
  const claudeDesktopPath = join(target, "claude-desktop.json");
  mkdirSync(join(target, ".fabric"), { recursive: true });
  writeFileSync(
    join(target, ".fabric", "fabric-config.json"),
    JSON.stringify({ clientPaths: { codexCLI: codexConfigPath, claudeCodeCLI: claudeCodePath, claudeCodeDesktop: claudeDesktopPath } }, null, 2),
    "utf8",
  );
  return { target, codexConfigPath, claudeCodePath, claudeDesktopPath };
}

describe("installMcpClients — change detection (TASK-004/Bug-A)", () => {
  it("first write reports the client in `changed`; an idempotent re-run reports empty `changed`", async () => {
    const { target } = makeWorkspace();

    // First install: the codex config file does not exist yet → real change.
    const first = await installMcpClients(target, {
      clients: ["CodexCLI"],
      localServerPath: "/tmp/fabric-server.js",
    });
    expect(first.installed).toContain("CodexCLI");
    expect(first.changed).toContain("CodexCLI");

    // Second install with identical inputs: writer is idempotent (byte-equal
    // before/after) → installed still lists the client (display), but changed is
    // empty, so the mcp stage reports changed=false and the collapse can fire.
    const second = await installMcpClients(target, {
      clients: ["CodexCLI"],
      localServerPath: "/tmp/fabric-server.js",
    });
    expect(second.installed).toContain("CodexCLI");
    expect(second.changed).toHaveLength(0);
  });

  it("dynamic mode writes all concrete writers without root pins", async () => {
    const fixture = makeWorkspace();
    await installMcpClients(fixture.target, {
      localServerPath: "/tmp/fabric-server.js",
      mcpRootPolicy: { mode: "dynamic" },
    });

    for (const path of [fixture.claudeCodePath, fixture.claudeDesktopPath, fixture.codexConfigPath]) {
      const output = readFileSync(path, "utf8");
      expect(output).not.toContain("FABRIC_PROJECT_ROOT");
      expect(output).not.toContain("PROVENANCE");
    }
  });

  it("pinned mode writes all concrete writers with normalized root and explicit marker", async () => {
    const fixture = makeWorkspace();
    const selectedRoot = join(fixture.target, "nested", "..");
    await installMcpClients(fixture.target, {
      localServerPath: "/tmp/fabric-server.js",
      mcpRootPolicy: { mode: "pinned", projectRoot: selectedRoot, provenance: "operator" },
    });

    for (const path of [fixture.claudeCodePath, fixture.claudeDesktopPath, fixture.codexConfigPath]) {
      const output = readFileSync(path, "utf8");
      expect(output).toContain(fixture.target);
      expect(output).toContain("operator:v1");
    }
  });
});
