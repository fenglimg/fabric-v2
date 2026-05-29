import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// v2.1.0-rc.1 P4 — the extension-layer skills must be store-aware (S66/S50/E7/
// S46): archive routes to the active write store, review iterates per-store,
// import requires an explicit target store, and the new fabric-sync skill
// traverses multiple stores. This pins the store-routing guidance into each
// canonical SKILL.md so a refactor can't silently drop it.

function skill(slug: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../templates/skills/${slug}/SKILL.md`, import.meta.url)),
    "utf8",
  );
}

describe("skills are store-aware (v2.1 P4)", () => {
  it("fabric-archive routes writes to the active write store and echoes it", () => {
    const md = skill("fabric-archive");
    expect(md).toContain("Store routing");
    expect(md).toMatch(/active write store/i);
    expect(md).toContain("scope-explain");
  });

  it("fabric-review iterates per-store and cites with a store prefix", () => {
    const md = skill("fabric-review");
    expect(md).toContain("Store routing");
    expect(md).toMatch(/per-store/i);
    expect(md).toContain("KB: <store-alias>:<id>");
  });

  it("fabric-import requires an explicit target store (E7)", () => {
    const md = skill("fabric-import");
    expect(md).toContain("Store routing");
    expect(md).toMatch(/explicit target store/i);
  });

  it("fabric-sync exists and traverses multiple stores with conflict resolution", () => {
    const md = skill("fabric-sync");
    expect(md).toMatch(/multi-store|多 store/i);
    expect(md).toContain("fabric sync --continue");
    expect(md).toContain("fabric sync --abort");
    // S65: skills never execute store content.
    expect(md).toMatch(/RCE|数据-only|data-only/i);
  });

  it("none of the skills tell the agent to read ~/.fabric store trees directly", () => {
    for (const slug of ["fabric-archive", "fabric-review", "fabric-sync"]) {
      const md = skill(slug);
      // They go through the CLI / MCP / scope-explain, not raw store reads.
      expect(md).toMatch(/不直接读|不直读|scope-explain|MCP/);
    }
  });
});
