/**
 * Tests for `inspectGlobalCliVersion` + `createGlobalCliVersionCheck` — the
 * rc.35 TASK-04 (P0-9.b) lint that surfaces an outdated global `fabric` CLI
 * (rc.30) running against an rc.31+ project schema (the silent-hooks fault
 * mode that P0-9 audit identified).
 *
 * Cases:
 *   (a) ok      — spawn returns rc.31 (== min) → status "ok"
 *   (b) ok      — spawn returns rc.35 (> min)  → status "ok"
 *   (c) outdated — spawn returns rc.30 (< min)  → status "outdated"
 *   (d) not-found — spawn errors with ENOENT     → warn-fallback (no error tier)
 *   (e) unparseable — spawn stdout is garbage    → warn-fallback
 *   (f) check translation — outdated produces manual_error with remediation
 */

import { describe, expect, it } from "vitest";

import { createTranslator } from "@fenglimg/fabric-shared";

import {
  createGlobalCliVersionCheck,
  inspectGlobalCliVersion,
} from "./doctor.js";

function fakeSpawn(result: {
  errorCode?: string;
  status?: number;
  stdout?: string;
}): () => { error?: NodeJS.ErrnoException | null; status?: number | null; stdout?: string } {
  return () => {
    if (result.errorCode) {
      const err = new Error(`spawn error ${result.errorCode}`) as NodeJS.ErrnoException;
      err.code = result.errorCode;
      return { error: err, status: null, stdout: "" };
    }
    return { error: null, status: result.status ?? 0, stdout: result.stdout ?? "" };
  };
}

describe("inspectGlobalCliVersion", () => {
  it("(a) returns ok when global CLI matches minimum supported version (rc.31)", () => {
    const inspection = inspectGlobalCliVersion(fakeSpawn({ status: 0, stdout: "2.0.0-rc.31\n" }));
    expect(inspection.status).toBe("ok");
    if (inspection.status === "ok") {
      expect(inspection.version).toBe("2.0.0-rc.31");
    }
  });

  it("(b) returns ok when global CLI is newer than minimum (rc.35)", () => {
    const inspection = inspectGlobalCliVersion(fakeSpawn({ status: 0, stdout: "2.0.0-rc.35\n" }));
    expect(inspection.status).toBe("ok");
  });

  it("(c) returns outdated when global CLI is older than minimum (rc.30)", () => {
    const inspection = inspectGlobalCliVersion(fakeSpawn({ status: 0, stdout: "2.0.0-rc.30\n" }));
    expect(inspection.status).toBe("outdated");
    if (inspection.status === "outdated") {
      expect(inspection.version).toBe("2.0.0-rc.30");
      expect(inspection.minVersion).toBe("2.0.0-rc.31");
    }
  });

  it("(d) returns not-found on ENOENT (no fabric on PATH)", () => {
    const inspection = inspectGlobalCliVersion(fakeSpawn({ errorCode: "ENOENT" }));
    expect(inspection.status).toBe("not-found");
  });

  it("(e) returns unparseable on garbage stdout", () => {
    const inspection = inspectGlobalCliVersion(fakeSpawn({ status: 0, stdout: "not a version string" }));
    expect(inspection.status).toBe("unparseable");
  });

  it("(e) returns unparseable on non-zero exit", () => {
    const inspection = inspectGlobalCliVersion(fakeSpawn({ status: 2, stdout: "" }));
    expect(inspection.status).toBe("unparseable");
  });
});

describe("createGlobalCliVersionCheck", () => {
  const t = createTranslator("en");

  it("(f) outdated → manual_error with bilingual-safe remediation pointer", () => {
    const check = createGlobalCliVersionCheck(t, {
      status: "outdated",
      version: "2.0.0-rc.30",
      minVersion: "2.0.0-rc.31",
    });
    expect(check.status).toBe("error");
    expect(check.kind).toBe("manual_error");
    expect(check.code).toBe("global_cli_outdated");
    expect(check.message).toContain("2.0.0-rc.30");
    expect(check.message).toContain("2.0.0-rc.31");
    expect(check.actionHint).toContain("npm install -g");
    expect(check.actionHint).toContain("fabric install");
  });

  it("(f) ok → no kind, no actionHint", () => {
    const check = createGlobalCliVersionCheck(t, { status: "ok", version: "2.0.0-rc.35" });
    expect(check.status).toBe("ok");
    expect(check.message).toContain("2.0.0-rc.35");
  });

  it("(f) not-found → warn (does not bump report to error)", () => {
    const check = createGlobalCliVersionCheck(t, { status: "not-found" });
    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
    expect(check.code).toBe("global_cli_not_found");
  });

  it("(f) unparseable → warn", () => {
    const check = createGlobalCliVersionCheck(t, { status: "unparseable", detail: "xyz" });
    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
    expect(check.code).toBe("global_cli_unparseable");
  });
});
