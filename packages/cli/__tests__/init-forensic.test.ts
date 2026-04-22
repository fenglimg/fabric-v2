import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { forensicReportSchema } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { initFabric } from "../src/commands/init.ts";
import { cleanupFixtureRoot, createWerewolfFixtureRoot } from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("initFabric forensic report", () => {
  it("writes a valid forensic report for the werewolf Cocos fixture", () => {
    const target = createWerewolfFixtureRoot("fab-init-forensic");
    tempRoots.push(target);

    const result = initFabric(target);
    const forensicPath = result.forensicPath;

    expect(existsSync(forensicPath)).toBe(true);

    const report = JSON.parse(readFileSync(forensicPath, "utf8")) as unknown;
    const parsed = forensicReportSchema.safeParse(report);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.framework.kind).toBe("cocos-creator");
    expect(parsed.success && parsed.data.framework.version).toBe("3.8.0");
    expect(parsed.success && parsed.data.framework.subkind).toBe("typescript-component");
    expect(parsed.success && parsed.data.entry_points.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["assets/scripts/Game.ts", "assets/scripts/Network.ts", "assets/scripts/Player.ts"]),
    );
    if (parsed.success) {
      for (const sample of parsed.data.code_samples) {
        expect(sample.lines).toMatch(/^1-\d+$/);
        expect(Number.parseInt(sample.lines.split("-")[1] ?? "", 10)).toBe(
          sample.snippet.length === 0 ? 0 : sample.snippet.split("\n").length,
        );
      }
    }
    expect(parsed.success && parsed.data.assertions.length).toBeGreaterThanOrEqual(5);
    expect(parsed.success && parsed.data.candidate_files.length).toBeLessThanOrEqual(12);
    expect(parsed.success && new Set(parsed.data.candidate_files.map((entry) => entry.family)).size).toBeGreaterThanOrEqual(3);
    expect(parsed.success && parsed.data.sampling_budget).toEqual({
      max_files: 15,
      max_lines_per_file: 100,
    });
    expect(parsed.success && parsed.data.recommendations_for_skill?.length).toBeGreaterThan(0);
    expect(parsed.success && parsed.data.target).toBe(target);
    expect(result.forensicPath).toBe(join(target, ".fabric", "forensic.json"));
  });
});
