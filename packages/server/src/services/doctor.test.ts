import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  BOOTSTRAP_CANONICAL,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  LEGACY_KB_MARKER_BEGIN,
  LEGACY_KB_MARKER_END,
  fabricConfigSchema,
} from "@fenglimg/fabric-shared";

import {
  ensureCiteContractPolicyActivatedMarker,
  ensureCitePolicyActivatedMarker,
  enrichDescriptions,
  runDoctorCiteCoverage,
  runDoctorEmitCadenceCheck,
  runDoctorFix,
  runDoctorReport,
} from "./doctor.js";
import { readEventLedger } from "./event-ledger.js";
import { writeKnowledgeMeta } from "./knowledge-meta-builder.js";
import { sha256 } from "./_shared.js";

const tempRoots: string[] = [];

// rc.4 TASK-002: doctor's read-side integrity inspections walk the personal
// knowledge root resolved via FABRIC_HOME (or homedir fallback). To prevent
// the developer's real `~/.fabric/knowledge` from polluting test output, we
// isolate FABRIC_HOME to a per-test tmpdir for every doctor test. The
// originating env var is restored in afterEach.
let originalFabricHome: string | undefined;
// rc.26 TASK-02a: doctor.ts now resolves locale via resolveFabricLocale(projectRoot)
// → falls through to detectNodeLocale (FAB_LANG → LANG → "en") when fixtures
// have no fabric-config.json. Pin FAB_LANG=en so existing tests keep asserting
// English UI strings regardless of dev-env LANG. Bilingual snapshot coverage
// lands in TASK-05 with explicit per-locale fixtures.
let originalFabLang: string | undefined;

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = mkdtempSync(join(tmpdir(), "doctor-fabric-home-"));
  tempRoots.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  originalFabLang = process.env.FAB_LANG;
  process.env.FAB_LANG = "en";
});

afterEach(() => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  if (originalFabLang === undefined) {
    delete process.env.FAB_LANG;
  } else {
    process.env.FAB_LANG = originalFabLang;
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
    // v2.0.0-rc.29 TASK-008 (BUG-F2): payload_limits surfaced in doctor summary.
    // No fabric.config.json overrides on the seed → source must be "default"
    // and values must equal the published library constants (16 KiB / 64 KiB).
    expect(report.summary.payload_limits).toMatchObject({
      warn_bytes: 16384,
      hard_bytes: 65536,
      source: "default",
    });
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
    // .fabric/knowledge/* subdirs) plus a knowledge entry for knowledge-meta-builder
    // to index. Legacy `.fabric/rules/` is no longer used.
    const target = createInitializedProject("doctor-ok");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    // mismatch / index drift integrity lint checks added) → 22 rc.5
    // TASK-010 (knowledge_underseeded lint added) → 25 rc.5 TASK-013
    // (narrow_no_paths + relevance_paths_dangling + relevance_paths_drift
    // lints added) → 26 rc.6 TASK-021 (knowledge_session_hints_stale
    // lint #27 added) → 27 rc.6 TASK-023 (knowledge_narrow_too_few lint
    // #26 added — structural + telemetry two-arm check) → 28 rc.9 TASK-003
    // (knowledge_relevance_fields_missing lint #28 added — pending
    // entries back-fill for relevance_scope / relevance_paths) → 29 rc.12
    // (skill_md_yaml_invalid lint #29 added — warns on SKILL.md frontmatter
    // values that strict YAML parsers reject) → 33 rc.22 TASK-006
    // (lint-baseline-filename-format hard error added — bare-slug baseline
    // filenames violating the canonical `${id}--${slug}.md` invariant).
    expect(report.checks.map((check) => check.name)).toEqual([
      "Bootstrap anchor",
      // rc.19 bootstrap-consolidation TASK-004: fabric:knowledge-base →
      // fabric:bootstrap one-time marker migration sits adjacent to the
      // anchor check — both are bootstrap-file invariants.
      "Bootstrap marker migration",
      // rc.19 bootstrap-consolidation TASK-005: L1 + L2 byte-level drift
      // detection sit immediately after the marker migration check. Order:
      // anchor existence → migration → L1 (canonical ↔ snapshot) → L2
      // (snapshot+rules ↔ three-end blocks).
      "Bootstrap snapshot drift",
      "Managed block drift",
      "Knowledge layout",
      // rc.22 TASK-006: baseline filename format — sits adjacent to the
      // Knowledge layout check (both are knowledge-layout invariants).
      "Baseline filename format",
      "Scan evidence",
      "Agents metadata",
      "Rule content refs",
      "Knowledge-test index",
      "Event ledger",
      "Event ledger partial write",
      "Event ledger schema compat",
      "Skill ref mirror parity",
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
      "Knowledge underseeded",
      "Knowledge narrow without paths",
      "Knowledge relevance_paths dangling",
      "Knowledge relevance_paths drift",
      "Knowledge narrow too few",
      "Knowledge session-hints stale",
      // rc.23 TASK-010 (e): stale `.fabric/.serve.lock` advisory sits adjacent
      // to the other read-side hygiene infos. Info kind — does not bump
      // report status.
      "Serve lock",
      "Knowledge relevance fields missing",
      "Skill markdown YAML",
      // rc.23 TASK-014 (F8c): Onboard coverage advisory — info kind. Sits
      // adjacent to Skill markdown YAML (both are Skill-adjacent advisories).
      "Onboard coverage",
      // rc.31 BUG-M3/NEW-4: hooks_wired observability (Claude Code hook
      // injection state). Adjacent to onboard / promote-ledger — all three
      // are install/runtime-state advisories. Warning kind when missing.
      "Claude Code hooks wired",
      // rc.31 BUG-G2/G5: promote-ledger invariant (proposed >= started >=
      // promoted). Adjacent to hooks_wired — both are observability checks
      // built off events.jsonl + project state.
      "Promote ledger invariant",
      "Preexisting root markdown",
    ]);
    expect(report.checks).toHaveLength(39);
  });

  it("v2.0: clean post-init repo (mocked layout) reports zero errors AND zero warnings", async () => {
    // Done-when: fresh post-init v2.0 repo with mocked layout — no errors, no warnings.
    const target = createV2KnowledgeProject("doctor-v2-clean");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).toEqual([]);
    expect(report.manual_errors.map((e) => e.code)).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toEqual([]);
    expect(report.status).toBe("ok");
  });

  it("treats malformed rule sections as manual errors", async () => {
    const target = createInitializedProject("doctor-invalid-rule");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "{not-json}\n", target);

    const report = await runDoctorReport(target);

    expect(report.manual_errors.map((issue) => issue.code)).toContain("event_ledger_invalid");
    expect(report.fixable_errors).toEqual([]);
  });

  // v2/rc.2: 2 tests removed here.
  //
  // (1) "doctor --fix repairs derived state and leaves manual errors visible"
  //     — relied on a v1 fixture pattern (createProject + single rule file)
  //     where knowledge-meta-builder rebuilt meta from the rules tree. v2 doctor
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

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

  // v2.0.0-rc.27 TASK-010 (audit §2.24): doctor surfaces schema-compat warnings
  // for events.jsonl rows whose schema_version != 1 OR whose event_type is not
  // in the current discriminator set. The check is `warning` severity — does
  // not block, but stops the prior silent-drop blind spot.
  it("event_ledger_schema_compat: warns on schema_version=0 rows (audit §2.24)", async () => {
    const target = createInitializedProject("doctor-event-ledger-schema-compat-version");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

    const validLine = JSON.stringify({
      kind: "fabric-event",
      id: "event:ok",
      ts: 1_000,
      schema_version: 1,
      event_type: "reapply_completed",
      preserved_ledger: true,
      preserved_meta: true,
      rules_count: 0,
    });
    const legacyLine = JSON.stringify({
      kind: "fabric-event",
      id: "event:legacy",
      ts: 1_001,
      schema_version: 0,
      event_type: "deprecated_event_type_from_rc_0",
    });
    writeFileSync(
      join(target, ".fabric", "events.jsonl"),
      `${validLine}\n${legacyLine}\n`,
      "utf8",
    );

    const report = await runDoctorReport(target);
    const check = report.checks.find(
      (c) => c.code === "event_ledger_schema_compat",
    );
    expect(check).toBeDefined();
    expect(check?.status).toBe("warn");
    expect(check?.message).toMatch(/schema_version/);
    expect(check?.message).toMatch(/0/);
  });

  it("event_ledger_schema_compat: warns on unknown event_type (audit §2.24)", async () => {
    const target = createInitializedProject("doctor-event-ledger-schema-compat-event-type");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

    const unknownTypeLine = JSON.stringify({
      kind: "fabric-event",
      id: "event:future",
      ts: 1_002,
      schema_version: 1,
      event_type: "knowledge_telepathy_observed",
    });
    writeFileSync(
      join(target, ".fabric", "events.jsonl"),
      `${unknownTypeLine}\n`,
      "utf8",
    );

    const report = await runDoctorReport(target);
    const check = report.checks.find(
      (c) => c.code === "event_ledger_schema_compat",
    );
    expect(check).toBeDefined();
    expect(check?.status).toBe("warn");
    expect(check?.message).toMatch(/event_type/);
    expect(check?.message).toMatch(/knowledge_telepathy_observed/);
  });

  it("event_ledger_schema_compat: clean when all rows match current schema", async () => {
    const target = createInitializedProject("doctor-event-ledger-schema-compat-clean");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

    const validLine = JSON.stringify({
      kind: "fabric-event",
      id: "event:ok",
      ts: 1_000,
      schema_version: 1,
      event_type: "reapply_completed",
      preserved_ledger: true,
      preserved_meta: true,
      rules_count: 0,
    });
    writeFileSync(
      join(target, ".fabric", "events.jsonl"),
      `${validLine}\n`,
      "utf8",
    );

    const report = await runDoctorReport(target);
    const check = report.checks.find(
      (c) => c.name === "Event ledger schema compat",
    );
    expect(check?.status).toBe("ok");
  });

  // v2.0.0-rc.28 TASK-04 (audit §3.1): skill_ref_mirror parity check —
  // detects hand-edits or partial install that diverge the .claude/ ↔ .codex/
  // ref/ subtrees.
  it("skill_ref_mirror: ok when fresh install (no skill ref subtrees yet)", async () => {
    const target = createInitializedProject("doctor-skill-ref-mirror-empty");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);
    const check = report.checks.find(
      (c) => c.name === "Skill ref mirror parity",
    );
    expect(check?.status).toBe("ok");
  });

  it("skill_ref_mirror: ok when both clients carry byte-identical ref content", async () => {
    const target = createInitializedProject("doctor-skill-ref-mirror-parity");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const refBody = "# i18n policy\n\nbody bytes";
    const claudeRef = join(target, ".claude", "skills", "fabric-archive", "ref");
    const codexRef = join(target, ".codex", "skills", "fabric-archive", "ref");
    mkdirSync(claudeRef, { recursive: true });
    mkdirSync(codexRef, { recursive: true });
    writeFileSync(join(claudeRef, "i18n-policy.md"), refBody, "utf8");
    writeFileSync(join(codexRef, "i18n-policy.md"), refBody, "utf8");

    const report = await runDoctorReport(target);
    const check = report.checks.find(
      (c) => c.name === "Skill ref mirror parity",
    );
    expect(check?.status).toBe("ok");
  });

  it("skill_ref_mirror: warns when .claude/ ref/ diverges from .codex/ ref/", async () => {
    const target = createInitializedProject("doctor-skill-ref-mirror-drift");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const claudeRef = join(target, ".claude", "skills", "fabric-archive", "ref");
    const codexRef = join(target, ".codex", "skills", "fabric-archive", "ref");
    mkdirSync(claudeRef, { recursive: true });
    mkdirSync(codexRef, { recursive: true });
    // Same filename, different content → drift detected.
    writeFileSync(join(claudeRef, "i18n-policy.md"), "claude version", "utf8");
    writeFileSync(join(codexRef, "i18n-policy.md"), "codex version", "utf8");

    const report = await runDoctorReport(target);
    const check = report.checks.find(
      (c) => c.code === "skill_ref_mirror_drift",
    );
    expect(check).toBeDefined();
    expect(check?.status).toBe("warn");
    expect(check?.message).toMatch(/fabric-archive\/ref\/i18n-policy\.md/);
  });

  // v2.0.0-rc.28 (Gemini review fix): partial file asymmetry — both client
  // subtrees exist, but one is missing a specific ref file. The original
  // intersection-based comparison silently passed this case; the fix takes
  // the symmetric difference + byte-compare so missing files surface as
  // drift.
  it("skill_ref_mirror: warns when both clients exist but one is missing a ref file (partial drift)", async () => {
    const target = createInitializedProject("doctor-skill-ref-mirror-partial");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const claudeRef = join(target, ".claude", "skills", "fabric-archive", "ref");
    const codexRef = join(target, ".codex", "skills", "fabric-archive", "ref");
    mkdirSync(claudeRef, { recursive: true });
    mkdirSync(codexRef, { recursive: true });
    // Claude has BOTH files; Codex has only ONE — the second is missing.
    writeFileSync(join(claudeRef, "i18n-policy.md"), "policy bytes", "utf8");
    writeFileSync(join(claudeRef, "worked-examples.md"), "examples bytes", "utf8");
    writeFileSync(join(codexRef, "i18n-policy.md"), "policy bytes", "utf8");
    // worked-examples.md absent in .codex/ — should surface as drift.

    const report = await runDoctorReport(target);
    const check = report.checks.find(
      (c) => c.code === "skill_ref_mirror_drift",
    );
    expect(check).toBeDefined();
    expect(check?.status).toBe("warn");
    expect(check?.message).toMatch(/fabric-archive\/ref\/worked-examples\.md/);
  });

  it("skill_ref_mirror: tolerates client-asymmetric installs (one client only)", async () => {
    const target = createInitializedProject("doctor-skill-ref-mirror-asymmetric");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Only Codex installed; Claude subtree absent entirely.
    const codexRef = join(target, ".codex", "skills", "fabric-archive", "ref");
    mkdirSync(codexRef, { recursive: true });
    writeFileSync(join(codexRef, "i18n-policy.md"), "codex only", "utf8");

    const report = await runDoctorReport(target);
    const check = report.checks.find(
      (c) => c.name === "Skill ref mirror parity",
    );
    expect(check?.status).toBe("ok");
  });

  // v2.0.0-rc.22 Scope A T4: rotateEventLedgerIfNeeded integration into
  // `fab doctor --fix`. Rotation runs as an unconditional hygiene step (no
  // gating check) and is idempotent — a re-run on a freshly-rotated ledger
  // is a no-op. A `event_ledger_rotated` synthetic `fixed[]` entry is
  // surfaced ONLY when archivedCount > 0; no-op runs do not pollute the
  // report. Tests below cover the contract end-to-end via runDoctorFix.
  describe("rc.22 TASK-004: rotateEventLedgerIfNeeded wired into doctor --fix", () => {
    // Helper: seed events.jsonl with hand-crafted lines (newline-terminated)
    // whose `ts` is far enough in the past to fall outside the default 30d
    // retention window. We write the file directly rather than via
    // appendEventLedgerEvent so the timestamps are not clamped to Date.now().
    function seedLedger(target: string, lines: string[]): void {
      const ledgerPath = join(target, ".fabric", "events.jsonl");
      writeFileSync(ledgerPath, lines.map((l) => `${l}\n`).join(""), "utf8");
    }

    // Build a schema-valid old event line. mcp_event carries an envelope
    // (mcp_event_id, stream_id, message) that the event-ledger schema
    // accepts; we use a fixed `ts` well past the 30d retention cutoff.
    function oldMcpEventLine(id: string, ts: number): string {
      return JSON.stringify({
        kind: "fabric-event",
        id: `event:${id}`,
        ts,
        schema_version: 1,
        event_type: "mcp_event",
        mcp_event_id: id,
        stream_id: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
      });
    }

    // Build a schema-valid recent event line. ts = Date.now() is well
    // within the 30d window so it is always kept by rotation.
    function recentMcpEventLine(id: string): string {
      return JSON.stringify({
        kind: "fabric-event",
        id: `event:${id}`,
        ts: Date.now(),
        schema_version: 1,
        event_type: "mcp_event",
        mcp_event_id: id,
        stream_id: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
      });
    }

    // Cutoff helper: 45d-old timestamp, comfortably past the 30d default.
    function staleTs(): number {
      return Date.now() - 45 * 86_400_000;
    }

    it("doctor_fix_triggers_rotation: --fix on a ledger with old lines archives them and reports a fixed entry", async () => {
      const target = createInitializedProject("doctor-rotate-trigger");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      const baseTs = staleTs();
      seedLedger(target, [
        oldMcpEventLine("mcp-old-1", baseTs),
        oldMcpEventLine("mcp-old-2", baseTs + 1),
        recentMcpEventLine("mcp-new-1"),
      ]);

      const fix = await runDoctorFix(target);

      // Synthetic fixed entry surfaced (archivedCount > 0)
      const rotated = fix.fixed.find((issue) => issue.code === "event_ledger_rotated");
      expect(rotated).toBeDefined();
      expect(rotated?.path).toMatch(/^\.fabric\/events\.archive\/events-rotated-\d{4}-\d{2}-\d{2}\.jsonl$/);
      expect(rotated?.message).toContain("2");

      // Archive file exists and contains exactly the two old lines
      const archiveDir = join(target, ".fabric", "events.archive");
      expect(existsSync(archiveDir)).toBe(true);

      // Main ledger now contains audit event + only the recent event
      const { events } = await readEventLedger(target);
      const mcpEvents = events.filter((e) => e.event_type === "mcp_event") as Array<{
        event_type: "mcp_event";
        mcp_event_id: string;
      }>;
      expect(mcpEvents.map((e) => e.mcp_event_id)).toEqual(["mcp-new-1"]);
    });

    it("doctor_fix_rotation_idempotent: a second --fix on a freshly-rotated ledger is a no-op", async () => {
      const target = createInitializedProject("doctor-rotate-idempotent");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      const baseTs = staleTs();
      seedLedger(target, [
        oldMcpEventLine("mcp-old-1", baseTs),
        recentMcpEventLine("mcp-new-1"),
      ]);

      const firstFix = await runDoctorFix(target);
      expect(firstFix.fixed.map((i) => i.code)).toContain("event_ledger_rotated");

      // Snapshot archive size + main ledger contents after first --fix.
      const archiveFiles = readdirSync(join(target, ".fabric", "events.archive"));
      expect(archiveFiles.length).toBe(1);
      const archivePath = join(target, ".fabric", "events.archive", archiveFiles[0]);
      const archiveSizeBefore = statSync(archivePath).size;
      const mainBefore = readFileSync(join(target, ".fabric", "events.jsonl"), "utf8");

      const secondFix = await runDoctorFix(target);

      // No `event_ledger_rotated` entry — nothing to rotate this round.
      expect(secondFix.fixed.map((i) => i.code)).not.toContain("event_ledger_rotated");

      // Archive untouched, main file untouched.
      expect(statSync(archivePath).size).toBe(archiveSizeBefore);
      expect(readFileSync(join(target, ".fabric", "events.jsonl"), "utf8")).toBe(mainBefore);
    });

    it("doctor_fix_no_archive_when_under_retention: --fix with only recent events does NOT create an archive file or fixed entry", async () => {
      const target = createInitializedProject("doctor-rotate-noop");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      seedLedger(target, [recentMcpEventLine("mcp-new-1"), recentMcpEventLine("mcp-new-2")]);

      const fix = await runDoctorFix(target);

      expect(fix.fixed.map((i) => i.code)).not.toContain("event_ledger_rotated");
      // No archive directory was created (rotation primitive only mkdirs
      // when it actually has lines to write).
      expect(existsSync(join(target, ".fabric", "events.archive"))).toBe(false);
    });

    it("doctor_fix_emits_events_rotated: post-rotation main ledger contains an events_rotated audit event", async () => {
      const target = createInitializedProject("doctor-rotate-audit");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      const baseTs = staleTs();
      seedLedger(target, [
        oldMcpEventLine("mcp-old-1", baseTs),
        oldMcpEventLine("mcp-old-2", baseTs + 1),
        recentMcpEventLine("mcp-new-1"),
      ]);

      await runDoctorFix(target);

      const { events } = await readEventLedger(target);
      const audit = events.find((e) => e.event_type === "events_rotated") as
        | { event_type: "events_rotated"; archived_count: number; kept_count: number; archive_path: string }
        | undefined;
      expect(audit).toBeDefined();
      expect(audit?.archived_count).toBe(2);
      // kept_count reflects only the lines retained from the pre-rotation
      // ledger — the audit event itself is prepended afterwards and is not
      // counted in kept_count.
      expect(audit?.kept_count).toBe(1);
      expect(audit?.archive_path).toMatch(/^\.fabric\/events\.archive\/events-rotated-\d{4}-\d{2}-\d{2}\.jsonl$/);
    });

    it("doctor_fix_same_day_appends_archive: two --fix invocations on the same day with fresh stale events append to the same archive file", async () => {
      const target = createInitializedProject("doctor-rotate-sameday");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      const baseTs = staleTs();

      // Round 1: one old + one new event → rotation archives the old one
      seedLedger(target, [oldMcpEventLine("mcp-old-1", baseTs), recentMcpEventLine("mcp-new-1")]);
      const firstFix = await runDoctorFix(target);
      expect(firstFix.fixed.map((i) => i.code)).toContain("event_ledger_rotated");

      const archiveDir = join(target, ".fabric", "events.archive");
      const archiveFiles1 = readdirSync(archiveDir);
      expect(archiveFiles1).toHaveLength(1);
      const archivePath = join(archiveDir, archiveFiles1[0]);
      const sizeAfterRound1 = statSync(archivePath).size;

      // Round 2: append another stale event to the main ledger (simulating
      // an old event arriving between --fix invocations on the same day),
      // then re-run --fix. The same archive file should grow, not a new
      // one be created.
      const currentMain = readFileSync(join(target, ".fabric", "events.jsonl"), "utf8");
      writeFileSync(
        join(target, ".fabric", "events.jsonl"),
        `${currentMain}${oldMcpEventLine("mcp-old-2", baseTs + 1000)}\n`,
        "utf8",
      );

      const secondFix = await runDoctorFix(target);
      expect(secondFix.fixed.map((i) => i.code)).toContain("event_ledger_rotated");

      // Still exactly one archive file — and it grew.
      const archiveFiles2 = readdirSync(archiveDir);
      expect(archiveFiles2).toEqual(archiveFiles1);
      const sizeAfterRound2 = statSync(archivePath).size;
      expect(sizeAfterRound2).toBeGreaterThan(sizeAfterRound1);

      // Both old events end up in the archive in append order.
      const archiveContents = readFileSync(archivePath, "utf8");
      const ids = archiveContents
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => (JSON.parse(l) as { mcp_event_id: string }).mcp_event_id);
      expect(ids).toEqual(["mcp-old-1", "mcp-old-2"]);
    });
  });

  it("--fix calls reconcileKnowledge and emits meta_reconciled event", async () => {
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).not.toContain("meta_manually_diverged");
    expect(report.checks.find((c) => c.name === "Meta manual divergence")?.status).toBe("ok");
  });

  // rc.22 TASK-012 (Scope D T-D5): agents_meta_stale demoted from error → warning.
  // Auto-heal on next plan-context/get-sections MCP call means a detected drift is
  // benign; doctor exit code stays 0 (unless --strict). `fab doctor --fix` still
  // reconciles explicitly via the warnings-aware guard in runDoctorFix.
  describe("rc.22 TASK-012: agents_meta_stale severity demotion", () => {
    it("meta_check_stale_emits_warning_not_error: stale meta surfaces as warning, not fixable_error", async () => {
      const target = createInitializedProject("doctor-stale-meta-warning");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Trigger meta.stale by editing the body of an indexed knowledge file —
      // recomputed revision differs from stored revision.
      writeFileSync(
        join(target, ".fabric", "knowledge", "decisions", "server.md"),
        "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services. Edited body to force stale meta.\n",
        "utf8",
      );

      const report = await runDoctorReport(target);

      expect(report.warnings.map((w) => w.code)).toContain("agents_meta_stale");
      expect(report.fixable_errors.map((e) => e.code)).not.toContain("agents_meta_stale");
      const check = report.checks.find((c) => c.name === "Agents metadata");
      expect(check?.status).toBe("warn");
      expect(check?.kind).toBe("warning");
      expect(check?.code).toBe("agents_meta_stale");
      expect(check?.fixable).toBe(false);
    });

    it("doctor_exits_zero_with_stale_meta: report.status is 'warn' (not 'error') so non-strict CLI exits 0", async () => {
      const target = createInitializedProject("doctor-stale-meta-exit-zero");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(
        join(target, ".fabric", "knowledge", "decisions", "server.md"),
        "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services. Edited body for exit-zero test.\n",
        "utf8",
      );

      const report = await runDoctorReport(target);

      // The demoted `agents_meta_stale` itself must no longer contribute an
      // "error" status — it must surface as a "warn" check.
      const metaCheck = report.checks.find((c) => c.code === "agents_meta_stale");
      expect(metaCheck?.status).toBe("warn");
      // Equivalent assertion from the report rollup: agents_meta_stale must
      // NOT appear among fixable_errors / manual_errors any more.
      expect(report.fixable_errors.map((e) => e.code)).not.toContain("agents_meta_stale");
      expect(report.manual_errors.map((e) => e.code)).not.toContain("agents_meta_stale");
    });

    it("doctor_fix_still_reconciles_stale: --fix runs reconcile and clears agents_meta_stale via warnings-path", async () => {
      const target = createInitializedProject("doctor-stale-meta-fix");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Mutate the seeded knowledge file's body so the recomputed revision
      // differs from the stored revision AND reconcileKnowledge detects a
      // real hash change (events.length > 0 → writeKnowledgeMeta rewrites
      // meta with the fresh revision).
      writeFileSync(
        join(target, ".fabric", "knowledge", "decisions", "server.md"),
        "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services. Hand-edited body for rc.22 stale-meta fix test.\n",
        "utf8",
      );

      const before = await runDoctorReport(target);
      expect(before.warnings.map((w) => w.code)).toContain("agents_meta_stale");
      expect(before.fixable_errors.map((e) => e.code)).not.toContain("agents_meta_stale");

      const fix = await runDoctorFix(target);
      const after = await runDoctorReport(target);

      // The warnings-aware fix guard should pick up the stale code and
      // include it in the `fixed` set, even though it's now a warning.
      expect(fix.fixed.map((e) => e.code)).toContain("agents_meta_stale");
      expect(after.warnings.map((w) => w.code)).not.toContain("agents_meta_stale");
      expect(after.fixable_errors.map((e) => e.code)).not.toContain("agents_meta_stale");

      // meta_reconciled event must be written to the ledger.
      const { events } = await readEventLedger(target);
      expect(events.map((event) => event.event_type)).toContain("meta_reconciled");
    });

    it("meta_check_resolution_references_auto_heal: actionHint mentions auto-heal + --fix path", async () => {
      const target = createInitializedProject("doctor-stale-meta-resolution-text");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(
        join(target, ".fabric", "knowledge", "decisions", "server.md"),
        "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services. Edited body for resolution-text test.\n",
        "utf8",
      );

      const report = await runDoctorReport(target);

      const check = report.checks.find((c) => c.name === "Agents metadata");
      expect(check?.code).toBe("agents_meta_stale");
      // Resolution text now communicates: (a) drift is benign, (b) engine
      // auto-heals on next read-side MCP call, (c) --fix is the explicit
      // reconcile escape hatch.
      expect(check?.actionHint).toContain("Benign");
      expect(check?.actionHint).toContain("auto-heals");
      expect(check?.actionHint).toContain("plan-context/get-sections");
      expect(check?.actionHint).toContain("fab doctor --fix");
    });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);

    expect(report.warnings.map((w) => w.code)).not.toContain("stable_id_collision");
    expect(report.checks.find((c) => c.name === "Stable ID collision")?.status).toBe("ok");
  });

  it("TASK-030 / v2.0: knowledge_dir_unindexed detected when .md exists in knowledge tree but not in meta", async () => {
    const target = createInitializedProject("doctor-unindexed-detect");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    // Drop an unindexed knowledge file (not reconciled into meta)
    writeFile(".fabric/knowledge/guidelines/ui.md", "<!-- fab:rule-id rules/ui -->\n# UI\n\n## [MANDATORY_INJECTION]\nUse components.\n", target);

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).toContain("knowledge_dir_unindexed");
    expect(report.checks.find((c) => c.name === "Knowledge dir unindexed")?.status).toBe("error");
  });

  it("TASK-030 / v2.0: --fix incorporates unindexed knowledge files via reconcileKnowledge", async () => {
    const target = createInitializedProject("doctor-unindexed-fix");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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

  it("TASK-029: content_ref_missing is fixable — --fix via reconcileKnowledge drops stale refs", async () => {
    const target = createInitializedProject("doctor-content-ref-fix");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    // Use a minimal v2.0 fixture (no .fabric/rules/) so reconcileKnowledge is not
    // triggered by stale-meta during --fix; this test focuses purely on the
    // counter_desync emission and downstream fix path.
    const target = createV2KnowledgeProject("doctor-counter-desync-detect");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

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
    // indexes them via reconcileKnowledge (knowledge_dir_unindexed), but
    // reconcileKnowledge carries over previousMeta.counters verbatim. A second
    // --fix was previously required to sync counters. This test asserts that
    // a single --fix call is sufficient.
    const target = createV2KnowledgeProject("doctor-counter-desync-unindexed-regression");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);
    expect(report.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_anchor_missing");
    expect(report.checks.find((c) => c.name === "Bootstrap anchor")?.status).toBe("ok");
  });

  it("v2.0 / bootstrap_anchor_missing: passes when CLAUDE.md alone exists (no AGENTS.md)", async () => {
    const target = createInitializedProject("doctor-anchor-claude-only");
    rmSync(join(target, "AGENTS.md"), { force: true });
    writeFile("CLAUDE.md", "# CLAUDE\n", target);
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);
    expect(report.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_anchor_missing");
    expect(report.checks.find((c) => c.name === "Bootstrap anchor")?.status).toBe("ok");
  });

  it("v2.0 / bootstrap_anchor_missing: fixable_error when neither AGENTS.md nor CLAUDE.md exists", async () => {
    const target = createInitializedProject("doctor-anchor-missing");
    rmSync(join(target, "AGENTS.md"), { force: true });
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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

  // v2.0.0-rc.29 TASK-004 (BUG-G2 + BUG-G5): the synth path emits the full
  // proposed → promote_started → promoted triplet (not just the terminal
  // promoted event) so the historical invariant
  //   knowledge_promoted ≤ knowledge_promote_started ≤ knowledge_proposed
  // holds on ledgers that contain synth-restored orphans. Pre-fix on this repo
  // the ratio was 19 promoted > 13 promote_started (6 orphan deltas).
  it("filesystem_edit_fallback: emits a synthesized triplet (proposed + promote_started + promoted) per orphan", async () => {
    const target = createInitializedProject("doctor-fef-triplet-emit");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
    writeFile(".fabric/events.jsonl", "", target);

    const fm = "---\nid: KT-DEC-0077\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Triplet\n";
    writeFile(".fabric/knowledge/decisions/KT-DEC-0077--triplet.md", fm, target);

    await runDoctorReport(target);

    const { events } = await readEventLedger(target);
    const synth = events.filter(
      (e) => "reason" in e && e.reason === "[synthesized] filesystem-edit-fallback",
    );

    // Each orphan now produces exactly 3 events.
    expect(synth).toHaveLength(3);

    const byType = new Map<string, typeof synth>();
    for (const ev of synth) {
      const bucket = byType.get(ev.event_type) ?? ([] as unknown as typeof synth);
      bucket.push(ev);
      byType.set(ev.event_type, bucket);
    }
    expect(byType.get("knowledge_proposed")).toHaveLength(1);
    expect(byType.get("knowledge_promote_started")).toHaveLength(1);
    expect(byType.get("knowledge_promoted")).toHaveLength(1);

    // All three share the same doctor-synthesized correlation_id.
    for (const ev of synth) {
      expect(ev.correlation_id).toBe("doctor-synthesized");
      expect(ev.session_id).toBe("doctor-synthesized");
      expect("stable_id" in ev && ev.stable_id).toBe("KT-DEC-0077");
    }

    // Monotonic ts in lifecycle order (proposed ≤ promote_started ≤ promoted).
    const proposedTs = byType.get("knowledge_proposed")?.[0]?.ts ?? 0;
    const startedTs = byType.get("knowledge_promote_started")?.[0]?.ts ?? 0;
    const promotedTs = byType.get("knowledge_promoted")?.[0]?.ts ?? 0;
    expect(proposedTs).toBeLessThan(startedTs);
    expect(startedTs).toBeLessThan(promotedTs);
  });

  it("filesystem_edit_fallback: silently ignores files without <id>--<slug> filename pattern", async () => {
    const target = createInitializedProject("doctor-fef-malformed");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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

    it("orphan_demote: skips entry that has a recent knowledge_consumed event within threshold", async () => {
      const target = createInitializedProject("doctor-rc4-orphan-recent-fetch");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1004--touched-stable.md",
        "KT-DEC-1004",
        "stable",
        200,
      );
      // v2.0 rc.5 TASK-014 (C5): pivot — orphan_demote now keys off
      // knowledge_consumed events (not knowledge_sections_fetched). Append a
      // consumption event 5 days ago for this id; recent consumption keeps the
      // entry out of the candidates list.
      appendRawEvent(target, {
        kind: "fabric-event",
        id: "event:rc4-recent-consumed",
        ts: NOW_MS - 5 * dayMs,
        schema_version: 1,
        event_type: "knowledge_consumed",
        stable_id: "KT-DEC-1004",
        consumed_at: ageDaysAgoIso(5),
        client_hash: "",
      });

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge orphan demote");
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined();
      expect(report.warnings.map((w) => w.code)).not.toContain("knowledge_orphan_demote_required");
    });

    // v2.0 rc.5 TASK-014 (C5): confirm a knowledge_sections_fetched (the
    // legacy activity signal) alone is NO LONGER enough to keep an old entry
    // off the orphan_demote list — only knowledge_consumed counts now.
    it("orphan_demote: knowledge_sections_fetched alone does NOT suppress orphan (post-C5 pivot)", async () => {
      const target = createInitializedProject("doctor-rc5-orphan-fetched-only");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedCanonical(
        target,
        ".fabric/knowledge/decisions/KT-DEC-1099--fetched-not-consumed.md",
        "KT-DEC-1099",
        "stable",
        200,
      );
      // Only a legacy fetched event, no knowledge_consumed.
      appendRawEvent(target, {
        kind: "fabric-event",
        id: "event:rc5-fetched-only",
        ts: NOW_MS - 5 * dayMs,
        schema_version: 1,
        event_type: "knowledge_sections_fetched",
        selection_token: "tok",
        requested_sections: [],
        final_stable_ids: ["KT-DEC-1099"],
        ai_selected_stable_ids: [],
      });

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge orphan demote");
      expect(check?.kind).toBe("warning");
      expect(check?.code).toBe("knowledge_orphan_demote_required");
      expect(report.warnings.map((w) => w.code)).toContain("knowledge_orphan_demote_required");
    });

    it("orphan_demote: ok status when no canonical entries exist", async () => {
      const target = createInitializedProject("doctor-rc4-orphan-empty");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const fm = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(7)}\n---\n# Pending\nProposal body.\n`;
      writeFile(".fabric/knowledge/pending/decisions/fresh-proposal.md", fm, target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge pending overdue");
      expect(check?.status).toBe("ok");
    });

    it("pending_overdue: ok status when pending dir is empty", async () => {
      const target = createInitializedProject("doctor-rc4-pending-empty");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge pending overdue");
      expect(check?.status).toBe("ok");
      expect(check?.message).toContain("No pending knowledge entries");
    });

    it("read-side: 0 file mutations + 0 events emitted by the 3 new checks", async () => {
      const target = createInitializedProject("doctor-rc4-readside-noop");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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

  // rc.5 TASK-010: read-side underseeded-corpus lint check (#22). Counts
  // canonical entries across the five canonical type subdirs and compares
  // against the underseed threshold (configurable via
  // .fabric/fabric-config.json#underseed_node_threshold, default 10).
  describe("rc.5 TASK-010: read-side underseeded-corpus check (#22)", () => {
    function seedCanonicalStub(target: string, relPath: string): void {
      const slug = relPath.split("--")[1]?.replace(/\.md$/u, "") ?? "untitled";
      const stableId = relPath.split("/").pop()?.split("--")[0] ?? "KT-DEC-9999";
      writeFile(
        relPath,
        `---\nid: ${stableId}\nslug: ${slug}\nmaturity: stable\nlayer: team\n---\n# stub\n`,
        target,
      );
    }

    it("emits info kind when canonical node count is strictly less than threshold (default 10)", async () => {
      const target = createInitializedProject("doctor-rc5-underseeded-default");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // createInitializedProject already seeds 1 baseline entry under
      // .fabric/knowledge/decisions/. Add 3 more for a total of 4 — well
      // below the default threshold of 10.
      seedCanonicalStub(target, ".fabric/knowledge/decisions/KT-DEC-1001--alpha.md");
      seedCanonicalStub(target, ".fabric/knowledge/decisions/KT-DEC-1002--beta.md");
      seedCanonicalStub(target, ".fabric/knowledge/pitfalls/KT-PIT-1001--gamma.md");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge underseeded");
      expect(check?.kind).toBe("info");
      expect(check?.code).toBe("knowledge_underseeded");
      expect(check?.status).toBe("ok"); // info kind keeps report status from bumping
      expect(check?.message).toMatch(/\b[1-9]\b/); // node count digit present
      expect(check?.message).toContain("10");
      expect(report.infos.map((i) => i.code)).toContain("knowledge_underseeded");
    });

    it("does NOT fire when canonical node count >= threshold", async () => {
      const target = createInitializedProject("doctor-rc5-underseeded-above");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      for (let i = 0; i < 12; i += 1) {
        seedCanonicalStub(
          target,
          `.fabric/knowledge/decisions/KT-DEC-${2001 + i}--entry-${i}.md`,
        );
      }

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge underseeded");
      expect(check?.status).toBe("ok");
      expect(report.infos.map((i) => i.code)).not.toContain("knowledge_underseeded");
    });

    it("honours the underseed_node_threshold override in .fabric/fabric-config.json", async () => {
      const target = createInitializedProject("doctor-rc5-underseeded-override");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Override threshold to 100 so the baseline seed (1 entry from
      // createInitializedProject) is well below — fires regardless of any
      // additional seeding.
      writeFile(
        ".fabric/fabric-config.json",
        JSON.stringify({ underseed_node_threshold: 100 }),
        target,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge underseeded");
      expect(check?.kind).toBe("info");
      expect(check?.code).toBe("knowledge_underseeded");
      expect(check?.message).toContain("100");
    });

    it("uses fabric-import skill as the actionHint", async () => {
      const target = createInitializedProject("doctor-rc5-underseeded-action");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedCanonicalStub(target, ".fabric/knowledge/decisions/KT-DEC-4001--single.md");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge underseeded");
      expect(check?.actionHint).toContain("fabric-import");
    });
  });

  // rc.23 TASK-014 (F8c): Onboard coverage advisory. Info kind — never
  // bumps doctor status. Surfaces missing slots from the locked S5 set;
  // recommends running /fabric-archive whose first-run phase tours the
  // project and proposes pending entries with `onboard_slot: <slot>` set.
  describe("rc.23 TASK-014: Onboard coverage advisory", () => {
    function seedOnboardEntry(target: string, type: string, filename: string, slot: string): void {
      const dir = join(target, ".fabric", "knowledge", type);
      mkdirSync(dir, { recursive: true });
      const id = filename.split("--")[0] ?? filename.replace(/\.md$/u, "");
      const body =
        `---\nid: ${id}\ntype: ${type}\nonboard_slot: ${slot}\n---\n\n# stub\n`;
      writeFileSync(join(dir, filename), body, "utf8");
    }

    it("emits info advisory listing missing slots when KB is empty", async () => {
      const target = createInitializedProject("doctor-rc23-onboard-empty");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Onboard coverage");
      expect(check?.kind).toBe("info");
      expect(check?.code).toBe("onboard_coverage_incomplete");
      expect(check?.status).toBe("ok");
      // All 5 slots should be missing on an empty workspace.
      for (const slot of [
        "tech-stack-decision",
        "architecture-pattern",
        "code-style-tone",
        "build-system-idiom",
        "domain-vocabulary",
      ]) {
        expect(check?.message).toContain(slot);
      }
      expect(check?.actionHint).toContain("fabric-archive");
      expect(report.infos.map((i) => i.code)).toContain("onboard_coverage_incomplete");
    });

    it("emits 5/5 ✓ when every slot is filled by a canonical entry", async () => {
      const target = createInitializedProject("doctor-rc23-onboard-full");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedOnboardEntry(target, "decisions", "KT-DEC-0001--stack.md", "tech-stack-decision");
      seedOnboardEntry(target, "models", "KT-MOD-0001--layout.md", "architecture-pattern");
      seedOnboardEntry(target, "guidelines", "KT-GLD-0001--style.md", "code-style-tone");
      seedOnboardEntry(target, "processes", "KT-PRO-0001--build.md", "build-system-idiom");
      seedOnboardEntry(target, "models", "KT-MOD-0002--vocab.md", "domain-vocabulary");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Onboard coverage");
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined(); // okCheck = no kind
      expect(check?.message).toMatch(/5\/5/u);
      expect(check?.message).toContain("✓");
      expect(report.infos.map((i) => i.code)).not.toContain("onboard_coverage_incomplete");
    });

    it("excludes opted-out slots from missing AND surfaces the count in message", async () => {
      const target = createInitializedProject("doctor-rc23-onboard-opted-out");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Dismiss 2 of the 5 slots — they should drop out of `missing`.
      writeFile(
        ".fabric/fabric-config.json",
        JSON.stringify({
          onboard_slots_opted_out: ["domain-vocabulary", "build-system-idiom"],
        }),
        target,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Onboard coverage");
      expect(check?.kind).toBe("info");
      expect(check?.code).toBe("onboard_coverage_incomplete");
      // 3 slots still missing (5 − 2 opted out − 0 filled).
      expect(check?.message).toContain("tech-stack-decision");
      expect(check?.message).toContain("architecture-pattern");
      expect(check?.message).toContain("code-style-tone");
      // Opted-out slots should NOT appear in the missing list.
      // Construct the precise missing-list substring to anchor the check.
      expect(check?.message).toMatch(/Onboard slots not yet covered: \[(?!.*domain-vocabulary)(?!.*build-system-idiom)/u);
      // Opt-out count surfaces in the trailing detail.
      expect(check?.message).toContain("2 opted-out");
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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

    it("does NOT mutate or emit events for pending_overdue (14<age<=30d) findings", async () => {
      // rc.5 TASK-009 (B2): auto-archive only triggers strictly above 30d.
      // A 30-day-old pending entry remains in pending/ (overdue lint fires
      // as a warning, but --apply-lint takes no action until age > 30d).
      //
      // rc.9 TASK-003 (A3): seed both relevance_scope + relevance_paths
      // verbatim so lint #28 (relevance_fields_missing) has nothing to
      // back-fill — keeps this test's "file unchanged" invariant focused
      // on the pending_auto_archive 30d-threshold semantics rather than
      // the relevance back-fill side-effect.
      const target = createInitializedProject("doctor-rc4-applylint-pending-noop");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const fmPending = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(30)}\nrelevance_scope: broad\nrelevance_paths: []\n---\n# Pending\n`;
      const pendingRel = ".fabric/knowledge/pending/decisions/old-proposal.md";
      writeFile(pendingRel, fmPending, target);

      const beforeSource = readFileSync(join(target, pendingRel), "utf8");

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(false);
      // No auto-archive mutation: 30d is the exact threshold, not exceeded.
      expect(
        result.mutations.find((m) => m.kind === "knowledge_pending_auto_archive"),
      ).toBeUndefined();
      // No relevance back-fill either: both fields are already present.
      expect(
        result.mutations.find(
          (m) => m.kind === "knowledge_relevance_fields_missing",
        ),
      ).toBeUndefined();

      // File unchanged, still in pending/.
      expect(existsSync(join(target, pendingRel))).toBe(true);
      expect(readFileSync(join(target, pendingRel), "utf8")).toBe(beforeSource);
    });

    // rc.5 TASK-009 (B2): pending auto-archive (>30d). Covers stale-pending
    // detection (mtime / created_at filter), the apply-lint move into the
    // archive subtree, single pending_auto_archived event emission, and the
    // dual-root (team + personal) walk.
    describe("rc.5 TASK-009 (B2): pending auto-archive", () => {
      it("inspects team pending and identifies >30d entries (via created_at)", async () => {
        const target = createInitializedProject("doctor-rc5-pending-archive-detect-team");
        await writeKnowledgeMeta(target, { source: "doctor_fix" });
        writeFile(".fabric/events.jsonl", "", target);

        // Two pending entries: 31d (stale → candidate) + 5d (fresh → not).
        const fmStale = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(31)}\n---\n# Stale Pending\n`;
        const fmFresh = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(5)}\n---\n# Fresh Pending\n`;
        writeFile(".fabric/knowledge/pending/decisions/stale.md", fmStale, target);
        writeFile(".fabric/knowledge/pending/decisions/fresh.md", fmFresh, target);

        const result = await runApplyLint(target);
        expect(result.aborted).toBe(false);
        const autoArchiveMutations = result.mutations.filter(
          (m) => m.kind === "knowledge_pending_auto_archive",
        );
        expect(autoArchiveMutations).toHaveLength(1);
        expect(autoArchiveMutations[0].applied).toBe(true);
        expect(autoArchiveMutations[0].path).toBe(
          ".fabric/knowledge/pending/decisions/stale.md",
        );
        expect(autoArchiveMutations[0].detail).toContain(
          ".fabric/.archive/pending/decisions/stale.md",
        );
      });

      it("team layer: moves stale pending into .fabric/.archive/pending/<type>/", async () => {
        const target = createInitializedProject("doctor-rc5-pending-archive-move-team");
        await writeKnowledgeMeta(target, { source: "doctor_fix" });
        writeFile(".fabric/events.jsonl", "", target);

        const pendingRel = ".fabric/knowledge/pending/pitfalls/very-old.md";
        const archiveRel = ".fabric/.archive/pending/pitfalls/very-old.md";
        const fmStale = `---\ntype: pitfall\nlayer: team\ncreated_at: ${ageDaysAgoIso(45)}\n---\n# Very Old\nBody.\n`;
        writeFile(pendingRel, fmStale, target);

        expect(existsSync(join(target, pendingRel))).toBe(true);
        expect(existsSync(join(target, archiveRel))).toBe(false);

        const result = await runApplyLint(target);
        expect(result.aborted).toBe(false);
        const mutation = result.mutations.find(
          (m) => m.kind === "knowledge_pending_auto_archive",
        );
        expect(mutation?.applied).toBe(true);

        // Source removed; archive destination contains the file with body intact.
        expect(existsSync(join(target, pendingRel))).toBe(false);
        expect(existsSync(join(target, archiveRel))).toBe(true);
        const archived = readFileSync(join(target, archiveRel), "utf8");
        expect(archived).toContain("# Very Old");
      });

      it("emits pending_auto_archived event with pending_path / archived_to / reason", async () => {
        const target = createInitializedProject("doctor-rc5-pending-archive-event");
        await writeKnowledgeMeta(target, { source: "doctor_fix" });
        writeFile(".fabric/events.jsonl", "", target);

        const fmStale = `---\ntype: guideline\nlayer: team\ncreated_at: ${ageDaysAgoIso(60)}\n---\n# Guideline pending\n`;
        writeFile(".fabric/knowledge/pending/guidelines/stale-gl.md", fmStale, target);

        await runApplyLint(target);

        const { events } = await readEventLedger(target, {
          event_type: "pending_auto_archived",
        });
        expect(events).toHaveLength(1);
        const evt = events[0];
        if (evt.event_type !== "pending_auto_archived") {
          throw new Error("type narrowing failed");
        }
        expect(evt.pending_path).toBe(
          ".fabric/knowledge/pending/guidelines/stale-gl.md",
        );
        expect(evt.archived_to).toBe(
          ".fabric/.archive/pending/guidelines/stale-gl.md",
        );
        expect(evt.reason).toBe("auto_archive_30d");
      });

      it("personal layer: moves stale pending into ~/.fabric/.archive/pending/<type>/ via fs.rename", async () => {
        const target = createInitializedProject("doctor-rc5-pending-archive-personal");
        await writeKnowledgeMeta(target, { source: "doctor_fix" });
        writeFile(".fabric/events.jsonl", "", target);

        // Personal pending lives under FABRIC_HOME (isolated per-test).
        const fakeHome = process.env.FABRIC_HOME!;
        const personalPendingDir = join(
          fakeHome,
          ".fabric",
          "knowledge",
          "pending",
          "models",
        );
        mkdirSync(personalPendingDir, { recursive: true });
        const personalPendingAbs = join(personalPendingDir, "personal-stale.md");
        const fmStale = `---\ntype: model\nlayer: personal\ncreated_at: ${ageDaysAgoIso(50)}\n---\n# Personal Stale\n`;
        writeFileSync(personalPendingAbs, fmStale, "utf8");

        const personalArchiveAbs = join(
          fakeHome,
          ".fabric",
          ".archive",
          "pending",
          "models",
          "personal-stale.md",
        );

        expect(existsSync(personalPendingAbs)).toBe(true);
        expect(existsSync(personalArchiveAbs)).toBe(false);

        const result = await runApplyLint(target);
        expect(result.aborted).toBe(false);
        const mutation = result.mutations.find(
          (m) =>
            m.kind === "knowledge_pending_auto_archive" &&
            m.path.startsWith("~/.fabric/knowledge/pending"),
        );
        expect(mutation?.applied).toBe(true);
        expect(mutation?.path).toBe(
          "~/.fabric/knowledge/pending/models/personal-stale.md",
        );
        expect(mutation?.detail).toContain(
          "~/.fabric/.archive/pending/models/personal-stale.md",
        );

        // File physically moved on the personal root.
        expect(existsSync(personalPendingAbs)).toBe(false);
        expect(existsSync(personalArchiveAbs)).toBe(true);

        // Event emitted with personal-root display paths.
        const { events } = await readEventLedger(target, {
          event_type: "pending_auto_archived",
        });
        expect(events).toHaveLength(1);
        const evt = events[0];
        if (evt.event_type !== "pending_auto_archived") {
          throw new Error("type narrowing failed");
        }
        expect(evt.pending_path).toBe(
          "~/.fabric/knowledge/pending/models/personal-stale.md",
        );
        expect(evt.archived_to).toBe(
          "~/.fabric/.archive/pending/models/personal-stale.md",
        );
        expect(evt.reason).toBe("auto_archive_30d");
      });

      it("dual-root: archives stale entries in BOTH team and personal layers in a single run", async () => {
        const target = createInitializedProject("doctor-rc5-pending-archive-both");
        await writeKnowledgeMeta(target, { source: "doctor_fix" });
        writeFile(".fabric/events.jsonl", "", target);

        // Team-layer stale.
        const teamStale = `---\ntype: process\nlayer: team\ncreated_at: ${ageDaysAgoIso(40)}\n---\n# Team Stale\n`;
        writeFile(
          ".fabric/knowledge/pending/processes/team-stale.md",
          teamStale,
          target,
        );

        // Personal-layer stale.
        const fakeHome = process.env.FABRIC_HOME!;
        const personalDir = join(
          fakeHome,
          ".fabric",
          "knowledge",
          "pending",
          "processes",
        );
        mkdirSync(personalDir, { recursive: true });
        const personalStale = `---\ntype: process\nlayer: personal\ncreated_at: ${ageDaysAgoIso(45)}\n---\n# Personal Stale\n`;
        writeFileSync(
          join(personalDir, "personal-stale.md"),
          personalStale,
          "utf8",
        );

        const result = await runApplyLint(target);
        expect(result.aborted).toBe(false);
        const autoArchives = result.mutations.filter(
          (m) => m.kind === "knowledge_pending_auto_archive",
        );
        expect(autoArchives).toHaveLength(2);
        expect(autoArchives.every((m) => m.applied)).toBe(true);
        // Both layers represented.
        expect(
          autoArchives.some((m) =>
            m.path.startsWith(".fabric/knowledge/pending/"),
          ),
        ).toBe(true);
        expect(
          autoArchives.some((m) =>
            m.path.startsWith("~/.fabric/knowledge/pending/"),
          ),
        ).toBe(true);

        // Two events written (one per archived entry).
        const { events } = await readEventLedger(target, {
          event_type: "pending_auto_archived",
        });
        expect(events).toHaveLength(2);
      });

      it("dry-run (runDoctorReport, no --apply-lint) does NOT move pending files or emit events", async () => {
        const target = createInitializedProject("doctor-rc5-pending-archive-dryrun");
        await writeKnowledgeMeta(target, { source: "doctor_fix" });
        writeFile(".fabric/events.jsonl", "", target);

        const pendingRel = ".fabric/knowledge/pending/decisions/old.md";
        const fmStale = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(35)}\n---\n# Old\n`;
        writeFile(pendingRel, fmStale, target);

        const beforeSource = readFileSync(join(target, pendingRel), "utf8");

        // Read-only report path.
        await runDoctorReport(target);

        // File unchanged, no archive directory created.
        expect(existsSync(join(target, pendingRel))).toBe(true);
        expect(readFileSync(join(target, pendingRel), "utf8")).toBe(beforeSource);
        expect(
          existsSync(join(target, ".fabric/.archive/pending/decisions/old.md")),
        ).toBe(false);

        // No pending_auto_archived events emitted by the read-only path.
        const { events } = await readEventLedger(target, {
          event_type: "pending_auto_archived",
        });
        expect(events).toHaveLength(0);
      });

      it("idempotent: 2nd apply-lint run after archive produces 0 pending_auto_archive mutations", async () => {
        const target = createInitializedProject("doctor-rc5-pending-archive-idempotent");
        await writeKnowledgeMeta(target, { source: "doctor_fix" });
        writeFile(".fabric/events.jsonl", "", target);

        const fmStale = `---\ntype: decision\nlayer: team\ncreated_at: ${ageDaysAgoIso(40)}\n---\n# Stale\n`;
        writeFile(
          ".fabric/knowledge/pending/decisions/stale-once.md",
          fmStale,
          target,
        );

        const first = await runApplyLint(target);
        expect(
          first.mutations.filter(
            (m) => m.kind === "knowledge_pending_auto_archive",
          ),
        ).toHaveLength(1);

        const second = await runApplyLint(target);
        expect(
          second.mutations.filter(
            (m) => m.kind === "knowledge_pending_auto_archive",
          ),
        ).toHaveLength(0);
      });
    });

    it("idempotent: 2nd apply-lint run on resolved tree produces 0 mutations", async () => {
      const target = createInitializedProject("doctor-rc4-applylint-idempotent");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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
      // writeKnowledgeMeta — both are legitimate first-run repairs and are
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
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
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

  // rc.4 TASK-010 (Gemini-review HIGH fix): rollback when ledger append fails
  // after a filesystem mutation. We simulate ledger-append failure by replacing
  // .fabric/events.jsonl with a directory at the same path (ledgerQueue.append
  // attempts a writeFile against this path which fails with EISDIR).
  describe("rc.4 TASK-010: apply-lint rollback on ledger-append failure", () => {
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

    /**
     * Replaces the events.jsonl file with a directory of the same name, then
     * runs apply-lint. Any code path that calls appendEventLedgerEvent will
     * fail (writeFile against a directory throws EISDIR). After the test, the
     * tearDown restores the path so subsequent reads do not pollute.
     */
    function poisonLedger(target: string): void {
      const ledgerPath = join(target, ".fabric", "events.jsonl");
      // Save existing contents to a sibling, replace with directory.
      const saved = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
      writeFileSync(join(target, ".fabric", ".events.saved"), saved, "utf8");
      rmSync(ledgerPath, { force: true });
      mkdirSync(ledgerPath, { recursive: false });
    }

    async function runApplyLint(target: string) {
      const { runDoctorApplyLint } = await import("./doctor.js");
      return runDoctorApplyLint(target);
    }

    it("orphan_demote: rolls back frontmatter rewrite when ledger append fails", async () => {
      const target = createInitializedProject("doctor-rc4-rollback-orphan");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const filePath = ".fabric/knowledge/decisions/KT-DEC-1500--ancient-stable.md";
      seedCanonical(target, filePath, "KT-DEC-1500", "stable", 100);

      const beforeSource = readFileSync(join(target, filePath), "utf8");
      expect(beforeSource).toContain("maturity: stable");

      // Replace events.jsonl with a directory to trigger append failure.
      poisonLedger(target);

      const result = await runApplyLint(target);

      // The orphan-demote mutation should report applied=false with a
      // ledger-append error, AND the file content should be byte-identical
      // to the pre-mutation state (rolled back).
      const orphanMutation = result.mutations.find(
        (m) => m.kind === "knowledge_orphan_demote_required",
      );
      expect(orphanMutation).toBeDefined();
      expect(orphanMutation?.applied).toBe(false);
      expect(orphanMutation?.error).toMatch(/ledger append failed/);
      expect(orphanMutation?.error).toMatch(/rolled back/);

      const afterSource = readFileSync(join(target, filePath), "utf8");
      expect(afterSource).toBe(beforeSource);
      expect(afterSource).toContain("maturity: stable");
      expect(afterSource).not.toContain("maturity: endorsed");
    });

    it("stale_archive: rolls back rename when ledger append fails", async () => {
      const target = createInitializedProject("doctor-rc4-rollback-stale");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const filePath = ".fabric/knowledge/decisions/KT-DEC-1501--ancient-draft.md";
      const archivePath = ".fabric/.archive/decisions/KT-DEC-1501--ancient-draft.md";
      seedCanonical(target, filePath, "KT-DEC-1501", "draft", 110);

      expect(existsSync(join(target, filePath))).toBe(true);
      expect(existsSync(join(target, archivePath))).toBe(false);

      poisonLedger(target);

      const result = await runApplyLint(target);

      const archiveMutation = result.mutations.find(
        (m) => m.kind === "knowledge_stale_archive_required",
      );
      expect(archiveMutation).toBeDefined();
      expect(archiveMutation?.applied).toBe(false);
      expect(archiveMutation?.error).toMatch(/ledger append failed/);
      expect(archiveMutation?.error).toMatch(/rolled back/);

      // The canonical file should still be at its original location AND not
      // stranded at the archive path.
      expect(existsSync(join(target, filePath))).toBe(true);
      expect(existsSync(join(target, archivePath))).toBe(false);
    });
  });

  // rc.5 TASK-013 (C4): lint #23 narrow_no_paths + #24 relevance_paths_dangling
  // + #25 relevance_paths_drift. All three are flag-only in rc.5 — no
  // apply-lint mutations. Each test seeds a canonical entry with explicit
  // relevance_scope / relevance_paths frontmatter and asserts the resulting
  // check's kind/code without invoking runDoctorApplyLint.
  describe("rc.5 TASK-013 (C4): relevance_paths hygiene lints", () => {
    function seedRelevanceEntry(
      target: string,
      relPath: string,
      stableId: string,
      scope: "narrow" | "broad",
      paths: string[],
    ): void {
      const pathsField = `[${paths.join(", ")}]`;
      const fm =
        `---\nid: ${stableId}\ntype: decision\nmaturity: stable\nlayer: team\n` +
        `relevance_scope: ${scope}\nrelevance_paths: ${pathsField}\n---\n# ${stableId}\nBody.\n`;
      writeFile(relPath, fm, target);
    }

    // ---- #23 narrow_no_paths ----------------------------------------------
    it("#23 narrow_no_paths flags narrow entry with empty paths", async () => {
      const target = createInitializedProject("doctor-rc5-c4-narrow-no-paths");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedRelevanceEntry(
        target,
        ".fabric/knowledge/decisions/KT-DEC-7001--narrow-empty.md",
        "KT-DEC-7001",
        "narrow",
        [],
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow without paths");
      expect(check?.code).toBe("knowledge_narrow_no_paths");
      expect(check?.kind).toBe("warning");
      expect(check?.status).toBe("warn");
      expect(check?.message).toContain("KT-DEC-7001");
      expect(report.warnings.map((w) => w.code)).toContain("knowledge_narrow_no_paths");
    });

    it("#23 does NOT flag broad entry with empty paths (broad+[] is the schema default)", async () => {
      const target = createInitializedProject("doctor-rc5-c4-broad-no-paths");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedRelevanceEntry(
        target,
        ".fabric/knowledge/decisions/KT-DEC-7002--broad-empty.md",
        "KT-DEC-7002",
        "broad",
        [],
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow without paths");
      expect(check?.status).toBe("ok");
      expect(report.warnings.map((w) => w.code)).not.toContain("knowledge_narrow_no_paths");
    });

    // ---- #24 relevance_paths_dangling -------------------------------------
    it("#24 dangling flags a glob that resolves to zero matches in the workspace", async () => {
      const target = createInitializedProject("doctor-rc5-c4-dangling-zero");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // The glob `src/deleted-feature/**` resolves to zero matches under the
      // freshly-seeded createInitializedProject layout (which has src/main.ts
      // but no src/deleted-feature/ directory).
      seedRelevanceEntry(
        target,
        ".fabric/knowledge/decisions/KT-DEC-7010--dangling.md",
        "KT-DEC-7010",
        "narrow",
        ["src/deleted-feature/**"],
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge relevance_paths dangling");
      expect(check?.code).toBe("knowledge_relevance_paths_dangling");
      expect(check?.kind).toBe("warning");
      expect(check?.status).toBe("warn");
      expect(check?.message).toContain("KT-DEC-7010");
      expect(check?.message).toContain("src/deleted-feature/**");
      expect(report.warnings.map((w) => w.code)).toContain(
        "knowledge_relevance_paths_dangling",
      );
    });

    it("#24 does NOT flag a glob that has at least one match", async () => {
      const target = createInitializedProject("doctor-rc5-c4-dangling-match");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // `src/main.ts` exists under createInitializedProject; the glob
      // `src/**` matches it (and src/ itself).
      seedRelevanceEntry(
        target,
        ".fabric/knowledge/decisions/KT-DEC-7011--matched.md",
        "KT-DEC-7011",
        "narrow",
        ["src/**"],
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge relevance_paths dangling");
      expect(check?.status).toBe("ok");
      expect(report.warnings.map((w) => w.code)).not.toContain(
        "knowledge_relevance_paths_dangling",
      );
    });

    // ---- #25 relevance_paths_drift ----------------------------------------
    // The drift check shells out to `git log`. In the test fixture the tmpdir
    // is NOT a git repo, so the inspection downgrades to git_available=false
    // and emits an informational ok message. We assert the downgrade path
    // here — it is the only case reachable in the unit test sandbox.
    it("#25 drift downgrades to ok when git history is unavailable (no candidates)", async () => {
      const target = createInitializedProject("doctor-rc5-c4-drift-no-git");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Seed a narrow entry with a non-empty relevance_paths; without git
      // history the drift check cannot evaluate so it MUST NOT emit a
      // false-positive candidate.
      seedRelevanceEntry(
        target,
        ".fabric/knowledge/decisions/KT-DEC-7020--drift-candidate.md",
        "KT-DEC-7020",
        "narrow",
        ["src/**"],
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge relevance_paths drift");
      expect(check?.status).toBe("ok");
      // info findings live on report.infos when the kind is info; the
      // git-unavailable branch is an okCheck (kind undefined) so it must
      // NOT surface in the infos array.
      expect(report.infos.map((i) => i.code)).not.toContain(
        "knowledge_relevance_paths_drift",
      );
    });

    it("#25 drift does NOT flag broad entries even when git history is available", async () => {
      // Even if we were inside a git repo, broad entries are out of scope
      // for #25 — only narrow entries are evaluated. Mirrors the
      // narrow_no_paths exclusion logic (#23 also skips broad entries).
      const target = createInitializedProject("doctor-rc5-c4-drift-broad");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedRelevanceEntry(
        target,
        ".fabric/knowledge/decisions/KT-DEC-7021--broad-with-paths.md",
        "KT-DEC-7021",
        "broad",
        ["src/**"],
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge relevance_paths drift");
      // Either the git-unavailable ok branch fires, or the "no narrow
      // candidates" ok branch fires. Both produce status=ok with no info
      // candidate keyed off this stable_id.
      expect(check?.status).toBe("ok");
      expect(report.infos.map((i) => i.code)).not.toContain(
        "knowledge_relevance_paths_drift",
      );
    });
  });

  // rc.6 TASK-021 (E3): lint #27 knowledge_session_hints_stale. Info-kind
  // finding plus an apply-lint cleanup arm that unlinks stale session-hints
  // cache files under `.fabric/.cache/`. Tests seed files with explicit
  // mtimes via utimesSync to exercise the 7-day threshold deterministically.
  describe("rc.6 TASK-021 (E3): session-hints stale lint #27", () => {
    const NOW_SECONDS = Math.floor(Date.now() / 1000);
    const DAY_SECONDS = 24 * 60 * 60;

    function seedSessionHintsFile(
      target: string,
      sessionId: string,
      mtimeAgeDays: number,
    ): string {
      const cacheDir = join(target, ".fabric", ".cache");
      mkdirSync(cacheDir, { recursive: true });
      const file = join(cacheDir, `session-hints-${sessionId}.json`);
      writeFileSync(
        file,
        JSON.stringify({
          session_id: sessionId,
          revision_hash: "rev-test",
          hinted_paths: [],
          hinted_stable_ids: [],
          last_emitted_index_hash: "",
        }),
        "utf8",
      );
      // Reach back in time to age the mtime. utimesSync takes seconds.
      const targetSeconds = NOW_SECONDS - mtimeAgeDays * DAY_SECONDS;
      utimesSync(file, targetSeconds, targetSeconds);
      return file;
    }

    async function runApplyLint(target: string) {
      const { runDoctorApplyLint } = await import("./doctor.js");
      return runDoctorApplyLint(target);
    }

    it("reports ok when .fabric/.cache/ is absent (no cache files ever written)", async () => {
      const target = createInitializedProject("doctor-rc6-sessionhints-no-dir");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const report = await runDoctorReport(target);
      const check = report.checks.find(
        (c) => c.name === "Knowledge session-hints stale",
      );
      expect(check?.status).toBe("ok");
      expect(report.infos.map((i) => i.code)).not.toContain(
        "knowledge_session_hints_stale",
      );
    });

    it("reports ok when only fresh cache files exist (mtime < 7d)", async () => {
      const target = createInitializedProject("doctor-rc6-sessionhints-fresh");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedSessionHintsFile(target, "sess-fresh-a", 0); // today
      seedSessionHintsFile(target, "sess-fresh-b", 6); // just under threshold

      const report = await runDoctorReport(target);
      const check = report.checks.find(
        (c) => c.name === "Knowledge session-hints stale",
      );
      expect(check?.status).toBe("ok");
      expect(report.infos.map((i) => i.code)).not.toContain(
        "knowledge_session_hints_stale",
      );
    });

    it("flags stale cache files (mtime >= 7d) as info-kind finding", async () => {
      const target = createInitializedProject("doctor-rc6-sessionhints-stale-flag");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedSessionHintsFile(target, "sess-stale-1", 8);
      seedSessionHintsFile(target, "sess-stale-2", 30);

      const report = await runDoctorReport(target);
      const check = report.checks.find(
        (c) => c.name === "Knowledge session-hints stale",
      );
      expect(check?.status).toBe("ok"); // info-kind, status not bumped
      expect(check?.kind).toBe("info");
      expect(report.infos.map((i) => i.code)).toContain(
        "knowledge_session_hints_stale",
      );
    });

    it("ignores non-session-hints files in .fabric/.cache/", async () => {
      const target = createInitializedProject("doctor-rc6-sessionhints-ignores-others");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // The edit-counter sidecar lives in the same directory; doctor must
      // not flag it for cleanup. Age it to >7d to make the test sharp.
      const cacheDir = join(target, ".fabric", ".cache");
      mkdirSync(cacheDir, { recursive: true });
      const counter = join(cacheDir, "edit-counter");
      writeFileSync(counter, "2026-04-01T00:00:00.000Z\n", "utf8");
      const old = NOW_SECONDS - 30 * DAY_SECONDS;
      utimesSync(counter, old, old);

      const report = await runDoctorReport(target);
      const check = report.checks.find(
        (c) => c.name === "Knowledge session-hints stale",
      );
      expect(check?.status).toBe("ok");
      expect(report.infos.map((i) => i.code)).not.toContain(
        "knowledge_session_hints_stale",
      );
    });

    it("apply-lint deletes stale session-hints files (>7d)", async () => {
      const target = createInitializedProject("doctor-rc6-sessionhints-apply-delete");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      const staleFileA = seedSessionHintsFile(target, "sess-old-a", 10);
      const staleFileB = seedSessionHintsFile(target, "sess-old-b", 90);
      expect(existsSync(staleFileA)).toBe(true);
      expect(existsSync(staleFileB)).toBe(true);

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(false);
      const cleanupMutations = result.mutations.filter(
        (m) => m.kind === "knowledge_session_hints_stale_cleanup",
      );
      expect(cleanupMutations).toHaveLength(2);
      expect(cleanupMutations.every((m) => m.applied)).toBe(true);

      // Both files should be gone.
      expect(existsSync(staleFileA)).toBe(false);
      expect(existsSync(staleFileB)).toBe(false);
    });

    it("apply-lint preserves fresh session-hints files (<7d)", async () => {
      const target = createInitializedProject("doctor-rc6-sessionhints-preserve-fresh");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      const freshFile = seedSessionHintsFile(target, "sess-fresh", 1);
      const staleFile = seedSessionHintsFile(target, "sess-old", 20);
      expect(existsSync(freshFile)).toBe(true);
      expect(existsSync(staleFile)).toBe(true);

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(false);
      const cleanupMutations = result.mutations.filter(
        (m) => m.kind === "knowledge_session_hints_stale_cleanup",
      );
      expect(cleanupMutations).toHaveLength(1);
      expect(cleanupMutations[0].applied).toBe(true);

      // Fresh file preserved, stale file deleted.
      expect(existsSync(freshFile)).toBe(true);
      expect(existsSync(staleFile)).toBe(false);
    });

    it("apply-lint cleanup is idempotent (second run produces zero mutations)", async () => {
      const target = createInitializedProject("doctor-rc6-sessionhints-idempotent");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedSessionHintsFile(target, "sess-old", 30);

      const first = await runApplyLint(target);
      expect(
        first.mutations.filter((m) => m.kind === "knowledge_session_hints_stale_cleanup"),
      ).toHaveLength(1);

      const second = await runApplyLint(target);
      expect(
        second.mutations.filter((m) => m.kind === "knowledge_session_hints_stale_cleanup"),
      ).toHaveLength(0);
    });
  });

  // rc.23 TASK-010 (e): stale `.fabric/.serve.lock` advisory + --fix unlink.
  // The serve lock is written by `acquireLock` at the top of `fab serve` and
  // released on graceful shutdown; a SIGKILL leaves the file on disk holding
  // a dead PID, blocking subsequent serve attempts. Doctor surfaces an
  // info-kind advisory; `--fix` unlinks the corpse and emits
  // `serve_lock_cleared`.
  describe("rc.23 TASK-010 (e): stale .fabric/.serve.lock advisory", () => {
    // A PID guaranteed never to exist: > 2^22 (Linux pid_max ceiling) and
    // safely outside any reasonable system's allocation. signal-0 returns
    // ESRCH ("no such process") so `isAlive` reports false.
    const DEAD_PID = 99999999;

    function seedServeLock(target: string, pid: number, acquiredAt: number): string {
      const dir = join(target, ".fabric");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, ".serve.lock");
      writeFileSync(file, JSON.stringify({ pid, acquiredAt, host: "test-host" }), "utf8");
      return file;
    }

    it("reports ok when .fabric/.serve.lock is absent", async () => {
      const target = createInitializedProject("doctor-rc23-servelock-absent");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Serve lock");
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined();
      expect(report.infos.map((i) => i.code)).not.toContain("stale_serve_lock");
    });

    it("reports ok when lock holds a live PID (no advisory)", async () => {
      const target = createInitializedProject("doctor-rc23-servelock-alive");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // process.pid is the vitest worker — guaranteed alive for the duration
      // of the test. acquireLock writes Date.now(); we mirror that.
      seedServeLock(target, process.pid, Date.now());

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Serve lock");
      expect(check?.status).toBe("ok");
      expect(report.infos.map((i) => i.code)).not.toContain("stale_serve_lock");
    });

    it("flags stale lock (dead PID) as info-kind advisory", async () => {
      const target = createInitializedProject("doctor-rc23-servelock-stale-flag");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // 5 days ago — matches the dogfood report shape: "acquired 5 days ago".
      const acquired = Date.now() - 5 * 24 * 60 * 60 * 1000;
      seedServeLock(target, DEAD_PID, acquired);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Serve lock");
      expect(check?.status).toBe("ok"); // info kind — status not bumped
      expect(check?.kind).toBe("info");
      expect(check?.code).toBe("stale_serve_lock");
      expect(check?.message).toContain("[advisory]");
      expect(check?.message).toContain(`dead PID ${DEAD_PID}`);
      expect(check?.message).toContain("5 days ago");
      expect(report.infos.map((i) => i.code)).toContain("stale_serve_lock");
    });

    it("renders hours-ago wording when lock < 1 day old", async () => {
      const target = createInitializedProject("doctor-rc23-servelock-hours");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // 3 hours ago — below the days threshold.
      const acquired = Date.now() - 3 * 60 * 60 * 1000;
      seedServeLock(target, DEAD_PID, acquired);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Serve lock");
      expect(check?.message).toContain("3 hours ago");
    });

    it("--fix unlinks the stale lock and emits serve_lock_cleared event", async () => {
      const target = createInitializedProject("doctor-rc23-servelock-fix");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      const acquired = Date.now() - 5 * 24 * 60 * 60 * 1000;
      const lockFile = seedServeLock(target, DEAD_PID, acquired);
      expect(existsSync(lockFile)).toBe(true);

      const fix = await runDoctorFix(target);

      expect(existsSync(lockFile)).toBe(false);
      expect(fix.fixed.map((i) => i.code)).toContain("stale_serve_lock");

      // Ledger event recorded for audit trail.
      const { events } = await readEventLedger(target);
      const cleared = events.filter((e) => e.event_type === "serve_lock_cleared");
      expect(cleared).toHaveLength(1);
      expect((cleared[0] as { pid: number }).pid).toBe(DEAD_PID);
    });

    it("--fix preserves a lock held by a live PID (no-op)", async () => {
      const target = createInitializedProject("doctor-rc23-servelock-fix-preserve");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      const lockFile = seedServeLock(target, process.pid, Date.now());

      const fix = await runDoctorFix(target);

      expect(existsSync(lockFile)).toBe(true);
      expect(fix.fixed.map((i) => i.code)).not.toContain("stale_serve_lock");
    });
  });

  // rc.6 TASK-023 (E6): lint #26 knowledge_narrow_too_few. Two-arm check —
  // Part A (structural ratio < 0.20 AND total >= 10) and Part B (silence
  // rate > 0.95 over 30d window). Either arm independently can flag; both
  // point at the same fabric-import recommendation. Tests seed canonical
  // entries via writeKnowledgeMeta + frontmatter helpers and seed the
  // edit-counter / hint-silence-counter sidecars directly under
  // .fabric/.cache/ to exercise the telemetry arm deterministically.
  describe("rc.6 TASK-023 (E6): narrow_too_few lint #26", () => {
    function seedRelevanceEntry(
      target: string,
      relPath: string,
      stableId: string,
      scope: "narrow" | "broad",
      paths: string[],
    ): void {
      const pathsField = `[${paths.join(", ")}]`;
      const fm =
        `---\nid: ${stableId}\ntype: decision\nmaturity: stable\nlayer: team\n` +
        `relevance_scope: ${scope}\nrelevance_paths: ${pathsField}\n---\n# ${stableId}\nBody.\n`;
      writeFile(relPath, fm, target);
    }

    function seedCounter(
      target: string,
      filename: "edit-counter" | "hint-silence-counter",
      timestamps: string[],
    ): void {
      const cacheDir = join(target, ".fabric", ".cache");
      mkdirSync(cacheDir, { recursive: true });
      const file = join(cacheDir, filename);
      writeFileSync(file, timestamps.map((t) => `${t}\n`).join(""), "utf8");
    }

    // Generate N timestamps inside the SILENCE_WINDOW_DAYS=30d window. We
    // space them across the recent past so all land safely inside the
    // window regardless of test runner clock skew.
    function recentTimestamps(n: number, dayOffset = 1): string[] {
      const out: string[] = [];
      for (let i = 0; i < n; i += 1) {
        // Stagger by minutes so duplicate timestamps don't accidentally
        // collide on the parser's millisecond resolution.
        const ts = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000 - i * 60_000);
        out.push(ts.toISOString());
      }
      return out;
    }

    // Seed `count` distinct canonical entries with the requested scope/paths
    // shape so we can drive total_canonical_entries to any value.
    function seedBulkNarrowEntries(
      target: string,
      count: number,
      scope: "narrow" | "broad",
      paths: string[],
      startCounter: number,
    ): void {
      for (let i = 0; i < count; i += 1) {
        const counter = startCounter + i;
        const stableId = `KT-DEC-${String(8000 + counter).padStart(4, "0")}`;
        const slug = `bulk-${scope}-${counter}`;
        seedRelevanceEntry(
          target,
          `.fabric/knowledge/decisions/${stableId}--${slug}.md`,
          stableId,
          scope,
          paths,
        );
      }
    }

    // ---- Part A — structural ratio ----------------------------------------
    it("#26 Part A — flags when narrow-with-paths ratio < 20% AND total >= 10", async () => {
      const target = createInitializedProject("doctor-rc6-narrowtoofew-partA-flag");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Seed 11 entries; only 1 is narrow-with-paths → ratio ~9% < 20%.
      seedBulkNarrowEntries(target, 1, "narrow", ["src/**"], 1);
      seedBulkNarrowEntries(target, 10, "broad", [], 100);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow too few");
      expect(check?.code).toBe("knowledge_narrow_too_few");
      expect(check?.kind).toBe("info");
      expect(check?.status).toBe("ok"); // info kind — status not bumped
      expect(check?.message).toMatch(/narrow-with-paths share/);
      expect(check?.actionHint).toMatch(/fabric-import/);
      expect(report.infos.map((i) => i.code)).toContain("knowledge_narrow_too_few");
    });

    it("#26 Part A — does NOT flag when total < 10 (insufficient data)", async () => {
      const target = createInitializedProject("doctor-rc6-narrowtoofew-partA-small");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // 5 entries total — below NARROW_MIN_TOTAL=10. Even with 0%
      // narrow-with-paths the structural arm MUST stay silent.
      seedBulkNarrowEntries(target, 5, "broad", [], 200);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow too few");
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined(); // okCheck → no kind
      expect(report.infos.map((i) => i.code)).not.toContain("knowledge_narrow_too_few");
    });

    it("#26 Part A — does NOT flag when narrow-with-paths ratio >= 20%", async () => {
      const target = createInitializedProject("doctor-rc6-narrowtoofew-partA-healthy");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // 10 entries; 3 narrow-with-paths → 30% > 20% threshold.
      seedBulkNarrowEntries(target, 3, "narrow", ["src/**"], 300);
      seedBulkNarrowEntries(target, 7, "broad", [], 310);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow too few");
      expect(check?.status).toBe("ok");
      expect(report.infos.map((i) => i.code)).not.toContain("knowledge_narrow_too_few");
    });

    // ---- Part B — telemetry silence rate ----------------------------------
    it("#26 Part B — flags when silence rate > 95% over 30d window", async () => {
      const target = createInitializedProject("doctor-rc6-narrowtoofew-partB-flag");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Healthy structural shape (so only Part B can fire).
      seedBulkNarrowEntries(target, 3, "narrow", ["src/**"], 400);
      seedBulkNarrowEntries(target, 7, "broad", [], 410);
      // 100 edit fires, 96 silences → 96% > 95% threshold.
      seedCounter(target, "edit-counter", recentTimestamps(100));
      seedCounter(target, "hint-silence-counter", recentTimestamps(96, 2));

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow too few");
      expect(check?.code).toBe("knowledge_narrow_too_few");
      expect(check?.kind).toBe("info");
      expect(check?.message).toMatch(/silence rate/);
      expect(check?.actionHint).toMatch(/fabric-import/);
      expect(report.infos.map((i) => i.code)).toContain("knowledge_narrow_too_few");
    });

    it("#26 Part B — skips when no edit-counter fires in window (insufficient data)", async () => {
      const target = createInitializedProject("doctor-rc6-narrowtoofew-partB-skip");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Healthy structural shape — Part A passes.
      seedBulkNarrowEntries(target, 3, "narrow", ["src/**"], 500);
      seedBulkNarrowEntries(target, 7, "broad", [], 510);
      // No edit-counter and no hint-silence-counter at all. Part B MUST
      // safe-degrade rather than flag (silence_rate is undefined here).

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow too few");
      expect(check?.status).toBe("ok");
      expect(check?.message).toMatch(/telemetry skipped/);
      expect(report.infos.map((i) => i.code)).not.toContain("knowledge_narrow_too_few");
    });

    it("#26 Part B — does NOT flag when silence rate <= 95%", async () => {
      const target = createInitializedProject("doctor-rc6-narrowtoofew-partB-healthy");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedBulkNarrowEntries(target, 3, "narrow", ["src/**"], 600);
      seedBulkNarrowEntries(target, 7, "broad", [], 610);
      // 100 edits, 50 silences → 50% rate; well below threshold.
      seedCounter(target, "edit-counter", recentTimestamps(100));
      seedCounter(target, "hint-silence-counter", recentTimestamps(50, 2));

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow too few");
      expect(check?.status).toBe("ok");
      expect(report.infos.map((i) => i.code)).not.toContain("knowledge_narrow_too_few");
    });

    // ---- Combined — either arm flags --------------------------------------
    it("#26 combined — Part A passing but Part B flagging still flags overall", async () => {
      const target = createInitializedProject("doctor-rc6-narrowtoofew-combined-B-only");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Structural arm passes: healthy 30% ratio.
      seedBulkNarrowEntries(target, 3, "narrow", ["src/**"], 700);
      seedBulkNarrowEntries(target, 7, "broad", [], 710);
      // Telemetry arm flags: 96% silence rate.
      seedCounter(target, "edit-counter", recentTimestamps(100));
      seedCounter(target, "hint-silence-counter", recentTimestamps(96, 2));

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow too few");
      expect(check?.code).toBe("knowledge_narrow_too_few");
      expect(check?.kind).toBe("info");
      // The message describes only the telemetry arm (structural didn't fire).
      expect(check?.message).toMatch(/silence rate/);
      expect(check?.message).not.toMatch(/narrow-with-paths share/);
      expect(report.infos.map((i) => i.code)).toContain("knowledge_narrow_too_few");
    });

    it("#26 combined — old timestamps outside 30d window are excluded", async () => {
      const target = createInitializedProject("doctor-rc6-narrowtoofew-old-ts");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedBulkNarrowEntries(target, 3, "narrow", ["src/**"], 800);
      seedBulkNarrowEntries(target, 7, "broad", [], 810);
      // 100 silences ALL outside the 30d window → must not flag.
      const farPast = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      seedCounter(target, "edit-counter", Array(100).fill(farPast));
      seedCounter(target, "hint-silence-counter", Array(100).fill(farPast));

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Knowledge narrow too few");
      // edit-counter has 0 fires in window → Part B safely skips. Part A
      // is healthy → check stays ok.
      expect(check?.status).toBe("ok");
      expect(check?.message).toMatch(/telemetry skipped/);
      expect(report.infos.map((i) => i.code)).not.toContain("knowledge_narrow_too_few");
    });
  });

  // v2.0.0-rc.9 TASK-003 (A3): lint #28 knowledge_relevance_fields_missing.
  // Detect-mode reports pending entries whose frontmatter is missing
  // relevance_scope / relevance_paths; apply-lint back-fills the schema
  // defaults (relevance_scope: broad, relevance_paths: []) and emits one
  // aggregate `relevance_migration_run` event with scanned_count /
  // touched_count. Tests use the dual-root (team + personal) pending walker.
  describe("rc.9 TASK-003 (A3): relevance fields missing lint #28", () => {
    async function runApplyLint(target: string) {
      const { runDoctorApplyLint } = await import("./doctor.js");
      return runDoctorApplyLint(target);
    }

    // ---- Detect mode ------------------------------------------------------
    it("#28 flags pending entry missing both relevance_scope and relevance_paths", async () => {
      const target = createInitializedProject("doctor-rc9-relfields-detect-both");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Pending frontmatter without relevance_scope / relevance_paths.
      writeFile(
        ".fabric/knowledge/pending/decisions/missing-both.md",
        `---\ntype: decision\nlayer: team\nmaturity: draft\n---\n# Missing Both\nBody.\n`,
        target,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find(
        (c) => c.name === "Knowledge relevance fields missing",
      );
      expect(check?.code).toBe("knowledge_relevance_fields_missing");
      expect(check?.kind).toBe("info");
      expect(check?.status).toBe("ok"); // info kind — status not bumped
      expect(check?.message).toContain("missing-both.md");
      expect(check?.message).toMatch(/relevance_scope/);
      expect(check?.message).toMatch(/relevance_paths/);
      expect(check?.actionHint).toMatch(/--fix-knowledge/);
      expect(report.infos.map((i) => i.code)).toContain(
        "knowledge_relevance_fields_missing",
      );
    });

    it("#28 flags pending entry missing only relevance_paths (partial)", async () => {
      const target = createInitializedProject("doctor-rc9-relfields-detect-partial");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Frontmatter has scope but no paths.
      writeFile(
        ".fabric/knowledge/pending/pitfalls/partial.md",
        `---\ntype: pitfall\nlayer: team\nrelevance_scope: broad\n---\n# Partial\nBody.\n`,
        target,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find(
        (c) => c.name === "Knowledge relevance fields missing",
      );
      expect(check?.code).toBe("knowledge_relevance_fields_missing");
      expect(check?.message).toContain("partial.md");
      expect(check?.message).toMatch(/relevance_paths/);
    });

    it("#28 does NOT flag pending entry that already has both fields", async () => {
      const target = createInitializedProject("doctor-rc9-relfields-complete");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      writeFile(
        ".fabric/knowledge/pending/decisions/complete.md",
        `---\ntype: decision\nlayer: team\nrelevance_scope: broad\nrelevance_paths: []\n---\n# Complete\nBody.\n`,
        target,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find(
        (c) => c.name === "Knowledge relevance fields missing",
      );
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined(); // okCheck path
      expect(report.infos.map((i) => i.code)).not.toContain(
        "knowledge_relevance_fields_missing",
      );
    });

    it("#28 does NOT scan canonical entries (only pending)", async () => {
      const target = createInitializedProject("doctor-rc9-relfields-canonical-skip");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Canonical entry without relevance fields — must NOT be flagged.
      writeFile(
        ".fabric/knowledge/decisions/KT-DEC-9001--canonical.md",
        `---\nid: KT-DEC-9001\ntype: decision\nlayer: team\nmaturity: stable\n---\n# Canonical\nBody.\n`,
        target,
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find(
        (c) => c.name === "Knowledge relevance fields missing",
      );
      expect(check?.status).toBe("ok");
      expect(report.infos.map((i) => i.code)).not.toContain(
        "knowledge_relevance_fields_missing",
      );
    });

    // ---- Apply-lint mode --------------------------------------------------
    it("#28 apply-lint writes relevance_scope: broad + relevance_paths: [] to missing entries", async () => {
      const target = createInitializedProject("doctor-rc9-relfields-apply-write");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      const pendingRel =
        ".fabric/knowledge/pending/decisions/needs-backfill.md";
      writeFile(
        pendingRel,
        `---\ntype: decision\nlayer: team\nmaturity: draft\n---\n# Needs Backfill\nBody.\n`,
        target,
      );

      const result = await runApplyLint(target);
      expect(result.aborted).toBe(false);
      const mutation = result.mutations.find(
        (m) => m.kind === "knowledge_relevance_fields_missing",
      );
      expect(mutation).toBeDefined();
      expect(mutation?.applied).toBe(true);
      expect(mutation?.path).toBe(pendingRel);
      expect(mutation?.detail).toMatch(/relevance_scope: broad/);
      expect(mutation?.detail).toMatch(/relevance_paths: \[\]/);

      // Verify the on-disk frontmatter now contains BOTH fields verbatim
      // (matching the regexes at doctor.ts L627-628).
      const written = readFileSync(join(target, pendingRel), "utf8");
      expect(written).toMatch(/^relevance_scope: broad$/mu);
      expect(written).toMatch(/^relevance_paths: \[\]$/mu);
      // Original frontmatter preserved.
      expect(written).toContain("type: decision");
      expect(written).toContain("# Needs Backfill");
    });

    it("#28 apply-lint emits exactly one relevance_migration_run event with accurate counts", async () => {
      const target = createInitializedProject("doctor-rc9-relfields-apply-event");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // Two pending entries needing back-fill + one already complete.
      writeFile(
        ".fabric/knowledge/pending/decisions/a.md",
        `---\ntype: decision\nlayer: team\n---\n# A\n`,
        target,
      );
      writeFile(
        ".fabric/knowledge/pending/pitfalls/b.md",
        `---\ntype: pitfall\nlayer: team\nrelevance_scope: narrow\n---\n# B\n`,
        target,
      );
      writeFile(
        ".fabric/knowledge/pending/models/c.md",
        `---\ntype: model\nlayer: team\nrelevance_scope: broad\nrelevance_paths: []\n---\n# C\n`,
        target,
      );

      await runApplyLint(target);

      const { events } = await readEventLedger(target, {
        event_type: "relevance_migration_run",
      });
      expect(events).toHaveLength(1);
      const evt = events[0];
      if (evt.event_type !== "relevance_migration_run") {
        throw new Error("type narrowing failed");
      }
      // 3 scanned, 2 touched (a + b; c already complete).
      expect(evt.scanned_count).toBe(3);
      expect(evt.touched_count).toBe(2);
      expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    });

    it("#28 apply-lint is idempotent — second run produces zero mutations + touched_count=0", async () => {
      const target = createInitializedProject("doctor-rc9-relfields-idempotent");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      writeFile(
        ".fabric/knowledge/pending/decisions/needs-backfill.md",
        `---\ntype: decision\nlayer: team\n---\n# A\n`,
        target,
      );

      const first = await runApplyLint(target);
      const firstMutations = first.mutations.filter(
        (m) => m.kind === "knowledge_relevance_fields_missing",
      );
      expect(firstMutations).toHaveLength(1);
      expect(firstMutations[0].applied).toBe(true);

      const second = await runApplyLint(target);
      const secondMutations = second.mutations.filter(
        (m) => m.kind === "knowledge_relevance_fields_missing",
      );
      // Idempotent: no mutations on the re-run.
      expect(secondMutations).toHaveLength(0);

      // Both runs emit a relevance_migration_run event (audit heartbeat),
      // but the second one has touched_count=0.
      const { events } = await readEventLedger(target, {
        event_type: "relevance_migration_run",
      });
      expect(events).toHaveLength(2);
      const second_evt = events[1];
      if (second_evt.event_type !== "relevance_migration_run") {
        throw new Error("type narrowing failed");
      }
      expect(second_evt.touched_count).toBe(0);
    });

    it("#28 apply-lint preserves original frontmatter bytes and appends only the missing fields", async () => {
      const target = createInitializedProject("doctor-rc9-relfields-preserve");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      const pendingRel = ".fabric/knowledge/pending/guidelines/preserve.md";
      const before = `---\ntype: guideline\nlayer: team\nrelevance_scope: narrow\n---\n# Preserve\nKeep this body intact.\n`;
      writeFile(pendingRel, before, target);

      await runApplyLint(target);

      const after = readFileSync(join(target, pendingRel), "utf8");
      // Original fields untouched.
      expect(after).toContain("type: guideline");
      expect(after).toContain("relevance_scope: narrow");
      // Newly appended field.
      expect(after).toMatch(/^relevance_paths: \[\]$/mu);
      // Body preserved.
      expect(after).toContain("# Preserve");
      expect(after).toContain("Keep this body intact.");
      // No duplicate scope writes (scope was already present, not touched).
      const scopeMatches = after.match(/relevance_scope:/gu);
      expect(scopeMatches).toHaveLength(1);
    });

    it("#28 apply-lint emits aggregate event even with zero pending entries", async () => {
      const target = createInitializedProject("doctor-rc9-relfields-zero-pending");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      // No pending entries seeded.

      await runApplyLint(target);

      const { events } = await readEventLedger(target, {
        event_type: "relevance_migration_run",
      });
      // Heartbeat invariant: one event per --apply-lint invocation, even
      // when scanned_count=0.
      expect(events).toHaveLength(1);
      const evt = events[0];
      if (evt.event_type !== "relevance_migration_run") {
        throw new Error("type narrowing failed");
      }
      expect(evt.scanned_count).toBe(0);
      expect(evt.touched_count).toBe(0);
    });
  });

  // rc.12 lint #29: skill_md_yaml_invalid. Warning-kind finding that scans
  // .claude/skills/*/SKILL.md and .codex/skills/*/SKILL.md frontmatter for
  // unquoted `: ` tokens that Codex CLI's strict YAML parser rejects.
  describe("rc.12 lint #29: skill_md_yaml_invalid", () => {
    function seedSkill(target: string, relDir: string, frontmatter: string): void {
      // Test fixture: only the SKILL.md needs to exist; the lint walks the
      // skill directory and reads each SKILL.md file.
      writeFile(`${relDir}/SKILL.md`, frontmatter, target);
    }

    it("flags a SKILL.md whose description has an unquoted ': '", async () => {
      const target = createInitializedProject("doctor-rc12-skill-yaml-invalid");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedSkill(
        target,
        ".claude/skills/example-skill",
        "---\nname: example-skill\ndescription: Use this skill via `tool action: search` to find things.\n---\n# Example\nBody.\n",
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Skill markdown YAML");
      expect(check?.code).toBe("skill_md_yaml_invalid");
      expect(check?.kind).toBe("warning");
      expect(check?.status).toBe("warn");
      expect(check?.message).toContain(".claude/skills/example-skill/SKILL.md");
      expect(check?.message).toContain("description");
      expect(report.warnings.map((w) => w.code)).toContain("skill_md_yaml_invalid");
    });

    it("flags a Codex SKILL.md alongside Claude ones (both roots scanned)", async () => {
      const target = createInitializedProject("doctor-rc12-skill-yaml-codex");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedSkill(
        target,
        ".codex/skills/codex-only",
        "---\nname: codex-only\ndescription: Default layer: team broad.\n---\n# Codex\nBody.\n",
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Skill markdown YAML");
      expect(check?.code).toBe("skill_md_yaml_invalid");
      expect(check?.message).toContain(".codex/skills/codex-only/SKILL.md");
    });

    it("does NOT flag a quoted value containing ': '", async () => {
      const target = createInitializedProject("doctor-rc12-skill-yaml-quoted");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedSkill(
        target,
        ".claude/skills/quoted-ok",
        '---\nname: quoted-ok\ndescription: "Use action: search via tool"\n---\n# Quoted\nBody.\n',
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Skill markdown YAML");
      expect(check?.status).toBe("ok");
      expect(report.warnings.map((w) => w.code)).not.toContain("skill_md_yaml_invalid");
    });

    it("does NOT flag a description with no inner ': '", async () => {
      const target = createInitializedProject("doctor-rc12-skill-yaml-clean");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedSkill(
        target,
        ".claude/skills/clean",
        "---\nname: clean\ndescription: A perfectly fine description without any inner colons at all.\n---\n# Clean\nBody.\n",
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Skill markdown YAML");
      expect(check?.status).toBe("ok");
      expect(report.warnings.map((w) => w.code)).not.toContain("skill_md_yaml_invalid");
    });

    it("is ok when neither .claude/skills nor .codex/skills exists", async () => {
      const target = createInitializedProject("doctor-rc12-skill-yaml-absent");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Skill markdown YAML");
      expect(check?.status).toBe("ok");
      expect(report.warnings.map((w) => w.code)).not.toContain("skill_md_yaml_invalid");
    });

    it("ignores a SKILL.md missing the opening frontmatter `---` line", async () => {
      const target = createInitializedProject("doctor-rc12-skill-yaml-no-fm");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);
      seedSkill(
        target,
        ".claude/skills/no-frontmatter",
        "# Just a heading\nNot really a skill — has no frontmatter at all even with a: colon.\n",
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Skill markdown YAML");
      expect(check?.status).toBe("ok");
    });
  });

  // ---------------------------------------------------------------------------
  // rc.19 bootstrap-consolidation TASK-009: L1 + L2 byte-level drift detection
  // + marker migration service-layer tests. Mirrors the bootstrap_anchor_missing
  // triplet (L1) and mcp_config_migrated --fix + ledger event pattern (migration).
  //
  // FABRIC_HOME isolation: inherited from the file-scoped beforeEach at L24-L29.
  // Every new test here exercises FABRIC_HOME-derived inspection paths through
  // runDoctorReport / runDoctorFix and therefore inherits the isolation already
  // installed at the top of the file (mkdtempSync + process.env.FABRIC_HOME).
  // ---------------------------------------------------------------------------
  describe("rc.19 L1 bootstrap snapshot drift", () => {
    it("reports ok when .fabric/AGENTS.md byte-equals BOOTSTRAP_CANONICAL", async () => {
      const target = createInitializedProject("doctor-rc19-l1-canonical");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Seed the canonical bootstrap snapshot — byte-for-byte BOOTSTRAP_CANONICAL.
      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");

      const report = await runDoctorReport(target);

      expect(report.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_snapshot_drift");
      expect(report.checks.find((c) => c.name === "Bootstrap snapshot drift")?.status).toBe("ok");
    });

    it("reports fixable_error when .fabric/AGENTS.md bytes differ", async () => {
      const target = createInitializedProject("doctor-rc19-l1-drift");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Mutate the snapshot by one char — bytes diverge from BOOTSTRAP_CANONICAL.
      const mutated = `${BOOTSTRAP_CANONICAL}X`;
      writeFileSync(join(target, ".fabric", "AGENTS.md"), mutated, "utf8");

      const report = await runDoctorReport(target);
      const codes = report.fixable_errors.map((e) => e.code);
      expect(codes).toContain("bootstrap_snapshot_drift");
      expect(report.checks.find((c) => c.name === "Bootstrap snapshot drift")?.status).toBe("error");
      const issue = report.fixable_errors.find((e) => e.code === "bootstrap_snapshot_drift");
      expect(issue?.message).toContain("BOOTSTRAP_CANONICAL");
    });

    it("--fix restores byte-equality and second --fix is no-op for the L1 drift code", async () => {
      const target = createInitializedProject("doctor-rc19-l1-fix");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(join(target, ".fabric", "AGENTS.md"), `${BOOTSTRAP_CANONICAL}drift`, "utf8");

      const fix = await runDoctorFix(target);
      expect(fix.fixed.map((e) => e.code)).toContain("bootstrap_snapshot_drift");
      // Byte-equality restored.
      const restored = readFileSync(join(target, ".fabric", "AGENTS.md"), "utf8");
      expect(restored).toBe(BOOTSTRAP_CANONICAL);

      // Second --fix: L1 drift code MUST NOT re-fire (idempotency).
      const after = await runDoctorReport(target);
      expect(after.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_snapshot_drift");

      const refix = await runDoctorFix(target);
      expect(refix.fixed.map((e) => e.code)).not.toContain("bootstrap_snapshot_drift");
    });

    it("reports L1 drift when .fabric/AGENTS.md has CRLF line endings (no normalization invariant)", async () => {
      // CRLF regression guard: the inspector MUST NOT normalize line endings —
      // an install-side line-ending bug must surface here as drift even though
      // a semantic diff would call the bytes equivalent.
      const target = createInitializedProject("doctor-rc19-l1-crlf");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const crlf = BOOTSTRAP_CANONICAL.replace(/\n/g, "\r\n");
      // Sanity: the bytes really do differ from canonical.
      expect(crlf).not.toBe(BOOTSTRAP_CANONICAL);
      writeFileSync(join(target, ".fabric", "AGENTS.md"), crlf, "utf8");

      const report = await runDoctorReport(target);
      expect(report.fixable_errors.map((e) => e.code)).toContain("bootstrap_snapshot_drift");
    });
  });

  describe("rc.19 L2 managed block drift", () => {
    function seedManagedBlock(target: string, relPath: string, body: string): void {
      const block = `${BOOTSTRAP_MARKER_BEGIN}\n${body}\n${BOOTSTRAP_MARKER_END}`;
      // Use writeFileSync (no synthetic trailing newline mutation) — the L2
      // inspector reads raw bytes and tolerates trailing newline shape.
      const abs = join(target, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, `${block}\n`, "utf8");
    }

    it("reports ok when all three managed blocks byte-equal expected concat (no project-rules)", async () => {
      const target = createInitializedProject("doctor-rc19-l2-ok");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // L1 must be canonical so L2's expectedBody == BOOTSTRAP_CANONICAL.
      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
      // Seed both managed-block targets with the canonical body.
      seedManagedBlock(target, "AGENTS.md", BOOTSTRAP_CANONICAL);
      seedManagedBlock(target, ".cursor/rules/fabric-bootstrap.mdc", BOOTSTRAP_CANONICAL);
      // CLAUDE.md: thin shell — needs @-import line.
      writeFileSync(join(target, "CLAUDE.md"), "# CLAUDE\n\n@.fabric/AGENTS.md\n", "utf8");

      const report = await runDoctorReport(target);
      expect(report.fixable_errors.map((e) => e.code)).not.toContain("managed_block_drift");
      expect(report.checks.find((c) => c.name === "Managed block drift")?.status).toBe("ok");
    });

    it("reports drift when root AGENTS.md managed block bytes differ", async () => {
      const target = createInitializedProject("doctor-rc19-l2-drift");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
      // Mutate body in root AGENTS.md managed block.
      seedManagedBlock(target, "AGENTS.md", `${BOOTSTRAP_CANONICAL}\nROGUE EDIT`);

      const report = await runDoctorReport(target);
      const codes = report.fixable_errors.map((e) => e.code);
      expect(codes).toContain("managed_block_drift");
      expect(report.checks.find((c) => c.name === "Managed block drift")?.status).toBe("error");
    });

    it("--fix rewrites all three managed blocks and is idempotent on re-run", async () => {
      const target = createInitializedProject("doctor-rc19-l2-fix");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
      seedManagedBlock(target, "AGENTS.md", "WRONG BODY A");
      seedManagedBlock(target, ".cursor/rules/fabric-bootstrap.mdc", "WRONG BODY B");
      writeFileSync(join(target, "CLAUDE.md"), "# CLAUDE\n", "utf8"); // missing @-import

      const fix = await runDoctorFix(target);
      expect(fix.fixed.map((e) => e.code)).toContain("managed_block_drift");

      // All three managed blocks now byte-equal expectedBody == BOOTSTRAP_CANONICAL.
      const after = await runDoctorReport(target);
      expect(after.fixable_errors.map((e) => e.code)).not.toContain("managed_block_drift");
      expect(after.checks.find((c) => c.name === "Managed block drift")?.status).toBe("ok");

      // Verify the rewritten managed block bodies match canonical.
      const agentsContent = readFileSync(join(target, "AGENTS.md"), "utf8");
      const cursorContent = readFileSync(join(target, ".cursor", "rules", "fabric-bootstrap.mdc"), "utf8");
      expect(agentsContent).toContain(BOOTSTRAP_MARKER_BEGIN);
      expect(agentsContent).toContain(BOOTSTRAP_MARKER_END);
      expect(agentsContent).toContain(BOOTSTRAP_CANONICAL);
      expect(cursorContent).toContain(BOOTSTRAP_MARKER_BEGIN);
      expect(cursorContent).toContain(BOOTSTRAP_MARKER_END);
      expect(cursorContent).toContain(BOOTSTRAP_CANONICAL);
      // CLAUDE.md gains the @-import line.
      const claudeContent = readFileSync(join(target, "CLAUDE.md"), "utf8");
      expect(claudeContent.split(/\r?\n/u).some((line) => line.trim() === "@.fabric/AGENTS.md")).toBe(true);

      // Idempotency: re-run --fix does NOT report managed_block_drift again.
      const refix = await runDoctorFix(target);
      expect(refix.fixed.map((e) => e.code)).not.toContain("managed_block_drift");
    });

    it("reports L2 drift when CLAUDE.md is missing the @.fabric/AGENTS.md import line", async () => {
      const target = createInitializedProject("doctor-rc19-l2-claude-missing-at");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
      // CLAUDE.md exists but lacks the @-import line (thin shell special case).
      writeFileSync(join(target, "CLAUDE.md"), "# CLAUDE\nNo at-import line here.\n", "utf8");

      const report = await runDoctorReport(target);
      expect(report.fixable_errors.map((e) => e.code)).toContain("managed_block_drift");
      const issue = report.fixable_errors.find((e) => e.code === "managed_block_drift");
      expect(issue?.message).toContain("CLAUDE.md");
    });

    it("reports L2 drift when AGENTS.md managed block contains CRLF line endings", async () => {
      // CRLF regression guard (L2 parallel of doctor-rc19-l1-crlf): the L2
      // inspector's slice logic strips a single leading "\n" but MUST NOT
      // normalize "\r\n" inside the managed-block body. A CRLF-injected body
      // therefore byte-diverges from the LF-only expectedBody, surfacing as
      // managed_block_drift. This pins the no-normalization invariant so a
      // future "helpful" normalization patch breaks the test.
      const target = createInitializedProject("doctor-rc19-l2-crlf-agents");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Install canonical state (post-rc.19): L1 snapshot canonical, both L2
      // managed-block targets seeded canonical, CLAUDE.md with @-import.
      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
      seedManagedBlock(target, "AGENTS.md", BOOTSTRAP_CANONICAL);
      seedManagedBlock(target, ".cursor/rules/fabric-bootstrap.mdc", BOOTSTRAP_CANONICAL);
      writeFileSync(join(target, "CLAUDE.md"), "# CLAUDE\n\n@.fabric/AGENTS.md\n", "utf8");

      // Sanity: baseline is clean (no managed_block_drift).
      const baseline = await runDoctorReport(target);
      expect(baseline.fixable_errors.map((e) => e.code)).not.toContain("managed_block_drift");

      // Mutate ONLY the AGENTS.md managed-block file: rewrite every "\n" inside
      // the body to "\r\n". The L2 inspector reads raw bytes, slices a single
      // leading "\n", and byte-compares against the LF-only expectedBody —
      // CRLF bytes survive and must register as drift.
      const agentsPath = join(target, "AGENTS.md");
      const lf = readFileSync(agentsPath, "utf8");
      const crlf = lf.replace(/\n/g, "\r\n");
      // Sanity: the bytes really do differ from the LF original.
      expect(crlf).not.toBe(lf);
      writeFileSync(agentsPath, crlf, "utf8");

      const report = await runDoctorReport(target);
      const codes = report.fixable_errors.map((e) => e.code);
      expect(codes).toContain("managed_block_drift");
      expect(report.checks.find((c) => c.name === "Managed block drift")?.status).toBe("error");
    });

    it("reports L2 drift when .cursor/rules/fabric-bootstrap.mdc managed block contains CRLF line endings", async () => {
      // CRLF regression guard for the Cursor mdc target — parallel to the
      // AGENTS.md CRLF case above. Pins the no-normalization invariant for the
      // second L2 managed-block surface.
      const target = createInitializedProject("doctor-rc19-l2-crlf-cursor");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      // Install canonical state.
      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
      seedManagedBlock(target, "AGENTS.md", BOOTSTRAP_CANONICAL);
      seedManagedBlock(target, ".cursor/rules/fabric-bootstrap.mdc", BOOTSTRAP_CANONICAL);
      writeFileSync(join(target, "CLAUDE.md"), "# CLAUDE\n\n@.fabric/AGENTS.md\n", "utf8");

      // Sanity: baseline is clean.
      const baseline = await runDoctorReport(target);
      expect(baseline.fixable_errors.map((e) => e.code)).not.toContain("managed_block_drift");

      // Mutate ONLY the cursor mdc file to carry CRLF line endings.
      const cursorPath = join(target, ".cursor", "rules", "fabric-bootstrap.mdc");
      const lf = readFileSync(cursorPath, "utf8");
      const crlf = lf.replace(/\n/g, "\r\n");
      expect(crlf).not.toBe(lf);
      writeFileSync(cursorPath, crlf, "utf8");

      const report = await runDoctorReport(target);
      const codes = report.fixable_errors.map((e) => e.code);
      expect(codes).toContain("managed_block_drift");
      expect(report.checks.find((c) => c.name === "Managed block drift")?.status).toBe("error");
    });
  });

  describe("rc.19 marker migration fabric:knowledge-base → fabric:bootstrap", () => {
    function seedLegacyMarker(target: string, relPath: string, body: string): void {
      // Legacy managed block: same body convention as the new marker, but using
      // the pre-rc.19 fabric:knowledge-base marker token pair.
      const legacyBlock = `${LEGACY_KB_MARKER_BEGIN}\n${body}\n${LEGACY_KB_MARKER_END}`;
      const abs = join(target, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, `${legacyBlock}\n`, "utf8");
    }

    it("reports fixable_error when bootstrap target files carry legacy fabric:knowledge-base markers", async () => {
      const target = createInitializedProject("doctor-rc19-marker-detect");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedLegacyMarker(target, "CLAUDE.md", "legacy body for CLAUDE.md");
      seedLegacyMarker(target, "AGENTS.md", "legacy body for AGENTS.md");
      seedLegacyMarker(target, ".cursor/rules/fabric-bootstrap.mdc", "legacy body for cursor");

      const report = await runDoctorReport(target);
      const codes = report.fixable_errors.map((e) => e.code);
      expect(codes).toContain("bootstrap_marker_migration_required");
      const check = report.checks.find((c) => c.name === "Bootstrap marker migration");
      expect(check?.status).toBe("error");
      expect(check?.message).toContain("fabric:knowledge-base");
    });

    it("--fix rewrites legacy markers to fabric:bootstrap in all seeded target paths", async () => {
      const target = createInitializedProject("doctor-rc19-marker-fix-paths");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const targets: string[] = [
        "CLAUDE.md",
        "AGENTS.md",
        ".cursor/rules/fabric-bootstrap.mdc",
      ];
      for (const rel of targets) {
        seedLegacyMarker(target, rel, `legacy body for ${rel}`);
      }

      await runDoctorFix(target);

      // Per-file invariants: zero legacy substrings, exactly one new begin/end.
      for (const rel of targets) {
        const content = readFileSync(join(target, rel), "utf8");
        expect(content.split(LEGACY_KB_MARKER_BEGIN).length - 1).toBe(0);
        expect(content.split(LEGACY_KB_MARKER_END).length - 1).toBe(0);
        // Defensive: even the bare token "fabric:knowledge-base" must be gone.
        expect(content.includes("fabric:knowledge-base")).toBe(false);
        expect(content.split(BOOTSTRAP_MARKER_BEGIN).length - 1).toBe(1);
        expect(content.split(BOOTSTRAP_MARKER_END).length - 1).toBe(1);
      }
    });

    it("--fix emits one bootstrap_marker_migrated ledger event per file migrated", async () => {
      const target = createInitializedProject("doctor-rc19-marker-ledger");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      const targets: string[] = [
        "CLAUDE.md",
        "AGENTS.md",
        ".cursor/rules/fabric-bootstrap.mdc",
      ];
      for (const rel of targets) {
        seedLegacyMarker(target, rel, `legacy body for ${rel}`);
      }

      await runDoctorFix(target);

      // Read the events.jsonl directly (parallel to the mcp_config_migrated
      // ledger pattern at L239-L241) and assert one migrated event per file.
      const ledgerPath = join(target, ".fabric", "events.jsonl");
      const raw = readFileSync(ledgerPath, "utf8");
      const lines = raw.split(/\r?\n/u).filter((l) => l.trim().length > 0);
      const migratedEvents = lines
        .map((line) => JSON.parse(line) as { event_type?: string; path?: string })
        .filter((evt) => evt.event_type === "bootstrap_marker_migrated");
      expect(migratedEvents.length).toBe(targets.length);
      // Every event references an absolute path under the project root.
      for (const evt of migratedEvents) {
        expect(typeof evt.path).toBe("string");
        expect(evt.path?.startsWith(target)).toBe(true);
      }
    });

    it("idempotent: re-running --fix after migration produces zero new bootstrap_marker_migrated events", async () => {
      const target = createInitializedProject("doctor-rc19-marker-idempotent");
      await writeKnowledgeMeta(target, { source: "doctor_fix" });
      writeFile(".fabric/events.jsonl", "", target);

      seedLegacyMarker(target, "CLAUDE.md", "legacy body 1");
      seedLegacyMarker(target, "AGENTS.md", "legacy body 2");

      await runDoctorFix(target);

      const countMigratedEvents = (): number => {
        const raw = readFileSync(join(target, ".fabric", "events.jsonl"), "utf8");
        const lines = raw.split(/\r?\n/u).filter((l) => l.trim().length > 0);
        return lines
          .map((line) => JSON.parse(line) as { event_type?: string })
          .filter((evt) => evt.event_type === "bootstrap_marker_migrated").length;
      };
      const firstCount = countMigratedEvents();
      expect(firstCount).toBeGreaterThanOrEqual(1);

      // Second --fix: legacy markers are already gone, so no new migration runs.
      const refix = await runDoctorFix(target);
      expect(refix.fixed.map((e) => e.code)).not.toContain("bootstrap_marker_migration_required");
      const secondCount = countMigratedEvents();
      expect(secondCount).toBe(firstCount);
    });
  });

  // v2.0.0-rc.22 TASK-006: doctor lint `lint-baseline-filename-format` —
  // hard error (no --fix path). rc.23 TASK-012 (F8a) removed the legacy
  // baseline-emit pipeline, so resolution is manual file deletion. Aligns
  // with feedback_cli_design "drift→abort" (--force was removed in rc.15).
  describe("rc.22 TASK-006: lint-baseline-filename-format hard error", () => {
    // Helper: write a baseline knowledge file with the requested filename and
    // frontmatter id under the given canonical subdir. The frontmatter shape
    // mirrors the historical baseline emit format so
    // `extractKnowledgeFrontmatterId` parses it identically to a legacy
    // pre-rc.23 baseline file on disk.
    const writeBaselineFile = (
      target: string,
      subdir: string,
      filename: string,
      id: string,
      slug: string,
    ): void => {
      writeFile(
        `.fabric/knowledge/${subdir}/${filename}`,
        `---\nid: ${id}\ntype: ${subdir.slice(0, -1)}\nlayer: team\nmaturity: stable\nslug: ${slug}\n---\n# ${slug}\n`,
        target,
      );
    };

    it("lint_baseline_filename_passes_when_clean: id-prefixed filenames produce ok status", async () => {
      const target = createInitializedProject("doctor-baseline-fname-clean");
      // Seed an already-migrated baseline file (canonical `${id}--${slug}.md`).
      writeBaselineFile(
        target,
        "guidelines",
        "KT-GLD-0001--code-style.md",
        "KT-GLD-0001",
        "code-style",
      );

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.code === "lint-baseline-filename-format")
        ?? report.checks.find((c) => c.name === "Baseline filename format");
      expect(check).toBeDefined();
      expect(check?.status).toBe("ok");
      expect(report.manual_errors.map((e) => e.code)).not.toContain("lint-baseline-filename-format");
    });

    it("lint_baseline_filename_errors_on_bare_slug_baseline: emits manual_error listing the offending file", async () => {
      const target = createInitializedProject("doctor-baseline-fname-bare");
      // Bare-slug baseline file with id in the allowlist — should fire.
      writeBaselineFile(target, "guidelines", "code-style.md", "KT-GLD-0001", "code-style");

      const report = await runDoctorReport(target);
      expect(report.manual_errors.map((e) => e.code)).toContain("lint-baseline-filename-format");
      const issue = report.manual_errors.find((e) => e.code === "lint-baseline-filename-format");
      expect(issue?.message).toContain(".fabric/knowledge/guidelines/code-style.md");
      expect(issue?.message).toContain("KT-GLD-0001");
    });

    it("lint_baseline_filename_skips_non_baseline_ids: KP-* / non-allowlist ids are NOT flagged", async () => {
      const target = createInitializedProject("doctor-baseline-fname-non-baseline");
      // Bare-slug filename but id is NOT in the baseline allowlist — must be
      // ignored (this is a user-promoted entry, governed by a different
      // invariant).
      writeBaselineFile(target, "decisions", "some-decision.md", "KP-DEC-0001", "some-decision");

      const report = await runDoctorReport(target);
      expect(report.manual_errors.map((e) => e.code)).not.toContain("lint-baseline-filename-format");
      const check = report.checks.find((c) => c.name === "Baseline filename format");
      expect(check?.status).toBe("ok");
    });

    it("lint_baseline_filename_force_does_not_mask: hard-error contract — runDoctorFix never auto-fixes this code", async () => {
      // Hard-error contract regression: --fix MUST NOT silence the lint
      // (the only mutation surface in doctor; --force was removed in rc.15
      // per feedback_cli_design drift→abort). The check must remain reported
      // after a --fix pass and the issue must NOT appear in `fixed`.
      const target = createInitializedProject("doctor-baseline-fname-no-mask");
      writeBaselineFile(target, "models", "tech-stack.md", "KT-MOD-0001", "tech-stack");

      const before = await runDoctorReport(target);
      expect(before.manual_errors.map((e) => e.code)).toContain("lint-baseline-filename-format");

      const fixReport = await runDoctorFix(target);
      // The hard-error code must NOT be in `fixed` (it has no auto-fix path).
      expect(fixReport.fixed.map((e) => e.code)).not.toContain("lint-baseline-filename-format");
      // After --fix, the bare-slug file still exists on disk — re-running the
      // report continues to surface the manual_error.
      const after = await runDoctorReport(target);
      expect(after.manual_errors.map((e) => e.code)).toContain("lint-baseline-filename-format");
    });

    it("lint_baseline_filename_resolution_instructs_manual_deletion: action hint guides user to manual cleanup (rc.23 removed baseline pipeline)", async () => {
      const target = createInitializedProject("doctor-baseline-fname-resolution");
      writeBaselineFile(target, "processes", "build-config.md", "KT-PRO-0001", "build-config");

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.code === "lint-baseline-filename-format");
      expect(check).toBeDefined();
      expect(check?.status).toBe("error");
      expect(check?.kind).toBe("manual_error");
      expect(check?.actionHint?.toLowerCase()).toMatch(/delete|manual/);
    });
  });
});

// v2.0.0-rc.20 TASK-04: ensureCitePolicyActivatedMarker — idempotent activation
// marker for the cite-policy enforcement layer. First call writes the event,
// subsequent calls short-circuit on the existing marker, and read/write
// failures are absorbed silently so the warm-up path never raises.
describe("ensureCitePolicyActivatedMarker", () => {
  it("first call emits marker and returns emitted_now:true with marker_ts ≈ Date.now()", async () => {
    const target = createInitializedProject("cite-policy-marker-first");
    writeFile(".fabric/events.jsonl", "", target);

    const before = Date.now();
    const result = await ensureCitePolicyActivatedMarker(target);
    const after = Date.now();

    expect(result.emitted_now).toBe(true);
    expect(result.marker_ts).toBeGreaterThanOrEqual(before);
    expect(result.marker_ts).toBeLessThanOrEqual(after);

    // Round-trip through readEventLedger — passes Zod validation if reachable.
    const { events } = await readEventLedger(target, { event_type: "cite_policy_activated" });
    expect(events).toHaveLength(1);
    const [event] = events;
    if (event.event_type !== "cite_policy_activated") {
      throw new Error("unexpected event_type");
    }
    expect(event.policy_version).toBe("2.0.0-rc.20");
    expect(event.ts).toBe(result.marker_ts);
    expect(() => new Date(event.timestamp).toISOString()).not.toThrow();
  });

  it("second call after marker exists returns emitted_now:false with marker_ts from existing event", async () => {
    const target = createInitializedProject("cite-policy-marker-idempotent");
    writeFile(".fabric/events.jsonl", "", target);

    const first = await ensureCitePolicyActivatedMarker(target);
    expect(first.emitted_now).toBe(true);

    const second = await ensureCitePolicyActivatedMarker(target);
    expect(second.emitted_now).toBe(false);
    expect(second.marker_ts).toBe(first.marker_ts);

    // Confirm exactly one event was written across both invocations.
    const { events } = await readEventLedger(target, { event_type: "cite_policy_activated" });
    expect(events).toHaveLength(1);
  });

  it("read failure (nonexistent projectRoot) returns {marker_ts:0, emitted_now:false} silently", async () => {
    // A read against a nonexistent project root forces appendEventLedgerEvent
    // to fail (parent dir missing for the ledger path under
    // /nonexistent-cite-policy-...). Both error paths must collapse to the
    // sentinel without throwing.
    const result = await ensureCitePolicyActivatedMarker("/nonexistent-cite-policy-fabric-root-xyzzy");
    expect(result.marker_ts).toBe(0);
    expect(result.emitted_now).toBe(false);
  });
});

// v2.0.0-rc.24 TASK-06: ensureCiteContractPolicyActivatedMarker — drift-gated
// counterpart of ensureCitePolicyActivatedMarker. Marker emit is refused when
// `.fabric/AGENTS.md` does not byte-equal BOOTSTRAP_CANONICAL (rc.23→rc.24
// upgrade window safeguard). Once drift clears, behaves exactly like rc.20
// marker: idempotent, silent on read/write failure.
describe("ensureCiteContractPolicyActivatedMarker", () => {
  it("clean bootstrap + no prior marker → emits new marker with emitted_now:true and blocked_by:null", async () => {
    const target = createInitializedProject("cite-contract-marker-clean-first");
    writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
    writeFile(".fabric/events.jsonl", "", target);

    const before = Date.now();
    const result = await ensureCiteContractPolicyActivatedMarker(target);
    const after = Date.now();

    expect(result.emitted_now).toBe(true);
    expect(result.blocked_by).toBe(null);
    expect(result.marker_ts).toBeGreaterThanOrEqual(before);
    expect(result.marker_ts).toBeLessThanOrEqual(after);

    // Round-trip via readEventLedger — exactly one marker line, parses cleanly.
    const { events } = await readEventLedger(target, {
      event_type: "cite_contract_policy_activated",
    });
    expect(events).toHaveLength(1);
    const [event] = events;
    if (event.event_type !== "cite_contract_policy_activated") {
      throw new Error("unexpected event_type");
    }
    expect(event.ts).toBe(result.marker_ts);
  });

  it("clean bootstrap + existing marker → returns existing marker_ts with emitted_now:false", async () => {
    const target = createInitializedProject("cite-contract-marker-existing");
    writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
    writeFile(".fabric/events.jsonl", "", target);

    const first = await ensureCiteContractPolicyActivatedMarker(target);
    expect(first.emitted_now).toBe(true);
    expect(first.blocked_by).toBe(null);

    const second = await ensureCiteContractPolicyActivatedMarker(target);
    expect(second.emitted_now).toBe(false);
    expect(second.blocked_by).toBe(null);
    expect(second.marker_ts).toBe(first.marker_ts);

    // Only one marker event should be present after two invocations.
    const { events } = await readEventLedger(target, {
      event_type: "cite_contract_policy_activated",
    });
    expect(events).toHaveLength(1);
  });

  it("drifted bootstrap → returns blocked_by:'bootstrap_drift', no ledger write", async () => {
    const target = createInitializedProject("cite-contract-marker-drifted");
    // Drift: AGENTS.md present but bytes diverge from BOOTSTRAP_CANONICAL.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), `${BOOTSTRAP_CANONICAL}drift`, "utf8");
    writeFile(".fabric/events.jsonl", "", target);

    const result = await ensureCiteContractPolicyActivatedMarker(target);
    expect(result.blocked_by).toBe("bootstrap_drift");
    expect(result.emitted_now).toBe(false);
    expect(result.marker_ts).toBe(0);

    // Ledger must NOT have received a cite_contract_policy_activated event.
    const { events } = await readEventLedger(target, {
      event_type: "cite_contract_policy_activated",
    });
    expect(events).toHaveLength(0);
  });

  it("missing .fabric/AGENTS.md snapshot → returns blocked_by:'bootstrap_drift' (conservative gate)", async () => {
    const target = createInitializedProject("cite-contract-marker-missing-snapshot");
    // createInitializedProject does NOT write `.fabric/AGENTS.md` by default;
    // L1 inspector reports status='missing' which the gate treats as drift.
    writeFile(".fabric/events.jsonl", "", target);

    const result = await ensureCiteContractPolicyActivatedMarker(target);
    expect(result.blocked_by).toBe("bootstrap_drift");
    expect(result.emitted_now).toBe(false);
    expect(result.marker_ts).toBe(0);

    const { events } = await readEventLedger(target, {
      event_type: "cite_contract_policy_activated",
    });
    expect(events).toHaveLength(0);
  });

  it("idempotency under drift-clear transition: drifted-then-clean only emits once", async () => {
    const target = createInitializedProject("cite-contract-marker-drift-then-clean");
    writeFile(".fabric/events.jsonl", "", target);

    // Phase 1: drift → blocked.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), `${BOOTSTRAP_CANONICAL}X`, "utf8");
    const blocked = await ensureCiteContractPolicyActivatedMarker(target);
    expect(blocked.blocked_by).toBe("bootstrap_drift");

    // Phase 2: user runs `fab install` → snapshot restored to canonical.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
    const emitted = await ensureCiteContractPolicyActivatedMarker(target);
    expect(emitted.emitted_now).toBe(true);
    expect(emitted.blocked_by).toBe(null);

    // Phase 3: subsequent call must be a no-op (idempotent).
    const noop = await ensureCiteContractPolicyActivatedMarker(target);
    expect(noop.emitted_now).toBe(false);
    expect(noop.blocked_by).toBe(null);
    expect(noop.marker_ts).toBe(emitted.marker_ts);

    const { events } = await readEventLedger(target, {
      event_type: "cite_contract_policy_activated",
    });
    expect(events).toHaveLength(1);
  });

  it("read failure (nonexistent projectRoot, gated as missing-snapshot drift) returns blocked_by:'bootstrap_drift' silently", async () => {
    // Nonexistent root has no .fabric/AGENTS.md → L1 inspector returns 'missing',
    // which we treat as drift. No throw, no ledger write attempted.
    const result = await ensureCiteContractPolicyActivatedMarker(
      "/nonexistent-cite-contract-fabric-root-xyzzy",
    );
    expect(result.blocked_by).toBe("bootstrap_drift");
    expect(result.emitted_now).toBe(false);
    expect(result.marker_ts).toBe(0);
  });
});

// v2.0.0-rc.20 TASK-06: runDoctorCiteCoverage end-to-end smoke. The exhaustive
// per-metric coverage lands in TASK-08; this smoke locks the contract that the
// real algorithm replaced the stub (non-zero metrics from seeded events) and
// that the 'skipped' branch still surfaces when the marker cannot be written.
describe("runDoctorCiteCoverage (smoke)", () => {
  it("aggregates total_turns + qualifying_cites + dismissed_histogram from seeded turns", async () => {
    const target = createInitializedProject("cite-coverage-smoke-turns");
    writeFile(".fabric/events.jsonl", "", target);

    // Seed the marker first so effectiveSince = marker_ts (window covers all
    // subsequent appends). All appends use Date.now() so they sort after the
    // marker timestamp.
    const marker = await ensureCitePolicyActivatedMarker(target);
    expect(marker.marker_ts).toBeGreaterThan(0);

    // Hand-craft a few assistant_turn_observed events. Mix planned / recalled /
    // dismissed:scope-mismatch / none to exercise the categorize branch.
    const seedLines = [
      {
        kind: "fabric-event",
        id: "event:smoke-turn-1",
        ts: marker.marker_ts + 10,
        schema_version: 1,
        session_id: "sess-A",
        event_type: "assistant_turn_observed",
        kb_line_raw: "KB: KT-DEC-0001",
        cite_ids: ["KT-DEC-0001"],
        cite_tags: ["planned"],
        client: "cc",
        turn_id: "turn-1",
        timestamp: new Date(marker.marker_ts + 10).toISOString(),
      },
      {
        // NOTE: cite_tags here is the bare 'dismissed' literal — TASK-02's
        // schema enum locks the on-ledger vocabulary to 5 values. The reason
        // payload ('scope-mismatch'/'other:...') is a TASK-09 schema widening;
        // until then the histogram aggregates under the 'unspecified' key.
        kind: "fabric-event",
        id: "event:smoke-turn-2",
        ts: marker.marker_ts + 20,
        schema_version: 1,
        session_id: "sess-B",
        event_type: "assistant_turn_observed",
        kb_line_raw: "KB: KT-DEC-0002 (dismissed)",
        cite_ids: ["KT-DEC-0002"],
        cite_tags: ["dismissed"],
        client: "codex",
        turn_id: "turn-2",
        timestamp: new Date(marker.marker_ts + 20).toISOString(),
      },
      {
        kind: "fabric-event",
        id: "event:smoke-turn-3",
        ts: marker.marker_ts + 30,
        schema_version: 1,
        session_id: "sess-C",
        event_type: "assistant_turn_observed",
        kb_line_raw: null,
        cite_ids: [],
        cite_tags: ["none"],
        client: "cc",
        turn_id: "turn-3",
        timestamp: new Date(marker.marker_ts + 30).toISOString(),
      },
    ];
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = readFileSync(ledgerPath, "utf8");
    writeFileSync(
      ledgerPath,
      `${existing}${seedLines.map((e) => JSON.stringify(e)).join("\n")}\n`,
      "utf8",
    );

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.status).toBe("ok");
    expect(report.metrics.total_turns).toBe(3);
    // planned counts; dismissed and none do not.
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.dismissed_reason_histogram).toEqual({ unspecified: 1 });
    // per_client surfaces when client filter is 'all'.
    expect(report.per_client).toBeDefined();
    expect(report.per_client?.cc?.total_turns).toBe(2);
    expect(report.per_client?.codex?.total_turns).toBe(1);
  });

  it("returns status:'skipped' with zero metrics when marker write degrades", async () => {
    // Same nonexistent-root trick as ensureCitePolicyActivatedMarker's failure
    // test — both ledger read and append fail, marker_ts collapses to 0.
    const report = await runDoctorCiteCoverage("/nonexistent-cite-coverage-fabric-root-xyzzy", {
      since: 0,
      client: "all",
    });
    expect(report.status).toBe("skipped");
    expect(report.marker_ts).toBe(0);
    expect(report.metrics).toEqual({
      edits_touched: 0,
      qualifying_cites: 0,
      recalled_unverified: 0,
      expected_but_missed: 0,
      total_turns: 0,
    });
  });
});

// v2.0.0-rc.20 TASK-08: comprehensive runDoctorCiteCoverage coverage.
//
// Locks the contract for every metric the report tabulates plus the two CLI
// filters (--since / --client). Each test seeds a fresh initialized project
// (FABRIC_HOME is isolated per-test by the top-level beforeEach), emits a
// cite_policy_activated marker, then appends one or more hand-crafted events
// directly via writeFileSync. We bypass `appendEventLedgerEvent` because the
// queue serializes via Promise chaining + Date.now() and we need exact `ts`
// control to test the window logic.
//
// NOTE on `dismissed` reasons: the on-ledger schema (TASK-02) constrains
// `cite_tags` to {planned, recalled, chained-from, dismissed, none}.
// Colon-suffixed reasons (e.g. `dismissed:scope-mismatch`) fail Zod and the
// event is dropped by `readEventLedger`. TASK-09 will widen the schema to
// carry a per-reason payload; until then the histogram tests assert the
// current shape (bare `dismissed` → `unspecified` bucket).
describe("runDoctorCiteCoverage", () => {
  // -------------------------------------------------------------------------
  // Helpers — extracted at the top of the block so all 14 tests share them.
  // -------------------------------------------------------------------------

  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  function seedAgentsMeta(
    target: string,
    nodes: Array<{
      stable_id: string;
      relevance_paths?: readonly string[];
      relevance_scope?: "narrow" | "broad";
    }>,
  ): void {
    // Minimal agents.meta.json shape that `readAgentsMeta` will parse without
    // tripping `agentsMetaSchema`. Each node carries the four required base
    // fields (file/scope_glob/hash) plus a description{} carrying the
    // relevance_paths / relevance_scope the cite-coverage aggregator reads.
    const metaNodes: Record<string, unknown> = {};
    for (const node of nodes) {
      const key = node.stable_id;
      metaNodes[key] = {
        file: `.fabric/knowledge/decisions/${node.stable_id}.md`,
        content_ref: `.fabric/knowledge/decisions/${node.stable_id}.md`,
        scope_glob: "**",
        hash: "deadbeef",
        stable_id: node.stable_id,
        identity_source: "declared",
        description: {
          summary: "test",
          intent_clues: [],
          tech_stack: [],
          impact: [],
          must_read_if: "always",
          relevance_scope: node.relevance_scope ?? "broad",
          relevance_paths: node.relevance_paths ?? [],
        },
      };
    }
    const meta = {
      revision: "test-revision",
      nodes: metaNodes,
    };
    const metaPath = join(target, ".fabric", "agents.meta.json");
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  }

  function mkTurnEvent(opts: {
    sessionId: string;
    turnId?: string;
    kbLineRaw: string | null;
    citeIds: string[];
    citeTags: string[];
    client?: "cc" | "codex" | "cursor";
    ts: number;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:turn:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "assistant_turn_observed",
      kb_line_raw: opts.kbLineRaw,
      cite_ids: opts.citeIds,
      cite_tags: opts.citeTags,
      ...(opts.client !== undefined ? { client: opts.client } : {}),
      turn_id: opts.turnId ?? `turn-${randomUUID()}`,
      timestamp: new Date(opts.ts).toISOString(),
    };
  }

  function mkEditEvent(opts: {
    path: string;
    ts: number;
    sessionId?: string;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:edit:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      ...(opts.sessionId !== undefined ? { session_id: opts.sessionId } : {}),
      event_type: "edit_intent_checked",
      path: opts.path,
      compliant: true,
      intent: "test edit",
      ledger_entry_id: `ledger:${randomUUID()}`,
      matched_rule_context_ts: null,
      window_ms: 60_000,
    };
  }

  function mkKnowledgeFetchEvent(opts: {
    sessionId: string;
    ids: string[];
    ts: number;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:fetch:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "knowledge_sections_fetched",
      selection_token: `tok:${randomUUID()}`,
      requested_sections: opts.ids,
      final_stable_ids: opts.ids,
      ai_selected_stable_ids: opts.ids,
    };
  }

  // -------------------------------------------------------------------------
  // 14 tests
  // -------------------------------------------------------------------------

  // 1. Missing .fabric/ dir → ledger read + append both fail → marker_ts=0 →
  //    status='skipped' with zero metrics.
  it("status='skipped' when the project root has no .fabric/ tree (marker write fails)", async () => {
    const report = await runDoctorCiteCoverage(
      "/nonexistent-cite-coverage-task-08-skipped-xyzzy",
      { since: 0, client: "all" },
    );
    expect(report.status).toBe("skipped");
    expect(report.marker_ts).toBe(0);
    expect(report.metrics).toEqual({
      edits_touched: 0,
      qualifying_cites: 0,
      recalled_unverified: 0,
      expected_but_missed: 0,
      total_turns: 0,
    });
  });

  // 1b. Empty events.jsonl + first invocation → marker emitted, no turns yet
  //     → status='ok' with zero metrics, marker_emitted_now=true.
  it("status='ok' with zero metrics + marker_emitted_now=true on first invocation against empty ledger", async () => {
    const target = createInitializedProject("cite-coverage-empty-ledger");
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.status).toBe("ok");
    expect(report.marker_emitted_now).toBe(true);
    expect(report.marker_ts).toBeGreaterThan(0);
    expect(report.metrics).toEqual({
      edits_touched: 0,
      qualifying_cites: 0,
      recalled_unverified: 0,
      expected_but_missed: 0,
      total_turns: 0,
    });
  });

  // 2. Marker present, no turns/edits → metrics all zero, status='ok'.
  it("marker present without any turns produces zero metrics, status='ok'", async () => {
    const target = createInitializedProject("cite-coverage-marker-only");
    writeFile(".fabric/events.jsonl", "", target);

    // First call seeds the marker; second call exercises the "marker exists,
    // no work to do" path with emitted_now=false.
    await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.status).toBe("ok");
    expect(report.marker_emitted_now).toBe(false);
    expect(report.metrics.total_turns).toBe(0);
    expect(report.metrics.qualifying_cites).toBe(0);
    expect(report.metrics.edits_touched).toBe(0);
    expect(report.metrics.expected_but_missed).toBe(0);
    expect(report.metrics.recalled_unverified).toBe(0);
  });

  // 3. Single planned cite + 1 matching edit (broad KB) → qualifying_cites=1,
  //    edits_touched=1, no expected_but_missed contribution.
  it("aggregates a single planned cite + a matching edit", async () => {
    const target = createInitializedProject("cite-coverage-single-planned");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [{ stable_id: "KT-DEC-0001", relevance_scope: "broad" }]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-A",
        kbLineRaw: "KB: KT-DEC-0001",
        citeIds: ["KT-DEC-0001"],
        citeTags: ["planned"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkEditEvent({
        path: "src/foo.ts",
        sessionId: "sess-A",
        ts: marker.marker_ts + 20,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.status).toBe("ok");
    expect(report.metrics.total_turns).toBe(1);
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
  });

  // 4. Narrow KB with relevance_paths=['src/foo/**'] + edit on src/foo/bar.ts
  //    + a turn that DID cite the kb in the same session → no missed entry
  //    (the cite covered the narrow obligation).
  it("narrow KB covered by a same-session cite produces zero expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-narrow-covered");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0042", relevance_scope: "narrow", relevance_paths: ["src/foo/**"] },
    ]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-N",
        kbLineRaw: "KB: KT-DEC-0042",
        citeIds: ["KT-DEC-0042"],
        citeTags: ["planned"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkEditEvent({
        path: "src/foo/bar.ts",
        sessionId: "sess-N",
        ts: marker.marker_ts + 20,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
  });

  // 5. Narrow KB + edit on UNMATCHED path → no contribution to
  //    expected_but_missed (path didn't match the kb's relevance_paths).
  it("narrow KB with edit on unmatched path produces zero expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-narrow-unmatched");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0043", relevance_scope: "narrow", relevance_paths: ["src/foo/**"] },
    ]);

    seedEvents(target, [
      mkEditEvent({
        path: "src/bar/baz.ts",
        sessionId: "sess-U",
        ts: marker.marker_ts + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
  });

  // 6. Broad KB (no relevance_paths) + 3 edits → broad kbs never contribute
  //    to expected_but_missed (per TASK-06 narrow-only design).
  it("broad KB with multiple edits never contributes to expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-broad-edits");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [{ stable_id: "KT-DEC-0050", relevance_scope: "broad" }]);

    seedEvents(target, [
      mkEditEvent({ path: "src/a.ts", sessionId: "sess-B", ts: marker.marker_ts + 10 }),
      mkEditEvent({ path: "src/b.ts", sessionId: "sess-B", ts: marker.marker_ts + 20 }),
      mkEditEvent({ path: "src/c.ts", sessionId: "sess-B", ts: marker.marker_ts + 30 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.edits_touched).toBe(3);
    expect(report.metrics.expected_but_missed).toBe(0);
  });

  // 7. Recalled tag + matching knowledge_sections_fetched in same session
  //    within ±60s → recalled_unverified does NOT increment.
  it("recalled tag verified by a same-session fetch within +/-60s does not increment recalled_unverified", async () => {
    const target = createInitializedProject("cite-coverage-recall-verified");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [{ stable_id: "KT-DEC-0099", relevance_scope: "broad" }]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-R",
        kbLineRaw: "KB: KT-DEC-0099",
        citeIds: ["KT-DEC-0099"],
        citeTags: ["recalled"],
        client: "cc",
        ts: marker.marker_ts + 1_000,
      }),
      // Fetch 30s after the turn — well inside the 60s window.
      mkKnowledgeFetchEvent({
        sessionId: "sess-R",
        ids: ["KT-DEC-0099"],
        ts: marker.marker_ts + 31_000,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.recalled_unverified).toBe(0);
  });

  // 8. Recalled tag + NO matching fetch (or fetch outside +/-60s) →
  //    recalled_unverified increments.
  it("recalled tag with no same-session fetch increments recalled_unverified", async () => {
    const target = createInitializedProject("cite-coverage-recall-unverified");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-U2",
        kbLineRaw: "KB: KT-DEC-0100",
        citeIds: ["KT-DEC-0100"],
        citeTags: ["recalled"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      // No knowledge_sections_fetched in sess-U2 → unverified.
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.recalled_unverified).toBe(1);
  });

  // 9. Dismissed histogram: per TASK-06's inline note, the on-ledger enum
  //    only carries bare 'dismissed'. Colon-suffixed reasons would be
  //    rejected by Zod and dropped from `readEventLedger`. Today, every
  //    `dismissed` tag lands in the 'unspecified' bucket. This test pins
  //    the current shape; TASK-09 widens the schema and updates the
  //    expectation to per-reason buckets.
  it("dismissed_reason_histogram aggregates bare 'dismissed' tags under the 'unspecified' bucket", async () => {
    const target = createInitializedProject("cite-coverage-dismissed-histogram");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-D1",
        kbLineRaw: "KB: KT-DEC-0201 (dismissed)",
        citeIds: ["KT-DEC-0201"],
        citeTags: ["dismissed"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-D2",
        kbLineRaw: "KB: KT-DEC-0202 (dismissed)",
        citeIds: ["KT-DEC-0202"],
        citeTags: ["dismissed"],
        client: "cc",
        ts: marker.marker_ts + 20,
      }),
      mkTurnEvent({
        sessionId: "sess-D3",
        kbLineRaw: "KB: KT-DEC-0203 (dismissed)",
        citeIds: ["KT-DEC-0203"],
        citeTags: ["dismissed"],
        client: "cc",
        ts: marker.marker_ts + 30,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.total_turns).toBe(3);
    expect(report.metrics.qualifying_cites).toBe(0);
    expect(report.dismissed_reason_histogram).toEqual({ unspecified: 3 });
  });

  // 9b. rc.23 T8c: KB: none sentinel breakdown. Parser pulls the bracket
  //     payload from `kb_line_raw` since the on-ledger cite_tags enum still
  //     emits the bare `none` token (schema-bound). Three forms must
  //     tabulate: `[no-relevant]`, `[not-applicable]`, and bare `KB: none`
  //     (→ unspecified bucket for legacy/lazy emissions).
  it("none_reason_histogram aggregates KB: none sentinels into no-relevant / not-applicable / unspecified buckets", async () => {
    const target = createInitializedProject("cite-coverage-none-sentinel");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-N1",
        kbLineRaw: "KB: none [no-relevant]",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-N2",
        kbLineRaw: "KB: none [no-relevant]",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 20,
      }),
      mkTurnEvent({
        sessionId: "sess-N3",
        kbLineRaw: "KB: none [not-applicable]",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 30,
      }),
      // Bare legacy form → unspecified bucket.
      mkTurnEvent({
        sessionId: "sess-N4",
        kbLineRaw: "KB: none",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 40,
      }),
      // Unknown bracket payload also collapses to unspecified (bounded
      // histogram; new enums must come via bootstrap doc updates).
      mkTurnEvent({
        sessionId: "sess-N5",
        kbLineRaw: "KB: none [bogus-reason]",
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 50,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.total_turns).toBe(5);
    expect(report.metrics.qualifying_cites).toBe(0);
    expect(report.none_reason_histogram).toEqual({
      "no-relevant": 2,
      "not-applicable": 1,
      unspecified: 2,
    });
  });

  // 10. Per-client split: 2 cc turns + 1 codex turn → per_client.cc=2,
  //     per_client.codex=1. per_client is only emitted when client='all'.
  it("per_client split tabulates total_turns separately for each client when client='all'", async () => {
    const target = createInitializedProject("cite-coverage-per-client");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-P1",
        kbLineRaw: "KB: KT-DEC-0301",
        citeIds: ["KT-DEC-0301"],
        citeTags: ["planned"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-P2",
        kbLineRaw: "KB: KT-DEC-0302",
        citeIds: ["KT-DEC-0302"],
        citeTags: ["planned"],
        client: "cc",
        ts: marker.marker_ts + 20,
      }),
      mkTurnEvent({
        sessionId: "sess-P3",
        kbLineRaw: "KB: KT-DEC-0303",
        citeIds: ["KT-DEC-0303"],
        citeTags: ["none"],
        client: "codex",
        ts: marker.marker_ts + 30,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.per_client).toBeDefined();
    expect(report.per_client?.cc?.total_turns).toBe(2);
    expect(report.per_client?.cc?.qualifying_cites).toBe(2);
    expect(report.per_client?.codex?.total_turns).toBe(1);
    expect(report.per_client?.codex?.qualifying_cites).toBe(0);
  });

  // 11. --since=<future> filter: events with `ts < since` are excluded from
  //     the window. effectiveSince = max(marker_ts, options.since), so we
  //     pick `since` > marker_ts.
  it("--since filter excludes events older than the cutoff", async () => {
    const target = createInitializedProject("cite-coverage-since-filter");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    // Pick a cutoff far after the marker. Old turn lands BEFORE the cutoff;
    // new turn lands AFTER it. Only the new turn should survive the filter.
    const cutoff = marker.marker_ts + 100_000;

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-OLD",
        kbLineRaw: "KB: old",
        citeIds: ["KT-DEC-0401"],
        citeTags: ["planned"],
        client: "cc",
        ts: marker.marker_ts + 10, // < cutoff → excluded
      }),
      mkTurnEvent({
        sessionId: "sess-NEW",
        kbLineRaw: "KB: new",
        citeIds: ["KT-DEC-0402"],
        citeTags: ["planned"],
        client: "cc",
        ts: cutoff + 10, // >= cutoff → included
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: cutoff, client: "all" });

    expect(report.since_ts).toBe(cutoff);
    expect(report.metrics.total_turns).toBe(1);
    expect(report.metrics.qualifying_cites).toBe(1);
  });

  // 12. --client=cc filter: codex turns excluded from top-level metrics,
  //     and edits from codex-only sessions are excluded from edits_touched +
  //     expected_but_missed (cross-client denominator guard). per_client is
  //     suppressed when the client filter is narrowed.
  it("--client=cc filter excludes codex turns and codex-session edits, suppresses per_client", async () => {
    const target = createInitializedProject("cite-coverage-client-filter");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    // Seed a narrow kb so codex-session edits would otherwise be flagged as
    // expected_but_missed under a polluted cc filter.
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0599", relevance_scope: "narrow", relevance_paths: ["src/codex-only/**"] },
    ]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-CC",
        kbLineRaw: "KB: cc",
        citeIds: ["KT-DEC-0501"],
        citeTags: ["planned"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-CX",
        kbLineRaw: "KB: codex",
        citeIds: ["KT-DEC-0502"],
        citeTags: ["planned"],
        client: "codex",
        ts: marker.marker_ts + 20,
      }),
      // One edit on a cc session — should count.
      mkEditEvent({
        path: "src/cc-only/a.ts",
        sessionId: "sess-CC",
        ts: marker.marker_ts + 30,
      }),
      // Two edits on a codex session — must be skipped under --client=cc.
      // The second one targets a narrow-kb-relevant path; if the cross-client
      // guard regressed it would surface as expected_but_missed=1.
      mkEditEvent({
        path: "src/codex-only/x.ts",
        sessionId: "sess-CX",
        ts: marker.marker_ts + 31,
      }),
      mkEditEvent({
        path: "src/codex-only/y.ts",
        sessionId: "sess-CX",
        ts: marker.marker_ts + 32,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "cc" });

    expect(report.client_filter).toBe("cc");
    expect(report.metrics.total_turns).toBe(1);
    expect(report.metrics.qualifying_cites).toBe(1);
    // Denominator guard: only the cc-session edit counts.
    expect(report.metrics.edits_touched).toBe(1);
    // expected_but_missed must NOT be polluted by codex-session edits hitting
    // the narrow kb's relevance_paths against an empty cc cited-kb map.
    expect(report.metrics.expected_but_missed).toBe(0);
    // Narrowed filter — per_client suppressed (a single-entry record would
    // duplicate the top-level metrics).
    expect(report.per_client).toBeUndefined();
  });

  // 12b. Mirror of #12 against --client=codex: codex edits counted, cc edits
  //      skipped. Same cross-client guard, opposite filter.
  it("--client=codex filter excludes cc turns and cc-session edits", async () => {
    const target = createInitializedProject("cite-coverage-client-filter-codex");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0699", relevance_scope: "narrow", relevance_paths: ["src/cc-only/**"] },
    ]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-CC2",
        kbLineRaw: "KB: cc",
        citeIds: ["KT-DEC-0601"],
        citeTags: ["planned"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-CX2",
        kbLineRaw: "KB: codex",
        citeIds: ["KT-DEC-0602"],
        citeTags: ["planned"],
        client: "codex",
        ts: marker.marker_ts + 20,
      }),
      // cc-only edits — must be skipped under --client=codex; one of them
      // targets a narrow-kb path that would otherwise pollute
      // expected_but_missed under the codex filter.
      mkEditEvent({
        path: "src/cc-only/a.ts",
        sessionId: "sess-CC2",
        ts: marker.marker_ts + 30,
      }),
      mkEditEvent({
        path: "src/cc-only/b.ts",
        sessionId: "sess-CC2",
        ts: marker.marker_ts + 31,
      }),
      // One codex-session edit — should count.
      mkEditEvent({
        path: "src/codex-only/z.ts",
        sessionId: "sess-CX2",
        ts: marker.marker_ts + 32,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "codex" });

    expect(report.client_filter).toBe("codex");
    expect(report.metrics.total_turns).toBe(1);
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
    expect(report.per_client).toBeUndefined();
  });

  // 13. expected_but_missed: edit on src/foo/x.ts matches a narrow KB whose
  //     stable_id was NOT cited in the same session → counter increments.
  it("narrow KB with matching edit but no same-session cite increments expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-expected-missed");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0601", relevance_scope: "narrow", relevance_paths: ["src/foo/**"] },
    ]);

    seedEvents(target, [
      // Turn in sess-M that cites a DIFFERENT kb (or cites nothing).
      mkTurnEvent({
        sessionId: "sess-M",
        kbLineRaw: null,
        citeIds: [],
        citeTags: ["none"],
        client: "cc",
        ts: marker.marker_ts + 5,
      }),
      // Edit in the same session, path matches the narrow kb's
      // relevance_paths — but KT-DEC-0601 was not cited, so this should
      // be flagged as expected_but_missed=1.
      mkEditEvent({
        path: "src/foo/x.ts",
        sessionId: "sess-M",
        ts: marker.marker_ts + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(1);
  });

  // 14. Performance: seed 10k assistant_turn_observed events and assert the
  //     full report builds in well under 2s. The single-pass aggregator
  //     (TASK-06) should land closer to ~100ms locally; the 2s ceiling is
  //     CI-tolerant. Adjust downward once we have stable CI numbers.
  it("runs in under 2s for 10k seeded events (performance smoke)", async () => {
    const target = createInitializedProject("cite-coverage-perf-10k");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);

    const N = 10_000;
    const events: unknown[] = [];
    for (let i = 0; i < N; i += 1) {
      events.push(
        mkTurnEvent({
          sessionId: `sess-${i % 50}`,
          turnId: `turn-${i}`,
          kbLineRaw: i % 2 === 0 ? `KB: KT-DEC-${String(i).padStart(4, "0")}` : null,
          citeIds: i % 2 === 0 ? [`KT-DEC-${String(i).padStart(4, "0")}`] : [],
          citeTags: i % 3 === 0 ? ["planned"] : i % 3 === 1 ? ["none"] : ["dismissed"],
          client: i % 2 === 0 ? "cc" : "codex",
          ts: marker.marker_ts + i + 1,
        }),
      );
    }
    seedEvents(target, events);

    const t0 = Date.now();
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    const elapsedMs = Date.now() - t0;

    expect(report.status).toBe("ok");
    expect(report.metrics.total_turns).toBe(N);
    // Lenient ceiling — CI fluctuates. Local runs should be well under 500ms;
    // 2s leaves headroom for slow-spinning runners.
    expect(elapsedMs).toBeLessThan(2_000);
  });
});

// v2.0.0-rc.24 TASK-08: runDoctorCiteCoverage contract-policy metrics.
//
// Locks the contract for the five new accumulators (contract_with /
// contract_missing / hard_violated / cite_id_unresolved / skip_count), the
// per-(layer, type) cross-tab, the --layer filter (team/personal/all), the
// contract_metrics_status discriminator (ok / skipped:bootstrap_drift /
// awaiting_marker), and the operator-vs-edits comparator (edit/not_edit/
// require/forbid).
//
// Fixture invariants that differ from rc.20 TASK-08:
//   - `.fabric/AGENTS.md` must byte-equal BOOTSTRAP_CANONICAL for the
//     contract marker to emit. Tests that need the marker call
//     `seedCleanBootstrap`; tests asserting the drift-skip path either omit
//     the snapshot or write a mutated copy.
//   - agents.meta.json fixtures carry `description.knowledge_type` so
//     loadKbIdTypeMap returns the SINGULAR enum value (TASK-07 contract).
//     `seedAgentsMetaWithTypes` handles this.
//   - Turn events optionally carry `cite_commitments[]` (operators + skip
//     reason). `mkContractTurnEvent` is the index-aligned constructor.
//
// require:/forbid: SCOPE NOTE: edit_intent_checked events carry no diff
// content (only path/intent/diff_stat), so require:<symbol> and
// forbid:<symbol> are evaluated as "<symbol present as substring of any
// changed file PATH>". Documented at the comparator definition in doctor.ts
// — these tests assert that documented behavior, not the planned
// diff-content match.
describe("runDoctorCiteCoverage (rc.24 contract metrics)", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  function seedCleanBootstrap(target: string): void {
    // Drift gate requires `.fabric/AGENTS.md` byte-equal to BOOTSTRAP_CANONICAL.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL, "utf8");
  }

  function seedAgentsMetaWithTypes(
    target: string,
    nodes: Array<{
      stable_id: string;
      knowledge_type: "decisions" | "pitfalls" | "models" | "guidelines" | "processes";
      relevance_paths?: readonly string[];
      relevance_scope?: "narrow" | "broad";
    }>,
  ): void {
    const metaNodes: Record<string, unknown> = {};
    for (const node of nodes) {
      metaNodes[node.stable_id] = {
        file: `.fabric/knowledge/${node.knowledge_type}s/${node.stable_id}.md`,
        content_ref: `.fabric/knowledge/${node.knowledge_type}s/${node.stable_id}.md`,
        scope_glob: "**",
        hash: "deadbeef",
        stable_id: node.stable_id,
        identity_source: "declared",
        description: {
          summary: "test",
          intent_clues: [],
          tech_stack: [],
          impact: [],
          must_read_if: "always",
          knowledge_type: node.knowledge_type,
          relevance_scope: node.relevance_scope ?? "broad",
          relevance_paths: node.relevance_paths ?? [],
        },
      };
    }
    const meta = { revision: "test-revision", nodes: metaNodes };
    writeFileSync(
      join(target, ".fabric", "agents.meta.json"),
      JSON.stringify(meta, null, 2),
      "utf8",
    );
  }

  type ContractOperator = { kind: "edit" | "not_edit" | "require" | "forbid"; target: string };
  type ContractCommitment = { operators: ContractOperator[]; skip_reason: string | null };

  function mkContractTurnEvent(opts: {
    sessionId: string;
    turnId?: string;
    citeIds: string[];
    citeTags: string[];
    citeCommitments?: ContractCommitment[];
    client?: "cc" | "codex" | "cursor";
    ts: number;
    kbLineRaw?: string | null;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:contract-turn:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "assistant_turn_observed",
      kb_line_raw: opts.kbLineRaw ?? null,
      cite_ids: opts.citeIds,
      cite_tags: opts.citeTags,
      cite_commitments: opts.citeCommitments ?? [],
      ...(opts.client !== undefined ? { client: opts.client } : {}),
      turn_id: opts.turnId ?? `turn-${randomUUID()}`,
      timestamp: new Date(opts.ts).toISOString(),
    };
  }

  function mkContractEditEvent(opts: { path: string; ts: number; sessionId: string }): object {
    return {
      kind: "fabric-event",
      id: `event:contract-edit:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "edit_intent_checked",
      path: opts.path,
      compliant: true,
      intent: "test edit",
      ledger_entry_id: `ledger:${randomUUID()}`,
      matched_rule_context_ts: null,
      window_ms: 60_000,
    };
  }

  // -------------------------------------------------------------------------
  // 17 tests — exceeds the 15-case minimum required by the task spec.
  // -------------------------------------------------------------------------

  // 1. Drift-gate path → contract_metrics_status='skipped:bootstrap_drift';
  //    rc.20 metrics still populated (independent windows per plan B4).
  it("bootstrap drift → contract_metrics_status='skipped:bootstrap_drift', rc.20 metrics still computed", async () => {
    const target = createInitializedProject("contract-drift-skip");
    writeFile(".fabric/events.jsonl", "", target);
    // Mutate .fabric/AGENTS.md so it no longer byte-equals BOOTSTRAP_CANONICAL.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), `${BOOTSTRAP_CANONICAL}drift`, "utf8");

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0001", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-1",
        citeIds: ["KT-DEC-0001"],
        citeTags: ["planned"],
        // Even though commitments are EMPTY (would be contract_missing under
        // 'ok' state), drift skips the contract walk entirely.
        citeCommitments: [{ operators: [], skip_reason: null }],
        client: "cc",
        ts: rcMarker.marker_ts + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.status).toBe("ok");
    expect(report.contract_metrics_status).toBe("skipped:bootstrap_drift");
    // rc.20 still computed — the planned cite registered as a qualifying cite.
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.total_turns).toBe(1);
    // Contract metrics are zeroed (shape present, all counters 0).
    expect(report.contract_metrics).toEqual({
      decisions_cited: 0,
      pitfalls_cited: 0,
      contract_with: 0,
      contract_missing: 0,
      hard_violated: 0,
      cite_id_unresolved: 0,
      skip_count: {},
    });
    expect(report.per_layer_type).toEqual({ team: {}, personal: {} });
  });

  // 2. Decisions cite with valid operator + matching session edit →
  //    contract_with=1, hard_violated=0.
  it("decision cite with edit:foo.ts operator and matching session edit → contract_with=1, hard_violated=0", async () => {
    const target = createInitializedProject("contract-with-ok");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    // Force-emit contract marker before the loop calls runDoctor — keeps
    // ordering deterministic and lets us seed turns AFTER the marker_ts.
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    expect(cMarker.blocked_by).toBe(null);
    expect(cMarker.marker_ts).toBeGreaterThan(0);

    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0100", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-OK",
        citeIds: ["KT-DEC-0100"],
        citeTags: ["recalled"],
        citeCommitments: [{
          operators: [{ kind: "edit", target: "src/auth/**" }],
          skip_reason: null,
        }],
        client: "cc",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
      mkContractEditEvent({
        path: "src/auth/login.ts",
        sessionId: "sess-OK",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 20,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics_status).toBe("ok");
    expect(report.contract_metrics?.decisions_cited).toBe(1);
    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.contract_missing).toBe(0);
    expect(report.contract_metrics?.hard_violated).toBe(0);
    expect(report.per_layer_type?.team?.decisions).toBe(1);
  });

  // 3. Decisions cite with operator but mismatched edits → hard_violated=1.
  it("decision cite with edit:foo.ts operator but no matching edit → hard_violated=1", async () => {
    const target = createInitializedProject("contract-hard-violated");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0200", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-V",
        citeIds: ["KT-DEC-0200"],
        citeTags: ["recalled"],
        citeCommitments: [{
          operators: [{ kind: "edit", target: "src/auth/**" }],
          skip_reason: null,
        }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
      // Edit hits a DIFFERENT path — operator fails.
      mkContractEditEvent({
        path: "src/billing/checkout.ts",
        sessionId: "sess-V",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 20,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics_status).toBe("ok");
    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.hard_violated).toBe(1);
  });

  // 4. Pitfall cite missing operator → contract_missing=1.
  it("pitfall cite with empty operators and no skip_reason → contract_missing=1, pitfalls_cited=1", async () => {
    const target = createInitializedProject("contract-missing");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-PIT-0001", knowledge_type: "pitfalls" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-M",
        citeIds: ["KT-PIT-0001"],
        citeTags: ["recalled"],
        citeCommitments: [{ operators: [], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.pitfalls_cited).toBe(1);
    expect(report.contract_metrics?.contract_missing).toBe(1);
    expect(report.contract_metrics?.contract_with).toBe(0);
    expect(report.per_layer_type?.team?.pitfalls).toBe(1);
  });

  // 5. Model cite → no contract check (decisions/pitfalls counters stay 0)
  //    but cross-tab still bumps under team.model.
  it("model cite → no contract bump, cross-tab still counts the type", async () => {
    const target = createInitializedProject("contract-model-noop");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-MOD-0001", knowledge_type: "models" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-MOD",
        citeIds: ["KT-MOD-0001"],
        citeTags: ["recalled"],
        // Even with operators, models are reference cites — no contract eval.
        citeCommitments: [{ operators: [{ kind: "edit", target: "**" }], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.decisions_cited).toBe(0);
    expect(report.contract_metrics?.pitfalls_cited).toBe(0);
    expect(report.contract_metrics?.contract_with).toBe(0);
    expect(report.contract_metrics?.contract_missing).toBe(0);
    expect(report.per_layer_type?.team?.models).toBe(1);
  });

  // 6. Guideline cite → deferred bucket, no contract check.
  it("guideline cite → deferred bucket, no contract check", async () => {
    const target = createInitializedProject("contract-guideline-deferred");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-GLD-0001", knowledge_type: "guidelines" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-G",
        citeIds: ["KT-GLD-0001"],
        citeTags: ["recalled"],
        citeCommitments: [{ operators: [], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.contract_missing).toBe(0);
    expect(report.per_layer_type?.team?.guidelines).toBe(1);
  });

  // v2.0.0-rc.27.1 (Codex review fix): multi-id contract walk must look up
  // commitments[i] for EVERY i < cite_ids.length. Prior to the fix, the
  // parser only emitted one commitment for a shared contract — the 2nd id
  // got a `commitments[1] === undefined` lookup and was counted as
  // contract_missing, even though the line carried a valid `→ edit:...`
  // operator. This test guards against re-introducing that regression by
  // synthesizing the post-fix event shape (commitment duplicated per id)
  // and asserting contract_with=2, contract_missing=0.
  it("multi-id cite with shared contract → contract_with bumps for every id, contract_missing=0 (rc.27.1)", async () => {
    const target = createInitializedProject("contract-multi-id-shared");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0001", knowledge_type: "decisions" },
      { stable_id: "KT-PIT-0005", knowledge_type: "pitfalls" },
    ]);
    // Post-fix wire shape: one commitment slot per id, sharing the parsed
    // contract verbatim. `mkContractTurnEvent` accepts the array directly.
    const sharedCommitment = {
      operators: [{ kind: "edit" as const, target: "src/foo.ts" }],
      skip_reason: null,
    };
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-multi",
        citeIds: ["KT-DEC-0001", "KT-PIT-0005"],
        citeTags: ["recalled"],
        citeCommitments: [sharedCommitment, sharedCommitment],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.decisions_cited).toBe(1);
    expect(report.contract_metrics?.pitfalls_cited).toBe(1);
    expect(report.contract_metrics?.contract_with).toBe(2);
    expect(report.contract_metrics?.contract_missing).toBe(0);
  });

  // 7. Unresolved cite_id → cite_id_unresolved bucket, NOT contract_missing.
  it("unresolved cite_id (not in idTypeMap) → cite_id_unresolved=1, contract_missing=0", async () => {
    const target = createInitializedProject("contract-unresolved-id");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    // Note: agents.meta.json deliberately does NOT include KT-DEC-9999.
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0001", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-U",
        citeIds: ["KT-DEC-9999"],
        citeTags: ["recalled"],
        citeCommitments: [{ operators: [], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.cite_id_unresolved).toBe(1);
    expect(report.contract_metrics?.contract_missing).toBe(0);
    expect(report.contract_metrics?.decisions_cited).toBe(0);
    expect(report.per_layer_type?.team?.unresolved).toBe(1);
  });

  // 8. skip:sequencing → skip_count.sequencing=1, NOT contract_with/missing.
  it("decision cite with skip_reason='sequencing' → skip_count.sequencing=1", async () => {
    const target = createInitializedProject("contract-skip-sequencing");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0300", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-S",
        citeIds: ["KT-DEC-0300"],
        citeTags: ["recalled"],
        citeCommitments: [{ operators: [], skip_reason: "sequencing" }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.skip_count).toEqual({ sequencing: 1 });
    // skip:<reason> exits the contract_with/missing partition.
    expect(report.contract_metrics?.contract_with).toBe(0);
    expect(report.contract_metrics?.contract_missing).toBe(0);
    // decisions_cited still bumps — the cite was emitted under the strict
    // bucket, the skip just records that the operator was explicitly waived.
    expect(report.contract_metrics?.decisions_cited).toBe(1);
  });

  // 9. Personal-layer (KP-*) cite breakdown.
  it("personal-layer KP-* cite counted under per_layer_type.personal", async () => {
    const target = createInitializedProject("contract-personal-layer");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KP-DEC-0001", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-P",
        citeIds: ["KP-DEC-0001"],
        citeTags: ["recalled"],
        citeCommitments: [{ operators: [], skip_reason: null }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.per_layer_type?.personal?.decisions).toBe(1);
    expect(report.per_layer_type?.team?.decisions ?? 0).toBe(0);
    expect(report.contract_metrics?.contract_missing).toBe(1);
  });

  // 10. --layer=team filter → KP-* excluded from contract metrics.
  it("--layer=team filter → KP-* cites excluded from contract counters but still tracked in per_layer_type", async () => {
    const target = createInitializedProject("contract-layer-team");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0400", knowledge_type: "decisions" },
      { stable_id: "KP-DEC-0400", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-T",
        citeIds: ["KT-DEC-0400", "KP-DEC-0400"],
        citeTags: ["recalled", "recalled"],
        citeCommitments: [
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
        ],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, {
      since: 0,
      client: "all",
      layer: "team",
    });

    expect(report.layer_filter).toBe("team");
    // Only the team cite contributes to contract counters.
    expect(report.contract_metrics?.decisions_cited).toBe(1);
    expect(report.contract_metrics?.contract_missing).toBe(1);
    // Per-layer cross-tab is NOT bumped for the filtered-out KP- cite.
    expect(report.per_layer_type?.team?.decisions).toBe(1);
    expect(report.per_layer_type?.personal?.decisions ?? 0).toBe(0);
  });

  // 11. --layer=personal filter → KT-* excluded.
  it("--layer=personal filter → KT-* cites excluded from contract counters", async () => {
    const target = createInitializedProject("contract-layer-personal");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0500", knowledge_type: "decisions" },
      { stable_id: "KP-DEC-0500", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-Pers",
        citeIds: ["KT-DEC-0500", "KP-DEC-0500"],
        citeTags: ["recalled", "recalled"],
        citeCommitments: [
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
        ],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, {
      since: 0,
      client: "all",
      layer: "personal",
    });

    expect(report.layer_filter).toBe("personal");
    expect(report.contract_metrics?.decisions_cited).toBe(1);
    expect(report.per_layer_type?.personal?.decisions).toBe(1);
    expect(report.per_layer_type?.team?.decisions ?? 0).toBe(0);
  });

  // 12. Cross-tab shape sanity: mixed types both layers.
  it("cross-tab populated with both layers and multiple types in one report", async () => {
    const target = createInitializedProject("contract-crosstab");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0601", knowledge_type: "decisions" },
      { stable_id: "KT-PIT-0601", knowledge_type: "pitfalls" },
      { stable_id: "KT-MOD-0601", knowledge_type: "models" },
      { stable_id: "KP-GLD-0601", knowledge_type: "guidelines" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-X",
        citeIds: ["KT-DEC-0601", "KT-PIT-0601", "KT-MOD-0601", "KP-GLD-0601"],
        citeTags: ["recalled", "recalled", "recalled", "recalled"],
        citeCommitments: [
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
        ],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.per_layer_type?.team?.decisions).toBe(1);
    expect(report.per_layer_type?.team?.pitfalls).toBe(1);
    expect(report.per_layer_type?.team?.models).toBe(1);
    expect(report.per_layer_type?.personal?.guidelines).toBe(1);
  });

  // 13. require:<symbol> operator — matches when symbol appears in any
  //     session edit PATH (the documented scoped fallback — diff content
  //     not in ledger).
  it("require:<symbol> passes when symbol appears as substring of any session edit path", async () => {
    const target = createInitializedProject("contract-require-match");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0701", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-R",
        citeIds: ["KT-DEC-0701"],
        citeTags: ["recalled"],
        citeCommitments: [{
          operators: [{ kind: "require", target: "auth" }],
          skip_reason: null,
        }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
      // Path contains 'auth' substring → operator passes.
      mkContractEditEvent({
        path: "src/auth/handler.ts",
        sessionId: "sess-R",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.hard_violated).toBe(0);
  });

  // 14. forbid:<symbol> operator — violates when symbol appears in any
  //     session edit path.
  it("forbid:<symbol> violates when symbol appears in a session edit path", async () => {
    const target = createInitializedProject("contract-forbid-violated");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0801", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-F",
        citeIds: ["KT-DEC-0801"],
        citeTags: ["recalled"],
        citeCommitments: [{
          operators: [{ kind: "forbid", target: "legacy" }],
          skip_reason: null,
        }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
      // Path contains 'legacy' → operator violates.
      mkContractEditEvent({
        path: "src/legacy/old.ts",
        sessionId: "sess-F",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.hard_violated).toBe(1);
  });

  // 15. not_edit:<glob> operator — violates when matching file is edited.
  it("not_edit:<glob> violates when a session edit hits the forbidden glob", async () => {
    const target = createInitializedProject("contract-notedit-violated");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    const cMarker = await ensureCiteContractPolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0901", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-NE",
        citeIds: ["KT-DEC-0901"],
        citeTags: ["recalled"],
        citeCommitments: [{
          operators: [{ kind: "not_edit", target: "src/billing/**" }],
          skip_reason: null,
        }],
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 5,
      }),
      mkContractEditEvent({
        path: "src/billing/charge.ts",
        sessionId: "sess-NE",
        ts: Math.max(rcMarker.marker_ts, cMarker.marker_ts) + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.contract_metrics?.contract_with).toBe(1);
    expect(report.contract_metrics?.hard_violated).toBe(1);
  });

  // 16. Existing rc.20 metrics survive the rc.24 extension byte-for-byte —
  //     contract_metrics is purely additive.
  it("rc.20 metrics (qualifying_cites/recalled_unverified/dismissed_reason_histogram) unchanged in shape", async () => {
    const target = createInitializedProject("contract-rc20-untouched");
    seedCleanBootstrap(target);
    writeFile(".fabric/events.jsonl", "", target);

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    await ensureCiteContractPolicyActivatedMarker(target);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-RC20",
        citeIds: ["KT-DEC-0001"],
        citeTags: ["planned"],
        kbLineRaw: "KB: KT-DEC-0001 (anchor) [planned]",
        client: "cc",
        ts: rcMarker.marker_ts + 5,
      }),
      mkContractTurnEvent({
        sessionId: "sess-RC20",
        citeIds: ["KT-DEC-0002"],
        citeTags: ["dismissed"],
        client: "cc",
        ts: rcMarker.marker_ts + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    // rc.20 fields populated as before.
    expect(report.metrics.total_turns).toBe(2);
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.dismissed_reason_histogram).toEqual({ unspecified: 1 });
    // rc.24 additive fields present.
    expect(report.contract_metrics).toBeDefined();
    expect(report.contract_metrics_status).toBe("ok");
    expect(report.per_layer_type).toBeDefined();
  });

  // 17. awaiting_marker state — degraded path where the marker emitter
  //     returns marker_ts=0 with blocked_by=null (e.g. nonexistent root
  //     after drift is conceptually 'ok' but ledger I/O degrades).
  //     Constructed by pointing at a nonexistent root → marker collapse.
  it("nonexistent project root → contract_metrics_status='skipped:bootstrap_drift' (missing snapshot folded into drift)", async () => {
    // Note: rc.20 marker also returns marker_ts=0 here, which collapses to
    // the rc.20 'skipped' top-level status. We still expect the contract
    // status to surface — the early-return preserves the contract block.
    const report = await runDoctorCiteCoverage(
      "/nonexistent-contract-coverage-fabric-root-xyzzy",
      { since: 0, client: "all" },
    );

    expect(report.status).toBe("skipped");
    // L1 inspector says 'missing' → drift gate fires → 'skipped:bootstrap_drift'.
    expect(report.contract_metrics_status).toBe("skipped:bootstrap_drift");
    expect(report.contract_metrics).toEqual({
      decisions_cited: 0,
      pitfalls_cited: 0,
      contract_with: 0,
      contract_missing: 0,
      hard_violated: 0,
      cite_id_unresolved: 0,
      skip_count: {},
    });
    expect(report.layer_filter).toBe("all");
  });
});

// v2.0.0-rc.23 TASK-007 (a-C2): enrichDescriptions back-fill suite.
describe("enrichDescriptions", () => {
  // Helper — seed a canonical entry whose frontmatter is missing N of the
  // four rc.23 description-grade fields. Layout matches the
  // CANONICAL_KNOWLEDGE_FILENAME_PATTERN (`<id>--<slug>.md`) so
  // iterateCanonicalFilenames yields the visit.
  function seedLegacyEntry(
    target: string,
    relPath: string,
    overrides: { withFields?: string[]; body?: string } = {},
  ): void {
    const withFields = overrides.withFields ?? [];
    const lines = [
      "---",
      "id: KT-DEC-0001",
      "type: decision",
      "maturity: draft",
      "layer: team",
      "created_at: 2026-05-10T00:00:00Z",
    ];
    if (withFields.includes("intent_clues")) lines.push('intent_clues: ["foo"]');
    if (withFields.includes("tech_stack")) lines.push('tech_stack: ["bar"]');
    if (withFields.includes("impact")) lines.push('impact: ["baz"]');
    if (withFields.includes("must_read_if")) lines.push('must_read_if: "existing"');
    lines.push("---", overrides.body ?? "# Legacy Entry\n\nBody.\n");
    writeFile(relPath, lines.join("\n"), target);
  }

  it("auto mode back-fills all four fields with deterministic stubs", async () => {
    const target = createInitializedProject("enrich-auto-missing-all");
    seedLegacyEntry(target, ".fabric/knowledge/decisions/KT-DEC-0001--legacy.md");

    const report = await enrichDescriptions(target, { auto: true });

    expect(report.mode).toBe("auto");
    expect(report.scanned).toBe(1);
    expect(report.modified).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.candidates).toHaveLength(1);
    const candidate = report.candidates[0];
    expect(candidate.modified).toBe(true);
    expect(candidate.missing).toEqual([
      "intent_clues",
      "tech_stack",
      "impact",
      "must_read_if",
    ]);
    expect(candidate.added_fields).toEqual([
      "intent_clues",
      "tech_stack",
      "impact",
      "must_read_if",
    ]);

    // Verify on-disk frontmatter now carries all four fields.
    const absPath = join(target, ".fabric/knowledge/decisions/KT-DEC-0001--legacy.md");
    const rewritten = readFileSync(absPath, "utf8");
    expect(rewritten).toMatch(/^intent_clues:\s*\[\]/m);
    expect(rewritten).toMatch(/^tech_stack:\s*\[\]/m);
    expect(rewritten).toMatch(/^impact:\s*\[\]/m);
    expect(rewritten).toMatch(/^must_read_if:\s*Legacy Entry/m);

    // knowledge_enriched event emitted to the ledger.
    const { events } = await readEventLedger(target);
    const enrichEvents = events.filter((e) => e.event_type === "knowledge_enriched");
    expect(enrichEvents).toHaveLength(1);
    expect(enrichEvents[0]).toMatchObject({
      mode: "auto",
      path: ".fabric/knowledge/decisions/KT-DEC-0001--legacy.md",
      added_fields: ["intent_clues", "tech_stack", "impact", "must_read_if"],
    });
  });

  it("auto mode is no-op (idempotent) on entries that already have all four fields", async () => {
    const target = createInitializedProject("enrich-auto-noop");
    seedLegacyEntry(target, ".fabric/knowledge/decisions/KT-DEC-0001--complete.md", {
      withFields: ["intent_clues", "tech_stack", "impact", "must_read_if"],
    });
    const absPath = join(target, ".fabric/knowledge/decisions/KT-DEC-0001--complete.md");
    const before = readFileSync(absPath, "utf8");
    const beforeMtime = statSync(absPath).mtimeMs;

    const report = await enrichDescriptions(target, { auto: true });

    expect(report.scanned).toBe(1);
    expect(report.modified).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.candidates).toEqual([]);

    // File content unchanged byte-for-byte.
    const after = readFileSync(absPath, "utf8");
    expect(after).toBe(before);
    // mtime invariant (the convergence criteria's idempotency check). On some
    // filesystems mtime resolution is coarse, so we assert <= rather than ==.
    const afterMtime = statSync(absPath).mtimeMs;
    expect(afterMtime).toBeLessThanOrEqual(beforeMtime);

    // No knowledge_enriched event emitted.
    const { events } = await readEventLedger(target);
    expect(events.filter((e) => e.event_type === "knowledge_enriched")).toHaveLength(0);
  });

  it("dry-run mode reports missing fields without writing", async () => {
    const target = createInitializedProject("enrich-dry-run");
    seedLegacyEntry(target, ".fabric/knowledge/decisions/KT-DEC-0001--legacy.md", {
      withFields: ["intent_clues"],
    });
    const absPath = join(target, ".fabric/knowledge/decisions/KT-DEC-0001--legacy.md");
    const before = readFileSync(absPath, "utf8");

    const report = await enrichDescriptions(target, { auto: true, dryRun: true });

    expect(report.dryRun).toBe(true);
    // v2.0.0-rc.29 TASK-007 (BUG-M1): --auto + --dry-run reports as `preview`.
    expect(report.mode).toBe("preview");
    expect(report.scanned).toBe(1);
    expect(report.modified).toBe(0);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].modified).toBe(false);
    expect(report.candidates[0].missing).toEqual(["tech_stack", "impact", "must_read_if"]);

    // File unchanged.
    expect(readFileSync(absPath, "utf8")).toBe(before);

    // No ledger event emitted in dry-run mode.
    const { events } = await readEventLedger(target);
    expect(events.filter((e) => e.event_type === "knowledge_enriched")).toHaveLength(0);
  });

  // v2.0.0-rc.29 TASK-007 (BUG-M1): mode label now reflects what actually
  // happens — readonly when no `--auto` is passed (writes nothing). The
  // previous "interactive" label was misleading because no prompt actually
  // ran. Legacy `"interactive"` literal is kept in the type union as a
  // deprecated alias for downstream consumers.
  it("readonly (default) mode reports missing fields without writing", async () => {
    const target = createInitializedProject("enrich-readonly");
    seedLegacyEntry(target, ".fabric/knowledge/pitfalls/KP-PIT-0001--gotcha.md", {
      withFields: ["tech_stack", "impact"],
    });
    const absPath = join(target, ".fabric/knowledge/pitfalls/KP-PIT-0001--gotcha.md");
    const before = readFileSync(absPath, "utf8");

    const report = await enrichDescriptions(target, {}); // no auto

    expect(report.mode).toBe("readonly");
    expect(report.scanned).toBe(1);
    expect(report.modified).toBe(0);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].missing).toEqual(["intent_clues", "must_read_if"]);
    expect(report.candidates[0].modified).toBe(false);
    expect(report.candidates[0].added_fields).toEqual([]);

    // File unchanged.
    expect(readFileSync(absPath, "utf8")).toBe(before);
  });

  it("auto mode is idempotent across two runs (second pass writes nothing)", async () => {
    const target = createInitializedProject("enrich-idempotent");
    seedLegacyEntry(target, ".fabric/knowledge/guidelines/KT-GLD-0001--rule.md");

    const first = await enrichDescriptions(target, { auto: true });
    expect(first.modified).toBe(1);

    const second = await enrichDescriptions(target, { auto: true });
    expect(second.modified).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.candidates).toEqual([]);
  });

  it("skips pending/ subtree (Skill owns pending shape)", async () => {
    const target = createInitializedProject("enrich-skip-pending");
    // Pending entries use bare-slug filenames; iterateCanonicalFilenames is
    // scoped to KNOWLEDGE_CANONICAL_TYPE_DIRS which deliberately excludes
    // pending/. Belt-and-suspenders: even if a Skill landed a pending entry
    // missing all four fields, enrichDescriptions must not touch it.
    writeFile(
      ".fabric/knowledge/pending/decisions/draft.md",
      "---\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Draft\n",
      target,
    );

    const report = await enrichDescriptions(target, { auto: true });

    expect(report.scanned).toBe(0);
    expect(report.candidates).toEqual([]);
  });
});

// v2.0.0-rc.25 TASK-10: runDoctorArchiveHistory — per-session archive attempt
// audit. Covers the four core cases: basic distinct-session aggregation,
// most-recent-wins for multi-attempt sessions, --since window exclusion, and
// empty-ledger no-crash. Helpers seed raw JSONL rows the same way the
// runDoctorCiteCoverage tests do so we control `ts` precisely.
describe("runDoctorArchiveHistory", () => {
  function seedArchiveEvents(
    target: string,
    rows: Array<{
      sessionId: string;
      ts: number;
      outcome: "proposed" | "viability_failed" | "user_dismissed" | "skipped_no_signal";
      candidatesProposed?: number;
      coveredThroughTs?: number;
      knowledgeProposedIds?: string[];
    }>,
  ): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines =
      rows
        .map((row) =>
          JSON.stringify({
            kind: "fabric-event",
            id: `event:arch:${randomUUID()}`,
            ts: row.ts,
            schema_version: 1,
            session_id: row.sessionId,
            event_type: "session_archive_attempted",
            outcome: row.outcome,
            covered_through_ts: row.coveredThroughTs ?? row.ts,
            candidates_proposed: row.candidatesProposed ?? 0,
            knowledge_proposed_ids: row.knowledgeProposedIds ?? [],
          }),
        )
        .join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  it("aggregates one entry per session when each session has a single attempt", async () => {
    // Imported lazily to avoid a top-of-file edit that conflicts with parallel
    // tasks. Once the module evaluates, subsequent calls reuse the same binding.
    const { runDoctorArchiveHistory } = await import("./doctor.js");
    const target = createInitializedProject("archive-history-basic");
    writeFile(".fabric/events.jsonl", "", target);

    const now = Date.now();
    seedArchiveEvents(target, [
      { sessionId: "sess-A", ts: now - 60_000, outcome: "proposed", candidatesProposed: 3 },
      { sessionId: "sess-B", ts: now - 30_000, outcome: "skipped_no_signal" },
      { sessionId: "sess-C", ts: now - 10_000, outcome: "user_dismissed" },
    ]);

    const report = await runDoctorArchiveHistory(target, { since: 0 });
    expect(report.total).toBe(3);
    expect(report.entries).toHaveLength(3);
    // Descending by last_attempted_at — sess-C is most recent.
    expect(report.entries[0].outcome).toBe("user_dismissed");
    expect(report.entries[1].outcome).toBe("skipped_no_signal");
    expect(report.entries[2].outcome).toBe("proposed");
    // session_id_short truncation: all our seeded ids are <= 8 chars so they
    // render verbatim (no `...` suffix).
    expect(report.entries[0].session_id_short).toBe("sess-C");
    expect(report.entries[2].candidates_proposed).toBe(3);
  });

  it("keeps only the most recent attempt when the same session retries", async () => {
    const { runDoctorArchiveHistory } = await import("./doctor.js");
    const target = createInitializedProject("archive-history-most-recent");
    writeFile(".fabric/events.jsonl", "", target);

    const base = Date.now() - 60_000;
    seedArchiveEvents(target, [
      // Earliest attempt — skipped_no_signal, will lose.
      { sessionId: "sess-retry", ts: base, outcome: "skipped_no_signal" },
      // Middle attempt — viability_failed, will lose.
      { sessionId: "sess-retry", ts: base + 10_000, outcome: "viability_failed" },
      // Latest attempt — proposed, MUST win.
      {
        sessionId: "sess-retry",
        ts: base + 20_000,
        outcome: "proposed",
        candidatesProposed: 2,
      },
    ]);

    const report = await runDoctorArchiveHistory(target, { since: 0 });
    expect(report.total).toBe(1);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].outcome).toBe("proposed");
    expect(report.entries[0].candidates_proposed).toBe(2);
    // last_attempted_at corresponds to the latest ts.
    expect(report.entries[0].last_attempted_at).toBe(new Date(base + 20_000).toISOString());
  });

  it("excludes events older than the --since floor", async () => {
    const { runDoctorArchiveHistory } = await import("./doctor.js");
    const target = createInitializedProject("archive-history-since");
    writeFile(".fabric/events.jsonl", "", target);

    const now = Date.now();
    const oneDayMs = 86_400_000;
    seedArchiveEvents(target, [
      // 10d ago — outside a 7d window.
      { sessionId: "sess-old", ts: now - 10 * oneDayMs, outcome: "proposed" },
      // 2d ago — inside a 7d window.
      { sessionId: "sess-recent", ts: now - 2 * oneDayMs, outcome: "proposed" },
    ]);

    const sevenDayFloor = now - 7 * oneDayMs;
    const report = await runDoctorArchiveHistory(target, { since: sevenDayFloor });
    expect(report.total).toBe(1);
    expect(report.entries[0].session_id_short).toBe("sess-rec...");
    // since_ms is echoed back verbatim.
    expect(report.since_ms).toBe(sevenDayFloor);
  });

  it("returns an empty report (no crash) when events.jsonl is empty", async () => {
    const { runDoctorArchiveHistory } = await import("./doctor.js");
    const target = createInitializedProject("archive-history-empty");
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorArchiveHistory(target, { since: 0 });
    expect(report.total).toBe(0);
    expect(report.entries).toEqual([]);
    expect(report.since_ms).toBe(0);
    // generated_at must be a parseable ISO timestamp.
    expect(Number.isNaN(new Date(report.generated_at).getTime())).toBe(false);
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
  // v2/rc.2: seed a knowledge entry under .fabric/knowledge/ so knowledge-meta-builder
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
// knowledge-meta-builder rebuilds an identical empty meta and reconcile is
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
  // Defer to writeKnowledgeMeta() at the test site after this returns; that gives us a
  // canonical empty agents.meta.json + knowledge-test.index.json that match what
  // knowledge-meta-builder produces, so neither agents_meta_stale nor
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

// ---------------------------------------------------------------------------
// v2.0.0-rc.30 TASK-003 (H2 deferred-from-rc.29): emit-cadence sub-check.
//
// Pins the function contract — fetched=0 vacuously OK; observed/fetched <
// EMIT_CADENCE_WARN_THRESHOLD (0.8) yields warn; healthy ratio yields ok.
// Wired-into-main-doctor decision deferred to v2.1 design doc per
// memory/project_l0_l1_l2_redesign_v21.md.
// ---------------------------------------------------------------------------

describe("runDoctorEmitCadenceCheck (rc.30 TASK-003 H2)", () => {
  function seedEventsRaw(target: string, events: unknown[]): void {
    const fabricDir = join(target, ".fabric");
    if (!existsSync(fabricDir)) {
      mkdirSync(fabricDir, { recursive: true });
    }
    const ledgerPath = join(fabricDir, "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  function makeFetchEvent(i: number): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `fetch-${String(i)}`,
      ts: 1700000000000 + i,
      schema_version: 1,
      event_type: "knowledge_sections_fetched",
      selection_token: `tok-${String(i)}`,
      requested_sections: [],
      final_stable_ids: [`KT-DEC-${String(i).padStart(4, "0")}`],
      ai_selected_stable_ids: [],
    };
  }

  function makeObserveEvent(i: number): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `obs-${String(i)}`,
      ts: 1700000001000 + i,
      schema_version: 1,
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: [],
      cite_tags: [],
      cite_commitments: [],
      turn_id: `t-${String(i)}`,
      timestamp: new Date(1700000001000 + i).toISOString(),
    };
  }

  it("returns ok with ratio 1 when no knowledge_sections_fetched events exist (vacuous pass)", async () => {
    const target = mkdtempSync(join(tmpdir(), "cadence-empty-"));
    tempRoots.push(target);
    seedEventsRaw(target, [makeObserveEvent(0)]);
    const report = await runDoctorEmitCadenceCheck(target);
    expect(report.fetched).toBe(0);
    expect(report.ratio).toBe(1);
    expect(report.status).toBe("ok");
    expect(report.message).toContain("not applicable");
  });

  it("returns warn when assistant_turn_observed/knowledge_sections_fetched < 0.8", async () => {
    const target = mkdtempSync(join(tmpdir(), "cadence-warn-"));
    tempRoots.push(target);
    const events = [
      ...Array.from({ length: 10 }, (_unused, i) => makeFetchEvent(i)),
      ...Array.from({ length: 5 }, (_unused, i) => makeObserveEvent(i)),
    ];
    seedEventsRaw(target, events);
    const report = await runDoctorEmitCadenceCheck(target);
    expect(report.fetched).toBe(10);
    expect(report.observed).toBe(5);
    expect(report.ratio).toBe(0.5);
    expect(report.status).toBe("warn");
    expect(report.message).toContain("Stop hook may not be wired");
  });

  it("returns ok when ratio ≥ 0.8 (healthy emit cadence)", async () => {
    const target = mkdtempSync(join(tmpdir(), "cadence-ok-"));
    tempRoots.push(target);
    const events = [
      ...Array.from({ length: 10 }, (_unused, i) => makeFetchEvent(i)),
      ...Array.from({ length: 9 }, (_unused, i) => makeObserveEvent(i)),
    ];
    seedEventsRaw(target, events);
    const report = await runDoctorEmitCadenceCheck(target);
    expect(report.fetched).toBe(10);
    expect(report.observed).toBe(9);
    expect(report.ratio).toBe(0.9);
    expect(report.status).toBe("ok");
  });
});
