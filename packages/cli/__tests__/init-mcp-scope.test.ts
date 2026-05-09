import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupFixtureRoot,
  createEmptyFixtureRoot,
  createWerewolfFixtureRoot,
  setProcessTty,
  writeFixtureFile,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];
const restoreTtyMocks: Array<() => void> = [];
const originalFabServerPath = process.env.FAB_SERVER_PATH;
const originalFabLang = process.env.FAB_LANG;
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

  if (originalFabLang === undefined) {
    delete process.env.FAB_LANG;
  } else {
    process.env.FAB_LANG = originalFabLang;
  }

  while (restoreTtyMocks.length > 0) {
    restoreTtyMocks.pop()?.();
  }

  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("init MCP install scope", () => {
  it("uses the global fabric-server path when --mcp-install=global", async () => {
    process.env.FAB_LANG = "en";
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
    process.env.FAB_LANG = "en";
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
    process.env.FAB_LANG = "en";
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

  it("prints the final capability summary for Codex after repo assets are installed", async () => {
    process.env.FAB_LANG = "en";
    const target = createEmptyFixtureRoot("fab-init-capability-codex");
    tempRoots.push(target);
    process.env.FAB_SERVER_PATH = globalServerPath;

    const { initCommand } = await loadInitCommand();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      stdout.push(String(message ?? ""));
    });
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);
    restoreTtyMocks.push(setProcessTty(true));

    const originalHome = process.env.HOME;
    const codexHome = createEmptyFixtureRoot("fab-init-capability-codex-home");
    tempRoots.push(codexHome);
    process.env.HOME = codexHome;
    writeFixtureFile(codexHome, ".codex/.gitkeep", "");

    try {
      await initCommand.run?.({
        args: {
          target,
          bootstrap: false,
          hooks: false,
          mcp: false,
          yes: true,
        },
      });
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }

    expect(stdout.some((line) => line.includes("Client capability summary"))).toBe(true);
    expect(stdout.some((line) => line.includes("Codex CLI"))).toBe(true);
    expect(stdout.some((line) => line.includes("installed"))).toBe(true);
    expect(stdout.some((line) => line.includes("continue in client"))).toBe(true);
  });

  it("prints the Codex-specific reason after Codex repo assets are installed", async () => {
    process.env.FAB_LANG = "en";
    const target = createEmptyFixtureRoot("fab-init-capability-codex-installed");
    tempRoots.push(target);
    process.env.FAB_SERVER_PATH = globalServerPath;

    const { initCommand } = await loadInitCommand();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      stdout.push(String(message ?? ""));
    });
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);
    restoreTtyMocks.push(setProcessTty(true));

    const originalHome = process.env.HOME;
    const codexHome = createEmptyFixtureRoot("fab-init-capability-codex-installed-home");
    tempRoots.push(codexHome);
    process.env.HOME = codexHome;
    writeFixtureFile(codexHome, ".codex/.gitkeep", "");

    try {
      await initCommand.run?.({
        args: {
          target,
          bootstrap: false,
          hooks: false,
          mcp: false,
          yes: true,
        },
      });
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }

    expect(
      stdout.some((line) =>
        line.includes(
          "Claude can use fabric-init, and Codex can use .agents/skills/fabric-init/SKILL.md with features.codex_hooks = true.",
        )
      ),
    ).toBe(true);
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
  restoreTtyMocks.push(setProcessTty(false));
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
