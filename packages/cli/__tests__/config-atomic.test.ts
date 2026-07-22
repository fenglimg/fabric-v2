import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { writeJsonClientConfig } from "../src/config/json.ts";
import { CodexTOMLConfigWriter } from "../src/config/toml.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fabric-atomic-"));
  tempRoots.push(dir);
  return dir;
}

describe("config atomic writes — no .tmp leftover on success", () => {
  it("json: no .tmp files remain after successful write", async () => {
    const dir = makeTempDir();
    const configPath = join(dir, "settings.json");
    const serverEntry = { command: process.execPath, args: ["/srv.js"], env: undefined };

    await writeJsonClientConfig(configPath, serverEntry);

    const files = readdirSync(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("toml: no .tmp files remain after successful write", async () => {
    const dir = makeTempDir();
    const configPath = join(dir, "config.toml");
    const writer = new CodexTOMLConfigWriter(configPath);

    await writer.write("/srv.js", process.cwd());

    const files = readdirSync(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("config atomic writes — atomicWriteText cleans up on failure", () => {
  it("target file is not created and tmp is cleaned up when parent dir is missing", async () => {
    const dir = makeTempDir();
    const nonExistentParent = join(dir, "does-not-exist", "file.txt");

    await expect(atomicWriteText(nonExistentParent, "hello")).rejects.toThrow();

    // Neither target nor any tmp should exist
    const entries = readdirSync(dir);
    expect(entries).toHaveLength(0);
  });
});

describe("config atomic writes — output bytes match prior raw writeFile", () => {
  it("json: bytes are identical to JSON.stringify(value, null, 2) + newline", async () => {
    const dir = makeTempDir();
    const configPath = join(dir, "settings.json");
    const serverEntry = { command: process.execPath, args: ["/srv.js"], env: undefined };

    await writeJsonClientConfig(configPath, serverEntry);

    const written = readFileSync(configPath, "utf8");

    // Reconstruct what writeJsonClientConfig puts into the file
    const expectedConfig = {
      mcpServers: { fabric: serverEntry },
    };
    const expected = `${JSON.stringify(expectedConfig, null, 2)}\n`;

    expect(written).toBe(expected);
  });

  it("toml: bytes are identical to upserted TOML string", async () => {
    const dir = makeTempDir();
    const configPath = join(dir, "config.toml");
    writeFileSync(configPath, "", "utf8");

    const writer = new CodexTOMLConfigWriter(configPath);
    await writer.write("/srv.js", process.cwd());

    const written = readFileSync(configPath, "utf8");
    // TASK-006: default write() is dynamic mode — no persisted FABRIC_PROJECT_ROOT.
    // Pinned-mode env serialization is covered by mcp-changed-detection / toml pin tests.
    const expected =
      `[mcp_servers.fabric]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ["/srv.js"]\n`;

    expect(written).toBe(expected);
  });
});
