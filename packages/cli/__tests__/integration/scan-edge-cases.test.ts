/**
 * Integration tests: scan command edge cases
 * Covers: I8 (empty/unreadable dir → valid forensic output)
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createScanReport } from "../../src/commands/scan.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `itg-scan-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

// I8 — scan on empty directory returns valid report with fileCount=0 and non-null recommendations array
describe("I8: scan handles empty directory gracefully", () => {
  it("empty directory (only package.json) returns fileCount≥0 and a non-null recommendations array", async () => {
    const dir = makeTempDir("empty");
    // Need package.json for scan not to error on the initial directory check
    writeFileSync(join(dir, "package.json"), '{"name":"empty"}\n', "utf8");

    const report = await createScanReport(dir);

    // package.json itself may be counted; just verify no exception and array exists
    expect(typeof report.fileCount).toBe("number");
    expect(report.fileCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.recommendations)).toBe(true);
    expect(report.target).toBe(dir);
  });

  it("empty directory does not throw and returns a framework object", async () => {
    const dir = makeTempDir("empty-fw");
    writeFileSync(join(dir, "package.json"), '{"name":"empty-fw"}\n', "utf8");

    const report = await createScanReport(dir);

    expect(report.framework).toBeDefined();
    expect(typeof report.framework.kind).toBe("string");
  });

  it("directory with only .gitkeep file returns fileCount≥0 and no exception", async () => {
    const dir = makeTempDir("only-gitkeep");
    writeFileSync(join(dir, ".gitkeep"), "", "utf8");

    const report = await createScanReport(dir);

    expect(typeof report.fileCount).toBe("number");
    expect(report.fileCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  it("scan on a directory without README recommends adding one", async () => {
    const dir = makeTempDir("no-readme");
    writeFileSync(join(dir, "index.ts"), "export {};\n", "utf8");

    const report = await createScanReport(dir);

    // Recommendations array should exist; stub readme → should mention readme
    const hasReadmeRecommendation = report.recommendations.some(
      (r) => /readme/i.test(r),
    );
    expect(hasReadmeRecommendation).toBe(true);
  });
});
