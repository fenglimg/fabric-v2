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
      "switch-personal",
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

  // De-cluttering decision: `store --help` overwhelmed normal users with 10
  // operations that are really a skill/CI/recovery API. They stay registered &
  // callable (skills invoke them by exact name; `store mount --help` still works),
  // but carry meta.hidden:true so citty omits them from the `store --help` listing.
  // Only `list` (read-only, genuinely user-facing) stays visible.
  it("hides the 9 skill/advanced subcommands from `store --help`, keeps `list` visible", () => {
    const subs = storeCommand.subCommands ?? {};
    const hidden = [
      "mount",
      "create",
      "remove",
      "explain",
      "bind",
      "switch-write",
      "switch-personal",
      "migrate",
      "project",
    ];
    for (const name of hidden) {
      const meta = (subs as Record<string, { meta?: { hidden?: boolean } }>)[name]?.meta;
      expect(meta?.hidden, `'${name}' must be hidden from store --help`).toBe(true);
    }
    // `list` is the one user-facing read-only surface — it must NOT be hidden.
    const listMeta = (subs as Record<string, { meta?: { hidden?: boolean } }>).list?.meta;
    expect(listMeta?.hidden ?? false).toBe(false);
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

// flat-design (spec §0.4): `store list` upgraded from a bare padEnd table to a
// B-横线 title over `● <name>  <alias>  ✓/○ <remote>` rows — the DESCRIPTIVE
// mount/git name leads (KT-PIT-0027: a bare alias can't disambiguate two
// team-class stores), the glyph encodes remote-backing. This pins the NO_COLOR
// degradation (no raw ANSI; ASCII `----` rule; `●`→`*`; bare glyph).
describe("fabric store list — flat-design rendering (NO_COLOR)", () => {
  let prevNoColor: string | undefined;

  beforeEach(() => {
    prevNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    if (prevNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prevNoColor;
  });

  it("renders `● <name> <alias> ○ <local-only>` for a remote-less store, no ANSI", () => {
    // A mounted store with no on-disk git repo → storeGitRemote() is undefined →
    // honestly local-only (○). store_uuid uses a valid uuid shape for the schema.
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-test",
        stores: [
          { store_uuid: "a2bec02a-6bac-4e1d-9c38-8a6bd327fd7f", alias: "team", mount_name: "fabric-team-knowledge" },
        ],
      }),
    );
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });

    storeCommand.subCommands?.list?.run?.({ args: {} } as never);
    const out = lines.join("\n");

    // No raw ANSI under NO_COLOR.
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).toMatch(/-{8,}/); // headerRule → ASCII rule
    expect(out).toContain("*"); // groupDot `●` → `*` under NO_COLOR
    expect(out).toContain("fabric-team-knowledge"); // descriptive name leads
    expect(out).toContain("team"); // short alias in the second column
    expect(out).toContain("○"); // no remote → local-only amber glyph (bare here)
  });

  it("renders the muted empty line when no stores are mounted", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });

    storeCommand.subCommands?.list?.run?.({ args: {} } as never);
    const out = lines.join("\n");

    expect(out).toMatch(/-{8,}/); // title rule still renders
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/);
  });
});
