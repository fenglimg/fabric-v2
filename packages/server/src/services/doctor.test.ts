import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildBootstrapContent } from "@fenglimg/fabric-shared/node/bootstrap-guide";

import { runDoctorFix, runDoctorReport } from "./doctor.js";
import { readEventLedger } from "./event-ledger.js";
import { writeRuleMeta } from "./rule-meta-builder.js";
import { sha256 } from "./_shared.js";

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
      "Claude MCP config location",
      "Meta manual divergence",
      "Rules dir unindexed",
      "Stable ID collision",
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

  it("mcp_config_in_wrong_file: detects mcpServers.fabric in .claude/settings.json", async () => {
    const target = createInitializedProject("doctor-mcp-wrong-file-detect");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Write the wrong config: mcpServers.fabric inside settings.json
    writeFile(
      ".claude/settings.json",
      JSON.stringify(
        {
          hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: ".claude/hooks/reminder.cjs" }] }] },
          mcpServers: { fabric: { command: process.execPath, args: ["/srv.js"] } },
        },
        null,
        2,
      ),
      target,
    );

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((issue) => issue.code)).toContain("mcp_config_in_wrong_file");
    expect(report.checks.find((c) => c.name === "Claude MCP config location")?.status).toBe("error");
  });

  it("mcp_config_in_wrong_file: --fix removes mcpServers.fabric from settings.json and writes ledger event", async () => {
    const target = createInitializedProject("doctor-mcp-wrong-file-fix");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const settingsContent = {
      hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: ".claude/hooks/reminder.cjs" }] }] },
      mcpServers: { fabric: { command: process.execPath, args: ["/srv.js"] } },
    };
    writeFile(".claude/settings.json", JSON.stringify(settingsContent, null, 2), target);

    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(fix.fixed.map((issue) => issue.code)).toContain("mcp_config_in_wrong_file");
    expect(after.fixable_errors.map((issue) => issue.code)).not.toContain("mcp_config_in_wrong_file");
    expect(after.checks.find((c) => c.name === "Claude MCP config location")?.status).toBe("ok");

    // settings.json should not have mcpServers anymore
    const settingsJson = JSON.parse(
      readFileSync(join(target, ".claude", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(settingsJson).not.toHaveProperty("mcpServers");
    // hooks should be preserved
    expect(settingsJson).toHaveProperty("hooks");

    // Ledger event should record the migration
    const { events } = await readEventLedger(target);
    expect(events.map((event) => event.event_type)).toContain("mcp_config_migrated");
  });

  it("mcp_config_in_wrong_file: --fix removes whole mcpServers when only fabric remains", async () => {
    const target = createInitializedProject("doctor-mcp-wrong-file-fix-solo");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Only fabric, no other servers
    writeFile(
      ".claude/settings.json",
      JSON.stringify({ mcpServers: { fabric: { command: process.execPath, args: ["/srv.js"] } } }, null, 2),
      target,
    );

    await runDoctorFix(target);

    const settingsJson = JSON.parse(
      readFileSync(join(target, ".claude", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    // The entire mcpServers key must be absent
    expect(settingsJson).not.toHaveProperty("mcpServers");
  });

  it("mcp_config_in_wrong_file: --fix preserves OTHER mcpServers entries in settings.json", async () => {
    const target = createInitializedProject("doctor-mcp-wrong-file-fix-other");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    writeFile(
      ".claude/settings.json",
      JSON.stringify(
        {
          mcpServers: {
            fabric: { command: process.execPath, args: ["/srv.js"] },
            other: { command: "/other/node", args: ["/other.js"] },
          },
        },
        null,
        2,
      ),
      target,
    );

    await runDoctorFix(target);

    const settingsJson = JSON.parse(
      readFileSync(join(target, ".claude", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    // fabric removed, other preserved
    const servers = settingsJson.mcpServers as Record<string, unknown> | undefined;
    expect(servers).toBeDefined();
    expect(servers).not.toHaveProperty("fabric");
    expect(servers).toHaveProperty("other");
  });

  it("mcp_config_in_wrong_file: no detection when settings.json has no mcpServers", async () => {
    const target = createInitializedProject("doctor-mcp-wrong-file-absent");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    writeFile(
      ".claude/settings.json",
      JSON.stringify({ hooks: { Stop: [] } }, null, 2),
      target,
    );

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((issue) => issue.code)).not.toContain("mcp_config_in_wrong_file");
    expect(report.checks.find((c) => c.name === "Claude MCP config location")?.status).toBe("ok");
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

  it("--fix calls reconcileRules and emits meta_reconciled event", async () => {
    const target = createProject("doctor-reconcile-fix");
    writeFile(".fabric/rules/packages/server/rules.md", "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services.\n", target);
    writeFile(".fabric/events.jsonl", "", target);

    const before = await runDoctorReport(target);
    expect(before.fixable_errors.map((issue) => issue.code)).toContain("agents_meta_missing");

    await runDoctorFix(target);

    const { events } = await readEventLedger(target);
    expect(events.map((event) => event.event_type)).toContain("meta_reconciled");

    const metaReconciled = events.find((e) => e.event_type === "meta_reconciled");
    expect(metaReconciled).toMatchObject({ event_type: "meta_reconciled", trigger: "doctor" });
  });

  it("backward-compat: old baseline_synced events parse without error from ledger replay", async () => {
    const target = createProject("doctor-baseline-synced-replay");
    mkdirSync(join(target, ".fabric"), { recursive: true });

    const legacyEvent = JSON.stringify({
      kind: "fabric-event",
      id: "event:legacy-001",
      ts: 1_000_000,
      schema_version: 1,
      event_type: "baseline_synced",
      revision: "abc123",
      previous_revision: "def456",
      synced_files: [".fabric/rules/server.md"],
      accepted_stable_ids: ["rules/server"],
      source: "doctor_fix",
    });

    const ledgerPath = join(target, ".fabric", "events.jsonl");
    writeFileSync(ledgerPath, `${legacyEvent}\n`, "utf8");

    const { events, warnings } = await readEventLedger(target);

    expect(warnings).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("baseline_synced");
    if (events[0].event_type === "baseline_synced") {
      expect(events[0].revision).toBe("abc123");
      expect(events[0].synced_files).toEqual([".fabric/rules/server.md"]);
    }
  });

  it("meta_manually_diverged: detects meta entries with no backing file on disk", async () => {
    const target = createInitializedProject("doctor-meta-diverged-missing");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Remove the rule file but leave the meta entry intact
    rmSync(join(target, ".fabric", "rules", "packages", "server", "rules.md"), { force: true });

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).toContain("meta_manually_diverged");
    expect(report.checks.find((c) => c.name === "Meta manual divergence")?.status).toBe("warn");
    const warningMsg = report.checks.find((c) => c.name === "Meta manual divergence")?.message ?? "";
    expect(warningMsg).toContain("no backing file");
  });

  it("meta_manually_diverged: detects hash mismatch between meta and disk", async () => {
    const target = createInitializedProject("doctor-meta-diverged-hash");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Overwrite rule file content so hash no longer matches what's in meta
    writeFileSync(
      join(target, ".fabric", "rules", "packages", "server", "rules.md"),
      "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nHand-edited content.\n",
      "utf8",
    );

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).toContain("meta_manually_diverged");
    expect(report.checks.find((c) => c.name === "Meta manual divergence")?.status).toBe("warn");
    const warningMsg = report.checks.find((c) => c.name === "Meta manual divergence")?.message ?? "";
    expect(warningMsg).toContain("hash does not match");
  });

  it("meta_manually_diverged: passes when meta and filesystem are consistent", async () => {
    const target = createInitializedProject("doctor-meta-consistent");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).not.toContain("meta_manually_diverged");
    expect(report.checks.find((c) => c.name === "Meta manual divergence")?.status).toBe("ok");
  });

  it("TASK-031: stable_id_collision detected when two rule files declare the same stable_id", async () => {
    const target = createInitializedProject("doctor-stable-id-collision");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Create a second file with same stable_id as the existing rules/server rule
    writeFile(
      ".fabric/rules/packages/ui/rules.md",
      "<!-- fab:rule-id rules/server -->\n# UI (duplicate id)\n\n## [MANDATORY_INJECTION]\nUse components.\n",
      target,
    );

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).toContain("stable_id_collision");
    const check = report.checks.find((c) => c.name === "Stable ID collision");
    expect(check?.status).toBe("warn");
    expect(check?.message).toContain("rules/server");
    // Both file paths should be named
    expect(check?.message).toContain("packages/server/rules.md");
    expect(check?.message).toContain("packages/ui/rules.md");
  });

  it("TASK-031: stable_id_collision not reported when all stable_ids are unique", async () => {
    const target = createInitializedProject("doctor-stable-id-ok");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).not.toContain("stable_id_collision");
    expect(report.checks.find((c) => c.name === "Stable ID collision")?.status).toBe("ok");
  });

  it("TASK-030: rules_dir_unindexed detected when .md exists in rules dir but not in meta", async () => {
    const target = createInitializedProject("doctor-unindexed-detect");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Drop an unindexed rule file (not reconciled into meta)
    writeFile(".fabric/rules/packages/ui/rules.md", "<!-- fab:rule-id rules/ui -->\n# UI\n\n## [MANDATORY_INJECTION]\nUse components.\n", target);

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).toContain("rules_dir_unindexed");
    expect(report.checks.find((c) => c.name === "Rules dir unindexed")?.status).toBe("error");
  });

  it("TASK-030: --fix incorporates unindexed rule files via reconcileRules", async () => {
    const target = createInitializedProject("doctor-unindexed-fix");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Drop a new rule file that reconcile will pick up
    writeFile(".fabric/rules/packages/ui/rules.md", "<!-- fab:rule-id rules/ui -->\n# UI\n\n## [MANDATORY_INJECTION]\nUse components.\n", target);

    const before = await runDoctorReport(target);
    expect(before.fixable_errors.map((e) => e.code)).toContain("rules_dir_unindexed");

    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(fix.fixed.map((e) => e.code)).toContain("rules_dir_unindexed");
    expect(after.fixable_errors.map((e) => e.code)).not.toContain("rules_dir_unindexed");
    expect(after.checks.find((c) => c.name === "Rules dir unindexed")?.status).toBe("ok");
  });

  it("TASK-029: content_ref_missing is fixable — --fix via reconcileRules drops stale refs", async () => {
    const target = createInitializedProject("doctor-content-ref-fix");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Remove the rule file so its content_ref becomes missing in meta
    const { rmSync: nodeRmSync } = await import("node:fs");
    nodeRmSync(join(target, ".fabric", "rules", "packages", "server", "rules.md"), { force: true });

    const before = await runDoctorReport(target);
    expect(before.fixable_errors.map((e) => e.code)).toContain("content_ref_missing");

    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(fix.fixed.map((e) => e.code)).toContain("content_ref_missing");
    expect(after.fixable_errors.map((e) => e.code)).not.toContain("content_ref_missing");
  });

  it("TASK-026: doctor --fix bootstrap uses same builder as fab init (structurally equivalent)", async () => {
    const target = createProject("doctor-bootstrap-builder");
    writeFile("package.json", JSON.stringify({ name: "test-proj", dependencies: { vite: "^7.0.0" } }, null, 2), target);
    writeFile("src/main.ts", "export const boot = true;\n", target);

    const before = await runDoctorReport(target);
    expect(before.fixable_errors.map((e) => e.code)).toContain("bootstrap_missing");

    await runDoctorFix(target);

    const written = readFileSync(join(target, ".fabric", "bootstrap", "README.md"), "utf8");
    const expected = buildBootstrapContent(target);

    expect(written).toBe(expected);
    expect(written).toContain("Fabric Bootstrap Protocol");
    expect(written).toContain("test-proj");
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
