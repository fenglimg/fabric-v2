import { describe, expect, it } from "vitest";

import { KnowledgeTypeSchema, MaturitySchema, LayerSchema } from "./api-contracts.js";

// ---------------------------------------------------------------------------
// layer / type / maturity census invariant — KT-DEC-0005 schema contract gate
// (fallback-purge Wave 0, G-INVARIANT).
//
// The 5-type / 3-maturity / 2-layer enum set is the spine of the KB schema and
// is consumed by dynamically-computed keys (cite-coverage `contract.type.<t>`,
// doctor checks, i18n labels). A deletion pass that trims a "maturity alias" or
// a config loader could silently widen or narrow one of these enums; a literal
// grep would not flag it. This census pins the canonical sets so any change to
// the authoritative schema fails here first.
// ---------------------------------------------------------------------------

describe("knowledge enum census (KT-DEC-0005)", () => {
  it("knowledge_type is exactly the 5 canonical types", () => {
    expect([...KnowledgeTypeSchema.options].sort()).toEqual(
      ["decisions", "guidelines", "models", "pitfalls", "processes"],
    );
  });

  it("maturity is exactly the 3 canonical levels (no stable/endorsed aliases)", () => {
    expect([...MaturitySchema.options].sort()).toEqual(["draft", "proven", "verified"]);
  });

  it("layer is exactly the 2 canonical layers", () => {
    expect([...LayerSchema.options].sort()).toEqual(["personal", "team"]);
  });
});
