import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctorAuditReport, runDoctorReport } from "./doctor.js";

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
        revision: sha256(bootstrapHash),
        nodes: {
          L0: {
            file: ".fabric/bootstrap/README.md",
            scope_glob: "**",
            deps: [],
            priority: "high",
            hash: bootstrapHash,
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
      join(target, ".intent-ledger.jsonl"),
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
      join(target, ".intent-ledger.jsonl"),
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
        lastGetRulesTs: null,
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
        revision: sha256(bootstrapHash),
        nodes: {
          L0: {
            file: ".fabric/bootstrap/README.md",
            scope_glob: "**",
            deps: [],
            priority: "high",
            hash: bootstrapHash,
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
        event: "get_rules",
        ts: now - 60_000,
        path: "src/audit.ts",
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
      message: "All 1 audited edit path have a preceding fab_get_rules call within 5m.",
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
});

function createFixtureRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempRoots.push(root);
  return root;
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
