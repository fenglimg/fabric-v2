import { describe, expect, it } from "vitest";

import { allCommands } from "../src/commands/index.js";
import {
  RETIRED_COMMAND_SIGNPOSTS,
  formatSignpostMessage,
  resolveSignpost,
} from "../src/lib/command-signposts.js";

describe("command-signposts", () => {
  it("maps metrics and context to pasteable successors", () => {
    const metrics = resolveSignpost("metrics");
    expect(metrics).not.toBeNull();
    expect(metrics!.successor).toContain("audit metrics");

    const context = resolveSignpost("context");
    expect(context).not.toBeNull();
    expect(context!.successor).toContain("inspect");
  });

  it("maps scope-explain to fabric info scope (not store list)", () => {
    const scope = resolveSignpost("scope-explain");
    expect(scope).not.toBeNull();
    expect(scope!.successor).toBe("fabric info scope");
    expect(scope!.successor).not.toContain("store list");
  });

  it("returns null for live commands", () => {
    expect(resolveSignpost("doctor")).toBeNull();
    expect(resolveSignpost("store")).toBeNull();
    expect(resolveSignpost(undefined)).toBeNull();
  });

  it("formats a non-empty tombstone message including successor without English note tail", () => {
    const s = resolveSignpost("metrics")!;
    const msg = formatSignpostMessage(s, (retired, successor) =>
      `Command \`${retired}\` was removed. Use \`${successor}\` instead.`,
    );
    expect(msg).toContain("metrics");
    expect(msg).toContain("audit metrics");
    expect(msg).not.toContain("metrics dashboard moved");
  });

  it("does not register silent aliases: retired names absent from allCommands", () => {
    const live = new Set(Object.keys(allCommands));
    for (const s of RETIRED_COMMAND_SIGNPOSTS) {
      expect(live.has(s.retired)).toBe(false);
    }
  });
});
