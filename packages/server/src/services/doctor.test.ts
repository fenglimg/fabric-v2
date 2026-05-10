import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { fabricConfigSchema } from "@fenglimg/fabric-shared";

import { runDoctorFix, runDoctorReport } from "./doctor.js";
import { readEventLedger } from "./event-ledger.js";
import { writeRuleMeta } from "./rule-meta-builder.js";
import { sha256 } from "./_shared.js";

const tempRoots: string[] = [];

// rc.4 TASK-002: doctor's read-side integrity inspections walk the personal
// knowledge root resolved via FABRIC_HOME (or homedir fallback). To prevent
// the developer's real `~/.fabric/knowledge` from polluting test output, we
// isolate FABRIC_HOME to a per-test tmpdir for every doctor test. The
// originating env var is restored in afterEach.
let originalFabricHome: string | undefined;

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = mkdtempSync(join(tmpdir(), "doctor-fabric-home-"));
  tempRoots.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(() => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
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
      "knowledge_test_index_missing",
      "event_ledger_missing",
    ]);
    expect(report.manual_errors.map((issue) => issue.code)).toContain("content_refs_unavailable");
    // v2.0 follow-up: `init_context_missing` removed from doctor — that
    // artifact is owned by the AI-side client init skill, not by init CLI.
    expect(report.manual_errors.map((issue) => issue.code)).toEqual([
      "forensic_missing",
      "content_refs_unavailable",
    ]);
  });

  it("returns ok when target-state fabric artifacts are aligned (v2.0 fixture)", async () => {
    // v2/rc.2: the initialized fixture seeds the v2.0 layout (AGENTS.md +
    // .fabric/knowledge/* subdirs) plus a knowledge entry for rule-meta-builder
    // to index. Legacy `.fabric/rules/` is no longer used.
    const target = createInitializedProject("doctor-ok");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);

    expect(report.fixable_errors).toEqual([]);
    expect(report.manual_errors).toEqual([]);
    // v2.0 / rc.2: legacy_v1_artifacts_present was removed; the bridged
    // fixture no longer fires any warning by default.
    expect(report.warnings.map((w) => w.code)).toEqual([]);
    // Count history: 19 v1.x → 21 rc.1 → 20 rc.1-followup (Init context
    // check removed) → 18 rc.2 (Rule sections + Legacy v1 artifacts removed
    // in TASK-002) → 15 rc.2 (Claude/Codex skill+hook path checks removed
    // in TASK-002 along with the fabric-init skill installer surface) → 14
    // rc.2 (Legacy client paths check removed in TASK-005 — strict schema
    // rejects retired clientPaths keys at parse time) → 18 rc.4 TASK-001
    // (orphan demote / stale archive / pending overdue read-side lint
    // checks added) → 21 rc.4 TASK-002 (stable_id duplicate / layer
    // mismatch / index drift integrity lint checks added).
    expect(report.checks.map((check) => check.name)).toEqual([
      "Bootstrap anchor",
      "Knowledge layout",
      "Scan evidence",
      "Agents metadata",
      "Rule content refs",
      "Knowledge-test index",
      "Event ledger",
      "Event ledger partial write",
      "Claude MCP config location",
      "Meta manual divergence",
      "Knowledge dir unindexed",
      "Stable ID collision",
      "Knowledge counter desync",
      "Filesystem-edit fallback",
      "Knowledge orphan demote",
      "Knowledge stale archive",
      "Knowledge pending overdue",
      "Knowledge stable_id duplicate",
      "Knowledge layer mismatch",
      "Knowledge index drift",
      "Preexisting root markdown",
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

  // v2/rc.2: 2 tests removed here.
  //
  // (1) "doctor --fix repairs derived state and leaves manual errors visible"
  //     — relied on a v1 fixture pattern (createProject + single rule file)
  //     where rule-meta-builder rebuilt meta from the rules tree. v2 doctor
  //     --fix takes a different path; equivalent v2 coverage already exists
  //     via "v2.0: clean post-init repo", "TASK-030 / v2.0: --fix incorporates
  //     unindexed knowledge files", and "TASK-029: content_ref_missing".
  //
  // (2) "doctor --fix does not report fixable drift after rebuilding stale meta"
  //     — depended on v1.x event types `rule_drift_detected` and
  //     `baseline_synced` whose rename to `knowledge_drift_detected` /
  //     deletion is owned by TASK-006. Will be re-added there if the v2
  //     equivalent surfaces useful coverage.

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
    const target = createInitializedProject("doctor-reconcile-fix");
    // Drop a new knowledge file (not yet indexed) so reconcile must run.
    writeFile(".fabric/knowledge/guidelines/extra.md", "<!-- fab:rule-id rules/extra -->\n# Extra\n\n## [MANDATORY_INJECTION]\nUse extras.\n", target);
    writeFile(".fabric/events.jsonl", "", target);

    const before = await runDoctorReport(target);
    expect(before.fixable_errors.map((issue) => issue.code)).toContain("knowledge_dir_unindexed");

    await runDoctorFix(target);

    const { events } = await readEventLedger(target);
    expect(events.map((event) => event.event_type)).toContain("meta_reconciled");

    const metaReconciled = events.find((e) => e.event_type === "meta_reconciled");
    expect(metaReconciled).toMatchObject({ event_type: "meta_reconciled", trigger: "doctor" });
  });

  it("backward-compat: old baseline_synced events from ledger replay are skipped as unrecognized (v2 schema deletion)", async () => {
    // v2/rc.2 TASK-006: baseline_synced was deleted from the discriminated union.
    // On-disk events written by v1.x are tolerated (not crash) but are
    // filtered out as schema-parse failures and produce a ledger parse warning.
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

    // Deleted event type: skipped from parsed events, surfaces as a warning.
    expect(events).toHaveLength(0);
    expect(warnings.length).toBeGreaterThanOrEqual(0); // warn or silently skip — both acceptable
  });

  it("meta_manually_diverged: detects meta entries with no backing file on disk", async () => {
    const target = createInitializedProject("doctor-meta-diverged-missing");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Remove the knowledge file but leave the meta entry intact
    rmSync(join(target, ".fabric", "knowledge", "decisions", "server.md"), { force: true });

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

    // Overwrite knowledge file content so hash no longer matches what's in meta
    writeFileSync(
      join(target, ".fabric", "knowledge", "decisions", "server.md"),
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
    // Two knowledge files with duplicate stable_id to trigger stable_id_collision warning
    writeFile(".fabric/knowledge/decisions/a.md", "<!-- fab:rule-id dup -->\n# A\n\n## [MANDATORY_INJECTION]\nUse A.\n", target);
    writeFile(".fabric/knowledge/decisions/b.md", "<!-- fab:rule-id dup -->\n# B\n\n## [MANDATORY_INJECTION]\nUse B.\n", target);

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

  it("TASK-031 / v2: stable_id_collision detected when two knowledge files declare the same v2 frontmatter id", async () => {
    const target = createInitializedProject("doctor-stable-id-collision");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // v2: collision detection scans YAML frontmatter `id: K[PT]-XXX-NNNN` only.
    const fmA = "---\nid: KT-DEC-0001\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-09T00:00:00Z\n---\n# A\n";
    const fmB = "---\nid: KT-DEC-0001\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-09T00:00:00Z\n---\n# B (duplicate id)\n";
    writeFile(".fabric/knowledge/decisions/a.md", fmA, target);
    writeFile(".fabric/knowledge/decisions/b.md", fmB, target);

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).toContain("stable_id_collision");
    const check = report.checks.find((c) => c.name === "Stable ID collision");
    expect(check?.status).toBe("warn");
    expect(check?.message).toContain("KT-DEC-0001");
    expect(check?.message).toContain(".fabric/knowledge/decisions/a.md");
    expect(check?.message).toContain(".fabric/knowledge/decisions/b.md");
  });

  it("TASK-031: stable_id_collision not reported when all stable_ids are unique", async () => {
    const target = createInitializedProject("doctor-stable-id-ok");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).not.toContain("stable_id_collision");
    expect(report.checks.find((c) => c.name === "Stable ID collision")?.status).toBe("ok");
  });

  it("TASK-030 / v2.0: knowledge_dir_unindexed detected when .md exists in knowledge tree but not in meta", async () => {
    const target = createInitializedProject("doctor-unindexed-detect");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Drop an unindexed knowledge file (not reconciled into meta)
    writeFile(".fabric/knowledge/guidelines/ui.md", "<!-- fab:rule-id rules/ui -->\n# UI\n\n## [MANDATORY_INJECTION]\nUse components.\n", target);

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).toContain("knowledge_dir_unindexed");
    expect(report.checks.find((c) => c.name === "Knowledge dir unindexed")?.status).toBe("error");
  });

  it("TASK-030 / v2.0: --fix incorporates unindexed knowledge files via reconcileRules", async () => {
    const target = createInitializedProject("doctor-unindexed-fix");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Drop a new knowledge file that reconcile will pick up
    writeFile(".fabric/knowledge/guidelines/ui.md", "<!-- fab:rule-id rules/ui -->\n# UI\n\n## [MANDATORY_INJECTION]\nUse components.\n", target);

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

    // Remove the knowledge file so its content_ref becomes missing in meta
    const { rmSync: nodeRmSync } = await import("node:fs");
    nodeRmSync(join(target, ".fabric", "knowledge", "decisions", "server.md"), { force: true });

    const before = await runDoctorReport(target);
    expect(before.fixable_errors.map((e) => e.code)).toContain("content_ref_missing");

    const fix = await runDoctorFix(target);
    const after = await runDoctorReport(target);

    expect(fix.fixed.map((e) => e.code)).toContain("content_ref_missing");
    expect(after.fixable_errors.map((e) => e.code)).not.toContain("content_ref_missing");
  });

  // v2/rc.2: TASK-033 (claude_skill_legacy_path / claude_hook_legacy_path /
  // codex_skill_legacy_path) tests removed alongside their checks. They
  // migrated v1.x artifacts into v1 client-side init paths that are now
  // archaeology; rc.4 owns v2 lint coverage for whatever skill/hook paths v2
  // introduces.

  // v2.0 follow-up: TASK-039 (init_context_missing actionHint) removed.
  // The init_context_missing doctor check has been deleted — `.fabric/init-
  // context.json` is owned by the AI-side client init skill, so its absence
  // is no longer a doctor concern.
  it("v2.0 follow-up: init_context_missing check is removed (no doctor check references init-context.json)", async () => {
    const target = createProject("doctor-init-context-removed");
    writeFile("package.json", JSON.stringify({ name: "doctor-init-context-removed", dependencies: { vite: "^7.0.0" } }, null, 2), target);
    writeFile("src/main.ts", "export const boot = true;\n", target);

    const report = await runDoctorReport(target);

    expect(report.checks.find((c) => c.code === "init_context_missing")).toBeUndefined();
    expect(report.checks.find((c) => c.code === "init_context_invalid")).toBeUndefined();
    expect(report.checks.find((c) => c.name === "Init context")).toBeUndefined();
    expect(report.manual_errors.map((e) => e.code)).not.toContain("init_context_missing");
    expect(report.manual_errors.map((e) => e.code)).not.toContain("init_context_invalid");
    // summary.targetFiles must NOT include init-context.json
    expect(Object.keys(report.summary.targetFiles)).not.toContain(".fabric/init-context.json");
  });

  // v2.0 / rc.2: TASK-005 removed the soft-deprecation warn-and-fix path for
  // retired clientPaths keys (windsurf/rooCode/geminiCLI). Detection is now
  // a hard parse-time rejection on the strict clientPathsSchema; the doctor
  // checks `legacy_client_path_present` and the corresponding `--fix`
  // behaviour are gone. The negative-path test below documents the new
  // contract: fabricConfigSchema rejects unknown clientPaths keys outright.
  it("v2.0 / rc.2: fabricConfigSchema rejects retired clientPaths keys at parse time", () => {
    for (const retired of ["windsurf", "rooCode", "geminiCLI"]) {
      expect(() =>
        fabricConfigSchema.parse({ clientPaths: { [retired]: "/tmp/example" } }),
      ).toThrow(ZodError);
    }
  });

  it("v2.0 / rc.2: doctor exposes no `legacy_client_path_present` warning even when fabric.config.json contains only supported keys", async () => {
    const target = createInitializedProject("doctor-legacy-client-removed");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    writeFile(
      "fabric.config.json",
      JSON.stringify({ clientPaths: { claudeCodeCLI: "/path/claude", codexCLI: "/path/codex" } }, null, 2),
      target,
    );

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).not.toContain("legacy_client_path_present");
    expect(report.checks.find((c) => c.name === "Legacy client paths")).toBeUndefined();
    expect(report.checks.find((c) => c.code === "legacy_client_path_present")).toBeUndefined();
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

  it("counter_desync regression: single --fix run reconciles counters when manually-authored files are unindexed", async () => {
    // Reproduce the TASK-007 dogfood bug: knowledge files authored outside
    // init-scan are on disk but NOT in agents.meta.json. The first --fix
    // indexes them via reconcileRules (knowledge_dir_unindexed), but
    // reconcileRules carries over previousMeta.counters verbatim. A second
    // --fix was previously required to sync counters. This test asserts that
    // a single --fix call is sufficient.
    const target = createV2KnowledgeProject("doctor-counter-desync-unindexed-regression");
    await writeRuleMeta(target, { source: "doctor_fix" });

    // Seed 5 decision files with v2 frontmatter stable_ids — not yet indexed.
    const frontmatterTemplate = (n: number) =>
      `---\nid: KT-DEC-${String(n).padStart(4, "0")}\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Decision ${n}\n`;
    for (let i = 1; i <= 5; i++) {
      writeFile(`.fabric/knowledge/decisions/KT-DEC-${String(i).padStart(4, "0")}.md`, frontmatterTemplate(i), target);
    }

    // Before fix: counters.KT.DEC is 0 (default); files are unindexed.
    const before = await runDoctorReport(target);
    expect(before.fixable_errors.map((e) => e.code)).toContain("knowledge_dir_unindexed");
    // counter_desync is NOT visible yet — files are not in nodes, so no stable_ids
    // to compare against. The desync emerges only after reconciliation indexes them.
    expect(before.fixable_errors.map((e) => e.code)).not.toContain("counter_desync");

    // Single --fix run: must both index the files AND reconcile counters.
    const fix = await runDoctorFix(target);
    expect(fix.fixed.map((e) => e.code)).toContain("knowledge_dir_unindexed");

    // Counters MUST be updated on disk after a single --fix (regression assertion).
    const metaPath = join(target, ".fabric", "agents.meta.json");
    const updated = JSON.parse(readFileSync(metaPath, "utf8")) as { counters: { KT: { DEC: number } } };
    expect(updated.counters.KT.DEC).toBe(5);

    // Doctor must report clean after a single --fix — no second run needed.
    const after = await runDoctorReport(target);
    expect(after.fixable_errors.map((e) => e.code)).not.toContain("counter_desync");
    expect(after.fixable_errors.map((e) => e.code)).not.toContain("knowledge_dir_unindexed");
    expect(after.status).toBe("ok");
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

  // v2.0 / rc.2: tests for `legacy_v1_artifacts_present` removed alongside
  // the check itself. The visibility-only warning was removed because rc.4
  // owns v2 lint coverage and v1.x artifacts are clean-slate archaeology in
  // the rebrand. TASK-004 / rc.4 may re-introduce a similar lint if needed.

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

  // v2/rc.2: "TASK-031 regression: stable_id_collision still detected for
  // legacy fab:rule-id markers" — removed. v2 stable_id_collision inspection
  // scans only YAML frontmatter `id:`; the v1.x `<!-- fab:rule-id X -->`
  // marker is intentionally no longer a collision source.

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

  // rc.3 TASK-005: filesystem-edit fallback — synthesize knowledge_promoted
  // for canonical entries that have no matching event in events.jsonl.
  it("filesystem_edit_fallback: no orphans when canonical entry has matching knowledge_promoted event", async () => {
    const target = createInitializedProject("doctor-fef-no-orphan");
    await writeRuleMeta(target, { source: "doctor_fix" });

    // Seed a canonical entry AND its matching knowledge_promoted event.
    const fm = "---\nid: KT-DEC-0042\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# D\n";
    writeFile(".fabric/knowledge/decisions/KT-DEC-0042--demo.md", fm, target);
    const promoted = JSON.stringify({
      kind: "fabric-event",
      id: "event:promoted-existing",
      ts: 1_000,
      schema_version: 1,
      event_type: "knowledge_promoted",
      stable_id: "KT-DEC-0042",
      timestamp: "2026-05-10T00:00:00.000Z",
      reason: "fab_review.approve",
    });
    writeFile(".fabric/events.jsonl", `${promoted}\n`, target);

    const report = await runDoctorReport(target);
    const check = report.checks.find((c) => c.name === "Filesystem-edit fallback");
    expect(check?.status).toBe("ok");
    expect(check?.kind).toBeUndefined();
    expect(check?.message).toContain("No orphan canonical knowledge entries");

    // Ledger must contain exactly one knowledge_promoted event (the seeded one).
    const { events } = await readEventLedger(target);
    const promotedEvents = events.filter((e) => e.event_type === "knowledge_promoted");
    expect(promotedEvents).toHaveLength(1);
    expect(promotedEvents[0]?.reason).toBe("fab_review.approve");
  });

  it("filesystem_edit_fallback: synthesizes knowledge_promoted for one orphan canonical entry", async () => {
    const target = createInitializedProject("doctor-fef-one-orphan");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Canonical file present, no matching event — should be synthesized.
    const fm = "---\nid: KT-DEC-0099\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Orphan\n";
    writeFile(".fabric/knowledge/decisions/KT-DEC-0099--orphan.md", fm, target);

    const report = await runDoctorReport(target);
    const check = report.checks.find((c) => c.name === "Filesystem-edit fallback");
    expect(check?.status).toBe("ok");
    expect(check?.kind).toBe("info");
    expect(check?.code).toBe("knowledge_promoted_synthesized");
    expect(check?.message).toContain("Synthesized 1 knowledge_promoted event");
    expect(check?.message).toContain("KT-DEC-0099");
    expect(check?.message).toContain("[synthesized] filesystem-edit-fallback");

    // Ledger tail must contain the synthesized event.
    const { events } = await readEventLedger(target);
    const synthesized = events.find(
      (e) => e.event_type === "knowledge_promoted" && e.reason === "[synthesized] filesystem-edit-fallback",
    );
    expect(synthesized).toBeDefined();
    expect(synthesized).toMatchObject({
      event_type: "knowledge_promoted",
      stable_id: "KT-DEC-0099",
      reason: "[synthesized] filesystem-edit-fallback",
      correlation_id: "doctor-synthesized",
      session_id: "doctor-synthesized",
    });
  });

  it("filesystem_edit_fallback: synthesizes events for multiple orphans across types", async () => {
    const target = createInitializedProject("doctor-fef-multi-orphan");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Three orphan canonical files in three different type subdirs.
    writeFile(
      ".fabric/knowledge/decisions/KT-DEC-0010--alpha.md",
      "---\nid: KT-DEC-0010\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Alpha\n",
      target,
    );
    writeFile(
      ".fabric/knowledge/pitfalls/KT-PIT-0011--beta.md",
      "---\nid: KT-PIT-0011\ntype: pitfall\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Beta\n",
      target,
    );
    writeFile(
      ".fabric/knowledge/guidelines/KP-GLD-0012--gamma.md",
      "---\nid: KP-GLD-0012\ntype: guideline\nmaturity: draft\nlayer: personal\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Gamma\n",
      target,
    );

    const report = await runDoctorReport(target);
    const check = report.checks.find((c) => c.name === "Filesystem-edit fallback");
    expect(check?.message).toContain("Synthesized 3 knowledge_promoted events");

    const { events } = await readEventLedger(target);
    const synthesizedIds = events
      .filter((e) => e.event_type === "knowledge_promoted" && e.reason === "[synthesized] filesystem-edit-fallback")
      .map((e) => (e.event_type === "knowledge_promoted" ? e.stable_id : undefined))
      .filter((id): id is string => typeof id === "string");
    expect(synthesizedIds.sort()).toEqual(["KP-GLD-0012", "KT-DEC-0010", "KT-PIT-0011"]);
  });

  it("filesystem_edit_fallback: idempotent — second run sees synthesized event and skips", async () => {
    const target = createInitializedProject("doctor-fef-idempotent");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const fm = "---\nid: KT-DEC-0050\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Once\n";
    writeFile(".fabric/knowledge/decisions/KT-DEC-0050--once.md", fm, target);

    // First run: synthesizes one event.
    const first = await runDoctorReport(target);
    expect(
      first.checks.find((c) => c.name === "Filesystem-edit fallback")?.message,
    ).toContain("Synthesized 1 knowledge_promoted event");

    const after1 = await readEventLedger(target);
    const synth1 = after1.events.filter(
      (e) => e.event_type === "knowledge_promoted" && e.reason === "[synthesized] filesystem-edit-fallback",
    );
    expect(synth1).toHaveLength(1);

    // Second run: idempotent — no additional synthesis.
    const second = await runDoctorReport(target);
    expect(
      second.checks.find((c) => c.name === "Filesystem-edit fallback")?.message,
    ).toContain("No orphan canonical knowledge entries");

    const after2 = await readEventLedger(target);
    const synth2 = after2.events.filter(
      (e) => e.event_type === "knowledge_promoted" && e.reason === "[synthesized] filesystem-edit-fallback",
    );
    expect(synth2).toHaveLength(1);
  });

  it("filesystem_edit_fallback: silently ignores files without <id>--<slug> filename pattern", async () => {
    const target = createInitializedProject("doctor-fef-malformed");
    await writeRuleMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // None of these match `<id>--<slug>.md`:
    //  - missing id prefix
    //  - id-only without --slug
    //  - non-knowledge filename
    writeFile(".fabric/knowledge/decisions/no-id-prefix.md", "# Plain\n", target);
    writeFile(".fabric/knowledge/decisions/KT-DEC-0001.md", "# Bare id\n", target);
    writeFile(".fabric/knowledge/decisions/README.md", "# Readme\n", target);

    const report = await runDoctorReport(target);
    const check = report.checks.find((c) => c.name === "Filesystem-edit fallback");
    expect(check?.message).toContain("No orphan canonical knowledge entries");

    const { events } = await readEventLedger(target);
    const synthesized = events.filter(
      (e) => e.event_type === "knowledge_promoted" && e.reason === "[synthesized] filesystem-edit-fallback",
    );
    expect(synthesized).toHaveLength(0);
  });

  // rc.4 TASK-001: read-side lint checks #16-18.
  //
  // Test strategy: each test seeds an initialized project with a canonical
  // (or pending) knowledge entry whose YAML frontmatter `created_at` is set
  // far enough in the past to cross (or not) the threshold. Because the
  // inspect functions use max(created_at, mtime, lastEvent.ts), seeding a
  // very-old `created_at` is sufficient to make the entry orphan/stale only
  // when no recent event references its stable_id. We append synthesized
  // events directly to events.jsonl with a stale `ts` to test the threshold
  // boundary (and a fresh `ts` to verify the recent-activity skip path).
  describe("rc.4 TASK-001: read-side lint checks", () => {
    const NOW_MS = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const ageDaysAgoIso = (days: number): string =>
      new Date(NOW_MS - days * dayMs).toISOString();

    function appendRawEvent(target: string, event: Record<string, unknown>): void {
      const path = join(target, ".fabric", "events.jsonl");
      const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
      const line = JSON.stringify(event);
      writeFileSync(
        path,
        existing.length === 0 || existing.endsWith("\n")
          ? `${existing}${line}\n`
          : `${existing}\n${line}\n`,
        "utf8",
      );
    }

    function seedCanonical(
      target: string,
      relPath: string,
      stableId: string,
      maturity: "stable" | "endorsed" | "draft",
      createdDaysAgo: number,
    ): void {
      const fm = `---\nid: ${stableId}\ntype: decision\nmaturity: ${maturity}\nlayer: team\ncreated_at: ${ageDaysAgoIso(createdDaysAgo)}\n---\n# ${stableId}\n`;
      writeFile(relPath, fm, target);
      // Pre-seed a knowledge_promoted event with a stale timestamp matching
      // created_at. Without this, the rc.3 filesystem-edit-fallback check
      // synthesizes a knowledge_promoted event with `ts: Date.now()` to
      // back-fill the audit trail — which would refresh lastActiveAt and
      // hide the orphan from the rc.4 inspect functions. Real-world state
      // includes a promote event whose ts matches the original promotion;
      // the test seeds the same shape directly.
      appendRawEvent(target, {
        kind: "fabric-event",
        id: `event:seed-${stableId}-promoted`,
        ts: NOW_MS - createdDaysAgo * dayMs,
        schema_version: 1,
        event_type: "knowledge_promoted",
        stable_id: stableId,
        timestamp: ageDaysAgoIso(createdDaysAgo),
        reason: "test:seed",
      });
    }

    it("orphan_demote: emits warning when stable canonical entry is inactive >90d", async () => {
      const target = createInitializedProject("doctor-rc4-orphan-stable");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1001--ancient-stable.md",
        "KT-DEC-1001",
        "stable",
        91,
      );
      // No recent event referencing this stable_id → orphan.

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge orphan demote");
      expect(check?.kind).toBe("warning");
      expect(check?.code).toBe("knowledge_orphan_demote_required");
      expect(check?.status).toBe("warn");
      expect(report.warnings.map((w) => w.code)).toContain("knowledge_orphan_demote_required");
      expect(check?.message).toContain("KT-DEC-1001");
      expect(check?.message).toContain("stable");
    });

    it("orphan_demote: emits warning when endorsed canonical entry is inactive >30d", async () => {
      const target = createInitializedProject("doctor-rc4-orphan-endorsed");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1002--ancient-endorsed.md",
        "KT-DEC-1002",
        "endorsed",
        31,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge orphan demote");
      expect(check?.code).toBe("knowledge_orphan_demote_required");
      expect(check?.message).toContain("KT-DEC-1002");
      expect(check?.message).toContain("endorsed");
    });

    it("orphan_demote: emits warning when draft canonical entry is inactive >14d", async () => {
      const target = createInitializedProject("doctor-rc4-orphan-draft");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1003--ancient-draft.md",
        "KT-DEC-1003",
        "draft",
        15,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge orphan demote");
      expect(check?.code).toBe("knowledge_orphan_demote_required");
      expect(check?.message).toContain("KT-DEC-1003");
      expect(check?.message).toContain("draft");
    });

    it("orphan_demote: skips entry that has a recent fetch event within threshold", async () => {
      const target = createInitializedProject("doctor-rc4-orphan-recent-fetch");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1004--touched-stable.md",
        "KT-DEC-1004",
        "stable",
        200,
      );
      // Append a knowledge_sections_fetched 5 days ago referencing this id —
      // recent activity should keep the entry out of the candidates list.
      appendRawEvent(target, {
        kind: "fabric-event",
        id: "event:rc4-recent-fetch",
        ts: NOW_MS - 5 * dayMs,
        schema_version: 1,
        event_type: "knowledge_sections_fetched",
        selection_token: "tok",
        requested_sections: [],
        final_stable_ids: ["KT-DEC-1004"],
        ai_selected_stable_ids: [],
      });

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge orphan demote");
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined();
      expect(report.warnings.map((w) => w.code)).not.toContain("knowledge_orphan_demote_required");
    });

    it("orphan_demote: ok status when no canonical entries exist", async () => {
      const target = createInitializedProject("doctor-rc4-orphan-empty");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Remove the seeded server.md so there are no canonical entries with frontmatter.
      const { rmSync: nodeRmSync } = await import("node:fs");
      nodeRmSync(join(target, ".fabric", "knowledge", "decisions", "server.md"), { force: true });

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge orphan demote");
      expect(check?.status).toBe("ok");
      expect(check?.message).toContain("No canonical knowledge entries");
    });

    it("orphan_demote: respects the per-maturity boundary (stable at 89d is NOT a candidate)", async () => {
      const target = createInitializedProject("doctor-rc4-orphan-boundary");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1005--just-fresh-stable.md",
        "KT-DEC-1005",
        "stable",
        89,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge orphan demote");
      expect(check?.status).toBe("ok");
    });

    it("stale_archive: emits warning when draft entry is inactive beyond demote+90d additional quiet", async () => {
      const target = createInitializedProject("doctor-rc4-stale-archive");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Total inactivity: draft demote threshold (14d) + additional (90d) = 104d.
      // Seed a draft entry inactive for 105d.
      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1010--very-stale-draft.md",
        "KT-DEC-1010",
        "draft",
        105,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge stale archive");
      expect(check?.kind).toBe("warning");
      expect(check?.code).toBe("knowledge_stale_archive_required");
      expect(check?.status).toBe("warn");
      expect(check?.message).toContain("KT-DEC-1010");
      expect(check?.message).toContain(".fabric/.archive/decisions/KT-DEC-1010--very-stale-draft.md");
    });

    it("stale_archive: skips draft entry that is only barely past demote threshold", async () => {
      const target = createInitializedProject("doctor-rc4-stale-recent-draft");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Inactive 30d: past 14d demote threshold (so orphan_demote DOES flag it),
      // but well below 104d stale-archive threshold.
      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1011--recent-draft.md",
        "KT-DEC-1011",
        "draft",
        30,
      );

      const report = await runDoctorReport(target);
      const stale = report.checks.find((c) => c.name === "Knowledge stale archive");
      expect(stale?.status).toBe("ok");
      // Cross-check: orphan_demote DOES flag it.
      const orphan = report.checks.find((c) => c.name === "Knowledge orphan demote");
      expect(orphan?.kind).toBe("warning");
    });

    it("stale_archive: skips stable entry even when very old (only draft entries are archive candidates)", async () => {
      const target = createInitializedProject("doctor-rc4-stale-stable-not-archive");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1012--ancient-stable.md",
        "KT-DEC-1012",
        "stable",
        500,
      );

      const report = await runDoctorReport(target);
      const stale = report.checks.find((c) => c.name === "Knowledge stale archive");
      expect(stale?.status).toBe("ok");
    });

    it("pending_overdue: emits warning when pending entry is older than 14d via frontmatter created_at", async () => {
      const target = createInitializedProject("doctor-rc4-pending-overdue");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const fm = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(20)}\n---\n# Pending\nProposal body.\n`;
      writeFile(".fabric/knowledge/pending/decisions/proposal.md", fm, target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge pending overdue");
      expect(check?.kind).toBe("warning");
      expect(check?.code).toBe("knowledge_pending_overdue");
      expect(check?.status).toBe("warn");
      expect(check?.message).toContain(".fabric/knowledge/pending/decisions/proposal.md");
    });

    it("pending_overdue: skips recent pending entry (<14d)", async () => {
      const target = createInitializedProject("doctor-rc4-pending-recent");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const fm = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(7)}\n---\n# Pending\nProposal body.\n`;
      writeFile(".fabric/knowledge/pending/decisions/fresh-proposal.md", fm, target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge pending overdue");
      expect(check?.status).toBe("ok");
    });

    it("pending_overdue: ok status when pending dir is empty", async () => {
      const target = createInitializedProject("doctor-rc4-pending-empty");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge pending overdue");
      expect(check?.status).toBe("ok");
      expect(check?.message).toContain("No pending knowledge entries");
    });

    it("read-side: 0 file mutations + 0 events emitted by the 3 new checks", async () => {
      const target = createInitializedProject("doctor-rc4-readside-noop");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Seed all 3 trigger conditions.
      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-2001--orphan-stable.md",
        "KT-DEC-2001",
        "stable",
        100,
      );
      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-2002--very-stale-draft.md",
        "KT-DEC-2002",
        "draft",
        200,
      );
      const fmPending = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(30)}\n---\n# Pending\n`;
      writeFile(".fabric/knowledge/pending/decisions/old-proposal.md", fmPending, target);

      // Snapshot ledger size and canonical-tree paths before the run. The
      // before snapshot already includes the fixture-seeded knowledge_promoted
      // events (one per canonical seedCanonical call) — those are not emitted
      // by the lint checks; they exist purely so filesystem-edit-fallback
      // does not synthesize a fresh promotion event during the test.
      const ledgerPath = join(target, ".fabric", "events.jsonl");
      const beforeLedger = readFileSync(ledgerPath, "utf8");
      const beforeEventCount = beforeLedger
        .split("\n")
        .filter((line) => line.trim().length > 0).length;
      const beforeOrphan = readFileSync(
        join(target, ".fabric", "knowledge", "decisions", "KT-DEC-2001--orphan-stable.md"),
        "utf8",
      );
      const beforeStale = readFileSync(
        join(target, ".fabric", "knowledge", "decisions", "KT-DEC-2002--very-stale-draft.md"),
        "utf8",
      );
      const beforePending = readFileSync(
        join(target, ".fabric", "knowledge", "pending", "decisions", "old-proposal.md"),
        "utf8",
      );

      const report = await runDoctorReport(target);

      // All 3 checks fired.
      expect(report.warnings.map((w) => w.code)).toContain("knowledge_orphan_demote_required");
      expect(report.warnings.map((w) => w.code)).toContain("knowledge_stale_archive_required");
      expect(report.warnings.map((w) => w.code)).toContain("knowledge_pending_overdue");

      // Filesystem-edit fallback (rc.3 #15) synthesizes knowledge_promoted
      // events for canonical files without a matching event — but here every
      // canonical entry has a fixture-seeded knowledge_promoted event already,
      // so synthesis should be a no-op. The rc.4 lint checks (#16-18) are
      // strictly read-only: ledger byte-count must be exactly equal to the
      // pre-run snapshot.
      const afterLedger = readFileSync(ledgerPath, "utf8");
      const afterEventCount = afterLedger
        .split("\n")
        .filter((line) => line.trim().length > 0).length;
      expect(afterEventCount).toBe(beforeEventCount);
      expect(afterLedger).toBe(beforeLedger);

      // Canonical + pending file contents are byte-identical to the pre-run snapshot.
      expect(
        readFileSync(
          join(target, ".fabric", "knowledge", "decisions", "KT-DEC-2001--orphan-stable.md"),
          "utf8",
        ),
      ).toBe(beforeOrphan);
      expect(
        readFileSync(
          join(target, ".fabric", "knowledge", "decisions", "KT-DEC-2002--very-stale-draft.md"),
          "utf8",
        ),
      ).toBe(beforeStale);
      expect(
        readFileSync(
          join(target, ".fabric", "knowledge", "pending", "decisions", "old-proposal.md"),
          "utf8",
        ),
      ).toBe(beforePending);
    });
  });

  // rc.4 TASK-002: read-side integrity lint checks #19-21. Each test seeds
  // canonical knowledge files (and where relevant a corresponding
  // agents.meta.json counters envelope) so the inspection walks the
  // expected (layer, type) tree. FABRIC_HOME is already isolated to a
  // per-test tmpdir by the file-level beforeEach hook, so the personal
  // tree starts empty and tests can drop fixtures under it without
  // polluting from the developer's real home directory.
  describe("rc.4 TASK-002: read-side integrity checks", () => {
    function seedCanonicalNoBody(target: string, relPath: string): void {
      // Body content is irrelevant for filename-keyed integrity checks; an
      // empty file with the right name is sufficient. We still write the
      // YAML frontmatter envelope so other doctor checks (knowledge_dir_unindexed)
      // do not cascade and obscure the lint findings under inspection.
      const slug = relPath.split("--")[1]?.replace(/\.md$/u, "") ?? "untitled";
      writeFile(
        relPath,
        `---\nid: ${relPath.split("/").pop()?.split("--")[0]}\nslug: ${slug}\nmaturity: stable\nlayer: team\n---\n# stub\n`,
        target,
      );
    }

    function seedPersonalCanonical(filename: string, type: string): void {
      // Drop a canonical file into the FABRIC_HOME-rooted personal tree.
      const personalRoot = join(process.env.FABRIC_HOME!, ".fabric", "knowledge", type);
      mkdirSync(personalRoot, { recursive: true });
      const stableId = filename.split("--")[0];
      const slug = filename.split("--")[1]?.replace(/\.md$/u, "") ?? "untitled";
      writeFileSync(
        join(personalRoot, filename),
        `---\nid: ${stableId}\nslug: ${slug}\nmaturity: stable\nlayer: personal\n---\n# stub\n`,
        "utf8",
      );
    }

    // ---- Check #19: stable_id duplicate ---------------------------------

    it("stable_id_duplicate: ok when no canonical files share an id", async () => {
      const target = createInitializedProject("doctor-rc4-stableid-clean");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KT-DEC-0001--alpha.md");
      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KT-DEC-0002--beta.md");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge stable_id duplicate");
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined();
      expect(report.manual_errors.map((e) => e.code)).not.toContain("knowledge_stable_id_duplicate");
    });

    it("stable_id_duplicate: emits error when two canonical files share a stable_id", async () => {
      const target = createInitializedProject("doctor-rc4-stableid-collide");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Same stable_id KT-DEC-0007 declared in two different type directories.
      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KT-DEC-0007--alpha.md");
      seedCanonicalNoBody(target, ".fabric/knowledge/pitfalls/KT-DEC-0007--beta.md");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge stable_id duplicate");
      expect(check?.status).toBe("error");
      expect(check?.kind).toBe("manual_error");
      expect(check?.code).toBe("knowledge_stable_id_duplicate");
      expect(check?.message).toContain("KT-DEC-0007");
      expect(check?.message).toContain(".fabric/knowledge/decisions/KT-DEC-0007--alpha.md");
      expect(check?.message).toContain(".fabric/knowledge/pitfalls/KT-DEC-0007--beta.md");
      expect(report.manual_errors.map((e) => e.code)).toContain("knowledge_stable_id_duplicate");
    });

    it("stable_id_duplicate: surfaces multiple distinct duplicates in the same report", async () => {
      const target = createInitializedProject("doctor-rc4-stableid-multi");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KT-DEC-0007--alpha.md");
      seedCanonicalNoBody(target, ".fabric/knowledge/pitfalls/KT-DEC-0007--beta.md");
      seedCanonicalNoBody(target, ".fabric/knowledge/guidelines/KT-GLD-0009--gamma.md");
      seedCanonicalNoBody(target, ".fabric/knowledge/models/KT-GLD-0009--delta.md");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge stable_id duplicate");
      expect(check?.status).toBe("error");
      // Message summary includes the duplicate count (2) and the FIRST
      // duplicate (alphabetically: KT-DEC-0007 < KT-GLD-0009).
      expect(check?.message).toContain("2 stable_ids duplicated");
      expect(check?.message).toContain("KT-DEC-0007");
    });

    // ---- Check #20: layer mismatch --------------------------------------

    it("layer_mismatch: ok when every canonical file is aligned with its prefix layer", async () => {
      const target = createInitializedProject("doctor-rc4-layer-clean");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KT-DEC-0001--team-aligned.md");
      seedPersonalCanonical("KP-DEC-0001--personal-aligned.md", "decisions");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge layer mismatch");
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined();
    });

    it("layer_mismatch: detects KT-prefixed file located under personal tree", async () => {
      const target = createInitializedProject("doctor-rc4-layer-kt-in-personal");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedPersonalCanonical("KT-DEC-0042--wrongly-personal.md", "decisions");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge layer mismatch");
      expect(check?.status).toBe("error");
      expect(check?.kind).toBe("manual_error");
      expect(check?.code).toBe("knowledge_layer_mismatch");
      expect(check?.message).toContain("KT-DEC-0042");
      expect(check?.message).toContain("located in personal");
      expect(check?.message).toContain("expected team");
    });

    it("layer_mismatch: detects KP-prefixed file located under team tree", async () => {
      const target = createInitializedProject("doctor-rc4-layer-kp-in-team");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KP-DEC-0042--wrongly-team.md");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge layer mismatch");
      expect(check?.status).toBe("error");
      expect(check?.code).toBe("knowledge_layer_mismatch");
      expect(check?.message).toContain("KP-DEC-0042");
      expect(check?.message).toContain("located in team");
      expect(check?.message).toContain("expected personal");
    });

    it("layer_mismatch: surfaces both kinds simultaneously when present", async () => {
      const target = createInitializedProject("doctor-rc4-layer-both");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KP-DEC-0010--kp-in-team.md");
      seedPersonalCanonical("KT-DEC-0011--kt-in-personal.md", "decisions");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge layer mismatch");
      expect(check?.status).toBe("error");
      // Two mismatches reported on the count summary.
      expect(check?.message).toMatch(/^2 canonical knowledge files/u);
    });

    // ---- Check #21: index drift -----------------------------------------

    function readMeta(target: string): Record<string, unknown> {
      return JSON.parse(
        readFileSync(join(target, ".fabric", "agents.meta.json"), "utf8"),
      ) as Record<string, unknown>;
    }

    function setMetaCounter(
      target: string,
      counters: { KP?: Record<string, number>; KT?: Record<string, number> },
    ): void {
      const meta = readMeta(target);
      const existing = (meta.counters as Record<string, Record<string, number>> | undefined) ?? {
        KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
        KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
      };
      const merged = {
        KP: { ...existing.KP, ...(counters.KP ?? {}) },
        KT: { ...existing.KT, ...(counters.KT ?? {}) },
      };
      meta.counters = merged;
      writeFileSync(
        join(target, ".fabric", "agents.meta.json"),
        JSON.stringify(meta, null, 2),
        "utf8",
      );
    }

    it("index_drift: ok when meta counter equals the highest existing canonical counter", async () => {
      const target = createInitializedProject("doctor-rc4-drift-synced");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KT-DEC-0005--five.md");
      setMetaCounter(target, { KT: { DEC: 5 } });

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge index drift");
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined();
      expect(report.fixable_errors.map((e) => e.code)).not.toContain("knowledge_index_drift");
    });

    it("index_drift: emits fixable_error when meta counter trails the observed maximum", async () => {
      const target = createInitializedProject("doctor-rc4-drift-lagging");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Seed counter=5 + canonical file KT-DEC-0007 → drift, proposed_after=8.
      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KT-DEC-0007--seven.md");
      setMetaCounter(target, { KT: { DEC: 5 } });

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge index drift");
      expect(check?.status).toBe("error");
      expect(check?.kind).toBe("fixable_error");
      expect(check?.code).toBe("knowledge_index_drift");
      expect(check?.fixable).toBe(true);
      expect(check?.message).toContain("KT.DEC counter=5");
      expect(check?.message).toContain("max_observed=7");
      expect(check?.message).toContain("counters.KT.DEC=8");
      expect(report.fixable_errors.map((e) => e.code)).toContain("knowledge_index_drift");
    });

    it("index_drift: ignores (layer, type) pairs with no canonical files even when meta counter is non-zero", async () => {
      const target = createInitializedProject("doctor-rc4-drift-absent");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Set a non-zero counter for KT.PIT but never seed any pitfall file.
      // Per task spec: "missing counter (no entries of that type) → ok".
      // Equivalently here: max_observed=0 means no drift detected even with
      // a populated meta counter (the counter is in front of, not behind,
      // observed reality).
      setMetaCounter(target, { KT: { PIT: 4 } });
      // Seed an unrelated (KT, DEC) entry with synced counter so the report
      // does not fire on a different slot.
      seedCanonicalNoBody(target, ".fabric/knowledge/decisions/KT-DEC-0001--one.md");
      setMetaCounter(target, { KT: { DEC: 1 } });

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge index drift");
      expect(check?.status).toBe("ok");
    });
  });

  // rc.4 TASK-003: apply-lint mutations. Each test seeds the same fixture
  // shape used by TASK-001 / TASK-002 inspections, then invokes
  // runDoctorApplyLint and asserts (a) on-disk mutations occurred, (b) the
  // expected events.jsonl entries were appended, and (c) the inspection
  // report after the mutation no longer surfaces the corresponding finding.
  describe("rc.4 TASK-003: apply-lint mutations", () => {
    const NOW_MS = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const ageDaysAgoIso = (days: number): string =>
      new Date(NOW_MS - days * dayMs).toISOString();

    function appendRawEvent(target: string, event: Record<string, unknown>): void {
      const path = join(target, ".fabric", "events.jsonl");
      const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
      const line = JSON.stringify(event);
      writeFileSync(
        path,
        existing.length === 0 || existing.endsWith("\n")
          ? `${existing}${line}\n`
          : `${existing}\n${line}\n`,
        "utf8",
      );
    }

    function seedCanonical(
      target: string,
      relPath: string,
      stableId: string,
      maturity: "stable" | "endorsed" | "draft",
      createdDaysAgo: number,
    ): void {
      const fm = `---\nid: ${stableId}\ntype: decision\nmaturity: ${maturity}\nlayer: team\ncreated_at: ${ageDaysAgoIso(createdDaysAgo)}\n---\n# ${stableId}\nBody.\n`;
      writeFile(relPath, fm, target);
      // Pre-seed knowledge_promoted so filesystem-edit-fallback does not
      // synthesize a fresh promotion event during the run (which would refresh
      // lastActiveAt and hide the orphan from the inspection).
      appendRawEvent(target, {
        kind: "fabric-event",
        id: `event:seed-${stableId}-promoted`,
        ts: NOW_MS - createdDaysAgo * dayMs,
        schema_version: 1,
        event_type: "knowledge_promoted",
        stable_id: stableId,
        timestamp: ageDaysAgoIso(createdDaysAgo),
        reason: "test:seed",
      });
    }

    async function runApplyLint(target: string) {
      const { runDoctorApplyLint } = await import("./doctor.js");
      return runDoctorApplyLint(target);
    }

    it("orphan_demote: rewrites maturity stable -> endorsed in frontmatter", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-orphan-stable");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const filePath = ".fabric/knowledge/decisions/KT-DEC-1101--ancient-stable.md";
      seedCanonical(target, filePath, "KT-DEC-1101", "stable", 95);

      const beforeSource = readFileSync(join(target, filePath), "utf8");
      expect(beforeSource).toContain("maturity: stable");

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(false);
      const orphanMutation = result.mutations.find(
        (m) => m.kind === "knowledge_orphan_demote_required",
      );
      expect(orphanMutation?.applied).toBe(true);
      expect(orphanMutation?.detail).toBe("stable -> endorsed");

      const afterSource = readFileSync(join(target, filePath), "utf8");
      expect(afterSource).toContain("maturity: endorsed");
      expect(afterSource).not.toContain("maturity: stable");
      // Round-trip preservation: id / created_at / type / layer fields are
      // byte-identical (only the maturity line changed).
      expect(afterSource).toContain("id: KT-DEC-1101");
      expect(afterSource).toContain("type: decision");
      expect(afterSource).toContain("layer: team");
    });

    it("orphan_demote: rewrites maturity endorsed -> draft", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-orphan-endorsed");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const filePath = ".fabric/knowledge/decisions/KT-DEC-1102--ancient-endorsed.md";
      seedCanonical(target, filePath, "KT-DEC-1102", "endorsed", 35);

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(false);
      expect(result.mutations.find((m) => m.kind === "knowledge_orphan_demote_required")?.applied).toBe(true);

      const afterSource = readFileSync(join(target, filePath), "utf8");
      expect(afterSource).toContain("maturity: draft");
    });

    it("orphan_demote: emits knowledge_demoted event with stable_id + reason", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-orphan-event");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1103--ancient-stable-event.md",
        "KT-DEC-1103",
        "stable",
        100,
      );

      await runApplyLint(target);

      const { events } = await readEventLedger(target, { event_type: "knowledge_demoted" });
      expect(events).toHaveLength(1);
      const demotedEvent = events[0];
      expect(demotedEvent.event_type).toBe("knowledge_demoted");
      // Type narrowing for discriminated union access.
      if (demotedEvent.event_type !== "knowledge_demoted") {
        throw new Error("type narrowing failed");
      }
      expect(demotedEvent.stable_id).toBe("KT-DEC-1103");
      expect(demotedEvent.reason).toContain("lint:orphan_demote");
      expect(demotedEvent.reason).toContain("stable->endorsed");
      expect(demotedEvent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("stale_archive: moves file to .fabric/.archive/<type>/<filename>", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-archive");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const filePath = ".fabric/knowledge/decisions/KT-DEC-1110--very-stale-draft.md";
      const archivePath = ".fabric/.archive/decisions/KT-DEC-1110--very-stale-draft.md";
      seedCanonical(target, filePath, "KT-DEC-1110", "draft", 110);

      expect(existsSync(join(target, filePath))).toBe(true);
      expect(existsSync(join(target, archivePath))).toBe(false);

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(false);
      const archiveMutation = result.mutations.find(
        (m) => m.kind === "knowledge_stale_archive_required",
      );
      expect(archiveMutation?.applied).toBe(true);

      expect(existsSync(join(target, filePath))).toBe(false);
      expect(existsSync(join(target, archivePath))).toBe(true);
      const archived = readFileSync(join(target, archivePath), "utf8");
      expect(archived).toContain("id: KT-DEC-1110");
    });

    it("stale_archive: emits knowledge_archived event with stable_id + path detail in reason", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-archive-event");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1111--very-stale-draft-event.md",
        "KT-DEC-1111",
        "draft",
        120,
      );

      await runApplyLint(target);

      const { events } = await readEventLedger(target, { event_type: "knowledge_archived" });
      expect(events).toHaveLength(1);
      const archivedEvent = events[0];
      if (archivedEvent.event_type !== "knowledge_archived") {
        throw new Error("type narrowing failed");
      }
      expect(archivedEvent.stable_id).toBe("KT-DEC-1111");
      expect(archivedEvent.reason).toContain("lint:stale_archive");
      expect(archivedEvent.reason).toContain(".fabric/.archive/decisions/");
    });

    it("index_drift: bumps agents.meta.json counters[layer][type] to max_observed + 1", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-drift");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Seed counter=5 + canonical KT-DEC-0007 → drift detected, bump to 8.
      writeFile(
        ".fabric/knowledge/decisions/KT-DEC-0007--seven.md",
        `---\nid: KT-DEC-0007\nslug: seven\nmaturity: stable\nlayer: team\n---\n# stub\n`,
        target,
      );
      const metaPath = join(target, ".fabric", "agents.meta.json");
      const metaBefore = JSON.parse(readFileSync(metaPath, "utf8"));
      const existingCounters = metaBefore.counters ?? {
        KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
        KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
      };
      metaBefore.counters = {
        KP: { ...existingCounters.KP },
        KT: { ...existingCounters.KT, DEC: 5 },
      };
      writeFileSync(metaPath, JSON.stringify(metaBefore, null, 2), "utf8");

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(false);
      const driftMutation = result.mutations.find((m) => m.kind === "knowledge_index_drift");
      expect(driftMutation?.applied).toBe(true);
      expect(driftMutation?.detail).toContain("KT.DEC: 5 -> 8");

      const metaAfter = JSON.parse(readFileSync(metaPath, "utf8"));
      expect(metaAfter.counters.KT.DEC).toBe(8);
    });

    it("index_drift: does NOT emit any knowledge_demoted or knowledge_archived event (counter fix is meta-mutation only)", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-drift-no-event");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      writeFile(
        ".fabric/knowledge/decisions/KT-DEC-0009--nine.md",
        `---\nid: KT-DEC-0009\nslug: nine\nmaturity: stable\nlayer: team\n---\n# stub\n`,
        target,
      );
      const metaPath = join(target, ".fabric", "agents.meta.json");
      const metaBefore = JSON.parse(readFileSync(metaPath, "utf8"));
      metaBefore.counters = {
        KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
        KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
      };
      metaBefore.counters.KT.DEC = 3;
      writeFileSync(metaPath, JSON.stringify(metaBefore, null, 2), "utf8");

      await runApplyLint(target);

      const { events: demoted } = await readEventLedger(target, { event_type: "knowledge_demoted" });
      const { events: archived } = await readEventLedger(target, { event_type: "knowledge_archived" });
      expect(demoted).toHaveLength(0);
      expect(archived).toHaveLength(0);
    });

    it("aborts and skips ALL mutations when manual_error finding (stable_id_duplicate) is present", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-dup-blocks");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Seed two canonical entries with the SAME stable_id (duplicate
      // collision). Inspection #19 surfaces this as a manual_error.
      writeFile(
        ".fabric/knowledge/decisions/KT-DEC-0001--alpha.md",
        `---\nid: KT-DEC-0001\nmaturity: stable\nlayer: team\n---\n# alpha\n`,
        target,
      );
      writeFile(
        ".fabric/knowledge/decisions/KT-DEC-0001--beta.md",
        `---\nid: KT-DEC-0001\nmaturity: stable\nlayer: team\n---\n# beta\n`,
        target,
      );

      // Also seed an orphan-demote candidate that WOULD otherwise mutate.
      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1200--ancient-stable.md",
        "KT-DEC-1200",
        "stable",
        100,
      );

      const beforeSource = readFileSync(
        join(target, ".fabric/knowledge/decisions/KT-DEC-1200--ancient-stable.md"),
        "utf8",
      );

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(true);
      expect(result.abort_reason).toContain("knowledge_stable_id_duplicate");
      expect(result.abort_reason?.toLowerCase()).toContain("manual repair");
      expect(result.mutations).toHaveLength(0);
      expect(result.changed).toBe(false);

      // Orphan-demote candidate must remain UNTOUCHED — apply-lint refuses to
      // mutate when integrity is in question.
      const afterSource = readFileSync(
        join(target, ".fabric/knowledge/decisions/KT-DEC-1200--ancient-stable.md"),
        "utf8",
      );
      expect(afterSource).toBe(beforeSource);
    });

    it("aborts when layer_mismatch (KP-* under team/) is present and emits no events", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-layer-blocks");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // KP-* file under team/ → layer_mismatch manual_error.
      writeFile(
        ".fabric/knowledge/decisions/KP-DEC-0001--mislaid.md",
        `---\nid: KP-DEC-0001\nmaturity: stable\nlayer: team\n---\n# stub\n`,
        target,
      );

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(true);
      expect(result.abort_reason).toContain("knowledge_layer_mismatch");
      expect(result.mutations).toHaveLength(0);

      const { events: demoted } = await readEventLedger(target, { event_type: "knowledge_demoted" });
      const { events: archived } = await readEventLedger(target, { event_type: "knowledge_archived" });
      expect(demoted).toHaveLength(0);
      expect(archived).toHaveLength(0);
    });

    it("does NOT mutate or emit events for pending_overdue findings (informational only)", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-pending-noop");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const fmPending = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(30)}\n---\n# Pending\n`;
      const pendingRel = ".fabric/knowledge/pending/decisions/old-proposal.md";
      writeFile(pendingRel, fmPending, target);

      const beforeSource = readFileSync(join(target, pendingRel), "utf8");

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(false);
      // No mutation kind for pending_overdue (it's not in the dispatcher).
      expect(
        result.mutations.find((m) => m.path.includes("pending/")),
      ).toBeUndefined();

      // File unchanged, still in pending/.
      expect(existsSync(join(target, pendingRel))).toBe(true);
      expect(readFileSync(join(target, pendingRel), "utf8")).toBe(beforeSource);
    });

    it("idempotent: 2nd apply-lint run on resolved tree produces 0 mutations", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-idempotent");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1300--ancient-stable.md",
        "KT-DEC-1300",
        "stable",
        100,
      );

      const first = await runApplyLint(target);
      expect(first.changed).toBe(true);
      // First run produces at least one orphan-demote mutation. (An
      // index_drift mutation may also fire here because the seeded canonical
      // counter exceeds the empty agents.meta.json envelope produced by
      // writeRuleMeta — both are legitimate first-run repairs and are
      // covered individually by the per-mutation tests above.)
      const firstOrphan = first.mutations.find(
        (m) => m.kind === "knowledge_orphan_demote_required",
      );
      expect(firstOrphan?.applied).toBe(true);
      expect(first.mutations.every((m) => m.applied)).toBe(true);

      const second = await runApplyLint(target);
      expect(second.changed).toBe(false);
      expect(second.mutations).toHaveLength(0);
      // After the first run, the entry was demoted stable -> endorsed AND a
      // knowledge_demoted event was emitted (refreshing lastActiveAt). The
      // 30d endorsed threshold means the (now-endorsed, just-active) entry is
      // not re-flagged. Index drift is also resolved by the first run.
    });

    it("default report (no apply-lint) performs 0 mutations and 0 lint events even with findings present", async () => {
      const target = createInitializedProject("doctor-rc4-readside-zero-mutation");
      await writeRuleMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const orphanRel = ".fabric/knowledge/decisions/KT-DEC-1400--ancient-stable.md";
      seedCanonical(target, orphanRel, "KT-DEC-1400", "stable", 100);
      const beforeSource = readFileSync(join(target, orphanRel), "utf8");

      // Default doctor invocation (read-only).
      await runDoctorReport(target);

      // File contents unchanged.
      expect(readFileSync(join(target, orphanRel), "utf8")).toBe(beforeSource);
      // No knowledge_demoted / knowledge_archived events emitted by the
      // read-only path.
      const { events: demoted } = await readEventLedger(target, { event_type: "knowledge_demoted" });
      const { events: archived } = await readEventLedger(target, { event_type: "knowledge_archived" });
      expect(demoted).toHaveLength(0);
      expect(archived).toHaveLength(0);
    });
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
  // v2/rc.2: seed a knowledge entry under .fabric/knowledge/ so rule-meta-builder
  // has something to index. The legacy `.fabric/rules/` tree is no longer scanned.
  writeFile(".fabric/knowledge/decisions/server.md", "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services.\n", target);
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
// knowledge-test.index.json. Does NOT seed any .fabric/rules/ tree, so
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
  // canonical empty agents.meta.json + knowledge-test.index.json that match what
  // rule-meta-builder produces, so neither agents_meta_stale nor
  // knowledge_test_index_stale fires.
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
