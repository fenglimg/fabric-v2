import type { DoctorReport } from "@fenglimg/fabric-server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderTldrHeader } from "../src/commands/doctor.js";

// W3-09 (ISS-038) — the doctor TL;DR header (the part most users actually read)
// must carry each finding's actionHint, not just code+message. The full issue
// list below it already shows the remediation; the TL;DR previously dropped it.

function capture(fn: () => void): string {
  const lines: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: string | Uint8Array) => {
      lines.push(String(chunk).replace(/\n$/, ""));
      return true;
    }) as typeof process.stdout.write);
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

const dt = ((key: string) => key) as never;

function reportWith(issue: { code: string; message: string; actionHint?: string; audience?: "user" | "maintainer" }): DoctorReport {
  return {
    fixable_errors: [issue],
    manual_errors: [],
    warnings: [],
  } as unknown as DoctorReport;
}

afterEach(() => vi.restoreAllMocks());

describe("doctor TL;DR actionHint", () => {
  it("renders the actionHint under a TL;DR finding", () => {
    const out = capture(() =>
      renderTldrHeader(
        reportWith({ code: "X_CODE", message: "something is off", actionHint: "run `fabric doctor --fix`" }),
        dt,
        false,
      ),
    );
    expect(out).toMatch(/X_CODE/);
    expect(out).toMatch(/fabric doctor --fix/);
  });

  it("folds a maintainer-audience hint unless verbose", () => {
    const out = capture(() =>
      renderTldrHeader(
        reportWith({
          code: "M_CODE",
          message: "maintainer thing",
          actionHint: "edit packages/server/src/internal.ts",
          audience: "maintainer",
        }),
        dt,
        false,
      ),
    );
    // folded → the raw maintainer path must NOT leak to end users
    expect(out).not.toMatch(/internal\.ts/);
  });
});
