/**
 * config-layering W3 (TASK-004): env > project > store > default cascade for the
 * two store-overridable HOOK knobs, wired via the single-owner
 * store-config-reader.cjs. Covers all THREE reader seams:
 *   - knowledge-hint-broad.cjs readBroadIndexBackstop  (broad_index_backstop)
 *   - knowledge-hint-broad.cjs readUnderseedThreshold  (underseed_node_threshold)
 *   - lib/hint-config.cjs       readUnderseedThreshold  (underseed, fabric-hint path)
 *
 * The STORE layer is reached through a written resolved-bindings snapshot (the
 * hook NEVER re-resolves stores). project always wins over store (C-004).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const broadHook = require(
  fileURLToPath(new URL("../templates/hooks/knowledge-hint-broad.cjs", import.meta.url)),
) as {
  readBroadIndexBackstop: (projectRoot: string) => number;
  readUnderseedThreshold: (projectRoot: string) => number;
};
const hintConfig = require(
  fileURLToPath(new URL("../templates/hooks/lib/hint-config.cjs", import.meta.url)),
) as {
  readUnderseedThreshold: (projectRoot: string) => number;
};
const configCache = require(
  fileURLToPath(new URL("../templates/hooks/lib/config-cache.cjs", import.meta.url)),
) as { clearConfigCache: () => void };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "33333333-3333-4333-8333-333333333333";

const dirs: string[] = [];
const TOUCHED_ENV = ["FABRIC_BROAD_INDEX_BACKSTOP", "FABRIC_UNDERSEED_NODE_THRESHOLD", "FABRIC_HOME"] as const;
const envSnapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of TOUCHED_ENV) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
  const home = mkdtempSync(join(tmpdir(), "fabric-store-cascade-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
  configCache.clearConfigCache();
});

afterEach(() => {
  for (const key of TOUCHED_ENV) {
    const prior = envSnapshot[key];
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  configCache.clearConfigCache();
});

// Build a bound repo + optional store-config.json at a resolved TEAM store root,
// plus a resolved-bindings snapshot pointing the write target at that root.
function setup(opts: { projectKnobs?: object; storeConfig?: object | string | null }): string {
  const home = process.env.FABRIC_HOME as string;
  const projectRoot = mkdtempSync(join(tmpdir(), "fabric-store-cascade-proj-"));
  dirs.push(projectRoot);
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: PROJECT_ID, ...(opts.projectKnobs ?? {}) }, null, 2),
  );

  // Two store roots; the team root carries the optional store-config.json.
  const personalRoot = join(home, ".fabric", "stores", "personal", "p");
  const teamRoot = join(home, ".fabric", "stores", "team", "t");
  mkdirSync(teamRoot, { recursive: true });
  mkdirSync(personalRoot, { recursive: true });
  if (opts.storeConfig !== null && opts.storeConfig !== undefined) {
    writeFileSync(
      join(teamRoot, "store-config.json"),
      typeof opts.storeConfig === "string" ? opts.storeConfig : JSON.stringify(opts.storeConfig, null, 2),
    );
  }

  // Resolved-bindings snapshot: knowledge_store_dirs[i] ↔ read_set.stores[i].
  const snapshotDir = join(home, ".fabric", "state", "bindings");
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(
    join(snapshotDir, `${PROJECT_ID}_resolved.json`),
    JSON.stringify({
      version: 1,
      project_id: PROJECT_ID,
      workspace_binding_id: PROJECT_ID,
      generated_at: "2026-07-20T00:00:00.000Z",
      read_set: {
        stores: [
          { store_uuid: PERSONAL, alias: "personal", writable: true },
          { store_uuid: TEAM, alias: "team", writable: true },
        ],
        warnings: [],
      },
      write_target: { store_uuid: TEAM, alias: "team" },
      knowledge_store_dirs: [personalRoot, teamRoot],
    }),
  );
  return projectRoot;
}

describe("readBroadIndexBackstop — env > project > store > default (20..500)", () => {
  it("env-only wins", () => {
    process.env.FABRIC_BROAD_INDEX_BACKSTOP = "120";
    expect(broadHook.readBroadIndexBackstop(setup({}))).toBe(120);
  });
  it("project-only", () => {
    expect(broadHook.readBroadIndexBackstop(setup({ projectKnobs: { broad_index_backstop: 80 } }))).toBe(80);
  });
  it("store-only", () => {
    expect(broadHook.readBroadIndexBackstop(setup({ storeConfig: { broad_index_backstop: 40 } }))).toBe(40);
  });
  it("env beats project", () => {
    process.env.FABRIC_BROAD_INDEX_BACKSTOP = "120";
    expect(
      broadHook.readBroadIndexBackstop(setup({ projectKnobs: { broad_index_backstop: 80 } })),
    ).toBe(120);
  });
  it("project beats store (C-004)", () => {
    expect(
      broadHook.readBroadIndexBackstop(
        setup({ projectKnobs: { broad_index_backstop: 80 }, storeConfig: { broad_index_backstop: 40 } }),
      ),
    ).toBe(80);
  });
  it("full fallthrough → default 50", () => {
    expect(broadHook.readBroadIndexBackstop(setup({}))).toBe(50);
  });
  it("malformed store JSON falls through to default (never throws)", () => {
    expect(broadHook.readBroadIndexBackstop(setup({ storeConfig: "{ not json" }))).toBe(50);
  });
  it("out-of-range store value falls through to default", () => {
    expect(broadHook.readBroadIndexBackstop(setup({ storeConfig: { broad_index_backstop: 5 } }))).toBe(50);
  });
});

describe("readUnderseedThreshold (knowledge-hint-broad) — env > project > store > default", () => {
  it("env-only wins", () => {
    process.env.FABRIC_UNDERSEED_NODE_THRESHOLD = "7";
    expect(broadHook.readUnderseedThreshold(setup({}))).toBe(7);
  });
  it("project-only", () => {
    expect(broadHook.readUnderseedThreshold(setup({ projectKnobs: { underseed_node_threshold: 4 } }))).toBe(4);
  });
  it("store-only", () => {
    expect(broadHook.readUnderseedThreshold(setup({ storeConfig: { underseed_node_threshold: 3 } }))).toBe(3);
  });
  it("project beats store (C-004)", () => {
    expect(
      broadHook.readUnderseedThreshold(
        setup({ projectKnobs: { underseed_node_threshold: 4 }, storeConfig: { underseed_node_threshold: 3 } }),
      ),
    ).toBe(4);
  });
  it("full fallthrough → default 10", () => {
    expect(broadHook.readUnderseedThreshold(setup({}))).toBe(10);
  });
});

describe("readUnderseedThreshold (hint-config, fabric-hint path) — env > project > store > default", () => {
  it("env-only wins", () => {
    process.env.FABRIC_UNDERSEED_NODE_THRESHOLD = "9";
    expect(hintConfig.readUnderseedThreshold(setup({}))).toBe(9);
  });
  it("project-only", () => {
    expect(hintConfig.readUnderseedThreshold(setup({ projectKnobs: { underseed_node_threshold: 6 } }))).toBe(6);
  });
  it("store-only", () => {
    expect(hintConfig.readUnderseedThreshold(setup({ storeConfig: { underseed_node_threshold: 2 } }))).toBe(2);
  });
  it("project beats store (C-004)", () => {
    expect(
      hintConfig.readUnderseedThreshold(
        setup({ projectKnobs: { underseed_node_threshold: 6 }, storeConfig: { underseed_node_threshold: 2 } }),
      ),
    ).toBe(6);
  });
  it("full fallthrough → default 10", () => {
    expect(hintConfig.readUnderseedThreshold(setup({}))).toBe(10);
  });
});
