import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveGlobalConfig } from "../src/store/global-config-io.js";
import { saveProjectConfig } from "../src/store/project-config-io.js";
import { scopeExplain } from "../src/store/scope-explain.js";

// v2.1.0-rc.1 P3 — scope-explain surfaces the resolver's read-set + write target
// (F5/S21/S53), assembled from the global + project configs.

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const dirs: string[] = [];
let globalRoot: string;
let projectRoot: string;

beforeEach(() => {
  const ghome = mkdtempSync(join(tmpdir(), "fabric-scope-g-"));
  dirs.push(ghome);
  globalRoot = join(ghome, ".fabric");
  saveGlobalConfig(
    globalConfigSchema.parse({
      uid: "u-me",
      stores: [
        { store_uuid: PERSONAL, alias: "personal", personal: true },
        { store_uuid: TEAM, alias: "team", remote: "git@h:team.git" },
      ],
    }),
    globalRoot,
  );
  projectRoot = mkdtempSync(join(tmpdir(), "fabric-scope-p-"));
  dirs.push(projectRoot);
  saveProjectConfig(
    {
      project_id: "11111111-1111-4111-8111-111111111111",
      required_stores: [{ id: "team" }],
      active_write_store: "team",
    },
    projectRoot,
  );
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("scope-explain", () => {
  it("team scope: read-set = team + personal, write target = team", () => {
    const result = scopeExplain(projectRoot, "team", globalRoot);
    expect(result?.readSet.stores.map((s) => s.alias).sort()).toEqual(["personal", "team"]);
    expect(result?.writeTarget?.alias).toBe("team");
  });

  it("personal scope: write target = personal store (R5#3)", () => {
    const result = scopeExplain(projectRoot, "personal", globalRoot);
    expect(result?.writeTarget?.alias).toBe("personal");
  });

  it("returns null without a global config", () => {
    const bare = join(mkdtempSync(join(tmpdir(), "fabric-scope-bare-")), ".fabric");
    dirs.push(bare);
    expect(scopeExplain(projectRoot, "team", bare)).toBeNull();
  });

  // v2.2 全砍 F21: malformed scope coordinates fail loudly instead of silently
  // resolving to a fallback target. Well-formed unknown coordinates stay valid
  // (S20 open-coordinate design).
  it("throws on a malformed scope coordinate (F21)", () => {
    expect(() => scopeExplain(projectRoot, "Team!", globalRoot)).toThrow(/invalid scope coordinate/u);
    expect(() => scopeExplain(projectRoot, "has space", globalRoot)).toThrow(/invalid scope coordinate/u);
  });

  it("accepts a well-formed unknown coordinate (S20 open coordinate)", () => {
    // org:acme:team:platform is not a KNOWN prefix but is grammatically valid.
    expect(() => scopeExplain(projectRoot, "org:acme:team:platform", globalRoot)).not.toThrow();
  });
});
