import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();
const originalExternalFixturePath = process.env.EXTERNAL_FIXTURE_PATH;
const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("../src/dev-mode.js");
  vi.doUnmock("../src/commands/config.js");
  vi.doUnmock("../src/commands/hooks.js");
  vi.doUnmock("../src/commands/sync-meta.js");
  vi.doUnmock("../src/commands/human-lint.js");
  vi.doUnmock("../src/commands/ledger-append.js");
  process.chdir(originalCwd);
  process.env.EXTERNAL_FIXTURE_PATH = originalExternalFixturePath;

  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe("pre-commit command", () => {
  it("skips checks when staged files only match the global L0 scope", async () => {
    const syncRun = vi.fn();
    const humanLintRun = vi.fn();
    const ledgerRun = vi.fn();
    const stderr: string[] = [];

    vi.doMock("node:child_process", () => ({
      execSync: vi.fn().mockReturnValue("README.md\n"),
    }));
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn((path: string, encoding?: BufferEncoding) => {
          if (path.endsWith(".fabric/agents.meta.json")) {
            return JSON.stringify({
              revision: "sha256:test",
              nodes: {
                L0: {
                  file: "AGENTS.md",
                  scope_glob: "**",
                  deps: [],
                  priority: "high",
                  hash: "sha256:l0",
                  layer: "L0",
                  topology_type: "mirror",
                },
                "L1/src": {
                  file: ".fabric/agents/src/rules.md",
                  scope_glob: "src/**",
                  deps: ["L0"],
                  priority: "medium",
                  hash: "sha256:l1",
                  layer: "L1",
                  topology_type: "mirror",
                },
              },
            });
          }

          return actual.readFileSync(path, encoding as never);
        }),
      };
    });
    vi.doMock("../src/dev-mode.js", () => ({
      resolveDevModeTarget: vi.fn().mockReturnValue("/tmp/fabric-project"),
    }));
    vi.doMock("../src/commands/sync-meta.js", () => ({
      default: { run: syncRun },
    }));
    vi.doMock("../src/commands/human-lint.js", () => ({
      default: { run: humanLintRun },
    }));
    vi.doMock("../src/commands/ledger-append.js", () => ({
      default: { run: ledgerRun },
    }));

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    try {
      const command = (await import("../src/commands/pre-commit.ts")).default;
      await command.run?.({ args: {} } as never);
    } finally {
      stderrSpy.mockRestore();
    }

    expect(stderr.join("")).toContain("No fabric-managed files staged, skipping checks");
    expect(syncRun).not.toHaveBeenCalled();
    expect(humanLintRun).not.toHaveBeenCalled();
    expect(ledgerRun).not.toHaveBeenCalled();
  });
});

describe("update command", () => {
  it("uses the shared dev-mode target resolution when no explicit target is provided", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-update-"));
    tempRoots.push(root);
    mkdirSync(join(root, "fixture"), { recursive: true });
    writeFileSync(
      join(root, "fabric.config.json"),
      JSON.stringify({ externalFixturePath: "./fixture" }, null, 2),
      "utf8",
    );

    const installMcpClients = vi.fn().mockResolvedValue({
      installed: [],
      skipped: [],
      details: [],
    });
    const installHooks = vi.fn().mockResolvedValue({
      installed: [],
      skipped: [],
    });

    vi.doMock("../src/commands/config.js", () => ({
      installMcpClients,
    }));
    vi.doMock("../src/commands/hooks.js", () => ({
      installHooks,
    }));

    process.chdir(root);
    delete process.env.EXTERNAL_FIXTURE_PATH;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const { updateCommand } = await import("../src/commands/update.ts");
      await updateCommand.run?.({ args: {} } as never);
    } finally {
      logSpy.mockRestore();
    }

    const expectedTarget = resolve(process.cwd(), "fixture");

    expect(installMcpClients).toHaveBeenCalledWith(expectedTarget);
    expect(installHooks).toHaveBeenCalledWith(expectedTarget);
  });
});
