import { describe, expect, it } from "vitest";

import {
  candidateFileEntrySchema,
  forensicAssertionSchema,
  forensicReportSchema,
} from "../src/schemas/forensic-report";

describe("forensicReportSchema", () => {
  it("round-trips a full forensic assertion and candidate entry through the report schema", () => {
    const assertion = {
      type: "framework" as const,
      statement: "Project strongly matches a Cocos Creator TypeScript component layout.",
      confidence: "HIGH" as const,
      evidence: [
        {
          file: "assets/scripts/Game.ts",
          line: "1",
          snippet: 'import { _decorator, Component } from "cc";',
        },
        {
          file: "project.config.json",
          line: "1",
          snippet: '"version": "3.8.0"',
        },
      ],
      coverage: {
        ratio: 1,
        total: 3,
        matched: 3,
        co_occurring_patterns: ["cc-import", "ccclass-decorator", "project-config-json"],
      },
      proposed_rule: "Preserve Cocos component decorators, lifecycle methods, and paired .meta files during initialization.",
      alternatives: ["Generic TypeScript utility modules"],
    };
    const candidate = {
      path: "assets/scripts/Game.ts",
      family: "component" as const,
      rationale: "Cocos-specific decorators and Component inheritance co-occur in sampled entry files.",
    };
    const report = {
      version: "1.0",
      generated_at: "2026-04-19T12:00:00.000Z",
      generated_by: "fabric-cli@test",
      target: "/tmp/werewolf-minigame-stub",
      project_name: "werewolf-minigame-stub",
      framework: {
        kind: "cocos-creator",
        version: "3.8.0",
        subkind: "typescript-component",
        evidence: ["project.config.json", "assets/scripts/Game.ts"],
      },
      topology: {
        total_files: 10,
        by_ext: {
          ".json": 3,
          ".meta": 3,
          ".md": 1,
          ".ts": 3,
        },
        key_dirs: ["assets/scripts"],
        max_depth: 3,
      },
      entry_points: [
        {
          path: "assets/scripts/Game.ts",
          reason: "top-level script",
          size_bytes: 143,
        },
      ],
      code_samples: [
        {
          path: "assets/scripts/Game.ts",
          lines: "1-8",
          snippet: 'import { _decorator, Component } from "cc";',
          pattern_hint: "cocos-component-class",
        },
      ],
      assertions: [assertion],
      candidate_files: [candidate],
      sampling_budget: {
        max_files: 15 as const,
        max_lines_per_file: 100 as const,
      },
      readme: {
        quality: "stub" as const,
        line_count: 12,
        has_contributing: false,
      },
      recommendations_for_skill: [
        "Treat assets/scripts/*.ts and adjacent .meta files as framework-owned structure unless the user says otherwise.",
      ],
    };

    expect(forensicAssertionSchema.parse(assertion)).toEqual(assertion);
    expect(candidateFileEntrySchema.parse(candidate)).toEqual(candidate);

    const parsed = forensicReportSchema.parse(report);
    const roundTrip = forensicReportSchema.parse(JSON.parse(JSON.stringify(parsed)));

    expect(roundTrip.assertions[0]).toEqual(assertion);
    expect(roundTrip.candidate_files[0]).toEqual(candidate);
    expect(roundTrip.recommendations_for_skill).toEqual(report.recommendations_for_skill);
  });

  it("accepts transitional reports that still carry deprecated recommendations_for_skill", () => {
    const parsed = forensicReportSchema.parse({
      version: "1.0",
      generated_at: "2026-04-19T12:00:00.000Z",
      generated_by: "fabric-cli@test",
      target: "/tmp/legacy-report",
      project_name: "legacy-report",
      framework: {
        kind: "unknown",
        version: "unknown",
        subkind: "unknown",
        evidence: [],
      },
      topology: {
        total_files: 1,
        by_ext: {
          ".md": 1,
        },
        key_dirs: [],
        max_depth: 1,
      },
      entry_points: [],
      code_samples: [],
      assertions: [],
      candidate_files: [],
      sampling_budget: {
        max_files: 15,
        max_lines_per_file: 100,
      },
      readme: {
        quality: "missing",
        line_count: 0,
        has_contributing: false,
      },
      recommendations_for_skill: [
        "Ask the user to confirm the primary framework.",
      ],
    });

    expect(parsed.assertions).toEqual([]);
    expect(parsed.candidate_files).toEqual([]);
    expect(parsed.recommendations_for_skill).toEqual([
      "Ask the user to confirm the primary framework.",
    ]);
  });
});
