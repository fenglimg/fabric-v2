import { existsSync, lstatSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storeMountSubPath, storeRelativePathForMount } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { runGlobalInstall } from "../src/install/run-global-install.js";
import { storeAdd, storeCreate } from "../src/store/store-ops.js";
import {
  STORE_BY_ALIAS_DIR,
  detectAliasLinkDrift,
  storeRemove,
  syncStoreAliasLinks,
} from "../src/store/store-ops.js";

// v2.2 全砍 C3 — by-alias readability layer (UUID stays physical identity).

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(): Promise<string> {
  const globalRoot = join(mkdtempSync(join(tmpdir(), "fabric-alias-")), ".fabric");
  dirs.push(globalRoot);
  await runGlobalInstall(
    { uid: "u-x", personalStoreUuid: PERSONAL, now: "2026-01-01T00:00:00.000Z" },
    globalRoot,
  );
  return globalRoot;
}

function aliasLink(globalRoot: string, alias: string): string {
  return join(globalRoot, "stores", STORE_BY_ALIAS_DIR, alias);
}

function assertAliasLinkIfSupported(
  globalRoot: string,
  alias: string,
  store: { store_uuid: string; mount_name?: string; personal?: boolean },
): void {
  const sync = syncStoreAliasLinks(globalRoot);
  if (sync.errors.includes(alias)) {
    expect(existsSync(join(globalRoot, storeRelativePathForMount(store), "store.json"))).toBe(true);
    return;
  }
  const link = aliasLink(globalRoot, alias);
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readlinkSync(link)).toBe(join("..", storeMountSubPath(store)));
}

describe("store by-alias links (C3)", () => {
  it("storeCreate mints a mount_name dir and, when supported, a by-alias symlink", async () => {
    const globalRoot = await setup();
    await storeCreate("team", "2026-01-01T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });

    assertAliasLinkIfSupported(globalRoot, "team", { store_uuid: TEAM, mount_name: "team" });
    expect(existsSync(join(globalRoot, storeRelativePathForMount({ store_uuid: TEAM, mount_name: "team" }), "store.json"))).toBe(true);
  });

  it("install --global mints the personal store's by-alias link", async () => {
    const globalRoot = await setup();
    assertAliasLinkIfSupported(globalRoot, "personal", {
      store_uuid: PERSONAL,
      mount_name: "personal",
      personal: true,
    });
  });

  it("detectAliasLinkDrift flags a missing link and sync heals it", async () => {
    const globalRoot = await setup();
    await storeCreate("team", "2026-01-01T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });

    // Simulate drift: delete the link by hand.
    rmSync(aliasLink(globalRoot, "team"), { force: true });
    if (!existsSync(join(globalRoot, "stores", STORE_BY_ALIAS_DIR))) {
      expect(detectAliasLinkDrift(globalRoot)).toEqual([]);
      return;
    }
    expect(detectAliasLinkDrift(globalRoot)).toContain("team");

    const result = syncStoreAliasLinks(globalRoot);
    expect(result.created.includes("team") || result.errors.includes("team")).toBe(true);
    if (result.errors.includes("team")) {
      return;
    }
    expect(detectAliasLinkDrift(globalRoot)).not.toContain("team");
  });

  it("storeRemove drops the detached store's by-alias link", async () => {
    const globalRoot = await setup();
    await storeCreate("team", "2026-01-01T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });
    const sync = syncStoreAliasLinks(globalRoot);
    if (sync.errors.includes("team")) {
      expect(existsSync(join(globalRoot, storeRelativePathForMount({ store_uuid: TEAM, mount_name: "team" }), "store.json"))).toBe(true);
      return;
    }
    expect(existsSync(aliasLink(globalRoot, "team"))).toBe(true);

    storeRemove("team", globalRoot);
    expect(existsSync(aliasLink(globalRoot, "team"))).toBe(false);
  });

  it("sync removes a stale link whose alias is no longer mounted", async () => {
    const globalRoot = await setup();
    await storeCreate("team", "2026-01-01T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });
    // Hand-create a stale link for an alias not in the registry.
    const { symlinkSync } = await import("node:fs");
    try {
      symlinkSync(join("..", "team"), aliasLink(globalRoot, "ghost"));
    } catch {
      expect(existsSync(join(globalRoot, storeRelativePathForMount({ store_uuid: TEAM, mount_name: "team" }), "store.json"))).toBe(true);
      return;
    }

    const result = syncStoreAliasLinks(globalRoot);
    expect(result.removed).toContain("ghost");
    expect(existsSync(aliasLink(globalRoot, "ghost"))).toBe(false);
  });

  it("rejects path-traversal aliases before by-alias reconciliation", async () => {
    const globalRoot = await setup();

    expect(() => storeAdd({ store_uuid: TEAM, alias: "../escape" }, globalRoot)).toThrow(
      /store alias/,
    );
    expect(existsSync(join(globalRoot, "escape"))).toBe(false);
    expect(existsSync(join(globalRoot, "stores", STORE_BY_ALIAS_DIR, "..", "escape"))).toBe(false);
  });
});
