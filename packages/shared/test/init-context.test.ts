import { describe, expect, it } from "vitest";

import { initContextSchema } from "../src/schemas/init-context";

describe("initContextSchema", () => {
  it("accepts the legacy init-context shape", () => {
    const parsed = initContextSchema.parse({
      framework: {
        kind: "cocos",
        version: "3.8.0",
        subkind: "typescript",
      },
      architecture_patterns: ["componentized"],
      invariants: [
        {
          type: "require",
          rule: "Use @ccclass on gameplay components.",
        },
      ],
      domain_groups: [
        {
          name: "gameplay",
          paths: ["assets/scripts/gameplay"],
        },
      ],
      interview_trail: [
        {
          phase: "Phase 1",
          question: "Which gameplay conventions should be enforced?",
          answer: "Prefer componentized scene scripts.",
        },
      ],
      forensic_ref: ".fabric/forensic.json",
    });

    expect(parsed.invariants[0]?.confidence_snapshot).toBeUndefined();
    expect(parsed.domain_groups[0]?.topology_type).toBeUndefined();
  });

  it("accepts shadow-mirroring confidence, topology, and Architecture Review fields", () => {
    const parsed = initContextSchema.parse({
      framework: {
        kind: "cocos",
        version: "3.8.0",
        subkind: "typescript",
      },
      architecture_patterns: ["componentized", "scene-director"],
      invariants: [
        {
          type: "require",
          rule: "Use @ccclass on gameplay components.",
          rationale: "Keep Cocos metadata explicit.",
          confidence_snapshot: {
            confidence: "HIGH",
            evidence_refs: [
              "packages/cli/src/scanner/forensic.ts:294-323",
              "assets/scripts/Game.ts:4-16",
            ],
          },
          source_evidence: [
            {
              file: "assets/scripts/Game.ts",
              lines: "4-16",
            },
          ],
        },
      ],
      domain_groups: [
        {
          name: "gameplay",
          paths: ["assets/scripts/gameplay"],
          summary: "Scene and game loop logic.",
          topology_type: "mirror",
          target_path: ".fabric/agents/assets/scripts/gameplay/AGENTS.md",
        },
        {
          name: "quality",
          paths: ["assets/scripts", "tests"],
          topology_type: "cross-cutting",
          target_path: ".fabric/agents/_cross/quality.md",
        },
      ],
      interview_trail: [
        {
          phase: "Architecture Review",
          question: "Which proposal should be corrected before generation?",
          answer: "Scene entry should use a Scene Director pattern.",
          presentation: "Presented framework, patterns, invariants, and domain groups in one review batch.",
          user_corrections: [
            "Change pattern 2 to Scene Director.",
            "Restrict @ccclass requirement to @property-using classes.",
          ],
        },
      ],
      forensic_ref: ".fabric/forensic.json",
    });

    expect(parsed.invariants[0]?.confidence_snapshot?.confidence).toBe("HIGH");
    expect(parsed.invariants[0]?.confidence_snapshot?.evidence_refs).toHaveLength(2);
    expect(parsed.domain_groups[1]?.topology_type).toBe("cross-cutting");
    expect(parsed.interview_trail[0]?.user_corrections).toContain(
      "Change pattern 2 to Scene Director.",
    );
  });
});
