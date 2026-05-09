import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
    // v2.0: bootstrap_anchor_missing replaces bootstrap_missing; knowledge_dir_missing
    // replaces taxonomy_missing.
    expect(report.fixable_errors.map((issue) => issue.code)).toEqual([
      "bootstrap_anchor_missing",
      "knowledge_dir_missing",
      "agents_meta_missing",
      "rule_test_index_missing",
      "event_ledger_missing",
    ]);
    expect(report.manual_errors.map((issue) => issue.code)).toContain("content_refs_unavailable");
    expect(report.manual_errors.map((issue) => issue.code)).toEqual([
      "forensic_missing",
      "init_context_missing",
      "content_refs_unavailable",
    ]);
  });

  it("returns ok when target-state fabric artifacts are aligned (v2.0 bridged fixture)", async () => {
    // The existing initialized fixture seeds both the v2.0 layout (AGENTS.md +
    // .fabric/knowledge/* subdirs) and a legacy .fabric/rules/ tree so the
    // rule-meta-builder pipeline (still v1-coupled until TASK-003/TASK-004)
    // has something to index. As a result this fixture deliberately retains
    // the `.fabric/rules/` tree, which v2.0's `legacy_v1_artifacts_present`
    // visibility check will surface as a warning. That is expected here.
    const target = createInitializedProject("doctor-ok");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);

    expect(report.fixable_errors).toEqual([]);
    expect(report.manual_errors).toEqual([]);
    // Bridge fixture carries `.fabric/rules/`, which fires legacy_v1_artifacts_present.
    expect(report.warnings.map((w) => w.code)).toEqual(["legacy_v1_artifacts_present"]);
    // v2.0: 4 renames (net-zero) + counter_desync + legacy_v1_artifacts_present.
    // counter_desync is separated from stable_id_collision so that fixable_error
    // and warning signals can coexist cleanly (a single DoctorCheck entry has a
    // single status). Count: 19 v1.x → 21 v2.0.
    expect(report.checks.map((check) => check.name)).toEqual([
      "Bootstrap anchor",
      "Knowledge layout",
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
      "Knowledge dir unindexed",
      "Stable ID collision",
      "Knowledge counter desync",
      "Claude skill path",
      "Claude hook path",
      "Codex skill path",
      "Preexisting root markdown",
      "Legacy client paths",
      "Legacy v1 artifacts",
    ]);
    expect(report.checks).toHaveLength(21);
  });

  it("v2.0: clean post-init repo (mocked layout) reports zero errors AND zero warnings", async () => {
    // Done-when: fresh post-init v2.0 repo with mocked layout — no errors, no warnings.
    const target = createV2KnowledgeProject("doctor-v2-clean");
    await writeRuleMeta(target, { source: "doctor_fix" });

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).toEqual([]);
    expect(report.manual_errors.map((e) => e.code)).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toEqual([]);
    expect(report.status).toBe("ok");
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
    // bootstrap_anchor_missing remains because doctor --fix does NOT auto-create
    // AGENTS.md/CLAUDE.md (the canonical remediation is `fabric init`).
    // knowledge_dir_missing is fixable, so it should be cleared by --fix.
    expect(after.fixable_errors.map((issue) => issue.code)).toEqual([
      "bootstrap_anchor_missing",
    ]);
    expect(after.manual_errors.map((issue) => issue.code)).toEqual([
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

  it("TASK-032: all doctor checks with issues have a non-empty actionHint", async () => {
    // Minimal project that triggers most issue checks
    const target = createProject("doctor-action-hints");
    writeFile("package.json", JSON.stringify({ name: "test", dependencies: { vite: "^7.0.0" } }, null, 2), target);
    writeFile("src/main.ts", "export const boot = true;\n", target);
    // A rule file with duplicate stable_id to trigger stable_id_collision warning
    writeFile(".fabric/rules/a.md", "<!-- fab:rule-id dup -->\n# A\n\n## [MANDATORY_INJECTION]\nUse A.\n", target);
    writeFile(".fabric/rules/b.md", "<!-- fab:rule-id dup -->\n# B\n\n## [MANDATORY_INJECTION]\nUse B.\n", target);

    const report = await runDoctorReport(target);
    const issueChecks = report.checks.filter((c) => c.kind !== undefined);

    expect(issueChecks.length).toBeGreaterThan(0);
    for (const check of issueChecks) {
      expect(
        check.actionHint,
        `check "${check.name}" (code: ${check.code ?? "none"}) is missing actionHint`,
      ).toBeTruthy();
    }
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

  it("TASK-030 / v2.0: knowledge_dir_unindexed detected when .md exists in rules tree but not in meta", async () => {
    const target = createInitializedProject("doctor-unindexed-detect");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Drop an unindexed rule file (not reconciled into meta)
    writeFile(".fabric/rules/packages/ui/rules.md", "<!-- fab:rule-id rules/ui -->\n# UI\n\n## [MANDATORY_INJECTION]\nUse components.\n", target);

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).toContain("knowledge_dir_unindexed");
    expect(report.checks.find((c) => c.name === "Knowledge dir unindexed")?.status).toBe("error");
  });

  it("TASK-030 / v2.0: --fix incorporates unindexed rule files via reconcileRules", async () => {
    const target = createInitializedProject("doctor-unindexed-fix");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Drop a new rule file that reconcile will pick up
    writeFile(".fabric/rules/packages/ui/rules.md", "<!-- fab:rule-id rules/ui -->\n# UI\n\n## [MANDATORY_INJECTION]\nUse components.\n", target);

    const before = await runDoctorReport(target);
    expect(before.fixable_errors.map((e) => e.code)).toContain("knowledge_dir_unindexed");

    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(fix.fixed.map((e) => e.code)).toContain("knowledge_dir_unindexed");
    expect(after.fixable_errors.map((e) => e.code)).not.toContain("knowledge_dir_unindexed");
    expect(after.checks.find((c) => c.name === "Knowledge dir unindexed")?.status).toBe("ok");
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

  it("TASK-033: claude_skill_legacy_path: detects legacy path and not new path", async () => {
    const target = createInitializedProject("doctor-skill-legacy-detect");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Write SKILL.md at legacy location only
    writeFile(".claude/skills/agents-md-init/SKILL.md", "# SKILL\n[USER EDIT]\n", target);

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).toContain("claude_skill_legacy_path");
    expect(report.checks.find((c) => c.name === "Claude skill path")?.status).toBe("error");
  });

  it("TASK-033: claude_skill_legacy_path: --fix renames file preserving user content", async () => {
    const target = createInitializedProject("doctor-skill-legacy-fix");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const userContent = "# SKILL\n[USER EDIT] custom content\n";
    writeFile(".claude/skills/agents-md-init/SKILL.md", userContent, target);

    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(fix.fixed.map((e) => e.code)).toContain("claude_skill_legacy_path");
    expect(after.fixable_errors.map((e) => e.code)).not.toContain("claude_skill_legacy_path");
    expect(after.checks.find((c) => c.name === "Claude skill path")?.status).toBe("ok");

    // New path should have the user's content preserved (mv, not overwrite)
    const migratedContent = readFileSync(join(target, ".claude", "skills", "fabric-init", "SKILL.md"), "utf8");
    expect(migratedContent).toContain("[USER EDIT] custom content");
    // Legacy path should no longer exist
    const { existsSync: fsExists } = await import("node:fs");
    expect(fsExists(join(target, ".claude", "skills", "agents-md-init", "SKILL.md"))).toBe(false);
  });

  it("TASK-033: claude_skill_legacy_path: no detection when both paths absent", async () => {
    const target = createInitializedProject("doctor-skill-legacy-absent");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).not.toContain("claude_skill_legacy_path");
    expect(report.checks.find((c) => c.name === "Claude skill path")?.status).toBe("ok");
  });

  it("TASK-033: claude_skill_legacy_path: no detection when new path already exists (new wins)", async () => {
    const target = createInitializedProject("doctor-skill-legacy-new-wins");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Both legacy and new present — new wins; check should NOT fire
    writeFile(".claude/skills/agents-md-init/SKILL.md", "# SKILL old\n", target);
    writeFile(".claude/skills/fabric-init/SKILL.md", "# SKILL new\n", target);

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).not.toContain("claude_skill_legacy_path");
    expect(report.checks.find((c) => c.name === "Claude skill path")?.status).toBe("ok");
  });

  it("TASK-033: claude_skill_legacy_path: --fix writes claude_skill_path_migrated ledger event with from/to", async () => {
    const target = createInitializedProject("doctor-skill-legacy-ledger");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    writeFile(".claude/skills/agents-md-init/SKILL.md", "# SKILL\n", target);

    await runDoctorFix(target);

    const { events } = await readEventLedger(target);
    const migrationEvent = events.find((e) => e.event_type === "claude_skill_path_migrated");
    expect(migrationEvent).toBeDefined();
    if (migrationEvent?.event_type === "claude_skill_path_migrated") {
      expect(migrationEvent.from).toContain("agents-md-init");
      expect(migrationEvent.to).toContain("fabric-init");
    }
  });

  it("TASK-039: init_context_missing has actionHint pointing to fabric-init skill", async () => {
    const target = createProject("doctor-init-context-hint");
    writeFile("package.json", JSON.stringify({ name: "doctor-init-context-hint", dependencies: { vite: "^7.0.0" } }, null, 2), target);
    writeFile("src/main.ts", "export const boot = true;\n", target);

    const report = await runDoctorReport(target);

    const initCheck = report.checks.find((c) => c.code === "init_context_missing");
    expect(initCheck).toBeDefined();
    expect(initCheck?.actionHint).toBeTruthy();
    expect(initCheck?.actionHint).toContain("fabric-init");
    expect(initCheck?.actionHint).toContain("Claude Code");
  });

  it("TASK-037: legacy_client_path_present: detects deprecated clientPaths keys in fabric.config.json", async () => {
    const target = createInitializedProject("doctor-legacy-client-detect");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    writeFile(
      "fabric.config.json",
      JSON.stringify({ clientPaths: { windsurf: "/path/to/windsurf", claudeCodeCLI: "/path/claude" } }, null, 2),
      target,
    );

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).toContain("legacy_client_path_present");
    const check = report.checks.find((c) => c.name === "Legacy client paths");
    expect(check?.status).toBe("warn");
    expect(check?.message).toContain("windsurf");
    expect(check?.actionHint).toBeTruthy();
  });

  it("TASK-037: legacy_client_path_present: no detection when only valid clientPaths keys present", async () => {
    const target = createInitializedProject("doctor-legacy-client-absent");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    writeFile(
      "fabric.config.json",
      JSON.stringify({ clientPaths: { claudeCodeCLI: "/path/claude", codexCLI: "/path/codex" } }, null, 2),
      target,
    );

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).not.toContain("legacy_client_path_present");
    expect(report.checks.find((c) => c.name === "Legacy client paths")?.status).toBe("ok");
  });

  it("TASK-037: legacy_client_path_present: --fix removes deprecated keys and writes ledger event", async () => {
    const target = createInitializedProject("doctor-legacy-client-fix");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    writeFile(
      "fabric.config.json",
      JSON.stringify({
        clientPaths: {
          windsurf: "/path/windsurf",
          rooCode: "/path/roocode",
          geminiCLI: "/path/gemini",
          claudeCodeCLI: "/path/claude",
        },
      }, null, 2),
      target,
    );

    const before = await runDoctorReport(target);
    expect(before.warnings.map((w) => w.code)).toContain("legacy_client_path_present");

    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(fix.fixed.map((e) => e.code)).toContain("legacy_client_path_present");
    expect(after.warnings.map((w) => w.code)).not.toContain("legacy_client_path_present");
    expect(after.checks.find((c) => c.name === "Legacy client paths")?.status).toBe("ok");

    // Verify deprecated keys removed, valid key preserved
    const configJson = JSON.parse(readFileSync(join(target, "fabric.config.json"), "utf8")) as Record<string, unknown>;
    const clientPaths = configJson.clientPaths as Record<string, unknown>;
    expect(clientPaths).not.toHaveProperty("windsurf");
    expect(clientPaths).not.toHaveProperty("rooCode");
    expect(clientPaths).not.toHaveProperty("geminiCLI");
    expect(clientPaths).toHaveProperty("claudeCodeCLI");

    // Ledger event should record the removal
    const { events } = await readEventLedger(target);
    const legacyEvent = events.find((e) => e.event_type === "legacy_client_path_present");
    expect(legacyEvent).toBeDefined();
    if (legacyEvent?.event_type === "legacy_client_path_present") {
      expect((legacyEvent as Record<string, unknown>).removed).toEqual(
        expect.arrayContaining(["windsurf", "rooCode", "geminiCLI"]),
      );
    }
  });

  // -------------------------------------------------------------------------
  // v2.0 — TASK-006: 4 v1.x-coupled checks renamed + 1 new visibility check
  // -------------------------------------------------------------------------

  it("v2.0 / knowledge_dir_missing: fixable_error when any required subdir is absent", async () => {
    const target = createInitializedProject("doctor-knowledge-missing-detect");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Remove a single required subdir to trigger the check.
    rmSync(join(target, ".fabric", "knowledge", "pending"), { recursive: true, force: true });

    const report = await runDoctorReport(target);
    const codes = report.fixable_errors.map((e) => e.code);
    expect(codes).toContain("knowledge_dir_missing");
    const issue = report.fixable_errors.find((e) => e.code === "knowledge_dir_missing");
    expect(issue?.message).toContain(".fabric/knowledge/pending");
  });

  it("v2.0 / knowledge_dir_missing: --fix creates the missing subdirs (mkdir recursive)", async () => {
    const target = createInitializedProject("doctor-knowledge-missing-fix");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    rmSync(join(target, ".fabric", "knowledge", "pending"), { recursive: true, force: true });
    rmSync(join(target, ".fabric", "knowledge", "guidelines"), { recursive: true, force: true });

    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(fix.fixed.map((e) => e.code)).toContain("knowledge_dir_missing");
    expect(after.fixable_errors.map((e) => e.code)).not.toContain("knowledge_dir_missing");
    for (const sub of ["pending", "guidelines"]) {
      expect(existsSync(join(target, ".fabric", "knowledge", sub))).toBe(true);
    }
  });

  it("v2.0 / counter_desync: detected when stable_id counter exceeds counters envelope", async () => {
    // Use a minimal v2.0 fixture (no .fabric/rules/) so reconcileRules is not
    // triggered by stale-meta during --fix; this test focuses purely on the
    // counter_desync emission and downstream fix path.
    const target = createV2KnowledgeProject("doctor-counter-desync-detect");
    await writeRuleMeta(target, { source: "doctor_fix" });

    const metaPath = join(target, ".fabric", "agents.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    const nodes = meta.nodes as Record<string, Record<string, unknown>>;
    nodes["L0/manual-knowledge"] = {
      file: ".fabric/knowledge/decisions/example.md",
      content_ref: ".fabric/knowledge/decisions/example.md",
      scope_glob: "**",
      deps: [],
      priority: "medium",
      level: "L0",
      layer: "L0",
      topology_type: "mirror",
      hash: "deadbeef",
      stable_id: "KP-DEC-0007",
      identity_source: "declared",
    };
    meta.counters = { KP: { MOD: 0, DEC: 5, GLD: 0, PIT: 0, PRO: 0 }, KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 } };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

    const report = await runDoctorReport(target);
    expect(report.fixable_errors.map((e) => e.code)).toContain("counter_desync");
    const check = report.checks.find((c) => c.name === "Knowledge counter desync");
    expect(check?.status).toBe("error");
    expect(check?.message).toContain("KP.DEC");
  });

  it("v2.0 / counter_desync: --fix bumps counters.KP.DEC to max(observed, current)", async () => {
    const target = createV2KnowledgeProject("doctor-counter-desync-fix");
    await writeRuleMeta(target, { source: "doctor_fix" });

    const metaPath = join(target, ".fabric", "agents.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    const nodes = meta.nodes as Record<string, Record<string, unknown>>;
    nodes["L0/manual-knowledge"] = {
      file: ".fabric/knowledge/decisions/example.md",
      content_ref: ".fabric/knowledge/decisions/example.md",
      scope_glob: "**",
      deps: [],
      priority: "medium",
      level: "L0",
      layer: "L0",
      topology_type: "mirror",
      hash: "deadbeef",
      stable_id: "KP-DEC-0007",
      identity_source: "declared",
    };
    meta.counters = { KP: { MOD: 0, DEC: 5, GLD: 0, PIT: 0, PRO: 0 }, KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 } };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

    const fix = await runDoctorFix(target);
    expect(fix.fixed.map((e) => e.code)).toContain("counter_desync");

    const updated = JSON.parse(readFileSync(metaPath, "utf8")) as { counters: { KP: { DEC: number } } };
    expect(updated.counters.KP.DEC).toBe(7);
  });

  it("v2.0 / bootstrap_anchor_missing: passes when AGENTS.md or CLAUDE.md exists at repo root", async () => {
    const target = createInitializedProject("doctor-anchor-agents");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);
    expect(report.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_anchor_missing");
    expect(report.checks.find((c) => c.name === "Bootstrap anchor")?.status).toBe("ok");
  });

  it("v2.0 / bootstrap_anchor_missing: passes when CLAUDE.md alone exists (no AGENTS.md)", async () => {
    const target = createInitializedProject("doctor-anchor-claude-only");
    rmSync(join(target, "AGENTS.md"), { force: true });
    writeFile("CLAUDE.md", "# CLAUDE\n", target);
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);
    expect(report.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_anchor_missing");
    expect(report.checks.find((c) => c.name === "Bootstrap anchor")?.status).toBe("ok");
  });

  it("v2.0 / bootstrap_anchor_missing: fixable_error when neither AGENTS.md nor CLAUDE.md exists", async () => {
    const target = createInitializedProject("doctor-anchor-missing");
    rmSync(join(target, "AGENTS.md"), { force: true });
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);
    const issue = report.fixable_errors.find((e) => e.code === "bootstrap_anchor_missing");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("AGENTS.md");
    expect(issue?.message).toContain("CLAUDE.md");
  });

  it("v2.0 / legacy_v1_artifacts_present: warn (not error) when .fabric/rules/ exists post-upgrade", async () => {
    // Manually re-create a v1 artifact after init to simulate a half-migrated repo.
    const target = createInitializedProject("doctor-legacy-v1-rules");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);
    // .fabric/rules/ is already seeded by createInitializedProject, so the
    // legacy artifacts check should already fire in the bridged fixture.

    const report = await runDoctorReport(target);
    const issue = report.warnings.find((w) => w.code === "legacy_v1_artifacts_present");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain(".fabric/rules");
    // Must remain a warning (visibility-only, not an error).
    expect(report.checks.find((c) => c.name === "Legacy v1 artifacts")?.status).toBe("warn");
  });

  it("v2.0 / legacy_v1_artifacts_present: NOT auto-fixable (no --fix codepath)", async () => {
    const target = createInitializedProject("doctor-legacy-v1-not-fixable");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const fix = await runDoctorFix(target);
    expect(fix.fixed.map((e) => e.code)).not.toContain("legacy_v1_artifacts_present");
    // Artifact should still be present after --fix run (we never delete user data).
    expect(existsSync(join(target, ".fabric", "rules"))).toBe(true);
  });

  it("v2.0 / fix_does_not_regenerate_v1_taxonomy_or_bootstrap: --fix on a fresh v2.0 project does NOT recreate v1 paths", async () => {
    const target = createProject("doctor-fix-no-regen-v1");
    writeFile("package.json", JSON.stringify({ name: "doctor-fix-no-regen-v1", dependencies: { vite: "^7.0.0" } }, null, 2), target);
    writeFile("src/main.ts", "export const boot = true;\n", target);
    writeFile("AGENTS.md", "# AGENTS\n", target);

    await runDoctorFix(target);

    // After --fix, NONE of these v1.x paths should exist (TASK-001 deleted them).
    expect(existsSync(join(target, ".fabric", "INITIAL_TAXONOMY.md"))).toBe(false);
    expect(existsSync(join(target, ".fabric", "bootstrap"))).toBe(false);
    expect(existsSync(join(target, ".fabric", "bootstrap", "README.md"))).toBe(false);
  });

  it("v2.0 / TASK-031 regression: stable_id_collision still detected for legacy fab:rule-id markers", async () => {
    const target = createInitializedProject("doctor-stable-id-collision-regression");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    writeFile(
      ".fabric/rules/packages/ui/rules.md",
      "<!-- fab:rule-id rules/server -->\n# UI (duplicate)\n\n## [MANDATORY_INJECTION]\nUse components.\n",
      target,
    );

    const report = await runDoctorReport(target);
    expect(report.warnings.map((w) => w.code)).toContain("stable_id_collision");
  });

  it("v2.0 / stable_id_collision: detects collisions across knowledge frontmatter ids", async () => {
    const target = createInitializedProject("doctor-stable-id-collision-knowledge");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const fmA = "---\nid: KT-DEC-0001\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-09T00:00:00Z\n---\n# A\n";
    const fmB = "---\nid: KT-DEC-0001\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-09T00:00:00Z\n---\n# B\n";
    writeFile(".fabric/knowledge/decisions/a.md", fmA, target);
    writeFile(".fabric/knowledge/decisions/b.md", fmB, target);

    const report = await runDoctorReport(target);
    expect(report.warnings.map((w) => w.code)).toContain("stable_id_collision");
    const check = report.checks.find((c) => c.name === "Stable ID collision");
    expect(check?.message).toContain("KT-DEC-0001");
    expect(check?.message).toContain(".fabric/knowledge/decisions/a.md");
    expect(check?.message).toContain(".fabric/knowledge/decisions/b.md");
  });
});

function createInitializedProject(name: string): string {
  const target = createProject(name);
  writeFile("package.json", JSON.stringify({ name, dependencies: { vite: "^7.0.0" } }, null, 2), target);
  writeFile("src/main.ts", "export const boot = true;\n", target);

  // v2.0 bootstrap anchor at the repo root (AGENTS.md or CLAUDE.md is sufficient).
  writeFile("AGENTS.md", "# AGENTS\nFabric v2.0 bootstrap anchor.\n", target);

  // v2.0 knowledge layout — six required subdirectories.
  for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
    mkdirSync(join(target, ".fabric", "knowledge", sub), { recursive: true });
  }

  writeFile(".fabric/init-context.json", JSON.stringify({ confirmed: true }, null, 2), target);
  writeFile(".fabric/forensic.json", JSON.stringify(createForensic(target, name), null, 2), target);
  // Continue to seed a legacy .fabric/rules/ entry so that rule-meta-builder
  // (still v1-coupled until TASK-003/TASK-004 land) has something to index.
  // This lets the wider test suite verify reconcile/meta machinery while the
  // v2.0 doctor checks observe the new repo-root + knowledge layout.
  writeFile(".fabric/rules/packages/server/rules.md", "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services.\n", target);
  writeFile("packages/server/rules.contract.test.ts", "// @fabric-verify rules/server\nexpect(true).toBe(true);\n", target);
  return target;
}

function createProject(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  tempRoots.push(root);
  return root;
}

// Minimal v2.0 knowledge fixture: AGENTS.md anchor + all knowledge subdirs +
// init/forensic/events seeded + a hand-crafted, internally-consistent
// agents.meta.json (empty nodes, default counters envelope) + a matching
// rule-test.index.json. Does NOT seed any .fabric/rules/ tree, so
// rule-meta-builder rebuilds an identical empty meta and reconcile is
// not triggered by --fix.
function createV2KnowledgeProject(name: string): string {
  const target = createProject(name);
  writeFile("package.json", JSON.stringify({ name, dependencies: { vite: "^7.0.0" } }, null, 2), target);
  writeFile("src/main.ts", "export const boot = true;\n", target);
  writeFile("AGENTS.md", "# AGENTS\n", target);

  for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
    mkdirSync(join(target, ".fabric", "knowledge", sub), { recursive: true });
  }

  writeFile(".fabric/init-context.json", JSON.stringify({ confirmed: true }, null, 2), target);
  writeFile(".fabric/forensic.json", JSON.stringify(createForensic(target, name), null, 2), target);
  writeFile(".fabric/events.jsonl", "", target);
  // Defer to writeRuleMeta() at the test site after this returns; that gives us a
  // canonical empty agents.meta.json + rule-test.index.json that match what
  // rule-meta-builder produces, so neither agents_meta_stale nor
  // rule_test_index_stale fires.
  return target;
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
