import { describe, expect, it, vi } from "vitest";

// Pin locale BEFORE any command module import so the i18n translator captured
// in `packages/cli/src/i18n.ts` (resolved at module load time) is deterministic.
// `vi.hoisted` runs before any `import` statement is evaluated, so env vars set
// here are visible when detectNodeLocale() executes during command imports.
// Without this, snapshots would drift based on $LANG / $LC_ALL on the host.
vi.hoisted(() => {
  process.env.FAB_LANG = "en";
});

import doctorCommand from "../src/commands/doctor.ts";
import installCommand from "../src/commands/install.ts";
import scanCommand from "../src/commands/scan.ts";
import serveCommand from "../src/commands/serve.ts";
import uninstallCommand from "../src/commands/uninstall.ts";

// Drift gate guidance — surfaced via snapshot hint and assertion failure messages.
// Keep in sync with docs/test-seed/cli.md §1 Feature Surface.
const DRIFT_HINT =
  "CLI surface drift detected. Either:\n" +
  "  - Update snapshot if intentional: pnpm --filter @fenglimg/fabric-cli test -u\n" +
  "  - Update docs/test-seed/cli.md \u00A71 if seed is now outdated\n" +
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

describe("CLI surface drift gate (docs/test-seed/cli.md \u00A71)", () => {
  // Snapshot layer: any add/remove/rename/default-change of a flag fails CI.
  it.each([
    ["install", installCommand as CittyCommand],
    ["scan", scanCommand as CittyCommand],
    ["doctor", doctorCommand as CittyCommand],
    ["serve", serveCommand as CittyCommand],
    ["uninstall", uninstallCommand as CittyCommand],
  ])("command '%s' surface matches snapshot", (name, cmd) => {
    const surface = commandSurface(cmd);
    // toMatchSnapshot's hint argument is appended to the snapshot key, surfacing
    // DRIFT_HINT in the error path when a developer runs vitest without -u.
    expect(surface).toMatchSnapshot(`fab ${name} surface — ${DRIFT_HINT}`);
  });

  // Top-level CLI surface: assert the public command set matches the seed.
  // (We import the registry indirectly through the commands themselves; the
  //  registry shape lives in packages/cli/src/commands/index.ts and is
  //  re-asserted here to fail loudly if a 5th public command appears.)
  it("public command set is exactly { install, scan, doctor, serve, uninstall }", () => {
    const names = [
      installCommand.meta?.name,
      scanCommand.meta?.name,
      doctorCommand.meta?.name,
      serveCommand.meta?.name,
      uninstallCommand.meta?.name,
    ].sort();
    expect(names).toEqual(["doctor", "install", "scan", "serve", "uninstall"]);
  });

  // Critical-flag layer: even if a future refactor renames descriptions, these
  // flags MUST exist. Removing one is an intentional breaking change that
  // requires updating docs/test-seed/cli.md §1 first.
  it("install exposes critical flags --force / --scope / --reapply (seed §1)", () => {
    const flags = commandSurface(installCommand as CittyCommand).args.map((a) => a.name);
    expect(flags, DRIFT_HINT).toEqual(
      expect.arrayContaining(["force", "scope", "reapply"]),
    );
  });

  it("doctor exposes critical flags --json / --strict / --fix (seed §1)", () => {
    const flags = commandSurface(doctorCommand as CittyCommand).args.map((a) => a.name);
    expect(flags, DRIFT_HINT).toEqual(
      expect.arrayContaining(["json", "strict", "fix"]),
    );
  });

  it("scan exposes critical flag --json (seed §1)", () => {
    const flags = commandSurface(scanCommand as CittyCommand).args.map((a) => a.name);
    expect(flags, DRIFT_HINT).toEqual(expect.arrayContaining(["json"]));
  });

  it("serve exposes critical flags --port / --host (seed §1)", () => {
    const surface = commandSurface(serveCommand as CittyCommand);
    const flagMap = new Map(surface.args.map((a) => [a.name, a] as const));
    expect(flagMap.has("port"), DRIFT_HINT).toBe(true);
    expect(flagMap.has("host"), DRIFT_HINT).toBe(true);
    // Seed §1 documents specific defaults — pin them so silent default changes
    // (e.g. switching default port) require updating the seed.
    expect(flagMap.get("port")?.default, DRIFT_HINT).toBe("7373");
    expect(flagMap.get("host")?.default, DRIFT_HINT).toBe("127.0.0.1");
  });
});
