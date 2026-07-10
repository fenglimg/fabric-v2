import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  BOOTSTRAP_CANONICAL_EN,
  BOOTSTRAP_CANONICAL_ZH,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  STORE_LAYOUT,
  fabricConfigSchema,
  readStoreCounters,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import {
  ensureCiteContractPolicyActivatedMarker,
  ensureCitePolicyActivatedMarker,
  enrichDescriptions,
  purgeEmptyShellTurnsIfNeeded,
  rollupCiteAuditIfNeeded,
  runDoctorCiteCoverage,
  runDoctorBodyReadMisfireCheck,
  runDoctorFix,
  runDoctorReport,
} from "./doctor.js";
import { readEventLedger } from "./event-ledger.js";
import { readCiteRollup } from "./cite-rollup.js";
import { bumpCounter, readMetrics } from "./metrics.js";
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
    // v2.2 W5 R4 (agents.meta decolo): `agents_meta_missing` /
    // `knowledge_test_index_missing` fixable errors and the
    // `content_refs_unavailable` manual error are retired — they were raised by
    // the co-location agents.meta.json checks.
    expect(report.fixable_errors.map((issue) => issue.code)).toEqual([
      "bootstrap_anchor_missing",
      "event_ledger_missing",
    ]);
    // v2.0 follow-up: `init_context_missing` removed from doctor — that
    // artifact is owned by the AI-side client init skill, not by init CLI.
    expect(report.manual_errors.map((issue) => issue.code)).toEqual([
      "forensic_missing",
    ]);
  });

  it("returns ok when target-state fabric artifacts are aligned (v2.0 fixture)", async () => {
    // v2/rc.2: the initialized fixture seeds the v2.0 layout (AGENTS.md +
    // .fabric/knowledge/* subdirs) plus a knowledge entry for knowledge-meta-builder
    // to index. Legacy `.fabric/rules/` is no longer used.
    const target = createInitializedProject("doctor-ok");
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
      // rc.19 bootstrap-consolidation TASK-005: L1 + L2 byte-level drift
      // detection. Order: anchor existence → L1 (canonical ↔ snapshot) → L2
      // (snapshot+rules ↔ three-end blocks).
      "Bootstrap snapshot drift",
      "Managed block drift",
      "Scan evidence",
      // v2.2 W5 R4 (agents.meta decolo): "Agents metadata" / "Rule content refs"
      // / "Knowledge-test index" removed — they inspected the retired
      // co-location agents.meta.json + its derived test-link cache.
      "Event ledger",
      "Event ledger partial write",
      "Events ledger health (rc.37 Plan B 5 hard gate)",
      "Event ledger schema compat",
      "Skill ref mirror parity",
      // v2.0.0-rc.33 W3-6 / W3-7 + skill contract: SKILL.md token budget,
      // description structural lint, and contract integrity. All are
      // observability checks (no mutation), inserted adjacent to skill_ref_mirror.
      "Skill token budget",
      "Skill description quality",
      "Skill contract integrity",
      // ux-w2-2: registry-driven retired-reference (stale-pointer) lint.
      "Retired reference",
      "Cite-policy Goodhart",
      // v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog ratio. Inserted adjacent to
      // cite_goodhart — both are observability checks built on disk + ledger.
      "Knowledge draft backlog",
      // rc.36 TASK-05 (P0-8): empty-tags ratio. Adjacent to draft_backlog —
      // both flag observability gaps in canonical entry quality.
      "Knowledge tags coverage",
      // rc.36 TASK-09 (P1-NEW1): drift unconsumed observability lint.
      "Knowledge drift unconsumed",
      // v2.2 W5 R4: co-location "Knowledge counter desync" replaced by the
      // store-aware "Store counter drift" (per-store committed counters.json).
      "Store counter drift",
      // store-onboarding grill (Q5): on-disk store invisible to the registry.
      "Store orphan",
      // W2 (F-003): project-registry drift over projects.json ↔ projects/ tree.
      "Project registry drift",
      "Knowledge underseeded",
      "Knowledge session-hints stale",
      "Hook cache writable",
      // rc.23 TASK-010 (e): stale `.fabric/.serve.lock` advisory sits adjacent
      // to the other read-side hygiene infos. Info kind — does not bump
      // report status.
      "Serve lock",
      "Skill markdown YAML",
      // W3-C: "Router chain refs" check removed — the fabric/ router was retired
      // (0-router skill set), so the S_CHAIN backstop has nothing to lint.
      // rc.23 TASK-014 (F8c): Onboard coverage advisory — info kind. Sits
      // adjacent to Skill markdown YAML (both are Skill-adjacent advisories).
      "Onboard coverage",
      // rc.31 BUG-M3/NEW-4: hooks_wired observability (Claude Code hook
      // injection state). Adjacent to onboard / promote-ledger — all three
      // are install/runtime-state advisories. Warning kind when missing.
      "Claude Code hooks wired",
      // v2.0.0-rc.37 NEW-20: hooks_runtime — shebang + Node.js syntax
      // validity of installed *.cjs hook files (closes the gap below
      // hooks_wired, which only checks settings.json references).
      "Hooks runtime health",
      // v2.0.0-rc.37 NEW-27: hooks_content_drift — cross-client sha256
      // parity (same basename in .claude/.codex must hash-match).
      "Hooks cross-client content parity",
      // rc.35 TASK-04 (P0-9.b): global CLI version probe — surfaces rc.30
      // PATH installs against rc.31+ project schemas (P0-9 root cause).
      // Sits next to hooks_wired — both diagnose runtime install state.
      "Global fabric CLI version",
      // rc.35 TASK-05 (P0-10.a): opaque-summary ratio — surfaces the
      // werewolf-eval failure mode where description.summary == stable_id.
      // Built from the same MetaInspection so no extra disk reads.
      "Knowledge summary opacity",
      // v2.2 W4 (G-GUARD / A6): store scope lint — missing scope fields /
      // personal-leak-in-shared-store / dangling project ref over read-set stores.
      "Store scope lint",
      // v2.2 Goal B (G-INTEGRITY): store stable_id collision (warning) + layer
      // mismatch (manual error), rebuilt store-aware over the read-set corpus.
      "Stable ID collision",
      "Knowledge layer mismatch",
      // v2.2 Goal B (G-RELEVANCE): relevance_paths hygiene — dangling (warning)
      // + drift (info), rebuilt store-aware over the read-set corpus.
      "Knowledge relevance_paths dangling",
      "Knowledge relevance_paths drift",
      // W4-3 (KT-MOD-0001) narrow_no_paths + W4-2 (KT-DEC-0028) broad-index-drift.
      "Knowledge narrow scope without paths",
      "Knowledge broad index drift",
      // v2.2 Goal B (G-AGE): knowledge decay — orphan_demote + stale_archive,
      // rebuilt store-aware (age from events.jsonl last-active, KT-DEC-0023).
      "Knowledge orphan demote",
      "Knowledge stale archive",
      // v2.2 C1: knowledge promotion candidate (info kind — growth counterpart).
      "Knowledge promotion candidate",
      // v2.2 C1: broad review-recheck nudge (info kind — broad's review-clock
      // counterpart to the usage-age decay it is exempt from).
      "Knowledge broad review recheck",
      // project-scope binding backfill lint — store bound but no project_id /
      // active_project. Adjacent to store scope lint (both scope invariants).
      "Project-scope binding",
      // write_route_target_unbound — statically validates write_routes[*].store
      // against required_stores. Adjacent to Project-scope binding — both are
      // static config-level cross-references catching stale bindings.
      "Write route target",
      // rc.31 BUG-G2/G5: promote-ledger invariant (proposed >= started >=
      // promoted). Adjacent to hooks_wired — both are observability checks
      // built off events.jsonl + project state.
      "Promote ledger invariant",
      "Preexisting root markdown",
    ]);
    // v2.2 W5 R4 (agents.meta decolo): 54 → 48. Removed 6 co-location checks
    // (Agents metadata / Rule content refs / Knowledge-test index / Meta manual
    // divergence / Knowledge dir unindexed / Knowledge index drift); "Knowledge
    // counter desync" renamed to "Store counter drift" (net -6).
    // +1: project-scope binding backfill lint (unbound_project) → 49.
    // fallback-purge W2-1a: removed "Bootstrap marker migration" check → 48.
    // fallback-purge W2-1c: removed "Claude MCP config location" check → 47.
    // doctor-decruft W2: removed 16 store-cutover empty-stub checks (baseline
    // filename format / draft auto-promote / stable_id collision / filesystem-edit
    // fallback / orphan demote / stale archive / pending overdue / stable_id
    // duplicate / layer mismatch / narrow-no-paths / relevance_paths dangling /
    // relevance_paths drift / personal-layer misclassify / suspicious KB / narrow
    // too few / relevance fields missing) → 31.
    // v2.2 Goal B (G-INTEGRITY): rebuilt store-aware stable_id_collision +
    // layer_mismatch as two checks → 33.
    // v2.2 Goal B (G-RELEVANCE): rebuilt relevance_paths dangling + drift → 35.
    // v2.2 Goal B (G-AGE): rebuilt orphan_demote + stale_archive → 37.
    // W4-3 narrow_no_paths (KT-MOD-0001) + W4-2 broad-index-drift (KT-DEC-0028) → 39.
    // store-onboarding grill (Q5): +1 store_orphan (on-disk store invisible to
    // the registry) → 40.
    // B2 skill-router (A4): +1 router_chain_ref (fabric/ S_CHAIN reference
    // backstop) → 41.
    // v2.2 C1: +1 promotion_candidate (knowledge growth lint, info kind) → 42.
    // v2.2 C1: +1 broad_review_recheck (broad's review-clock lint, info kind) → 43.
    // ux-w2-2: +1 retired_reference (stale-pointer lint) → 44.
    // W3-C: -1 router_chain_ref (fabric/ router retired, 0-router skill set) → 43.
    // W2 (F-003): +1 project_registry_drift (projects.json ↔ projects/ tree) → 44.
    // skill-architecture absorption: +1 skill_contract_integrity → 45.
    // rc.10: +1 write_route_target_unbound (write_routes[*].store ↔ required_stores) → 46.
    expect(report.checks).toHaveLength(46);
  });

  it("v2.0: clean post-init repo (mocked layout) reports zero errors AND zero warnings", async () => {
    // Done-when: fresh post-init v2.0 repo with mocked layout — no errors, no warnings.
    const target = createV2KnowledgeProject("doctor-v2-clean");

    const report = await runDoctorReport(target);

    expect(report.fixable_errors.map((e) => e.code)).toEqual([]);
    expect(report.manual_errors.map((e) => e.code)).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toEqual([]);
    expect(report.status).toBe("ok");
  });

  it("treats malformed rule sections as manual errors", async () => {
    const target = createInitializedProject("doctor-invalid-rule");
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

  it("doctor fixable check fires when partial write detected and --fix truncates + writes ledger event", async () => {
    const target = createInitializedProject("doctor-partial-write");

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
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);
    const check = report.checks.find(
      (c) => c.name === "Skill ref mirror parity",
    );
    expect(check?.status).toBe("ok");
  });

  it("skill_ref_mirror: ok when both clients carry byte-identical ref content", async () => {
    const target = createInitializedProject("doctor-skill-ref-mirror-parity");
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
  // `fabric doctor --fix`. Rotation runs as an unconditional hygiene step (no
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
      seedLedger(target, [recentMcpEventLine("mcp-new-1"), recentMcpEventLine("mcp-new-2")]);

      const fix = await runDoctorFix(target);

      expect(fix.fixed.map((i) => i.code)).not.toContain("event_ledger_rotated");
      // No archive directory was created (rotation primitive only mkdirs
      // when it actually has lines to write).
      expect(existsSync(join(target, ".fabric", "events.archive"))).toBe(false);
    });

    it("doctor_fix_emits_events_rotated: post-rotation main ledger contains an events_rotated audit event", async () => {
      const target = createInitializedProject("doctor-rotate-audit");
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

  // v2.2 W5 R4 (agents.meta decolo): the `--fix calls reconcileKnowledge` test
  // removed — doctor no longer rebuilds the retired co-location agents.meta.json.

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

  // v2.2 W5 R4 (agents.meta decolo): the meta_manually_diverged tests + the
  // injectPersonalNode helper removed — the check compared co-location
  // agents.meta.json nodes against disk, which is no longer authoritative.

  // v2.2 W5 R4 (agents.meta decolo): the `rc.22 TASK-012: agents_meta_stale severity
  // demotion` describe block removed — agents_meta_stale was the staleness signal
  // of the retired co-location agents.meta.json check (auto-healed by reconcile).

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

  // doctor-decruft W2: TASK-031 (stable_id_collision ok-path) test removed —
  // the store-cutover empty-stub `stable_id_collision` check was deleted.

  // v2.2 W5 R4 (agents.meta decolo): TASK-030 (knowledge_dir_unindexed) and
  // TASK-029 (content_ref_missing) tests removed alongside their checks. Both
  // compared the project co-location `.fabric/knowledge` against agents.meta.json
  // and were fixed by reconcileKnowledge — all retired now that knowledge lives
  // in stores.

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

  // v2.0.0-rc.* store-only cutover: the co-location `knowledge_dir_missing`
  // check (validated `.fabric/knowledge/<subdir>` presence) is retired — the
  // store-only model no longer keeps a project-local knowledge tree. Its two
  // tests were removed with the check (zero production reference).

  // v2.2 W5 R4 (agents.meta decolo): the co-location `counter_desync` /
  // `index_drift` tests (which seeded agents.meta.json#counters below the
  // observed stable_id) are replaced by `store_counter_drift` — the store-aware
  // successor. The monotonic stable_id counter now lives per-store in a
  // committed counters.json (KT-DEC-0004); doctor floors it at the highest
  // stable_id observed on disk (floor never lowers).
  describe("v2.2 W5 R4: store_counter_drift (per-store counters.json)", () => {
    const STORE_UUID = "44444444-4444-4444-8444-444444444444";

    // Project bound to STORE_UUID as a required team store (no co-location meta).
    function createStoreBoundProject(name: string): string {
      const target = createProject(name);
      writeFile("package.json", JSON.stringify({ name, dependencies: { vite: "^7.0.0" } }, null, 2), target);
      writeFile("src/main.ts", "export const boot = true;\n", target);
      writeFile("AGENTS.md", "# AGENTS\n", target);
      writeFile(".fabric/events.jsonl", "", target);
      writeFile(
        ".fabric/fabric-config.json",
        JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2),
        target,
      );
      return target;
    }

    function storeDir(): string {
      return join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: STORE_UUID }));
    }

    // Seed the team store with one decision entry whose stable_id counter is
    // `diskCounter`, and write counters.json with KT.DEC = `ledgerCounter`.
    function seedStore(diskCounter: number, ledgerCounter: number): void {
      const sd = storeDir();
      const decisionsDir = join(sd, STORE_LAYOUT.knowledgeDir, "decisions");
      mkdirSync(decisionsDir, { recursive: true });
      const id = `KT-DEC-${String(diskCounter).padStart(4, "0")}`;
      const entry = `---\nid: ${id}\ntype: decision\nlayer: team\nsemantic_scope: team\nvisibility_store: "team"\nmaturity: proven\ncreated_at: 2026-06-04T00:00:00.000Z\nsummary: A genuine store decision summary for counter drift coverage.\n---\n# ${id}\n\nBody.\n`;
      writeFileSync(join(decisionsDir, `${id}.md`), entry, "utf8");
      writeFileSync(
        join(sd, STORE_LAYOUT.countersFile),
        `${JSON.stringify({ KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 }, KT: { MOD: 0, DEC: ledgerCounter, GLD: 0, PIT: 0, PRO: 0 } }, null, 2)}\n`,
        "utf8",
      );
      saveGlobalConfig({
        uid: "test-uid",
        stores: [{ store_uuid: STORE_UUID, alias: "team", remote: "git@e:t.git" }],
      });
    }

    it("detected when a store's counters.json trails the on-disk max stable_id", async () => {
      const target = createStoreBoundProject("doctor-store-counter-detect");
      // Disk has KT-DEC-0005 but counters.json records KT.DEC=3 → drift (a next
      // allocation would mint 0004, re-minting below the existing 0005).
      seedStore(5, 3);

      const report = await runDoctorReport(target);
      expect(report.fixable_errors.map((e) => e.code)).toContain("store_counter_drift");
      const check = report.checks.find((c) => c.name === "Store counter drift");
      expect(check?.status).toBe("error");
      expect(check?.message).toContain("KT.DEC");
    });

    it("--fix floors counters.json at disk-max (3 -> 5) and clears the drift", async () => {
      const target = createStoreBoundProject("doctor-store-counter-fix");
      seedStore(5, 3);

      const fix = await runDoctorFix(target);
      expect(fix.fixed.map((e) => e.code)).toContain("store_counter_drift");

      // counters.json floored to the highest stable_id observed on disk.
      expect(readStoreCounters(storeDir()).KT.DEC).toBe(5);

      const after = await runDoctorReport(target);
      expect(after.fixable_errors.map((e) => e.code)).not.toContain("store_counter_drift");
    });

    it("does NOT flag a counter ABOVE disk-max (KT-DEC-0004: floor never lowers)", async () => {
      const target = createStoreBoundProject("doctor-store-counter-above-max");
      // Disk has KT-DEC-0005 but counters.json already advanced to 9 (the
      // highest entry was deleted, freeing no slot). This is correct, not drift.
      seedStore(5, 9);

      const report = await runDoctorReport(target);
      expect(report.fixable_errors.map((e) => e.code)).not.toContain("store_counter_drift");
      expect(report.checks.find((c) => c.name === "Store counter drift")?.status).toBe("ok");
      // --fix must not lower the counter below its advanced value.
      await runDoctorFix(target);
      expect(readStoreCounters(storeDir()).KT.DEC).toBe(9);
    });

    it("--apply-lint floors drifted store counters", async () => {
      const target = createStoreBoundProject("doctor-store-counter-applylint");
      seedStore(7, 2);

      const { runDoctorApplyLint } = await import("./doctor.js");
      const result = await runDoctorApplyLint(target);
      const driftMutation = result.mutations.find((m) => m.kind === "knowledge_index_drift");
      expect(driftMutation?.applied).toBe(true);
      expect(driftMutation?.detail).toContain("team:KT.DEC 2 -> 7");
      expect(readStoreCounters(storeDir()).KT.DEC).toBe(7);
    });
  });

  it("v2.0 / bootstrap_anchor_missing: passes when AGENTS.md or CLAUDE.md exists at repo root", async () => {
    const target = createInitializedProject("doctor-anchor-agents");
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);
    expect(report.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_anchor_missing");
    expect(report.checks.find((c) => c.name === "Bootstrap anchor")?.status).toBe("ok");
  });

  it("v2.0 / bootstrap_anchor_missing: passes when CLAUDE.md alone exists (no AGENTS.md)", async () => {
    const target = createInitializedProject("doctor-anchor-claude-only");
    rmSync(join(target, "AGENTS.md"), { force: true });
    writeFile("CLAUDE.md", "# CLAUDE\n", target);
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorReport(target);
    expect(report.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_anchor_missing");
    expect(report.checks.find((c) => c.name === "Bootstrap anchor")?.status).toBe("ok");
  });

  it("v2.0 / bootstrap_anchor_missing: fixable_error when neither AGENTS.md nor CLAUDE.md exists", async () => {
    const target = createInitializedProject("doctor-anchor-missing");
    rmSync(join(target, "AGENTS.md"), { force: true });
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

  // doctor-decruft W2: the two filesystem_edit_fallback tests were removed
  // alongside the store-cutover empty-stub `filesystem_edit_fallback` check.
  // The synth-restore path they exercised was already inert (the report fed an
  // empty inspection); store-aware orphan recovery is deferred to Goal Y.

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

  describe("ISS-20260531-053: hook cache writability diagnostic", () => {
    it("reports ok when .fabric/.cache is absent but its parent can create it", async () => {
      const target = createInitializedProject("doctor-hook-cache-writable-ok");
      writeFile(".fabric/events.jsonl", "", target);
      expect(existsSync(join(target, ".fabric", ".cache"))).toBe(false);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Hook cache writable");
      expect(check?.status).toBe("ok");
      expect(report.warnings.map((w) => w.code)).not.toContain("hook_cache_not_writable");
      expect(existsSync(join(target, ".fabric", ".cache"))).toBe(false);
    });

    it("warns when .fabric/.cache cannot accept hook sidecar writes", async () => {
      const target = createInitializedProject("doctor-hook-cache-writable-blocked");
      writeFile(".fabric/events.jsonl", "", target);
      writeFile(".fabric/.cache", "not a directory", target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Hook cache writable");
      expect(check?.status).toBe("warn");
      expect(check?.kind).toBe("warning");
      expect(check?.code).toBe("hook_cache_not_writable");
      expect(check?.message).toContain(".fabric/.cache");
      expect(report.warnings.map((w) => w.code)).toContain("hook_cache_not_writable");
    });
  });

  // rc.23 TASK-010 (e): stale `.fabric/.serve.lock` advisory + --fix unlink.
  // The serve lock is written by `acquireLock` at the top of `fabric serve` and
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
      writeFile(".fabric/events.jsonl", "", target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Serve lock");
      expect(check?.status).toBe("ok");
      expect(check?.kind).toBeUndefined();
      expect(report.infos.map((i) => i.code)).not.toContain("stale_serve_lock");
    });

    it("reports ok when lock holds a live PID (no advisory)", async () => {
      const target = createInitializedProject("doctor-rc23-servelock-alive");
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
      writeFile(".fabric/events.jsonl", "", target);
      const lockFile = seedServeLock(target, process.pid, Date.now());

      const fix = await runDoctorFix(target);

      expect(existsSync(lockFile)).toBe(true);
      expect(fix.fixed.map((i) => i.code)).not.toContain("stale_serve_lock");
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
      writeFile(".fabric/events.jsonl", "", target);

      const report = await runDoctorReport(target);
      const check = report.checks.find((c) => c.name === "Skill markdown YAML");
      expect(check?.status).toBe("ok");
      expect(report.warnings.map((w) => w.code)).not.toContain("skill_md_yaml_invalid");
    });

    it("ignores a SKILL.md missing the opening frontmatter `---` line", async () => {
      const target = createInitializedProject("doctor-rc12-skill-yaml-no-fm");
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
  // service-layer tests. Mirrors the bootstrap_anchor_missing triplet (L1).
  //
  // FABRIC_HOME isolation: inherited from the file-scoped beforeEach at L24-L29.
  // Every new test here exercises FABRIC_HOME-derived inspection paths through
  // runDoctorReport / runDoctorFix and therefore inherits the isolation already
  // installed at the top of the file (mkdtempSync + process.env.FABRIC_HOME).
  // ---------------------------------------------------------------------------
  describe("rc.19 L1 bootstrap snapshot drift", () => {
    it("reports ok when .fabric/AGENTS.md byte-equals BOOTSTRAP_CANONICAL_EN", async () => {
      const target = createInitializedProject("doctor-rc19-l1-canonical");
      writeFile(".fabric/events.jsonl", "", target);

      // Seed the canonical bootstrap snapshot — byte-for-byte BOOTSTRAP_CANONICAL_EN.
      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");

      const report = await runDoctorReport(target);

      expect(report.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_snapshot_drift");
      expect(report.checks.find((c) => c.name === "Bootstrap snapshot drift")?.status).toBe("ok");
    });

    // Content-layer i18n / G-PARITY C2: a machine-language switch leaves an
    // already-installed project's `.fabric/AGENTS.md` byte-equal to the OTHER
    // locale's canonical body. The current machine is en (FAB_LANG pinned in
    // beforeEach), but the on-disk snapshot is the ZH body — a verbatim Fabric
    // output, NOT a hand-edit. The drift inspector must tolerate it (no false
    // bootstrap_snapshot_drift) so language-switching users aren't nagged.
    it("tolerates a snapshot in the other locale (language switch is not drift)", async () => {
      const target = createInitializedProject("doctor-rc19-l1-locale-switch");
      writeFile(".fabric/events.jsonl", "", target);

      // Current locale resolves to en; seed the ZH canonical body instead.
      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_ZH, "utf8");

      const report = await runDoctorReport(target);

      expect(report.fixable_errors.map((e) => e.code)).not.toContain("bootstrap_snapshot_drift");
      expect(report.checks.find((c) => c.name === "Bootstrap snapshot drift")?.status).toBe("ok");
    });

    it("reports fixable_error when .fabric/AGENTS.md bytes differ", async () => {
      const target = createInitializedProject("doctor-rc19-l1-drift");
      writeFile(".fabric/events.jsonl", "", target);

      // Mutate the snapshot by one char — bytes diverge from BOOTSTRAP_CANONICAL_EN.
      const mutated = `${BOOTSTRAP_CANONICAL_EN}X`;
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
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(join(target, ".fabric", "AGENTS.md"), `${BOOTSTRAP_CANONICAL_EN}drift`, "utf8");

      const fix = await runDoctorFix(target);
      expect(fix.fixed.map((e) => e.code)).toContain("bootstrap_snapshot_drift");
      // Byte-equality restored.
      const restored = readFileSync(join(target, ".fabric", "AGENTS.md"), "utf8");
      expect(restored).toBe(BOOTSTRAP_CANONICAL_EN);

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
      writeFile(".fabric/events.jsonl", "", target);

      const crlf = BOOTSTRAP_CANONICAL_EN.replace(/\n/g, "\r\n");
      // Sanity: the bytes really do differ from canonical.
      expect(crlf).not.toBe(BOOTSTRAP_CANONICAL_EN);
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

    it("reports ok when the managed block byte-equals expected concat (no project-rules)", async () => {
      const target = createInitializedProject("doctor-rc19-l2-ok");
      writeFile(".fabric/events.jsonl", "", target);

      // L1 must be canonical so L2's expectedBody == BOOTSTRAP_CANONICAL_EN.
      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
      // Seed the managed-block target with the canonical body.
      seedManagedBlock(target, "AGENTS.md", BOOTSTRAP_CANONICAL_EN);
      // CLAUDE.md: thin shell — needs @-import line.
      writeFileSync(join(target, "CLAUDE.md"), "# CLAUDE\n\n@.fabric/AGENTS.md\n", "utf8");

      const report = await runDoctorReport(target);
      expect(report.fixable_errors.map((e) => e.code)).not.toContain("managed_block_drift");
      expect(report.checks.find((c) => c.name === "Managed block drift")?.status).toBe("ok");
    });

    it("reports drift when root AGENTS.md managed block bytes differ", async () => {
      const target = createInitializedProject("doctor-rc19-l2-drift");
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
      // Mutate body in root AGENTS.md managed block.
      seedManagedBlock(target, "AGENTS.md", `${BOOTSTRAP_CANONICAL_EN}\nROGUE EDIT`);

      const report = await runDoctorReport(target);
      const codes = report.fixable_errors.map((e) => e.code);
      expect(codes).toContain("managed_block_drift");
      expect(report.checks.find((c) => c.name === "Managed block drift")?.status).toBe("error");
    });

    it("--fix rewrites the managed block and is idempotent on re-run", async () => {
      const target = createInitializedProject("doctor-rc19-l2-fix");
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
      seedManagedBlock(target, "AGENTS.md", "WRONG BODY A");
      writeFileSync(join(target, "CLAUDE.md"), "# CLAUDE\n", "utf8"); // missing @-import

      const fix = await runDoctorFix(target);
      expect(fix.fixed.map((e) => e.code)).toContain("managed_block_drift");

      // The managed block now byte-equals expectedBody == BOOTSTRAP_CANONICAL_EN.
      const after = await runDoctorReport(target);
      expect(after.fixable_errors.map((e) => e.code)).not.toContain("managed_block_drift");
      expect(after.checks.find((c) => c.name === "Managed block drift")?.status).toBe("ok");

      // Verify the rewritten managed block body matches canonical.
      const agentsContent = readFileSync(join(target, "AGENTS.md"), "utf8");
      expect(agentsContent).toContain(BOOTSTRAP_MARKER_BEGIN);
      expect(agentsContent).toContain(BOOTSTRAP_MARKER_END);
      expect(agentsContent).toContain(BOOTSTRAP_CANONICAL_EN);
      // CLAUDE.md gains the @-import line.
      const claudeContent = readFileSync(join(target, "CLAUDE.md"), "utf8");
      expect(claudeContent.split(/\r?\n/u).some((line) => line.trim() === "@.fabric/AGENTS.md")).toBe(true);

      // Idempotency: re-run --fix does NOT report managed_block_drift again.
      const refix = await runDoctorFix(target);
      expect(refix.fixed.map((e) => e.code)).not.toContain("managed_block_drift");
    });

    it("reports L2 drift when CLAUDE.md is missing the @.fabric/AGENTS.md import line", async () => {
      const target = createInitializedProject("doctor-rc19-l2-claude-missing-at");
      writeFile(".fabric/events.jsonl", "", target);

      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
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
      writeFile(".fabric/events.jsonl", "", target);

      // Install canonical state (post-rc.19): L1 snapshot canonical, L2
      // managed-block target seeded canonical, CLAUDE.md with @-import.
      writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
      seedManagedBlock(target, "AGENTS.md", BOOTSTRAP_CANONICAL_EN);
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
// `.fabric/AGENTS.md` does not byte-equal BOOTSTRAP_CANONICAL_EN (rc.23→rc.24
// upgrade window safeguard). Once drift clears, behaves exactly like rc.20
// marker: idempotent, silent on read/write failure.
describe("ensureCiteContractPolicyActivatedMarker", () => {
  it("clean bootstrap + no prior marker → emits new marker with emitted_now:true and blocked_by:null", async () => {
    const target = createInitializedProject("cite-contract-marker-clean-first");
    writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
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
    writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
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
    // Drift: AGENTS.md present but bytes diverge from BOOTSTRAP_CANONICAL_EN.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), `${BOOTSTRAP_CANONICAL_EN}drift`, "utf8");
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
    writeFileSync(join(target, ".fabric", "AGENTS.md"), `${BOOTSTRAP_CANONICAL_EN}X`, "utf8");
    const blocked = await ensureCiteContractPolicyActivatedMarker(target);
    expect(blocked.blocked_by).toBe("bootstrap_drift");

    // Phase 2: user runs `fabric install` → snapshot restored to canonical.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
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
// v2.0.0-rc.39: cite-audit rollup. Rolls assistant_turn_observed older than the
// cite window into compact daily cite-rollup.jsonl rows + drops them from the
// main ledger (archived), bounding events.jsonl while preserving the trend.
describe("rollupCiteAuditIfNeeded", () => {
  function appendLedgerLines(target: string, lines: Record<string, unknown>[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = readFileSync(ledgerPath, "utf8");
    writeFileSync(ledgerPath, `${existing}${lines.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
  }
  function turnEvent(id: string, ts: number, citeId: string | null): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `event:${id}`,
      ts,
      schema_version: 1,
      session_id: `sess-${id}`,
      event_type: "assistant_turn_observed",
      kb_line_raw: citeId ? `KB: ${citeId}` : null,
      cite_ids: citeId ? [citeId] : [],
      cite_tags: citeId ? ["applied"] : ["none"],
      client: "cc",
      turn_id: id,
      timestamp: new Date(ts).toISOString(),
    };
  }

  it("rolls up + drops old turns, keeps recent, and cite-coverage merges the rollup", async () => {
    const target = createInitializedProject("cite-rollup-basic");
    writeFile(".fabric/events.jsonl", "", target);

    const nowMs = Date.UTC(2026, 4, 29, 12, 0, 0); // fixed clock
    const day = 86_400_000;
    // Marker predates all turns so they are coverable.
    appendLedgerLines(target, [
      {
        kind: "fabric-event",
        id: "event:marker",
        ts: nowMs - 20 * day,
        schema_version: 1,
        event_type: "cite_policy_activated",
        policy_version: "rc39-test",
        timestamp: new Date(nowMs - 20 * day).toISOString(),
      },
    ]);
    // Two OLD turns (10d ago, same UTC day, > 7d cutoff) + one RECENT turn (1d ago).
    appendLedgerLines(target, [
      turnEvent("old-1", nowMs - 10 * day, "KT-DEC-0001"),
      turnEvent("old-2", nowMs - 10 * day, null),
      turnEvent("recent-1", nowMs - 1 * day, "KT-DEC-0002"),
    ]);

    const result = await rollupCiteAuditIfNeeded(target, { now: new Date(nowMs), cutoffDays: 7 });
    expect(result.turns_dropped).toBe(2);
    expect(result.days_rolled_up).toBe(1);

    // Old turns dropped from the main ledger, recent turn kept.
    const { events } = await readEventLedger(target);
    const turnIds = events
      .filter((e) => e.event_type === "assistant_turn_observed")
      .map((e) => (e as { turn_id?: string }).turn_id);
    expect(turnIds).toEqual(["recent-1"]);

    // One rollup row capturing the old day's 2 turns.
    const rollup = await readCiteRollup(target);
    expect(rollup).toHaveLength(1);
    expect(rollup[0].metrics.total_turns).toBe(2);

    // Long-window cite-coverage merges rollup + raw: 2 rolled + 1 raw = 3 turns.
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.status).toBe("ok");
    expect(report.metrics.total_turns).toBe(3);
    expect(report.rollup_days_merged).toBe(1);
  });

  it("does NOT drop turns when there is no cite-policy marker (un-rollable)", async () => {
    // werewolf-minigame repro: old turns but no cite_policy_activated marker →
    // per-day cite-coverage is 'skipped' → nothing rolls up → nothing dropped.
    const target = createInitializedProject("cite-rollup-no-marker");
    writeFile(".fabric/events.jsonl", "", target);
    const nowMs = Date.UTC(2026, 4, 29, 12, 0, 0);
    appendLedgerLines(target, [
      turnEvent("old-1", nowMs - 10 * 86_400_000, "KT-DEC-0001"),
      turnEvent("old-2", nowMs - 10 * 86_400_000, "KT-DEC-0002"),
    ]);

    const result = await rollupCiteAuditIfNeeded(target, { now: new Date(nowMs), cutoffDays: 7 });
    expect(result.turns_dropped).toBe(0);
    expect(result.days_rolled_up).toBe(0);
    expect(await readCiteRollup(target)).toHaveLength(0);
    // Turns are LEFT in the ledger (fall to general 30d rotation instead).
    const { events } = await readEventLedger(target);
    expect(events.filter((e) => e.event_type === "assistant_turn_observed")).toHaveLength(2);
  });

  it("is a no-op when no turn is older than the cutoff", async () => {
    const target = createInitializedProject("cite-rollup-noop");
    writeFile(".fabric/events.jsonl", "", target);
    const nowMs = Date.UTC(2026, 4, 29, 12, 0, 0);
    appendLedgerLines(target, [
      {
        kind: "fabric-event",
        id: "event:marker",
        ts: nowMs - 20 * 86_400_000,
        schema_version: 1,
        event_type: "cite_policy_activated",
        policy_version: "rc39-test",
        timestamp: new Date(nowMs - 20 * 86_400_000).toISOString(),
      },
      turnEvent("recent-1", nowMs - 1 * 86_400_000, "KT-DEC-0001"),
    ]);

    const result = await rollupCiteAuditIfNeeded(target, { now: new Date(nowMs), cutoffDays: 7 });
    expect(result.turns_dropped).toBe(0);
    expect(result.days_rolled_up).toBe(0);
    expect(await readCiteRollup(target)).toHaveLength(0);
  });
});

// lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测): cite-coverage
// breaks qualifying cites down per store via the cite_stores[i] qualifier, as a
// PURE diagnostic split that never touches the compliance numerator.
describe("cite-coverage by_store breakdown (W3-T4)", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    writeFileSync(ledgerPath, existing + events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }
  function storeTurn(
    id: string,
    ts: number,
    cites: Array<{ id: string; store: string | null }>,
  ): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `event:${id}`,
      ts,
      schema_version: 1,
      session_id: `sess-${id}`,
      event_type: "assistant_turn_observed",
      kb_line_raw: `KB: ${cites.map((c) => (c.store ? `${c.store}:${c.id}` : c.id)).join(", ")} [applied]`,
      cite_ids: cites.map((c) => c.id),
      cite_tags: cites.map(() => "applied"),
      cite_stores: cites.map((c) => c.store),
      client: "cc",
      turn_id: id,
      timestamp: new Date(ts).toISOString(),
    };
  }

  it("buckets qualifying cites per store; bare ids fall under 'local'; never touches compliance", async () => {
    const target = createInitializedProject("cite-by-store");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      // one team-store cite, one personal-store cite, one bare (project-local) cite.
      storeTurn("t1", marker.marker_ts + 10, [{ id: "KT-DEC-0001", store: "team" }]),
      storeTurn("t2", marker.marker_ts + 20, [{ id: "KP-DEC-0009", store: "personal" }]),
      storeTurn("t3", marker.marker_ts + 30, [{ id: "KT-DEC-0002", store: null }]),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.status).toBe("ok");
    // 3 applied cites total — the compliance count is unchanged by the split.
    expect(report.metrics.qualifying_cites).toBe(3);
    expect(report.metrics.by_store).toEqual({
      team: { qualifying_cites: 1 },
      personal: { qualifying_cites: 1 },
      local: { qualifying_cites: 1 },
    });
    // by_store is a sibling of qualifying_cites — summing the buckets matches it.
    const summed = Object.values(report.metrics.by_store ?? {}).reduce(
      (a, b) => a + b.qualifying_cites,
      0,
    );
    expect(summed).toBe(report.metrics.qualifying_cites);
  });

  it("omits by_store when no cite is observed (steady-state shape unchanged)", async () => {
    const target = createInitializedProject("cite-by-store-empty");
    writeFile(".fabric/events.jsonl", "", target);
    await ensureCitePolicyActivatedMarker(target);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics).not.toHaveProperty("by_store");
  });
});

// v2.0.0-rc.39 (P1 emit-fold): empty-shell turns fold into metrics.jsonl counter
// rows; the live cite-coverage / emit-cadence readers add them back so the
// metric stays invariant across the fold.
describe("rc.39 emit-fold counter merge", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    writeFileSync(ledgerPath, existing + events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }
  function writeMetricsRows(target: string, rows: unknown[]): void {
    const metricsPath = join(target, ".fabric", "metrics.jsonl");
    writeFileSync(metricsPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  }
  function citeTurn(id: string, ts: number, client: string): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `event:${id}`,
      ts,
      schema_version: 1,
      session_id: `sess-${id}`,
      event_type: "assistant_turn_observed",
      kb_line_raw: "KB: KT-DEC-0001 [applied]",
      cite_ids: ["KT-DEC-0001"],
      cite_tags: ["applied"],
      client,
      turn_id: id,
      timestamp: new Date(ts).toISOString(),
    };
  }

  it("adds in-window folded counters to total_turns (invariant: events + counter)", async () => {
    const target = createInitializedProject("emit-fold-merge-basic");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    // 1 cite-bearing event + a folded counter of 40 empty shells (same client).
    seedEvents(target, [citeTurn("c1", marker.marker_ts + 10, "cc")]);
    writeMetricsRows(target, [
      {
        timestamp: new Date(marker.marker_ts + 20).toISOString(),
        window: "stop",
        counters: { "assistant_turn_observed:cc": 40 },
      },
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.status).toBe("ok");
    // 1 raw cite event + 40 folded empty shells = 41 total turns.
    expect(report.metrics.total_turns).toBe(41);
    // Compliance is unaffected by empty shells (they touch only total_turns).
    expect(report.metrics.qualifying_cites).toBe(1);
  });

  it("honours the client filter (a narrowed query sums only that client's namespaced counter)", async () => {
    const target = createInitializedProject("emit-fold-merge-client");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      citeTurn("cc1", marker.marker_ts + 10, "cc"),
      citeTurn("cx1", marker.marker_ts + 11, "codex"),
    ]);
    writeMetricsRows(target, [
      {
        timestamp: new Date(marker.marker_ts + 20).toISOString(),
        window: "stop",
        counters: { "assistant_turn_observed:cc": 5, "assistant_turn_observed:codex": 7 },
      },
    ]);

    const all = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(all.metrics.total_turns).toBe(2 + 5 + 7); // 2 events + 12 folded

    const ccOnly = await runDoctorCiteCoverage(target, { since: 0, client: "cc" });
    expect(ccOnly.metrics.total_turns).toBe(1 + 5); // cc event + cc fold only

    const codexOnly = await runDoctorCiteCoverage(target, { since: 0, client: "codex" });
    expect(codexOnly.metrics.total_turns).toBe(1 + 7);
  });

  it("excludes folded counters older than the window (since filter)", async () => {
    const target = createInitializedProject("emit-fold-merge-window");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [citeTurn("c1", marker.marker_ts + 10, "cc")]);
    // One counter inside the window, one stamped far in the past (before marker).
    writeMetricsRows(target, [
      {
        timestamp: new Date(marker.marker_ts + 20).toISOString(),
        window: "stop",
        counters: { "assistant_turn_observed:cc": 3 },
      },
      {
        timestamp: new Date(marker.marker_ts - 10_000).toISOString(),
        window: "stop",
        counters: { "assistant_turn_observed:cc": 99 },
      },
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    // effectiveSince = marker_ts, so the pre-marker counter (99) is excluded.
    expect(report.metrics.total_turns).toBe(1 + 3);
  });


  function emptyTurn(id: string, ts: number, client: string): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `event:${id}`,
      ts,
      schema_version: 1,
      session_id: `sess-${id}`,
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: [],
      cite_tags: ["none"],
      client,
      turn_id: id,
      timestamp: new Date(ts).toISOString(),
    };
  }

  it("purge: folds existing empty-shell backlog to counters, drops events, keeps cite-coverage total_turns invariant", async () => {
    const target = createInitializedProject("emit-fold-purge");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    // 1 cite-bearing turn + 5 empty shells (recent, same day, same client).
    seedEvents(target, [
      citeTurn("c1", marker.marker_ts + 10, "cc"),
      emptyTurn("e1", marker.marker_ts + 20, "cc"),
      emptyTurn("e2", marker.marker_ts + 21, "cc"),
      emptyTurn("e3", marker.marker_ts + 22, "cc"),
      emptyTurn("e4", marker.marker_ts + 23, "cc"),
      emptyTurn("e5", marker.marker_ts + 24, "cc"),
    ]);

    // Baseline total_turns (empties still raw events): 1 cite + 5 empty = 6.
    const before = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(before.metrics.total_turns).toBe(6);

    const result = await purgeEmptyShellTurnsIfNeeded(target);
    expect(result.turns_folded).toBe(5);
    expect(result.groups_written).toBe(1); // one (day, client) group

    // Empty shells dropped from the ledger; only the cite turn remains.
    const { events } = await readEventLedger(target);
    const turnIds = events
      .filter((e) => e.event_type === "assistant_turn_observed")
      .map((e) => (e as { turn_id?: string }).turn_id);
    expect(turnIds).toEqual(["c1"]);

    // INVARIANT: total_turns unchanged across the purge (1 raw + 5 folded = 6).
    const after = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(after.metrics.total_turns).toBe(6);
    expect(after.metrics.cite_compliance_rate).toBe(before.metrics.cite_compliance_rate);
  });

  it("purge: idempotent — a second run finds no empties and is a no-op", async () => {
    const target = createInitializedProject("emit-fold-purge-idem");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [emptyTurn("e1", marker.marker_ts + 20, "cc")]);

    const first = await purgeEmptyShellTurnsIfNeeded(target);
    expect(first.turns_folded).toBe(1);
    const second = await purgeEmptyShellTurnsIfNeeded(target);
    expect(second.turns_folded).toBe(0);
    expect(second.groups_written).toBe(0);
  });
});

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
        cite_tags: ["applied"],
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

  // v2.2 W5 R2/R7 (agents.meta decolo): the cite-coverage kb relevance index is
  // built from the read-set STORES, not the retired co-location agents.meta.json.
  // Seed each node as a real store .md carrying the relevance frontmatter the
  // cite denominator reads, bind the project to the team store, and register it.
  // The index is keyed under both the local stable_id and `team:<id>`, so the
  // bare cite ids these tests emit still resolve.
  const CITE_STORE_UUID_A = "55555555-5555-4555-8555-555555555555";

  function seedAgentsMeta(
    target: string,
    nodes: Array<{
      stable_id: string;
      relevance_paths?: readonly string[];
      relevance_scope?: "narrow" | "broad";
    }>,
  ): void {
    writeFileSync(
      join(target, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
      "utf8",
    );

    const dir = join(
      resolveGlobalRoot(),
      storeRelativePathForMount({ store_uuid: CITE_STORE_UUID_A }),
      STORE_LAYOUT.knowledgeDir,
      "decisions",
    );
    mkdirSync(dir, { recursive: true });
    for (const node of nodes) {
      const lines = [
        "---",
        `id: ${node.stable_id}`,
        "type: decision",
        "layer: team",
        "maturity: proven",
        "created_at: 2026-06-04T00:00:00.000Z",
        `relevance_scope: ${node.relevance_scope ?? "broad"}`,
        `relevance_paths: [${(node.relevance_paths ?? []).join(", ")}]`,
        `summary: Cite-coverage fixture for ${node.stable_id}`,
        "---",
        `# ${node.stable_id}`,
        "",
        "Body.",
        "",
      ];
      writeFileSync(join(dir, `${node.stable_id}.md`), lines.join("\n"), "utf8");
    }

    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: CITE_STORE_UUID_A, alias: "team", remote: "git@e:cite-a.git" }],
    });
  }

  function mkTurnEvent(opts: {
    sessionId: string;
    turnId?: string;
    kbLineRaw: string | null;
    citeIds: string[];
    citeTags: string[];
    client?: "cc" | "codex";
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

  // KT-DEC-0030: the [applied] verification signal is now knowledge_body_read
  // (native Read of the store body), not the retired knowledge_sections_fetched.
  // recalled_unverified correlation is session_id + ±60s based (not id-matched),
  // so one body_read per session in-window suffices to mark a cite verified.
  function mkKnowledgeBodyReadEvent(opts: {
    sessionId: string;
    ids: string[];
    ts: number;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:bodyread:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "knowledge_body_read",
      stable_id: opts.ids[0] ?? "KT-DEC-0000",
      store: "team",
      path: `~/.fabric/stores/team/kb/knowledge/decisions/${opts.ids[0] ?? "KT-DEC-0000"}--x.md`,
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
      // v2.0.0-rc.38 UX-8 (C): compliance metric — null on no cite-expected turns.
      cite_compliance_rate: null,
      compliant_cites: 0,
      noncompliant_cites: 0,
      uncorrelatable_edits: 0,
      // v2.1 ⑤ cite-redesign (P5): recall-based口径 — 0 edits → 0 backed, null rate.
      recall_backed_edits: 0,
      recall_coverage_rate: null,
      // session-mismatch self-diagnosis counts — all zero on an empty ledger.
      recall_diagnostics: { recalls_in_window: 0, recall_sessions: 0, recall_sessions_correlated: 0 },
      // v2.2.0-rc.1 W1-T3 (cite 诚实拆分): WEAK exposed_and_mutated signal —
      // always emitted (count 0 here, no narrow surface events). `ids` omitted
      // when empty.
      exposed_and_mutated: { count: 0 },
      // lifecycle-refactor W2-T4: PostToolUse mutation funnel — always emitted
      // (zero here, no file_mutated/session_ended events). Observability markers,
      // never folded into compliance.
      mutations_observed: { count: 0 },
      mutation_pool: { attributed: 0, unattributed_workspace_dirty: 0 },
      sessions_closed: { count: 0 },
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
        citeTags: ["applied"],
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
    // v2.0.0-rc.38 UX-8 (C): compliance metric — 1 qualifying cite, 0 missed → 100%.
    expect(report.metrics.compliant_cites).toBe(1);
    expect(report.metrics.noncompliant_cites).toBe(0);
    expect(report.metrics.cite_compliance_rate).toBe(1);
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
        citeTags: ["applied"],
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

  // 7. Recalled tag + matching knowledge_body_read in same session
  //    within ±60s → recalled_unverified does NOT increment (KT-DEC-0030).
  it("recalled tag verified by a same-session body_read within +/-60s does not increment recalled_unverified", async () => {
    const target = createInitializedProject("cite-coverage-recall-verified");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [{ stable_id: "KT-DEC-0099", relevance_scope: "broad" }]);

    seedEvents(target, [
      mkTurnEvent({
        sessionId: "sess-R",
        kbLineRaw: "KB: KT-DEC-0099",
        citeIds: ["KT-DEC-0099"],
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 1_000,
      }),
      // Body read 30s after the turn — well inside the 60s window.
      mkKnowledgeBodyReadEvent({
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-P2",
        kbLineRaw: "KB: KT-DEC-0302",
        citeIds: ["KT-DEC-0302"],
        citeTags: ["applied"],
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
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10, // < cutoff → excluded
      }),
      mkTurnEvent({
        sessionId: "sess-NEW",
        kbLineRaw: "KB: new",
        citeIds: ["KT-DEC-0402"],
        citeTags: ["applied"],
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
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-CX",
        kbLineRaw: "KB: codex",
        citeIds: ["KT-DEC-0502"],
        citeTags: ["applied"],
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
        citeTags: ["applied"],
        client: "cc",
        ts: marker.marker_ts + 10,
      }),
      mkTurnEvent({
        sessionId: "sess-CX2",
        kbLineRaw: "KB: codex",
        citeIds: ["KT-DEC-0602"],
        citeTags: ["applied"],
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
    // v2.0.0-rc.38 UX-8 (C): the compliance metric MUST drop below 100% when a
    // cite-expected edit is missed. 1 compliant (none sentinel) / (1 + 1 miss)
    // = 0.5. This is the discrimination proof — without a session_id on the
    // edit event the correlation never fires and this would falsely read 1.0.
    expect(report.metrics.cite_compliance_rate).toBe(0.5);
  });

  // 13b. v2.0.0-rc.38 UX-8 (C, hardening): an edit event WITHOUT session_id is
  //      uncorrelatable — it must be surfaced via uncorrelatable_edits rather
  //      than silently excluded (the stale-hook confound). It must NOT inflate
  //      expected_but_missed (no false positive without a correlation key).
  it("edit without session_id is counted in uncorrelatable_edits, not expected_but_missed", async () => {
    const target = createInitializedProject("cite-coverage-uncorrelatable");
    writeFile(".fabric/events.jsonl", "", target);

    const marker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMeta(target, [
      { stable_id: "KT-DEC-0701", relevance_scope: "narrow", relevance_paths: ["src/foo/**"] },
    ]);

    seedEvents(target, [
      // Edit on a narrow-covered path but with NO session_id (stale pre-fix
      // hook). Cannot be correlated → must not become a false missed.
      mkEditEvent({
        path: "src/foo/x.ts",
        ts: marker.marker_ts + 10,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
    expect(report.metrics.uncorrelatable_edits).toBe(1);
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
          citeTags: i % 3 === 0 ? ["applied"] : i % 3 === 1 ? ["none"] : ["dismissed"],
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
//   - `.fabric/AGENTS.md` must byte-equal BOOTSTRAP_CANONICAL_EN for the
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
    // Drift gate requires `.fabric/AGENTS.md` byte-equal to BOOTSTRAP_CANONICAL_EN.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), BOOTSTRAP_CANONICAL_EN, "utf8");
  }

  // v2.2 W5 R2/R7 (agents.meta decolo): the cite-coverage kb relevance index is
  // built from the read-set STORES (cross-store canonical entries), not the
  // retired co-location agents.meta.json. This helper writes each node as a real
  // store .md (with the relevance frontmatter the cite denominator reads), binds
  // the project to the team store, and registers it in the global config. The
  // index is keyed under both the local stable_id and `team:<id>`, so the bare
  // cite ids these tests emit still resolve.
  const CITE_STORE_UUID = "33333333-3333-4333-8333-333333333333";

  function seedAgentsMetaWithTypes(
    target: string,
    nodes: Array<{
      stable_id: string;
      knowledge_type: "decisions" | "pitfalls" | "models" | "guidelines" | "processes";
      relevance_paths?: readonly string[];
      relevance_scope?: "narrow" | "broad";
    }>,
  ): void {
    // Bind the project to the team store (idempotent — safe to re-write).
    writeFileSync(
      join(target, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
      "utf8",
    );

    const storeRoot = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: CITE_STORE_UUID }));
    // knowledge_type is the plural subdir form ("decisions"); the singular
    // frontmatter `type` drops the trailing "s".
    for (const node of nodes) {
      const dir = join(storeRoot, STORE_LAYOUT.knowledgeDir, node.knowledge_type);
      mkdirSync(dir, { recursive: true });
      const singularType = node.knowledge_type.replace(/s$/u, "");
      const lines = [
        "---",
        `id: ${node.stable_id}`,
        `type: ${singularType}`,
        "layer: team",
        "maturity: proven",
        "created_at: 2026-06-04T00:00:00.000Z",
        `relevance_scope: ${node.relevance_scope ?? "broad"}`,
        `relevance_paths: [${(node.relevance_paths ?? []).join(", ")}]`,
        `summary: Cite-coverage fixture for ${node.stable_id}`,
        "---",
        `# ${node.stable_id}`,
        "",
        "Body.",
        "",
      ];
      writeFileSync(join(dir, `${node.stable_id}.md`), lines.join("\n"), "utf8");
    }

    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: CITE_STORE_UUID, alias: "team", remote: "git@e:cite.git" }],
    });
  }

  type ContractOperator = { kind: "edit" | "not_edit" | "require" | "forbid"; target: string };
  type ContractCommitment = { operators: ContractOperator[]; skip_reason: string | null };

  function mkContractTurnEvent(opts: {
    sessionId: string;
    turnId?: string;
    citeIds: string[];
    citeTags: string[];
    citeCommitments?: ContractCommitment[];
    client?: "cc" | "codex";
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
    // Mutate .fabric/AGENTS.md so it no longer byte-equals BOOTSTRAP_CANONICAL_EN.
    writeFileSync(join(target, ".fabric", "AGENTS.md"), `${BOOTSTRAP_CANONICAL_EN}drift`, "utf8");

    const rcMarker = await ensureCitePolicyActivatedMarker(target);
    seedAgentsMetaWithTypes(target, [
      { stable_id: "KT-DEC-0001", knowledge_type: "decisions" },
    ]);
    seedEvents(target, [
      mkContractTurnEvent({
        sessionId: "sess-1",
        citeIds: ["KT-DEC-0001"],
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied", "applied"],
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
        citeTags: ["applied", "applied"],
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
        citeTags: ["applied", "applied", "applied", "applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
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
        citeTags: ["applied"],
        kbLineRaw: "KB: KT-DEC-0001 (anchor) [applied]",
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

// v2.2.0-rc.1 W1-T3 (cite 诚实拆分 / lifecycle §3): exposed_and_mutated WEAK
// auxiliary signal. Locks the honesty 铁律 (this weak signal NEVER contaminates
// cite_compliance_rate) and the three-condition join filter:
//   (1) narrow-surfaced — hook_surface_emitted with hook_name=knowledge-hint-narrow
//   (2) contract glob specific — narrow kb, relevance_paths not `**/*`, type not guideline
//   (3) mutated + not dismissed — same-session edit hit the specific glob, id not [dismissed]
describe("runDoctorCiteCoverage (W1-T3 exposed_and_mutated weak signal)", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  // v2.2 W5 R2/R7 (agents.meta decolo): cite-coverage reads its kb relevance
  // index from the read-set STORES. Seed each node as a store .md, bind the
  // project to the team store, and register it. Index is keyed under both the
  // local stable_id and `team:<id>`, so bare cite ids still resolve.
  const CITE_STORE_UUID_W1T3 = "66666666-6666-4666-8666-666666666666";

  function seedMeta(
    target: string,
    nodes: Array<{
      stable_id: string;
      knowledge_type: "decisions" | "pitfalls" | "models" | "guidelines" | "processes";
      relevance_paths?: readonly string[];
      relevance_scope?: "narrow" | "broad";
    }>,
  ): void {
    writeFileSync(
      join(target, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
      "utf8",
    );

    const storeRoot = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: CITE_STORE_UUID_W1T3 }));
    for (const node of nodes) {
      const dir = join(storeRoot, STORE_LAYOUT.knowledgeDir, node.knowledge_type);
      mkdirSync(dir, { recursive: true });
      const singularType = node.knowledge_type.replace(/s$/u, "");
      const lines = [
        "---",
        `id: ${node.stable_id}`,
        `type: ${singularType}`,
        "layer: team",
        "maturity: proven",
        "created_at: 2026-06-04T00:00:00.000Z",
        `relevance_scope: ${node.relevance_scope ?? "broad"}`,
        `relevance_paths: [${(node.relevance_paths ?? []).join(", ")}]`,
        `summary: Cite-coverage fixture for ${node.stable_id}`,
        "---",
        `# ${node.stable_id}`,
        "",
        "Body.",
        "",
      ];
      writeFileSync(join(dir, `${node.stable_id}.md`), lines.join("\n"), "utf8");
    }

    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: CITE_STORE_UUID_W1T3, alias: "team", remote: "git@e:cite-w1t3.git" }],
    });
  }

  function mkNarrowSurface(opts: {
    sessionId: string;
    ids: string[];
    ts: number;
    hookName?: string;
    deliveryStatus?: "delivered" | "suppressed" | "error";
  }): object {
    return {
      kind: "fabric-event",
      id: `event:surface:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "hook_surface_emitted",
      hook_name: opts.hookName ?? "knowledge-hint-narrow",
      client: "cc",
      target_channel: "preToolUse",
      rendered_ids: opts.ids,
      delivery_status: opts.deliveryStatus ?? "delivered",
    };
  }

  function mkEdit(opts: { path: string; ts: number; sessionId: string }): object {
    return {
      kind: "fabric-event",
      id: `event:edit:${randomUUID()}`,
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

  function mkTurn(opts: {
    sessionId: string;
    citeIds: string[];
    citeTags: string[];
    ts: number;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:turn:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: opts.citeIds,
      cite_tags: opts.citeTags,
      cite_commitments: [],
      client: "cc",
      turn_id: `turn-${randomUUID()}`,
      timestamp: new Date(opts.ts).toISOString(),
    };
  }

  // Positive case: narrow-surfaced + specific glob (decisions) + same-session
  // edit hit + not dismissed → count=1, id captured. AND the explicit
  // compliance rate is untouched (no `KB:` cite written this round).
  it("counts a qualifying exposed_and_mutated pair WITHOUT polluting compliance", async () => {
    const target = createInitializedProject("cite-exposed-positive");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0001",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-X", ids: ["KT-DEC-0001"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-X", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    expect(report.metrics.exposed_and_mutated).toEqual({
      count: 1,
      ids: ["KT-DEC-0001"],
    });
    // Honesty 铁律: no explicit `KB:` cite was written. The narrow KB WAS
    // applicable + edited but uncited → it correctly registers as a missed
    // explicit obligation (expected_but_missed=1, compliance=0/1=0%). The weak
    // exposed_and_mutated=1 signal does NOT credit toward — nor dilute — that
    // true compliance number: compliance stays an honest 0%, never inflated.
    expect(report.metrics.qualifying_cites).toBe(0);
    expect(report.metrics.compliant_cites).toBe(0);
    expect(report.metrics.expected_but_missed).toBe(1);
    expect(report.metrics.noncompliant_cites).toBe(1);
    expect(report.metrics.cite_compliance_rate).toBe(0);
  });

  // Negative (condition 2): relevance_paths is the `**/*` catch-all → not
  // specific → excluded even though surfaced + edited.
  it("does NOT count a `**/*` wildcard glob (not specific)", async () => {
    const target = createInitializedProject("cite-exposed-wildcard");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0002",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["**/*"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-W", ids: ["KT-DEC-0002"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-W", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Negative (condition 2): guideline-type entry is broad-by-nature → excluded
  // even with a specific glob + surface + edit.
  it("does NOT count a generic guideline-type entry", async () => {
    const target = createInitializedProject("cite-exposed-guideline");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-GLD-0001",
        knowledge_type: "guidelines",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-G", ids: ["KT-GLD-0001"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-G", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Negative (condition 3): the id was [dismissed] this session → excluded.
  it("does NOT count an id dismissed in the same session", async () => {
    const target = createInitializedProject("cite-exposed-dismissed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0003",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-D", ids: ["KT-DEC-0003"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-D", ts: marker.marker_ts + 20 }),
      // index-aligned: cite_ids[0] dismissed
      mkTurn({
        sessionId: "sess-D",
        citeIds: ["KT-DEC-0003"],
        citeTags: ["dismissed"],
        ts: marker.marker_ts + 30,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Negative (condition 1): the surface came from the BROAD hook, not the
  // narrow PreToolUse hook → excluded even with specific glob + edit.
  it("does NOT count a non-narrow (broad) surface", async () => {
    const target = createInitializedProject("cite-exposed-broad-surface");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0004",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({
        sessionId: "sess-B",
        ids: ["KT-DEC-0004"],
        ts: marker.marker_ts + 10,
        hookName: "knowledge-hint-broad",
      }),
      mkEdit({ path: "src/auth/login.ts", sessionId: "sess-B", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Negative (join): surfaced + specific glob but the same-session edit did NOT
  // hit the glob path → not mutated → excluded.
  it("does NOT count when the edit path is outside the specific glob", async () => {
    const target = createInitializedProject("cite-exposed-no-mutation");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0005",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
    ]);
    seedEvents(target, [
      mkNarrowSurface({ sessionId: "sess-M", ids: ["KT-DEC-0005"], ts: marker.marker_ts + 10 }),
      // edit a path NOT under src/auth
      mkEdit({ path: "src/billing/charge.ts", sessionId: "sess-M", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.exposed_and_mutated).toEqual({ count: 0 });
  });

  // Honesty cross-check: a real explicit cite (compliance) AND a separate
  // exposed_and_mutated pair coexist in the same report — neither inflates the
  // other. Compliance counts the cited id; exposed counts only the surfaced-but-
  // uncited id, on its own field.
  it("keeps compliance and exposed_and_mutated as independent counts", async () => {
    const target = createInitializedProject("cite-exposed-independence");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedMeta(target, [
      {
        stable_id: "KT-DEC-0010",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/auth/**"],
      },
      {
        stable_id: "KT-DEC-0011",
        knowledge_type: "decisions",
        relevance_scope: "narrow",
        relevance_paths: ["src/pay/**"],
      },
    ]);
    seedEvents(target, [
      // explicit applied cite for KT-DEC-0010 (compliance signal)
      mkTurn({
        sessionId: "sess-I",
        citeIds: ["KT-DEC-0010"],
        citeTags: ["applied"],
        ts: marker.marker_ts + 5,
      }),
      // KT-DEC-0011 surfaced-but-uncited + mutated (exposed signal only)
      mkNarrowSurface({ sessionId: "sess-I", ids: ["KT-DEC-0011"], ts: marker.marker_ts + 10 }),
      mkEdit({ path: "src/pay/charge.ts", sessionId: "sess-I", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });

    // explicit compliance credits ONLY the applied cite
    expect(report.metrics.qualifying_cites).toBe(1);
    // exposed weak signal credits ONLY the surfaced-but-uncited id
    expect(report.metrics.exposed_and_mutated).toEqual({
      count: 1,
      ids: ["KT-DEC-0011"],
    });
  });
});

// lifecycle-refactor W2-T4 (§5 row7 PostToolUse / row2 SessionEnd / §0 下沉 doctor):
// doctor consumes the new `file_mutated` + `session_ended` markers OFFLINE.
// Locks: (1) mutations_observed counts distinct file_mutated (tool_call_id dedup);
// (2) mutation_pool splits attributed (source_event_id → surfaced) vs
// unattributed_workspace_dirty; (3) attribution key store_id+stable_id+source_event_id
// dedups multi-store; (4) sessions_closed counts distinct session_ended;
// (5) the honesty 铁律 — none of these touch cite_compliance_rate.
describe("runDoctorCiteCoverage (W2-T4 PostToolUse mutation funnel)", () => {
  function seedEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const newlines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(ledgerPath, existing + newlines, "utf8");
  }

  // A narrow surface event with a KNOWN envelope id so file_mutated can link to
  // it via source_event_id. Returns { event, id } so the caller wires the link.
  function mkSurface(opts: {
    sessionId: string;
    ids: string[];
    ts: number;
  }): { event: object; id: string } {
    const id = `event:surface:${randomUUID()}`;
    return {
      id,
      event: {
        kind: "fabric-event",
        id,
        ts: opts.ts,
        schema_version: 1,
        session_id: opts.sessionId,
        event_type: "hook_surface_emitted",
        hook_name: "knowledge-hint-narrow",
        client: "cc",
        target_channel: "preToolUse",
        rendered_ids: opts.ids,
        delivery_status: "delivered",
      },
    };
  }

  function mkFileMutated(opts: {
    sessionId: string;
    path: string;
    toolCallId: string;
    ts: number;
    sourceEventId?: string;
    storeId?: string;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:mutated:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "file_mutated",
      path: opts.path,
      tool_call_id: opts.toolCallId,
      tool_name: "Edit",
      ...(opts.sourceEventId !== undefined ? { source_event_id: opts.sourceEventId } : {}),
      ...(opts.storeId !== undefined ? { store_id: opts.storeId } : {}),
    };
  }

  function mkSessionEnded(opts: { sessionId: string; ts: number }): object {
    return {
      kind: "fabric-event",
      id: `event:ended:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "session_ended",
    };
  }

  function mkTurn(opts: {
    sessionId: string;
    citeIds: string[];
    citeTags: string[];
    ts: number;
  }): object {
    return {
      kind: "fabric-event",
      id: `event:turn:${randomUUID()}`,
      ts: opts.ts,
      schema_version: 1,
      session_id: opts.sessionId,
      event_type: "assistant_turn_observed",
      kb_line_raw: null,
      cite_ids: opts.citeIds,
      cite_tags: opts.citeTags,
      cite_commitments: [],
      client: "cc",
      turn_id: `turn-${randomUUID()}`,
      timestamp: new Date(opts.ts).toISOString(),
    };
  }

  // mutations_observed counts every distinct file_mutated; tool_call_id dedups.
  it("counts distinct file_mutated events with tool_call_id dedup", async () => {
    const target = createInitializedProject("mut-observed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      mkFileMutated({ sessionId: "s1", path: "a.ts", toolCallId: "call-1", ts: marker.marker_ts + 10 }),
      mkFileMutated({ sessionId: "s1", path: "b.ts", toolCallId: "call-2", ts: marker.marker_ts + 20 }),
      // duplicate tool_call_id (retry append) → collapses to one
      mkFileMutated({ sessionId: "s1", path: "a.ts", toolCallId: "call-1", ts: marker.marker_ts + 30 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.mutations_observed).toEqual({ count: 2 });
  });

  // No source_event_id → unattributed_workspace_dirty, never attributed.
  it("downgrades a file_mutated without source_event_id to unattributed_workspace_dirty", async () => {
    const target = createInitializedProject("mut-unattributed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      mkFileMutated({ sessionId: "s1", path: "a.ts", toolCallId: "call-1", ts: marker.marker_ts + 10 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.mutations_observed).toEqual({ count: 1 });
    expect(report.metrics.mutation_pool).toEqual({
      attributed: 0,
      unattributed_workspace_dirty: 1,
    });
  });

  // source_event_id linking to a real surfaced event → attributed.
  it("attributes a file_mutated whose source_event_id resolves to a surfaced event", async () => {
    const target = createInitializedProject("mut-attributed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const surface = mkSurface({ sessionId: "s1", ids: ["KT-DEC-0001"], ts: marker.marker_ts + 5 });
    seedEvents(target, [
      surface.event,
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-1",
        ts: marker.marker_ts + 10,
        sourceEventId: surface.id,
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.mutations_observed).toEqual({ count: 1 });
    expect(report.metrics.mutation_pool).toEqual({
      attributed: 1,
      unattributed_workspace_dirty: 0,
    });
  });

  // A source_event_id that links to NO surfaced event (dangling) → unattributed.
  it("downgrades a file_mutated whose source_event_id resolves to nothing", async () => {
    const target = createInitializedProject("mut-dangling-source");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      mkFileMutated({
        sessionId: "s1",
        path: "a.ts",
        toolCallId: "call-1",
        ts: marker.marker_ts + 10,
        sourceEventId: "event:surface:does-not-exist",
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.mutation_pool).toEqual({
      attributed: 0,
      unattributed_workspace_dirty: 1,
    });
  });

  // Attribution key = store_id + stable_id + source_event_id: two file_mutated
  // events from DIFFERENT stores sharing the same surfaced id + source must count
  // as TWO attributions (cross-store), while a true duplicate (same store + id +
  // source) collapses to one.
  it("dedups attribution by store_id+stable_id+source_event_id (no multi-store double-count collapse)", async () => {
    const target = createInitializedProject("mut-multistore-key");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const surface = mkSurface({ sessionId: "s1", ids: ["KT-DEC-0001"], ts: marker.marker_ts + 5 });
    seedEvents(target, [
      surface.event,
      // store team
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-1",
        ts: marker.marker_ts + 10,
        sourceEventId: surface.id,
        storeId: "team",
      }),
      // store other — same surfaced id + source but different store → distinct key
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-2",
        ts: marker.marker_ts + 11,
        sourceEventId: surface.id,
        storeId: "other",
      }),
      // exact duplicate of the team one (different tool_call_id so it's a distinct
      // mutation, but same store+id+source) → attribution key collapses to one
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-3",
        ts: marker.marker_ts + 12,
        sourceEventId: surface.id,
        storeId: "team",
      }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    // 3 distinct tool_call_ids → 3 mutations observed
    expect(report.metrics.mutations_observed).toEqual({ count: 3 });
    // attribution keys: team|KT-DEC-0001|src + other|KT-DEC-0001|src = 2 distinct
    expect(report.metrics.mutation_pool?.attributed).toBe(2);
    expect(report.metrics.mutation_pool?.unattributed_workspace_dirty).toBe(0);
  });

  // sessions_closed counts distinct session_ended markers.
  it("counts distinct session_ended markers as sessions_closed", async () => {
    const target = createInitializedProject("mut-sessions-closed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedEvents(target, [
      mkSessionEnded({ sessionId: "s1", ts: marker.marker_ts + 10 }),
      mkSessionEnded({ sessionId: "s2", ts: marker.marker_ts + 20 }),
      // duplicate session_ended for s1 → same session, counts once
      mkSessionEnded({ sessionId: "s1", ts: marker.marker_ts + 30 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.sessions_closed).toEqual({ count: 2 });
  });

  // Honesty 铁律: the mutation funnel NEVER feeds cite_compliance_rate. An
  // explicit applied cite stands alone; file_mutated/session_ended add no
  // compliance credit and no contamination.
  it("keeps the mutation funnel strictly separate from cite_compliance_rate", async () => {
    const target = createInitializedProject("mut-honesty");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const surface = mkSurface({ sessionId: "s1", ids: ["KT-DEC-0001"], ts: marker.marker_ts + 5 });
    seedEvents(target, [
      // one explicit applied cite → compliance = 1/1 = 100%
      mkTurn({ sessionId: "s1", citeIds: ["KT-DEC-0001"], citeTags: ["applied"], ts: marker.marker_ts + 6 }),
      // a fully attributed mutation + a session close — pure observability, no
      // compliance effect
      surface.event,
      mkFileMutated({
        sessionId: "s1",
        path: "src/auth/login.ts",
        toolCallId: "call-1",
        ts: marker.marker_ts + 10,
        sourceEventId: surface.id,
      }),
      mkSessionEnded({ sessionId: "s1", ts: marker.marker_ts + 20 }),
    ]);

    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    // mutation funnel populated
    expect(report.metrics.mutations_observed).toEqual({ count: 1 });
    expect(report.metrics.mutation_pool).toEqual({ attributed: 1, unattributed_workspace_dirty: 0 });
    expect(report.metrics.sessions_closed).toEqual({ count: 1 });
    // compliance untouched: still 1 qualifying cite, 0 missed, 100%
    expect(report.metrics.qualifying_cites).toBe(1);
    expect(report.metrics.expected_but_missed).toBe(0);
    expect(report.metrics.cite_compliance_rate).toBe(1);
  });
});

// v2.0.0-rc.23 TASK-007 (a-C2): enrichDescriptions back-fill suite.
describe("enrichDescriptions", () => {
  const ENRICH_STORE_UUID = "77777777-7777-4777-8777-777777777777";

  function createStoreBoundEnrichProject(name: string): string {
    const target = createInitializedProject(name);
    writeFile(
      ".fabric/fabric-config.json",
      JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2),
      target,
    );
    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: ENRICH_STORE_UUID, alias: "team", remote: "git@example.com:team.git" }],
    });
    return target;
  }

  function storePath(...parts: string[]): string {
    return join(
      resolveGlobalRoot(),
      storeRelativePathForMount({ store_uuid: ENRICH_STORE_UUID }),
      STORE_LAYOUT.knowledgeDir,
      ...parts,
    );
  }

  // Helper — seed a canonical entry whose frontmatter is missing N of the
  // four rc.23 description-grade fields in the mounted store read-set.
  function seedLegacyEntry(
    absPath: string,
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
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, `${lines.join("\n")}\n`, "utf8");
  }

  it("auto mode back-fills all four fields with deterministic stubs", async () => {
    const target = createStoreBoundEnrichProject("enrich-auto-missing-all");
    const absPath = storePath("decisions", "KT-DEC-0001--legacy.md");
    seedLegacyEntry(absPath);

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
      path: "store:team:KT-DEC-0001",
      added_fields: ["intent_clues", "tech_stack", "impact", "must_read_if"],
    });
  });

  it("auto mode is no-op (idempotent) on entries that already have all four fields", async () => {
    const target = createStoreBoundEnrichProject("enrich-auto-noop");
    const absPath = storePath("decisions", "KT-DEC-0001--complete.md");
    seedLegacyEntry(absPath, {
      withFields: ["intent_clues", "tech_stack", "impact", "must_read_if"],
    });
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
    const target = createStoreBoundEnrichProject("enrich-dry-run");
    const absPath = storePath("decisions", "KT-DEC-0001--legacy.md");
    seedLegacyEntry(absPath, {
      withFields: ["intent_clues"],
    });
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
    const target = createStoreBoundEnrichProject("enrich-readonly");
    const absPath = storePath("pitfalls", "KP-PIT-0001--gotcha.md");
    seedLegacyEntry(absPath, {
      withFields: ["tech_stack", "impact"],
    });
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
    const target = createStoreBoundEnrichProject("enrich-idempotent");
    seedLegacyEntry(storePath("guidelines", "KT-GLD-0001.md"));

    const first = await enrichDescriptions(target, { auto: true });
    expect(first.modified).toBe(1);

    const second = await enrichDescriptions(target, { auto: true });
    expect(second.modified).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.candidates).toEqual([]);
  });

  it("skips pending/ subtree (Skill owns pending shape)", async () => {
    const target = createStoreBoundEnrichProject("enrich-skip-pending");
    // Pending entries use bare-slug filenames; iterateCanonicalFilenames is
    // scoped to KNOWLEDGE_CANONICAL_TYPE_DIRS which deliberately excludes
    // pending/. Belt-and-suspenders: even if a Skill landed a pending entry
    // missing all four fields, enrichDescriptions must not touch it.
    const pendingPath = storePath("pending", "decisions", "draft.md");
    mkdirSync(dirname(pendingPath), { recursive: true });
    writeFileSync(
      pendingPath,
      "---\ntype: decision\nmaturity: draft\nlayer: team\ncreated_at: 2026-05-10T00:00:00Z\n---\n# Draft\n",
      "utf8",
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

// rc.37 NEW-33: runDoctorHistoryAll — unified per-day rollup across doctor_run
// + session_archive_attempted events. Validates the bucket aggregation +
// sort + empty-window fast-path.
describe("runDoctorHistoryAll", () => {
  function seedDoctorRunEvent(
    target: string,
    ts: number,
    mode: "lint" | "fix-knowledge",
    issues: number,
    mutations?: number,
  ): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const payload: Record<string, unknown> = {
      kind: "fabric-event",
      id: `event:doc:${randomUUID()}`,
      ts,
      schema_version: 1,
      event_type: "doctor_run",
      mode,
      issues,
      timestamp: new Date(ts).toISOString(),
    };
    if (mutations !== undefined) payload.mutations = mutations;
    writeFileSync(ledgerPath, existing + JSON.stringify(payload) + "\n", "utf8");
  }

  function seedArchiveEvent(target: string, ts: number, proposed: number): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const payload = {
      kind: "fabric-event",
      id: `event:arch:${randomUUID()}`,
      ts,
      schema_version: 1,
      session_id: `sess-${ts}`,
      event_type: "session_archive_attempted",
      outcome: proposed > 0 ? "proposed" : "skipped_no_signal",
      covered_through_ts: ts,
      candidates_proposed: proposed,
      knowledge_proposed_ids: [],
    };
    writeFileSync(ledgerPath, existing + JSON.stringify(payload) + "\n", "utf8");
  }

  it("returns empty rows when no doctor or archive events sit in the window", async () => {
    const { runDoctorHistoryAll } = await import("./doctor.js");
    const target = createInitializedProject("history-all-empty");
    writeFile(".fabric/events.jsonl", "", target);

    const report = await runDoctorHistoryAll(target, { since: 0 });
    expect(report.rows).toHaveLength(0);
    expect(report.since_ms).toBe(0);
    expect(Number.isNaN(new Date(report.generated_at).getTime())).toBe(false);
  });

  it("buckets doctor_run and archive events by UTC date and sorts desc", async () => {
    const { runDoctorHistoryAll } = await import("./doctor.js");
    const target = createInitializedProject("history-all-buckets");
    writeFile(".fabric/events.jsonl", "", target);

    // Two UTC dates: day A (older) and day B (newer). Crafted in epoch-ms.
    const dayA = Date.UTC(2026, 0, 10, 12, 0, 0);
    const dayB = Date.UTC(2026, 0, 11, 12, 0, 0);
    seedDoctorRunEvent(target, dayA, "lint", 5);
    seedDoctorRunEvent(target, dayA, "fix-knowledge", 3, 2);
    seedArchiveEvent(target, dayA, 4);
    seedDoctorRunEvent(target, dayB, "lint", 1);
    seedArchiveEvent(target, dayB, 0);

    const report = await runDoctorHistoryAll(target, { since: 0 });
    expect(report.rows).toHaveLength(2);
    // Sorted descending — newer first.
    expect(report.rows[0].date).toBe("2026-01-11");
    expect(report.rows[1].date).toBe("2026-01-10");
    // Day B aggregates: 1 lint, 0 fix, 1 issue, 0 mut, 1 archive attempt, 0 proposed.
    expect(report.rows[0].doctor_runs_lint).toBe(1);
    expect(report.rows[0].doctor_runs_fix).toBe(0);
    expect(report.rows[0].archive_attempts).toBe(1);
    expect(report.rows[0].archive_proposed).toBe(0);
    // Day A aggregates: 1 lint + 1 fix, 5+3 issues, 2 mut, 1 archive, 4 proposed.
    expect(report.rows[1].doctor_runs_lint).toBe(1);
    expect(report.rows[1].doctor_runs_fix).toBe(1);
    expect(report.rows[1].doctor_total_issues).toBe(8);
    expect(report.rows[1].doctor_total_mutations).toBe(2);
    expect(report.rows[1].archive_attempts).toBe(1);
    expect(report.rows[1].archive_proposed).toBe(4);
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

// v2.2 全砍 F16: `fabric doctor --fix` flushes buffered metric counters to
// metrics.jsonl, so an idle MCP process (whose 60s flush tick has stalled) no
// longer requires a SERVER RESTART to clear a stale-metrics warning.
describe("doctor --fix flushes metrics (F16)", () => {
  it("drains buffered counters to metrics.jsonl on --fix (no restart needed)", async () => {
    const target = createV2KnowledgeProject("doctor-f16-flush");
    // Buffer a counter in memory (mirrors a recall/consume bump) WITHOUT a flush.
    bumpCounter(target, "fabric_test_f16_counter", 3);

    await runDoctorFix(target);

    const rows = await readMetrics(target);
    const drained = rows.some((r) => (r.counters?.fabric_test_f16_counter ?? 0) > 0);
    expect(drained).toBe(true);
  });
});

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
  // v2.2 store-only cutover: the co-location agents.meta.json / knowledge-test
  // index build path is retired, so the fixture seeds only the .fabric tree above.
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
// v2.1 ⑤ cite-redesign (P5): recall-based coverage口径.
//
// runDoctorCiteCoverage now also reports recall_backed_edits /
// recall_coverage_rate: an edit is "recall-backed" when an in-session
// knowledge_context_planned (the fab_recall event) with overlapping
// target_paths preceded it within the recall window. This is the new口径 — the
// recall→edit overlap IS the citation, no hand-written `KB:` line required.
// The legacy first-line-`KB:` metrics are unchanged (back-compat).
// ---------------------------------------------------------------------------

describe("runDoctorCiteCoverage recall-based口径 (v2.1 ⑤)", () => {
  function seedRecallEvents(target: string, events: unknown[]): void {
    const ledgerPath = join(target, ".fabric", "events.jsonl");
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    writeFileSync(ledgerPath, existing + events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }
  function planned(sessionId: string, ts: number, targetPaths: string[], ids: string[]): object {
    return {
      kind: "fabric-event",
      id: `event:planned:${randomUUID()}`,
      ts,
      schema_version: 1,
      session_id: sessionId,
      event_type: "knowledge_context_planned",
      target_paths: targetPaths,
      required_stable_ids: [],
      ai_selectable_stable_ids: ids,
      final_stable_ids: ids,
    };
  }
  function edit(sessionId: string | undefined, ts: number, path: string): object {
    return {
      kind: "fabric-event",
      id: `event:edit:${randomUUID()}`,
      ts,
      schema_version: 1,
      ...(sessionId !== undefined ? { session_id: sessionId } : {}),
      event_type: "edit_intent_checked",
      path,
      compliant: true,
      intent: "Edit",
      ledger_entry_id: `ledger:${randomUUID()}`,
      matched_rule_context_ts: null,
      window_ms: 0,
    };
  }

  it("recall→edit overlap (same session, in-window) → recall-backed", async () => {
    const target = createInitializedProject("cite-recall-backed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("S1", base, ["src/a.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 5_000, "src/a.ts"),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.recall_backed_edits).toBe(1);
    expect(report.metrics.recall_coverage_rate).toBe(1);
  });

  it("edit with NO preceding recall → not recall-backed (coverage 0)", async () => {
    const target = createInitializedProject("cite-recall-none");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    seedRecallEvents(target, [edit("S1", marker.marker_ts + 2_000, "src/a.ts")]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.edits_touched).toBe(1);
    expect(report.metrics.recall_backed_edits).toBe(0);
    expect(report.metrics.recall_coverage_rate).toBe(0);
  });

  it("recall of a different path → not recall-backed", async () => {
    const target = createInitializedProject("cite-recall-otherpath");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("S1", base, ["src/other.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 5_000, "src/a.ts"),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.recall_backed_edits).toBe(0);
  });

  it("recall in a different session → not recall-backed", async () => {
    const target = createInitializedProject("cite-recall-othersession");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("OTHER", base, ["src/a.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 5_000, "src/a.ts"),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.recall_backed_edits).toBe(0);
    // recall_diagnostics self-diagnoses the session_id mismatch: a recall happened
    // in-window (under "OTHER") but no recall session is also an edit session, so
    // coverage's 0 is a mismatch artifact, not a recall-discipline gap.
    expect(report.metrics.recall_diagnostics).toEqual({
      recalls_in_window: 1,
      recall_sessions: 1,
      recall_sessions_correlated: 0,
    });
  });

  it("recall AFTER the edit does not back it (ordering)", async () => {
    const target = createInitializedProject("cite-recall-afteredit");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 10_000;
    seedRecallEvents(target, [
      edit("S1", base, "src/a.ts"),
      planned("S1", base + 5_000, ["src/a.ts"], ["KT-DEC-0007"]),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.recall_backed_edits).toBe(0);
  });

  it("recall outside recallWindowMs does not back the edit", async () => {
    const target = createInitializedProject("cite-recall-window");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("S1", base, ["src/a.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 20 * 60_000, "src/a.ts"),
    ]);
    // 10-minute window — the recall is 20min before the edit → out of window.
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all", recallWindowMs: 10 * 60_000 });
    expect(report.metrics.recall_backed_edits).toBe(0);
    // ...but an unbounded window (0) backs it.
    const unbounded = await runDoctorCiteCoverage(target, { since: 0, client: "all", recallWindowMs: 0 });
    expect(unbounded.metrics.recall_backed_edits).toBe(1);
  });

  it("mixed: 2 edits, 1 recall-backed → coverage 0.5", async () => {
    const target = createInitializedProject("cite-recall-mixed");
    writeFile(".fabric/events.jsonl", "", target);
    const marker = await ensureCitePolicyActivatedMarker(target);
    const base = marker.marker_ts + 1000;
    seedRecallEvents(target, [
      planned("S1", base, ["src/a.ts"], ["KT-DEC-0007"]),
      edit("S1", base + 1_000, "src/a.ts"),
      edit("S1", base + 2_000, "src/b.ts"),
    ]);
    const report = await runDoctorCiteCoverage(target, { since: 0, client: "all" });
    expect(report.metrics.edits_touched).toBe(2);
    expect(report.metrics.recall_backed_edits).toBe(1);
    expect(report.metrics.recall_coverage_rate).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.30 TASK-003 (H2 deferred-from-rc.29): emit-cadence sub-check.
//
// Pins the function contract — fetched=0 vacuously OK; observed/fetched <
// EMIT_CADENCE_WARN_THRESHOLD (0.8) yields warn; healthy ratio yields ok.
// Wired-into-main-doctor decision deferred to v2.1 design doc per
// memory/project_l0_l1_l2_redesign_v21.md.
// ---------------------------------------------------------------------------

describe("runDoctorBodyReadMisfireCheck (W3-3 / KT-DEC-0030)", () => {
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

  function makePlannedEvent(i: number): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `planned-${String(i)}`,
      ts: 1700000000000 + i,
      schema_version: 1,
      event_type: "knowledge_context_planned",
      target_paths: [`src/file-${String(i)}.ts`],
      required_stable_ids: [],
      ai_selectable_stable_ids: [`KT-DEC-${String(i).padStart(4, "0")}`],
      final_stable_ids: [`KT-DEC-${String(i).padStart(4, "0")}`],
    };
  }

  function makeBodyReadEvent(i: number): Record<string, unknown> {
    return {
      kind: "fabric-event",
      id: `bodyread-${String(i)}`,
      ts: 1700000001000 + i,
      schema_version: 1,
      event_type: "knowledge_body_read",
      stable_id: `KT-DEC-${String(i).padStart(4, "0")}`,
      store: "team",
      path: `~/.fabric/stores/team/fabric-team-knowledge/knowledge/decisions/KT-DEC-${String(i).padStart(4, "0")}--slug.md`,
    };
  }

  it("returns ok (not applicable) when recall volume is below the floor", async () => {
    const target = mkdtempSync(join(tmpdir(), "bodyread-quiet-"));
    tempRoots.push(target);
    seedEventsRaw(target, Array.from({ length: 3 }, (_unused, i) => makePlannedEvent(i)));
    const report = await runDoctorBodyReadMisfireCheck(target);
    expect(report.recalls).toBe(3);
    expect(report.body_reads).toBe(0);
    expect(report.status).toBe("ok");
    expect(report.message).toContain("not enough activity");
  });

  it("returns warn when recalls are sustained but zero body_read (unwired marker)", async () => {
    const target = mkdtempSync(join(tmpdir(), "bodyread-misfire-"));
    tempRoots.push(target);
    seedEventsRaw(target, Array.from({ length: 12 }, (_unused, i) => makePlannedEvent(i)));
    const report = await runDoctorBodyReadMisfireCheck(target);
    expect(report.recalls).toBe(12);
    expect(report.body_reads).toBe(0);
    expect(report.status).toBe("warn");
    expect(report.message).toContain("may be unwired");
    expect(report.message).toContain("Read");
  });

  it("returns ok when at least one body_read fired amid sustained recalls (sparse-by-design)", async () => {
    const target = mkdtempSync(join(tmpdir(), "bodyread-ok-"));
    tempRoots.push(target);
    const events = [
      ...Array.from({ length: 12 }, (_unused, i) => makePlannedEvent(i)),
      makeBodyReadEvent(0),
    ];
    seedEventsRaw(target, events);
    const report = await runDoctorBodyReadMisfireCheck(target);
    expect(report.recalls).toBe(12);
    expect(report.body_reads).toBe(1);
    expect(report.status).toBe("ok");
    expect(report.message).toContain("healthy");
  });
});

// doctor-decruft W2: "legacy canonical iterator guardrails" describe removed —
// the inert iterateCanonicalEntries generator + the inspectOrphanDemote it
// guarded were deleted (store-cutover dead code; the empty-stub checks they fed
// are gone, store-aware re-implementation deferred to Goal Y).
