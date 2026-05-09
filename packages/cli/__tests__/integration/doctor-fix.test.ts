/**
 * Integration tests: doctor --fix behavior
 * Covers: I6 (fixed errors don't reappear), I7 (legacy client warning),
 *         T1-removed (v2.0 follow-up: init_context_missing check removed),
 *         T5 (legacy client path cleanup)
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctorFix, runDoctorReport } from "@fenglimg/fabric-server";
import { initFabric } from "../../src/commands/init.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  writeFixtureFile,
} from "../helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

// I6 — doctor --fix: fixed errors do not reappear in subsequent report
describe("I6: doctor --fix idempotency", () => {
  it("legacy client path warning is absent after running doctor --fix", async () => {
    const target = createWerewolfFixtureRoot("itg-doctor-fix-legacy");
    tempRoots.push(target);

    // Initialize the project first so fabric dir is valid
    await initFabric(target, { force: true, skipBootstrap: false });

    // Inject a fabric.config.json with legacy client paths to trigger the warning
    const fabricConfig = {
      clientPaths: {
        windsurf: "/usr/local/windsurf",
        activeClients: ["claudeCode"],
      },
    };
    writeFileSync(join(target, "fabric.config.json"), JSON.stringify(fabricConfig, null, 2) + "\n", "utf8");

    // Verify the warning exists before fix
    const beforeReport = await runDoctorReport(target);
    const hasWarning = beforeReport.warnings.some((w) => w.code === "legacy_client_path_present");
    expect(hasWarning).toBe(true);

    // Run --fix
    await runDoctorFix(target);

    // Re-run report — warning must be gone
    const afterReport = await runDoctorReport(target);
    const stillHasWarning = afterReport.warnings.some((w) => w.code === "legacy_client_path_present");
    expect(stillHasWarning).toBe(false);
  });
});

// I7 — legacy clients (windsurf/rooCode/geminiCLI) trigger warning but NOT error
describe("I7: legacy client paths produce warning, not error", () => {
  it("windsurf in clientPaths gives legacy_client_path_present warning, doctor status not error", async () => {
    const target = createWerewolfFixtureRoot("itg-doctor-legacy-warn");
    tempRoots.push(target);

    await initFabric(target, { force: true });

    const fabricConfig = {
      clientPaths: {
        windsurf: "/usr/local/windsurf",
        claudeCode: "/usr/local/claudeCode",
      },
    };
    writeFileSync(join(target, "fabric.config.json"), JSON.stringify(fabricConfig, null, 2) + "\n", "utf8");

    const report = await runDoctorReport(target);

    // Must appear as a warning
    const warning = report.warnings.find((w) => w.code === "legacy_client_path_present");
    expect(warning).toBeDefined();

    // Must NOT be a fixable_error or manual_error
    const asError = report.fixable_errors.find((e) => e.code === "legacy_client_path_present")
      ?? report.manual_errors.find((e) => e.code === "legacy_client_path_present");
    expect(asError).toBeUndefined();
  });

  it("rooCode and geminiCLI in clientPaths also trigger warning", async () => {
    const target = createWerewolfFixtureRoot("itg-doctor-roocode-warn");
    tempRoots.push(target);

    await initFabric(target, { force: true });

    const fabricConfig = {
      clientPaths: {
        rooCode: "/path/rooCode",
        geminiCLI: "/path/geminiCLI",
      },
    };
    writeFileSync(join(target, "fabric.config.json"), JSON.stringify(fabricConfig, null, 2) + "\n", "utf8");

    const report = await runDoctorReport(target);

    const warning = report.warnings.find((w) => w.code === "legacy_client_path_present");
    expect(warning).toBeDefined();
    // The warning message should mention the key names
    expect(warning?.message).toMatch(/rooCode|geminiCLI/);
  });
});

// T1 (v2.0 follow-up): init_context_missing check has been removed from
// doctor entirely. `.fabric/init-context.json` is owned by the AI-side
// fabric-init skill flow, not by `fabric init` CLI. Doctor must not flag
// its absence — that is a legitimate post-init state when the skill has
// not yet run. The runtime hooks under packages/cli/templates/{claude,codex}-
// hooks/ still consume the file as a runtime "skill ran" signal, but that
// is a hook concern, not a state concern.
describe("T1 follow-up: init_context_missing check removed from doctor", () => {
  it("post-init repo without init-context.json: doctor does NOT report init_context_missing", async () => {
    const target = createWerewolfFixtureRoot("itg-doctor-t1-removed");
    tempRoots.push(target);

    await initFabric(target, { force: true });

    // Make sure init-context.json is absent (init CLI does not write it).
    const initContextPath = join(target, ".fabric", "init-context.json");
    if (existsSync(initContextPath)) {
      rmSync(initContextPath);
    }

    const report = await runDoctorReport(target);

    expect(report.manual_errors.map((e) => e.code)).not.toContain("init_context_missing");
    expect(report.fixable_errors.map((e) => e.code)).not.toContain("init_context_missing");
    expect(report.checks.find((c) => c.code === "init_context_missing")).toBeUndefined();
    expect(report.checks.find((c) => c.code === "init_context_invalid")).toBeUndefined();
  });
});

// T5 — doctor --fix removes legacy client path keys, preserves active clients
describe("T5: doctor --fix removes legacy client paths, preserves active ones", () => {
  it("removes windsurf/rooCode/geminiCLI keys while leaving active client entries intact", async () => {
    const target = createWerewolfFixtureRoot("itg-doctor-t5-legacy-fix");
    tempRoots.push(target);

    await initFabric(target, { force: true });

    const fabricConfig = {
      clientPaths: {
        windsurf: "/usr/local/windsurf",
        rooCode: "/usr/local/rooCode",
        geminiCLI: "/usr/local/geminiCLI",
        claudeCode: "/usr/local/claudeCode",
      },
    };
    writeFileSync(join(target, "fabric.config.json"), JSON.stringify(fabricConfig, null, 2) + "\n", "utf8");

    await runDoctorFix(target);

    const updated = JSON.parse(readFileSync(join(target, "fabric.config.json"), "utf8")) as {
      clientPaths?: Record<string, unknown>;
    };

    // Legacy keys must be gone
    expect(updated.clientPaths?.windsurf).toBeUndefined();
    expect(updated.clientPaths?.rooCode).toBeUndefined();
    expect(updated.clientPaths?.geminiCLI).toBeUndefined();

    // Active client path must remain
    expect(updated.clientPaths?.claudeCode).toBe("/usr/local/claudeCode");
  });
});
