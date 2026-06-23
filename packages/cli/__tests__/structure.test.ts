// W3-B F-001: CLI-only structural primitives (tree/grid) — verify ASCII
// fallback gating on isColorEnabled() and aligned-column / rule behavior.
import { afterEach, describe, expect, it, vi } from "vitest";

import { tree, grid } from "../src/tui/structure.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("structure primitives — ASCII fallback (NO_COLOR)", () => {
  it("tree() emits +- / `- and no box-drawing glyphs under NO_COLOR", () => {
    vi.stubEnv("NO_COLOR", "1");
    const out = tree([{ text: "first" }, { text: "second" }, { text: "last" }]);
    expect(out).toContain("+- ");
    expect(out).toContain("`- ");
    expect(out).not.toContain("├─");
    expect(out).not.toContain("└─");
  });

  it("grid() emits ----- rule and aligned columns under NO_COLOR", () => {
    vi.stubEnv("NO_COLOR", "1");
    const out = grid(
      [
        ["name", "count"],
        ["team-knowledge", "132"],
        ["personal", "8"],
      ],
      { rule: true },
    );
    expect(out).toContain("-----");
    expect(out).not.toContain("─");
    // column alignment: the shorter label is padded to the widest cell width.
    const lines = out.split("\n");
    expect(lines[0].indexOf("count")).toBe(lines[3].indexOf("8"));
  });
});

describe("structure primitives — truecolor (FORCE_COLOR)", () => {
  it("tree() emits box-drawing branch glyphs when color is forced", () => {
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("FORCE_COLOR", "1");
    const out = tree([{ text: "a" }, { text: "b" }]);
    expect(out).toContain("├─");
    expect(out).toContain("└─");
  });
});
