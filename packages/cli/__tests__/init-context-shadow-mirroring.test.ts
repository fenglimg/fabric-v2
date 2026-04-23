import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { initContextSchema } from "@fenglimg/fabric-shared";
import { describe, expect, it } from "vitest";

import { buildForensicReport } from "../src/scanner/forensic.ts";

const WEREWOLF_FIXTURE = fileURLToPath(new URL("../../../examples/werewolf-minigame-stub", import.meta.url));

describe("init-context shadow mirroring e2e", () => {
  it("simulates forensic to skill output with confidence snapshots and topology types", async () => {
    const target = cloneFixture("fab-init-context-shadow");

    try {
      const report = await buildForensicReport(target);
      const frameworkAssertion = requireAssertion(report.assertions, "framework");
      const metaProtectionAssertion = report.assertions.find(
        (assertion) => assertion.proposed_rule === "Do not edit or delete .meta sidecars without explicit user confirmation.",
      );

      expect(metaProtectionAssertion).toBeDefined();

      const initContext = {
        framework: {
          kind: "cocos",
          version: report.framework.version,
          subkind: "typescript",
        },
        architecture_patterns: [
          "componentized",
          "shadow-mirroring",
        ],
        invariants: [
          {
            type: "require" as const,
            rule: frameworkAssertion.proposed_rule ?? frameworkAssertion.statement,
            rationale: frameworkAssertion.statement,
            confidence_snapshot: {
              confidence: frameworkAssertion.confidence,
              evidence_refs: frameworkAssertion.evidence.map(
                (evidence) => `${evidence.file}:${evidence.line}`,
              ),
            },
            source_evidence: frameworkAssertion.evidence.map((evidence) => ({
              file: evidence.file,
              lines: evidence.line,
            })),
          },
          {
            type: "protect" as const,
            rule: metaProtectionAssertion?.proposed_rule ?? "Protect paired .meta files.",
            rationale: metaProtectionAssertion?.statement,
            confidence_snapshot: {
              confidence: metaProtectionAssertion?.confidence ?? "HIGH",
              evidence_refs:
                metaProtectionAssertion?.evidence.map((evidence) => `${evidence.file}:${evidence.line}`) ?? [],
            },
            source_evidence:
              metaProtectionAssertion?.evidence.map((evidence) => ({
                file: evidence.file,
                lines: evidence.line,
              })) ?? [],
          },
        ],
        domain_groups: [
          {
            name: "assets/scripts",
            paths: ["assets/scripts"],
            summary: "Mirrored gameplay role constraints for concrete Cocos scripts.",
            topology_type: "mirror" as const,
            target_path: ".fabric/agents/assets/scripts",
          },
          {
            name: "role-balance",
            paths: ["assets/scripts"],
            summary: "Cross-cutting role-balance guardrail for the whole fixture.",
            topology_type: "cross-cutting" as const,
            target_path: ".fabric/agents/_cross/role-balance.md",
          },
        ],
        interview_trail: [
          {
            phase: "Architecture Review",
            question: "Which Cocos patterns should remain protected in Shadow Mirroring output?",
            answer: "Preserve component decorators, lifecycle hooks, and paired .meta sidecars.",
            presentation: "Forensic assertions were reviewed in one batch before writing the mirror tree.",
            user_corrections: [
              "Keep role-specific constraints under .fabric/agents/assets/scripts.",
              "Route cross-cutting balance rules through .fabric/agents/_cross/role-balance.md.",
            ],
          },
        ],
        forensic_ref: ".fabric/forensic.json",
      };

      mkdirSync(join(target, ".fabric"), { recursive: true });
      writeFileSync(join(target, ".fabric", "init-context.json"), `${JSON.stringify(initContext, null, 2)}\n`, "utf8");

      const parsed = initContextSchema.parse(initContext);

      expect(parsed.invariants.every((invariant) => invariant.confidence_snapshot !== undefined)).toBe(true);
      expect(parsed.invariants[0]?.confidence_snapshot?.confidence).toBe("HIGH");
      expect(parsed.domain_groups.map((group) => group.topology_type)).toEqual(["mirror", "cross-cutting"]);
      expect(parsed.domain_groups.map((group) => group.target_path)).toEqual([
        ".fabric/agents/assets/scripts",
        ".fabric/agents/_cross/role-balance.md",
      ]);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});

function cloneFixture(prefix: string): string {
  const target = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  cpSync(WEREWOLF_FIXTURE, target, { recursive: true });
  return target;
}

function requireAssertion<T extends { type: string }>(assertions: T[], type: string): T {
  const assertion = assertions.find((candidate) => candidate.type === type);
  if (!assertion) {
    throw new Error(`Missing ${type} assertion`);
  }
  return assertion;
}
