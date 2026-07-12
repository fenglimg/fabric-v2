import { describe, expect, it, vi } from "vitest";

// Pin locale BEFORE any command module import so the i18n translator captured
// in `packages/cli/src/i18n.ts` (resolved at module load time) is deterministic.
// `vi.hoisted` runs before any `import` statement is evaluated, so env vars set
// here are visible when detectNodeLocale() executes during command imports.
// Without this, snapshots would drift based on $LANG / $LC_ALL on the host.
vi.hoisted(() => {
  process.env.FAB_LANG = "en";
});

import configCmd from "../src/commands/config.ts";
import doctorCommand from "../src/commands/doctor.ts";
// ISS-20260711-187: gate live install-v2 (registry loads install-v2.js), not
// the retired install.ts twin whose flag surface can silently drift.
import { installCommand } from "../src/commands/install-v2.ts";
import firstHitCommand from "../src/commands/first-hit.ts";
// v2.0.0-rc.37 Wave A2: serveCommand import removed alongside fabric serve
// quarantine (per [[fabric-serve-quarantine-not-delete]]); the command no
// longer exists in main and is not part of the CLI surface contract.
import uninstallCommand from "../src/commands/uninstall.ts";
import { allCommands } from "../src/commands/index.ts";

// Drift gate guidance — surfaced via snapshot hint and assertion failure messages.
// Keep in sync with docs/test-seed/cli.md §1 Feature Surface.
const DRIFT_HINT =
  "CLI surface drift detected. Either:\n" +
  "  - Update snapshot if intentional: pnpm --filter @fenglimg/fabric-cli test -u\n" +
  "  - Update docs/test-seed/cli.md §1 if seed is now outdated\n" +
  "  - Revert command change if unintentional";

type CittyArgDef = {
  type?: string;
  description?: string;
  alias?: string | string[];
  default?: unknown;
  negativeDescription?: string;
  required?: boolean;
};

type CittyCommand = {
  meta?: { name?: string; description?: string };
  args?: Record<string, CittyArgDef>;
};

type ArgSurface = {
  name: string;
  type: string | undefined;
  description: string | undefined;
  alias: string | string[] | undefined;
  default: unknown;
  negativeDescription: string | undefined;
  required: boolean | undefined;
};

type CommandSurface = {
  name: string | undefined;
  description: string | undefined;
  args: ArgSurface[];
};

function commandSurface(cmd: CittyCommand): CommandSurface {
  const argEntries = Object.entries(cmd.args ?? {});
  // Sort by flag name so reordering arg declarations alone does not trip the snapshot.
  argEntries.sort(([a], [b]) => a.localeCompare(b));
  return {
    name: cmd.meta?.name,
    description: cmd.meta?.description,
    args: argEntries.map(([key, def]) => ({
      name: key,
      type: def.type,
      description: def.description,
      alias: def.alias,
      default: def.default,
      negativeDescription: def.negativeDescription,
      required: def.required,
    })),
  };
}

describe("CLI surface drift gate (docs/test-seed/cli.md §1)", () => {
  // Snapshot layer: any add/remove/rename/default-change of a flag fails CI.
  // v2.0.0-rc.37 Wave A2: `serve` row removed alongside command quarantine.
  it.each([
    ["install", installCommand as CittyCommand],
    ["doctor", doctorCommand as CittyCommand],
    ["uninstall", uninstallCommand as CittyCommand],
    ["config", configCmd as CittyCommand],
  ])("command '%s' surface matches snapshot", (name, cmd) => {
    const surface = commandSurface(cmd);
    // toMatchSnapshot's hint argument is appended to the snapshot key, surfacing
    // DRIFT_HINT in the error path when a developer runs vitest without -u.
    expect(surface).toMatchSnapshot(`fabric ${name} surface — ${DRIFT_HINT}`);
  });

  // Core public seed still covers install/doctor/uninstall/config; D5 requires
  // first-hit to stay registered (allCommands + meta.name) so help/registry
  // cannot drop the first-value oracle while advanced store/sync stay hidden.
  // rc.15 TASK-004 (C7+C9): rotated `scan` -> `config`; `plan-context-hint`
  // stays callable but is hidden from --help.
  // v2.0.0-rc.37 Wave A2: `serve` removed from the public command set.
  // ISS-20260711-187: install surface is gated via install-v2 (live registry).
  it("core public seed includes install/doctor/uninstall/config and first-hit", () => {
    const names = [
      installCommand.meta?.name,
      doctorCommand.meta?.name,
      uninstallCommand.meta?.name,
      configCmd.meta?.name,
      firstHitCommand.meta?.name,
    ].sort();
    expect(names).toEqual(["config", "doctor", "first-hit", "install", "uninstall"]);
    expect(Object.keys(allCommands)).toContain("first-hit");
    expect(firstHitCommand.meta?.name).toBe("first-hit");
  });

  // Critical-flag layer: even if a future refactor renames descriptions, these
  // flags MUST exist. Removing one is an intentional breaking change that
  // requires updating docs/test-seed/cli.md §1 first. rc.15 contracted the
  // install surface to four flags; --dry-run is the canonical preview flag.
  it("install exposes critical flag --dry-run (seed §1)", () => {
    const flags = commandSurface(installCommand as CittyCommand).args.map((a) => a.name);
    expect(flags, DRIFT_HINT).toEqual(
      expect.arrayContaining(["dry-run"]),
    );
  });

  it("doctor exposes critical flags --json / --strict / --fix (seed §1)", () => {
    const flags = commandSurface(doctorCommand as CittyCommand).args.map((a) => a.name);
    expect(flags, DRIFT_HINT).toEqual(
      expect.arrayContaining(["json", "strict", "fix"]),
    );
  });

  it("config exposes --target arg (seed §1)", () => {
    const flags = commandSurface(configCmd as CittyCommand).args.map((a) => a.name);
    expect(flags, DRIFT_HINT).toEqual(expect.arrayContaining(["target"]));
  });

  // v2.0.0-rc.37 Wave A2: serve --port / --host drift gate removed; the
  // serve command is quarantined to packages/server-http-experimental/ per
  // [[fabric-serve-quarantine-not-delete]]. Restore alongside startHttpServer
  // if the web UI surface is ever re-enabled.
});
