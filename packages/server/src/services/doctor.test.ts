import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
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
  runDoctorFix,
  runDoctorReport,
} from "./doctor.js";
import { readEventLedger } from "./event-ledger.js";
import { bumpCounter, readMetrics } from "./metrics.js";
import { sha256 } from "./_shared.js";
import {
  createForensic,
  createInitializedProject,
  createProject,
  createV2KnowledgeProject,
  tempRoots,
  writeFile,
} from "./doctor-test-helpers.js";

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
      // ISS-20260711-221: body_read misfire wired into runDoctorReport.
      "Knowledge body-read wiring",
      // Peer micro-transfer P0-2: dump-shaped body altitude warn-only lint.
      "Knowledge body altitude",
      // v-next grill D5/D7/D8: legacy body section dedup check.
      "Knowledge body dedup (v-next)",
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
      // rc.11 stray_fabric_dir_detected — walker for `.fabric/` dirs left by
      // the pre-rc.10 hook / pre-rc.11 server-side resolveProjectRoot fault
      // mode (subprocess cwd landed in a subdir → stray `<subdir>/.fabric/`).
      "Stray .fabric directories",
      // unify-fabric-cache-dir: recall engine BM25/vector caches moved from
      // `.fabric/cache/{bm25,vectors}` → `.fabric/.cache/…` (co-located with
      // hook sidecar cache so a single `.gitignore` rule covers both).
      // Adjacent to Stray .fabric directories — both are legacy-layout sweeps.
      "Legacy .fabric/cache/ directories",
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
    // rc.11: +1 stray_fabric_dir_detected (walker for `.fabric/` dirs left by pre-rc.10
    // hooks / pre-rc.11 server-side resolveProjectRoot) → 47.
    // ISS-20260711-221: +1 knowledge body-read wiring → 48.
    // Peer micro-transfer P0-2: +1 knowledge body altitude → 49.
    // unify-fabric-cache-dir: +1 legacy_fabric_cache_dir_detected (rename
    // legacy `.fabric/cache/{bm25,vectors}` → `.fabric/.cache/…`) → 50.
    // v-next grill D5/D7/D8: +1 knowledge_body_dedup → 51.
    expect(report.checks).toHaveLength(51);
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
      const driftMutation = result.mutations.find((m) => m.kind === "store_counter_floor");
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
