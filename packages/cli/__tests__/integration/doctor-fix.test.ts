/**
 * Integration tests: doctor --fix behavior
 * Covers: I6 (fixed errors don't reappear), I7 (legacy client warning), T1 (init_context_missing action_hint), T5 (legacy client path cleanup)
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

// T1 — init_context_missing: action_hint points to fabric-init skill, NOT --fix
describe("T1: init_context_missing action_hint — fabric-init skill reference", () => {
  it("missing .fabric/init-context.json produces manual_error with fabric-init skill action_hint", async () => {
    const target = createWerewolfFixtureRoot("itg-doctor-t1-hint");
    tempRoots.push(target);

    await initFabric(target, { force: true });

    // Remove init-context.json to trigger the missing check
    const initContextPath = join(target, ".fabric", "init-context.json");
    if (existsSync(initContextPath)) {
      rmSync(initContextPath);
    }

    const report = await runDoctorReport(target);

    const missing = report.manual_errors.find((e) => e.code === "init_context_missing");
    expect(missing).toBeDefined();

    // action_hint must point to the fabric-init skill (not --fix)
    // The hint should NOT say "fab doctor --fix" for this specific error
    const hint = (missing as { action_hint?: string })?.action_hint ?? missing?.message ?? "";
    expect(hint).toMatch(/fabric-init|fabric.init/i);
    // Confirm it does NOT suggest --fix as the resolution
    expect(hint).not.toMatch(/fab doctor --fix/i);
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
