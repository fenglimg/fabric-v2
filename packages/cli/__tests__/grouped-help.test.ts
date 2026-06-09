import { describe, expect, it } from "vitest";

import { renderGroupedHelp } from "../src/lib/grouped-help.js";

describe("root grouped help", () => {
  it("includes the public uninstall command", () => {
    const help = renderGroupedHelp({ meta: { name: "fabric" } } as never, "test");

    expect(help).toContain("install");
    expect(help).toContain("uninstall");
    expect(help).toMatch(/uninstall\s+Uninstall Fabric/u);
  });
});
