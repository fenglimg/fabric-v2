import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInitFabricPlan } from "../src/commands/install.js";

// W3-09 (ISS-035) — the forensic project scan must emit progress feedback so
// `fabric install` does not look frozen, but only on an interactive stderr TTY
// (piped/CI/test contexts stay silent so output snapshots don't churn).

const dirs: string[] = [];
const originalStderrTty = process.stderr.isTTY;

function setStderrTty(value: boolean): void {
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true });
}

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-forensic-"));
  dirs.push(dir);
  return dir;
}

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stderr.write);
  return { lines, restore: () => spy.mockRestore() };
}

afterEach(() => {
  Object.defineProperty(process.stderr, "isTTY", { value: originalStderrTty, configurable: true });
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("install forensic scan progress", () => {
  // Locale-agnostic: the module-level translator renders in the machine locale
  // (en or zh-CN), so we assert presence/absence of progress output rather than
  // exact wording. The brackets straddle the forensic scan (2 lines on a TTY).
  it("emits scan progress lines on an interactive stderr TTY", async () => {
    setStderrTty(true);
    const cap = captureStderr();
    try {
      await buildInitFabricPlan(tmpProject());
    } finally {
      cap.restore();
    }
    expect(cap.lines.length).toBeGreaterThan(0);
  });

  it("stays silent when stderr is not a TTY (piped / CI / test)", async () => {
    setStderrTty(false);
    const cap = captureStderr();
    try {
      await buildInitFabricPlan(tmpProject());
    } finally {
      cap.restore();
    }
    expect(cap.lines.length).toBe(0);
  });
});
