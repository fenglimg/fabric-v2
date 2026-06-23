import { describe, expect, it } from "vitest";

import { allCommands } from "../src/commands/index.js";
import { getGroupedCommands, renderGroupedHelp } from "../src/lib/grouped-help.js";

// ux-w1-7: internal RPCs are callable but hidden from human-facing help.
const INTERNAL_COMMANDS = ["plan-context-hint", "scope-explain", "onboard-coverage"];

describe("root grouped help", () => {
  it("includes the public uninstall command", () => {
    const help = renderGroupedHelp({ meta: { name: "fabric" } } as never, "test");

    expect(help).toContain("install");
    expect(help).toContain("uninstall");
    expect(help).toMatch(/uninstall\s+Uninstall Fabric/u);
  });

  // ux-w1-4: help is derived from allCommands, so a registered command can never
  // float invisibly. `context` + `metrics` regressed before this fix.
  it("surfaces every non-internal registered command (no float)", () => {
    const shown = new Set(
      getGroupedCommands().flatMap((g) => g.commands.map((c) => c.name)),
    );
    const expected = Object.keys(allCommands).filter(
      (name) => !INTERNAL_COMMANDS.includes(name),
    );
    for (const name of expected) {
      expect(shown.has(name), `command '${name}' must appear in grouped help`).toBe(true);
    }
  });

  it("includes the previously-floating context + metrics commands", () => {
    const help = renderGroupedHelp({ meta: { name: "fabric" } } as never, "test");
    expect(help).toContain("context");
    expect(help).toContain("metrics");
  });

  // ux-w1-7: internal RPCs stay in the registry but never render in human help.
  it("hides internal RPC commands from human help", () => {
    const shown = new Set(
      getGroupedCommands().flatMap((g) => g.commands.map((c) => c.name)),
    );
    for (const name of INTERNAL_COMMANDS) {
      expect(shown.has(name), `internal command '${name}' must be hidden`).toBe(false);
    }
  });

  // ux-w1-6: whoami / status aliases are retired from the registry entirely.
  it("no longer registers the retired whoami / status aliases", () => {
    expect("whoami" in allCommands).toBe(false);
    expect("status" in allCommands).toBe(false);
  });
});
