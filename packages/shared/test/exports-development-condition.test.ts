import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

// ux-w2-8: every subpath export MUST carry a `development` condition pointing at
// the matching `./src/*.ts`, ordered BEFORE `types`/`import`. Dev tooling (vitest
// via Vite's `development` condition, tsc via tsconfig `customConditions`) then
// resolves @fenglimg/fabric-shared straight from source, so a shared-schema edit
// is picked up WITHOUT a prior `pnpm --filter shared build`. This roots out the
// rc.21/24/29 stale-dist class (runtime invalid_union_discriminator / missing
// i18n keys). The published artifact has no `development` condition active, so it
// still resolves `import` → dist.
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
  exports: Record<string, Record<string, string>>;
};

describe("shared exports — development condition (ux-w2-8)", () => {
  it("every export subpath resolves to src via the development condition", () => {
    const offenders: string[] = [];
    for (const [subpath, conditions] of Object.entries(pkg.exports)) {
      const dev = conditions.development;
      if (!dev || !dev.startsWith("./src/") || !dev.endsWith(".ts")) {
        offenders.push(`${subpath} → ${dev ?? "(missing)"}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("development is ordered before types/import (Node picks it first in dev)", () => {
    const misordered: string[] = [];
    for (const [subpath, conditions] of Object.entries(pkg.exports)) {
      const keys = Object.keys(conditions);
      const devIdx = keys.indexOf("development");
      const typesIdx = keys.indexOf("types");
      const importIdx = keys.indexOf("import");
      if (devIdx !== 0 || (typesIdx !== -1 && devIdx > typesIdx) || (importIdx !== -1 && devIdx > importIdx)) {
        misordered.push(`${subpath}: [${keys.join(", ")}]`);
      }
    }
    expect(misordered).toEqual([]);
  });
});
