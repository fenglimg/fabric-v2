import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildIntro,
  buildLog,
  buildNote,
  buildOutro,
} from "../src/install/theme-clack.js";

// F-002 / C-006: the @clack CONTEXT wrap (intro/outro/log/note) must render
// through the W3-B primitives with a stable NO_COLOR byte contract. isColorEnabled
// re-reads env per call, so stubbing NO_COLOR=1 forces the colour-free path on the
// pure builders — no stdout spy needed.
describe("theme-clack context wrap (NO_COLOR)", () => {
  beforeEach(() => {
    vi.stubEnv("NO_COLOR", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("buildIntro renders a B-横线 header (title + rule)", () => {
    const out = buildIntro("Fabric install");
    // spec §0.4: title line + a dim rule; NO `▌` solid block under NO_COLOR.
    expect(out).not.toContain("▌");
    expect(out).toContain("----------------------------------------");
    expect(out).toMatchSnapshot();
  });

  it("buildOutro renders a closing line", () => {
    expect(buildOutro("Done")).toMatchSnapshot();
  });

  it("buildLog renders all four levels", () => {
    expect({
      info: buildLog.info("info message"),
      success: buildLog.success("success message"),
      warn: buildLog.warn("warn message"),
      error: buildLog.error("error message"),
    }).toMatchSnapshot();
  });

  it("buildNote renders a gutter-free indented block with optional title", () => {
    const titled = buildNote("line one\nline two", "Overview");
    const untitled = buildNote("solo line");
    // spec §0.2: no per-line `│`/`| ` wall — plain two-space indent only.
    expect(titled).not.toContain("│");
    expect(titled).not.toContain("| ");
    expect(untitled).not.toContain("│");
    expect(untitled).not.toContain("| ");
    expect({ titled, untitled }).toMatchSnapshot();
  });
});
