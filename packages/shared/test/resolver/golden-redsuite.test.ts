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
import {
  cleanupTestWall,
  createLegacyInRepoLayout,
  createValidStoreDir,
} from "../helpers/test-wall.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 — Golden test-wall. The resolver suites are GREEN as of P0.6
// (the four-signal ProjectRootResolver + StoreResolver are implemented and
// asserted against the golden EXPECTED VALUES in resolver/golden/*.json).
//
// The legacy-negative case remains `it.fails` (xfail) until P1 implements the
// store disk reader (`recognizeStoreDir`) — at that point its assertion passes,
// `it.fails` inverts, and P1 removes `.fails` (the TDD ratchet).
//
// Warnings are compared by {code, ref} (the contract), not by message text
// (UX copy, i18n later) — so resolver wording can evolve without breaking the
// golden contract.
// ---------------------------------------------------------------------------

function warningKeys(
  warnings: ReadonlyArray<{ code: string; ref: string }>,
): Array<{ code: string; ref: string }> {
  return warnings.map((w) => ({ code: w.code, ref: w.ref }));
}

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

describe("ProjectRootResolver golden (P0.6 green)", () => {
  for (const c of projectRootGolden.cases) {
    it(`project-root: ${c.name}`, () => {
      const got = createProjectRootResolver().resolve(c.signals);
      expect(got).toEqual(c.expected);
    });
  }
});

describe("StoreResolver golden (P0.6 green)", () => {
  for (const c of readSetGolden.cases) {
    it(`read-set: ${c.name}`, () => {
      const resolver = createStoreResolver();
      const readSet = resolver.resolveReadSet(c.input);
      expect(readSet.stores).toEqual(c.expected.readSet.stores);
      expect(warningKeys(readSet.warnings)).toEqual(warningKeys(c.expected.readSet.warnings));

      const wt = resolver.resolveWriteTarget(c.input, c.writeScope);
      expect(wt.target).toEqual(c.expected.writeTarget);
      expect(warningKeys(wt.warnings)).toEqual(warningKeys(c.expected.writeWarnings));
    });
  }
});

describe("clean-slate legacy negative (P1 green)", () => {
  it("legacy in-repo .fabric/knowledge is NOT recognized as a v2.1 store", () => {
    const legacyFabricDir = createLegacyInRepoLayout();
    // v2.1 reader recognizes a store only by store.json; legacy layout has none.
    expect(recognizeStoreDir(legacyFabricDir)).toBe(false);
  });

  it("a directory with a valid store.json IS recognized", () => {
    const storeDir = createValidStoreDir();
    expect(recognizeStoreDir(storeDir)).toBe(true);
  });
});
