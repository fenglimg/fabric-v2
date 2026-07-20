// config-layering W3 (TASK-004): ROUND-TRIP parity — the hook's SSOT store-layer
// reader (packages/cli/templates/hooks/lib/store-config-reader.cjs) must agree
// with the server's config-loader.resolveStoreConfig store-layer semantics for
// the two hook knobs (broad_index_backstop / underseed_node_threshold), so a
// team store-config.json shapes recall (server) and the SessionStart HUD (hook)
// IDENTICALLY. Same fixtures, same resolved TEAM store ROOT, both readers.

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveGlobalConfig } from "@fenglimg/fabric-shared";

import { resolveStoreConfig } from "./config-loader.js";
import { resolveWriteTargetStoreDir } from "./services/cross-store-write.js";

const require = createRequire(import.meta.url);
const storeConfigReader = require(
  "../../cli/templates/hooks/lib/store-config-reader.cjs",
) as {
  readStoreConfigNumber: (
    storeRoot: string,
    key: string,
    opts: { min?: number; max?: number },
  ) => number | undefined;
};

const TEAM = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "33333333-3333-4333-8333-333333333333";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-parity-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

function mountStores(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
      { store_uuid: TEAM, alias: "team", remote: "git@e:t.git", writable: true },
    ],
  });
}

// A repo bound to the team store, with a store-config.json written at the resolved
// team store ROOT (parallel to store.json). Returns { projectRoot, storeRoot }.
async function makeRepo(storeConfig: object | string): Promise<{ projectRoot: string; storeRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-parity-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }], active_write_store: "team" }, null, 2)}\n`,
  );
  mountStores();
  const storeRoot = resolveWriteTargetStoreDir("team", projectRoot);
  await mkdir(storeRoot, { recursive: true });
  await writeFile(
    join(storeRoot, "store-config.json"),
    typeof storeConfig === "string" ? storeConfig : `${JSON.stringify(storeConfig, null, 2)}\n`,
  );
  return { projectRoot, storeRoot };
}

// Per-knob store-layer read range mirroring storeConfigSchema's per-field bounds.
const KNOBS: Array<{ key: string; range: { min?: number; max?: number } }> = [
  { key: "broad_index_backstop", range: { min: 20, max: 500 } },
  { key: "underseed_node_threshold", range: { min: 1 } },
];

// Fixtures: single-knob (or all-valid) store-config bodies so the parity holds at
// the SAME granularity the hook reads (per-field). Each knob is validated in
// isolation across valid / out-of-range / non-integer / malformed cases.
const FIXTURES: Array<{ name: string; storeConfig: object | string }> = [
  { name: "store-only valid backstop", storeConfig: { broad_index_backstop: 100 } },
  { name: "store-only valid underseed", storeConfig: { underseed_node_threshold: 3 } },
  { name: "both knobs valid", storeConfig: { broad_index_backstop: 250, underseed_node_threshold: 8 } },
  { name: "backstop below min (20)", storeConfig: { broad_index_backstop: 5 } },
  { name: "backstop above max (500)", storeConfig: { broad_index_backstop: 999 } },
  { name: "backstop non-integer", storeConfig: { broad_index_backstop: 100.5 } },
  { name: "underseed non-positive", storeConfig: { underseed_node_threshold: 0 } },
  { name: "underseed non-integer", storeConfig: { underseed_node_threshold: 4.5 } },
  { name: "malformed store JSON", storeConfig: "{ not json" },
  { name: "empty store config", storeConfig: {} },
];

describe("store-config-reader.cjs ↔ config-loader.resolveStoreConfig parity (both knobs)", () => {
  for (const fixture of FIXTURES) {
    it(`agrees on both knobs — ${fixture.name}`, async () => {
      const { projectRoot, storeRoot } = await makeRepo(fixture.storeConfig);
      // config-loader canon: whole-object schema parse (invalid field → {}).
      const canon = resolveStoreConfig(projectRoot) as Record<string, number | undefined>;
      for (const { key, range } of KNOBS) {
        const canonVal = canon[key];
        const cjsVal = storeConfigReader.readStoreConfigNumber(storeRoot, key, range);
        expect(cjsVal).toBe(canonVal);
      }
    });
  }
});
