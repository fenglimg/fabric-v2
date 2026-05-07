import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctorFix, runDoctorReport } from "./doctor.js";
import { readEventLedger } from "./event-ledger.js";
import { writeRuleMeta } from "./rule-meta-builder.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe("runDoctorReport", () => {
  it("reports target-state fixable and manual errors", async () => {
    const target = createProject("doctor-missing");
    writeFile("package.json", JSON.stringify({ name: "doctor-missing", dependencies: { vite: "^7.0.0" } }, null, 2), target);
    writeFile("src/main.ts", "export const boot = true;\n", target);

    const report = await runDoctorReport(target);

    expect(report.status).toBe("error");
    expect(report.summary.framework.kind).toBe("vite");
    expect(report.summary.entryPoints.map((entry) => entry.path)).toContain("src/main.ts");
    expect(report.fixable_errors.map((issue) => issue.code)).toEqual([
      "bootstrap_missing",
      "agents_meta_missing",
      "rule_test_index_missing",
      "event_ledger_missing",
    ]);
    expect(report.manual_errors.map((issue) => issue.code)).toContain("content_refs_unavailable");
    expect(report.manual_errors.map((issue) => issue.code)).toEqual([
      "taxonomy_missing",
      "forensic_missing",
      "init_context_missing",
      "content_refs_unavailable",
    ]);
  });

  it("returns ok when target-state fabric artifacts are aligned", async () => {
    const target = createInitializedProject("doctor-ok");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);

    expect(report.status).toBe("ok");
    expect(report.fixable_errors).toEqual([]);
    expect(report.manual_errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "Bootstrap README",
      "Initial taxonomy",
      "Scan evidence",
      "Init context",
      "Agents metadata",
      "Rule content refs",
      "Rule sections",
      "Rule-test index",
      "Event ledger",
      "Event ledger partial write",
    ]);
  });

  it("treats malformed rule sections as manual errors", async () => {
    const target = createInitializedProject("doctor-invalid-rule");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "{not-json}\n", target);

    const report = await runDoctorReport(target);

    expect(report.manual_errors.map((issue) => issue.code)).toContain("event_ledger_invalid");
    expect(report.fixable_errors).toEqual([]);
  });

  it("doctor --fix repairs derived state and leaves manual errors visible", async () => {
    const target = createProject("doctor-fix");
    writeFile(".fabric/rules/packages/server/rules.md", "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services.\n", target);

    const before = await runDoctorReport(target);
    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(before.fixable_errors.map((issue) => issue.code)).toContain("agents_meta_missing");
    expect(fix.changed).toBe(true);
    expect(after.fixable_errors).toEqual([]);
    expect(after.manual_errors.map((issue) => issue.code)).toEqual([
      "taxonomy_missing",
      "forensic_missing",
      "init_context_missing",
    ]);
    expect(JSON.parse(readFileSync(join(target, ".fabric", "agents.meta.json"), "utf8")).nodes["L1/packages/server/rules"]).toMatchObject({
      content_ref: ".fabric/rules/packages/server/rules.md",
      stable_id: "rules/server",
    });
    expect(readFileSync(join(target, ".fabric", "rule-test.index.json"), "utf8")).toContain("\"links\"");
    expect(readFileSync(join(target, ".fabric", "events.jsonl"), "utf8")).toContain("baseline_synced");
  });

  it("doctor --fix does not report fixable drift after rebuilding stale meta", async () => {
    const target = createInitializedProject("doctor-stale");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);
    writeFile(
      ".fabric/rules/packages/server/rules.md",
      "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nChanged.\n",
      target,
    );

    const before = await runDoctorReport(target);
    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);
    const { events } = await readEventLedger(target);

    expect(before.fixable_errors.map((issue) => issue.code)).toContain("agents_meta_stale");
    expect(fix.fixed.map((issue) => issue.code)).toContain("agents_meta_stale");
    expect(after.fixable_errors).toEqual([]);
    expect(events.map((event) => event.event_type)).toContain("rule_drift_detected");
    expect(events.map((event) => event.event_type)).toContain("baseline_synced");
  });

  it("doctor fixable check fires when partial write detected and --fix truncates + writes ledger event", async () => {
    const target = createInitializedProject("doctor-partial-write");
    await writeRuleMeta(target, { source: "doctor_fix" });

    // Write a ledger file that ends without a newline (partial write simulation)
    const goodLine = JSON.stringify({
      kind: "fabric-event",
      id: "event:good",
      ts: 1_000,
      schema_version: 1,
      event_type: "reapply_completed",
      preserved_ledger: true,
      preserved_meta: true,
      rules_count: 0,
    });
    const partialLine = '{"kind":"fabric-event","ts":2000,"partial';
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    writeFileSync(ledgerPath, `${goodLine}\n${partialLine}`, "utf8");

    const before = await runDoctorReport(target);

    expect(before.fixable_errors.map((issue) => issue.code)).toContain("event_ledger_partial_write");
    expect(before.checks.find((c) => c.name === "Event ledger partial write")?.status).toBe("error");

    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(fix.fixed.map((issue) => issue.code)).toContain("event_ledger_partial_write");
    expect(after.fixable_errors.map((issue) => issue.code)).not.toContain("event_ledger_partial_write");
    expect(after.checks.find((c) => c.name === "Event ledger partial write")?.status).toBe("ok");

    // The ledger should contain the truncation event
    const { events } = await readEventLedger(target);
    expect(events.map((event) => event.event_type)).toContain("event_ledger_truncated");
  });
});

function createInitializedProject(name: string): string {
  const target = createProject(name);
  writeFile("package.json", JSON.stringify({ name, dependencies: { vite: "^7.0.0" } }, null, 2), target);
  writeFile("src/main.ts", "export const boot = true;\n", target);
  writeFile(".fabric/bootstrap/README.md", "# Bootstrap\n", target);
  writeFile(".fabric/INITIAL_TAXONOMY.md", "# Initial Taxonomy\n", target);
  writeFile(".fabric/init-context.json", JSON.stringify({ confirmed: true }, null, 2), target);
  writeFile(".fabric/forensic.json", JSON.stringify(createForensic(target, name), null, 2), target);
  writeFile(".fabric/rules/packages/server/rules.md", "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services.\n", target);
  writeFile("packages/server/rules.contract.test.ts", "// @fabric-verify rules/server\nexpect(true).toBe(true);\n", target);
  return target;
}

function createProject(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  tempRoots.push(root);
  return root;
}

function writeFile(path: string, content: string, root: string): void {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, `${content.endsWith("\n") ? content : `${content}\n`}`, "utf8");
}

function createForensic(target: string, name: string): unknown {
  return {
    version: "1.0",
    generated_at: new Date("2026-04-26T00:00:00.000Z").toISOString(),
    generated_by: "vitest",
    target,
    project_name: name,
    framework: {
      kind: "vite",
      version: "^7.0.0",
      subkind: "vite-application",
      evidence: ["package.json dependency: vite@^7.0.0"],
    },
    topology: {
      total_files: 3,
      by_ext: { ".json": 1, ".md": 2, ".ts": 2 },
      key_dirs: ["src"],
      max_depth: 2,
    },
    entry_points: [{ path: "src/main.ts", reason: "application entry", size_bytes: 26 }],
    code_samples: [],
    assertions: [],
    candidate_files: [],
    sampling_budget: { max_files: 15, max_lines_per_file: 100 },
    readme: { quality: "missing", line_count: 0, has_contributing: false },
    recommendations_for_skill: [],
  };
}
