import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { digestFor, inspectManagedRootPin, repairManagedRootPin } from "../src/config/root-pin-migration.js";

const root = "/tmp/project";
const command = "/usr/bin/node";
const args = ["/srv.js"];
const marker = `fabric-installer:v1:${digestFor({ clientKind: "ClaudeCodeCLI", command, args, root })}`;

describe("managed root pin migration", () => {
  it("classifies exact marker and rejects legacy/mismatched markers", () => {
    const managed = inspectManagedRootPin({ clientKind: "ClaudeCodeCLI", entry: { command, args, env: { FABRIC_PROJECT_ROOT: root, FABRIC_PROJECT_ROOT_PROVENANCE: marker } } });
    expect(managed.state).toBe("managed");
    expect(inspectManagedRootPin({ clientKind: "ClaudeCodeCLI", entry: { command, args, env: { FABRIC_PROJECT_ROOT: root } } }).state).toBe("ambiguous");
    expect(inspectManagedRootPin({ clientKind: "ClaudeCodeCLI", entry: { command, args, env: { FABRIC_PROJECT_ROOT: root, FABRIC_PROJECT_ROOT_PROVENANCE: "operator:v1" } } }).state).toBe("explicit");
  });

  it("backs up, repairs and restores after an injected failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fabric-root-pin-"));
    const path = join(dir, "config.json");
    const original = JSON.stringify({ mcpServers: { fabric: { command, args, env: { FABRIC_PROJECT_ROOT: root, FABRIC_PROJECT_ROOT_PROVENANCE: marker } }, other: { command: "x", args: [] } } }, null, 2) + "\n";
    await writeFile(path, original);
    await expect(repairManagedRootPin({ configPath: path, clientKind: "ClaudeCodeCLI", injectFailureAfterBackup: true })).rejects.toThrow("injected");
    expect(await readFile(path, "utf8")).toBe(original);
    expect((await readdir(dir)).some((name) => name.startsWith("config.json.fabric-backup."))).toBe(true);
  });
});
