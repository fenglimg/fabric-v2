/**
 * rc.34 TASK-02: unit tests for SKILL.md install-time size pre-check and
 * stale-install detection helpers exported from src/install/skills-and-hooks.ts.
 *
 * Integration coverage (full install pipeline reaches every helper via the
 * three installFabric*Skill entry points) already exists in
 * __tests__/integration/install-skills-and-hooks.test.ts. This file pins down
 * the helper contracts in isolation so a regression in the math or thresholds
 * fails loudly without needing a temp project root.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  estimateSkillTokens,
  inspectStaleInstall,
  validateSkillCanonicalSize,
} from "../src/install/skills-and-hooks.ts";

describe("estimateSkillTokens (rc.34 TASK-02)", () => {
  it("returns 0 for empty string", () => {
    expect(estimateSkillTokens("")).toBe(0);
  });

  it("uses chars/3 with ceil (mirrors doctor inspectSkillTokenBudget)", () => {
    expect(estimateSkillTokens("abc")).toBe(1); // 3/3 = 1
    expect(estimateSkillTokens("ab")).toBe(1); // ceil(2/3) = 1
    expect(estimateSkillTokens("abcd")).toBe(2); // ceil(4/3) = 2
    expect(estimateSkillTokens("a".repeat(30000))).toBe(10000); // boundary
  });
});

describe("validateSkillCanonicalSize (rc.34 TASK-02)", () => {
  it("passes silently when canonical is well under threshold", () => {
    expect(() => validateSkillCanonicalSize("small", "fabric-test")).not.toThrow();
  });

  it("passes when canonical is exactly at the 10K boundary", () => {
    // 30000 chars → ceil(30000/3) = 10000 tok, NOT > 10000 (strict >)
    expect(() =>
      validateSkillCanonicalSize("a".repeat(30000), "fabric-test"),
    ).not.toThrow();
  });

  it("throws when canonical exceeds 10K ERROR threshold", () => {
    // 30003 chars → ceil(30003/3) = 10001 tok > 10000
    expect(() =>
      validateSkillCanonicalSize("a".repeat(30003), "fabric-test"),
    ).toThrow(/Skill 'fabric-test' canonical SKILL\.md estimates 10001 tok/);
  });

  it("error message names the offending skill slug + mentions progressive disclosure remedy", () => {
    const bigSource = "a".repeat(50000); // ~16667 tok
    let captured: Error | null = null;
    try {
      validateSkillCanonicalSize(bigSource, "fabric-archive");
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("fabric-archive");
    expect(captured!.message).toContain("Install aborted");
    expect(captured!.message).toContain("progressive disclosure");
  });
});

describe("inspectStaleInstall (rc.34 TASK-02)", () => {
  let tempDir: string;
  let targetPath: string;
  const canonicalSource = "a".repeat(15000); // 5000 tok

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rc34-task02-stale-"));
    targetPath = join(tempDir, "SKILL.md");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when target does not exist", () => {
    expect(inspectStaleInstall(targetPath, canonicalSource)).toBeNull();
  });

  it("returns null when target is identical to canonical", () => {
    writeFileSync(targetPath, canonicalSource);
    expect(inspectStaleInstall(targetPath, canonicalSource)).toBeNull();
  });

  it("returns null when target is just under STALE_INSTALL_RATIO (1.5×)", () => {
    // 1.49× canonical → not stale
    writeFileSync(targetPath, "a".repeat(Math.floor(15000 * 1.49)));
    expect(inspectStaleInstall(targetPath, canonicalSource)).toBeNull();
  });

  it("returns annotation when target exceeds 1.5× canonical (stale install)", () => {
    // Mirrors rc.33 W3 finding: canonical 9K vs installed 19K stale.
    const staleExisting = "a".repeat(45000); // 15000 tok ≈ 3× canonical 5000 tok
    writeFileSync(targetPath, staleExisting);
    const msg = inspectStaleInstall(targetPath, canonicalSource);
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/stale-replaced \(15000 tok → 5000 tok canonical\)/);
  });

  it("returns null on unreadable target (defensive — never throws)", () => {
    // Pass a path that does exist (the temp dir itself) but is a directory,
    // so readFileSync throws — helper should swallow and return null.
    expect(inspectStaleInstall(tempDir, canonicalSource)).toBeNull();
  });
});

describe("rc.34 TASK-02: smoke test on actual canonical SKILL.md templates", () => {
  // Ensures the three shipped canonical SKILL.md files pass
  // validateSkillCanonicalSize so install never aborts in CI / dogfood. If
  // this fails, a release was about to ship oversized canonicals and the
  // install pre-check would refuse to deploy — the test catches it earlier.
  const skillSlugs = ["fabric-archive", "fabric-review", "fabric-import"] as const;
  for (const slug of skillSlugs) {
    it(`canonical templates/skills/${slug}/SKILL.md passes pre-check`, async () => {
      const { readFile } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const here = fileURLToPath(new URL(".", import.meta.url));
      const skillPath = join(here, "..", "templates", "skills", slug, "SKILL.md");
      const body = await readFile(skillPath, "utf8");
      expect(() => validateSkillCanonicalSize(body, slug)).not.toThrow();
    });
  }
});
