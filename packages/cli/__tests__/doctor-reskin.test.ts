import type { DoctorReport } from "@fenglimg/fabric-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderDoctorChecks,
  renderDoctorHeader,
  renderDoctorStoreHealth,
} from "../src/commands/doctor.js";
import type { StoreDiagnostic } from "../src/store/doctor-checks.js";

// W3-B F-003 (C-008) — pin the reskinned doctor human surface (section-bar
// header + tree rows + status badges per mockups.md#1) under NO_COLOR so the
// new ASCII structure can never silently regress. NO_COLOR keeps the snapshot
// escape-free and stable for log scrapers; the colour layer is exercised by the
// theme parity tests, not here.

const fixtureReport: DoctorReport = {
  status: "warn",
  summary: { target: "/repo" },
  checks: [
    { name: "Bootstrap anchor", status: "ok", message: "anchor present" },
    { name: "Events ledger health", status: "warn", message: "metrics stalled" },
    { name: "Lock file", status: "error", message: "lock is stale" },
  ],
  fixable_errors: [],
  manual_errors: [],
  warnings: [],
} as unknown as DoctorReport;

const fixtureDiagnostics: StoreDiagnostic[] = [
  { code: "missing_required_store", severity: "error", ref: "team", message: "required store is missing" },
  { code: "no_global_config", severity: "warn", message: "global config is missing" },
  { code: "local_only_store", severity: "info", ref: "personal", message: "store is local-only" },
];

describe("doctor reskin render helpers (NO_COLOR)", () => {
  beforeEach(() => {
    vi.stubEnv("NO_COLOR", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the section-bar header + status badge", () => {
    expect(renderDoctorHeader(fixtureReport)).toMatchSnapshot();
  });

  it("renders store health as a section-bar + tree", () => {
    expect(renderDoctorStoreHealth(fixtureDiagnostics)).toMatchSnapshot();
  });

  it("renders an empty string for no store diagnostics", () => {
    expect(renderDoctorStoreHealth([])).toBe("");
  });

  it("renders the checks section quiet (warn/error only)", () => {
    expect(renderDoctorChecks(fixtureReport, false)).toMatchSnapshot();
  });

  it("renders the checks section verbose (includes passing rows)", () => {
    expect(renderDoctorChecks(fixtureReport, true)).toMatchSnapshot();
  });

  it("renders an empty string when quiet and all checks pass", () => {
    const allOk = {
      ...fixtureReport,
      status: "ok",
      checks: [{ name: "Bootstrap anchor", status: "ok", message: "anchor present" }],
    } as unknown as DoctorReport;
    expect(renderDoctorChecks(allOk, false)).toBe("");
  });
});
