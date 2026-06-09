import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { runDoctorApplyLint, runDoctorReport } from "./doctor.js";

const tempRoots: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "doctor-store-only-home-"));
  tempRoots.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "doctor-store-only-project-"));
  tempRoots.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  return projectRoot;
}

describe("doctor store-only cutover", () => {
  it("ignores retired project-local canonical roots for stable_id collision checks", async () => {
    const projectRoot = await createTempProject();
    const decisionsRoot = join(projectRoot, ".fabric", "knowledge", "decisions");
    await mkdir(decisionsRoot, { recursive: true });
    for (const filename of ["a.md", "b.md"]) {
      await writeFile(
        join(decisionsRoot, filename),
        "---\nid: KT-DEC-0001\ntype: decision\nlayer: team\nmaturity: draft\n---\n# Local legacy entry\n",
        "utf8",
      );
    }

    const report = await runDoctorReport(projectRoot);

    expect(report.warnings.map((warning) => warning.code)).not.toContain("stable_id_collision");
  });

  it("does not backfill retired project-local pending relevance fields", async () => {
    const projectRoot = await createTempProject();
    const pendingPath = join(
      projectRoot,
      ".fabric",
      "knowledge",
      "pending",
      "decisions",
      "needs-backfill.md",
    );
    await mkdir(join(pendingPath, ".."), { recursive: true });
    await writeFile(
      pendingPath,
      "---\ntype: decision\nlayer: team\nmaturity: draft\n---\n# Needs Backfill\nBody.\n",
      "utf8",
    );

    const result = await runDoctorApplyLint(projectRoot);
    const written = await readFile(pendingPath, "utf8");
    const { events } = await readEventLedger(projectRoot, { event_type: "relevance_migration_run" });

    expect(result.mutations.map((mutation) => mutation.kind)).not.toContain(
      "knowledge_relevance_fields_missing",
    );
    expect(written).not.toMatch(/^relevance_scope:/mu);
    expect(written).not.toMatch(/^relevance_paths:/mu);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "relevance_migration_run",
      scanned_count: 0,
      touched_count: 0,
    });
  });
});
