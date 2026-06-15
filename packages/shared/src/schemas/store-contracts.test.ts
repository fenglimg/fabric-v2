import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  projectRootGoldenFileSchema,
  readSetGoldenFileSchema,
} from "../resolver/contracts.js";
import { parityMatrixSchema } from "./parity-matrix.js";
import { entryScopeMetadataSchema, isPersonalScope, scopeCoordinateSchema } from "./scope.js";
import {
  formatGlobalRef,
  globalRefSchema,
  parseGlobalRef,
} from "./store-stable-id.js";
import {
  globalConfigSchema,
  mountedStoreSchema,
  requiredStoreEntrySchema,
  storeIdentitySchema,
} from "./store.js";

// v2.1.0-rc.1 P0 — contract-layer tests. These validate the DEFINITION layer
// only (schemas compile + stub/golden data parse). The resolver behavior these
// golden fixtures describe is asserted as an xfail/red-suite in P0.5 and turned
// green in P0.6 — NOT here.

function readJson(relativeToThisFile: string): unknown {
  const url = new URL(relativeToThisFile, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

describe("P0 store/scope/id schemas", () => {
  it("accepts a canonical store identity and rejects a non-UUID", () => {
    expect(() =>
      storeIdentitySchema.parse({
        store_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        created_at: "2026-05-30T00:00:00.000Z",
        canonical_alias: "team",
        allowed_scopes: ["team", "project:fabric-v2"],
      }),
    ).not.toThrow();

    expect(() =>
      storeIdentitySchema.parse({ store_uuid: "not-a-uuid", created_at: "x" }),
    ).toThrow();
  });

  it("rejects store aliases that are not safe path segments", () => {
    expect(() =>
      mountedStoreSchema.parse({
        store_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        alias: "team.platform-1",
      }),
    ).not.toThrow();

    for (const alias of ["", ".", "..", "../escape", "team/escape", "team\\escape"]) {
      expect(() =>
        mountedStoreSchema.parse({
          store_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          alias,
        }),
      ).toThrow();
      expect(() =>
        storeIdentitySchema.parse({
          store_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          created_at: "2026-05-30T00:00:00.000Z",
          canonical_alias: alias,
        }),
      ).toThrow();
    }
  });

  it("accepts required_store entries including the $personal sentinel", () => {
    expect(() => requiredStoreEntrySchema.parse({ id: "team", suggested_remote: "git@h:r.git" })).not.toThrow();
    expect(() => requiredStoreEntrySchema.parse({ id: "p", suggested_remote: "$personal" })).not.toThrow();
    expect(() => requiredStoreEntrySchema.parse({ id: "" })).toThrow();
  });

  it("applies global config defaults and types uid", () => {
    const parsed = globalConfigSchema.parse({ uid: "u-abc123" });
    expect(parsed.stores).toEqual([]);
  });

  it("validates open scope coordinates and flags the personal axis", () => {
    expect(() => scopeCoordinateSchema.parse("org:acme:team:platform")).not.toThrow();
    expect(() => scopeCoordinateSchema.parse("Bad Scope")).toThrow();
    expect(isPersonalScope("personal")).toBe(true);
    expect(isPersonalScope("team")).toBe(false);
    expect(() =>
      entryScopeMetadataSchema.parse({ semantic_scope: "team", visibility_store: "team" }),
    ).not.toThrow();
  });

  it("round-trips global_ref for shared and personal entries", () => {
    const shared = formatGlobalRef({
      store_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      local_id: "KT-DEC-0001",
    });
    expect(globalRefSchema.safeParse(shared).success).toBe(true);
    expect(parseGlobalRef(shared)).toEqual({
      store_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      local_id: "KT-DEC-0001",
    });

    const personal = formatGlobalRef({
      store_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      uid: "u-abc123",
      local_id: "KP-PIT-0007",
    });
    expect(globalRefSchema.safeParse(personal).success).toBe(true);
    expect(parseGlobalRef(personal)).toEqual({
      store_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      uid: "u-abc123",
      local_id: "KP-PIT-0007",
    });

    expect(parseGlobalRef("garbage")).toBeNull();
  });
});

describe("P0 parity-matrix stub", () => {
  it("parses parity-matrix.json against parityMatrixSchema with both clients per row", () => {
    const matrix = parityMatrixSchema.parse(readJson("../parity/parity-matrix.json"));
    expect(matrix.capabilities.length).toBeGreaterThan(0);
    for (const cap of matrix.capabilities) {
      expect(cap.clients.claudeCode).toBeDefined();
      expect(cap.clients.codexCLI).toBeDefined();
    }
  });
});

describe("P0 resolver golden fixtures", () => {
  it("parses project-root.golden.json against its meta-schema", () => {
    const file = projectRootGoldenFileSchema.parse(readJson("../resolver/golden/project-root.golden.json"));
    const signalsUsed = file.cases.map((c) => c.expected?.signalUsed).filter(Boolean);
    // All four signals must be exercised by at least one golden case.
    for (const sig of ["env", "marker", "cwd", "repo"]) {
      expect(signalsUsed).toContain(sig);
    }
  });

  it("parses read-set.golden.json against its meta-schema", () => {
    const file = readSetGoldenFileSchema.parse(readJson("../resolver/golden/read-set.golden.json"));
    expect(file.cases.length).toBeGreaterThan(0);
    // Every read-set must include the implicit personal store.
    for (const c of file.cases) {
      const hasPersonal = c.expected.readSet.stores.some((s) => s.alias === "personal");
      expect(hasPersonal).toBe(true);
    }
  });
});
