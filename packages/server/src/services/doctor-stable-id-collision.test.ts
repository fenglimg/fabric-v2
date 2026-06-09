import { describe, expect, it } from "vitest";

import { createTranslator } from "@fenglimg/fabric-shared";

import {
  createLayerMismatchCheck,
  createStableIdCollisionCheck,
  createStableIdDuplicateCheck,
  type StableIdCollisionInspection,
} from "./doctor-stable-id-collision.js";

describe("createStableIdCollisionCheck", () => {
  const t = createTranslator("en");

  it("renders ok when no stable_id collision exists", () => {
    const check = createStableIdCollisionCheck(t, { collisions: [] });

    expect(check.status).toBe("ok");
    expect(check.kind).toBeUndefined();
    expect(check.code).toBeUndefined();
  });

  it("renders stable_id collisions as warnings", () => {
    const inspection: StableIdCollisionInspection = {
      collisions: [
        {
          stable_id: "KT-DEC-0001",
          files: ["knowledge/decisions/a.md", "knowledge/decisions/b.md"],
        },
      ],
    };

    const check = createStableIdCollisionCheck(t, inspection);

    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
    expect(check.code).toBe("stable_id_collision");
    expect(check.fixable).toBe(false);
    expect(check.message).toContain("KT-DEC-0001");
    expect(check.message).toContain("knowledge/decisions/a.md");
    expect(check.actionHint).toContain("frontmatter");
    expect(check.actionHint).toContain("counters");
  });
});

describe("createStableIdDuplicateCheck", () => {
  const t = createTranslator("en");

  it("renders duplicate stable ids as manual errors", () => {
    const check = createStableIdDuplicateCheck(t, {
      duplicates: [
        {
          stable_id: "KT-PIT-0007",
          paths: ["knowledge/pitfalls/a.md", "knowledge/pitfalls/b.md"],
        },
      ],
    });

    expect(check.status).toBe("error");
    expect(check.kind).toBe("manual_error");
    expect(check.code).toBe("knowledge_stable_id_duplicate");
    expect(check.fixable).toBe(false);
    expect(check.message).toContain("KT-PIT-0007");
    expect(check.message).toContain("knowledge/pitfalls/a.md");
  });
});

describe("createLayerMismatchCheck", () => {
  const t = createTranslator("en");

  it("renders layer mismatches as manual errors", () => {
    const check = createLayerMismatchCheck(t, {
      mismatches: [
        {
          stable_id: "KP-DEC-0003",
          path: ".fabric/knowledge/decisions/KP-DEC-0003.md",
          located_in: "team",
          expected_layer: "personal",
        },
      ],
    });

    expect(check.status).toBe("error");
    expect(check.kind).toBe("manual_error");
    expect(check.code).toBe("knowledge_layer_mismatch");
    expect(check.fixable).toBe(false);
    expect(check.message).toContain("KP-DEC-0003");
    expect(check.message).toContain("located in team");
    expect(check.message).toContain("expected personal");
  });
});
