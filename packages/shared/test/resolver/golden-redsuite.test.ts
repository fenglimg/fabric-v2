import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  projectRootGoldenFileSchema,
  readSetGoldenFileSchema,
} from "../../src/resolver/contracts.js";
import { createProjectRootResolver } from "../../src/resolver/project-root-resolver.js";
import { recognizeStoreDir } from "../../src/resolver/store-disk-reader.js";
import { createStoreResolver } from "../../src/resolver/store-resolver.js";
import { cleanupTestWall, createLegacyInRepoLayout } from "../helpers/test-wall.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0.5 — RED-SUITE (xfail). Every case here is `it.fails`: the
// resolver / disk-reader STUBS throw NotImplemented, so each test currently
// PASSES-as-expected-failure and does NOT break the main CI ("主 CI 只验证测试
// 墙本身可执行, xfail 不计失败"). P0.6 implements the resolvers and P1 the disk
// reader; at that point these assertions start passing for real, `it.fails`
// inverts to a failure, and the implementer removes `.fails` — the TDD ratchet.
//
// The golden EXPECTED VALUES live in resolver/golden/*.json (authored in P0).
// ---------------------------------------------------------------------------

function readGolden(relative: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));
}

const projectRootGolden = projectRootGoldenFileSchema.parse(
  readGolden("../../src/resolver/golden/project-root.golden.json"),
);
const readSetGolden = readSetGoldenFileSchema.parse(
  readGolden("../../src/resolver/golden/read-set.golden.json"),
);

afterEach(() => {
  cleanupTestWall();
});

describe("P0.5 red-suite — ProjectRootResolver golden (xfail until P0.6)", () => {
  for (const c of projectRootGolden.cases) {
    it.fails(`project-root: ${c.name}`, () => {
      const got = createProjectRootResolver().resolve(c.signals);
      expect(got).toEqual(c.expected);
    });
  }
});

describe("P0.5 red-suite — StoreResolver golden (xfail until P0.6)", () => {
  for (const c of readSetGolden.cases) {
    it.fails(`read-set: ${c.name}`, () => {
      const resolver = createStoreResolver();
      expect(resolver.resolveReadSet(c.input)).toEqual(c.expected.readSet);
      const wt = resolver.resolveWriteTarget(c.input, c.writeScope);
      expect(wt.target).toEqual(c.expected.writeTarget);
      expect(wt.warnings).toEqual(c.expected.writeWarnings);
    });
  }
});

describe("P0.5 red-suite — clean-slate legacy negative (xfail until P1)", () => {
  it.fails("legacy in-repo .fabric/knowledge is NOT recognized as a v2.1 store", () => {
    const legacyFabricDir = createLegacyInRepoLayout();
    // v2.1 reader recognizes a store only by store.json; legacy layout has none.
    expect(recognizeStoreDir(legacyFabricDir)).toBe(false);
  });
});
