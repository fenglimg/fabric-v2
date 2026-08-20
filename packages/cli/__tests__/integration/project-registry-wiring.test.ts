/**
 * Integration: the machine project registry is written by `fabric install` and
 * cleared by `fabric uninstall`.
 *
 * The unit suite (`project-registry-io.test.ts`) proves the store behaves; this
 * one proves it is actually WIRED — that the ValidateStage records the install
 * and the uninstall scaffold stage clears it. A registry that works perfectly
 * but is never called would pass the unit suite completely.
 *
 * FABRIC_HOME is per-test-file (vitest.setup.ts) and repointed per test here, so
 * the real ~/.fabric is never touched. resolveGlobalRoot() additionally throws
 * under the test runner when FABRIC_HOME is unset, so an isolation slip fails
 * loudly instead of writing to the developer's home.
 */

import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listRegisteredProjects,
  projectRegistryPath,
} from "../../src/store/project-registry-io.js";
import { loadProjectConfig } from "../../src/store/project-config-io.js";
import { cleanupFixtureRoot, createWerewolfFixtureRoot, runInit } from "../helpers/init-test-utils.ts";

const tempRoots: string[] = [];
let fabricHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.FABRIC_HOME;
  fabricHome = mkdtempSync(join(tmpdir(), "fabric-registry-wiring-home-"));
  process.env.FABRIC_HOME = fabricHome;
});

afterEach(() => {
  process.env.FABRIC_HOME = originalHome;
  rmSync(fabricHome, { recursive: true, force: true });
  for (const root of tempRoots.splice(0)) cleanupFixtureRoot(root);
  vi.restoreAllMocks();
});

/** `<FABRIC_HOME>/.fabric/state/projects.json` for the current test. */
function registryPath(): string {
  return projectRegistryPath(join(fabricHome, ".fabric"));
}

describe("fabric install → project registry", () => {
  it("records the installed project's path, id and version (AC1)", async () => {
    const target = createWerewolfFixtureRoot("fab-registry-install");
    tempRoots.push(target);

    await runInit(target);

    const entries = await listRegisteredProjects(join(fabricHome, ".fabric"));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(target);
    // This fixture installs WITHOUT binding a store, so fabric-config.json stays
    // `{}` and there is no project_id. Asserted explicitly (rather than
    // `toBe(loadProjectConfig(...)?.project_id)`, which would be undefined ===
    // undefined and pass no matter what) because "store-less installs are still
    // registered" is the exact regression this file must catch — an earlier
    // revision gated registration on the id and silently registered nothing.
    expect(loadProjectConfig(target)?.project_id).toBeUndefined();
    expect(entries[0]!.projectId).toBeUndefined();
    // vitest.config.ts defines __CLI_VERSION__ = "0.0.0-test"; asserting that
    // exact value (rather than "any string") is what proves the version is read
    // from the build define rather than defaulted to "unknown".
    expect(entries[0]!.fabricVersion).toBe("0.0.0-test");
    expect(entries[0]!.stale).toBe(false);
  });

  it("stays a single snapshot entry across three installs (AC2)", async () => {
    const target = createWerewolfFixtureRoot("fab-registry-idempotent");
    tempRoots.push(target);

    await runInit(target);
    await runInit(target);
    await runInit(target);

    const entries = await listRegisteredProjects(join(fabricHome, ".fabric"));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(target);
  });

  it("writes nothing on --dry-run (AC3)", async () => {
    const target = createWerewolfFixtureRoot("fab-registry-dryrun");
    tempRoots.push(target);

    // Dry-run against a NEVER-installed project: the registry file must not
    // even come into existence.
    await runInit(target, { planOnly: true });
    expect(existsSync(registryPath())).toBe(false);

    // And against an already-registered one: mtime must not move. Content
    // equality alone would pass even if the file were rewritten identically,
    // which is still a write the dry-run contract forbids.
    await runInit(target);
    const before = statSync(registryPath()).mtimeMs;
    await runInit(target, { planOnly: true });
    expect(statSync(registryPath()).mtimeMs).toBe(before);
  });

  it("keeps separate projects side by side", async () => {
    const a = createWerewolfFixtureRoot("fab-registry-multi-a");
    const b = createWerewolfFixtureRoot("fab-registry-multi-b");
    tempRoots.push(a, b);

    await runInit(a);
    await runInit(b);

    const paths = (await listRegisteredProjects(join(fabricHome, ".fabric")))
      .map((e) => e.path)
      .sort();
    expect(paths).toEqual([a, b].sort());
  });
});

describe("fabric uninstall → project registry", () => {
  it("clears the entry for the uninstalled project only (AC10)", async () => {
    const kept = createWerewolfFixtureRoot("fab-registry-uninst-kept");
    const removed = createWerewolfFixtureRoot("fab-registry-uninst-removed");
    tempRoots.push(kept, removed);

    await runInit(kept);
    await runInit(removed);
    expect(await listRegisteredProjects(join(fabricHome, ".fabric"))).toHaveLength(2);

    vi.spyOn(console, "log").mockImplementation(() => {});
    const { uninstallFabric } = await import("../../src/commands/uninstall.ts");
    await uninstallFabric(removed, { skipMcp: true });

    const entries = await listRegisteredProjects(join(fabricHome, ".fabric"));
    expect(entries.map((e) => e.path)).toEqual([kept]);
  });

  it("is harmless for a project that was never registered", async () => {
    const target = createWerewolfFixtureRoot("fab-registry-uninst-unknown");
    tempRoots.push(target);

    vi.spyOn(console, "log").mockImplementation(() => {});
    const { uninstallFabric } = await import("../../src/commands/uninstall.ts");
    await expect(uninstallFabric(target, { skipMcp: true })).resolves.toBeDefined();

    expect(await listRegisteredProjects(join(fabricHome, ".fabric"))).toEqual([]);
  });
});
