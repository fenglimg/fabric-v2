// TASK-003 (G5): renderStep used to emit a "running" placeholder line AND a
// terminal status line, both persisting → a stacked double line. The two now
// collapse into ONE line:
//   • TTY + color: the running placeholder is written, then the terminal status
//     overwrites it in place via `\x1b[1A\x1b[2K` (cursor-up + clear-line).
//   • non-TTY: the running placeholder is SUPPRESSED entirely (no cursor escapes,
//     which would corrupt a log) — only the terminal line is printed.
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

describe("ConsoleOutputRenderer renderStep — single-line (TASK-003 G5)", () => {
  it("TTY+color: a running→success transition overwrites the running line in place (single line)", () => {
    setTTY(true);
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("NO_COLOR", "");
    const r = new ConsoleOutputRenderer({ colors: true });

    r.renderStep(running);
    r.renderStep(success);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    // Two writes: the running placeholder, then the terminal line carrying the
    // in-place redraw escape that overwrites it.
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain("\x1b[1A");
    expect(lines[1]).toContain("\x1b[1A");
    expect(lines[1]).toContain("\x1b[2K");
  });

  it("non-TTY: the running placeholder is suppressed — only the terminal line prints, no cursor escapes", () => {
    setTTY(false);
    const r = new ConsoleOutputRenderer({ colors: false });

    r.renderStep(running);
    r.renderStep(success);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    // Exactly one line — the terminal status (running placeholder dropped).
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\x1b[1A");
    expect(lines[0]).not.toContain("\x1b[2K");
  });

  it("colors:false on a TTY does not emit cursor escapes (escapes strictly gated behind colorOn)", () => {
    setTTY(true);
    const r = new ConsoleOutputRenderer({ colors: false });

    r.renderStep(running);
    r.renderStep(success);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.join("\n")).not.toContain("\x1b[1A");
    expect(lines.join("\n")).not.toContain("\x1b[2K");
  });
});
