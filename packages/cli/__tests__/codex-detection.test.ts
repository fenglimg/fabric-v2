import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { isCodexInstalled } from "../src/config/client-detect.js";
import { CodexTOMLConfigWriter } from "../src/config/toml.js";

// 2.5.1 defect #1 — Codex MCP wiring was gated on `~/.codex`, a directory Codex
// only creates on its FIRST RUN. A teammate who installed Fabric before ever
// launching Codex got hooks + skills but no `[mcp_servers.fabric]`, silently.
// These tests pin the wider gate: binary-on-PATH also counts as installed.

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("isCodexInstalled", () => {
  it("detects a machine where Codex has already been run once (~/.codex exists)", async () => {
    const home = await freshDir("fabric-codex-home-");
    await mkdir(join(home, ".codex"), { recursive: true });

    expect(isCodexInstalled({ home, pathEnv: "" })).toBe(true);
  });

  // The regression itself: installed but never launched.
  it("detects a machine where Codex is installed but has never been run", async () => {
    const home = await freshDir("fabric-codex-home-");
    const bin = await freshDir("fabric-codex-bin-");
    await writeFile(join(bin, "codex"), "#!/bin/sh\n");

    expect(isCodexInstalled({ home, pathEnv: [bin, "/nonexistent"].join(delimiter) })).toBe(true);
  });

  it("does NOT fabricate a client on a machine without Codex", async () => {
    const home = await freshDir("fabric-codex-home-");
    const bin = await freshDir("fabric-codex-bin-");

    expect(isCodexInstalled({ home, pathEnv: bin })).toBe(false);
  });

  it("treats an empty or unset PATH as no signal rather than throwing", async () => {
    const home = await freshDir("fabric-codex-home-");

    expect(isCodexInstalled({ home, pathEnv: "" })).toBe(false);
    expect(isCodexInstalled({ home, pathEnv: undefined })).toBe(
      // undefined falls through to process.env.PATH — on a runner without codex
      // this is false; assert only that it returns a boolean and never throws.
      isCodexInstalled({ home, pathEnv: process.env.PATH }),
    );
  });
});

describe("CodexTOMLConfigWriter.detect", () => {
  // An explicit path must win regardless of detection — this is the escape hatch
  // for machines where neither signal fires.
  it("honours an explicit override path without consulting detection", async () => {
    const target = await freshDir("fabric-codex-explicit-");
    const configPath = join(target, "config.toml");
    const writer = new CodexTOMLConfigWriter();

    await expect(writer.detect(target, configPath)).resolves.toBe(configPath);
  });

  // write() mkdir -p's the parent, so returning a path for a not-yet-created
  // `~/.codex` is enough to wire MCP on a never-launched Codex.
  it("returns a config path (not null) whenever Codex is considered installed", async () => {
    const writer = new CodexTOMLConfigWriter();
    const workspace = await freshDir("fabric-codex-ws-");

    const detected = await writer.detect(workspace);
    if (isCodexInstalled()) {
      expect(detected).toMatch(/\.codex[/\\]config\.toml$/);
    } else {
      expect(detected).toBeNull();
    }
  });
});
