// renderStep used to emit a dim "running" placeholder line and then overwrite it
// in place with the terminal status via `\x1b[1A\x1b[2K` (cursor-up + clear-line).
// That cursor-up assumes the placeholder is the line DIRECTLY above, so any
// interstitial output a stage prints between running and settle (store-slot info
// lines, clack prompts) made the overwrite clear the wrong line and left the
// placeholder as a doubled `● name` row. The placeholder (static, no spinner)
// bought no real feedback, so it was dropped: a "running" call is now a NO-OP and
// each stage renders EXACTLY ONCE — the settled line — with no cursor escapes, on
// TTY and non-TTY alike. This file pins that single-line-via-no-placeholder
// contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConsoleOutputRenderer } from "../src/tui/ConsoleOutputRenderer.js";
import type { StepInfo } from "../src/tui/types.js";

let logSpy: ReturnType<typeof vi.spyOn>;
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
  vi.unstubAllEnvs();
});

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

const running: StepInfo = { name: "Preflight", current: 1, total: 2, status: "running" };
const success: StepInfo = { name: "Preflight", current: 1, total: 2, status: "success" };

describe("ConsoleOutputRenderer renderStep — single-line (no running placeholder)", () => {
  it("TTY+color: running→success emits ONE settled line, no placeholder, no cursor escapes", () => {
    setTTY(true);
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("NO_COLOR", "");
    const r = new ConsoleOutputRenderer({ colors: true });

    r.renderStep(running);
    r.renderStep(success);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    // The "running" call is a no-op; only the terminal status line is written.
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\x1b[1A");
    expect(lines[0]).not.toContain("\x1b[2K");
  });

  it("non-TTY: only the terminal line prints, no cursor escapes", () => {
    setTTY(false);
    const r = new ConsoleOutputRenderer({ colors: false });

    r.renderStep(running);
    r.renderStep(success);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\x1b[1A");
    expect(lines[0]).not.toContain("\x1b[2K");
  });

  it("colors:false on a TTY does not emit cursor escapes", () => {
    setTTY(true);
    const r = new ConsoleOutputRenderer({ colors: false });

    r.renderStep(running);
    r.renderStep(success);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(1);
    expect(lines.join("\n")).not.toContain("\x1b[1A");
    expect(lines.join("\n")).not.toContain("\x1b[2K");
  });
});
