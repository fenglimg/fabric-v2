/**
 * config-layering W3 (TASK-006): idempotent store-config.json seed in store-ops.
 *
 * Every store init scaffolds a schema-valid `store-config.json` at the store ROOT
 * (parallel to store.json) so a team has an obvious committed home for the
 * store-overridable corpus knobs. The sync path (initStoreSync) seeds BEFORE
 * store.json (identity-last invariant preserved); the async path (initStore core)
 * seeds AFTER. Idempotent: an existing store-config.json is never overwritten.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  globalConfigSchema,
  storeConfigSchema,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { saveGlobalConfig } from "../src/store/global-config-io.js";
import { storeCreate } from "../src/store/store-ops.js";

const UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const dirs: string[] = [];
let globalRoot: string;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "fabric-store-seed-"));
  dirs.push(home);
  globalRoot = join(home, ".fabric");
  saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test" }), globalRoot);
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function storeConfigPath(storeDir: string): string {
  return join(storeDir, STORE_LAYOUT.configFile);
}

describe("seedStoreConfig via storeCreate", () => {
  it("sync init (git:false) seeds a schema-valid store-config.json, store.json written LAST", async () => {
    const result = await storeCreate("team", "2026-05-30T00:00:00.000Z", {
      uuid: UUID,
      git: false,
      globalRoot,
    });
    const cfgPath = storeConfigPath(result.storeDir);
    const storeJson = join(result.storeDir, STORE_LAYOUT.identityFile);
    expect(existsSync(cfgPath)).toBe(true);
    // Schema-valid (read-tolerant) — the seed passes storeConfigSchema.
    const parsed = storeConfigSchema.safeParse(JSON.parse(readFileSync(cfgPath, "utf8")));
    expect(parsed.success).toBe(true);
    // Identity-last invariant: store.json is written AFTER the seed.
    expect(statSync(storeJson).mtimeMs).toBeGreaterThanOrEqual(statSync(cfgPath).mtimeMs);
  });

  it("is idempotent — an existing store-config.json is never overwritten", async () => {
    // Pre-create the exact storeDir with a sentinel store-config.json (no store.json).
    const storeDir = join(globalRoot, storeRelativePathForMount({ store_uuid: UUID, mount_name: "team" }));
    mkdirSync(storeDir, { recursive: true });
    const cfgPath = storeConfigPath(storeDir);
    const sentinel = `${JSON.stringify({ embed_model: "fast-multilingual-e5-large" }, null, 2)}\n`;
    writeFileSync(cfgPath, sentinel, "utf8");

    await storeCreate("team", "2026-05-30T00:00:00.000Z", { uuid: UUID, git: false, globalRoot });

    // The pre-existing store-config is preserved verbatim; store.json now exists.
    expect(readFileSync(cfgPath, "utf8")).toBe(sentinel);
    expect(existsSync(join(storeDir, STORE_LAYOUT.identityFile))).toBe(true);
  });

  it("async init (git:true) also seeds a schema-valid store-config.json", async () => {
    const result = await storeCreate("team", "2026-05-30T00:00:00.000Z", {
      uuid: UUID,
      git: true,
      globalRoot,
    });
    const cfgPath = storeConfigPath(result.storeDir);
    expect(existsSync(cfgPath)).toBe(true);
    const parsed = storeConfigSchema.safeParse(JSON.parse(readFileSync(cfgPath, "utf8")));
    expect(parsed.success).toBe(true);
  });
});
