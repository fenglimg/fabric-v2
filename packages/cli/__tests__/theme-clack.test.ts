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

  it("buildIntro renders section bar + rule", () => {
    expect(buildIntro("Fabric install")).toMatchSnapshot();
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

  it("buildNote renders a left-bar block with optional title", () => {
    expect({
      titled: buildNote("line one\nline two", "Overview"),
      untitled: buildNote("solo line"),
    }).toMatchSnapshot();
  });
});
