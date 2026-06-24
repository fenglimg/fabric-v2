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
  it("exposes the W3-E value-axis subcommand set (registry → wiring → migrate → project)", () => {
    const subCommands = Object.keys(storeCommand.subCommands ?? {});

    expect(subCommands).toEqual([
      "mount",
      "list",
      "create",
      "remove",
      "explain",
      "bind",
      "switch-write",
      "migrate",
      "project",
    ]);
    // W3-E de-synonymised the flat surface: these old top-level names are gone.
    expect(subCommands).not.toContain("add"); // → mount
    expect(subCommands).not.toContain("route-write"); // → switch-write --scope
    expect(subCommands).not.toContain("re-scope"); // → migrate scope
    expect(subCommands).not.toContain("backfill-scope"); // → migrate backfill
    expect(subCommands).not.toContain("promote"); // → migrate promote
  });

  it("`migrate` is the knowledge-scope migration group, NOT the retired dual-root migrator", () => {
    // The store-only cutover removed the old dual-root `store migrate`. W3-E
    // reuses the word for knowledge-coordinate rewrites — assert it carries
    // exactly the three scope-rewrite ops, so the dead meaning cannot creep back.
    const migrateSubs = Object.keys(storeCommand.subCommands?.migrate?.subCommands ?? {});

    expect(migrateSubs).toEqual(["scope", "promote", "backfill"]);
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
