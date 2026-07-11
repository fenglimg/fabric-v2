import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadGlobalConfig, saveGlobalConfig } from "../src/store/global-config-io.js";
import { personalStoreCandidates, storeSwitchPersonal } from "../src/store/store-ops.js";

// 语义 A (multi-personal): a machine may mount several `personal:true` stores and
// switch which is ACTIVE via the machine-wide globalConfig.active_personal_store.
// `personalStoreCandidates` feeds the install personal slot (active-first); the
// new `store switch-personal <alias>` verb writes the global pointer and refuses
// a non-personal target (switch-write stays team-only, untouched).

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const dirs: string[] = [];
let globalRoot: string;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "fabric-switch-personal-"));
  dirs.push(home);
  globalRoot = join(home, ".fabric");
  // Two personal stores (P1 mounted first) + one team store, no active pointer.
  saveGlobalConfig(
    globalConfigSchema.parse({
      uid: "u-test",
      stores: [
        { store_uuid: P1, alias: "personal", mount_name: "personal", personal: true },
        { store_uuid: P2, alias: "personal-work", mount_name: "personal-work", personal: true },
        { store_uuid: TEAM, alias: "team", mount_name: "team" },
      ],
    }),
    globalRoot,
  );
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("personalStoreCandidates", () => {
  it("returns only personal stores", () => {
    const got = personalStoreCandidates(globalRoot);
    expect(got.map((c) => c.alias).sort()).toEqual(["personal", "personal-work"]);
  });

  it("marks active and sorts it first", () => {
    saveGlobalConfig(
      { ...loadGlobalConfig(globalRoot)!, active_personal_store: "personal-work" },
      globalRoot,
    );
    const got = personalStoreCandidates(globalRoot);
    expect(got[0]).toMatchObject({ alias: "personal-work", active: true });
    expect(got.find((c) => c.alias === "personal")?.active).toBe(false);
  });

  it("with no active pointer, no candidate is active", () => {
    expect(personalStoreCandidates(globalRoot).every((c) => c.active === false)).toBe(true);
  });
});

describe("storeSwitchPersonal", () => {
  it("writes active_personal_store to the global config", async () => {
    await storeSwitchPersonal("personal-work", { globalRoot });
    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBe("personal-work");
  });

  it("accepts a store_uuid as well as an alias", async () => {
    await storeSwitchPersonal(P2, { globalRoot });
    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBe(P2);
  });

  it("refuses a non-personal (team) store", async () => {
    await expect(storeSwitchPersonal("team", { globalRoot })).rejects.toThrow(/personal/i);
    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBeUndefined();
  });

  it("refuses an unmounted alias", async () => {
    await expect(storeSwitchPersonal("nope", { globalRoot })).rejects.toThrow();
  });
});
