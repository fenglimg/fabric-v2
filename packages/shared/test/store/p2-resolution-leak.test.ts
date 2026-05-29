import { describe, expect, it } from "vitest";

import { knowledgeProvenanceSchema } from "../../src/schemas/provenance.js";
import { resolveCandidates } from "../../src/resolver/resolution.js";
import { resolveStoreQualifiedId } from "../../src/resolver/store-qualified-id.js";
import { lintCrossStoreReferences } from "../../src/store/cross-store-lint.js";
import { hasSecrets, scanForSecrets } from "../../src/store/secret-scan.js";

// v2.1.0-rc.1 P2 — resolution + write-path leak-prevention unit tests
// (including the required NEGATIVE tests for secret-scan and cross-store lint).

const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLATFORM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("P2 provenance schema", () => {
  it("validates a full store-qualified provenance envelope", () => {
    expect(() =>
      knowledgeProvenanceSchema.parse({
        store_uuid: TEAM,
        alias: "team",
        local_id: "KT-DEC-0001",
        global_ref: `${TEAM}:KT-DEC-0001`,
        semantic_scope: "team",
      }),
    ).not.toThrow();
  });
});

describe("P2 store-qualified id resolution (S61)", () => {
  const candidates = [
    { store_uuid: TEAM, alias: "team", local_id: "KT-DEC-0001" },
    { store_uuid: PLATFORM, alias: "platform", local_id: "KT-DEC-0001" },
    { store_uuid: PERSONAL, alias: "personal", local_id: "KP-PIT-0007" },
  ];

  it("resolves a store-qualified ref by alias", () => {
    const r = resolveStoreQualifiedId("platform:KT-DEC-0001", candidates);
    expect(r.resolved?.store_uuid).toBe(PLATFORM);
    expect(r.ambiguous).toBe(false);
  });

  it("resolves a unique bare id", () => {
    const r = resolveStoreQualifiedId("KP-PIT-0007", candidates);
    expect(r.resolved?.store_uuid).toBe(PERSONAL);
  });

  it("flags a shadowed bare id as ambiguous (NOT silently merged)", () => {
    const r = resolveStoreQualifiedId("KT-DEC-0001", candidates);
    expect(r.resolved).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.matches).toHaveLength(2);
  });
});

describe("P2 resolution engine (double-axis + tie-break)", () => {
  it("orders by scope specificity then store tie-break, surfaces shadowing", () => {
    const { resolved, warnings } = resolveCandidates(
      [
        { global_ref: `${TEAM}:KT-DEC-0001`, store_uuid: TEAM, alias: "team", local_id: "KT-DEC-0001", semantic_scope: "team" },
        { global_ref: `${PLATFORM}:KT-DEC-0001`, store_uuid: PLATFORM, alias: "platform", local_id: "KT-DEC-0001", semantic_scope: "project:fabric:auth" },
        // exact duplicate of the first — deduped.
        { global_ref: `${TEAM}:KT-DEC-0001`, store_uuid: TEAM, alias: "team", local_id: "KT-DEC-0001", semantic_scope: "team" },
      ],
      { storeOrder: [TEAM, PLATFORM] },
    );
    expect(resolved).toHaveLength(2); // dedup removed the exact dup, shadow kept
    // project:fabric:auth (specificity 3) outranks team (specificity 1)
    expect(resolved[0].alias).toBe("platform");
    expect(resolved[0].rank).toBe(0);
    expect(warnings.some((w) => w.code === "shadowed_local_id")).toBe(true);
  });

  it("does not silently degrade on an unavailable required store (F2)", () => {
    const { warnings } = resolveCandidates([], { unavailableRequiredStores: [PLATFORM] });
    expect(warnings).toEqual([
      expect.objectContaining({ code: "required_store_unavailable", ref: PLATFORM }),
    ]);
  });
});

describe("P2 secret-scan viability gate (S26) — negative tests", () => {
  it("BLOCKS content carrying an AWS key / private key / token", () => {
    expect(hasSecrets("aws_key = AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(hasSecrets("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(hasSecrets('password: "hunter2supersecret"')).toBe(true);
    const findings = scanForSecrets("line1\nghp_0123456789abcdefghijABCDEFGHIJ0123\n");
    expect(findings[0]).toEqual({ rule: "github-token", line: 2 });
  });

  it("PASSES clean knowledge content", () => {
    expect(hasSecrets("# Decision\n\nUse bcrypt cost=12 for password hashing.\n")).toBe(false);
  });
});

describe("P2 cross-store reference lint (S49) — negative tests", () => {
  const storeVisibility = { [TEAM]: "shared" as const, [PERSONAL]: "personal" as const };

  it("BLOCKS a shared-store entry referencing a personal-store id (R5#3)", () => {
    const violations = lintCrossStoreReferences({
      entryVisibility: "shared",
      referencedGlobalRefs: [`${PERSONAL}:u-abc:KP-PIT-0007`],
      storeVisibility,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("personal-ref-in-shared");
    expect(violations[0].to_store_uuid).toBe(PERSONAL);
  });

  it("ALLOWS shared→shared and personal→anywhere references", () => {
    expect(
      lintCrossStoreReferences({
        entryVisibility: "shared",
        referencedGlobalRefs: [`${TEAM}:KT-DEC-0001`],
        storeVisibility,
      }),
    ).toHaveLength(0);
    expect(
      lintCrossStoreReferences({
        entryVisibility: "personal",
        referencedGlobalRefs: [`${PERSONAL}:u-abc:KP-PIT-0007`],
        storeVisibility,
      }),
    ).toHaveLength(0);
  });
});
