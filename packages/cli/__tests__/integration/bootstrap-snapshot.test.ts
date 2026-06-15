/**
 * Integration tests: rc.19 TASK-002 — `.fabric/AGENTS.md` bootstrap snapshot
 *
 * Verifies the L1 snapshot writer (`writeFabricAgentsSnapshot` from
 * `packages/cli/src/install/write-bootstrap-snapshot.ts`) wired into the
 * install bootstrap stage. The snapshot is the source-of-truth that
 * downstream propagation (TASK-003) fans out into per-client thin shells
 * (CLAUDE.md / AGENTS.md / .cursor/rules/fabric-bootstrap.mdc), and that the
 * server-side doctor L1 drift check consumes for byte-identical comparison.
 *
 * Coverage:
 *   T1 — first install writes `.fabric/AGENTS.md` byte-equal to BOOTSTRAP_CANONICAL
 *   T2 — second install is byte-identical (idempotent)
 *   T3 — re-install restores a user-deleted `.fabric/AGENTS.md`
 *   T4 — the `.fabric/` parent directory is created on demand when absent
 */

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveBootstrapCanonical } from "@fenglimg/fabric-shared/templates/bootstrap-canonical";

import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  runInit,
} from "../helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("rc.19 TASK-002 bootstrap-snapshot: .fabric/AGENTS.md", () => {
  it("writes .fabric/AGENTS.md byte-equal to BOOTSTRAP_CANONICAL on first install", async () => {
    const target = createWerewolfFixtureRoot("itg-bootstrap-snapshot-first");
    tempRoots.push(target);

    await runInit(target);

    const snapshotPath = join(target, ".fabric/AGENTS.md");
    expect(existsSync(snapshotPath)).toBe(true);
    const content = readFileSync(snapshotPath, "utf8");
    expect(content).toBe(resolveBootstrapCanonical());
    // Sanity: locked-clarification-3 size guarantee from the source const.
    expect(content.length).toBeGreaterThanOrEqual(400);
  });

  it("second install is byte-identical (idempotent)", async () => {
    const target = createWerewolfFixtureRoot("itg-bootstrap-snapshot-idempotent");
    tempRoots.push(target);

    await runInit(target);
    const snapshotPath = join(target, ".fabric/AGENTS.md");
    const firstContent = readFileSync(snapshotPath, "utf8");
    const firstStat = statSync(snapshotPath);

    await runInit(target);
    const secondContent = readFileSync(snapshotPath, "utf8");
    const secondStat = statSync(snapshotPath);

    // Byte-identical content.
    expect(secondContent).toBe(firstContent);
    expect(secondContent).toBe(resolveBootstrapCanonical());
    // Size unchanged — defense-in-depth alongside content equality.
    expect(secondStat.size).toBe(firstStat.size);
  });

  it("restores deleted .fabric/AGENTS.md on re-install", async () => {
    const target = createWerewolfFixtureRoot("itg-bootstrap-snapshot-restore");
    tempRoots.push(target);

    await runInit(target);
    const snapshotPath = join(target, ".fabric/AGENTS.md");
    expect(existsSync(snapshotPath)).toBe(true);

    // Simulate user-deletes-managed-file: rm just `.fabric/AGENTS.md` while
    // leaving the rest of `.fabric/` intact.
    rmSync(snapshotPath, { force: true });
    expect(existsSync(snapshotPath)).toBe(false);

    await runInit(target);

    expect(existsSync(snapshotPath)).toBe(true);
    expect(readFileSync(snapshotPath, "utf8")).toBe(resolveBootstrapCanonical());
  });

  it("mkdirs .fabric/ parent when missing", async () => {
    const target = createWerewolfFixtureRoot("itg-bootstrap-snapshot-mkdir");
    tempRoots.push(target);

    // createWerewolfFixtureRoot already removes `.fabric/`; verify the
    // precondition then confirm the writer recreates it on demand.
    expect(existsSync(join(target, ".fabric"))).toBe(false);

    await runInit(target);

    const fabricDir = join(target, ".fabric");
    expect(existsSync(fabricDir)).toBe(true);
    expect(statSync(fabricDir).isDirectory()).toBe(true);
    const snapshotPath = join(fabricDir, "AGENTS.md");
    expect(existsSync(snapshotPath)).toBe(true);
    expect(readFileSync(snapshotPath, "utf8")).toBe(resolveBootstrapCanonical());
  });
});
