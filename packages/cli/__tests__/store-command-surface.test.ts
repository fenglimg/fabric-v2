import { describe, expect, it } from "vitest";

import storeCommand from "../src/commands/store.js";

describe("fabric store command surface", () => {
  it("does not expose the retired dual-root migration subcommand", () => {
    const subCommands = Object.keys(storeCommand.subCommands ?? {});

    expect(subCommands).not.toContain("migrate");
  });
});
