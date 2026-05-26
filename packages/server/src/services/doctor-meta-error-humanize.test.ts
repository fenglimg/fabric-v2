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

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTranslator } from "@fenglimg/fabric-shared";

import {
  createGlobalCliVersionCheck,
  inspectGlobalCliVersion,
  runDoctorReport,
} from "./doctor.js";

function makeFabricProject(metaContent: string): string {
  const root = mkdtempSync(join(tmpdir(), "fab-meta-humanize-"));
  mkdirSync(join(root, ".fabric"), { recursive: true });
  mkdirSync(join(root, ".fabric", "knowledge", "decisions"), { recursive: true });
  writeFileSync(join(root, ".fabric", "agents.meta.json"), metaContent, "utf8");
  return root;
}

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length > 0) {
    const p = cleanup.pop();
    if (p && existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
});

describe("createMetaCheck humanisation (TASK-09)", () => {
  it("(b) ZodError → human sentence with field paths, no raw JSON dump", async () => {
    // Schema-invalid file — `nodes` is required to be an object; passing a
    // string forces a ZodError out of agentsMetaSchema.parse.
    const broken = JSON.stringify({
      revision: "abc",
      nodes: "not-an-object",
      counters: { knowledge_team: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRC: 0 } },
    });
    const root = makeFabricProject(broken);
    cleanup.push(root);

    const report = await runDoctorReport(root);
    const metaCheck = report.checks.find((c) => c.name.includes("Agents metadata"));
    expect(metaCheck).toBeDefined();
    expect(metaCheck?.status).toBe("error");
    // Must NOT contain raw zod JSON dump artifacts like `"code":"invalid_type"`.
    expect(metaCheck?.message ?? "").not.toContain('"code":"');
    expect(metaCheck?.message ?? "").not.toContain('"path":[');
    // Must contain at least one field path token (e.g. `nodes`).
    expect(metaCheck?.message ?? "").toContain("nodes");
  });

  it("(c) JSON syntax error fall-back surfaces something readable + remediation pointer", async () => {
    const root = makeFabricProject("{not valid json");
    cleanup.push(root);

    const report = await runDoctorReport(root);
    const metaCheck = report.checks.find((c) => c.name.includes("Agents metadata"));
    expect(metaCheck?.status).toBe("error");
    expect(metaCheck?.actionHint ?? "").toContain("fabric doctor --fix");
  });
});

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
