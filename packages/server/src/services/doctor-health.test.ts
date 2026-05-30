import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computeDoctorHealth, runDoctorReport } from "./doctor.js";

describe("computeDoctorHealth (A14 / W3-T4)", () => {
  it("is a perfect 100 / grade A with no findings", () => {
    expect(computeDoctorHealth(0, 0, 0)).toEqual({
      score: 100,
      grade: "A",
      penalties: { manual_errors: 0, fixable_errors: 0, warnings: 0 },
    });
  });

  it("weights manual > fixable > warning", () => {
    expect(computeDoctorHealth(1, 0, 0).score).toBe(85); // -15
    expect(computeDoctorHealth(0, 1, 0).score).toBe(92); // -8
    expect(computeDoctorHealth(0, 0, 1).score).toBe(97); // -3
  });

  it("sums penalties across buckets and itemizes them", () => {
    const h = computeDoctorHealth(1, 1, 2); // -15 -8 -6 = -29 → 71
    expect(h.score).toBe(71);
    expect(h.grade).toBe("C");
    expect(h.penalties).toEqual({ manual_errors: 15, fixable_errors: 8, warnings: 6 });
  });

  it("clamps at 0 (never negative) and grades F", () => {
    const h = computeDoctorHealth(100, 100, 100);
    expect(h.score).toBe(0);
    expect(h.grade).toBe("F");
  });

  it("maps the grade bands at their boundaries", () => {
    // exactly 90 → A, 75 → B, 60 → C, 40 → D, below → F.
    expect(computeDoctorHealth(0, 0, 0).grade).toBe("A"); // 100
    expect(computeDoctorHealth(0, 0, 4).grade).toBe("B"); // 88 (75..89)
    expect(computeDoctorHealth(0, 5, 0).grade).toBe("C"); // 60
    expect(computeDoctorHealth(4, 0, 0).grade).toBe("D"); // 40
    expect(computeDoctorHealth(0, 0, 21).grade).toBe("F"); // 37
  });
});

describe("runDoctorReport surfaces health (A14 / W3-T4)", () => {
  const tempDirs: string[] = [];
  afterEach(() => tempDirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("includes a well-formed health rollup consistent with the lint counts", async () => {
    const target = mkdtempSync(join(tmpdir(), "fabric-kbhealth-"));
    tempDirs.push(target);
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(join(target, "package.json"), JSON.stringify({ name: "kbhealth", dependencies: { vite: "^7.0.0" } }, null, 2));
    writeFileSync(join(target, "src", "main.ts"), "export const boot = true;\n");

    const report = await runDoctorReport(target);
    const h = report.summary.health;

    expect(h.score).toBeGreaterThanOrEqual(0);
    expect(h.score).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"]).toContain(h.grade);
    // The rollup reuses the lint counts — verify it matches what doctor reported.
    expect(h).toEqual(
      computeDoctorHealth(
        report.summary.manualErrorCount,
        report.summary.fixableErrorCount,
        report.summary.warningCount,
      ),
    );
  });
});
