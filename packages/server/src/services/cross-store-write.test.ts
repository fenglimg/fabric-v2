import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  STORE_PENDING_DIR,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { extractKnowledge } from "./extract-knowledge.js";

// v2.1 global-refactor (W1-T2): proves the cross-store write-side wiring — when
// the project selects an active write store, fab_extract_knowledge routes the
// pending entry into THAT store's pending dir instead of the project .fabric.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE_UUID = "22222222-2222-4222-8222-222222222222";
const PLATFORM_STORE_UUID = "44444444-4444-4444-8444-444444444444";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-cross-write-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
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

async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-cross-write-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  return projectRoot;
}

function mountTeamStore(mountName?: string): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      {
        store_uuid: TEAM_STORE_UUID,
        alias: "team",
        ...(mountName === undefined ? {} : { mount_name: mountName }),
        remote: "git@example.com:team-store.git",
        writable: true,
      },
    ],
  });
}

function storePendingDir(type: string, mountName?: string, storeUuid = TEAM_STORE_UUID): string {
  return join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: storeUuid, mount_name: mountName }),
    STORE_LAYOUT.knowledgeDir,
    STORE_PENDING_DIR,
    type,
  );
}

const goodInput = {
  source_sessions: ["sess-write"],
  recent_paths: [] as string[],
  user_messages_summary: "Route team knowledge into the active write store per the global refactor.",
  type: "decisions" as const,
  slug: "store-routed-decision",
  layer: "team" as const,
  proposed_reason: "diagnostic-then-fix" as const,
  session_context: "Session goal: validate W1-T2 cross-store write routing into the active write store.",
};

describe("cross-store write (W1-T2)", () => {
  it("routes the pending entry into the active write store, not the project", async () => {
    const projectRoot = await createProject();
    mountTeamStore();
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }], active_write_store: "team" }, null, 2)}\n`,
    );

    const result = await extractKnowledge(projectRoot, goodInput);
    expect(result.pending_path).not.toBe("");

    // Landed in the STORE's pending dir...
    const storeDir = storePendingDir("decisions");
    expect(existsSync(storeDir)).toBe(true);
    expect(readdirSync(storeDir).some((f) => f.endsWith(".md"))).toBe(true);

    // ...and NOT in the project's dual-root pending dir.
    expect(existsSync(join(projectRoot, ".fabric", "knowledge", "pending", "decisions"))).toBe(false);
  });

  it("routes through default_write_store into the store's mount_name directory", async () => {
    const projectRoot = await createProject();
    mountTeamStore("platform-kb");
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }], default_write_store: "team" }, null, 2)}\n`,
    );

    const result = await extractKnowledge(projectRoot, goodInput);
    expect(result.pending_path).not.toBe("");

    const mountedDir = storePendingDir("decisions", "platform-kb");
    expect(existsSync(mountedDir)).toBe(true);
    expect(readdirSync(mountedDir).some((f) => f.endsWith(".md"))).toBe(true);
    expect(existsSync(storePendingDir("decisions"))).toBe(false);
  });

  it("honors project-scoped write_routes before the active write store", async () => {
    const projectRoot = await createProject();
    saveGlobalConfig({
      uid: "test-uid",
      stores: [
        {
          store_uuid: TEAM_STORE_UUID,
          alias: "team",
          remote: "git@example.com:team-store.git",
          writable: true,
        },
        {
          store_uuid: PLATFORM_STORE_UUID,
          alias: "platform",
          mount_name: "platform-kb",
          remote: "git@example.com:platform-store.git",
          writable: true,
        },
      ],
    });
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({
        required_stores: [{ id: "team" }, { id: "platform" }],
        active_write_store: "team",
        active_project: "fabric-v2",
        write_routes: [{ scope: "project:fabric-v2", store: "platform" }],
      }, null, 2)}\n`,
    );

    await extractKnowledge(projectRoot, goodInput);

    const platformDir = storePendingDir("decisions", "platform-kb", PLATFORM_STORE_UUID);
    expect(existsSync(platformDir)).toBe(true);
    const written = readdirSync(platformDir).find((f) => f.endsWith(".md"));
    expect(written).toBeDefined();
    const content = readFileSync(join(platformDir, written ?? ""), "utf8");
    expect(content).toMatch(/^semantic_scope: project:fabric-v2$/mu);
    expect(content).toMatch(/^visibility_store: "platform"$/mu);
    expect(existsSync(storePendingDir("decisions"))).toBe(false);
  });

  it("hard-fails (no dual-root fallback) when no active write store is selected", async () => {
    const projectRoot = await createProject();
    mountTeamStore();
    // required_stores present (read-set) but NO active_write_store → team
    // write-target resolves null → store-only write hard-fails (B2 cutover).
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
    );

    await expect(extractKnowledge(projectRoot, goodInput)).rejects.toThrow(/store-only/u);
    // Nothing leaked into the retired project dual-root pending dir.
    expect(existsSync(join(projectRoot, ".fabric", "knowledge", "pending", "decisions"))).toBe(false);
  });

  it("hard-fails (no dual-root fallback) when no global config exists", async () => {
    const projectRoot = await createProject();
    // No global config at all → no write-target store → store-only hard-fail.
    await expect(extractKnowledge(projectRoot, goodInput)).rejects.toThrow(/store-only/u);
    expect(existsSync(join(projectRoot, ".fabric", "knowledge", "pending", "decisions"))).toBe(false);
  });
});
