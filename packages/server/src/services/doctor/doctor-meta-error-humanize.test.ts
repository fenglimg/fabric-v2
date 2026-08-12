/**
 * rc.35 TASK-09 (P0-14) — tests for the humanised `agents_meta_invalid`
 * renderer.
 *
 * Three rendering branches per spec:
 *   (a) Global CLI is outdated → message tells the version mismatch story
 *       and points to npm install -g (highest-signal root cause).
 *   (b) ZodError with structured issues → message lists up to 3 field paths
 *       with reasons (no raw JSON dump).
 *   (c) Plain JSON syntax error / other → fall back to the original message
 *       wrapped with the standard remediation pointer.
 *
 * Direct unit tests against `createMetaCheck`. We synthesize the
 * MetaInspection shape rather than driving `inspectMeta` against a real
 * tmp directory to keep the test surface tight.
 */

import { describe, expect, it } from "vitest";

import { createTranslator } from "@fenglimg/fabric-shared";

import {
  createGlobalCliVersionCheck,
  inspectGlobalCliVersion,
} from "./doctor.js";

// v2.2 W5 R4 (agents.meta decolo): the (b) ZodError + (c) JSON-syntax-error
// humanisation tests are removed. They exercised `createMetaCheck`'s
// `agents_meta_invalid` rendering over a hand-broken co-location
// agents.meta.json — the entire agents_meta check (and inspectMeta) is retired
// now that knowledge lives in stores, so there is no "Agents metadata" check to
// render. The (a) global-CLI-outdated branch was a sanity check on the still-
// live global-CLI helpers, retained below.

describe("inspectGlobalCliVersion + createGlobalCliVersionCheck sanity", () => {
  // Sanity check that the helpers used by the (a) branch still exist and
  // produce the expected "outdated" status — the branch wiring is exercised
  // by the integration runDoctorReport test which depends on VITEST env to
  // skip the actual spawn, so we keep this minimal here.
  it("inspectGlobalCliVersion respects the injected spawn override", () => {
    const t = createTranslator("en");
    const inspection = inspectGlobalCliVersion(() => ({ error: null, status: 0, stdout: "2.0.0-rc.30\n" }));
    expect(inspection.status).toBe("outdated");
    const check = createGlobalCliVersionCheck(t, inspection);
    expect(check.actionHint).toContain("npm install -g");
  });
});
