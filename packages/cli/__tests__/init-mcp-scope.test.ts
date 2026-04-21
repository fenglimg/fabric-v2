import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  writeFixtureFile,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];
const originalFabServerPath = process.env.FAB_SERVER_PATH;
const require = createRequire(import.meta.url);
const globalServerPath = require.resolve("@fenglimg/fabric-server");

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (originalFabServerPath === undefined) {
    delete process.env.FAB_SERVER_PATH;
  } else {
    process.env.FAB_SERVER_PATH = originalFabServerPath;
  }

  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("init MCP install scope", () => {
  it("uses the global fabric-server path when --mcp-install=global", async () => {
    const target = createWerewolfFixtureRoot("fab-init-mcp-global");
    tempRoots.push(target);
    writeFixtureFile(target, ".cursor/.gitkeep", "");
    process.env.FAB_SERVER_PATH = globalServerPath;

    silenceInitOutput();
    const { initCommand, execFileSyncMock } = await loadInitCommand();

    await initCommand.run?.({
      args: {
        target,
        bootstrap: false,
        hooks: false,
        mcp: true,
        "mcp-install": "global",
      },
    });

    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(readCursorServerPath(target)).toBe(globalServerPath);
  });

  it("installs fabric-server locally and writes the project-relative server path", async () => {
    const target = createWerewolfFixtureRoot("fab-init-mcp-local");
    tempRoots.push(target);
    writeFixtureFile(target, ".cursor/.gitkeep", "");
    writeFixtureFile(target, "pnpm-lock.yaml", "");

    silenceInitOutput();
    const { initCommand, execFileSyncMock } = await loadInitCommand();

    await initCommand.run?.({
      args: {
        target,
        bootstrap: false,
        hooks: false,
        mcp: true,
        "mcp-install": "local",
      },
    });

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-D", "@fenglimg/fabric-server"],
      expect.objectContaining({ cwd: target, stdio: "inherit" }),
    );
    expect(readCursorServerPath(target)).toBe("node_modules/@fenglimg/fabric-server/dist/index.js");
  });

  it("defaults to the global fabric-server path when --mcp-install is omitted", async () => {
    const target = createWerewolfFixtureRoot("fab-init-mcp-default");
    tempRoots.push(target);
    writeFixtureFile(target, ".cursor/.gitkeep", "");
    process.env.FAB_SERVER_PATH = globalServerPath;

    silenceInitOutput();
    const { initCommand, execFileSyncMock } = await loadInitCommand();

    await initCommand.run?.({
      args: {
        target,
        bootstrap: false,
        hooks: false,
        mcp: true,
      },
    });

    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(readCursorServerPath(target)).toBe(globalServerPath);
  });
});

function readCursorServerPath(root: string): string {
  const config = JSON.parse(readFileSync(`${root}/.cursor/mcp.json`, "utf8")) as {
    mcpServers?: {
      fabric?: {
        args?: string[];
      };
    };
  };

  return config.mcpServers?.fabric?.args?.[0] ?? "";
}

function silenceInitOutput(): void {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    void chunk;
    return true;
  }) as typeof process.stderr.write);
}

async function loadInitCommand() {
  const execFileSyncMock = vi.fn(() => Buffer.from(""));
  vi.doMock("node:child_process", () => ({
    execFileSync: execFileSyncMock,
  }));
  vi.doMock("../src/commands/scan.ts", () => ({
    createScanReport: () => ({
      framework: {
        kind: "vite",
      },
    }),
  }));
  vi.doMock("../src/scanner/forensic.ts", () => ({
    buildForensicReport: () => ({
      files: [],
    }),
  }));

  return {
    initCommand: (await import("../src/commands/init.ts")).initCommand,
    execFileSyncMock,
  };
}
