import { existsSync, lstatSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storeRelativePath } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { runGlobalInstall } from "../src/install/run-global-install.js";
import { storeCreate } from "../src/store/store-ops.js";
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

describe("store by-alias links (C3)", () => {
  it("storeCreate mints a by-alias symlink pointing at the uuid dir", async () => {
    const globalRoot = await setup();
    storeCreate("team", "2026-01-01T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });

    const link = aliasLink(globalRoot, "team");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join("..", TEAM));
    // The link resolves to the real uuid store dir.
    expect(existsSync(join(globalRoot, storeRelativePath(TEAM), "store.json"))).toBe(true);
  });

  it("install --global mints the personal store's by-alias link", async () => {
    const globalRoot = await setup();
    expect(lstatSync(aliasLink(globalRoot, "personal")).isSymbolicLink()).toBe(true);
  });

  it("detectAliasLinkDrift flags a missing link and sync heals it", async () => {
    const globalRoot = await setup();
    storeCreate("team", "2026-01-01T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });

    // Simulate drift: delete the link by hand.
    rmSync(aliasLink(globalRoot, "team"), { force: true });
    expect(detectAliasLinkDrift(globalRoot)).toContain("team");

    const result = syncStoreAliasLinks(globalRoot);
    expect(result.created).toContain("team");
    expect(detectAliasLinkDrift(globalRoot)).not.toContain("team");
  });

  it("storeRemove drops the detached store's by-alias link", async () => {
    const globalRoot = await setup();
    storeCreate("team", "2026-01-01T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });
    expect(existsSync(aliasLink(globalRoot, "team"))).toBe(true);

    storeRemove("team", globalRoot);
    expect(existsSync(aliasLink(globalRoot, "team"))).toBe(false);
  });

  it("sync removes a stale link whose alias is no longer mounted", async () => {
    const globalRoot = await setup();
    storeCreate("team", "2026-01-01T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });
    // Hand-create a stale link for an alias not in the registry.
    const { symlinkSync } = await import("node:fs");
    symlinkSync(join("..", TEAM), aliasLink(globalRoot, "ghost"));

    const result = syncStoreAliasLinks(globalRoot);
    expect(result.removed).toContain("ghost");
    expect(existsSync(aliasLink(globalRoot, "ghost"))).toBe(false);
  });
});
