import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { fabricConfigSchema } from "../../src/schemas/fabric-config.js";
import {
  cleanupTestWall,
  cloneRepo,
  createFakeBareRemote,
  createIsolatedHome,
  seedAndPush,
  setProjectRoot,
  twoClientConfigFixtures,
} from "../helpers/test-wall.js";

// v2.1.0-rc.1 P0.5 — test-wall smoke (GREEN). Proves the isolation harness
// itself is executable on the main CI: isolated HOME scaffolds the v2.1 global
// layout, the fake bare remote round-trips a commit, and the three-client
// config fixtures parse against the schema. (The resolver golden assertions
// that ride on this wall are the separate `it.fails` red-suite — P0.6 turns
// them green.)

afterEach(() => {
  cleanupTestWall();
});

describe("P0.5 test wall — isolated HOME", () => {
  it("scaffolds the v2.1 global layout and sets FABRIC_HOME", () => {
    const home = createIsolatedHome();
    expect(process.env.FABRIC_HOME).toBe(home.home);
    expect(existsSync(home.storesRoot)).toBe(true);
    expect(existsSync(home.stateRoot)).toBe(true);
  });

  it("injects FABRIC_PROJECT_ROOT and restores it on cleanup", () => {
    const prior = process.env.FABRIC_PROJECT_ROOT;
    setProjectRoot("/home/u/work/projA");
    expect(process.env.FABRIC_PROJECT_ROOT).toBe("/home/u/work/projA");
    cleanupTestWall();
    expect(process.env.FABRIC_PROJECT_ROOT).toBe(prior);
  });
});

describe("P0.5 test wall — fake bare remote", () => {
  it("round-trips a commit through a local bare remote", () => {
    const remote = createFakeBareRemote();
    const work = cloneRepo(remote);
    seedAndPush(work, "knowledge/decisions/KT-DEC-0001.md", "# hi\n");

    const fresh = cloneRepo(remote);
    const pulled = join(fresh, "knowledge/decisions/KT-DEC-0001.md");
    expect(existsSync(pulled)).toBe(true);
    expect(readFileSync(pulled, "utf8")).toContain("# hi");
  });
});

describe("P0.5 test wall — two-client config fixtures", () => {
  it("parses each client fixture against fabricConfigSchema with v2.1 fields", () => {
    const fx = twoClientConfigFixtures();
    for (const cfg of [fx.claudeCode, fx.codexCLI]) {
      const parsed = fabricConfigSchema.parse(cfg);
      expect(parsed.project_id).toBe("11111111-1111-4111-8111-111111111111");
      expect(parsed.required_stores?.[0]?.id).toBe("team");
    }
  });
});
