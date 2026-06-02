import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePath,
} from "@fenglimg/fabric-shared";

import { planContext } from "./plan-context.js";
import { contextCache } from "../cache.js";

// v2.1 global-refactor (W1-T1): proves the cross-store read-side wiring — a
// mounted store's knowledge surfaces as a recall candidate, store-qualified.
// Mirrors plan-context.test.ts's FABRIC_HOME isolation so the developer's real
// ~/.fabric never leaks into the fixture.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE_UUID = "11111111-1111-4111-8111-111111111111";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-cross-store-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createProjectWithEmptyMeta(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-cross-store-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "agents.meta.json"),
    `${JSON.stringify({ revision: "rev-empty", nodes: {} }, null, 2)}\n`,
  );
  return projectRoot;
}

// Seed a mounted store under the isolated ~/.fabric/stores/<uuid>/ with one
// knowledge entry, and register it in the global config.
async function seedTeamStore(): Promise<void> {
  const storeDir = join(resolveGlobalRoot(), storeRelativePath(TEAM_STORE_UUID));
  const decisionsDir = join(storeDir, STORE_LAYOUT.knowledgeDir, "decisions");
  await mkdir(decisionsDir, { recursive: true });
  await writeFile(
    join(decisionsDir, "KT-DEC-9001.md"),
    [
      "---",
      "id: KT-DEC-9001",
      "type: decision",
      "layer: team",
      "maturity: proven",
      "created_at: 2026-06-02T00:00:00.000Z",
      "---",
      "",
      "# Cross-store wiring proven decision",
      "",
      "Knowledge that lives in a mounted team store, not the project root.",
      "",
    ].join("\n"),
  );

  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      {
        store_uuid: TEAM_STORE_UUID,
        alias: "team",
        remote: "git@example.com:team-store.git",
      },
    ],
  });
}

describe("cross-store recall (W1-T1)", () => {
  it("surfaces a required team store's entry as a store-qualified candidate", async () => {
    const projectRoot = await createProjectWithEmptyMeta();
    await seedTeamStore();
    // Project declares the team store as required → it enters the read-set.
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);

    expect(ids).toContain("team:KT-DEC-9001");
  });

  it("does NOT surface a store entry the project did not require", async () => {
    const projectRoot = await createProjectWithEmptyMeta();
    await seedTeamStore();
    // No fabric-config.json → required_stores empty → team store not in read-set.

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);

    expect(ids).not.toContain("team:KT-DEC-9001");
  });

  it("degrades to project-only recall when no global config exists", async () => {
    const projectRoot = await createProjectWithEmptyMeta();
    // No global config written at all.
    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    expect(result.candidates.map((c) => c.stable_id)).not.toContain("team:KT-DEC-9001");
  });
});
