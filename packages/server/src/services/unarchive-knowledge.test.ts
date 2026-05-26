/**
 * v2.0.0-rc.34 TASK-05: unit tests for the `unarchiveKnowledge` reverse-flow
 * primitive. Covers the four documented contracts:
 *
 *   1. Schema/layer derivation from filename prefix (KT-* → team, KP-* → personal)
 *   2. Dry-run returns would-be path WITHOUT mutating disk or emitting events
 *   3. Successful move emits exactly one `knowledge_unarchived` event with the
 *      restored_to + archive_path fields populated, and the file lands at the
 *      canonical layer path
 *   4. Defensive failures (missing source / clobber-protect / bad filename)
 *      return ok=false + error string without partial mutation
 *
 * Doctor wire-up (auto-detection of ghost-cited archived entries) is rc.35
 * scope per TASK-05 commit message; this file pins the primitive contract.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { unarchiveKnowledge } from "./unarchive-knowledge.js";
import type { KnowledgeUnarchivedEvent } from "@fenglimg/fabric-shared";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeProjectRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rc34-task05-unarchive-"));
  tempDirs.push(dir);
  return dir;
}

async function seedArchivedFile(
  projectRoot: string,
  type: string,
  filename: string,
  body = "# Archived\n\nLegacy body.\n",
): Promise<string> {
  const relDir = join(".fabric", ".archive", type);
  await mkdir(join(projectRoot, relDir), { recursive: true });
  const relPath = join(relDir, filename);
  await writeFile(join(projectRoot, relPath), body, "utf8");
  return relPath.replace(/\\/g, "/");
}

describe("unarchiveKnowledge — dry-run (rc.34 TASK-05)", () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await makeProjectRoot();
  });

  it("returns expected restoredTo for KT-* team filename, no disk mutation", async () => {
    const archiveRel = await seedArchivedFile(
      projectRoot,
      "decisions",
      "KT-D-0007--single-cjs-hook.md",
    );
    const result = await unarchiveKnowledge(projectRoot, archiveRel, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.stableId).toBe("KT-D-0007");
    expect(result.restoredTo).toBe(
      ".fabric/knowledge/team/decisions/KT-D-0007--single-cjs-hook.md",
    );

    expect(existsSync(join(projectRoot, archiveRel))).toBe(true);
    expect(existsSync(join(projectRoot, result.restoredTo!))).toBe(false);

    const ledger = await readEventLedger(projectRoot, { event_type: "knowledge_unarchived" });
    expect(ledger.events).toHaveLength(0);
  });

  it("returns personal layer for KP-* filename", async () => {
    const archiveRel = await seedArchivedFile(
      projectRoot,
      "guidelines",
      "KP-G-0003--indent-style.md",
    );
    const result = await unarchiveKnowledge(projectRoot, archiveRel, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.restoredTo).toBe(
      ".fabric/knowledge/personal/guidelines/KP-G-0003--indent-style.md",
    );
  });
});

describe("unarchiveKnowledge — apply (rc.34 TASK-05)", () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await makeProjectRoot();
  });

  it("moves file from .archive to canonical layer path and emits one event", async () => {
    const archiveRel = await seedArchivedFile(
      projectRoot,
      "pitfalls",
      "KT-P-0011--deepmerge-array-trap.md",
      "# DeepMerge pitfall\n\nDetail.\n",
    );

    const result = await unarchiveKnowledge(projectRoot, archiveRel, {
      reason: "test:fixture-restore",
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.stableId).toBe("KT-P-0011");

    const restoredPath = join(projectRoot, result.restoredTo!);
    expect(existsSync(restoredPath)).toBe(true);
    expect(existsSync(join(projectRoot, archiveRel))).toBe(false);

    const body = await readFile(restoredPath, "utf8");
    expect(body).toContain("DeepMerge pitfall");

    const ledger = await readEventLedger(projectRoot, {
      event_type: "knowledge_unarchived",
    });
    expect(ledger.events).toHaveLength(1);
    const event = ledger.events[0] as KnowledgeUnarchivedEvent;
    expect(event.stable_id).toBe("KT-P-0011");
    expect(event.reason).toBe("test:fixture-restore");
    expect(event.archive_path).toBe(archiveRel);
    expect(event.restored_to).toBe(result.restoredTo);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("default reason is 'unspecified' when caller omits it", async () => {
    const archiveRel = await seedArchivedFile(
      projectRoot,
      "models",
      "KT-M-0042--wave-1-parallel-dag.md",
    );
    await unarchiveKnowledge(projectRoot, archiveRel);
    const ledger = await readEventLedger(projectRoot, {
      event_type: "knowledge_unarchived",
    });
    expect(ledger.events).toHaveLength(1);
    expect((ledger.events[0] as KnowledgeUnarchivedEvent).reason).toBe("unspecified");
  });

  it("targetLayer override wins over filename prefix derivation", async () => {
    // Filename has KT-* prefix but caller forces personal layer (e.g. an
    // operator manually moving a misclassified entry).
    const archiveRel = await seedArchivedFile(
      projectRoot,
      "guidelines",
      "KT-G-0099--cross-project-style.md",
    );
    const result = await unarchiveKnowledge(projectRoot, archiveRel, {
      targetLayer: "personal",
    });
    expect(result.ok).toBe(true);
    expect(result.restoredTo).toBe(
      ".fabric/knowledge/personal/guidelines/KT-G-0099--cross-project-style.md",
    );
  });
});

describe("unarchiveKnowledge — defensive failures (rc.34 TASK-05)", () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await makeProjectRoot();
  });

  it("returns ok=false when filename has no KT-/KP- prefix and no layer override", async () => {
    const archiveRel = await seedArchivedFile(
      projectRoot,
      "decisions",
      "legacy-no-prefix.md",
    );
    const result = await unarchiveKnowledge(projectRoot, archiveRel);

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/cannot derive layer/);
    expect(existsSync(join(projectRoot, archiveRel))).toBe(true); // untouched
  });

  it("returns ok=false when archive source is missing", async () => {
    const ghostPath = ".fabric/.archive/decisions/KT-D-9999--ghost.md";
    const result = await unarchiveKnowledge(projectRoot, ghostPath);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/archive source does not exist/);
  });

  it("returns ok=false when restore target already exists (clobber-protect)", async () => {
    const archiveRel = await seedArchivedFile(
      projectRoot,
      "decisions",
      "KT-D-0007--single-cjs-hook.md",
    );
    // Seed a "live" entry at the canonical path so the unarchive would clobber.
    const liveDir = join(projectRoot, ".fabric", "knowledge", "team", "decisions");
    await mkdir(liveDir, { recursive: true });
    await writeFile(
      join(liveDir, "KT-D-0007--single-cjs-hook.md"),
      "# Already live\n",
      "utf8",
    );

    const result = await unarchiveKnowledge(projectRoot, archiveRel);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/restore target already exists/);
    expect(existsSync(join(projectRoot, archiveRel))).toBe(true); // archive intact
    const ledger = await readEventLedger(projectRoot, { event_type: "knowledge_unarchived" });
    expect(ledger.events).toHaveLength(0); // no partial event
  });

  it("returns ok=false when archive path is malformed (no .archive segment)", async () => {
    const bogusPath = ".fabric/other/decisions/KT-D-0007--x.md";
    const result = await unarchiveKnowledge(projectRoot, bogusPath);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cannot derive type/);
  });
});
