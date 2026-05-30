import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isColorEnabled } from "../src/colors.js";

// W3-08 (ISS-040) — FORCE_COLOR is the dual of NO_COLOR: it forces color ON
// even without a TTY (e.g. piping into a pager / CI). NO_COLOR still wins when
// both are set (https://no-color.org).

const originalNoColor = process.env.NO_COLOR;
const originalForceColor = process.env.FORCE_COLOR;
const originalStdoutTty = process.stdout.isTTY;
const originalStderrTty = process.stderr.isTTY;

function setTty(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true });
}

beforeEach(() => {
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
});

afterEach(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
  if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = originalForceColor;
  Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutTty, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value: originalStderrTty, configurable: true });
});

describe("isColorEnabled FORCE_COLOR support", () => {
  it("forces color on a non-TTY when FORCE_COLOR=1", () => {
    setTty(false);
    process.env.FORCE_COLOR = "1";
    expect(isColorEnabled()).toBe(true);
  });

  it("treats FORCE_COLOR=0 / false as an explicit disable even on a TTY", () => {
    setTty(true);
    process.env.FORCE_COLOR = "0";
    expect(isColorEnabled()).toBe(false);
    process.env.FORCE_COLOR = "false";
    expect(isColorEnabled()).toBe(false);
  });

  it("lets NO_COLOR win when both NO_COLOR and FORCE_COLOR are set", () => {
    setTty(false);
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "1";
    expect(isColorEnabled()).toBe(false);
  });

  it("still falls back to TTY detection when neither var is set", () => {
    setTty(false);
    expect(isColorEnabled()).toBe(false);
    setTty(true);
    expect(isColorEnabled()).toBe(true);
  });
});
