import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

const DEAD_MATURITY_ASSIGN =
  /maturity\s*[:=]\s*["']?(stable|endorsed)["']?/iu;
// Comments that document retirement of dead aliases are allowed; live z.enum /
// assignment of stable|endorsed as maturity values are not.
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#)/u;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "coverage") continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walkTsFiles(abs, out);
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".mts")) {
      out.push(abs);
    }
  }
  return out;
}

describe("knowledge enum census (KT-DEC-0005)", () => {
  it("knowledge_type is exactly the 5 canonical types", () => {
    expect([...KnowledgeTypeSchema.options].sort()).toEqual(
      ["decisions", "guidelines", "models", "pitfalls", "processes"],
    );
  });

  it("maturity is exactly the 3 canonical levels (no stable/endorsed aliases)", () => {
    expect([...MaturitySchema.options].sort()).toEqual(["draft", "proven", "verified"]);
    expect(MaturitySchema.options).not.toContain("stable");
    expect(MaturitySchema.options).not.toContain("endorsed");
  });

  it("layer is exactly the 2 canonical layers", () => {
    expect([...LayerSchema.options].sort()).toEqual(["personal", "team"]);
  });

  it("live packages/**/src do not assign maturity: stable|endorsed (dead vocab gate)", () => {
    const packagesRoot = fileURLToPath(new URL("../../..", import.meta.url));
    // packages/shared/src/schemas → packages/
    const monorepoPackages = join(packagesRoot, "..");
    const hits: string[] = [];
    for (const pkg of ["shared", "cli", "server"]) {
      const src = join(monorepoPackages, pkg, "src");
      let files: string[] = [];
      try {
        files = walkTsFiles(src);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.includes(`${join("schemas", "knowledge-enum-census")}`)) continue;
        const lines = readFileSync(file, "utf8").split(/\r?\n/u);
        lines.forEach((line, idx) => {
          if (COMMENT_LINE.test(line)) return;
          if (!DEAD_MATURITY_ASSIGN.test(line)) return;
          hits.push(`${file}:${idx + 1}:${line.trim()}`);
        });
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
