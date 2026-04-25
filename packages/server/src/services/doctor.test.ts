import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctorAuditReport, runDoctorFix, runDoctorReport } from "./doctor.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe("runDoctorReport", () => {
  it("reports missing fabric artifacts while still surfacing live framework data", async () => {
    const target = createFixtureRoot("doctor-missing");
    writeFileSync(
      join(target, "package.json"),
      `${JSON.stringify({
        name: "doctor-missing",
        private: true,
        dependencies: {
          vite: "^7.0.0",
        },
      }, null, 2)}\n`,
      "utf8",
    );
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(
      join(target, "src", "main.ts"),
      "export const boot = true;\n",
      "utf8",
    );

    const report = await runDoctorReport(target);

    expect(report.status).toBe("error");
    expect(report.summary.framework.kind).toBe("vite");
    expect(report.summary.entryPoints.map((entry) => entry.path)).toContain("src/main.ts");
    expect(report.summary.protectedPathsIntact).toBe(false);
    expect(report.checks.map((check) => check.name)).toEqual([
      "Forensic snapshot",
      "Framework fingerprint",
      "Meta revision",
      "Protected paths",
      "Intent ledger",
    ]);
    expect(report.checks.find((check) => check.name === "Forensic snapshot")?.status).toBe("error");
  });

  it("returns ok when forensic, meta, locks, and ledger are aligned", async () => {
    const target = createFixtureRoot("doctor-ok");
    const bootstrapPath = join(target, ".fabric", "bootstrap", "README.md");
    const mainPath = join(target, "src", "main.ts");
    const humanPath = join(target, "src", "human.ts");
    const bootstrapContent = "# Project Rules\n";
    const humanContent = "const kept = true;\n";
    const now = Date.now();

    mkdirSync(join(target, ".fabric", "bootstrap"), { recursive: true });
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(
      join(target, "package.json"),
      `${JSON.stringify({
        name: "doctor-ok",
        private: true,
        dependencies: {
          vite: "^7.0.0",
        },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(bootstrapPath, bootstrapContent, "utf8");
    writeFileSync(mainPath, "export const boot = true;\n", "utf8");
    writeFileSync(humanPath, humanContent, "utf8");

    const bootstrapHash = sha256(bootstrapContent);
    const forensic = {
      version: "1.0",
      generated_at: new Date(now).toISOString(),
      generated_by: "vitest",
      target,
      project_name: "doctor-ok",
      framework: {
        kind: "vite",
        version: "^7.0.0",
        subkind: "vite-application",
        evidence: ["package.json dependency: vite@^7.0.0"],
      },
      topology: {
        total_files: 3,
        by_ext: {
          ".json": 1,
          ".md": 1,
          ".ts": 2,
        },
        key_dirs: ["src"],
        max_depth: 2,
      },
      entry_points: [
        {
          path: "src/main.ts",
          reason: "application entry",
          size_bytes: readFileSync(mainPath, "utf8").length,
        },
      ],
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
      recommendations_for_skill: [],
    };

    writeFileSync(join(target, ".fabric", "forensic.json"), `${JSON.stringify(forensic, null, 2)}\n`, "utf8");
    writeFileSync(
      join(target, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: sha256(`L0|${bootstrapHash}|bootstrap|derived`),
        nodes: {
          L0: {
            file: ".fabric/bootstrap/README.md",
            scope_glob: "**",
            deps: [],
            priority: "high",
            hash: bootstrapHash,
            stable_id: "bootstrap",
            identity_source: "derived",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(target, ".fabric", "human-lock.json"),
      `${JSON.stringify({
        locked: [
          {
            file: "src/human.ts",
            start_line: 1,
            end_line: 1,
            hash: sha256("const kept = true;"),
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(target, ".fabric", ".intent-ledger.jsonl"),
      `${JSON.stringify({
        ts: now - 10 * 60 * 1000,
        source: "human",
        parent_sha: "abc1234",
        intent: "refresh doctor",
        affected_paths: [".fabric/bootstrap/README.md"],
        diff_stat: "1 file changed",
      })}\n`,
      "utf8",
    );

    const report = await runDoctorReport(target);

    expect(report.status).toBe("ok");
    expect(report.summary.framework.kind).toBe("vite");
    expect(report.summary.entryPoints).toEqual([
      {
        path: "src/main.ts",
        reason: "application entry",
      },
    ]);
    expect(report.summary.driftCount).toBe(0);
    expect(report.summary.protectedPathsIntact).toBe(true);
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("surfaces compliance violations when strict audit mode finds edits without prior rules fetches", async () => {
    const target = createFixtureRoot("doctor-audit-strict");
    const now = Date.now();

    mkdirSync(join(target, ".fabric"), { recursive: true });
    writeFileSync(
      join(target, "fabric.config.json"),
      `${JSON.stringify({
        auditMode: "strict",
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(target, ".fabric", ".intent-ledger.jsonl"),
      `${JSON.stringify({
        id: "ledger:audit-miss",
        ts: now,
        source: "ai",
        intent: "modify src/missing.ts",
        affected_paths: ["src/missing.ts"],
        commit_sha: "abc1234",
      })}\n`,
      "utf8",
    );

    const audit = await runDoctorAuditReport(target);

    expect(audit.mode).toBe("strict");
    expect(audit.skipped).toBe(false);
    expect(audit.checkedPathCount).toBe(1);
    expect(audit.violationCount).toBe(1);
    expect(audit.violations).toEqual([
      expect.objectContaining({
        entryId: "ledger:audit-miss",
        path: "src/missing.ts",
        intent: "modify src/missing.ts",
        lastRuleAccessTs: null,
      }),
    ]);
  });

  it("adds a rules fetch audit check when warn mode is enabled", async () => {
    const target = createFixtureRoot("doctor-audit-warn");
    const bootstrapPath = join(target, ".fabric", "bootstrap", "README.md");
    const mainPath = join(target, "src", "main.ts");
    const auditPath = join(target, "src", "audit.ts");
    const humanPath = join(target, "src", "human.ts");
    const bootstrapContent = "# Project Rules\n";
    const humanContent = "const kept = true;\n";
    const now = Date.now();

    mkdirSync(join(target, ".fabric", "bootstrap"), { recursive: true });
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(
      join(target, "fabric.config.json"),
      `${JSON.stringify({
        auditMode: "warn",
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(target, "package.json"),
      `${JSON.stringify({
        name: "doctor-audit-warn",
        private: true,
        dependencies: {
          vite: "^7.0.0",
        },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(bootstrapPath, bootstrapContent, "utf8");
    writeFileSync(mainPath, "export const boot = true;\n", "utf8");
    writeFileSync(auditPath, "export const audit = true;\n", "utf8");
    writeFileSync(humanPath, humanContent, "utf8");

    const bootstrapHash = sha256(bootstrapContent);
    writeFileSync(
      join(target, ".fabric", "forensic.json"),
      `${JSON.stringify({
        version: "1.0",
        generated_at: new Date(now).toISOString(),
        generated_by: "vitest",
        target,
        project_name: "doctor-audit-warn",
        framework: {
          kind: "vite",
          version: "^7.0.0",
          subkind: "vite-application",
          evidence: ["package.json dependency: vite@^7.0.0"],
        },
        topology: {
          total_files: 4,
          by_ext: {
            ".json": 1,
            ".md": 1,
            ".ts": 3,
          },
          key_dirs: ["src"],
          max_depth: 2,
        },
        entry_points: [
          {
            path: "src/main.ts",
            reason: "application entry",
            size_bytes: readFileSync(mainPath, "utf8").length,
          },
        ],
        code_samples: [],
        readme: {
          quality: "missing",
          line_count: 0,
          has_contributing: false,
        },
        recommendations_for_skill: [],
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(target, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: sha256(`L0|${bootstrapHash}|bootstrap|derived`),
        nodes: {
          L0: {
            file: ".fabric/bootstrap/README.md",
            scope_glob: "**",
            deps: [],
            priority: "high",
            hash: bootstrapHash,
            stable_id: "bootstrap",
            identity_source: "derived",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(target, ".fabric", "human-lock.json"),
      `${JSON.stringify({
        locked: [
          {
            file: "src/human.ts",
            start_line: 1,
            end_line: 1,
            hash: sha256("const kept = true;"),
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(target, ".fabric", "audit.jsonl"),
      `${JSON.stringify({
        kind: "audit-event",
        event: "rule_selection",
        ts: now - 60_000,
        path: "src/audit.ts",
        selection_token: "selection:rev:doctor",
        target_paths: ["src/audit.ts"],
        required_stable_ids: ["bootstrap"],
        ai_selectable_stable_ids: [],
        ai_selected_stable_ids: [],
        final_stable_ids: ["bootstrap"],
        ai_selection_reasons: {},
        rejected_stable_ids: [],
        ignored_stable_ids: [],
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join(target, ".intent-ledger.jsonl"),
      `${JSON.stringify({
        id: "ledger:audit-hit",
        ts: now,
        source: "ai",
        intent: "refresh audit flow",
        affected_paths: ["src/audit.ts"],
        commit_sha: "abc1234",
      })}\n`,
      "utf8",
    );

    const report = await runDoctorReport(target);
    const auditCheck = report.checks.find((check) => check.name === "Rules fetch audit");

    expect(auditCheck).toEqual({
      name: "Rules fetch audit",
      status: "ok",
      message: "All 1 audited edit path have a preceding rule_selection or get_rules event within 5m.",
    });
    expect(report.audit?.violationCount).toBe(0);
    expect(report.summary.audit).toEqual({
      enabled: true,
      mode: "warn",
      checkedPathCount: 1,
      violationCount: 0,
      windowMs: 5 * 60 * 1000,
    });
  });

  it("warns when tracked rule nodes still rely on derived stable identities", async () => {
    const target = createFixtureRoot("doctor-derived-stable-id");
    const bootstrapPath = join(target, ".fabric", "bootstrap", "README.md");
    const rulePath = join(target, ".fabric", "agents", "packages", "server", "rules.md");
    const bootstrapContent = "# Project Rules\n";
    const ruleContent = "# server rules\n";
    const bootstrapHash = sha256(bootstrapContent);
    const ruleHash = sha256(ruleContent);
    const revision = sha256(
      [
        `L0|${bootstrapHash}|bootstrap|derived`,
        `L1/packages/server/rules|${ruleHash}|packages/server/rules|derived`,
      ].join("\n"),
    );

    mkdirSync(join(target, ".fabric", "bootstrap"), { recursive: true });
    mkdirSync(join(target, ".fabric", "agents", "packages", "server"), { recursive: true });
    writeFileSync(bootstrapPath, bootstrapContent, "utf8");
    writeFileSync(rulePath, ruleContent, "utf8");
    writeFileSync(
      join(target, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision,
        nodes: {
          L0: {
            file: ".fabric/bootstrap/README.md",
            scope_glob: "**",
            deps: [],
            priority: "high",
            hash: bootstrapHash,
            stable_id: "bootstrap",
            identity_source: "derived",
          },
          "L1/packages/server/rules": {
            file: ".fabric/agents/packages/server/rules.md",
            scope_glob: "packages/server/**",
            deps: ["L0"],
            priority: "medium",
            hash: ruleHash,
            stable_id: "packages/server/rules",
            identity_source: "derived",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const report = await runDoctorReport(target);
    const metaCheck = report.checks.find((check) => check.name === "Meta revision");

    expect(metaCheck).toEqual({
      name: "Meta revision",
      status: "warn",
      message:
        "agents.meta.json revision " +
        `${revision} matches 2 tracked AGENTS files, but 1 rule node still use derived identities. ` +
        "Add `<!-- fab:rule-id ... -->` to the rule file header instead of editing meta directly " +
        "(.fabric/agents/packages/server/rules.md).",
    });
  });

  it("reports BUSINESS_LOGIC_CHUNKS anchors that are missing, stale, or duplicated", async () => {
    const target = createFixtureRoot("doctor-business-anchors");
    const bootstrapPath = join(target, ".fabric", "bootstrap", "README.md");
    const rulePath = join(target, ".fabric", "rules", "battle.md");
    const battlePath = join(target, "src", "Battle.ts");
    const otherPath = join(target, "src", "Other.ts");
    const bootstrapContent = "# Project Rules\n";
    const ruleContent = `# Battle Rule

## [BUSINESS_LOGIC_CHUNKS]
### ID: BL-OK
- **Anchor**: \`BL-OK\`
- **Intent**: Keep working anchor.
- **Scars**: Historical behavior.
- **Constraint**: Preserve it.

### ID: BL-STALE
- **Anchor**: \`BL-STALE\`
- **Intent**: Reference a removed anchor.
- **Scars**: Historical behavior.
- **Constraint**: Preserve it.

### ID: BL-MISSING
- **Intent**: Missing anchor field.
- **Scars**: Historical behavior.
- **Constraint**: Add an anchor.

### ID: BL-DUP
- **Anchor**: \`BL-DUP\`
- **Intent**: Detect duplicate source anchors.
- **Scars**: Historical behavior.
- **Constraint**: Keep one anchor.
`;
    const battleContent = [
      "// @fabric-anchor BL-OK",
      "export const battle = true;",
      "// @fabric-anchor BL-DUP",
      "",
    ].join("\n");
    const otherContent = "// @fabric-anchor BL-DUP\nexport const other = true;\n";

    mkdirSync(join(target, ".fabric", "bootstrap"), { recursive: true });
    mkdirSync(join(target, ".fabric", "rules"), { recursive: true });
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(bootstrapPath, bootstrapContent, "utf8");
    writeFileSync(rulePath, ruleContent, "utf8");
    writeFileSync(battlePath, battleContent, "utf8");
    writeFileSync(otherPath, otherContent, "utf8");
    writeFileSync(
      join(target, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-business-anchors",
        nodes: {
          L0: {
            file: ".fabric/bootstrap/README.md",
            scope_glob: "**",
            deps: [],
            priority: "high",
            layer: "L0",
            hash: sha256(bootstrapContent),
            stable_id: "bootstrap",
            identity_source: "declared",
          },
          "L2/battle": {
            file: ".fabric/rules/battle.md",
            content_ref: ".fabric/rules/battle.md",
            scope_glob: "src/Battle.ts",
            deps: ["L0"],
            priority: "medium",
            layer: "L2",
            level: "L2",
            topology_type: "local",
            hash: sha256(ruleContent),
            stable_id: "battle-local",
            identity_source: "declared",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const report = await runDoctorReport(target);
    const anchorCheck = report.checks.find((check) => check.name === "Business logic anchors");

    expect(report.summary.businessLogicAnchors).toEqual({
      chunkCount: 4,
      anchorCount: 3,
      missingCount: 1,
      staleCount: 1,
      duplicateCount: 1,
    });
    expect(anchorCheck?.status).toBe("warn");
    expect(anchorCheck?.message).toContain("1 missing, 1 stale, 1 duplicate");
    expect(anchorCheck?.message).toContain("BL-STALE not found");
    expect(anchorCheck?.message).toContain("BL-DUP duplicated");
  });

  it("warns when only the legacy root ledger exists and migrates it with doctor --fix", async () => {
    const target = createFixtureRoot("doctor-ledger-migrate");
    const now = Date.now();

    mkdirSync(join(target, ".fabric"), { recursive: true });
    writeFileSync(
      join(target, ".intent-ledger.jsonl"),
      `${JSON.stringify({
        id: "ledger:legacy",
        ts: now,
        source: "human",
        parent_sha: "root",
        intent: "legacy ledger",
        affected_paths: ["README.md"],
        diff_stat: "1 file changed",
      })}\n`,
      "utf8",
    );

    const report = await runDoctorReport(target);
    const fix = await runDoctorFix(target);

    expect(report.summary.legacyLedgerDetected).toBe(true);
    expect(report.checks.find((check) => check.name === "Intent ledger")?.status).toBe("warn");
    expect(fix.migratedLedger).toBe(true);
    expect(existsSync(join(target, ".intent-ledger.jsonl"))).toBe(false);
    expect(existsSync(join(target, ".fabric", ".intent-ledger.jsonl"))).toBe(true);
  });
});

function createFixtureRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempRoots.push(root);
  return root;
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
