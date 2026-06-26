import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildIntro,
  buildLog,
  buildNote,
  buildOutro,
  buildPromptReceipt,
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

  // TASK-004 / spec §2 control回执: a flat (gutter-free) ✓/x line printed AFTER a
  // clack control resolves. The control stays native (C-006); the receipt is its
  // own line in the flat output zone.
  it("buildPromptReceipt renders a gutter-free ✓ line for set/selected and an x line for cancelled", () => {
    const set = buildPromptReceipt("set", "zh-CN");
    const selected = buildPromptReceipt("selected", "bootstrap templates, MCP clients");
    const cancelled = buildPromptReceipt("cancelled");
    const setNoValue = buildPromptReceipt("set");

    // spec §0.2–0.3: receipts carry NO `│` gutter — they live in the flat zone.
    for (const line of [set, selected, cancelled, setNoValue]) {
      expect(line).not.toContain("│");
    }
    // set/selected use the ok glyph + ` · <value>`; cancelled uses the error glyph.
    expect(set).toContain("·");
    expect(set).toContain("zh-CN");
    expect(setNoValue).not.toContain("·");
    expect({ set, selected, cancelled, setNoValue }).toMatchSnapshot();
  });
});
