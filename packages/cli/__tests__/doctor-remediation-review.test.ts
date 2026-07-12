import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// D4-2: doctor quality remediations must route operators to fab_review / fabric-review
// for ≥2 distinct quality actions (draft backlog promote + retire/stale candidates).
// Locks i18n source strings (authoritative) so accidental copy rewrites fail CI.

// packages/cli/__tests__ → packages/shared/src/i18n/locales
const localesDir = join(
  fileURLToPath(new URL("../../shared/src/i18n/locales", import.meta.url)),
);

function readLocale(name: "en.ts" | "zh-CN.ts"): string {
  return readFileSync(join(localesDir, name), "utf8");
}

describe("D4 doctor remediations → fab_review (DoD D4-2)", () => {
  it("en: draft_backlog + consumption-zero remediations point at fabric-review/fab_review", () => {
    const en = readLocale("en.ts");
    // draft backlog → promote via review
    expect(en).toMatch(
      /"doctor\.check\.draft_backlog\.remediation":\s*\n?\s*"Run `\/fabric-review`/,
    );
    // never-consumed / retire candidates
    expect(en).toMatch(
      /"doctor\.store\.consumption-zero":\s*"[^"]*fab_review/,
    );
    // third belt-and-suspenders: stale archive also routes to review
    expect(en).toMatch(
      /"doctor\.check\.stale_archive\.remediation":\s*\n?\s*"[^"]*\/fabric-review/,
    );
  });

  it("zh-CN mirrors draft_backlog + consumption-zero review routing", () => {
    const zh = readLocale("zh-CN.ts");
    expect(zh).toMatch(/"doctor\.check\.draft_backlog\.remediation":[\s\S]{0,40}\/fabric-review/);
    expect(zh).toMatch(/"doctor\.store\.consumption-zero":\s*"[^"]*fab_review/);
  });
});
