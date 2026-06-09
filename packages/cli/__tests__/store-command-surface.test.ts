import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import storeCommand from "../src/commands/store.js";
import { saveGlobalConfig } from "../src/store/global-config-io.js";

const originalExitCode = process.exitCode;
const originalFabricHome = process.env.FABRIC_HOME;

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fabric-store-command-"));
  process.env.FABRIC_HOME = home;
  process.exitCode = originalExitCode;
  saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test" }));
});

afterEach(() => {
  process.exitCode = originalExitCode;
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("fabric store command surface", () => {
  it("does not expose the retired dual-root migration subcommand", () => {
    const subCommands = Object.keys(storeCommand.subCommands ?? {});

    expect(subCommands).not.toContain("migrate");
  });

  it("sets a failing exit code when removing a missing alias", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });

    await storeCommand.subCommands?.remove?.run?.({ args: { alias: "ghost" } } as never);

    expect(process.exitCode).toBe(1);
    expect(lines.join("\n")).toContain("no store aliased 'ghost'");
  });

  it("sets a failing exit code when explaining a missing alias", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });

    await storeCommand.subCommands?.explain?.run?.({ args: { alias: "ghost" } } as never);

    expect(process.exitCode).toBe(1);
    expect(lines.join("\n")).toContain("no store aliased 'ghost'");
  });
});
